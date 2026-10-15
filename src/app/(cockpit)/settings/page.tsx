import { eq } from "drizzle-orm";
import { Globe } from "lucide-react";
import type { Metadata } from "next";
import { serverEnv } from "@/config/env";
import { domains } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import { entitlements } from "@/domain/entitlements";
import { requireCockpit } from "@/server/session";
import { PasskeyManager } from "./passkey-manager";

export const metadata: Metadata = { title: "Einstellungen" };

const statusLabel = { pending: "Einrichtung offen", active: "Aktiv", failed: "Fehlgeschlagen" } as const;
const statusTone = { pending: "warning", active: "success", failed: "danger" } as const;

export default async function SettingsPage() {
  const { workspace, actor, tenant } = await requireCockpit();
  const customDomains = await tenant((tx) =>
    tx
      .select({ hostname: domains.hostname, status: domains.status })
      .from(domains)
      .where(eq(domains.workspaceId, workspace.id)),
  );
  const plan = entitlements({ id: workspace.id });
  const platformHost = `${workspace.slug}.${serverEnv().PLATFORM_DOMAIN}`;

  return (
    <div className="grid gap-8">
      <PageHeader title="Einstellungen" description="Workspace, Anmeldung und Domains." />

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            Ihre Rolle: {workspace.role === "owner" ? "Inhaber" : workspace.role} · Tarif:{" "}
            {plan.plan === "unlimited" ? "unbegrenzt" : plan.plan}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <dt className="text-sm text-foreground-muted">Name</dt>
            <dd className="font-medium">{workspace.name}</dd>
            <dt className="text-sm text-foreground-muted">Plattform-Adresse</dt>
            <dd className="font-mono text-sm">{platformHost}</dd>
            <dt className="text-sm text-foreground-muted">Eigene Domains</dt>
            <dd>
              {customDomains.length === 0 ? (
                <span className="text-sm text-foreground-muted">Keine</span>
              ) : (
                <ul className="grid gap-2">
                  {customDomains.map((domain) => (
                    <li key={domain.hostname} className="flex flex-wrap items-center gap-2">
                      <Globe aria-hidden className="size-4 text-foreground-muted" />
                      <span className="font-mono text-sm">{domain.hostname}</span>
                      <Badge tone={statusTone[domain.status]}>{statusLabel[domain.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>
            Melden Sie sich per Fingerabdruck, Gesicht oder Geräte-PIN an. Legen Sie am besten auf Handy und Rechner
            je einen an.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasskeyManager canManage={can(actor, "workspace.read", { workspaceId: workspace.id })} />
        </CardContent>
      </Card>
    </div>
  );
}
