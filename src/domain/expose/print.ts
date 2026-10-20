import type { PrintColors, PrintImage } from "@/domain/letters/teaser";
import type { ChannelSettings } from "@/domain/workspace-settings";
import { telHref, whatsappNumber } from "./contact-links";
import { formatEuro, pricingTotals } from "./pricing";
import type { BlockOf, ExposeBlock, ExposeDocument, ExposeImage, ExposeStyle } from "./schema";

/**
 * The designed PDF of a whole exposé (§7.9 „gestaltete PDF-Fassung“), as a
 * letter enclosure from the cockpit or a download for the reader. The
 * browser renders it (ADR-0037); this is the serialisable input.
 */
export interface PrintableExpose {
  title: string;
  company: string;
  refCode: string;
  blocks: ExposeBlock[];
  /** Exposé asset path → printable image (a URL until the browser converts it). */
  images: Record<string, PrintImage>;
  /** Asset path of the prospect's logo, a key of `images`. */
  logo: string | null;
  style: ExposeStyle;
  colors: PrintColors;
  owner: {
    name: string;
    role: string | null;
    company: string;
    /** URL of the owner photo, converted like the images. */
    photo: string | null;
    contacts: PrintContact[];
  };
  /** Where the exposé lives online; the last page carries it as link and QR code. */
  url: string | null;
}

export interface PrintContact {
  kind: "phone" | "mobile" | "whatsapp" | "email" | "booking";
  label: string;
  value: string;
  href: string;
}

/** Every image a block or the theme refers to, so only those are converted. */
export function exposeImages(document: Pick<ExposeDocument, "blocks" | "theme">): ExposeImage[] {
  const images: (ExposeImage | undefined)[] = [document.theme?.logo];
  for (const block of document.blocks) {
    switch (block.type) {
      case "hero":
      case "about":
        images.push(block.image);
        break;
      case "before_after":
        images.push(block.before, block.after);
        break;
      case "mockup_gallery":
        images.push(...block.images);
        break;
      case "brand_preview":
        images.push(...block.logos);
        break;
      case "testimonials":
        images.push(...block.items.map((item) => item.photo));
        break;
      default:
        break;
    }
  }
  return images.filter((image): image is ExposeImage => Boolean(image));
}

/** The owner's channels in the order a reader of paper uses them. */
export function printContacts(channels: ChannelSettings): PrintContact[] {
  const result: PrintContact[] = [];
  if (channels.phone) {
    result.push({
      kind: "phone",
      label: "Telefon",
      value: channels.phone,
      href: telHref(channels.phone),
    });
  }
  if (channels.mobile && channels.mobile !== channels.phone) {
    result.push({
      kind: "mobile",
      label: "Mobil",
      value: channels.mobile,
      href: telHref(channels.mobile),
    });
  }
  const whatsapp = channels.whatsapp ? whatsappNumber(channels.whatsapp) : null;
  if (channels.whatsapp && whatsapp) {
    result.push({
      kind: "whatsapp",
      label: "WhatsApp",
      value: channels.whatsapp,
      href: `https://wa.me/${whatsapp}`,
    });
  }
  if (channels.email) {
    result.push({
      kind: "email",
      label: "E-Mail",
      value: channels.email,
      href: `mailto:${channels.email}`,
    });
  }
  if (channels.bookingUrl) {
    result.push({
      kind: "booking",
      label: "Termin",
      value: channels.bookingUrl.replace(/^https:\/\//, "").replace(/\/$/, ""),
      href: channels.bookingUrl,
    });
  }
  return result;
}

const range = (from: number, to: number) =>
  from === to ? formatEuro(from) : `${formatEuro(from)} – ${formatEuro(to)}`;

export interface PrintPricing {
  rows: {
    title: string;
    description: string | null;
    price: string;
    /** „Inklusive“, „Ausgewählt“ or null; printed as text, never by colour alone. */
    mark: "included" | "selected" | null;
  }[];
  totals: { label: string; value: string }[];
}

/**
 * The price frame on paper: every option with its price and whether it is
 * part of the selection (the reader's own when the PDF comes from the page),
 * then the totals of that selection.
 */
export function printPricing(
  block: BlockOf<"pricing">,
  selected: ReadonlySet<string> | null,
): PrintPricing {
  const chosen =
    selected ??
    new Set(block.options.filter((option) => option.selected).map((option) => option.id));
  const totals = pricingTotals(block.options, chosen);
  return {
    rows: block.options.map((option) => ({
      title: option.title,
      description: option.description ?? null,
      price: `${range(option.price, option.priceTo ?? option.price)}${option.billing === "monthly" ? " / Monat" : ""}`,
      mark: option.required ? "included" : chosen.has(option.id) ? "selected" : null,
    })),
    totals: [
      ...(totals.once.to > 0
        ? [{ label: "Einmalig", value: range(totals.once.from, totals.once.to) }]
        : []),
      ...(totals.monthly.to > 0
        ? [
            {
              label: "Monatlich",
              value: `${range(totals.monthly.from, totals.monthly.to)} / Monat`,
            },
          ]
        : []),
    ],
  };
}

const UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

/**
 * File name for the download, e.g. „Expose Cafe Mueller.pdf“: plain ASCII,
 * because Chromium drops a blob download's name with other characters.
 */
export function exposePdfFilename(company: string): string {
  const safe = company
    .replace(/[äöüÄÖÜß]/g, (char) => UMLAUTS[char]!)
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Expose ${safe || "Angebot"}.pdf`;
}
