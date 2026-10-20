import { z } from "zod";

/**
 * Tasks and follow-ups (§7.8 „Aufgaben/Wiedervorlagen mit Fälligkeit und
 * Erinnerung“). Pure: due dates are local calendar dates with an optional
 * clock time, reminders become an instant in the workspace's time zone.
 */

export const TASK_REMINDERS = ["none", "at_due", "hour_before", "day_before"] as const;
export type TaskReminder = (typeof TASK_REMINDERS)[number];

/** Without a clock time, „at due“ and „day before“ fire at this hour. */
export const ALL_DAY_REMINDER_HOUR = 8;

export const REMINDER_LABELS: Record<TaskReminder, { timed: string; allDay: string }> = {
  none: { timed: "Keine Erinnerung", allDay: "Keine Erinnerung" },
  at_due: { timed: "Zur Fälligkeit", allDay: "Am Tag um 8:00" },
  hour_before: { timed: "1 Stunde vorher", allDay: "Am Tag um 8:00" },
  day_before: { timed: "Am Vortag, gleiche Uhrzeit", allDay: "Am Vortag um 8:00" },
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "2026-10-23", and a day that exists (no 31 February). */
function isCalendarDate(value: string): boolean {
  if (!isoDate.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export const taskFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Bitte beschreiben Sie die Aufgabe.")
    .max(200, "Höchstens 200 Zeichen."),
  note: z
    .string()
    .trim()
    .max(2000, "Höchstens 2000 Zeichen.")
    .optional()
    .transform((value) => value || null),
  dueDate: z.string().refine(isCalendarDate, "Bitte ein gültiges Datum wählen."),
  dueTime: z
    .union([z.string().regex(clock, "Bitte als Uhrzeit angeben, z. B. 14:00."), z.literal("")])
    .optional()
    .transform((value) => value || null),
  reminder: z.enum(TASK_REMINDERS).default("at_due"),
});
export type TaskForm = z.output<typeof taskFormSchema>;

/** "2026-10-16" in the given time zone. */
export function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(now);
}

/** "14:05" in the given time zone. */
export function localTimeString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Berlin summer: 120). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The instant of a local wall-clock time, e.g. 2026-10-23 14:00 in Berlin. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  // Two passes settle the offset around DST changes.
  let instant = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  instant = wall - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** Shifts a local calendar date by whole days. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

const hourClock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** When to remind, or null for none. */
export function reminderAt(
  task: { dueDate: string; dueTime: string | null; reminder: TaskReminder },
  timeZone: string,
): Date | null {
  const { dueDate, dueTime, reminder } = task;
  if (reminder === "none") return null;
  if (!dueTime) {
    const date = reminder === "day_before" ? addDays(dueDate, -1) : dueDate;
    return zonedInstant(date, hourClock(ALL_DAY_REMINDER_HOUR), timeZone);
  }
  const due = zonedInstant(dueDate, dueTime, timeZone);
  if (reminder === "hour_before") return new Date(due.getTime() - 3_600_000);
  if (reminder === "day_before") return zonedInstant(addDays(dueDate, -1), dueTime, timeZone);
  return due;
}

export type TaskBucket = "overdue" | "today" | "upcoming";

/**
 * Overdue: an earlier day, or today with a clock time that has passed.
 * All-day tasks stay „today“ until the day is over.
 */
export function taskBucket(
  task: { dueDate: string; dueTime: string | null },
  now: Date,
  timeZone: string,
): TaskBucket {
  const today = localDateString(now, timeZone);
  if (task.dueDate < today) return "overdue";
  if (task.dueDate > today) return "upcoming";
  if (task.dueTime && task.dueTime <= localTimeString(now, timeZone)) return "overdue";
  return "today";
}

/** Open tasks first by date, then timed before all-day within a day. */
export function compareTasks(
  a: { dueDate: string; dueTime: string | null },
  b: { dueDate: string; dueTime: string | null },
): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99");
}

const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** „heute 14:00“, „morgen“, „Freitag“, „gestern“, „Mo., 2. Nov.“ */
export function formatDue(
  task: { dueDate: string; dueTime: string | null },
  now: Date,
  timeZone: string,
): string {
  const today = localDateString(now, timeZone);
  const date = new Date(`${task.dueDate}T00:00:00Z`);
  const days = Math.round((date.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const day =
    days === 0
      ? "heute"
      : days === 1
        ? "morgen"
        : days === -1
          ? "gestern"
          : days > 1 && days < 7
            ? weekday.format(date)
            : shortDate.format(date);
  return task.dueTime ? `${day} ${task.dueTime}` : day;
}

/** Quick „Verschieben“ targets: tomorrow and next Monday. */
export function snoozeDates(now: Date, timeZone: string): { tomorrow: string; nextWeek: string } {
  const today = localDateString(now, timeZone);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const untilMonday = dow === 1 ? 7 : (8 - dow) % 7;
  return { tomorrow: addDays(today, 1), nextWeek: addDays(today, untilMonday) };
}
