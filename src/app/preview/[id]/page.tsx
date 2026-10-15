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
 */
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const version = Number((await searchParams).version);
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
      nonce={nonce}
      links={{ optOut: null, imprint: null, privacy: null }}
    />
  );
}
