"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: Date | string | null;
}

export function PasskeyManager({ canManage }: { canManage: boolean }) {
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let active = true;
    void authClient.passkey.listUserPasskeys().then(({ data }) => {
      if (active) setPasskeys((data as PasskeyRow[] | null) ?? []);
    });
    return () => {
      active = false;
    };
  }, [version]);

  async function add() {
    setBusy(true);
    const result = await authClient.passkey.addPasskey({ name: navigator.platform || "Gerät" });
    setBusy(false);
    setMessage(
      result?.error
        ? { tone: "danger", text: "Passkey konnte nicht angelegt werden." }
        : { tone: "success", text: "Passkey gespeichert." },
    );
    reload();
  }

  async function remove(row: PasskeyRow) {
    if (!window.confirm(`Passkey „${row.name ?? "ohne Namen"}“ wirklich entfernen?`)) return;
    const result = await authClient.passkey.deletePasskey({ id: row.id });
    setMessage(
      result?.error
        ? { tone: "danger", text: "Passkey konnte nicht entfernt werden." }
        : { tone: "success", text: "Passkey entfernt." },
    );
    reload();
  }

  return (
    <div className="grid gap-4">
      <div aria-live="polite">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      </div>
      <div aria-busy={passkeys === null}>
        {passkeys === null ? (
          <div className="grid gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            Noch kein Passkey angelegt. Sie melden sich per E-Mail-Link an.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {passkeys.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                <KeyRound aria-hidden className="size-4 text-foreground-muted" />
                <div className="grid flex-1">
                  <span className="text-sm font-medium">{row.name || "Passkey"}</span>
                  {row.createdAt ? (
                    <span className="text-xs text-foreground-muted">
                      angelegt am {new Date(row.createdAt).toLocaleDateString("de-DE")}
                    </span>
                  ) : null}
                </div>
                {canManage ? (
                  <Button variant="ghost" size="icon" onClick={() => remove(row)} title="Entfernen">
                    <Trash2 aria-hidden />
                    <span className="sr-only">Passkey {row.name ?? ""} entfernen</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canManage ? (
        <div>
          <Button variant="secondary" onClick={add} disabled={busy}>
            <KeyRound aria-hidden />
            {busy ? "Warte auf Ihr Gerät …" : "Passkey hinzufügen"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
