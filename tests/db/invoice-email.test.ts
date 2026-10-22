import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, withTenant, type Transaction } from "@/db/client";
import * as schema from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { billingProfileSchema } from "@/domain/invoices/schema";
import { getInfra } from "@/infra";
import { publishExpose } from "@/server/exposes/publish";
import { createInvoice, issueInvoice, saveInvoiceDraft } from "@/server/invoices/manage";
import {
  loadInvoiceDelivery,
  loadPublicInvoice,
  recordEmailEvents,
  requestInvoiceApproval,
  sendInvoiceEmail,
} from "@/server/invoices/send";
import { createWorkspace } from "@/server/workspaces";
import { minimalExpose } from "../support/expose";

/** §7.10 phase 7c-2: invoices by e-mail, the customer's page, delivery status, approval. */

process.env.APP_URL ??= "http://localhost:3000";
process.env.PLATFORM_DOMAIN ??= "localhost";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-42";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;

const { db, close } = createDatabase(process.env.TEST_DATABASE_URL ?? "", { max: 2 });

const mira = { id: "user-mira", email: "mira@versand.test", name: "Mira" };
const now = new Date("2026-10-22T10:00:00Z");
const pdf = new TextEncoder().encode("%PDF-1.7 test invoice");
let ws = "";
let actor: Actor;
let prospectId = "";
let invoiceId = "";

const send = vi.spyOn(getInfra().email, "send");
vi.spyOn(getInfra().push, "send");

const asMira = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withTenant(db, { userId: mira.id, workspaceId: ws }, fn);

beforeAll(async () => {
  await db.insert(schema.users).values([mira]);
  const created = await createWorkspace(db, {
    userId: mira.id,
    name: "Studio M",
    slug: "studio-versand-m",
  });
  if (!created.ok) throw new Error("workspace setup failed");
  ws = created.workspace.id;
  actor = { userId: mira.id, role: "owner", workspaceId: ws };
  await db
    .update(schema.workspaceSettings)
    .set({
      senderAddress: {
        company: "Studio M",
        street: "Hauptstraße 1",
        postalCode: "1010",
        city: "Wien",
        country: "AT",
      },
      billing: { taxMode: "small_business", iban: "AT611904300234573201", paymentTermsDays: 14 },
    })
    .where(eq(schema.workspaceSettings.workspaceId, ws));
  const published = await asMira((tx) =>
    publishExpose(
      tx,
      { workspaceId: ws, userId: mira.id, source: "api" },
      { document: minimalExpose("baeckerei-m", "Bäckerei M"), assets: [] },
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
        email: "buchhaltung@baeckerei.test",
      }),
    })
    .where(eq(schema.prospects.id, prospectId));
  invoiceId = (await asMira((tx) => createInvoice(tx, actor, { prospectId }, now)))!;
  await asMira(async (tx) => {
    const [row] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    await saveInvoiceDraft(tx, actor, invoiceId, {
      ...(row!.document as object),
      lines: [{ id: "web", title: "Website", unitPriceCents: 120_000 }],
    });
  });
  const issued = await asMira((tx) => issueInvoice(tx, actor, invoiceId, now));
  if (!("ok" in issued) || !issued.ok) throw new Error("issue failed");
});

afterAll(async () => {
  await close();
});

describe("invoices by e-mail", () => {
  it("prepares the mail from the settings and the billing profile", async () => {
    const delivery = await asMira((tx) => loadInvoiceDelivery(tx, ws, invoiceId));
    expect(delivery!.draft.to).toBe("buchhaltung@baeckerei.test");
    expect(delivery!.draft.subject).toMatch(/^Rechnung RE-2026-\d{4} von Studio M$/);
    expect(delivery!.draft.body).toContain(delivery!.url);
    expect(delivery!.url).toMatch(/\/r\/[0-9A-Za-z]{22}$/);
    expect(delivery!.pdfStored).toBe(false);
  });

  it("needs the PDF for the first mail, then stores and attaches it", async () => {
    const tenant = <T>(fn: (tx: Transaction) => Promise<T>) => asMira(fn);
    const input = {
      invoiceId,
      to: "kunde@baeckerei.test",
      subject: "Ihre Rechnung",
      body: "Anbei die Rechnung, Link {link}.",
    };
    expect(await sendInvoiceEmail(tenant, actor, { ...input, pdf: null }, now)).toEqual({
      ok: false,
      error: "pdf_missing",
    });
    expect(
      await sendInvoiceEmail(tenant, actor, { ...input, pdf: new Uint8Array([1, 2, 3]) }, now),
    ).toEqual({ ok: false, error: "pdf_invalid" });

    send.mockResolvedValueOnce({ id: "re_first" });
    const sent = await sendInvoiceEmail(tenant, actor, { ...input, pdf }, now);
    expect(sent.ok).toBe(true);
    const message = send.mock.calls.at(-1)![0];
    expect(message.to).toBe("kunde@baeckerei.test");
    expect(message.from).toMatch(/^"Studio M" </);
    expect(message.replyTo).toBe(mira.email);
    expect(message.headers!["Message-ID"]).toMatch(/^<[0-9a-f-]{36}@/);
    expect(message.attachments![0]!.filename).toMatch(/^RE-2026-\d{4}\.pdf$/);
    expect(new TextDecoder().decode(message.attachments![0]!.content)).toBe(
      "%PDF-1.7 test invoice",
    );
    expect(message.text).toMatch(/Link https?:\/\/.+\/r\/[0-9A-Za-z]{22}\./);
    expect(message.html).toContain('<a href="');

    // The second mail reuses the stored file, whatever the browser sends.
    send.mockResolvedValueOnce({ id: "re_second" });
    const other = new TextEncoder().encode("%PDF-1.7 something else");
    expect((await sendInvoiceEmail(tenant, actor, { ...input, pdf: other }, now)).ok).toBe(true);
    expect(new TextDecoder().decode(send.mock.calls.at(-1)![0].attachments![0]!.content)).toBe(
      "%PDF-1.7 test invoice",
    );

    const mails = await db
      .select()
      .from(schema.outboundEmails)
      .where(eq(schema.outboundEmails.invoiceId, invoiceId));
    expect(mails.map((mail) => [mail.providerId, mail.status]).sort()).toEqual([
      ["re_first", "sent"],
      ["re_second", "sent"],
    ]);
    const audit = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, invoiceId));
    expect(audit.filter((row) => row.action === "invoice.sent")).toHaveLength(2);
  });

  it("records a refused mail as failed", async () => {
    send.mockRejectedValueOnce(new Error("Resend error: invalid recipient"));
    const result = await sendInvoiceEmail(
      (fn) => asMira(fn),
      actor,
      {
        invoiceId,
        to: "x@baeckerei.test",
        subject: "Ihre Rechnung",
        body: "Anbei die Rechnung.",
        pdf: null,
      },
      now,
    );
    expect(result).toMatchObject({ ok: false, error: "send_failed" });
    const [mail] = await db
      .select()
      .from(schema.outboundEmails)
      .where(eq(schema.outboundEmails.toAddress, "x@baeckerei.test"));
    expect(mail).toMatchObject({ status: "failed", error: "Resend error: invalid recipient" });
  });

  it("moves the status forward with webhooks, never back, and asks to check a bounce", async () => {
    const at = new Date("2026-10-22T10:05:00Z");
    const event = (providerId: string, status: "sent" | "delivered" | "bounced") => ({
      providerId,
      status,
      at,
      detail: status === "bounced" ? "Mailbox does not exist" : null,
    });
    expect(
      await recordEmailEvents(
        db,
        [
          event("re_first", "delivered"),
          event("re_first", "sent"),
          event("re_unknown", "delivered"),
          event("re_second", "bounced"),
        ],
        now,
      ),
    ).toBe(2);
    const status = async (providerId: string) =>
      (
        await db
          .select()
          .from(schema.outboundEmails)
          .where(eq(schema.outboundEmails.providerId, providerId))
      )[0];
    expect(await status("re_first")).toMatchObject({ status: "delivered" });
    expect(await status("re_second")).toMatchObject({
      status: "bounced",
      error: "Mailbox does not exist",
    });
    const followUps = await db
      .select({ title: schema.tasks.title })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.workspaceId, ws), eq(schema.tasks.prospectId, prospectId)));
    expect(followUps.map((task) => task.title)).toEqual([
      expect.stringMatching(
        /^Rechnung RE-2026-\d{4} nicht zugestellt: Adresse kunde@baeckerei.test prüfen$/,
      ),
    ]);
  });

  it("opens an approval task once and closes it with the next mail", async () => {
    expect(await requestInvoiceApproval(db, ws, invoiceId, now)).toBe(true);
    expect(await requestInvoiceApproval(db, ws, invoiceId, now)).toBe(false);
    expect((await asMira((tx) => loadInvoiceDelivery(tx, ws, invoiceId)))!.openApprovals).toBe(1);
    send.mockResolvedValueOnce({ id: "re_third" });
    await sendInvoiceEmail(
      (fn) => asMira(fn),
      actor,
      {
        invoiceId,
        to: "kunde@baeckerei.test",
        subject: "Ihre Rechnung",
        body: "Anbei die Rechnung.",
        pdf: null,
      },
      now,
    );
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.invoiceId, invoiceId));
    expect(task!.doneAt).toEqual(now);
  });

  it("shows the customer's page with the stored PDF, scoped to the workspace", async () => {
    const [share] = await db
      .select()
      .from(schema.invoiceShares)
      .where(eq(schema.invoiceShares.invoiceId, invoiceId));
    const page = await loadPublicInvoice(db, ws, share!.token, now);
    expect(page).toMatchObject({
      hasPdf: true,
      displayStatus: "open",
      treatment: "small_business",
    });
    expect(page!.totals.dueCents).toBe(120_000);
    const other = await createWorkspace(db, {
      userId: mira.id,
      name: "Anders",
      slug: "anders-versand",
    });
    if (!other.ok) throw new Error("setup failed");
    expect(await loadPublicInvoice(db, other.workspace.id, share!.token, now)).toBeNull();
    expect(await loadPublicInvoice(db, ws, "x".repeat(22), now)).toBeNull();
  });
});
