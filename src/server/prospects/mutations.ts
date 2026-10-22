import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import {
  auditLog,
  consents,
  contacts,
  exposes,
  intentScores,
  invoices,
  letters,
  notifications,
  outboundEmails,
  prospects,
  savedViews,
  sessionReplays,
  tasks,
  touchpoints,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { randomCode } from "@/domain/codes";
import type { ProspectForm } from "@/domain/prospects/schema";
import type { ProspectStatus } from "@/domain/prospects/status";
import { slugify } from "@/domain/slug";
import { deleteLetterPdfs } from "../letters/manage";
import { deleteReplayFiles } from "../retention";
import { createTouchpoint } from "../tracking/touchpoints";

/** Sets the status of one or many prospects; logs each actual change. */
export async function setProspectStatus(
  tx: Transaction,
  actor: Actor,
  ids: string[],
  status: ProspectStatus,
): Promise<number> {
  if (ids.length === 0) return 0;
  const before = await tx
    .select({ id: prospects.id, status: prospects.status })
    .from(prospects)
    .where(
      and(
        eq(prospects.workspaceId, actor.workspaceId),
        inArray(prospects.id, ids),
        ne(prospects.status, status),
      ),
    );
  if (before.length === 0) return 0;
  await tx
    .update(prospects)
    .set({ status })
    .where(
      and(
        eq(prospects.workspaceId, actor.workspaceId),
        inArray(
          prospects.id,
          before.map((row) => row.id),
        ),
      ),
    );
  await tx.insert(auditLog).values(
    before.map((row) => ({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "prospect.status_changed",
      targetType: "prospect",
      targetId: row.id,
      meta: { from: row.status, to: status, via: "cockpit" },
    })),
  );
  return before.length;
}

function columns(form: ProspectForm) {
  const { estimatedValue, ...rest } = form;
  return { ...rest, estimatedValueCents: estimatedValue };
}

export async function createProspect(
  tx: Transaction,
  actor: Actor,
  form: ProspectForm,
  options: { audit?: boolean } = {},
) {
  const base = slugify(form.companyName).slice(0, 50) || "kunde";
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = attempt === 0 ? base : `${base}-${randomCode(4)}`;
    const [row] = await tx
      .insert(prospects)
      .values({ workspaceId: actor.workspaceId, key, ...columns(form) })
      .onConflictDoNothing()
      .returning({ id: prospects.id });
    if (row) {
      if (options.audit === false) return row.id;
      await tx.insert(auditLog).values({
        workspaceId: actor.workspaceId,
        actorUserId: actor.userId,
        action: "prospect.created",
        targetType: "prospect",
        targetId: row.id,
        meta: { via: "cockpit" },
      });
      return row.id;
    }
  }
  throw new Error("could not allocate prospect key");
}

export async function updateProspect(
  tx: Transaction,
  actor: Actor,
  id: string,
  form: ProspectForm,
): Promise<boolean> {
  const values = columns(form);
  // A changed address puts the prospect back in the geocoding queue (map).
  const sameAddress = sql`(${prospects.street} is not distinct from ${values.street ?? null}
    and ${prospects.postalCode} is not distinct from ${values.postalCode ?? null}
    and ${prospects.city} is not distinct from ${values.city ?? null})`;
  const keep = <T>(column: T) => sql`case when ${sameAddress} then ${column} else null end`;
  const updated = await tx
    .update(prospects)
    .set({
      ...values,
      latitude: keep(prospects.latitude),
      longitude: keep(prospects.longitude),
      geocodedAt: keep(prospects.geocodedAt),
    })
    .where(
      and(
        eq(prospects.workspaceId, actor.workspaceId),
        eq(prospects.id, id),
        isNull(prospects.restrictedAt),
      ),
    )
    .returning({ id: prospects.id });
  return updated.length > 0;
}

/**
 * Sperrvermerk (§7.8 Datenschutz-Aktionen): blocks letters and follow-ups.
 * Set by hand here or by the prospect's own opt-out; retention then deletes
 * the tracking data after the configured period and keeps only this marker.
 */
export async function setDoNotContact(tx: Transaction, actor: Actor, id: string, blocked: boolean) {
  const updated = await tx
    .update(prospects)
    .set({ doNotContactAt: blocked ? new Date() : null })
    // A restricted customer stays blocked (ADR-0071).
    .where(
      and(
        eq(prospects.workspaceId, actor.workspaceId),
        eq(prospects.id, id),
        isNull(prospects.restrictedAt),
      ),
    )
    .returning({ id: prospects.id });
  if (updated.length === 0) return false;
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: blocked ? "prospect.blocked" : "prospect.unblocked",
    targetType: "prospect",
    targetId: id,
  });
  return true;
}

/**
 * Removes a prospect with everything that hangs off it (contacts, exposé,
 * links, visits, events). Data subject deletion (§9) uses the same path.
 * Issued invoices must be kept for seven years (§ 132 BAO), so a prospect
 * with one stays ("retained"); invoice drafts go with the prospect.
 */
export async function deleteProspect(
  tx: Transaction,
  actor: Actor,
  id: string,
): Promise<boolean | "retained"> {
  const [issued] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, actor.workspaceId),
        eq(invoices.prospectId, id),
        ne(invoices.status, "draft"),
      ),
    )
    .limit(1);
  if (issued) return "retained";
  const replays = await tx
    .select({ id: sessionReplays.id })
    .from(sessionReplays)
    .where(
      and(eq(sessionReplays.workspaceId, actor.workspaceId), eq(sessionReplays.prospectId, id)),
    );
  const draftLetters = await tx
    .select({ id: letters.id })
    .from(letters)
    .where(
      and(
        eq(letters.workspaceId, actor.workspaceId),
        eq(letters.prospectId, id),
        eq(letters.status, "draft"),
      ),
    );
  await tx
    .delete(invoices)
    .where(and(eq(invoices.workspaceId, actor.workspaceId), eq(invoices.prospectId, id)));
  const deleted = await tx
    .delete(prospects)
    .where(and(eq(prospects.workspaceId, actor.workspaceId), eq(prospects.id, id)))
    .returning({ key: prospects.key });
  if (deleted.length === 0) return false;
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "prospect.deleted",
    targetType: "prospect",
    targetId: id,
  });
  // Recording chunks and letter PDFs for a print API live in storage, outside the cascade.
  await deleteReplayFiles(
    actor.workspaceId,
    replays.map((r) => r.id),
  );
  await deleteLetterPdfs(
    actor.workspaceId,
    draftLetters.map((letter) => letter.id),
  );
  return true;
}

/**
 * Sperrvermerk (§7.10, ADR-0071): the deletion request for a customer whose
 * issued invoices must be kept (§ 132 BAO). Everything but the company name,
 * projects, offers and issued invoices is deleted now; the prospect is
 * blocked for letters, chat and tracking. Retention removes the rest once
 * the newest invoice is past its period (`purgeRestrictedProspects`).
 * Returns "deletable" when nothing needs keeping, so the caller deletes.
 */
export async function restrictProspect(
  tx: Transaction,
  actor: Actor,
  id: string,
  now = new Date(),
): Promise<boolean | "deletable"> {
  const ws = actor.workspaceId;
  const [prospect] = await tx
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, ws), eq(prospects.id, id)))
    .limit(1);
  if (!prospect) return false;
  const [issued] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(eq(invoices.workspaceId, ws), eq(invoices.prospectId, id), ne(invoices.status, "draft")),
    )
    .limit(1);
  if (!issued) return "deletable";
  const replays = await tx
    .select({ id: sessionReplays.id })
    .from(sessionReplays)
    .where(and(eq(sessionReplays.workspaceId, ws), eq(sessionReplays.prospectId, id)));
  const letterRows = await tx
    .select({ id: letters.id })
    .from(letters)
    .where(and(eq(letters.workspaceId, ws), eq(letters.prospectId, id)));
  // Letters first: they point at touchpoints without a cascade. Touchpoints,
  // visits, events, chats and callback requests go with the exposé.
  for (const table of [
    letters,
    consents,
    sessionReplays,
    exposes,
    notifications,
    intentScores,
    tasks,
    outboundEmails,
    contacts,
  ]) {
    await tx.delete(table).where(and(eq(table.workspaceId, ws), eq(table.prospectId, id)));
  }
  await tx
    .delete(invoices)
    .where(
      and(eq(invoices.workspaceId, ws), eq(invoices.prospectId, id), eq(invoices.status, "draft")),
    );
  await tx
    .update(prospects)
    .set({
      industry: null,
      website: null,
      street: null,
      postalCode: null,
      city: null,
      phone: null,
      email: null,
      notes: null,
      tags: [],
      estimatedValueCents: null,
      billing: null,
      campaignId: null,
      latitude: null,
      longitude: null,
      geocodedAt: null,
      restrictedAt: now,
      doNotContactAt: sql`coalesce(${prospects.doNotContactAt}, ${now.toISOString()}::timestamptz)`,
      chatBlockedAt: sql`coalesce(${prospects.chatBlockedAt}, ${now.toISOString()}::timestamptz)`,
      trackingPurgedAt: now,
    })
    .where(and(eq(prospects.workspaceId, ws), eq(prospects.id, id)));
  await tx.insert(auditLog).values({
    workspaceId: ws,
    actorUserId: actor.userId,
    action: "prospect.restricted",
    targetType: "prospect",
    targetId: id,
    meta: { letters: letterRows.length, recordings: replays.length },
  });
  await deleteReplayFiles(
    ws,
    replays.map((r) => r.id),
  );
  await deleteLetterPdfs(
    ws,
    letterRows.map((letter) => letter.id),
  );
  return true;
}

export async function addContact(
  tx: Transaction,
  actor: Actor,
  prospectId: string,
  contact: Omit<typeof contacts.$inferInsert, "workspaceId" | "prospectId">,
): Promise<boolean> {
  const [open] = await tx
    .select({ id: prospects.id })
    .from(prospects)
    .where(
      and(
        eq(prospects.workspaceId, actor.workspaceId),
        eq(prospects.id, prospectId),
        isNull(prospects.restrictedAt),
      ),
    );
  if (!open) return false;
  await tx.insert(contacts).values({ ...contact, workspaceId: actor.workspaceId, prospectId });
  return true;
}

export async function removeContact(tx: Transaction, actor: Actor, contactId: string) {
  await tx
    .delete(contacts)
    .where(and(eq(contacts.workspaceId, actor.workspaceId), eq(contacts.id, contactId)));
}

export type TouchpointResult =
  { ok: true; id: string } | { ok: false; error: "no_expose" | "code_taken" };

/** A further link for the prospect (follow-up letter, business card, e-mail …). */
export async function addTouchpoint(
  tx: Transaction,
  actor: Actor,
  input: { prospectId: string; label: string; shortCode: string | null | undefined },
): Promise<TouchpointResult> {
  const [expose] = await tx
    .select({ id: exposes.id })
    .from(exposes)
    .where(
      and(eq(exposes.workspaceId, actor.workspaceId), eq(exposes.prospectId, input.prospectId)),
    );
  if (!expose) return { ok: false, error: "no_expose" };
  const created = await createTouchpoint(tx, {
    workspaceId: actor.workspaceId,
    prospectId: input.prospectId,
    exposeId: expose.id,
    channel: "manual",
    label: input.label,
    shortCode: input.shortCode,
    createdByUserId: actor.userId,
  });
  if (!created) return { ok: false, error: "code_taken" };
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "touchpoint.created",
    targetType: "prospect",
    targetId: input.prospectId,
    meta: { touchpointId: created.id, label: input.label },
  });
  return { ok: true, id: created.id };
}

export async function setTouchpointEnabled(
  tx: Transaction,
  actor: Actor,
  id: string,
  enabled: boolean,
) {
  const [row] = await tx
    .update(touchpoints)
    .set({ disabledAt: enabled ? null : new Date() })
    .where(and(eq(touchpoints.workspaceId, actor.workspaceId), eq(touchpoints.id, id)))
    .returning({ prospectId: touchpoints.prospectId });
  return row?.prospectId ?? null;
}

export async function saveView(
  tx: Transaction,
  actor: Actor,
  input: { name: string; query: string; shared: boolean },
) {
  await tx.insert(savedViews).values({
    workspaceId: actor.workspaceId,
    userId: input.shared ? null : actor.userId,
    name: input.name,
    query: input.query,
  });
}

export async function deleteView(tx: Transaction, actor: Actor, id: string) {
  await tx
    .delete(savedViews)
    .where(and(eq(savedViews.workspaceId, actor.workspaceId), eq(savedViews.id, id)));
}
