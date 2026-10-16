import { z } from "zod";

/**
 * Events the exposé reports (§6.3, §11). One central, typed list; the
 * ingestion validates every batch against it and drops anything else.
 * Phase 2 sends the reading events, phase 3 chat, callback and nudges;
 * consent follows. `chat_message_sent` and `callback_submitted` are written
 * by the server when the message or request is stored, never by the script.
 */
const blockId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const nudgeId = z.enum(["read_invite", "pricing", "returning", "exit_intent"]);
/** `data-block` of the section, e.g. `contact`; the score needs it (§7.6). */
const blockType = z
  .string()
  .regex(/^[a-z][a-z_]{1,31}$/)
  .optional();
const at = z.number().int().nonnegative().describe("Milliseconds since the visit started.");

export const EVENT_SCHEMAS = {
  page_view: z.object({ type: z.literal("page_view"), at }),
  heartbeat: z.object({
    type: z.literal("heartbeat"),
    at,
    seconds: z.number().int().min(1).max(60),
  }),
  section_view: z.object({ type: z.literal("section_view"), at, blockId, blockType }),
  section_dwell: z.object({
    type: z.literal("section_dwell"),
    at,
    blockId,
    blockType,
    seconds: z.number().int().min(3).max(3600),
  }),
  scroll_depth: z.object({
    type: z.literal("scroll_depth"),
    at,
    percent: z.number().int().min(0).max(100),
  }),
  cta_click: z.object({ type: z.literal("cta_click"), at, blockId }),
  /** Pointer or focus on a contact button for at least a second. */
  cta_hover: z.object({
    type: z.literal("cta_hover"),
    at,
    blockId: blockId.optional(),
    channel: z
      .enum(["chat", "whatsapp", "phone", "email", "booking", "messenger", "sms", "callback"])
      .optional(),
  }),
  contact_click: z.object({
    type: z.literal("contact_click"),
    at,
    blockId: blockId.optional(),
    channel: z.enum(["whatsapp", "phone", "email", "booking", "messenger", "sms"]),
  }),
  copy_contact: z.object({
    type: z.literal("copy_contact"),
    at,
    channel: z.enum(["phone", "email"]),
  }),
  pricing_change: z.object({
    type: z.literal("pricing_change"),
    at,
    blockId,
    optionId: z.string().max(64),
    selected: z.boolean(),
  }),
  media_play: z.object({ type: z.literal("media_play"), at, blockId }),
  share: z.object({ type: z.literal("share"), at }),
  pdf_download: z.object({ type: z.literal("pdf_download"), at }),
  opt_out: z.object({ type: z.literal("opt_out"), at }),
  chat_open: z.object({
    type: z.literal("chat_open"),
    at,
    source: z.enum(["launcher", "contact", "nudge", "bar"]),
  }),
  callback_started: z.object({ type: z.literal("callback_started"), at }),
  nudge_shown: z.object({ type: z.literal("nudge_shown"), at, nudge: nudgeId }),
  nudge_dismissed: z.object({ type: z.literal("nudge_dismissed"), at, nudge: nudgeId }),
  nudge_clicked: z.object({ type: z.literal("nudge_clicked"), at, nudge: nudgeId }),
} as const;

/** Server-side only: stored with the chat message or callback request. */
export const SERVER_EVENT_TYPES = ["chat_message_sent", "callback_submitted"] as const;
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

export type EventType = keyof typeof EVENT_SCHEMAS;
export const EVENT_TYPES = Object.keys(EVENT_SCHEMAS) as EventType[];

export const trackedEventSchema = z.discriminatedUnion("type", [
  EVENT_SCHEMAS.page_view,
  EVENT_SCHEMAS.heartbeat,
  EVENT_SCHEMAS.section_view,
  EVENT_SCHEMAS.section_dwell,
  EVENT_SCHEMAS.scroll_depth,
  EVENT_SCHEMAS.cta_click,
  EVENT_SCHEMAS.cta_hover,
  EVENT_SCHEMAS.contact_click,
  EVENT_SCHEMAS.copy_contact,
  EVENT_SCHEMAS.pricing_change,
  EVENT_SCHEMAS.media_play,
  EVENT_SCHEMAS.share,
  EVENT_SCHEMAS.pdf_download,
  EVENT_SCHEMAS.opt_out,
  EVENT_SCHEMAS.chat_open,
  EVENT_SCHEMAS.callback_started,
  EVENT_SCHEMAS.nudge_shown,
  EVENT_SCHEMAS.nudge_dismissed,
  EVENT_SCHEMAS.nudge_clicked,
]);
export type TrackedEvent = z.infer<typeof trackedEventSchema>;

export const MAX_EVENTS_PER_BATCH = 50;

export const eventBatchSchema = z.object({
  token: z.string().min(20).max(200),
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
});

/**
 * Keeps the valid events of a batch. One malformed event (an old script
 * version, a browser extension) must not cost the rest of the batch.
 */
export function parseEvents(raw: unknown[]): TrackedEvent[] {
  return raw.flatMap((event) => {
    const parsed = trackedEventSchema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  });
}

export const visitStartSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
  /** Signed resolver ticket from the short link (absent for direct visits). */
  ticket: z.string().min(20).max(200).optional(),
  /** Visible part of the page when the script started, for bot heuristics. */
  viewport: z
    .object({
      width: z.number().int().min(0).max(10_000),
      height: z.number().int().min(0).max(10_000),
    })
    .optional(),
});
