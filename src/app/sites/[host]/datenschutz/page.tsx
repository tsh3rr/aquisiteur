import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/expose/legal-page";
import { serverEnv } from "@/config/env";
import { getDb } from "@/db";
import { privacyMarkdown } from "@/domain/legal";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { workspaceForHostParam } from "@/server/sites";

export const metadata: Metadata = { title: { absolute: "Datenschutz" } };

export default async function PrivacyPage({ params }: { params: Promise<{ host: string }> }) {
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) notFound();
  const settings = await loadWorkspaceSettings(getDb(), workspace.id);
  return (
    <LegalPage
      title="Datenschutz"
      markdown={privacyMarkdown(settings, workspace.name, serverEnv().HOSTING_PROFILE)}
    />
  );
}
