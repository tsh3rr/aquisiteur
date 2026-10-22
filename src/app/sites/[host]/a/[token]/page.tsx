import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { exposeThemeCss } from "@/domain/expose/theme";
import { localDateString } from "@/domain/tasks";
import { detectBot } from "@/domain/tracking/user-agent";
import { loadPublicOffer, recordOfferView } from "@/server/offers/public";
import { workspaceForHostParam } from "@/server/sites";
import { ownerDeviceFor } from "@/server/tracking/http";
import { OfferView } from "./offer-view";

type Params = Promise<{ host: string; token: string }>;

const load = cache(async (host: string, token: string) => {
  const workspace = await workspaceForHostParam(host);
  if (!workspace) return null;
  const offer = await loadPublicOffer(getDb(), workspace.id, token);
  return offer ? { workspace, offer } : null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { host, token } = await params;
  const data = await load(host, token);
  if (!data) return {};
  return {
    title: { absolute: `Angebot ${data.offer.number}: ${data.offer.document.title}` },
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

/** „DD.MM.YYYY“ from an ISO date, without Intl (ADR-0048). */
function germanDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

/**
 * The customer's offer page `/a/<token>` (§7.10): options, live totals,
 * payment plan and online acceptance. Rendered per request on the system
 * connection, scoped to the host's workspace (ADR-0012).
 */
export default async function PublicOfferPage({ params }: { params: Params }) {
  const { host, token } = await params;
  const data = await load(host, token);
  if (!data) notFound();
  const { offer, workspace } = data;
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  await recordOfferView(getDb(), {
    workspaceId: workspace.id,
    offerId: offer.id,
    quiet: detectBot(requestHeaders) !== null || (await ownerDeviceFor(workspace.id)),
  });

  const { settings } = offer;
  const timezone = settings.notifications.timezone;
  const sender = settings.senderAddress;
  const owner = settings.profile.displayName ?? sender.company ?? offer.workspaceName;
  const accent = offer.theme?.accent ?? settings.branding.accentColor;

  return (
    <div
      data-expose-theme
      data-expose-style={offer.theme?.style ?? "classic"}
      lang="de"
      className="min-h-dvh bg-background text-foreground"
    >
      <style nonce={nonce}>
        {exposeThemeCss({
          accent,
          appearance: offer.theme?.appearance ?? "auto",
          style: offer.theme?.style,
        })}
      </style>
      <main id="main" className="mx-auto grid max-w-3xl gap-10 px-5 py-12 sm:px-8 sm:py-16">
        <header className="grid gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4 text-sm text-foreground-muted">
            <address className="not-italic">
              <span className="font-medium text-foreground">{owner}</span>
              {sender.street ? <br /> : null}
              {sender.street}
              {sender.postalCode || sender.city ? <br /> : null}
              {[sender.postalCode, sender.city].filter(Boolean).join(" ")}
              {settings.billing.vatId ? (
                <>
                  <br />
                  UID: {settings.billing.vatId}
                </>
              ) : null}
            </address>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right">
              <dt>Angebot</dt>
              <dd className="font-medium text-foreground tabular-nums">{offer.number}</dd>
              <dt>Datum</dt>
              <dd className="tabular-nums">
                {germanDate(localDateString(offer.version.createdAt, timezone))}
              </dd>
              <dt>Gültig bis</dt>
              <dd className="tabular-nums">{germanDate(offer.version.validUntil)}</dd>
              {offer.version.number > 1 ? (
                <>
                  <dt>Fassung</dt>
                  <dd className="tabular-nums">{offer.version.number}</dd>
                </>
              ) : null}
            </dl>
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium text-accent">
              Für {offer.company} · {offer.projectName}
            </p>
            <h1 className="font-display text-3xl font-semibold text-balance sm:text-4xl">
              {offer.document.title}
            </h1>
          </div>
          {offer.document.intro ? (
            <p className="max-w-prose text-lg whitespace-pre-line text-foreground-muted">
              {offer.document.intro}
            </p>
          ) : null}
        </header>

        <OfferView
          token={token}
          status={offer.status}
          versionId={offer.version.id}
          document={offer.document}
          taxMode={offer.taxMode}
          taxNote={offer.taxNote}
          owner={owner}
          validUntil={germanDate(offer.version.validUntil)}
          acceptance={
            offer.acceptance
              ? {
                  name: offer.acceptance.name,
                  acceptedAt: germanDate(
                    localDateString(new Date(offer.acceptance.acceptedAt), timezone),
                  ),
                  variantId: offer.acceptance.variantId,
                  optionalIds: offer.acceptance.optionalIds,
                }
              : null
          }
        />

        {offer.document.outro ? (
          <p className="max-w-prose whitespace-pre-line text-foreground-muted">
            {offer.document.outro}
          </p>
        ) : null}

        <footer className="grid gap-2 border-t border-border pt-6 text-sm text-foreground-muted">
          <p>
            {owner}
            {settings.channels.email ? (
              <>
                {" · "}
                <a
                  href={`mailto:${settings.channels.email}`}
                  className="underline underline-offset-4"
                >
                  {settings.channels.email}
                </a>
              </>
            ) : null}
            {settings.channels.phone ? (
              <>
                {" · "}
                <a
                  href={`tel:${settings.channels.phone.replace(/\s/g, "")}`}
                  className="underline underline-offset-4"
                >
                  {settings.channels.phone}
                </a>
              </>
            ) : null}
          </p>
          <p className="flex flex-wrap gap-x-4">
            <a
              href="/impressum"
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              Impressum
            </a>
            <a
              href="/datenschutz"
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              Datenschutz
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
