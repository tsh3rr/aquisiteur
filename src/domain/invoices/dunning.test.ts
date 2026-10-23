import { describe, expect, it } from "vitest";
import { billingSettingsSchema } from "../billing";
import {
  claimBreakdown,
  daysAfter,
  dunningClaim,
  dunningEmailValues,
  nextReminder,
  type DunningTerms,
} from "./dunning";
import { fillTemplate } from "./email";

const terms: DunningTerms = {
  days: [3, 14, 28],
  deadlineDays: 7,
  lateInterest: true,
  collectionFee: true,
  baseRatePercent: 1.53,
};

describe("nextReminder", () => {
  it("starts with the reminder three days after the due date", () => {
    expect(nextReminder("2026-10-01", [], terms)).toEqual({ level: 1, dueOn: "2026-10-04" });
  });

  it("waits for the deadline of the previous level", () => {
    // Reminder sent late on 20.10. with a deadline of 27.10.: the first letter waits for 28.10.
    expect(
      nextReminder("2026-10-01", [{ level: 1, status: "sent", deadline: "2026-10-27" }], terms),
    ).toEqual({ level: 2, dueOn: "2026-10-28" });
    // Sent on time, the schedule decides: 14 days after the due date.
    expect(
      nextReminder("2026-10-01", [{ level: 1, status: "sent", deadline: "2026-10-11" }], terms),
    ).toEqual({ level: 2, dueOn: "2026-10-15" });
  });

  it("stops while a draft waits and after the last letter", () => {
    expect(
      nextReminder("2026-10-01", [{ level: 1, status: "draft", deadline: "2026-10-11" }], terms),
    ).toBeNull();
    expect(
      nextReminder(
        "2026-10-01",
        [
          { level: 1, status: "sent", deadline: "2026-10-11" },
          { level: 2, status: "sent", deadline: "2026-10-22" },
          { level: 3, status: "sent", deadline: "2026-11-05" },
        ],
        terms,
      ),
    ).toBeNull();
  });
});

describe("dunningClaim", () => {
  it("charges nothing on the friendly reminder", () => {
    const claim = dunningClaim(
      { level: 1, openCents: 70_000, dueDate: "2026-10-01", asOf: "2026-10-04", business: true },
      terms,
    );
    expect(claim).toMatchObject({ interestCents: 0, feeCents: 0, totalCents: 70_000 });
    expect(claim.deadline).toBe("2026-10-11");
  });

  it("adds § 456 interest and the § 458 fee between businesses", () => {
    const claim = dunningClaim(
      { level: 2, openCents: 70_000, dueDate: "2026-10-01", asOf: "2026-10-15", business: true },
      terms,
    );
    // 700 € × 10,73 % × 14 / 365 = 2,88 €
    expect(claim).toMatchObject({
      interestRateBp: 1073,
      interestDays: 14,
      interestCents: 288,
      feeCents: 4000,
      totalCents: 74_288,
    });
    expect(claimBreakdown(claim, "2026-10-01", "2026-10-15")).toBe(
      [
        "Offener Rechnungsbetrag: 700,00 €",
        "Verzugszinsen 10,73 % p. a. (§ 456 UGB) vom 02.10.2026 bis 15.10.2026: 2,88 €",
        "Pauschale für Betreibungskosten (§ 458 UGB): 40,00 €",
        "Gesamt: 742,88 €",
      ].join("\n"),
    );
  });

  it("never charges consumers or when switched off", () => {
    const consumer = dunningClaim(
      { level: 3, openCents: 70_000, dueDate: "2026-10-01", asOf: "2026-11-01", business: false },
      terms,
    );
    expect(consumer.totalCents).toBe(70_000);
    const off = dunningClaim(
      { level: 3, openCents: 70_000, dueDate: "2026-10-01", asOf: "2026-11-01", business: true },
      { ...terms, lateInterest: false, collectionFee: false },
    );
    expect(off).toMatchObject({ interestRateBp: null, totalCents: 70_000 });
    expect(claimBreakdown(off, "2026-10-01", "2026-11-01")).toBe("Offener Betrag: 700,00 €");
  });
});

describe("dunning settings and mail", () => {
  it("defaults to approval with 3, 14 and 28 days", () => {
    const billing = billingSettingsSchema.parse({});
    expect(billing).toMatchObject({
      dunningMode: "approval",
      dunningDays: [3, 14, 28],
      dunningDeadlineDays: 7,
      lateInterest: false,
      collectionFee: false,
    });
    expect(billingSettingsSchema.safeParse({ dunningDays: [14, 3, 28] }).success).toBe(false);
  });

  it("fills the placeholders", () => {
    const claim = dunningClaim(
      { level: 1, openCents: 70_000, dueDate: "2026-10-01", asOf: "2026-10-04", business: true },
      terms,
    );
    const values = dunningEmailValues({
      kind: "standard",
      number: "RE-2026-0007",
      issueDate: "2026-09-17",
      dueDate: "2026-10-01",
      asOf: "2026-10-04",
      claim,
      link: "https://example.test/r/abc",
      sender: "Studio Kapek",
      customer: "Café Müller",
    });
    expect(fillTemplate("{art} {nummer} vom {datum}, bitte bis {frist}: {betrag}", values)).toBe(
      "Rechnung RE-2026-0007 vom 17.09.2026, bitte bis 11.10.2026: 700,00 €",
    );
  });

  it("counts days between dates", () => {
    expect(daysAfter("2026-10-01", "2026-10-15")).toBe(14);
    expect(daysAfter("2026-10-15", "2026-10-01")).toBe(0);
  });
});
