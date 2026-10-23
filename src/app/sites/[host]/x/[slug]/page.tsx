import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ExposeView } from "@/components/expose/expose-view";
import { getDb } from "@/db";
import { loadPublicExpose } from "@/server/exposes/load";
import { workspaceForHostParam } from "@/server/sites";

type Params = Promise<{ host: string; slug: string }>;

const load = cache(async (host: string, slug: string) => {
  const workspace = await workspaceForHostParam(host);
  if (!workspace) return null;
  return loadPublicExpose(getDb(), workspace.id, slug);
});

/**
 * Edge-to-edge on phones so env(safe-area-inset-*) is real: the contact bar,
 * chat button and chat sheet keep clear of the rounded corners and the home
 * indicator instead of iOS reporting 0.
 */
export const viewport: Viewport = { viewportFit: "cover" };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host, slug } = await params;
  const data = await load(host, slug);
  if (!data) return {};
  return {
    title: { absolute: data.document.meta.title },
    description: data.document.meta.description,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

/** Public exposé (§6.1 `<domain>/x/<slug>`). Rendered per request; see ADR-0012. */
export default async function PublicExposePage({ params }: { params: Params }) {
  const { host, slug } = await params;
  const data = await load(host, slug);
  if (!data) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <ExposeView
      data={data}
      mode="public"
      variant={data.expiry.expired ? "expired" : "full"}
      nonce={nonce}
      links={{
        optOut: `/x/${slug}/kein-interesse`,
        imprint: "/impressum",
        privacy: "/datenschutz",
      }}
    />
  );
}
