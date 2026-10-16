"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PLACEHOLDERS } from "@/domain/letters/compose";
import type { LetterSettings, SenderAddress } from "@/domain/workspace-settings";
import { saveLetterSettings, type LetterSettingsState } from "./letter-actions";

/** Settings → Briefe: sender, default text and costs (§7.9). */
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
          Gilt, wenn ein Exposé keinen eigenen Brieftext hat, und für Folgebriefe. Platzhalter:{" "}
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
