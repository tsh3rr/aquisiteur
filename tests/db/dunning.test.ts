import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { billingSettingsSchema } from "@/domain/billing";
import { billingProfileSchema } from "@/domain/invoices/schema";
import { getInfra } from "@/infra";
import { publishExpose } from "@/server/exposes/publish";
import {
  discardReminder,
  loadInvoiceDunning,
  prepareReminder,
  runDunning,
  sendReminderEmail,
} from "@/server/invoices/dunning";
import {
  addPayment,
  cancelInvoice,
  createInvoice,
  issueInvoice,
  listInvoices,
  saveInvoiceDraft,
} from "@/server/invoices/manage";
import { loadInvoiceDelivery, sendInvoiceEmail } from "@/server/invoices/send";
import { restrictProspect } from "@/server/prospects/mutations";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 phase 7c-4: payment reminders, dunning letters, interest and fee, approval. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

// Dates before every other DB test's invoices, so the global job only finds ours.
const issued = new Date("2026-03-02T09:00:00Z");
const at = (date: string) => new Date(`${date}T08:00:00Z`);
const pdf = new TextEncoder().encode("%PDF-1.7 test invoice");
const mona = { id: "user-mona", email: "mona@mahnung.test", name: "Mona" };
let ws = "";
let actor: Actor;
let prospectId = "";
let invoiceId = "";
let second = "";
let third = "";

const send = vi.spyOn(getInfra().email, "send");
vi.spyOn(getInfra().push, "send");

const asMona = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: mona.id, workspaceId: ws }, fn);

async function setBilling(patch: Record<string, unknown>) {
  await db
    .update(schema.workspaceSettings)
    .set({
      billing: billingSettingsSchema.parse({
        taxMode: "small_business",
        iban: "AT611904300234573201",
        paymentTermsDays: 14,
        lateInterest: true,
        collectionFee: true,
        ...patch,
      }),
    })
    .where(eq(schema.workspaceSettings.workspaceId, ws));
}

async function issuedInvoice(now: Date, cents = 120_000): Promise<string> {
  const id = (await asMona((tx) => createInvoice(tx, actor, { prospectId }, now)))!;
  await asMona(async (tx) => {
    const [row] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, id));
    await saveInvoiceDraft(tx, actor, id, {
      ...(row!.document as object),
      lines: [{ id: "web", title: "Website", unitPriceCents: cents }],
    });
  });
  const result = await asMona((tx) => issueInvoice(tx, actor, id, now));
  if (!("ok" in result) || !result.ok) throw new Error("issue failed");
  return id;
}

async function remindersOf(id: string) {
  return db
    .select()
    .from(schema.invoiceReminders)
    .where(eq(schema.invoiceReminders.invoiceId, id))
    .orderBy(schema.invoiceReminders.level);
}

async function reminderTasks(id: string) {
  return db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.invoiceId, id), eq(schema.tasks.workspaceId, ws)));
}

const tenant = <T>(fn: (tx: Transaction) => Promise<T>) => asMona(fn);

beforeAll(async () => {
  await db.insert(schema.users).values([mona]);
  const created = await createWorkspace(db, {
    userId: mona.id,
    name: "Studio Mahn",
    slug: "studio-mahnung-m",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: mona.id, role: "owner", workspaceId: ws };
  await db
    .update(schema.workspaceSettings)
    .set({
      senderAddress: {
        company: "Studio Mahn",
        street: "Hauptstraße 1",
        postalCode: "1010",
        city: "Wien",
        country: "AT",
      },
    })
    .where(eq(schema.workspaceSettings.workspaceId, ws));
  await setBilling({});
  const published = await asMona((tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: mona.id, source: "api" },
      { document: minimalExpose("tischlerei-m", "Tischlerei M"), assets: [] },
    ),
  );
  prospectId = published.prospectId;
  await db
    .update(schema.prospects)
    .set({
      street: "Gasse 2",
      postalCode: "8010",
      city: "Graz",
      country: "AT",
      billing: billingProfileSchema.parse({
        customerType: "business",
        email: "buchhaltung@tischlerei.test",
      }),
    })
    .where(eq(schema.prospects.id, prospectId));
  invoiceId = await issuedInvoice(issued);
});

afterAll(async () => {
  await close();
});

describe("dunning", () => {
  it("drafts the reminder three days after the due date and asks for approval", async () => {
    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));
    expect(invoice!.dueDate).toBe("2026-03-16");
    expect(await runDunning(db, at("2026-03-18"))).toEqual({ drafted: 0, sent: 0, approvals: 0 });
    expect(await runDunning(db, at("2026-03-19"))).toEqual({ drafted: 1, sent: 0, approvals: 1 });
    expect(await runDunning(db, at("2026-03-19"))).toEqual({ drafted: 0, sent: 0, approvals: 0 });
    const [reminder] = await remindersOf(invoiceId);
    expect(reminder).toMatchObject({
      level: 1,
      status: "draft",
      openCents: 120_000,
      interestCents: 0,
      feeCents: 0,
      deadline: "2026-03-26",
    });
    const tasks = await reminderTasks(invoiceId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.reminderId).toBe(reminder!.id);
    expect(tasks[0]!.title).toMatch(/^Zahlungserinnerung zur Rechnung RE-2026-\d{4} freigeben$/);
    // The invoice's own shipping section does not count the reminder's task.
    const delivery = await asMona((tx) => loadInvoiceDelivery(tx, ws, invoiceId));
    expect(delivery!.openApprovals).toBe(0);
  });

  it("sends the reminder with the invoice PDF and closes the task", async () => {
    const dunning = await asMona((tx) => loadInvoiceDunning(tx, ws, invoiceId, at("2026-03-19")));
    const draft = dunning!.draft!;
    expect(draft.openApproval).toBe(true);
    expect(draft.mail.to).toBe("buchhaltung@tischlerei.test");
    expect(draft.mail.subject).toMatch(/^Zahlungserinnerung: Rechnung RE-2026-\d{4}$/);
    expect(draft.mail.body).toContain("Offener Betrag: 1.200,00 €");
    expect(draft.mail.body).toContain("bis 26.03.2026");
    expect(draft.mail.body).toMatch(/\/r\/[0-9A-Za-z]{22}/);
    const input = { reminderId: draft.reminder.id, ...draft.mail, claimKey: draft.claimKey };

    expect(
      await sendReminderEmail(tenant, actor, { ...input, pdf: null }, at("2026-03-19")),
    ).toEqual({ ok: false, error: "pdf_missing" });
    send.mockResolvedValueOnce({ id: "re_reminder_1" });
    expect(await sendReminderEmail(tenant, actor, { ...input, pdf }, at("2026-03-19"))).toEqual({
      ok: true,
      level: 1,
    });
    const message = send.mock.calls.at(-1)![0];
    expect(message.to).toBe("buchhaltung@tischlerei.test");
    expect(message.attachments![0]!.filename).toMatch(/^RE-2026-\d{4}\.pdf$/);
    expect(message.html).toContain("<a href=");

    const [reminder] = await remindersOf(invoiceId);
    expect(reminder).toMatchObject({ status: "sent", sentBy: mona.id });
    expect((await reminderTasks(invoiceId))[0]!.doneAt).not.toBeNull();
    const [mail] = await db
      .select()
      .from(schema.outboundEmails)
      .where(eq(schema.outboundEmails.reminderId, reminder!.id));
    expect(mail).toMatchObject({ kind: "reminder", invoiceId, status: "sent" });
    // Sent once: a second send of the same reminder is refused.
    expect(await sendReminderEmail(tenant, actor, { ...input, pdf }, at("2026-03-19"))).toEqual({
      ok: false,
      error: "not_found",
    });
    const [row] = await asMona((tx) => listInvoices(tx, ws, {}, at("2026-03-19")));
    expect(row!.dunningLevel).toBe(1);
  });

  it("adds § 456 interest and the § 458 fee from the first dunning letter on", async () => {
    await asMona((tx) =>
      addPayment(tx, actor, invoiceId, { amountCents: 20_000, paidOn: "2026-03-25" }),
    );
    // Due 14 days after the due date, and the reminder's deadline (26.03.) has passed.
    expect(await runDunning(db, at("2026-03-29"))).toMatchObject({ drafted: 0 });
    expect(await runDunning(db, at("2026-03-30"))).toEqual({ drafted: 1, sent: 0, approvals: 1 });
    const [, letter] = await remindersOf(invoiceId);
    // 1.000 € × 10,73 % × 14 / 365 = 4,12 €
    expect(letter).toMatchObject({
      level: 2,
      openCents: 100_000,
      interestRateBp: 1073,
      interestCents: 412,
      feeCents: 4000,
      deadline: "2026-04-06",
    });
    const dunning = await asMona((tx) => loadInvoiceDunning(tx, ws, invoiceId, at("2026-03-30")));
    expect(dunning!.draft!.mail.subject).toMatch(/^1\. Mahnung: Rechnung/);
    expect(dunning!.draft!.mail.body).toContain(
      "Verzugszinsen 10,73 % p. a. (§ 456 UGB) vom 17.03.2026 bis 30.03.2026: 4,12 €",
    );
    expect(dunning!.draft!.mail.body).toContain("Gesamt: 1.044,12 €");
  });

  it("drops a waiting draft and its task once the invoice is paid", async () => {
    const [, letter] = await remindersOf(invoiceId);
    await asMona((tx) =>
      addPayment(tx, actor, invoiceId, { amountCents: 100_000, paidOn: "2026-04-01" }),
    );
    // Set aside, not deleted: its log stays, and the task is done.
    expect((await remindersOf(invoiceId)).map((reminder) => reminder.status)).toEqual([
      "sent",
      "skipped",
    ]);
    const tasks = await reminderTasks(invoiceId);
    expect(tasks.find((task) => task.reminderId === letter!.id)!.doneAt).not.toBeNull();
    expect(await runDunning(db, at("2026-05-01"))).toMatchObject({ drafted: 0 });
  });

  it("sends by itself in automatic mode once the PDF is stored", async () => {
    await setBilling({ dunningMode: "auto" });
    second = await issuedInvoice(at("2026-04-01"), 50_000);
    send.mockResolvedValueOnce({ id: "re_invoice_2" });
    const sent = await sendInvoiceEmail(
      tenant,
      actor,
      {
        invoiceId: second,
        to: "chef@tischlerei.test",
        subject: "Ihre Rechnung",
        body: "Anbei die Rechnung, Link {link}.",
        pdf,
      },
      at("2026-04-01"),
    );
    expect(sent.ok).toBe(true);
    send.mockResolvedValueOnce({ id: "re_reminder_2" });
    expect(await runDunning(db, at("2026-04-18"))).toEqual({ drafted: 1, sent: 1, approvals: 0 });
    // To the address the invoice went to.
    expect(send.mock.calls.at(-1)![0].to).toBe("chef@tischlerei.test");
    expect(await remindersOf(second)).toEqual([
      expect.objectContaining({ level: 1, status: "sent" }),
    ]);

    // By hand, the next level can come earlier than planned, and a draft can be discarded.
    const early = await asMona((tx) => prepareReminder(tx, actor, second, at("2026-04-20")));
    expect(early).toMatchObject({ ok: true, level: 2 });
    expect(await asMona((tx) => prepareReminder(tx, actor, second, at("2026-04-20")))).toEqual({
      ok: false,
      error: "waiting",
    });
    if (!early.ok) throw new Error("unreachable");
    // Discarding pauses the level for one payment deadline instead of drafting it again within the hour.
    expect(
      await asMona((tx) => discardReminder(tx, actor, early.reminderId, at("2026-04-20"))),
    ).toEqual({ invoiceId: second, until: "2026-04-27" });
    expect((await remindersOf(second)).map((reminder) => reminder.status)).toEqual([
      "sent",
      "skipped",
    ]);
    expect(await runDunning(db, at("2026-04-27"))).toMatchObject({ drafted: 0 });
  });

  it("charges consumers nothing, drafts without a task in manual mode and nothing when off", async () => {
    await setBilling({ dunningMode: "manual" });
    await db
      .update(schema.prospects)
      .set({ billing: billingProfileSchema.parse({ customerType: "consumer" }) })
      .where(eq(schema.prospects.id, prospectId));
    third = await issuedInvoice(at("2026-05-04"), 30_000);
    // The second invoice's next level is due too (deadline 25.04. passed, 14 days after due).
    expect(await runDunning(db, at("2026-05-21"))).toEqual({ drafted: 2, sent: 0, approvals: 0 });
    const [letter] = (await remindersOf(second)).filter((reminder) => reminder.level === 2);
    expect(letter).toMatchObject({ interestCents: 0, feeCents: 0, interestRateBp: null });
    expect(await reminderTasks(third)).toEqual([]);

    await setBilling({ dunningMode: "off" });
    await db.delete(schema.invoiceReminders).where(eq(schema.invoiceReminders.invoiceId, third));
    expect(await runDunning(db, at("2026-05-22"))).toMatchObject({ drafted: 0 });
    const dunning = await asMona((tx) => loadInvoiceDunning(tx, ws, third, at("2026-05-22")));
    expect(dunning).toMatchObject({ mode: "off", next: { level: 1 }, draft: null });
  });

  it("refuses a stale text and a second send, and stops for cancelled or restricted invoices", async () => {
    await setBilling({ dunningMode: "approval" });
    await db
      .update(schema.prospects)
      .set({ billing: billingProfileSchema.parse({ customerType: "business" }) })
      .where(eq(schema.prospects.id, prospectId));
    // The third invoice's reminder came back (it was cleared above); the second one's letter waits.
    expect(await runDunning(db, at("2026-05-22"))).toEqual({ drafted: 1, sent: 0, approvals: 1 });
    const dunning = await asMona((tx) => loadInvoiceDunning(tx, ws, third, at("2026-05-22")));
    const draft = dunning!.draft!;
    await asMona((tx) =>
      addPayment(tx, actor, third, { amountCents: 10_000, paidOn: "2026-05-22" }),
    );
    const input = { reminderId: draft.reminder.id, ...draft.mail, pdf, claimKey: draft.claimKey };
    expect(await sendReminderEmail(tenant, actor, input, at("2026-05-22"))).toEqual({
      ok: false,
      error: "changed",
    });

    // A mail of this reminder that already went out blocks another one.
    const fresh = await asMona((tx) => loadInvoiceDunning(tx, ws, third, at("2026-05-22")));
    await db.insert(schema.outboundEmails).values({
      workspaceId: ws,
      kind: "reminder",
      prospectId,
      invoiceId: third,
      reminderId: draft.reminder.id,
      toAddress: "chef@tischlerei.test",
      subject: "Zahlungserinnerung",
      messageId: "<earlier@mail.test>",
      status: "delivered",
    });
    expect(
      await sendReminderEmail(
        tenant,
        actor,
        { ...input, claimKey: fresh!.draft!.claimKey },
        at("2026-05-22"),
      ),
    ).toEqual({ ok: false, error: "sending" });

    // A cancellation sets the waiting draft aside and closes its task.
    const cancelled = await asMona((tx) => cancelInvoice(tx, actor, third, at("2026-05-22")));
    expect(cancelled.ok).toBe(true);
    expect((await remindersOf(third)).map((reminder) => reminder.status)).toEqual(["skipped"]);
    expect(
      (await reminderTasks(third)).every((task) => !task.reminderId || task.doneAt !== null),
    ).toBe(true);

    // Sperrvermerk: no more reminders, and the waiting letter of the second invoice cannot go out.
    const [letter] = (await remindersOf(second)).filter((reminder) => reminder.status === "draft");
    expect(await asMona((tx) => restrictProspect(tx, actor, prospectId, at("2026-05-22")))).toBe(
      true,
    );
    expect(
      await sendReminderEmail(
        tenant,
        actor,
        {
          reminderId: letter!.id,
          to: "x@tischlerei.test",
          subject: "Mahnung",
          body: "Bitte zahlen Sie.",
          pdf,
          claimKey: null,
        },
        at("2026-05-22"),
      ),
    ).toEqual({ ok: false, error: "restricted" });
    expect(await runDunning(db, at("2026-06-30"))).toMatchObject({ drafted: 0 });
  });
});
