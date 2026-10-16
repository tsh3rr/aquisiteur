"use client";

import { Mail, Phone, Trash2, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { addContactAction, removeContactAction, type FormState } from "../actions";

export interface ContactView {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

/** People at the prospect (§7.8 „mehrere Ansprechpartner“). */
export function Contacts({
  prospectId,
  contacts,
  canManage,
}: {
  prospectId: string;
  contacts: ContactView[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addContactAction, {
    ok: false,
  });
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-4">
      {contacts.length === 0 ? (
        <p className="text-sm text-foreground-muted">Noch keine Ansprechpartner.</p>
      ) : (
        <ul className="grid gap-3">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-start justify-between gap-3">
              <div className="grid gap-0.5 text-sm">
                <p className="font-medium">{contact.name}</p>
                {contact.role ? <p className="text-foreground-muted">{contact.role}</p> : null}
                {contact.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/\s/g, "")}`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-accent hover:underline sm:min-h-0"
                  >
                    <Phone aria-hidden className="size-3.5" />
                    {contact.phone}
                  </a>
                ) : null}
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-accent hover:underline sm:min-h-0"
                  >
                    <Mail aria-hidden className="size-3.5" />
                    {contact.email}
                  </a>
                ) : null}
              </div>
              {canManage ? (
                <form action={removeContactAction}>
                  <input type="hidden" name="id" value={contact.id} />
                  <input type="hidden" name="prospectId" value={prospectId} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={`${contact.name} entfernen`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && !adding ? (
        <Button
          variant="secondary"
          size="sm"
          className="justify-self-start"
          onClick={() => setAdding(true)}
        >
          <UserPlus aria-hidden />
          Ansprechpartner hinzufügen
        </Button>
      ) : null}
      {canManage && adding ? (
        <form action={action} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <input type="hidden" name="prospectId" value={prospectId} />
          <Field label="Anrede" optional>
            <Input name="salutation" maxLength={20} placeholder="Frau, Herr" />
          </Field>
          <Field label="Rolle" optional>
            <Input name="role" maxLength={100} placeholder="Inhaberin" />
          </Field>
          <Field label="Vorname" optional>
            <Input name="firstName" maxLength={100} autoComplete="off" />
          </Field>
          <Field label="Nachname" optional error={state.errors?.lastName}>
            <Input name="lastName" maxLength={100} autoComplete="off" />
          </Field>
          <Field label="E-Mail" optional error={state.errors?.email}>
            <Input name="email" type="email" autoComplete="off" />
          </Field>
          <Field label="Telefon" optional>
            <Input name="phone" type="tel" autoComplete="off" />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              Hinzufügen
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
