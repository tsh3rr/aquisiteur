import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ExposeView } from "@/components/expose/expose-view";
import { loadExposeVersionForPreview } from "@/server/exposes/load";
import { requireCockpit } from "@/server/session";

export const metadata: Metadata = { title: "Vorschau", robots: { index: false, follow: false } };

/**
 * Cockpit preview of any version, embedded in the exposé detail page. Same
 * renderer as the public page, no tracking, assets served via the session.
 * `?variant=expired` shows the short page an expired exposé turns into.
 */
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; variant?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const version = Number(query.version);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { workspace, tenant } = await requireCockpit();
  const data = await tenant((tx) =>
    loadExposeVersionForPreview(
      tx,
      workspace.id,
      id,
      Number.isInteger(version) ? version : undefined,
    ),
  );
  if (!data) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <ExposeView
      data={data}
      mode="preview"
      variant={query.variant === "expired" ? "expired" : "full"}
      nonce={nonce}
      links={{ optOut: null, imprint: null, privacy: null }}
    />
  );
}
