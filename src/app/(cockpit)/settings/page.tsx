import { desc, eq } from "drizzle-orm";
import { Globe } from "lucide-react";
import type { Metadata } from "next";
import { serverEnv } from "@/config/env";
import { apiTokens, domains, workspaces } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import { entitlements } from "@/domain/entitlements";
import { BrandImageField } from "@/components/cockpit/brand-image-field";
import { loadBrandImages } from "@/server/brand-images";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { requireCockpit } from "@/server/session";
import { signOwnerLink } from "@/server/tracking/visits";
import { resolveWeights } from "@/domain/intent/score";
import { imprintMarkdown, privacyMarkdown } from "@/domain/legal";
import { getDb } from "@/db";
import { getInfra } from "@/infra";
import { listPushDevices, listRules } from "@/server/notifications/manage";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { loadPingenSettings } from "@/server/letters/providers";
import { ApiTokens } from "./api-tokens";
import { ContactSettingsForm } from "./contact-settings";
import { RetentionForm, WorkspaceDataActions } from "./data-settings";
import { LegalSettingsForm } from "./legal-settings";
import { LetterSettingsForm } from "./letter-settings";
import { PrintServiceForm } from "./print-service-settings";
import { NotificationRules } from "./notification-rules";
import { PasskeyManager } from "./passkey-manager";
import { PushDevices } from "./push-device";
import { ReplaySettingsForm } from "./replay-settings";
import { ScoreSettingsForm } from "./score-settings";
import { PlatformUsageList, WorkspaceUsageList } from "./system-usage";
import { isPlatformAdmin, platformUsage, workspaceUsage } from "@/server/system-usage";

export const metadata: Metadata = { title: "Einstellungen" };

const statusLabel = {
  pending: "Einrichtung offen",
  active: "Aktiv",
  failed: "Fehlgeschlagen",
} as const;
const statusTone = { pending: "warning", active: "success", failed: "danger" } as const;

export default async function SettingsPage() {
  const { workspace, actor, user, tenant } = await requireCockpit();
  const customDomains = await tenant((tx) =>
    tx
      .select({ hostname: domains.hostname, status: domains.status })
      .from(domains)
      .where(eq(domains.workspaceId, workspace.id)),
  );
  const canEditSettings = can(actor, "settings.update", { workspaceId: workspace.id });
  const settings = await tenant((tx) => loadWorkspaceSettings(tx, workspace.id));
  const brandImages = await tenant((tx) => loadBrandImages(tx, workspace.id, settings));
  const pingen = await tenant((tx) => loadPingenSettings(tx, workspace.id));
  const canManageIntegrations = can(actor, "integrations.manage", { workspaceId: workspace.id });
  const [rules, devices] = await tenant((tx) =>
    Promise.all([listRules(tx, workspace.id), listPushDevices(tx, workspace.id, user.id)]),
  );
  const canManageTokens = can(actor, "apiTokens.manage", { workspaceId: workspace.id });
  const tokens = canManageTokens
    ? await tenant((tx) =>
        tx
          .select({
            id: apiTokens.id,
            name: apiTokens.name,
            prefix: apiTokens.prefix,
            createdAt: apiTokens.createdAt,
            lastUsedAt: apiTokens.lastUsedAt,
            expiresAt: apiTokens.expiresAt,
            revokedAt: apiTokens.revokedAt,
          })
          .from(apiTokens)
          .where(eq(apiTokens.workspaceId, workspace.id))
          .orderBy(desc(apiTokens.createdAt)),
      )
    : [];
  const publicOrigin = await tenant(async (tx) => {
    const [ws] = await tx
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    return workspacePublicOrigin(tx, ws!);
  });
  const ownerLink = `${publicOrigin}/owner-device?token=${encodeURIComponent(await signOwnerLink(workspace.id))}`;
  const plan = entitlements({ id: workspace.id });
  const platformHost = `${workspace.slug}.${serverEnv().PLATFORM_DOMAIN}`;
  const usage = await tenant((tx) => workspaceUsage(tx, workspace.id));
  const platform = (await isPlatformAdmin(getDb(), user)) ? await platformUsage(getDb()) : null;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Einstellungen"
        description="Workspace, Kontaktwege, Benachrichtigungen, Anmeldung, Domains und API-Zugang."
      />

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
          <CardTitle>Foto und Logo</CardTitle>
          <CardDescription>
            Ihr Foto erscheint in jedem Exposé neben Ihrer persönlichen Nachricht. Das Logo nutzen
            später Briefe und Ihre Workspace-Seiten.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <BrandImageField
            kind="photo"
            label="Profilfoto"
            hint="Quadratisch zugeschnitten. JPG, PNG oder WebP."
            current={brandImages.photo}
            canEdit={canEditSettings}
          />
          <BrandImageField
            kind="logo"
            label="Logo"
            hint="Am besten SVG oder PNG mit transparentem Hintergrund."
            current={brandImages.logo}
            canEdit={canEditSettings}
          />
        </CardContent>
      </Card>

      <Card id="kontakt">
        <CardHeader>
          <CardTitle>Kontakt und Chat</CardTitle>
          <CardDescription>
            Wie Interessenten Sie aus dem Exposé erreichen, und wann das Exposé dazu einlädt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContactSettingsForm
            channels={settings.channels}
            chat={settings.chat}
            nudges={settings.nudges}
            canEdit={canEditSettings}
          />
        </CardContent>
      </Card>

      <Card id="briefe">
        <CardHeader>
          <CardTitle>Briefe</CardTitle>
          <CardDescription>
            Absender, Standardtexte, Folgebriefe, Unterschrift und wer die Briefe druckt.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8">
          <LetterSettingsForm
            sender={settings.senderAddress}
            letter={settings.letter}
            canEdit={canEditSettings}
          />
          <BrandImageField
            kind="signature"
            label="Unterschrift"
            hint="Ein Foto oder Scan Ihrer Unterschrift, am besten auf weißem Papier. Wird als PNG gespeichert."
            current={brandImages.signature}
            canEdit={canEditSettings}
          />
          <PrintServiceForm
            pingen={pingen}
            webhookUrl={`${serverEnv().APP_URL.replace(/\/$/, "")}/api/webhooks/pingen/${workspace.id}`}
            canEdit={canManageIntegrations}
          />
        </CardContent>
      </Card>

      <Card id="benachrichtigungen">
        <CardHeader>
          <CardTitle>Benachrichtigungen</CardTitle>
          <CardDescription>
            Wann Sie per Push oder E-Mail erfahren, dass sich ein Kunde rührt. Alles landet
            zusätzlich unter Benachrichtigungen im Cockpit.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8">
          <section aria-labelledby="push-heading" className="grid gap-3">
            <h3 id="push-heading" className="text-base font-semibold">
              Push auf Ihren Geräten
            </h3>
            <PushDevices
              publicKey={getInfra().push.publicKey}
              devices={devices.map((device) => ({
                id: device.id,
                endpoint: device.endpoint,
                label: device.label,
                lastSuccessAt: device.lastSuccessAt?.toISOString() ?? null,
              }))}
            />
          </section>
          <section aria-labelledby="rules-heading" className="grid gap-3">
            <h3 id="rules-heading" className="text-base font-semibold">
              Regeln
            </h3>
            <NotificationRules rules={rules} canEdit={canEditSettings} />
          </section>
        </CardContent>
      </Card>

      <Card id="kontaktabsicht">
        <CardHeader>
          <CardTitle>Kontaktabsicht</CardTitle>
          <CardDescription>
            Der Score schätzt, wie wahrscheinlich ein Kunde Sie gerade kontaktieren will. Er beruht
            nur auf Signalen aus dem Exposé, nie auf Daten über die Person.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScoreSettingsForm
            weights={resolveWeights(settings.scoreWeights)}
            timezone={settings.notifications.timezone}
            canEdit={canEditSettings}
          />
        </CardContent>
      </Card>

      <Card id="aufzeichnung">
        <CardHeader>
          <CardTitle>Sitzungsaufzeichnung</CardTitle>
          <CardDescription>
            Sehen Sie sich an, wie ein Kunde Ihr Exposé gelesen hat: Scrollen, Klicks, Pausen. Nur
            mit seiner ausdrücklichen Erlaubnis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReplaySettingsForm
            enabled={settings.replay.enabled}
            retentionDays={settings.retention.replaysDays}
            canEdit={canEditSettings}
          />
        </CardContent>
      </Card>

      <Card id="daten">
        <CardHeader>
          <CardTitle>Daten und Aufbewahrung</CardTitle>
          <CardDescription>
            Ein stündlicher Lauf löscht alte Daten automatisch. Besuche selbst bleiben als Zählung
            für die Auswertung; sie enthalten keine IP-Adressen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8">
          <RetentionForm retention={settings.retention} canEdit={canEditSettings} />
          {can(actor, "workspace.export", { workspaceId: workspace.id }) ? (
            <WorkspaceDataActions slug={workspace.slug} />
          ) : null}
        </CardContent>
      </Card>

      <Card id="rechtliches">
        <CardHeader>
          <CardTitle>Impressum und Datenschutz</CardTitle>
          <CardDescription>
            Diese Seiten verlinkt jedes Exposé im Fußbereich. Keine Rechtsberatung: lassen Sie die
            Texte vor dem ersten Brief prüfen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LegalSettingsForm
            legal={settings.legal}
            generated={{
              imprint: imprintMarkdown(
                { ...settings, legal: { ...settings.legal, imprintMarkdown: undefined } },
                workspace.name,
              ),
              privacy: privacyMarkdown(
                { ...settings, legal: { ...settings.legal, privacyMarkdown: undefined } },
                workspace.name,
                serverEnv().HOSTING_PROFILE,
                pingen.enabled ? "pingen" : null,
              ),
            }}
            publicOrigin={publicOrigin}
            canEdit={canEditSettings}
          />
        </CardContent>
      </Card>

      <Card id="system">
        <CardHeader>
          <CardTitle>System und Limits</CardTitle>
          <CardDescription>
            Verbrauch im Verhältnis zu den Limits Ihres Tarifs. Ab 80 % erscheint eine Warnung.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8">
          <WorkspaceUsageList usage={usage} />
          {platform ? <PlatformUsageList usage={platform} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>
            Melden Sie sich per Fingerabdruck, Gesicht oder Geräte-PIN an. Legen Sie am besten auf
            Handy und Rechner je einen an.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasskeyManager canManage={can(actor, "workspace.read", { workspaceId: workspace.id })} />
        </CardContent>
      </Card>

      <Card id="eigene-besuche">
        <CardHeader>
          <CardTitle>Eigene Besuche</CardTitle>
          <CardDescription>
            Damit Ihre eigenen Aufrufe von Exposés nicht als Kundenbesuche zählen, markieren Sie
            jedes Gerät, mit dem Sie Exposés ansehen. Dafür setzt die Exposé-Domain auf diesem Gerät
            ein Cookie, nur für Sie, nie für Interessenten.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <a
            href={ownerLink}
            className="inline-flex h-11 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Dieses Gerät als meines markieren
          </a>
          <a
            href={`${publicOrigin}/owner-device?entfernen=1`}
            className="inline-flex h-11 items-center px-2 text-sm text-accent underline-offset-4 hover:underline"
          >
            Markierung entfernen
          </a>
        </CardContent>
      </Card>

      {canManageTokens ? (
        <Card id="api-tokens">
          <CardHeader>
            <CardTitle>API-Tokens</CardTitle>
            <CardDescription>
              Für <code className="font-mono">pnpm expose:publish</code> und die REST-API. Ein Token
              handelt mit Ihren Rechten in diesem Workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApiTokens
              apiUrl={serverEnv().APP_URL}
              tokens={tokens.map((row) => ({
                ...row,
                createdAt: row.createdAt.toISOString(),
                lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
                expiresAt: row.expiresAt?.toISOString() ?? null,
                revokedAt: row.revokedAt?.toISOString() ?? null,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
