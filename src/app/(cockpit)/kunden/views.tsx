"use client";

import { Bookmark, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { deleteViewAction, saveViewAction, type FormState } from "./actions";

interface View {
  name: string;
  query: string;
}

const chip =
  "inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-foreground";

/** Built-in and saved views of the customer list (§7.8 „gespeicherte Ansichten“). */
export function SavedViews({
  current,
  builtIn,
  saved,
  canManage,
}: {
  current: string;
  builtIn: View[];
  saved: (View & { id: string; shared: boolean })[];
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveViewAction, {
    ok: false,
  });
  const [open, setOpen] = useState(false);
  const known = [...builtIn, ...saved].some((view) => view.query === current);

  return (
    <div className="grid gap-3">
      <nav aria-label="Ansichten">
        <ul className="flex flex-wrap gap-2">
          {builtIn.map((view) => (
            <li key={view.name}>
              <Link
                href={`/kunden${view.query ? `?${view.query}` : ""}` as Route}
                aria-current={view.query === current ? "page" : undefined}
                className={chip}
              >
                {view.name}
              </Link>
            </li>
          ))}
          {saved.map((view) => (
            <li key={view.id} className="flex items-center">
              <Link
                href={`/kunden${view.query ? `?${view.query}` : ""}` as Route}
                aria-current={view.query === current ? "page" : undefined}
                className={cn(chip, canManage && "rounded-r-none border-r-0")}
              >
                <Bookmark aria-hidden className="mr-1.5 size-3.5" />
                {view.name}
              </Link>
              {canManage ? (
                <form action={deleteViewAction}>
                  <input type="hidden" name="id" value={view.id} />
                  <button
                    type="submit"
                    aria-label={`Ansicht „${view.name}“ löschen`}
                    className="inline-flex min-h-11 items-center rounded-r-full border border-border px-3 text-foreground-muted hover:bg-surface-sunken hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </form>
              ) : null}
            </li>
          ))}
          {canManage && !known && !open ? (
            <li>
              <Button variant="ghost" className="min-h-11" onClick={() => setOpen(true)}>
                <Bookmark aria-hidden />
                Diese Ansicht speichern
              </Button>
            </li>
          ) : null}
        </ul>
      </nav>
      {open && !known ? (
        <form
          action={action}
          className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        >
          <input type="hidden" name="query" value={current} />
          <Field label="Name der Ansicht" error={state.errors?.name}>
            <Input name="name" required maxLength={60} placeholder="z. B. Heiße Leads Leipzig" />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="shared" value="1" className="size-5 accent-accent" />
            Für alle im Workspace
          </label>
          <Button type="submit" disabled={pending}>
            Speichern
          </Button>
        </form>
      ) : null}
      <p aria-live="polite" className="text-sm text-foreground-muted empty:hidden">
        {state.message}
      </p>
    </div>
  );
}
