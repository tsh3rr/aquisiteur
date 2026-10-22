"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { offerDocumentSchema, type OfferDocument } from "@/domain/offers/schema";
import { publishExpose, PublishError } from "@/server/exposes/publish";
import {
  deleteOffer,
  duplicateOffer,
  saveOfferDraft,
  sendOffer,
  withdrawOffer,
} from "@/server/offers/manage";
import { exposesWithOfferPricing } from "@/server/offers/pricing";
import { requireCockpit } from "@/server/session";

/** Cockpit side of offers (§7.10). */

export interface OfferActionResult {
  ok: boolean;
  message: string;
  /** Field problems by path, e.g. "items.0.title". */
  issues?: { path: string; message: string }[];
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

const id = z.uuid();

function revalidateOffer(offerId: string) {
  revalidatePath(`/angebote/${offerId}`);
  revalidatePath("/angebote");
}

function parseDraft(draft: unknown): { draft: OfferDocument } | { result: OfferActionResult } {
  const parsed = offerDocumentSchema.safeParse(draft);
  if (parsed.success) return { draft: parsed.data };
  return {
    result: {
      ok: false,
      message: "Bitte prüfen Sie die markierten Angaben.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
  };
}

export async function saveOfferDraftAction(
  offerId: string,
  draft: unknown,
): Promise<OfferActionResult> {
  const { actor, tenant } = await manager();
  const parsedId = id.safeParse(offerId);
  if (!parsedId.success) return { ok: false, message: "Angebot nicht gefunden." };
  const parsed = parseDraft(draft);
  if ("result" in parsed) return parsed.result;
  const saved = await tenant((tx) => saveOfferDraft(tx, actor, parsedId.data, parsed.draft));
  if (!saved.ok) {
    return {
      ok: false,
      message:
        saved.error === "locked"
          ? "Dieses Angebot ist abgeschlossen und lässt sich nicht mehr ändern."
          : "Angebot nicht gefunden.",
    };
  }
  revalidateOffer(parsedId.data);
  return { ok: true, message: "Entwurf gespeichert." };
}

/** Saves the draft and sends it as a new version. */
export async function sendOfferAction(offerId: string, draft: unknown): Promise<OfferActionResult> {
  const saved = await saveOfferDraftAction(offerId, draft);
  if (!saved.ok) return saved;
  const { actor, tenant } = await manager();
  const sent = await tenant((tx) => sendOffer(tx, actor, offerId));
  if (!sent.ok) {
    return {
      ok: false,
      message:
        sent.error === "invalid"
          ? (sent.issues ?? []).join(" ")
          : sent.error === "locked"
            ? "Dieses Angebot ist abgeschlossen."
            : "Angebot nicht gefunden.",
    };
  }
  revalidateOffer(offerId);
  return {
    ok: true,
    message:
      sent.version === 1
        ? `Angebot ${sent.number} ist bereit. Schicken Sie dem Kunden den Link.`
        : `Version ${sent.version} von ${sent.number} ist jetzt online, unter demselben Link.`,
  };
}

export async function withdrawOfferAction(offerId: string): Promise<OfferActionResult> {
  const { actor, tenant } = await manager();
  const done = await tenant((tx) => withdrawOffer(tx, actor, id.parse(offerId)));
  revalidateOffer(offerId);
  return done
    ? { ok: true, message: "Angebot zurückgezogen. Die Seite nimmt keine Annahme mehr an." }
    : { ok: false, message: "Nur versendete Angebote lassen sich zurückziehen." };
}

export async function deleteOfferAction(formData: FormData) {
  const { actor, tenant } = await manager();
  const offerId = id.parse(formData.get("id"));
  const deleted = await tenant((tx) => deleteOffer(tx, actor, offerId));
  if (!deleted) redirect(`/angebote/${offerId}`);
  revalidatePath(`/projekte/${deleted.projectId}`);
  redirect(`/projekte/${deleted.projectId}`);
}

export async function duplicateOfferAction(formData: FormData) {
  const { actor, tenant } = await manager();
  const copy = await tenant((tx) => duplicateOffer(tx, actor, id.parse(formData.get("id"))));
  if (!copy) redirect("/angebote");
  redirect(`/angebote/${copy}`);
}

/** „Ins Exposé übernehmen“: a new version of every exposé in the project with the offer's prices. */
export async function pushOfferToExposeAction(offerId: string): Promise<OfferActionResult> {
  const { actor, user, workspace, tenant } = await manager();
  try {
    const published = await tenant(async (tx) => {
      const documents = await exposesWithOfferPricing(tx, workspace.id, id.parse(offerId));
      for (const entry of documents) {
        await publishExpose(
          tx,
          { workspaceId: actor.workspaceId, userId: user.id, source: "cockpit" },
          { document: entry.document, assets: entry.assets },
        );
      }
      return documents.length;
    });
    if (published === 0) {
      return {
        ok: false,
        message: "Das Projekt hat noch kein Exposé, oder das Angebot hat keine Position.",
      };
    }
    revalidatePath("/exposes");
    return {
      ok: true,
      message:
        published === 1
          ? "Preise ins Exposé übernommen (neue Version)."
          : `Preise in ${published} Exposés übernommen.`,
    };
  } catch (error) {
    if (error instanceof PublishError) {
      return { ok: false, message: `Exposé nicht veröffentlicht: ${error.message}` };
    }
    throw error;
  }
}
