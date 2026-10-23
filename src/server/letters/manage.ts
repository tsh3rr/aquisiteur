import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  auditLog,
  contacts,
  exposes,
  exposeVersions,
  letters,
  prospects,
  touchpoints,
  usageEvents,
  workspaces,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import {
  composeLetter,
  DEFAULT_DATA_SOURCE,
  letterProblems,
  type ComposedLetter,
  type LetterSender,
} from "@/domain/letters/compose";
import {
  pathTo,
  printOptionsSchema,
  type LetterKind,
  type LetterStatus,
  type PrintOptions,
} from "@/domain/letters/lifecycle";
import {
  buildLetterTeaser,
  type LetterTeaser,
  type PrintableTeaser,
} from "@/domain/letters/teaser";
import type { ExposeDocument, ExposeImage } from "@/domain/expose/schema";
import { modulesPath, qrMatrix } from "@/domain/tracking/qr";
import type { WorkspaceSettings } from "@/domain/workspace-settings";
import type { AssetManifest } from "@/db/schema";
import { printSource, resolveEntry } from "@/components/expose/render-context";
import { brandPrintSource } from "../brand-images";
import type { Database, Transaction } from "@/db";
import { getInfra, type LetterDispatchProvider, type LetterProviderUpdate } from "@/infra";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { letterProvider } from "@/server/letters/providers";
import { advanceStatus } from "@/server/prospects/auto-status";
import {
  createTouchpoint,
  ensureLetterTouchpoint,
  touchpointUrls,
} from "@/server/tracking/touchpoints";
import { loadWorkspaceSettings } from "@/server/workspaces";

/** Letters (§7.9). Always inside withTenant. */

export const MAX_LETTERS_PER_BATCH = 500;

export type SkipReason = "no_expose" | "do_not_contact" | "has_letter" | "not_found";

export const SKIP_LABELS: Record<SkipReason, string> = {
  no_expose: "kein veröffentlichtes Exposé",
  do_not_contact: "„Kein Interesse“ gemeldet",
  has_letter: "hat schon einen Brief",
  not_found: "nicht gefunden",
};

function senderFrom(settings: WorkspaceSettings, workspaceName: string): LetterSender {
  const { senderAddress, profile, channels } = settings;
  return {
    company: senderAddress.company ?? workspaceName,
    street: senderAddress.street ?? null,
    postalCode: senderAddress.postalCode ?? null,
    city: senderAddress.city ?? null,
    country: senderAddress.country,
    name: profile.displayName ?? null,
    role: profile.role ?? null,
    phone: channels.phone ?? channels.mobile ?? null,
    email: channels.email ?? null,
    website: null,
  };
}

/**
 * Creates draft letters for the given prospects. An initial letter uses the
 * exposé's letter touchpoint and text; a follow-up gets a touchpoint of its
 * own (§7.9 „Follow-up-Brief mit eigenem Code“) and the follow-up template.
 */
export async function createLetters(
  tx: Transaction,
  actor: Actor,
  input: {
    prospectIds: string[];
    kind: LetterKind;
    options?: Partial<PrintOptions>;
    /** Prepared by the follow-up rule rather than by hand (for the audit log). */
    auto?: boolean;
  },
): Promise<{
  created: string[];
  skipped: { prospectId: string; companyName: string; reason: SkipReason }[];
}> {
  const ids = [...new Set(input.prospectIds)].slice(0, MAX_LETTERS_PER_BATCH);
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const options = printOptionsSchema.parse(input.options ?? {});
  const rows = await tx
    .select({
      id: prospects.id,
      companyName: prospects.companyName,
      campaignId: prospects.campaignId,
      doNotContactAt: prospects.doNotContactAt,
      exposeId: exposes.id,
      unpublishedAt: exposes.unpublishedAt,
      document: exposeVersions.document,
    })
    .from(prospects)
    .leftJoin(
      exposes,
      and(eq(exposes.workspaceId, prospects.workspaceId), eq(exposes.prospectId, prospects.id)),
    )
    .leftJoin(
      exposeVersions,
      and(
        eq(exposeVersions.workspaceId, exposes.workspaceId),
        eq(exposeVersions.id, exposes.currentVersionId),
      ),
    )
    .where(and(eq(prospects.workspaceId, actor.workspaceId), inArray(prospects.id, ids)));
  const existing = new Set(
    (
      await tx
        .select({ prospectId: letters.prospectId })
        .from(letters)
        .where(
          and(
            eq(letters.workspaceId, actor.workspaceId),
            inArray(letters.prospectId, ids),
            eq(letters.kind, "initial"),
            ne(letters.status, "cancelled"),
          ),
        )
    ).map((row) => row.prospectId),
  );

  const created: string[] = [];
  const skipped: { prospectId: string; companyName: string; reason: SkipReason }[] = [];
  for (const id of ids) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) {
      skipped.push({ prospectId: id, companyName: "", reason: "not_found" });
      continue;
    }
    const skip = (reason: SkipReason) =>
      skipped.push({ prospectId: id, companyName: row.companyName, reason });
    if (row.doNotContactAt) {
      skip("do_not_contact");
      continue;
    }
    if (!row.exposeId || row.unpublishedAt || !row.document) {
      skip("no_expose");
      continue;
    }
    if (input.kind === "initial" && existing.has(id)) {
      skip("has_letter");
      continue;
    }
    const touchpoint =
      input.kind === "initial"
        ? await ensureLetterTouchpoint(tx, {
            workspaceId: actor.workspaceId,
            prospectId: id,
            exposeId: row.exposeId,
            userId: actor.userId,
          })
        : await createTouchpoint(tx, {
            workspaceId: actor.workspaceId,
            prospectId: id,
            exposeId: row.exposeId,
            channel: "letter",
            label: "Folgebrief",
            createdByUserId: actor.userId,
          });
    if (!touchpoint) throw new Error("could not create touchpoint");
    const exposeLetter =
      input.kind === "initial"
        ? (row.document as { letter?: { subject: string; body: string } }).letter
        : undefined;
    const [letter] = await tx
      .insert(letters)
      .values({
        workspaceId: actor.workspaceId,
        prospectId: id,
        campaignId: row.campaignId,
        touchpointId: touchpoint.id,
        kind: input.kind,
        options,
        subject:
          exposeLetter?.subject ??
          (input.kind === "follow_up" ? settings.letter.followUp.subject : settings.letter.subject),
        body:
          exposeLetter?.body ??
          (input.kind === "follow_up" ? settings.letter.followUp.body : settings.letter.body),
        createdByUserId: actor.userId,
      })
      .returning({ id: letters.id });
    created.push(letter!.id);
  }
  if (created.length > 0) {
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "letter.created",
      targetType: "letter",
      meta: { count: created.length, kind: input.kind, ...(input.auto ? { auto: true } : {}) },
    });
  }
  return { created, skipped };
}

export interface LetterListItem {
  id: string;
  prospectId: string;
  companyName: string;
  campaignId: string | null;
  kind: LetterKind;
  status: LetterStatus;
  provider: string;
  /** Why a print API refused or failed the letter. */
  failureReason: string | null;
  subject: string;
  shortCode: string | null;
  costCents: number | null;
  postedAt: Date | null;
  createdAt: Date;
  /**
   * First real visit after posting: through this letter's code, or for a first
   * letter any visit of the prospect (people often type the exposé address from
   * the letter instead of scanning), matching the dashboard's time to open.
   */
  openedAt: Date | null;
}

export async function listLetters(
  tx: Transaction,
  workspaceId: string,
  filter: {
    prospectId?: string;
    campaignId?: string;
    statuses?: LetterStatus[];
    ids?: string[];
  } = {},
  limit = 500,
): Promise<LetterListItem[]> {
  const rows = await tx
    .select({
      id: letters.id,
      prospectId: letters.prospectId,
      companyName: prospects.companyName,
      campaignId: letters.campaignId,
      kind: letters.kind,
      status: letters.status,
      provider: letters.provider,
      failureReason: letters.failureReason,
      subject: letters.subject,
      shortCode: touchpoints.shortCode,
      costCents: letters.costCents,
      postedAt: letters.postedAt,
      createdAt: letters.createdAt,
      openedAt: sql<string | null>`(
        select min(v.started_at) from visits v
        where v.workspace_id = ${letters.workspaceId}
          and (v.touchpoint_id = ${letters.touchpointId}
            or (${letters.kind} = 'initial' and v.prospect_id = ${letters.prospectId}))
          and v.confirmed_at is not null and not v.is_bot and not v.is_internal
          and v.started_at >= ${letters.postedAt}
      )`,
    })
    .from(letters)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, letters.workspaceId), eq(prospects.id, letters.prospectId)),
    )
    .innerJoin(
      touchpoints,
      and(
        eq(touchpoints.workspaceId, letters.workspaceId),
        eq(touchpoints.id, letters.touchpointId),
      ),
    )
    .where(
      and(
        eq(letters.workspaceId, workspaceId),
        filter.prospectId ? eq(letters.prospectId, filter.prospectId) : undefined,
        filter.campaignId ? eq(letters.campaignId, filter.campaignId) : undefined,
        filter.statuses?.length ? inArray(letters.status, filter.statuses) : undefined,
        filter.ids ? inArray(letters.id, filter.ids) : undefined,
      ),
    )
    .orderBy(desc(letters.createdAt), asc(prospects.companyName))
    .limit(limit);
  return rows.map((row) => ({ ...row, openedAt: row.openedAt ? new Date(row.openedAt) : null }));
}

export interface PrintableLetter extends ComposedLetter {
  id: string;
  prospectId: string;
  companyName: string;
  qrModules: { size: number; path: string };
  problems: string[];
  senderLogo: string | null;
  duplex: boolean;
  teaser: PrintableTeaser | null;
}

/** The largest rendition up to 1600 px: sharp enough for print, small enough to embed. */
function teaserImage(manifest: AssetManifest, image: ExposeImage | null) {
  if (!image) return null;
  const resolved = resolveEntry(manifest[image.src], "/preview/assets", image.alt);
  if (!resolved) return null;
  return {
    src: printSource(resolved),
    alt: image.alt,
    width: resolved.width,
    height: resolved.height,
  };
}

function printableBeforeAfter(
  manifest: AssetManifest,
  beforeAfter: LetterTeaser["beforeAfter"],
): PrintableTeaser["beforeAfter"] {
  if (!beforeAfter) return null;
  const before = teaserImage(manifest, beforeAfter.before);
  const after = teaserImage(manifest, beforeAfter.after);
  return before && after ? { ...beforeAfter, before, after } : null;
}

/** Current published version of each exposé, keyed by exposé id. */
async function currentDocuments(tx: Transaction, workspaceId: string, exposeIds: string[]) {
  if (exposeIds.length === 0)
    return new Map<string, { document: ExposeDocument; manifest: AssetManifest }>();
  const rows = await tx
    .select({
      exposeId: exposes.id,
      document: exposeVersions.document,
      manifest: exposeVersions.assetManifest,
    })
    .from(exposes)
    .innerJoin(
      exposeVersions,
      and(
        eq(exposeVersions.workspaceId, exposes.workspaceId),
        eq(exposeVersions.id, exposes.currentVersionId),
      ),
    )
    .where(and(eq(exposes.workspaceId, workspaceId), inArray(exposes.id, exposeIds)));
  return new Map(
    rows.map((row) => [
      row.exposeId,
      { document: row.document as ExposeDocument, manifest: row.manifest },
    ]),
  );
}

/** Everything the browser needs to lay out the PDFs of these letters. */
export async function loadPrintableLetters(
  tx: Transaction,
  workspaceId: string,
  ids: string[],
  now = new Date(),
): Promise<PrintableLetter[]> {
  if (ids.length === 0) return [];
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const [workspace] = await tx
    .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace) return [];
  const origin = await workspacePublicOrigin(tx, workspace);
  const sender = senderFrom(settings, workspace.name);
  const rows = await tx
    .select({ letter: letters, prospect: prospects, touchpoint: touchpoints })
    .from(letters)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, letters.workspaceId), eq(prospects.id, letters.prospectId)),
    )
    .innerJoin(
      touchpoints,
      and(
        eq(touchpoints.workspaceId, letters.workspaceId),
        eq(touchpoints.id, letters.touchpointId),
      ),
    )
    .where(and(eq(letters.workspaceId, workspaceId), inArray(letters.id, ids)))
    .orderBy(asc(prospects.postalCode), asc(prospects.companyName));
  const people = await tx
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        inArray(
          contacts.prospectId,
          rows.map((row) => row.prospect.id),
        ),
      ),
    )
    .orderBy(desc(contacts.isPrimary), asc(contacts.createdAt));
  const signatureUrl = await brandPrintSource(tx, workspaceId, settings.letter.signatureAssetId);
  const senderLogo = await brandPrintSource(tx, workspaceId, settings.branding.logoAssetId);
  const documents = await currentDocuments(tx, workspaceId, [
    ...new Set(
      rows
        .filter((row) => row.letter.options.teaser !== false)
        .map((row) => row.touchpoint.exposeId),
    ),
  ]);
  const ownerPhoto =
    documents.size > 0
      ? await brandPrintSource(tx, workspaceId, settings.profile.photoAssetId)
      : null;

  return rows.map(({ letter, prospect, touchpoint }) => {
    const urls = touchpointUrls(origin, touchpoint);
    const contact = people.find((person) => person.prospectId === prospect.id) ?? null;
    const recipient = {
      companyName: prospect.companyName,
      street: prospect.street,
      postalCode: prospect.postalCode,
      city: prospect.city,
      country: prospect.country,
      contact,
    };
    const composed = composeLetter({
      sender,
      recipient,
      subject: letter.subject,
      body: letter.body,
      closing: settings.letter.closing,
      qrHint: settings.letter.qrHint,
      shortLink: urls.shortUrl?.replace(/^https?:\/\//, "") ?? null,
      qrUrl: urls.qrUrl,
      date: letter.postedAt ?? now,
      timeZone: settings.notifications.timezone,
      signatureUrl,
      privacy: {
        dataSource: settings.legal.dataSource ?? DEFAULT_DATA_SOURCE,
        privacyUrl: `${origin.replace(/^https?:\/\//, "")}/datenschutz`,
      },
    });
    const source = letter.options.teaser !== false ? documents.get(touchpoint.exposeId) : undefined;
    const teaser = source ? buildLetterTeaser(source.document) : null;
    return {
      ...composed,
      id: letter.id,
      prospectId: prospect.id,
      companyName: prospect.companyName,
      senderLogo,
      duplex: letter.options.duplex,
      teaser:
        source && teaser
          ? {
              ...teaser,
              image: teaserImage(source.manifest, teaser.image),
              logo: teaserImage(source.manifest, teaser.logo),
              beforeAfter: printableBeforeAfter(source.manifest, teaser.beforeAfter),
              qrLogo: null,
              ownerPhoto,
              contact:
                letter.options.contact !== false && (sender.phone || sender.email)
                  ? { phone: sender.phone, email: sender.email }
                  : null,
              qr: qrMatrix(urls.qrUrl, "H"),
            }
          : null,
      qrModules: modulesPath(urls.qrUrl),
      problems: [
        ...letterProblems({ sender, recipient }),
        ...composed.missing.map((name) => `Platzhalter {{${name}}} ist leer.`),
      ],
    };
  });
}

/** Owner photo, agency logo or signature as a cockpit URL; the browser converts it for the PDF. */

const STATUS_TIMESTAMP: Partial<Record<LetterStatus, keyof typeof letters.$inferInsert>> = {
  queued: "queuedAt",
  submitted: "submittedAt",
  printed: "printedAt",
  posted: "postedAt",
  returned: "returnedAt",
  failed: "failedAt",
  cancelled: "cancelledAt",
};

/**
 * Moves letters forward to `to`, passing every state in between, through
 * their dispatch provider (§7.9). With `manual`, „Als versendet markieren“
 * walks queued → submitted → printed → posted at the given date.
 */
export async function advanceLetters(
  tx: Transaction,
  actor: Actor,
  ids: string[],
  to: LetterStatus,
  at = new Date(),
): Promise<{ changed: number; refused: number }> {
  if (ids.length === 0) return { changed: 0, refused: 0 };
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const rows = await tx
    .select()
    .from(letters)
    .where(and(eq(letters.workspaceId, actor.workspaceId), inArray(letters.id, ids)))
    .for("update");
  let changed = 0;
  let refused = ids.length - rows.length;
  for (const letter of rows) {
    const path = pathTo(letter.status, to);
    const provider = await letterProvider(tx, actor.workspaceId, letter.provider);
    if (!path || path.length === 0 || !provider) {
      if (path?.length !== 0) refused += 1;
      continue;
    }
    // A provider that reports delivery itself is not overruled by hand.
    if (provider.tracksDelivery && ["printed", "posted"].includes(to)) {
      refused += 1;
      continue;
    }
    // A print API may refuse a cancellation (already printing); the letter then stays as it is.
    if (path.includes("cancelled") && letter.providerRef) {
      try {
        await provider.cancel(letter.providerRef);
      } catch (error) {
        console.error("letter cancel refused", letter.id, error);
        refused += 1;
        continue;
      }
    }
    const update: Partial<typeof letters.$inferInsert> = { status: to };
    for (const status of path) {
      const column = STATUS_TIMESTAMP[status];
      if (column) (update as Record<string, unknown>)[column] = at;
      if (status === "submitted") {
        const { providerRef } = await provider.send({
          letterId: letter.id,
          workspaceId: letter.workspaceId,
          pdfKey: null,
          options: letter.options,
          idempotencyKey: letter.id,
        });
        update.providerRef = providerRef;
      }
    }
    if (path.includes("posted")) {
      const estimate = await provider.estimateCost({ options: letter.options });
      update.costCents = estimate?.cents ?? settings.letter.costCents;
    }
    await tx
      .update(letters)
      .set(update)
      .where(and(eq(letters.workspaceId, actor.workspaceId), eq(letters.id, letter.id)));
    if (path.includes("posted")) {
      await advanceStatus(tx, {
        workspaceId: actor.workspaceId,
        prospectId: letter.prospectId,
        to: "letter_sent",
        via: "letter",
        meta: { letterId: letter.id },
      });
      await tx.insert(usageEvents).values({
        workspaceId: actor.workspaceId,
        kind: "letter",
        meta: { letterId: letter.id, provider: letter.provider },
      });
    }
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: `letter.${to}`,
      targetType: "letter",
      targetId: letter.id,
      meta: { from: letter.status, prospectId: letter.prospectId, kind: letter.kind },
    });
    changed += 1;
  }
  return { changed, refused };
}

/** Removes draft letters; anything further along is cancelled instead. */
export async function deleteDraftLetters(tx: Transaction, actor: Actor, ids: string[]) {
  if (ids.length === 0) return 0;
  const deleted = await tx
    .delete(letters)
    .where(
      and(
        eq(letters.workspaceId, actor.workspaceId),
        inArray(letters.id, ids),
        eq(letters.status, "draft"),
      ),
    )
    .returning({ id: letters.id, touchpointId: letters.touchpointId, kind: letters.kind });
  await deleteLetterPdfs(
    actor.workspaceId,
    deleted.map((row) => row.id),
  );
  // A follow-up's own code goes with it; the initial letter's code belongs to the exposé.
  const followUps = deleted.filter((row) => row.kind === "follow_up");
  if (followUps.length > 0) {
    await tx
      .update(touchpoints)
      .set({ disabledAt: new Date() })
      .where(
        and(
          eq(touchpoints.workspaceId, actor.workspaceId),
          inArray(
            touchpoints.id,
            followUps.map((row) => row.touchpointId),
          ),
          isNull(touchpoints.disabledAt),
        ),
      );
  }
  return deleted.length;
}

/** Where a letter's print-ready PDF is kept for a print API (§7.9). */
export const letterPdfKey = (workspaceId: string, letterId: string) =>
  `${workspaceId}/letters/${letterId}.pdf`;

export const MAX_LETTER_PDF_BYTES = 8 * 1024 * 1024;

/** The PDF is only needed until the print API has its own copy. */
export async function deleteLetterPdfs(workspaceId: string, letterIds: string[]) {
  const storage = getInfra().storage;
  for (const id of letterIds) {
    await storage.delete(letterPdfKey(workspaceId, id)).catch(() => undefined);
  }
}

/**
 * Stores the PDF the browser rendered for a draft letter, so a print API can
 * pick it up. Only drafts: what was printed must not change afterwards.
 */
export async function storeLetterPdf(
  tx: Transaction,
  actor: Actor,
  letterId: string,
  pdf: Uint8Array,
): Promise<boolean> {
  const isPdf = pdf.byteLength > 4 && new TextDecoder().decode(pdf.subarray(0, 5)) === "%PDF-";
  if (!isPdf || pdf.byteLength > MAX_LETTER_PDF_BYTES) return false;
  const [letter] = await tx
    .select({ id: letters.id })
    .from(letters)
    .where(
      and(
        eq(letters.workspaceId, actor.workspaceId),
        eq(letters.id, letterId),
        eq(letters.status, "draft"),
      ),
    );
  if (!letter) return false;
  await getInfra().storage.put(letterPdfKey(actor.workspaceId, letterId), pdf, {
    contentType: "application/pdf",
  });
  return true;
}

/** Pingen's live and test environment share one webhook URL (ADR-0063). */
export const PINGEN_PROVIDERS = ["pingen", "pingen-staging"];

/** A claimed letter older than this whose hand-over never finished may be handed over again. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Hands draft letters to the workspace's print API (§7.9); each needs its PDF
 * stored first. The calls to the provider run outside any transaction: a
 * letter is claimed (queued) and committed first, then sent, then recorded,
 * so a rollback can never forget a letter the provider already accepted.
 * A letter the provider refuses goes back to draft, with the reason. A claim
 * left behind by a crash is retried with the same idempotency key.
 */
export async function dispatchLetters(
  tenant: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>,
  actor: Actor,
  ids: string[],
  provider: LetterDispatchProvider,
  now = new Date(),
): Promise<{ sent: number; failed: { letterId: string; message: string }[] }> {
  let sent = 0;
  const failed: { letterId: string; message: string }[] = [];
  for (const id of [...new Set(ids)]) {
    const claimed = await tenant(async (tx) => {
      const [row] = await tx
        .update(letters)
        .set({ status: "queued", queuedAt: now, failureReason: null })
        .where(
          and(
            eq(letters.workspaceId, actor.workspaceId),
            eq(letters.id, id),
            or(
              eq(letters.status, "draft"),
              and(
                eq(letters.status, "queued"),
                isNull(letters.providerRef),
                lte(letters.queuedAt, new Date(now.getTime() - STALE_CLAIM_MS)),
              ),
            ),
          ),
        )
        .returning();
      return row ?? null;
    });
    if (!claimed) continue;
    let providerRef: string;
    try {
      ({ providerRef } = await provider.send({
        letterId: claimed.id,
        workspaceId: claimed.workspaceId,
        pdfKey: letterPdfKey(actor.workspaceId, claimed.id),
        options: claimed.options,
        idempotencyKey: claimed.id,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unbekannter Fehler.";
      await tenant((tx) =>
        tx
          .update(letters)
          .set({ status: "draft", queuedAt: null, failureReason: message })
          .where(and(eq(letters.workspaceId, actor.workspaceId), eq(letters.id, claimed.id))),
      );
      failed.push({ letterId: claimed.id, message });
      continue;
    }
    await tenant(async (tx) => {
      await tx
        .update(letters)
        .set({ status: "submitted", provider: provider.id, providerRef, submittedAt: now })
        .where(and(eq(letters.workspaceId, actor.workspaceId), eq(letters.id, claimed.id)));
      await tx.insert(auditLog).values({
        workspaceId: actor.workspaceId,
        actorUserId: actor.userId,
        action: "letter.submitted",
        targetType: "letter",
        targetId: claimed.id,
        meta: { provider: provider.id, prospectId: claimed.prospectId, kind: claimed.kind },
      });
    });
    await deleteLetterPdfs(actor.workspaceId, [claimed.id]);
    sent += 1;
  }
  return { sent, failed };
}

/**
 * Applies what a print API reports (webhook or status query) on the system
 * connection, scoped to the workspace. Walks every state in between, sets the
 * prospect to „Brief versendet“ on posting and keeps the provider's price.
 * Repeated or late reports change nothing; a reported problem on a letter
 * still on its way is kept as a note. A letter from Pingen's test environment
 * ends as cancelled once Pingen reports it printed or posted, because nothing
 * was printed: it must not start the clock, a follow-up or the costs.
 */
export async function recordProviderUpdates(
  db: Database,
  workspaceId: string,
  providers: string[],
  updates: LetterProviderUpdate[],
): Promise<number> {
  let changed = 0;
  for (const reported of updates) {
    changed += await db.transaction(async (tx) => {
      const [letter] = await tx
        .select()
        .from(letters)
        .where(
          and(
            eq(letters.workspaceId, workspaceId),
            inArray(letters.provider, providers),
            eq(letters.providerRef, reported.providerRef),
          ),
        )
        .for("update");
      if (!letter) return 0;
      const isTest = letter.provider.endsWith("-staging");
      const update =
        isTest && ["printed", "posted", "returned"].includes(reported.status)
          ? {
              ...reported,
              status: "cancelled" as const,
              costCents: null,
              reason: "Testversand: Pingen meldet ihn als verschickt, gedruckt wurde nichts.",
            }
          : reported;
      const path = pathTo(letter.status, update.status);
      if (!path) return 0;
      if (path.length === 0) {
        if (!update.reason || update.reason === letter.failureReason) return 0;
        await tx
          .update(letters)
          .set({ failureReason: update.reason })
          .where(and(eq(letters.workspaceId, workspaceId), eq(letters.id, letter.id)));
        return 1;
      }
      const set: Partial<typeof letters.$inferInsert> = { status: update.status };
      for (const status of path) {
        const column = STATUS_TIMESTAMP[status];
        if (column) (set as Record<string, unknown>)[column] = update.at;
      }
      if (update.costCents !== null) set.costCents = update.costCents;
      // A note on a problem is cleared once the letter moves on, unless it ends there.
      set.failureReason = ["failed", "cancelled"].includes(update.status) ? update.reason : null;
      await tx
        .update(letters)
        .set(set)
        .where(and(eq(letters.workspaceId, workspaceId), eq(letters.id, letter.id)));
      if (path.includes("posted")) {
        await advanceStatus(tx, {
          workspaceId,
          prospectId: letter.prospectId,
          to: "letter_sent",
          via: "letter",
          meta: { letterId: letter.id },
        });
        await tx.insert(usageEvents).values({
          workspaceId,
          kind: "letter",
          meta: { letterId: letter.id, provider: letter.provider },
        });
      }
      await tx.insert(auditLog).values({
        workspaceId,
        actorUserId: null,
        action: `letter.${update.status}`,
        targetType: "letter",
        targetId: letter.id,
        meta: { from: letter.status, prospectId: letter.prospectId, provider: letter.provider },
      });
      return 1;
    });
  }
  return changed;
}
