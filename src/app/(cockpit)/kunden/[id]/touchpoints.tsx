"use client";

import { Check, Copy, Link2, Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { QrDownloads } from "@/components/cockpit/qr-downloads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { addTouchpointAction, toggleTouchpointAction, type FormState } from "../actions";

export interface TouchpointView {
  id: string;
  channel: "letter" | "share" | "manual";
  label: string;
  qrUrl: string;
  shortUrl: string | null;
  disabled: boolean;
  visits: number;
  createdAt: string;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`${label} kopieren`}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? "Kopiert" : "Kopieren"}</span>
    </Button>
  );
}

const CHANNELS = { letter: "Brief", share: "Weitergeleitet", manual: "Eigener Link" } as const;

/** Touchpoints with short link, QR link and QR downloads (§6.2, §7.8). */
export function Touchpoints({
  prospectId,
  touchpoints,
  qrBase,
  canManage,
  hasExpose,
}: {
  prospectId: string;
  touchpoints: TouchpointView[];
  qrBase: string;
  canManage: boolean;
  hasExpose: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addTouchpointAction, {
    ok: false,
  });
  // Share links appear once someone actually opened them.
  const shown = touchpoints.filter((link) => link.channel !== "share" || link.visits > 0);

  return (
    <div className="grid gap-5">
      {shown.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          {hasExpose
            ? "Noch keine Links."
            : "Links und QR-Codes entstehen, sobald ein Exposé veröffentlicht ist."}
        </p>
      ) : (
        <ul className="grid gap-4">
          {shown.map((link) => (
            <li
              key={link.id}
              className="grid gap-3 rounded-md border border-border p-4 data-[disabled=true]:opacity-70"
              data-disabled={link.disabled}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-medium">
                  <Link2 aria-hidden className="size-4 text-foreground-muted" />
                  {link.label}
                  <Badge>{CHANNELS[link.channel]}</Badge>
                  {link.disabled ? <Badge tone="warning">Deaktiviert</Badge> : null}
                </p>
                <span className="text-sm text-foreground-muted tabular-nums">
                  {link.visits} {link.visits === 1 ? "Besuch" : "Besuche"}
                </span>
              </div>
              <dl className="grid gap-1 text-sm">
                {link.shortUrl ? (
                  <div className="flex flex-wrap items-center gap-x-2">
                    <dt className="text-foreground-muted">Kurzlink</dt>
                    <dd className="flex flex-wrap items-center gap-1 font-medium break-all">
                      {link.shortUrl.replace(/^https?:\/\//, "")}
                      <CopyButton text={link.shortUrl} label={`Kurzlink ${link.label}`} />
                    </dd>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-2">
                  <dt className="text-foreground-muted">QR-Link</dt>
                  <dd className="flex flex-wrap items-center gap-1 break-all">
                    {link.qrUrl.replace(/^https?:\/\//, "")}
                    <CopyButton text={link.qrUrl} label={`QR-Link ${link.label}`} />
                  </dd>
                </div>
              </dl>
              {link.channel !== "share" ? (
                <QrDownloads
                  href={`${qrBase}/${link.id}`}
                  name={`qr-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  label={link.label}
                />
              ) : null}
              {canManage ? (
                <form action={toggleTouchpointAction}>
                  <input type="hidden" name="id" value={link.id} />
                  <input type="hidden" name="enabled" value={link.disabled ? "1" : "0"} />
                  <Button type="submit" variant="link" size="sm">
                    {link.disabled ? "Wieder aktivieren" : "Deaktivieren"}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && hasExpose ? (
        <form action={action} className="grid gap-3 border-t border-border pt-4">
          <input type="hidden" name="prospectId" value={prospectId} />
          <p className="text-sm font-medium">Weiteren Link anlegen</p>
          <Field
            label="Bezeichnung"
            hint="z. B. Folgebrief, Visitenkarte, E-Mail"
            error={state.errors?.label}
          >
            <Input name="label" maxLength={80} required />
          </Field>
          <Field
            label="Eigener Kurzlink"
            optional
            hint="Leer lassen für einen zufälligen Code. Groß- und Kleinschreibung spielen keine Rolle."
            error={state.errors?.shortCode}
          >
            <Input name="shortCode" maxLength={40} autoComplete="off" placeholder="cafe-mueller" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" disabled={pending}>
              <Plus aria-hidden />
              Link anlegen
            </Button>
            <p aria-live="polite" className="text-sm text-foreground-muted">
              {state.message}
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
