"use client";

import { KeyRound, Mail } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export function LoginForm({ next, linkError }: { next: string; linkError?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(
    linkError
      ? { kind: "error", message: "Der Anmeldelink ist abgelaufen oder wurde schon benutzt. Fordern Sie einen neuen an." }
      : { kind: "idle" },
  );
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // Offer saved passkeys in the email field's autofill (conditional UI).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (
        typeof PublicKeyCredential === "undefined" ||
        !(await PublicKeyCredential.isConditionalMediationAvailable?.())
      ) {
        return;
      }
      const result = await authClient.signIn.passkey({ autoFill: true });
      if (!cancelled && result && !result.error) router.replace(next as Route);
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setStatus({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: next,
      errorCallbackURL: "/login?error=link",
    });
    if (error) {
      setStatus({
        kind: "error",
        message:
          error.status === 429
            ? "Zu viele Versuche. Bitte warten Sie ein paar Minuten."
            : "Der Link konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
      });
      return;
    }
    setStatus({ kind: "sent", email });
  }

  async function signInWithPasskey() {
    setPasskeyBusy(true);
    const result = await authClient.signIn.passkey();
    setPasskeyBusy(false);
    if (result?.error) {
      setStatus({
        kind: "error",
        message: "Anmeldung mit Passkey abgebrochen oder nicht möglich. Nutzen Sie alternativ den E-Mail-Link.",
      });
      return;
    }
    router.replace(next as Route);
  }

  return (
    <Card>
      <CardContent className="grid gap-6">
        <div className="grid gap-1 text-center">
          <h1 className="text-xl font-semibold">Willkommen zurück</h1>
          <p className="text-sm text-foreground-muted">Melden Sie sich im Cockpit an.</p>
        </div>

        <Button size="lg" onClick={signInWithPasskey} disabled={passkeyBusy}>
          <KeyRound aria-hidden />
          {passkeyBusy ? "Warte auf Passkey …" : "Mit Passkey anmelden"}
        </Button>

        <div className="flex items-center gap-3 text-xs text-foreground-muted" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          oder per E-Mail-Link
          <span className="h-px flex-1 bg-border" />
        </div>

        {status.kind === "sent" ? (
          <Alert tone="success">
            <p className="font-medium">Prüfen Sie Ihr Postfach.</p>
            <p>
              Wenn <strong>{status.email}</strong> freigeschaltet ist, ist ein Anmeldelink unterwegs. Er ist 10
              Minuten gültig.
            </p>
          </Alert>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate={false}>
            <Field label="E-Mail-Adresse">
              <Input
                name="email"
                type="email"
                required
                autoComplete="username webauthn"
                inputMode="email"
                placeholder="sie@agentur.de"
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={status.kind === "sending"}>
              <Mail aria-hidden />
              {status.kind === "sending" ? "Wird gesendet …" : "Anmeldelink senden"}
            </Button>
          </form>
        )}

        <div aria-live="polite">
          {status.kind === "error" ? <Alert tone="danger">{status.message}</Alert> : null}
        </div>
      </CardContent>
    </Card>
  );
}
