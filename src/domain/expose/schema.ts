import { z } from "zod";

/**
 * The exposé document format (§7.2). Claude Code writes `expose.json` files
 * against this schema; the app renders them. It is the single source of
 * truth: `pnpm expose:schema` exports it as schema/expose.schema.json and
 * docs/EXPOSE_AUTHORING.md documents it with a full example.
 *
 * Rules that keep authored files safe and renderable:
 * - No HTML anywhere. Long texts accept a small Markdown subset (see rich-text.ts).
 * - Assets are relative paths below `assets/` in the exposé folder.
 * - Every block has a stable `id`; tracking (phase 2) keys on it.
 * - Contact data of the owner is NOT part of the file: it comes from the
 *   workspace settings, so one file works for any workspace (§9a).
 *
 * Bump EXPOSE_SCHEMA_VERSION only for breaking changes and keep a migration
 * for stored versions; additive optional fields keep the version.
 */
export const EXPOSE_SCHEMA_VERSION = 1;

// Validation messages reach authors and the CLI in German (§4.9).
z.config(z.locales.de());

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Paragraphs, **bold**, *italic*, [links](https://…) and "- " lists. */
const richText = (max = 5000) =>
  text(max).describe(
    "Markdown subset: blank line = new paragraph, **bold**, *italic*, [text](https://…), lines starting with '- ' form a list.",
  );

export const ASSET_PATH_PATTERN =
  /^assets\/(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*\.(png|jpe?g|webp|avif|svg|mp4|webm|vtt)$/i;
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "svg"] as const;
export const VIDEO_EXTENSIONS = ["mp4", "webm"] as const;

const assetPath = (extensions: readonly string[], what: string) =>
  z
    .string()
    .regex(ASSET_PATH_PATTERN, "Pfad muss mit assets/ beginnen und darf kein '..' enthalten.")
    .refine(
      (path) => extensions.includes(path.split(".").pop()?.toLowerCase() ?? ""),
      `Erlaubte Formate für ${what}: ${extensions.join(", ")}`,
    );

export const imageSchema = z
  .object({
    src: assetPath(IMAGE_EXTENSIONS, "Bilder").describe("Relative path, e.g. assets/vorher.png"),
    alt: z
      .string()
      .trim()
      .max(300)
      .describe("What the image shows. Empty string only for purely decorative images."),
    caption: optionalText(300),
  })
  .strict();
export type ExposeImage = z.infer<typeof imageSchema>;

const blockIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{1,47}$/,
    "id: 2–48 Zeichen, Kleinbuchstaben, Ziffern und Bindestriche, beginnt mit einem Buchstaben.",
  )
  .describe("Stable id of the block, unique within the exposé. Tracking keys on it.");

const base = { id: blockIdSchema };

const heroBlock = z
  .object({
    ...base,
    type: z.literal("hero"),
    eyebrow: optionalText(80).describe("Small line above the greeting, e.g. 'Für Café Müller'."),
    greeting: text(120).describe("Personal salutation, e.g. 'Hallo Frau Müller,'."),
    headline: text(160),
    lead: optionalText(600),
    image: imageSchema.optional().describe("Optional large image, e.g. a mockup of the new site."),
    showOwnerPhoto: z.boolean().default(true),
  })
  .strict();

const personalNoteBlock = z
  .object({
    ...base,
    type: z.literal("personal_note"),
    title: optionalText(120),
    body: richText(4000),
    showSignature: z.boolean().default(true),
    video: z
      .object({
        src: assetPath(VIDEO_EXTENSIONS, "Videos"),
        captions: assetPath(["vtt"], "Untertitel").describe("WebVTT captions are required."),
        poster: imageSchema.optional(),
        title: text(160).describe("Accessible name of the video."),
      })
      .strict()
      .optional(),
  })
  .strict();

const auditBlock = z
  .object({
    ...base,
    type: z.literal("audit"),
    title: text(120),
    intro: optionalText(800),
    scores: z
      .array(
        z
          .object({
            label: text(60),
            value: z.number().min(0).max(100),
            detail: optionalText(300),
            source: text(200).describe(
              "Where the number comes from, e.g. 'PageSpeed Insights, mobil, 12.10.2026'. Honest and verifiable (§7.2).",
            ),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

const beforeAfterBlock = z
  .object({
    ...base,
    type: z.literal("before_after"),
    title: text(120),
    intro: optionalText(800),
    before: imageSchema,
    after: imageSchema,
    beforeLabel: text(40).default("Heute"),
    afterLabel: text(40).default("Vorschlag"),
  })
  .strict();

const findingsBlock = z
  .object({
    ...base,
    type: z.literal("findings"),
    title: text(120),
    intro: optionalText(800),
    items: z
      .array(
        z
          .object({
            title: text(120),
            severity: z.enum(["high", "medium", "low"]).default("medium"),
            impact: text(600).describe("What it costs the business today."),
            solution: text(600),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

export const PROPOSAL_ICONS = [
  "website",
  "mobile",
  "search",
  "map",
  "social",
  "brand",
  "photo",
  "speed",
  "calendar",
  "shop",
  "mail",
  "chart",
] as const;

const proposalBlock = z
  .object({
    ...base,
    type: z.literal("proposal"),
    title: text(120),
    intro: optionalText(800),
    items: z
      .array(
        z
          .object({
            title: text(120),
            description: text(600),
            benefit: text(300).describe("The concrete benefit for the prospect."),
            icon: z.enum(PROPOSAL_ICONS).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

const mockupGalleryBlock = z
  .object({
    ...base,
    type: z.literal("mockup_gallery"),
    title: text(120),
    intro: optionalText(800),
    images: z.array(imageSchema).min(1).max(12),
  })
  .strict();

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Farbe als #RRGGBB angeben.")
  .transform((value) => value.toLowerCase());

const brandPreviewBlock = z
  .object({
    ...base,
    type: z.literal("brand_preview"),
    title: text(120),
    intro: optionalText(800),
    colors: z
      .array(z.object({ name: text(40), value: hexColor, usage: optionalText(120) }).strict())
      .max(8)
      .default([]),
    typography: z
      .array(
        z
          .object({
            role: text(40).describe("e.g. 'Überschriften'"),
            family: text(60).describe("Font name shown as text; rendered in a similar style."),
            style: z.enum(["sans", "serif", "mono", "display"]).default("sans"),
            sample: text(120),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    logos: z.array(imageSchema).max(6).default([]),
  })
  .strict();

const roadmapBlock = z
  .object({
    ...base,
    type: z.literal("roadmap"),
    title: text(120),
    intro: optionalText(800),
    steps: z
      .array(
        z
          .object({
            title: text(120),
            description: text(600),
            duration: optionalText(40).describe("e.g. '1 Woche'"),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

const money = z.number().min(0).max(1_000_000).multipleOf(0.01);

const pricingBlock = z
  .object({
    ...base,
    type: z.literal("pricing"),
    title: text(120),
    intro: optionalText(800),
    currency: z.literal("EUR").default("EUR"),
    vatNote: text(120).default("Alle Preise netto zzgl. gesetzlicher USt."),
    options: z
      .array(
        z
          .object({
            id: blockIdSchema.describe("Stable id of the option, unique within the block."),
            title: text(120),
            description: optionalText(400),
            price: money.describe("Price in EUR. With priceTo it is the lower end of a range."),
            priceTo: money.optional(),
            billing: z.enum(["once", "monthly"]).default("once"),
            selected: z.boolean().default(true).describe("Preselected when the page opens."),
            required: z.boolean().default(false).describe("Always included, cannot be deselected."),
          })
          .strict()
          .refine((option) => option.priceTo === undefined || option.priceTo > option.price, {
            message: "priceTo muss größer als price sein.",
            path: ["priceTo"],
          }),
      )
      .min(1)
      .max(12),
    note: optionalText(400),
  })
  .strict()
  .superRefine((block, ctx) => {
    const seen = new Set<string>();
    block.options.forEach((option, index) => {
      if (seen.has(option.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Option-id "${option.id}" ist doppelt.`,
          path: ["options", index, "id"],
        });
      }
      seen.add(option.id);
    });
  });

const testimonialsBlock = z
  .object({
    ...base,
    type: z.literal("testimonials"),
    title: text(120),
    items: z
      .array(
        z
          .object({
            quote: text(600),
            author: text(80),
            role: optionalText(80),
            company: optionalText(120),
            photo: imageSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();

const faqBlock = z
  .object({
    ...base,
    type: z.literal("faq"),
    title: text(120),
    items: z
      .array(z.object({ question: text(200), answer: richText(2000) }).strict())
      .min(1)
      .max(15),
  })
  .strict();

const aboutBlock = z
  .object({
    ...base,
    type: z.literal("about"),
    title: text(120),
    body: richText(3000),
    image: imageSchema.optional().describe("Defaults to the owner photo from the settings."),
    facts: z
      .array(z.object({ label: text(60), value: text(60) }).strict())
      .max(6)
      .default([]),
  })
  .strict();

export const CONTACT_CHANNELS = [
  "chat",
  "whatsapp",
  "phone",
  "callback",
  "email",
  "booking",
  "messenger",
  "sms",
] as const;
/** Offered when an exposé does not list channels. Messenger and SMS are opt-in. */
export const DEFAULT_CONTACT_CHANNELS = [
  "chat",
  "whatsapp",
  "phone",
  "callback",
  "email",
  "booking",
] as const;

const contactBlock = z
  .object({
    ...base,
    type: z.literal("contact"),
    title: text(120),
    intro: optionalText(600),
    channels: z
      .array(z.enum(CONTACT_CHANNELS))
      .min(1)
      .default([...DEFAULT_CONTACT_CHANNELS])
      .describe(
        "Which channels to offer, in this order. Numbers and addresses come from the workspace settings; channels without a configured target are left out. 'chat' opens the live chat, 'callback' a callback form.",
      ),
    message: optionalText(400).describe(
      "Prefilled message for WhatsApp, e-mail and SMS. The reference code is appended automatically.",
    ),
  })
  .strict();

const ctaBlock = z
  .object({
    ...base,
    type: z.literal("cta"),
    headline: text(160),
    text: optionalText(400),
    label: text(60).describe("Button label."),
    target: blockIdSchema.describe("id of the block the button scrolls to, usually 'kontakt'."),
  })
  .strict();

export const blockSchema = z.discriminatedUnion("type", [
  heroBlock,
  personalNoteBlock,
  auditBlock,
  beforeAfterBlock,
  findingsBlock,
  proposalBlock,
  mockupGalleryBlock,
  brandPreviewBlock,
  roadmapBlock,
  pricingBlock,
  testimonialsBlock,
  faqBlock,
  aboutBlock,
  contactBlock,
  ctaBlock,
]);

export type ExposeBlock = z.infer<typeof blockSchema>;
export type BlockType = ExposeBlock["type"];
export type BlockOf<T extends BlockType> = Extract<ExposeBlock, { type: T }>;

export const BLOCK_TYPES = blockSchema.options.map(
  (option) => option.shape.type.value,
) as BlockType[];

const prospectKey = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/,
    "key: 3–60 Zeichen, Kleinbuchstaben, Ziffern und Bindestriche.",
  )
  .describe(
    "Stable key of the prospect in this workspace, e.g. 'cafe-mueller'. Publishing again with the same key creates a new version of the same exposé.",
  );

export const prospectSchema = z
  .object({
    key: prospectKey,
    company: text(160),
    industry: optionalText(80),
    website: z
      .url({ protocol: /^https?$/ })
      .max(300)
      .optional(),
    contact: z
      .object({
        salutation: z.enum(["Frau", "Herr", ""]).default(""),
        firstName: optionalText(80),
        lastName: optionalText(80),
        role: optionalText(80),
      })
      .strict()
      .optional(),
    address: z
      .object({
        street: optionalText(160),
        postalCode: optionalText(10),
        city: optionalText(120),
        country: z.string().trim().length(2).default("DE"),
      })
      .strict()
      .optional(),
    phone: optionalText(40),
    email: z.email().max(254).optional(),
  })
  .strict()
  .describe(
    "Created in the cockpit on first publish. Later publishes do not overwrite data edited in the cockpit.",
  );

export const EXPOSE_STYLES = ["editorial", "bold", "soft"] as const;
export type ExposeStyle = (typeof EXPOSE_STYLES)[number];

export const exposeSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(EXPOSE_SCHEMA_VERSION),
    prospect: prospectSchema,
    meta: z
      .object({
        title: text(120).describe("Browser tab title, e.g. 'Vorschläge für Café Müller'."),
        description: optionalText(300),
        lang: z.enum(["de", "en"]).default("de"),
      })
      .strict(),
    theme: z
      .object({
        accent: hexColor
          .optional()
          .describe(
            "Accent colour of the prospect's brand. Adjusted automatically when contrast is too low.",
          ),
        logo: imageSchema.optional().describe("Logo of the prospect, shown in the header."),
        appearance: z.enum(["auto", "light", "dark"]).default("auto"),
        style: z
          .enum(EXPOSE_STYLES)
          .default("editorial")
          .describe(
            "Visual style: 'editorial' (magazine, serif headlines), 'bold' (hard edges, heavy condensed type, offset shadows) or 'soft' (rounded shapes, warm neutrals, friendly sans).",
          ),
      })
      .strict()
      .prefault({}),
    letter: z
      .object({ subject: text(160), body: richText(4000) })
      .strict()
      .optional()
      .describe("Text for the printed letter (phase 5)."),
    blocks: z.array(blockSchema).min(1).max(40),
  })
  .strict()
  .superRefine((expose, ctx) => {
    const ids = new Map<string, number>();
    expose.blocks.forEach((block, index) => {
      if (ids.has(block.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Block-id "${block.id}" ist doppelt (auch bei Block ${ids.get(block.id)}).`,
          path: ["blocks", index, "id"],
        });
      }
      ids.set(block.id, index);
    });
    expose.blocks.forEach((block, index) => {
      if (block.type === "cta" && !ids.has(block.target)) {
        ctx.addIssue({
          code: "custom",
          message: `target "${block.target}" verweist auf keinen Block.`,
          path: ["blocks", index, "target"],
        });
      }
    });
    if (expose.blocks.filter((block) => block.type === "hero").length > 1) {
      ctx.addIssue({ code: "custom", message: "Höchstens ein hero-Block.", path: ["blocks"] });
    }
  });

export type ExposeDocument = z.infer<typeof exposeSchema>;
export type ExposeInput = z.input<typeof exposeSchema>;

/** Every asset path a document references, deduplicated, in document order. */
export function collectAssetPaths(document: ExposeDocument): string[] {
  const paths = new Set<string>();
  const image = (value: ExposeImage | undefined) => value && paths.add(value.src);
  image(document.theme.logo);
  for (const block of document.blocks) {
    switch (block.type) {
      case "hero":
        image(block.image);
        break;
      case "personal_note":
        if (block.video) {
          paths.add(block.video.src);
          paths.add(block.video.captions);
          image(block.video.poster);
        }
        break;
      case "before_after":
        image(block.before);
        image(block.after);
        break;
      case "mockup_gallery":
        block.images.forEach(image);
        break;
      case "brand_preview":
        block.logos.forEach(image);
        break;
      case "testimonials":
        block.items.forEach((item) => image(item.photo));
        break;
      case "about":
        image(block.image);
        break;
      default:
        break;
    }
  }
  return [...paths];
}

export type ValidationIssue = { path: string; message: string };

/** Human-readable validation for the CLI and the API (§7.2 "verständliche Fehler"). */
export function validateExpose(
  input: unknown,
): { ok: true; document: ExposeDocument } | { ok: false; issues: ValidationIssue[] } {
  const result = exposeSchema.safeParse(input);
  if (result.success) return { ok: true, document: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: formatPath(issue.path, input),
      message: issue.message,
    })),
  };
}

/** blocks.3.items.0.title → blocks[3] (findings "probleme").items[0].title */
function formatPath(path: PropertyKey[], input: unknown): string {
  let out = "";
  let cursor: unknown = input;
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
      cursor = Array.isArray(cursor) ? cursor[segment] : undefined;
      if (out.endsWith(`blocks[${segment}]`) && cursor && typeof cursor === "object") {
        const block = cursor as { type?: unknown; id?: unknown };
        if (typeof block.type === "string") {
          out += ` (${block.type}${typeof block.id === "string" ? ` "${block.id}"` : ""})`;
        }
      }
    } else {
      out += out ? `.${String(segment)}` : String(segment);
      cursor =
        cursor && typeof cursor === "object"
          ? (cursor as Record<PropertyKey, unknown>)[segment]
          : undefined;
    }
  }
  return out || "(Datei)";
}
