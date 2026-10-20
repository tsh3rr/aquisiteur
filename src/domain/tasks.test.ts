import { describe, expect, it } from "vitest";
import {
  addDays,
  compareTasks,
  formatDue,
  reminderAt,
  snoozeDates,
  taskBucket,
  taskFormSchema,
  zonedInstant,
} from "./tasks";

const TZ = "Europe/Berlin";
const at = (iso: string) => new Date(iso);

describe("zoned times", () => {
  it("turns a Berlin wall clock into the right instant, summer and winter", () => {
    expect(zonedInstant("2026-10-23", "14:00", TZ).toISOString()).toBe("2026-10-23T12:00:00.000Z");
    expect(zonedInstant("2026-11-06", "14:00", TZ).toISOString()).toBe("2026-11-06T13:00:00.000Z");
  });

  it("survives the night the clocks go back", () => {
    // 25 October 2026, 03:00 CEST → 02:00 CET.
    expect(zonedInstant("2026-10-25", "08:00", TZ).toISOString()).toBe("2026-10-25T07:00:00.000Z");
    expect(zonedInstant("2026-10-24", "08:00", TZ).toISOString()).toBe("2026-10-24T06:00:00.000Z");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("reminders", () => {
  const timed = { dueDate: "2026-10-23", dueTime: "10:00" };
  const allDay = { dueDate: "2026-10-23", dueTime: null };

  it("fires at, an hour before or a day before a timed task", () => {
    expect(reminderAt({ ...timed, reminder: "at_due" }, TZ)?.toISOString()).toBe(
      "2026-10-23T08:00:00.000Z",
    );
    expect(reminderAt({ ...timed, reminder: "hour_before" }, TZ)?.toISOString()).toBe(
      "2026-10-23T07:00:00.000Z",
    );
    expect(reminderAt({ ...timed, reminder: "day_before" }, TZ)?.toISOString()).toBe(
      "2026-10-22T08:00:00.000Z",
    );
  });

  it("uses 8:00 for all-day tasks and nothing for „none“", () => {
    expect(reminderAt({ ...allDay, reminder: "at_due" }, TZ)?.toISOString()).toBe(
      "2026-10-23T06:00:00.000Z",
    );
    expect(reminderAt({ ...allDay, reminder: "day_before" }, TZ)?.toISOString()).toBe(
      "2026-10-22T06:00:00.000Z",
    );
    expect(reminderAt({ ...allDay, reminder: "none" }, TZ)).toBeNull();
  });
});

describe("due state", () => {
  const now = at("2026-10-20T13:30:00Z"); // Tuesday 15:30 in Berlin

  it("buckets by local date and clock", () => {
    expect(taskBucket({ dueDate: "2026-10-19", dueTime: null }, now, TZ)).toBe("overdue");
    expect(taskBucket({ dueDate: "2026-10-20", dueTime: "15:00" }, now, TZ)).toBe("overdue");
    expect(taskBucket({ dueDate: "2026-10-20", dueTime: "16:00" }, now, TZ)).toBe("today");
    expect(taskBucket({ dueDate: "2026-10-20", dueTime: null }, now, TZ)).toBe("today");
    expect(taskBucket({ dueDate: "2026-10-21", dueTime: null }, now, TZ)).toBe("upcoming");
  });

  it("reads like a person would say it", () => {
    expect(formatDue({ dueDate: "2026-10-20", dueTime: "15:00" }, now, TZ)).toBe("heute 15:00");
    expect(formatDue({ dueDate: "2026-10-21", dueTime: null }, now, TZ)).toBe("morgen");
    expect(formatDue({ dueDate: "2026-10-19", dueTime: null }, now, TZ)).toBe("gestern");
    expect(formatDue({ dueDate: "2026-10-23", dueTime: "10:00" }, now, TZ)).toBe("Freitag 10:00");
    expect(formatDue({ dueDate: "2026-11-02", dueTime: null }, now, TZ)).toBe("Mo., 2. Nov.");
  });

  it("sorts by day, timed before all-day", () => {
    const tasks = [
      { dueDate: "2026-10-21", dueTime: null },
      { dueDate: "2026-10-20", dueTime: null },
      { dueDate: "2026-10-20", dueTime: "09:00" },
    ];
    expect(tasks.sort(compareTasks)).toEqual([
      { dueDate: "2026-10-20", dueTime: "09:00" },
      { dueDate: "2026-10-20", dueTime: null },
      { dueDate: "2026-10-21", dueTime: null },
    ]);
  });

  it("snoozes to tomorrow and to next Monday", () => {
    expect(snoozeDates(now, TZ)).toEqual({ tomorrow: "2026-10-21", nextWeek: "2026-10-26" });
    // On a Monday, „next week“ is the Monday after.
    expect(snoozeDates(at("2026-10-26T09:00:00Z"), TZ).nextWeek).toBe("2026-11-02");
    // Sunday 22:00 in Berlin: next week starts tomorrow.
    expect(snoozeDates(at("2026-10-25T21:00:00Z"), TZ).nextWeek).toBe("2026-10-26");
  });
});

describe("form", () => {
  it("accepts an all-day task and defaults the reminder", () => {
    expect(
      taskFormSchema.parse({ title: " Anrufen ", dueDate: "2026-10-23", dueTime: "", note: "" }),
    ).toEqual({
      title: "Anrufen",
      note: null,
      dueDate: "2026-10-23",
      dueTime: null,
      reminder: "at_due",
    });
  });

  it("rejects a missing title, a bad date or time", () => {
    const result = taskFormSchema.safeParse({ title: "", dueDate: "23.10.2026", dueTime: "25:00" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "dueDate",
      "dueTime",
      "title",
    ]);
    expect(taskFormSchema.safeParse({ title: "x", dueDate: "2026-02-31" }).success).toBe(false);
  });
});
