"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ChannelSettings, ChatSettings, NudgeSettings } from "@/domain/workspace-settings";
import { saveContactSettings, type ContactSettingsState } from "./contact-actions";

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
  disabled: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-foreground-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Settings → Kontakt und Chat: channels, live chat and nudges (§7.4, §7.5). */
export function ContactSettingsForm({
  channels,
  chat,
  nudges,
  canEdit,
}: {
  channels: ChannelSettings & { bookingUrl?: string };
  chat: ChatSettings;
  nudges: NudgeSettings;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ContactSettingsState, FormData>(
    saveContactSettings,
    { ok: false },
  );
  const e = (name: string) => state.errors?.[name];
  const disabled = !canEdit || pending;

  return (
    <form action={action} className="grid gap-8">
      <fieldset className="grid gap-4" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Kontaktwege</legend>
        <p className="-mt-2 text-sm text-foreground-muted">
          Exposés zeigen nur Wege, die hier ausgefüllt sind. Vorbelegte Texte enthalten automatisch
          die Referenz des Kunden.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-Mail für Anfragen" optional error={e("channels.email")}>
            <Input name="channels.email" type="email" defaultValue={channels.email ?? ""} />
          </Field>
          <Field label="Telefon" optional error={e("channels.phone")}>
            <Input name="channels.phone" type="tel" defaultValue={channels.phone ?? ""} />
          </Field>
          <Field label="Mobil" optional error={e("channels.mobile")}>
            <Input name="channels.mobile" type="tel" defaultValue={channels.mobile ?? ""} />
          </Field>
          <Field
            label="WhatsApp"
            optional
            hint="Leer lassen, um die Mobilnummer zu nutzen."
            error={e("channels.whatsapp")}
          >
            <Input name="channels.whatsapp" type="tel" defaultValue={channels.whatsapp ?? ""} />
          </Field>
          <Field
            label="Termin buchen"
            optional
            hint="Link zu Ihrer Buchungsseite, z. B. Cal.com. Öffnet in einem neuen Tab."
            error={e("channels.bookingUrl")}
          >
            <Input
              name="channels.bookingUrl"
              type="url"
              placeholder="https://cal.com/…"
              defaultValue={channels.bookingUrl ?? ""}
            />
          </Field>
          <Field
            label="SMS"
            optional
            hint="Nur wenn ein Exposé den Kanal „sms“ nennt."
            error={e("channels.sms")}
          >
            <Input name="channels.sms" type="tel" defaultValue={channels.sms ?? ""} />
          </Field>
          <Field
            label="Facebook-Seite für Messenger"
            optional
            hint="Nur der Seitenname. Nur wenn ein Exposé den Kanal „messenger“ nennt."
            error={e("channels.messengerPage")}
          >
            <Input name="channels.messengerPage" defaultValue={channels.messengerPage ?? ""} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Live-Chat</legend>
        <Toggle
          name="chat.enabled"
          label="Live-Chat in Exposés anbieten"
          defaultChecked={chat.enabled}
          disabled={disabled}
        />
        <Field
          label="Antwortzeit"
          hint="Steht im Chat und in der Einladung nach dem Lesen."
          error={e("chat.responseTime")}
        >
          <Input name="chat.responseTime" defaultValue={chat.responseTime} maxLength={120} />
        </Field>
        <Field
          label="Automatische Nachricht"
          hint="Geht raus, wenn niemand innerhalb von 2 Minuten antwortet. Ihre anderen Kontaktwege werden angehängt."
          error={e("chat.offlineMessage")}
        >
          <Textarea
            name="chat.offlineMessage"
            defaultValue={chat.offlineMessage}
            maxLength={500}
            rows={3}
          />
        </Field>
        <Toggle
          name="chat.storeDraftContent"
          label="Inhalt nicht gesendeter Entwürfe speichern"
          hint="Aus: nur die Länge wird gespeichert. An: Der Chat zeigt Besuchern den Hinweis „Ihr Entwurf wird automatisch gespeichert“, und nur Sie sehen den Text."
          defaultChecked={chat.storeDraftContent}
          disabled={disabled}
        />
      </fieldset>

      <fieldset className="grid gap-1" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Rückruf-Formular</legend>
        <Toggle
          name="chat.prefillCallbackPhone"
          label="Bekannte Nummer anbieten"
          hint="Steht beim Kunden eine Telefonnummer, bietet das Formular sie maskiert an (z. B. „+49 170 ••• 67“). Die volle Nummer erscheint nie im Exposé, weil der Link weitergeleitet werden kann."
          defaultChecked={chat.prefillCallbackPhone}
          disabled={disabled}
        />
      </fieldset>

      <fieldset className="grid gap-1" disabled={disabled}>
        <legend className="mb-2 text-base font-semibold">Hinweise im Exposé</legend>
        <p className="mb-2 text-sm text-foreground-muted">
          Höchstens ein Hinweis pro Besuch, nie als Pop-up, jederzeit schließbar.
        </p>
        <Toggle
          name="nudges.enabled"
          label="Hinweise zeigen"
          defaultChecked={nudges.enabled}
          disabled={disabled}
        />
        <Toggle
          name="nudges.readInvite"
          label="Einladung nach dem Lesen"
          hint="Nach 60 % gelesen und 90 Sekunden auf der Seite."
          defaultChecked={nudges.readInvite}
          disabled={disabled}
        />
        <Toggle
          name="nudges.pricing"
          label="Angebot nach Preisauswahl"
          defaultChecked={nudges.pricing}
          disabled={disabled}
        />
        <Toggle
          name="nudges.returning"
          label="Begrüßung bei erneutem Besuch"
          defaultChecked={nudges.returning}
          disabled={disabled}
        />
        <Toggle
          name="nudges.exitIntent"
          label="Leiser Hinweis beim Verlassen"
          defaultChecked={nudges.exitIntent}
          disabled={disabled}
        />
        <Toggle
          name="nudges.stickyBar"
          label="Kontaktleiste auf dem Handy"
          hint="Erscheint nach dem ersten Drittel."
          defaultChecked={nudges.stickyBar}
          disabled={disabled}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={disabled}>
          {pending ? "Wird gespeichert …" : "Speichern"}
        </Button>
        <p
          aria-live="polite"
          className={state.ok ? "text-sm text-success-foreground" : "text-sm text-danger"}
        >
          {state.message ?? ""}
        </p>
      </div>
    </form>
  );
}
