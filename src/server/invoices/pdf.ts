import "server-only";
import { serverEnv } from "@/config/env";
import type { Transaction } from "@/db";
import { brandPrintPng } from "../brand-images";
import { loadWorkspaceSettings } from "../workspaces";
import { printableInvoice } from "./printable";

export type ServerPdfResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "unavailable" | "logo" | "not_found" | "failed" };

/**
 * Renders an issued invoice's PDF (with Factur-X) on the server, for the
 * invoices the hourly job sends by itself (ADR-0073). Only the Node profile
 * can: the Worker bundle keeps react-pdf out (ADR-0035, ADR-0037), so on
 * Cloudflare this reports "unavailable" and the invoice waits for approval.
 */
export async function renderInvoicePdfOnServer(
  tx: Transaction,
  workspaceId: string,
  invoiceId: string,
): Promise<ServerPdfResult> {
  if (serverEnv().HOSTING_PROFILE !== "node") return { ok: false, reason: "unavailable" };
  const printable = await printableInvoice(tx, workspaceId, invoiceId);
  if (!printable) return { ok: false, reason: "not_found" };
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const assetId = settings.branding.logoAssetId;
  const logo = assetId ? await brandPrintPng(tx, workspaceId, assetId) : null;
  // A logo the server cannot read would silently drop from the PDF; let the owner look instead.
  if (assetId && !logo) return { ok: false, reason: "logo" };
  const renderer = await import("@/components/invoices/invoice-document");
  if (typeof renderer.invoicePdfBytes !== "function") return { ok: false, reason: "unavailable" };
  try {
    const bytes = await renderer.invoicePdfBytes({
      ...printable,
      brand: { ...printable.brand, logo },
    });
    return { ok: true, bytes };
  } catch (error) {
    console.error("invoice pdf", error);
    return { ok: false, reason: "failed" };
  }
}
