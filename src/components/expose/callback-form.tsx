"use client";

import { clsx } from "clsx";
import { PhoneCall } from "lucide-react";
import { useId, useRef, useState } from "react";
import { track, visitToken } from "./tracking-client";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string; fields?: Record<string, string> };

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring aria-invalid:border-danger";

/** „Rückruf anfordern“ (§7.4): name, phone, preferred time. Opens in place. */
export function CallbackOption({
  slug,
  primary,
  disabled,
}: {
  slug: string;
  primary: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const started = useRef(false);
  const id = useId();
  const error = (field: string) => (state.kind === "error" ? state.fields?.[field] : undefined);

  const submit = async (form: HTMLFormElement) => {
    if (disabled) {
      setState({ kind: "error", message: "In der Vorschau werden keine Anfragen gesendet." });
      return;
    }
    setState({ kind: "sending" });
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const response = await fetch("/t/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...data, slug, token: (await visitToken()) ?? undefined }),
    }).catch(() => null);
    if (response?.ok) {
      setState({ kind: "sent" });
      return;
    }
    const body = (await response?.json().catch(() => null)) as {
      fields?: Record<string, string>;
    } | null;
    setState({
      kind: "error",
      message:
        response?.status === 429
          ? "Gerade sind sehr viele Anfragen eingegangen. Bitte versuchen Sie es später noch einmal."
          : body?.fields
            ? "Bitte prüfen Sie die markierten Felder."
            : "Das hat leider nicht geklappt. Bitte versuchen Sie es noch einmal.",
      fields: body?.fields,
    });
  };

  return (
    <li className={clsx((open || primary) && "sm:col-span-2")}>
      <button
        type="button"
        aria-expanded={open}
        data-callback
        aria-controls={`${id}-form`}
        onClick={() => {
          setOpen((value) => !value);
          if (!started.current) {
            started.current = true;
            track({ type: "callback_started" });
          }
        }}
        // clsx, not cn: tailwind-merge would add 9 KB to every exposé (ADR-0048).
        className={clsx(
          "flex min-h-14 w-full items-center gap-3 rounded-xl px-5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
          primary
            ? "bg-accent text-accent-foreground shadow-sm hover:bg-accent-hover"
            : "border border-border bg-surface hover:border-border-strong hover:bg-surface-sunken",
        )}
      >
        <PhoneCall aria-hidden className="size-5 shrink-0" />
        <span className="grid leading-tight">
          <span className="font-semibold">Rückruf anfordern</span>
          <span className={primary ? "text-sm" : "text-sm text-foreground-muted"}>
            Ich melde mich zu Ihrer Wunschzeit
          </span>
        </span>
      </button>
      <div id={`${id}-form`} hidden={!open} className="mt-3">
        {state.kind === "sent" ? (
          <p role="status" className="rounded-xl bg-accent-soft p-4 text-accent-soft-foreground">
            Danke! Ich rufe Sie zu Ihrer Wunschzeit an.
          </p>
        ) : (
          <form
            data-replay-block
            noValidate
            className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(event.currentTarget);
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-name`} className="text-sm font-medium">
                Ihr Name
              </label>
              <input
                id={`${id}-name`}
                name="name"
                autoComplete="name"
                required
                maxLength={120}
                aria-invalid={error("name") ? true : undefined}
                aria-describedby={error("name") ? `${id}-name-error` : undefined}
                className={fieldClass}
              />
              {error("name") ? (
                <p id={`${id}-name-error`} className="text-sm text-danger-soft-foreground">
                  {error("name")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-phone`} className="text-sm font-medium">
                Telefonnummer
              </label>
              <input
                id={`${id}-phone`}
                name="phone"
                type="tel"
                autoComplete="tel"
                required
                maxLength={40}
                aria-invalid={error("phone") ? true : undefined}
                aria-describedby={error("phone") ? `${id}-phone-error` : undefined}
                className={fieldClass}
              />
              {error("phone") ? (
                <p id={`${id}-phone-error`} className="text-sm text-danger-soft-foreground">
                  {error("phone")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label htmlFor={`${id}-time`} className="text-sm font-medium">
                Wann passt es Ihnen?{" "}
                <span className="font-normal text-foreground-muted">(optional)</span>
              </label>
              <input
                id={`${id}-time`}
                name="preferredTime"
                maxLength={120}
                placeholder="z. B. Dienstag ab 15 Uhr"
                className={fieldClass}
              />
            </div>
            {/* Honeypot for bots; hidden from people and assistive technology. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="hidden"
            />
            <div className="grid gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={state.kind === "sending"}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 font-semibold text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60"
              >
                {state.kind === "sending" ? "Wird gesendet …" : "Rückruf anfordern"}
              </button>
              <p aria-live="polite" className="text-sm text-danger-soft-foreground">
                {state.kind === "error" ? state.message : ""}
              </p>
              <p className="text-xs text-foreground-muted">
                Ihre Angaben nutze ich nur für diesen Rückruf.
              </p>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}
