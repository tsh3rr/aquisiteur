"use client";

import { ArrowRight, Check, KeyRound } from "lucide-react";
import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { slugify } from "@/domain/slug";
import { authClient } from "@/lib/auth-client";
import {
  completeOnboarding,
  saveProfileStep,
  saveSenderStep,
  saveWorkspaceStep,
  type StepState,
} from "./actions";

type Defaults = Record<string, string>;

function useStep(action: (prev: StepState, data: FormData) => Promise<StepState>) {
  return useActionState(action, {} as StepState);
}

function value(state: StepState, defaults: Defaults, key: string): string {
  return state.values?.[key] ?? defaults[key] ?? "";
}

function SubmitRow({ pending, label = "Weiter" }: { pending: boolean; label?: string }) {
  return (
    <div className="flex items-center justify-end gap-3 pt-2">
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Wird gespeichert …" : label}
        <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}

function ErrorSummary({ state }: { state: StepState }) {
  const count = Object.keys(state.errors ?? {}).length;
  return (
    <div aria-live="polite">
      {count > 0 ? (
        <Alert tone="danger">
          {count === 1 ? "Bitte prüfen Sie das markierte Feld." : `Bitte prüfen Sie die ${count} markierten Felder.`}
        </Alert>
      ) : null}
      {state.formError ? <Alert tone="danger">{state.formError}</Alert> : null}
    </div>
  );
}

export function WorkspaceStep({
  defaults,
  platformDomain,
}: {
  defaults: { name: string; slug: string };
  platformDomain: string;
}) {
  const [state, action, pending] = useStep(saveWorkspaceStep);
  const [name, setName] = useState(state.values?.name ?? defaults.name);
  const [slug, setSlug] = useState(state.values?.slug ?? defaults.slug);
  const [slugEdited, setSlugEdited] = useState(Boolean(defaults.slug));

  return (
    <Card>
      <CardContent>
        <form action={action} className="grid gap-5">
          <ErrorSummary state={state} />
          <Field label="Name Ihrer Agentur" error={state.errors?.name}>
            <Input
              name="name"
              required
              autoComplete="organization"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugEdited) setSlug(slugify(event.target.value));
              }}
              placeholder="Pixelwerk Leipzig"
            />
          </Field>
          <Field
            label="Adresse"
            hint={`Ihre Exposés sind erreichbar unter ${slug || "ihr-name"}.${platformDomain}`}
            error={state.errors?.slug}
          >
            <Input
              name="slug"
              required
              autoCapitalize="off"
              spellCheck={false}
              value={slug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(slugify(event.target.value));
              }}
              placeholder="pixelwerk"
            />
          </Field>
          <SubmitRow pending={pending} />
        </form>
      </CardContent>
    </Card>
  );
}

export function ProfileStep({ defaults }: { defaults: Defaults }) {
  const [state, action, pending] = useStep(saveProfileStep);
  const v = (key: string) => value(state, defaults, key);
  const e = (key: string) => state.errors?.[key];
  return (
    <Card>
      <CardContent>
        <form action={action} className="grid gap-5">
          <ErrorSummary state={state} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Ihr Name" error={e("profile.displayName")}>
              <Input name="profile.displayName" required autoComplete="name" defaultValue={v("profile.displayName")} />
            </Field>
            <Field label="Rolle" optional error={e("profile.role")}>
              <Input
                name="profile.role"
                autoComplete="organization-title"
                defaultValue={v("profile.role")}
                placeholder="Inhaber"
              />
            </Field>
          </div>
          <Field label="E-Mail für Anfragen" error={e("channels.email")}>
            <Input name="channels.email" type="email" autoComplete="email" defaultValue={v("channels.email")} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Telefon" optional error={e("channels.phone")}>
              <Input name="channels.phone" type="tel" autoComplete="tel" defaultValue={v("channels.phone")} />
            </Field>
            <Field label="Mobil" optional error={e("channels.mobile")}>
              <Input name="channels.mobile" type="tel" autoComplete="tel" defaultValue={v("channels.mobile")} />
            </Field>
          </div>
          <Field
            label="WhatsApp-Nummer"
            optional
            hint="Mit Ländervorwahl, z. B. +49 170 1234567."
            error={e("channels.whatsapp")}
          >
            <Input name="channels.whatsapp" type="tel" defaultValue={v("channels.whatsapp")} />
          </Field>
          <SubmitRow pending={pending} />
        </form>
      </CardContent>
    </Card>
  );
}

export function SenderStep({ defaults, platformHost }: { defaults: Defaults; platformHost: string }) {
  const [state, action, pending] = useStep(saveSenderStep);
  const v = (key: string) => value(state, defaults, key);
  const e = (key: string) => state.errors?.[key];
  return (
    <Card>
      <CardContent>
        <form action={action} className="grid gap-5">
          <ErrorSummary state={state} />
          <fieldset className="grid gap-5">
            <legend className="mb-1 text-sm font-semibold">Absenderadresse für Briefe</legend>
            <Field label="Absender" error={e("senderAddress.company")}>
              <Input name="senderAddress.company" autoComplete="organization" defaultValue={v("senderAddress.company")} />
            </Field>
            <Field label="Straße und Hausnummer" error={e("senderAddress.street")}>
              <Input name="senderAddress.street" autoComplete="street-address" defaultValue={v("senderAddress.street")} />
            </Field>
            <div className="grid grid-cols-[8rem_1fr] gap-4">
              <Field label="PLZ" error={e("senderAddress.postalCode")}>
                <Input
                  name="senderAddress.postalCode"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  defaultValue={v("senderAddress.postalCode")}
                />
              </Field>
              <Field label="Ort" error={e("senderAddress.city")}>
                <Input name="senderAddress.city" autoComplete="address-level2" defaultValue={v("senderAddress.city")} />
              </Field>
            </div>
          </fieldset>
          <Field
            label="Eigene Domain für Kurzlinks"
            optional
            hint={`Ohne eigene Domain nutzen Sie ${platformHost}. Die Einrichtung (DNS, Zertifikat) folgt mit der Exposé-Veröffentlichung.`}
            error={e("customDomain")}
          >
            <Input
              name="customDomain"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="go.agentur.de"
              defaultValue={v("customDomain")}
            />
          </Field>
          <SubmitRow pending={pending} />
        </form>
      </CardContent>
    </Card>
  );
}

export function PasskeyStep() {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [finishing, setFinishing] = useState(false);

  async function addPasskey() {
    setStatus("busy");
    const result = await authClient.passkey.addPasskey({ name: deviceName() });
    setStatus(result?.error ? "error" : "done");
  }

  return (
    <Card>
      <CardContent className="grid gap-5">
        <div aria-live="polite">
          {status === "done" ? (
            <Alert tone="success">Passkey gespeichert. Ab jetzt reicht ein Fingertipp zur Anmeldung.</Alert>
          ) : null}
          {status === "error" ? (
            <Alert tone="danger">
              Der Passkey konnte nicht angelegt werden. Sie können es später in den Einstellungen erneut versuchen.
            </Alert>
          ) : null}
        </div>
        {status !== "done" ? (
          <Button size="lg" onClick={addPasskey} disabled={status === "busy"}>
            <KeyRound aria-hidden />
            {status === "busy" ? "Warte auf Ihr Gerät …" : "Passkey für dieses Gerät anlegen"}
          </Button>
        ) : null}
        <form
          action={async () => {
            setFinishing(true);
            await completeOnboarding();
          }}
          className="flex justify-end"
        >
          <Button type="submit" variant={status === "done" ? "primary" : "ghost"} size="lg" disabled={finishing}>
            {status === "done" ? <Check aria-hidden /> : null}
            {status === "done" ? "Zum Cockpit" : "Später einrichten und zum Cockpit"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone/iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Dieses Gerät";
}
