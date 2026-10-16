import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/expose/legal-page";
import { getDb } from "@/db";
import { imprintMarkdown } from "@/domain/legal";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { workspaceForHostParam } from "@/server/sites";

export const metadata: Metadata = { title: { absolute: "Impressum" } };

export default async function ImprintPage({ params }: { params: Promise<{ host: string }> }) {
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) notFound();
  const settings = await loadWorkspaceSettings(getDb(), workspace.id);
  return <LegalPage title="Impressum" markdown={imprintMarkdown(settings, workspace.name)} />;
}
