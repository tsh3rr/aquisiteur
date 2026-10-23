"use client";

import { BellRing, CalendarClock, Check, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  useActionState,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  deleteTaskAction,
  saveTaskAction,
  setTaskDoneAction,
  snoozeTaskAction,
  type TaskFormState,
} from "@/app/(cockpit)/aufgaben/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { taskAnchor } from "@/domain/notifications";
import {
  addDays,
  formatDue,
  REMINDER_LABELS,
  snoozeDates,
  TASK_REMINDERS,
  taskBucket,
  type TaskReminder,
} from "@/domain/tasks";
import { cn } from "@/lib/cn";

/** A task as the cockpit shows it; dates as strings so it crosses the server boundary. */
export interface TaskItemView {
  id: string;
  prospectId: string;
  /** „Rechnung freigeben“ links to its invoice (7c-2). */
  invoiceId?: string | null;
  /** „Zahlungserinnerung/Mahnung freigeben“ links to the invoice's dunning section (7c-4). */
  reminderId?: string | null;
  companyName: string;
  title: string;
  note: string | null;
  dueDate: string;
  dueTime: string | null;
  reminder: TaskReminder;
  /** ISO; null without reminder. */
  remindAt: string | null;
  done: boolean;
  doNotContact: boolean;
}

/** „now“ and the workspace's time zone, fixed on the server so both renders agree. */
export interface Clock {
  now: string;
  timeZone: string;
}

const reminderTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("de-DE", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Tasks with a done toggle, „Morgen“ and inline editing (§7.8). */
export function TaskList({
  tasks,
  clock,
  showCompany = false,
  canManage,
  label,
}: {
  tasks: TaskItemView[];
  clock: Clock;
  showCompany?: boolean;
  canManage: boolean;
  label: string;
}) {
  return (
    <ul className="grid gap-2" aria-label={label}>
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          clock={clock}
          showCompany={showCompany}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

function TaskItem({
  task,
  clock,
  showCompany,
  canManage,
}: {
  task: TaskItemView;
  clock: Clock;
  showCompany: boolean;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);
  const [done, setDone] = useOptimistic(task.done);
  const [pending, startTransition] = useTransition();
  const now = new Date(clock.now);
  const bucket = taskBucket(task, now, clock.timeZone);
  const overdue = !done && bucket === "overdue";

  if (editing) {
    return (
      <li className="rounded-xl border border-border-strong bg-surface p-4">
        <TaskForm
          task={task}
          prospectId={task.prospectId}
          clock={clock}
          onClose={() => {
            refocus.current = true;
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li
      id={taskAnchor(task.id)}
      className={cn(
        "flex scroll-mt-24 items-start gap-3 rounded-xl border border-border bg-surface p-3 transition-shadow sm:p-4",
        "target:border-accent target:ring-2 target:ring-accent/40",
        done && "bg-surface-sunken/60",
      )}
    >
      <button
        type="button"
        disabled={!canManage || pending}
        aria-pressed={done}
        aria-label={`Erledigt: ${task.title}`}
        onClick={() =>
          startTransition(async () => {
            setDone(!done);
            await setTaskDoneAction(task.id, !done, task.prospectId);
          })
        }
        className="group -m-1.5 grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus-ring disabled:cursor-not-allowed"
      >
        <span
          aria-hidden
          className={cn(
            "grid size-6 place-items-center rounded-full border-2 transition-colors",
            done
              ? "border-success bg-success text-accent-foreground"
              : overdue
                ? "border-danger group-hover:bg-danger-soft"
                : "border-border-strong group-hover:border-accent group-hover:bg-accent-soft",
          )}
        >
          <Check
            className={cn("size-3.5", done ? "opacity-100" : "opacity-0 group-hover:opacity-60")}
            strokeWidth={3}
          />
        </span>
      </button>

      <div className="grid min-w-0 flex-1 gap-1 pt-1.5">
        <p className={cn("font-medium break-words", done && "text-foreground-muted line-through")}>
          {task.title}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-muted">
          {showCompany ? (
            <Link
              href={`/kunden/${task.prospectId}#${taskAnchor(task.id)}`}
              className="inline-flex min-h-6 items-center font-medium text-accent underline-offset-4 hover:underline"
            >
              {task.companyName}
            </Link>
          ) : null}
          {task.invoiceId ? (
            <Link
              href={`/rechnungen/${task.invoiceId}#${task.reminderId ? "mahnungen" : "versand"}`}
              className="inline-flex min-h-6 items-center font-medium text-accent underline-offset-4 hover:underline"
            >
              Rechnung öffnen
            </Link>
          ) : null}
          {overdue ? (
            <Badge tone="danger">Überfällig · {formatDue(task, now, clock.timeZone)}</Badge>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CalendarClock aria-hidden className="size-3.5" />
              <span className="sr-only">Fällig </span>
              {formatDue(task, now, clock.timeZone)}
            </span>
          )}
          {!done && task.remindAt && new Date(task.remindAt) > now ? (
            <span className="inline-flex items-center gap-1">
              <BellRing aria-hidden className="size-3.5" />
              <span className="sr-only">Erinnerung</span>
              {reminderTime(task.remindAt, clock.timeZone)}
            </span>
          ) : null}
          {task.doNotContact ? <Badge tone="warning">Sperrvermerk</Badge> : null}
        </p>
        {task.note ? (
          <p className="text-sm whitespace-pre-line text-foreground-muted">{task.note}</p>
        ) : null}
        {canManage && !done && bucket !== "upcoming" ? (
          // On phones the button sits under the text, so the title keeps the width.
          <SnoozeButton
            task={task}
            disabled={pending}
            onSnooze={() =>
              startTransition(() =>
                snoozeTaskAction(task.id, "tomorrow", task.prospectId).then(() => {}),
              )
            }
            className="-ml-3 justify-self-start sm:hidden"
          />
        ) : null}
      </div>

      {canManage && !done ? (
        <div className="-my-1 flex shrink-0 gap-1">
          {bucket !== "upcoming" ? (
            <SnoozeButton
              task={task}
              disabled={pending}
              onSnooze={() =>
                startTransition(() =>
                  snoozeTaskAction(task.id, "tomorrow", task.prospectId).then(() => {}),
                )
              }
              className="max-sm:hidden"
            />
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            ref={editButton}
            aria-label={`${task.title} bearbeiten`}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function SnoozeButton({
  task,
  disabled,
  onSnooze,
  className,
}: {
  task: TaskItemView;
  disabled: boolean;
  onSnooze: () => void;
  className?: string;
}) {
  return (
    <Button variant="ghost" size="sm" disabled={disabled} onClick={onSnooze} className={className}>
      <CalendarClock aria-hidden />
      Morgen
      <span className="sr-only">: {task.title} verschieben</span>
    </Button>
  );
}

/** „Aufgabe hinzufügen“ button that opens the form in place. */
export function AddTask({ prospectId, clock }: { prospectId: string; clock: Clock }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    // Keyboard and screen-reader users land back on the button, not at the top of the page.
    if (!open && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [open]);
  const close = (message?: string) => {
    refocus.current = true;
    setStatus(message ?? "");
    setOpen(false);
  };
  return (
    <>
      {open ? (
        <div className="rounded-xl border border-border-strong p-4">
          <TaskForm prospectId={prospectId} clock={clock} onClose={close} />
        </div>
      ) : (
        <Button
          ref={button}
          variant="secondary"
          size="sm"
          className="justify-self-start"
          onClick={() => {
            setStatus("");
            setOpen(true);
          }}
        >
          <Plus aria-hidden />
          Aufgabe hinzufügen
        </Button>
      )}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </>
  );
}

export function TaskForm({
  task,
  prospectId,
  clock,
  onClose,
}: {
  task?: TaskItemView;
  prospectId: string;
  clock: Clock;
  /** `message` is announced, e.g. „Aufgabe angelegt.“ */
  onClose: (message?: string) => void;
}) {
  const [state, action, pending] = useActionState<TaskFormState, FormData>(saveTaskAction, {
    ok: false,
  });
  const [deleting, startDelete] = useTransition();
  const now = new Date(clock.now);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.timeZone,
    dateStyle: "short",
  }).format(now);
  const { tomorrow, nextWeek } = snoozeDates(now, clock.timeZone);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? addDays(today, 1));
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [reminder, setReminder] = useState<TaskReminder>(task?.reminder ?? "at_due");
  const titleId = useId();

  useEffect(() => {
    if (state.ok && state.savedAt) onClose(state.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per save
  }, [state.savedAt]);

  const quick = [
    { label: "Heute", date: today },
    { label: "Morgen", date: tomorrow },
    { label: "Nächste Woche", date: nextWeek },
  ];
  const kind = dueTime ? "timed" : "allDay";
  // Without a clock time „1 Stunde vorher“ means the same as „zur Fälligkeit“.
  const reminders = TASK_REMINDERS.filter((value) => dueTime || value !== "hour_before");

  return (
    <form action={action} className="grid gap-4" aria-labelledby={titleId}>
      <h3 id={titleId} className="sr-only">
        {task ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
      </h3>
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      <input type="hidden" name="prospectId" value={prospectId} />
      <Field label="Aufgabe" error={state.errors?.title}>
        <Input
          name="title"
          defaultValue={task?.title}
          maxLength={200}
          required
          autoComplete="off"
          placeholder="z. B. Anrufen und Termin vorschlagen"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opened on purpose by the user
          autoFocus
        />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Fällig</legend>
        <div className="flex flex-wrap gap-2">
          {quick.map((option) => (
            <Button
              key={option.label}
              variant="secondary"
              size="sm"
              aria-pressed={dueDate === option.date}
              className="aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-foreground"
              onClick={() => setDueDate(option.date)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Datum" error={state.errors?.dueDate} className="grid-cols-1">
            <Input
              type="date"
              name="dueDate"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              required
            />
          </Field>
          <Field label="Uhrzeit" optional error={state.errors?.dueTime} className="grid-cols-1">
            <Input
              type="time"
              name="dueTime"
              value={dueTime}
              onChange={(event) => {
                setDueTime(event.target.value);
                if (!event.target.value && reminder === "hour_before") setReminder("at_due");
              }}
            />
          </Field>
        </div>
      </fieldset>

      <Field
        label="Erinnerung"
        hint="Per Push und E-Mail, Tippen öffnet die Aufgabe."
        error={state.errors?.reminder}
      >
        <Select
          name="reminder"
          value={reminder}
          onChange={(event) => setReminder(event.target.value as TaskReminder)}
        >
          {reminders.map((value) => (
            <option key={value} value={value}>
              {REMINDER_LABELS[value][kind]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Notiz" optional error={state.errors?.note}>
        <Textarea
          name="note"
          defaultValue={task?.note ?? ""}
          maxLength={2000}
          rows={2}
          className="min-h-16"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {task ? "Speichern" : "Anlegen"}
        </Button>
        <Button variant="ghost" onClick={() => onClose()}>
          Abbrechen
        </Button>
        {task ? (
          <Button
            variant="ghost"
            className="ml-auto text-danger hover:text-danger"
            disabled={deleting}
            onClick={() =>
              startDelete(async () => {
                if (await deleteTaskAction(task.id, task.prospectId)) onClose("Aufgabe gelöscht.");
              })
            }
          >
            <Trash2 aria-hidden />
            Löschen
          </Button>
        ) : null}
        <p aria-live="polite" className="basis-full text-sm text-foreground-muted empty:hidden">
          {state.ok ? "" : state.message}
        </p>
      </div>
    </form>
  );
}
