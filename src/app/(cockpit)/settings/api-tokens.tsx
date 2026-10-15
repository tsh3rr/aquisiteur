"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createApiToken, revokeApiToken, type CreateTokenState } from "./token-actions";

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const fmt = (value: string | null) => (value ? dateFormat.format(new Date(value)) : null);

function status(row: TokenRow): string {
  if (row.revokedAt) return `Widerrufen am ${fmt(row.revokedAt)}`;
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return "Abgelaufen";
  return row.expiresAt ? `Gültig bis ${fmt(row.expiresAt)}` : "Unbegrenzt gültig";
}

export function ApiTokens({ tokens, apiUrl }: { tokens: TokenRow[]; apiUrl: string }) {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(createApiToken, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="grid gap-6">
      {state.token ? (
        <Alert tone="success">
          <p className="font-semibold">Token „{state.name}“ angelegt</p>
          <p>Kopieren Sie ihn jetzt. Er wird nur dieses eine Mal angezeigt.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-surface px-2 py-1.5 font-mono text-sm break-all text-foreground">
              {state.token}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(state.token!).then(() => setCopied(true));
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Kopiert" : "Kopieren"}
            </Button>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-md bg-surface p-3 font-mono text-xs text-foreground">
            {`AQUISITEUR_API_URL=${apiUrl}\nAQUISITEUR_API_TOKEN=${state.token}\npnpm expose:publish exposes/<ordner>`}
          </pre>
        </Alert>
      ) : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <form action={action} className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field label="Name" hint="Wofür ist der Token, z. B. „Laptop“ oder „Claude Code“?">
          <Input name="name" required minLength={2} maxLength={60} autoComplete="off" />
        </Field>
        <Field label="Gültigkeit">
          <select
            name="expiresInDays"
            defaultValue="90"
            className="h-11 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <option value="30">30 Tage</option>
            <option value="90">90 Tage</option>
            <option value="365">1 Jahr</option>
            <option value="never">Unbegrenzt</option>
          </select>
        </Field>
        <Button type="submit" disabled={pending}>
          <KeyRound aria-hidden />
          Token anlegen
        </Button>
      </form>

      {tokens.length === 0 ? (
        <p className="text-sm text-foreground-muted">Noch keine API-Tokens.</p>
      ) : (
        <ul className="grid divide-y divide-border rounded-md border border-border">
          {tokens.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="grid gap-0.5">
                <span className="font-medium">{row.name}</span>
                <span className="text-sm text-foreground-muted">
                  <span className="font-mono">{row.prefix}…</span> · {status(row)}
                  {row.lastUsedAt ? ` · zuletzt genutzt ${fmt(row.lastUsedAt)}` : " · nie genutzt"}
                </span>
              </div>
              {row.revokedAt ? null : (
                <form
                  action={revokeApiToken}
                  onSubmit={(event) => {
                    if (!window.confirm(`Token „${row.name}“ widerrufen?`)) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Widerrufen
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
