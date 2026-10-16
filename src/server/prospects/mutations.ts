import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Transaction } from "@/db";
import { auditLog, contacts, exposes, prospects, savedViews, touchpoints } from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { randomCode } from "@/domain/codes";
import type { ProspectForm } from "@/domain/prospects/schema";
import type { ProspectStatus } from "@/domain/prospects/status";
import { slugify } from "@/domain/slug";
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
  const updated = await tx
    .update(prospects)
    .set(columns(form))
    .where(and(eq(prospects.workspaceId, actor.workspaceId), eq(prospects.id, id)))
    .returning({ id: prospects.id });
  return updated.length > 0;
}

/**
 * Removes a prospect with everything that hangs off it (contacts, exposé,
 * links, visits, events). Data subject deletion (§9) uses the same path.
 */
export async function deleteProspect(tx: Transaction, actor: Actor, id: string) {
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
  return true;
}

export async function addContact(
  tx: Transaction,
  actor: Actor,
  prospectId: string,
  contact: Omit<typeof contacts.$inferInsert, "workspaceId" | "prospectId">,
) {
  await tx.insert(contacts).values({ ...contact, workspaceId: actor.workspaceId, prospectId });
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
