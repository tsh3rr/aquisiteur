import { eq } from "drizzle-orm";
import { ArrowLeft, Ban, Download, ExternalLink, Globe, Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IntentSummary } from "@/components/cockpit/intent";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/ui/misc";
import { workspaces } from "@/db/schema";
import { can } from "@/domain/authz";
import { STATUS_LABELS, STATUS_TONES } from "@/domain/prospects/status";
import { formatDuration } from "@/domain/tracking/timeline";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { SIGNAL_LABELS } from "@/domain/intent/score";
import { listCampaigns } from "@/server/campaigns";
import { loadIntent } from "@/server/intent/list";
import { listLetters } from "@/server/letters/manage";
import { loadProspectDetail } from "@/server/prospects/detail";
import { formatRelative } from "@/lib/relative-time";
import { CallbackList } from "../../chat/callbacks";
import { LiveRefresh } from "../../chat/live-refresh";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { touchpointUrls } from "@/server/tracking/touchpoints";
import { signOwnerLink } from "@/server/tracking/visits";
import { deleteProspectAction, setDoNotContactAction, updateProspectAction } from "../actions";
import { ProspectForm } from "../prospect-form";
import { Contacts } from "./contacts";
import { ProspectLetters } from "./letters";
import { StatusSelect } from "./status-select";
import { SectionHeatList } from "./section-heat";
import { Timeline } from "./timeline";
import { Touchpoints } from "./touchpoints";

type Params = Promise<{ id: string }>;
type Search = Promise<{ bots?: string }>;

export const metadata: Metadata = { title: "Kunde" };

const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});
const day = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "Europe/Berlin" });
const DEVICE = {
  mobile: "Smartphone",
  tablet: "Tablet",
  desktop: "Computer",
  unknown: "Unbekannt",
};
const SOURCE = { qr: "QR-Code", typed: "Kurzlink", direct: "Direkt", share: "Weitergeleitet" };

const action =
  "inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const showBots = (await searchParams).bots === "1";
  const { workspace, actor, tenant } = await requireCockpit();
  const loaded = await tenant(async (tx) => {
    const detail = await loadProspectDetail(tx, workspace.id, id, { showBots });
    const [ws] = await tx
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    if (!detail || !ws) return null;
    return {
      detail,
      origin: await workspacePublicOrigin(tx, ws),
      intent: await loadIntent(tx, workspace.id, id),
      campaigns: await listCampaigns(tx, workspace.id),
      letters: await listLetters(tx, workspace.id, { prospectId: id }, 20),
      settings: await loadWorkspaceSettings(tx, workspace.id),
    };
  });
  if (!loaded) notFound();
  const { detail, origin, intent, campaigns, letters, settings } = loaded;
  const optOutDays = settings.retention.optOutTrackingDays;
  const { prospect } = detail;
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const ownerLink = `${origin}/owner-device?token=${encodeURIComponent(await signOwnerLink(workspace.id))}`;
  const realVisits = detail.visits.filter((v) => !v.isBot && !v.isInternal && v.confirmedAt);

  return (
    <div className="grid gap-6">
      <LiveRefresh
        events={["chat.message", "callback.created", "chat.thread", "intent.updated"]}
        prospectId={prospect.id}
      />
      <Link
        href="/kunden"
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Alle Kunden
      </Link>

      <header className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{prospect.companyName}</h1>
          <Badge tone={STATUS_TONES[prospect.status]}>{STATUS_LABELS[prospect.status]}</Badge>
          {prospect.doNotContactAt ? <Badge tone="danger">Nicht mehr kontaktieren</Badge> : null}
        </div>
        <p className="text-foreground-muted">
          {[prospect.industry, [prospect.postalCode, prospect.city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(" · ") || "Noch keine Stammdaten"}
          {" · "}
          {realVisits.length} {realVisits.length === 1 ? "Besuch" : "Besuche"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {prospect.phone ? (
            <a href={`tel:${prospect.phone.replace(/\s/g, "")}`} className={action}>
              <Phone aria-hidden className="size-4" />
              Anrufen
            </a>
          ) : null}
          {prospect.email ? (
            <a href={`mailto:${prospect.email}`} className={action}>
              <Mail aria-hidden className="size-4" />
              E-Mail
            </a>
          ) : null}
          {prospect.website ? (
            <a href={prospect.website} target="_blank" rel="noopener noreferrer" className={action}>
              <Globe aria-hidden className="size-4" />
              Website<span className="sr-only"> (neuer Tab)</span>
            </a>
          ) : null}
          {detail.expose ? (
            <Link href={`/exposes/${detail.expose.id}`} className={action}>
              <ExternalLink aria-hidden className="size-4" />
              Exposé
            </Link>
          ) : null}
          {canManage ? <StatusSelect id={prospect.id} status={prospect.status} /> : null}
        </div>
      </header>

      {intent && intent.score > 0 ? (
        <Card aria-labelledby="intent-heading">
          <CardHeader>
            <CardTitle id="intent-heading">Kontaktabsicht</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <IntentSummary
              score={intent.score}
              level={intent.level}
              explanation={intent.explanation}
            />
            {intent.signals.length > 0 ? (
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2.5 text-foreground-muted">
                  Woraus sich der Score ergibt
                </summary>
                <ul className="grid gap-1 pt-1">
                  {intent.signals.map((signal) => (
                    <li key={`${signal.id}-${signal.at}`} className="flex flex-wrap gap-x-2">
                      <span className="font-medium tabular-nums">
                        {Math.round(signal.p * 100)} %
                      </span>
                      <span>{SIGNAL_LABELS[signal.id]}</span>
                      <span className="text-foreground-muted">
                        · {dateTime.format(new Date(signal.at))}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <div className="grid min-w-0 grid-cols-1 gap-6 xl:col-span-3 [&>*]:min-w-0">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Timeline</CardTitle>
              {detail.botCount > 0 ? (
                <Link
                  href={showBots ? `/kunden/${id}` : `/kunden/${id}?bots=1`}
                  className="inline-flex min-h-11 items-center text-sm text-accent underline-offset-4 hover:underline"
                >
                  {showBots
                    ? "Bots und Link-Vorschauen ausblenden"
                    : `${detail.botCount} ${detail.botCount === 1 ? "Bot" : "Bots"} und Link-Vorschauen anzeigen`}
                </Link>
              ) : null}
            </CardHeader>
            <CardContent>
              <Timeline entries={detail.timeline} prospectId={id} replays={detail.replays} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Besuche im Detail</CardTitle>
              <CardDescription>
                Ohne Bots. Ort aus der Netzwerkadresse, die danach verworfen wird.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {realVisits.length === 0 ? (
                <p className="text-sm text-foreground-muted">Noch keine Besuche.</p>
              ) : (
                <ScrollRegion label="Besuche, seitlich scrollbar">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <caption className="sr-only">Besuche von {prospect.companyName}</caption>
                    <thead className="border-b border-border text-foreground-muted">
                      <tr>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Zeit
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Einstieg
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Gerät
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Ort
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Dauer
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Scroll
                        </th>
                        <th scope="col" className="py-2 font-medium">
                          Gelesen
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {realVisits.map((visit) => (
                        <tr key={visit.id}>
                          <td className="py-2 pr-4 whitespace-nowrap">
                            {dateTime.format(visit.startedAt)}
                          </td>
                          <td className="py-2 pr-4">{SOURCE[visit.source]}</td>
                          <td className="py-2 pr-4">
                            {DEVICE[visit.device]}
                            {visit.browser ? (
                              <span className="text-foreground-muted">, {visit.browser}</span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-4">{visit.city ?? "–"}</td>
                          <td className="py-2 pr-4 tabular-nums">
                            {formatDuration(visit.activeSeconds)}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">{visit.maxScroll} %</td>
                          <td className="py-2">{visit.sections.join(", ") || "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              )}
            </CardContent>
          </Card>

          {detail.sections.some((section) => section.seconds > 0) ? (
            <Card>
              <CardHeader>
                <CardTitle>Abschnitte im Exposé</CardTitle>
                <CardDescription>
                  Lesezeit pro Abschnitt über alle echten Besuche, in der Reihenfolge des Exposés.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SectionHeatList sections={detail.sections} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-6 xl:col-span-2 [&>*]:min-w-0">
          {detail.threads.length > 0 || detail.callbacks.length > 0 ? (
            <Card id="chat">
              <CardHeader>
                <CardTitle>Chat und Rückrufe</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                {detail.threads.length > 0 ? (
                  <ul className="grid gap-2">
                    {detail.threads.map((thread) => (
                      <li key={thread.id}>
                        <Link
                          href={`/chat/${thread.id}`}
                          className="grid gap-0.5 rounded-lg border border-border p-3 text-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                        >
                          <span className="flex flex-wrap items-center justify-between gap-2 font-medium">
                            <span>
                              Chat{thread.visitorName ? ` mit ${thread.visitorName}` : ""}
                            </span>
                            <span className="flex items-center gap-2 text-xs font-normal text-foreground-muted">
                              {thread.unread > 0 ? (
                                <Badge tone="accent">{thread.unread} neu</Badge>
                              ) : null}
                              {formatRelative(thread.lastMessageAt)}
                            </span>
                          </span>
                          {thread.preview ? (
                            <span className="line-clamp-2 text-foreground-muted">
                              {thread.preview}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {detail.callbacks.length > 0 ? <CallbackList callbacks={detail.callbacks} /> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card id="briefe">
            <CardHeader>
              <CardTitle>Briefe</CardTitle>
            </CardHeader>
            <CardContent>
              <ProspectLetters
                prospectId={prospect.id}
                canManage={canManage}
                letters={letters.map((letter) => ({
                  id: letter.id,
                  kind: letter.kind,
                  status: letter.status,
                  shortCode: letter.shortCode,
                  postedAt: letter.postedAt?.toISOString() ?? null,
                  openedAt: letter.openedAt?.toISOString() ?? null,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Links und QR-Codes</CardTitle>
              <CardDescription>
                Jeder Link zählt für sich, so sehen Sie, ob Brief, Folgebrief oder Visitenkarte
                gewirkt hat.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Touchpoints
                prospectId={prospect.id}
                hasExpose={detail.expose !== null}
                canManage={canManage}
                qrBase={`/kunden/${prospect.id}/qr`}
                touchpoints={detail.touchpoints.map((link) => ({
                  id: link.id,
                  channel: link.channel,
                  label: link.label,
                  ...touchpointUrls(origin, link),
                  disabled: link.disabledAt !== null,
                  visits: link.visits,
                  createdAt: link.createdAt.toISOString(),
                }))}
              />
              <p className="text-sm text-foreground-muted">
                Ihre eigenen Aufrufe zählen nicht, wenn Sie{" "}
                <a href={ownerLink} className="text-accent underline underline-offset-4">
                  dieses Gerät als Ihres markieren
                </a>
                . Tun Sie das auf jedem Gerät, mit dem Sie Exposés ansehen.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ansprechpartner</CardTitle>
            </CardHeader>
            <CardContent>
              <Contacts
                prospectId={prospect.id}
                canManage={canManage}
                contacts={detail.contacts.map((contact) => ({
                  id: contact.id,
                  name:
                    [contact.salutation, contact.firstName, contact.lastName]
                      .filter(Boolean)
                      .join(" ") ||
                    (contact.role ?? "Ohne Namen"),
                  role: contact.firstName || contact.lastName ? contact.role : null,
                  email: contact.email,
                  phone: contact.phone,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stammdaten</CardTitle>
              <CardDescription>
                Schlüssel für die expose.json: <code className="font-mono">{prospect.key}</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <ProspectForm
                  action={updateProspectAction}
                  values={prospect}
                  campaigns={campaigns.map(({ id, name }) => ({ id, name }))}
                  submitLabel="Speichern"
                  compact
                />
              ) : (
                <p className="text-sm text-foreground-muted">Nur Lesezugriff.</p>
              )}
            </CardContent>
          </Card>

          {canManage ? (
            <Card id="datenschutz">
              <CardHeader>
                <CardTitle>Datenschutz</CardTitle>
                <CardDescription>
                  Auskunft, Sperrvermerk und Löschung für diesen Kunden (DSGVO Art. 15, 17, 21).
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-1">
                  <a
                    href={`/kunden/${prospect.id}/export`}
                    download
                    className={`${action} justify-self-start`}
                  >
                    <Download aria-hidden className="size-4" />
                    Daten exportieren
                  </a>
                  <p className="text-sm text-foreground-muted">
                    Alle gespeicherten Daten als JSON-Datei, z. B. für eine Auskunftsanfrage.
                  </p>
                </div>

                <form action={setDoNotContactAction} className="grid gap-2">
                  <input type="hidden" name="id" value={prospect.id} />
                  <input type="hidden" name="blocked" value={prospect.doNotContactAt ? "0" : "1"} />
                  <p className="text-sm">
                    {prospect.doNotContactAt ? (
                      <>
                        <span className="font-medium">
                          Sperrvermerk seit {day.format(prospect.doNotContactAt)}.
                        </span>{" "}
                        {prospect.trackingPurgedAt
                          ? `Die Besuchsdaten wurden am ${day.format(prospect.trackingPurgedAt)} gelöscht; nur der Sperrvermerk bleibt.`
                          : `Keine Briefe mehr. Die Besuchsdaten werden am ${day.format(
                              new Date(
                                prospect.doNotContactAt.getTime() + optOutDays * 24 * 3600 * 1000,
                              ),
                            )} gelöscht; nur der Sperrvermerk bleibt.`}
                      </>
                    ) : (
                      "Ein Sperrvermerk verhindert weitere Briefe. Die Besuchsdaten werden danach automatisch gelöscht, der Vermerk bleibt."
                    )}
                  </p>
                  <button type="submit" className={`${action} justify-self-start`}>
                    <Ban aria-hidden className="size-4" />
                    {prospect.doNotContactAt ? "Sperrvermerk aufheben" : "Sperrvermerk setzen"}
                  </button>
                </form>

                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-danger">
                    Kunden löschen …
                  </summary>
                  <form action={deleteProspectAction} className="mt-3 grid gap-3">
                    <input type="hidden" name="id" value={prospect.id} />
                    <p className="text-sm">
                      {prospect.companyName} mit Exposé, Links, Besuchen, Aufzeichnungen und Chats
                      endgültig löschen? Das lässt sich nicht rückgängig machen.
                    </p>
                    <button
                      type="submit"
                      className="inline-flex h-11 items-center justify-self-start rounded-md bg-danger px-4 text-sm font-medium text-danger-foreground hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      Endgültig löschen
                    </button>
                  </form>
                </details>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
