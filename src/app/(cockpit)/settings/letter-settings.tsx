"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PLACEHOLDERS } from "@/domain/letters/compose";
import type { LetterSettings, SenderAddress } from "@/domain/workspace-settings";
import { saveLetterSettings, type LetterSettingsState } from "./letter-actions";
import { Toggle } from "./toggle";

/** Settings → Briefe: sender, default texts, follow-ups and costs (§7.9). */
export function LetterSettingsForm({
  sender,
  letter,
  canEdit,
}: {
  sender: SenderAddress;
  letter: LetterSettings;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<LetterSettingsState, FormData>(
    saveLetterSettings,
    { ok: false },
  );
  const e = (name: string) => state.errors?.[name];
  const disabled = !canEdit || pending;

  return (
    <form action={action} className="grid gap-8">
      <fieldset className="grid gap-4 sm:grid-cols-2" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Absender</legend>
        <Field
          label="Firma oder Name"
          hint="Steht klein über der Anschrift im Fenster"
          error={e("senderAddress.company")}
          className="sm:col-span-2"
        >
          <Input name="senderAddress.company" defaultValue={sender.company ?? ""} maxLength={160} />
        </Field>
        <Field label="Straße und Hausnummer" error={e("senderAddress.street")}>
          <Input
            name="senderAddress.street"
            defaultValue={sender.street ?? ""}
            autoComplete="street-address"
          />
        </Field>
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label="PLZ" error={e("senderAddress.postalCode")}>
            <Input
              name="senderAddress.postalCode"
              defaultValue={sender.postalCode ?? ""}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </Field>
          <Field label="Ort" error={e("senderAddress.city")}>
            <Input name="senderAddress.city" defaultValue={sender.city ?? ""} />
          </Field>
        </div>
        <Field label="Land" error={e("senderAddress.country")}>
          <Select name="senderAddress.country" defaultValue={sender.country}>
            <option value="DE">Deutschland</option>
            <option value="AT">Österreich</option>
            <option value="CH">Schweiz</option>
          </Select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-4" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Vorlage</legend>
        <p className="-mt-2 text-sm text-foreground-muted">
          Gilt, wenn ein Exposé keinen eigenen Brieftext hat. Platzhalter:{" "}
          {PLACEHOLDERS.map((name) => `{{${name}}}`).join(", ")}. Die Anrede ergänzt Aquisiteur
          selbst, wenn der Text nicht mit einer beginnt.
        </p>
        <Field label="Betreff" error={e("letter.subject")}>
          <Input name="letter.subject" defaultValue={letter.subject} maxLength={160} />
        </Field>
        <Field
          label="Brieftext"
          hint="Leerzeile = neuer Absatz, **fett**, Zeilen mit „- “ werden eine Liste"
          error={e("letter.body")}
        >
          <Textarea name="letter.body" rows={9} defaultValue={letter.body} maxLength={4000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grußformel" error={e("letter.closing")}>
            <Input name="letter.closing" defaultValue={letter.closing} maxLength={80} />
          </Field>
          <Field label="Hinweis neben dem QR-Code" error={e("letter.qrHint")}>
            <Input name="letter.qrHint" defaultValue={letter.qrHint} maxLength={80} />
          </Field>
        </div>
        <Field
          label="Kosten pro Brief in Euro"
          hint="Druck, Umschlag und Porto. Für die Kosten pro Abschluss in der Auswertung."
          error={e("letter.cost")}
          className="sm:max-w-xs"
        >
          <Input
            name="letter.cost"
            inputMode="decimal"
            defaultValue={(letter.costCents / 100).toFixed(2).replace(".", ",")}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4" disabled={disabled}>
        <legend className="mb-3 text-base font-semibold">Folgebrief</legend>
        <Toggle
          name="letter.followUp.enabled"
          label="Folgebrief automatisch vorbereiten"
          hint="Hat niemand das Exposé geöffnet, legt Aquisiteur nach der eingestellten Zeit einen Folgebrief mit eigenem QR-Code als Entwurf an und erinnert Sie mit einer Aufgabe. Verschickt wird nichts von selbst. Nach „Kein Interesse“ entsteht kein Folgebrief."
          defaultChecked={letter.followUp.enabled}
          disabled={disabled}
        />
        <Field
          label="Tage nach dem ersten Brief"
          hint="Gezählt ab „Als versendet markieren“, 3 bis 90 Tage"
          error={e("letter.followUp.afterDays")}
          className="sm:max-w-xs"
        >
          <Input
            name="letter.followUp.afterDays"
            type="number"
            inputMode="numeric"
            min={3}
            max={90}
            defaultValue={letter.followUp.afterDays}
          />
        </Field>
        <Field label="Betreff des Folgebriefs" error={e("letter.followUp.subject")}>
          <Input
            name="letter.followUp.subject"
            defaultValue={letter.followUp.subject}
            maxLength={160}
          />
        </Field>
        <Field
          label="Text des Folgebriefs"
          hint="Gilt für automatisch und von Hand angelegte Folgebriefe, mit denselben Platzhaltern"
          error={e("letter.followUp.body")}
        >
          <Textarea
            name="letter.followUp.body"
            rows={7}
            defaultValue={letter.followUp.body}
            maxLength={4000}
          />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {pending ? "Wird gespeichert …" : "Speichern"}
        </Button>
        <p
          aria-live="polite"
          className={state.ok ? "text-sm text-foreground-muted" : "text-sm text-danger"}
        >
          {state.message}
        </p>
      </div>
    </form>
  );
}
