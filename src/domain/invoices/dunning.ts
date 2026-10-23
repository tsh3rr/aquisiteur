import { addDays } from "../tasks";
import { formatCents, formatQuantity } from "../offers/totals";
import { INVOICE_KIND_LABELS, type InvoiceKind } from "./schema";
import { germanDate } from "./totals";

/**
 * Dunning (§7.10, phase 7c-4, ADR-0074): a friendly payment reminder a few
 * days after the due date, then two dunning letters. Each level waits until
 * the deadline of the one before has passed. Late interest (§ 456 UGB) and
 * the 40 € collection fee (§ 458 UGB) are optional and only apply between
 * businesses, from the first dunning letter on.
 */

export const DUNNING_LEVELS = [1, 2, 3] as const;
export type DunningLevel = (typeof DUNNING_LEVELS)[number];

export const DUNNING_LEVEL_LABELS: Record<DunningLevel, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "Letzte Mahnung",
};

export const DUNNING_MODES = ["off", "manual", "approval", "auto"] as const;
export type DunningMode = (typeof DUNNING_MODES)[number];

export const DUNNING_MODE_LABELS: Record<DunningMode, string> = {
  off: "Aus: keine Erinnerungen und Mahnungen",
  manual: "Manuell: Entwurf an der Rechnung, Sie senden selbst",
  approval: "Freigabe über eine Aufgabe",
  auto: "Automatisch",
};

/** § 456 UGB: 9.2 percentage points above the base rate. */
export const LATE_INTEREST_MARGIN_PERCENT = 9.2;
/** § 458 UGB: a flat 40 € for collection costs, once per claim. */
export const COLLECTION_FEE_CENTS = 4000;

export interface DunningTerms {
  /** Days after the due date for each level. */
  days: readonly [number, number, number];
  /** Days the customer gets to pay after each reminder. */
  deadlineDays: number;
  lateInterest: boolean;
  collectionFee: boolean;
  /** Basiszinssatz of the OeNB in percent. */
  baseRatePercent: number;
}

export type ReminderStatus = "draft" | "sent" | "skipped";

export interface ReminderState {
  level: DunningLevel;
  /** "skipped": the owner discarded the draft; the level waits until `deadline` has passed. */
  status: ReminderStatus;
  deadline: string;
}

/**
 * The next level and the first day it may go out, or null when a draft is
 * waiting or the last level is out. A level never comes before the deadline
 * of the previous one has passed, and a discarded one not before its pause ends.
 */
export function nextReminder(
  dueDate: string,
  reminders: readonly ReminderState[],
  terms: Pick<DunningTerms, "days">,
): { level: DunningLevel; dueOn: string } | null {
  if (reminders.some((reminder) => reminder.status === "draft")) return null;
  const last = reminders
    .filter((reminder) => reminder.status === "sent")
    .reduce<ReminderState | null>(
      (highest, reminder) => (!highest || reminder.level > highest.level ? reminder : highest),
      null,
    );
  const level = ((last?.level ?? 0) + 1) as DunningLevel;
  if (level > 3) return null;
  const candidates = [addDays(dueDate, terms.days[level - 1]!)];
  if (last) candidates.push(addDays(last.deadline, 1));
  const skipped = reminders.find(
    (reminder) => reminder.level === level && reminder.status === "skipped",
  );
  if (skipped) candidates.push(addDays(skipped.deadline, 1));
  return { level, dueOn: candidates.sort().at(-1)! };
}

/** A fingerprint of the claim a mail was written for; sending refuses when it changed. */
export function claimKey(claim: DunningClaim): string {
  return [claim.openCents, claim.interestCents, claim.feeCents, claim.deadline].join("|");
}

/** Whole days from `from` to `to`; 0 when `to` is not later. */
export function daysAfter(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export interface DunningClaim {
  openCents: number;
  interestCents: number;
  /** Basis points, e.g. 1073 for 10.73 % p. a.; null without interest. */
  interestRateBp: number | null;
  /** Interest runs from the day after the due date up to and including `asOf`. */
  interestDays: number;
  feeCents: number;
  totalCents: number;
  deadline: string;
}

export function dunningClaim(
  input: {
    level: DunningLevel;
    openCents: number;
    dueDate: string;
    asOf: string;
    business: boolean;
  },
  terms: DunningTerms,
): DunningClaim {
  const charges = input.level >= 2 && input.business;
  const interestDays = daysAfter(input.dueDate, input.asOf);
  const rateBp = Math.round((terms.baseRatePercent + LATE_INTEREST_MARGIN_PERCENT) * 100);
  const withInterest = charges && terms.lateInterest && interestDays > 0 && rateBp > 0;
  const interestCents = withInterest
    ? Math.round((input.openCents * rateBp * interestDays) / (10_000 * 365))
    : 0;
  const feeCents = charges && terms.collectionFee ? COLLECTION_FEE_CENTS : 0;
  return {
    openCents: input.openCents,
    interestCents,
    interestRateBp: withInterest ? rateBp : null,
    interestDays: withInterest ? interestDays : 0,
    feeCents,
    totalCents: input.openCents + interestCents + feeCents,
    deadline: addDays(input.asOf, terms.deadlineDays),
  };
}

export function formatRate(bp: number): string {
  return `${formatQuantity(bp / 100)} %`;
}

/** The lines the mail lists under {aufstellung}. */
export function claimBreakdown(claim: DunningClaim, dueDate: string, asOf: string): string {
  if (claim.interestCents === 0 && claim.feeCents === 0) {
    return `Offener Betrag: ${formatCents(claim.openCents)}`;
  }
  const lines = [`Offener Rechnungsbetrag: ${formatCents(claim.openCents)}`];
  if (claim.interestCents > 0 && claim.interestRateBp) {
    lines.push(
      `Verzugszinsen ${formatRate(claim.interestRateBp)} p. a. (§ 456 UGB) vom ${germanDate(addDays(dueDate, 1))} bis ${germanDate(asOf)}: ${formatCents(claim.interestCents)}`,
    );
  }
  if (claim.feeCents > 0) {
    lines.push(`Pauschale für Betreibungskosten (§ 458 UGB): ${formatCents(claim.feeCents)}`);
  }
  lines.push(`Gesamt: ${formatCents(claim.totalCents)}`);
  return lines.join("\n");
}

export const DUNNING_EMAIL_SUBJECTS: Record<DunningLevel, string> = {
  1: "Zahlungserinnerung: {art} {nummer}",
  2: "1. Mahnung: {art} {nummer}",
  3: "Letzte Mahnung: {art} {nummer}",
};

export const DUNNING_EMAIL_BODIES: Record<DunningLevel, string> = {
  1: `Guten Tag,

im Alltag geht so etwas leicht unter: Die {art} {nummer} vom {datum} war am {faellig} fällig.

{aufstellung}

Bitte überweisen Sie den Betrag bis {frist}. Die Rechnung hängt an und ist auch online abrufbar: {link}

Falls Sie schon bezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.

Vielen Dank!
{absender}`,
  2: `Guten Tag,

zur {art} {nummer} vom {datum}, fällig am {faellig}, konnte ich trotz Erinnerung noch keinen vollständigen Zahlungseingang feststellen.

{aufstellung}

Bitte überweisen Sie den Betrag bis {frist}. Die Rechnung hängt an und ist auch online abrufbar: {link}

Falls Sie in der Zwischenzeit bezahlt haben, ist diese Mahnung gegenstandslos.

Mit freundlichen Grüßen
{absender}`,
  3: `Guten Tag,

die {art} {nummer} vom {datum}, fällig am {faellig}, ist trotz Erinnerung und Mahnung noch offen.

{aufstellung}

Bitte überweisen Sie den Betrag bis spätestens {frist}. Geht er bis dahin nicht ein, muss ich weitere Schritte zur Einbringung der Forderung einleiten. Die Rechnung hängt an und ist auch online abrufbar: {link}

Falls Sie in der Zwischenzeit bezahlt haben, ist diese Mahnung gegenstandslos.

Mit freundlichen Grüßen
{absender}`,
};

export function dunningEmailValues(input: {
  kind: InvoiceKind;
  number: string;
  issueDate: string;
  dueDate: string;
  asOf: string;
  claim: DunningClaim;
  link: string;
  sender: string;
  customer: string;
}) {
  return {
    art: INVOICE_KIND_LABELS[input.kind],
    nummer: input.number,
    datum: germanDate(input.issueDate),
    faellig: germanDate(input.dueDate),
    frist: germanDate(input.claim.deadline),
    betrag: formatCents(input.claim.openCents),
    gesamt: formatCents(input.claim.totalCents),
    aufstellung: claimBreakdown(input.claim, input.dueDate, input.asOf),
    link: input.link,
    absender: input.sender,
    kunde: input.customer,
  };
}
