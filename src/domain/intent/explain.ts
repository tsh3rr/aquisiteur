import { telHref, whatsappNumber } from "@/domain/expose/contact-links";
import { LEVEL_LABELS, levelFor, type Device, type Signal } from "./score";

/**
 * Explanation and recommendation for a score (§7.6), generated from the
 * signals without an LLM: what happened, when, on which device, and what the
 * owner should do now, through the channel the prospect last went for.
 */

export interface ContactInfo {
  company: string;
  person: { salutation: string | null; firstName: string | null; lastName: string | null } | null;
  phones: string[];
  emails: string[];
  refCode: string | null;
  /** Wish time from a callback request. */
  preferredTime: string | null;
  /** Thread to answer in the cockpit, when the prospect wrote. */
  chatThreadId: string | null;
}

export type ActionKind = "chat" | "call" | "whatsapp" | "email";
export interface IntentAction {
  kind: ActionKind;
  label: string;
  href: string;
}

export interface Explanation {
  /** "86 % – sehr wahrscheinlicher Kontaktversuch." */
  headline: string;
  /** "Heute 14:32 auf dem Smartphone den WhatsApp-Button geklickt, vorher 4 min gelesen, …" */
  detail: string | null;
  recommendation: string;
  actions: IntentAction[];
}

const CHANNEL_NAMES = {
  whatsapp: "WhatsApp",
  phone: "Anruf",
  email: "E-Mail",
  messenger: "Messenger",
  sms: "SMS",
} as const;

const DEVICE_PHRASES: Record<Device, string | null> = {
  mobile: "auf dem Smartphone",
  tablet: "auf dem Tablet",
  desktop: "am Computer",
  unknown: null,
};

function phrase(signal: Signal): string {
  switch (signal.id) {
    case "visit":
      return "das Exposé geöffnet";
    case "read":
      return `${signal.minutes ?? 2} min gelesen`;
    case "return_visit":
      return "an einem anderen Tag wiedergekommen";
    case "forwarded":
      return "einen weitergeleiteten Link geöffnet";
    case "contact_view":
      return "den Kontaktbereich angesehen";
    case "contact_hover":
      return "einen Kontakt-Button angesteuert";
    case "pricing":
      return "Preise angesehen";
    case "chat_open":
      return "den Chat geöffnet";
    case "draft_short":
    case "draft_long":
      return `im Chat ${signal.length ?? 0} Zeichen getippt, aber nicht gesendet`;
    case "callback_started":
      return "das Rückrufformular begonnen";
    case "contact_copied":
      return signal.copied === "email"
        ? "Ihre E-Mail-Adresse kopiert"
        : "Ihre Telefonnummer kopiert";
    case "channel_click":
      return `den ${CHANNEL_NAMES[signal.channel as keyof typeof CHANNEL_NAMES] ?? "Kontakt"}-Button geklickt`;
    case "booking_open":
      return "die Terminbuchung geöffnet";
    case "confirmed":
      return signal.channel === "callback"
        ? "einen Rückruf angefordert"
        : "eine Nachricht im Chat geschickt";
  }
}

export function formatWhen(at: Date, now: Date, timeZone: string): string {
  const day = (date: Date) => date.toLocaleDateString("de-DE", { timeZone });
  const time = at.toLocaleTimeString("de-DE", { timeZone, hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day(at) === day(now)) return `Heute ${time}`;
  if (day(at) === day(yesterday)) return `Gestern ${time}`;
  const date = at.toLocaleDateString("de-DE", { timeZone, day: "numeric", month: "numeric" });
  return `Am ${date} um ${time}`;
}

/** Name to use when calling: "Frau Müller", else the full name, else the company. */
export function addressee(info: ContactInfo): string {
  const person = info.person;
  if (person?.lastName && (person.salutation === "Frau" || person.salutation === "Herr")) {
    return `${person.salutation} ${person.lastName}`;
  }
  const name = [person?.firstName, person?.lastName].filter(Boolean).join(" ");
  return name || info.company;
}

/** "vormittags" etc. from the hours the prospect usually reads. */
export function bestTime(visitStarts: Date[], timeZone: string): string | null {
  if (visitStarts.length === 0) return null;
  const buckets = new Map<string, number>();
  for (const start of visitStarts) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
        start,
      ),
    );
    const bucket =
      hour >= 6 && hour < 11
        ? "vormittags"
        : hour >= 11 && hour < 14
          ? "mittags"
          : hour >= 14 && hour < 18
            ? "nachmittags"
            : hour >= 18 && hour < 22
              ? "abends"
              : null;
    if (bucket) buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const best = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

function actionsFor(info: ContactInfo, prefer: ActionKind | null): IntentAction[] {
  const actions: IntentAction[] = [];
  const ref = info.refCode ? `Ref ${info.refCode}` : null;
  if (info.chatThreadId) {
    actions.push({ kind: "chat", label: "Im Chat antworten", href: `/chat/${info.chatThreadId}` });
  }
  const phone = info.phones[0];
  if (phone) {
    actions.push({ kind: "call", label: `Anrufen (${phone})`, href: telHref(phone) });
    const wa = whatsappNumber(phone);
    if (wa) {
      const text = ref ? `?text=${encodeURIComponent(`[${ref}] `)}` : "";
      actions.push({
        kind: "whatsapp",
        label: "WhatsApp öffnen",
        href: `https://wa.me/${wa}${text}`,
      });
    }
  }
  const email = info.emails[0];
  if (email) {
    const subject = ref ? `?subject=${encodeURIComponent(`Ihre Anfrage [${ref}]`)}` : "";
    actions.push({ kind: "email", label: "E-Mail schreiben", href: `mailto:${email}${subject}` });
  }
  if (prefer) actions.sort((a, b) => Number(b.kind === prefer) - Number(a.kind === prefer));
  return actions;
}

/** Signals that name a channel the prospect went for, newest first. */
const CHANNEL_SIGNALS = new Set([
  "confirmed",
  "channel_click",
  "booking_open",
  "contact_copied",
  "callback_started",
  "draft_short",
  "draft_long",
]);

export function explain(input: {
  score: number;
  signals: Signal[];
  info: ContactInfo;
  visitStarts: Date[];
  now: Date;
  timeZone: string;
}): Explanation {
  const { score, signals, info, now, timeZone } = input;
  const level = levelFor(score);
  const label = LEVEL_LABELS[level];
  // Adjectives start lower case after the dash, nouns keep their capital.
  const inline = level === "confirmed" ? label : label[0]!.toLowerCase() + label.slice(1);
  const headline = `${score} % – ${inline}.`;
  if (signals.length === 0) {
    return {
      headline,
      detail: null,
      recommendation: "Noch keine Reaktion auf den Brief. Es gibt nichts zu tun.",
      actions: actionsFor(info, null),
    };
  }

  const [lead, ...rest] = signals;
  const where = DEVICE_PHRASES[lead!.device];
  const earlier = rest
    .filter((signal) => signal.id !== "visit" && signal.id !== "draft_short")
    .slice(0, 3)
    .map(phrase);
  const detail =
    [formatWhen(lead!.at, now, timeZone), where, phrase(lead!)].filter(Boolean).join(" ") +
    (earlier.length ? `, vorher ${joinList(earlier)}` : "") +
    ".";

  const name = addressee(info);
  const phone = info.phones[0];
  const email = info.emails[0];
  const time = bestTime(input.visitStarts, timeZone);
  const ref = info.refCode ? ` mit Ref ${info.refCode}` : "";
  const fallback = phone
    ? `${name} anrufen, ${phone}${time ? `, am besten ${time}` : ""}.`
    : email
      ? `${name} eine E-Mail schreiben, ${email}.`
      : "Telefonnummer oder E-Mail-Adresse beim Kunden ergänzen und nachfassen.";

  const focus = signals
    .filter((signal) => CHANNEL_SIGNALS.has(signal.id))
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];

  let recommendation: string;
  let prefer: ActionKind | null = phone ? "call" : email ? "email" : null;
  if (!focus) {
    recommendation =
      score >= 25
        ? `Guter Zeitpunkt, sich zu melden: ${fallback}`
        : "Noch abwarten. Aquisiteur meldet sich, wenn das Interesse steigt.";
  } else if (focus.id === "confirmed" && focus.channel === "chat") {
    recommendation = "Antworten Sie im Chat.";
    prefer = "chat";
  } else if (focus.id === "confirmed") {
    const callbackPhone = phone ? `, ${phone}` : "";
    const wish = info.preferredTime ? `, Wunschzeit: ${info.preferredTime}` : "";
    recommendation = `Rufen Sie ${name} zurück${callbackPhone}${wish}.`;
    prefer = "call";
  } else if (focus.id === "channel_click" && focus.channel === "whatsapp") {
    recommendation = `Prüfen Sie WhatsApp auf eine Nachricht${ref}. Falls nichts da ist: ${fallback}`;
  } else if (focus.id === "channel_click" && focus.channel === "email") {
    recommendation = `Prüfen Sie Ihr Postfach auf eine E-Mail${ref}. Falls nichts da ist: ${fallback}`;
  } else if (focus.id === "channel_click" && focus.channel === "phone") {
    recommendation = `Prüfen Sie entgangene Anrufe. Falls niemand durchgekommen ist: ${fallback}`;
  } else if (focus.id === "channel_click") {
    const via = CHANNEL_NAMES[focus.channel as keyof typeof CHANNEL_NAMES] ?? "Nachrichten";
    recommendation = `Prüfen Sie ${via} auf eine Nachricht${ref}. Falls nichts da ist: ${fallback}`;
  } else if (focus.id === "booking_open") {
    recommendation = `Prüfen Sie Ihren Kalender auf eine neue Buchung. Falls keine da ist: ${fallback}`;
  } else if (focus.id === "contact_copied") {
    recommendation = `Vielleicht meldet sich ${name} noch selbst. Sonst: ${fallback}`;
  } else {
    recommendation = `Wollte schreiben, hat aber nicht abgeschickt. Melden Sie sich: ${fallback}`;
  }

  return { headline, detail, recommendation, actions: actionsFor(info, prefer) };
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} und ${items.at(-1)}`;
}
