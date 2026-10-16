import { List } from "lucide-react";
import { exposeThemeCss } from "@/domain/expose/theme";
import { Block, blockTitle } from "./blocks";
import { displayFont } from "./fonts";
import { prefilledMessage, telHref, whatsappHref } from "@/domain/expose/contact-links";
import { ContactLayerLazy } from "./contact-layer-lazy";
import { ExposeTracker } from "./expose-tracker";
import { FooterActions } from "./footer-actions";
import { ownerName } from "./owner";
import { Picture } from "./picture";
import { ownerPhoto, resolveImage, type RenderContext } from "./render-context";
import type { ExposeViewData } from "@/server/exposes/load";

/**
 * The exposé page (§7.3): mobile first, magazine-like. The tracking script
 * runs in public mode only, never in the cockpit preview.
 */
export function ExposeView({
  data,
  mode,
  nonce,
  links,
}: {
  data: ExposeViewData;
  mode: "public" | "preview";
  nonce?: string;
  links: { optOut: string | null; imprint: string | null; privacy: string | null };
}) {
  const context: RenderContext = {
    mode,
    assetBase: mode === "public" ? "/assets" : "/preview/assets",
    manifest: data.manifest,
    settings: data.settings,
    ownerPhoto: data.ownerPhoto,
    refCode: data.expose.refCode,
    slug: data.expose.slug,
    prospectName: data.prospect.companyName,
    workspaceName: data.workspace.name,
  };
  const { document } = data;
  const logo = resolveImage(document.theme.logo, context);
  const toc = document.blocks
    .map((block) => ({ id: block.id, title: blockTitle(block) }))
    .filter((entry): entry is { id: string; title: string } => entry.title !== null);
  const company = data.settings.senderAddress.company ?? data.workspace.name;
  const accent = document.theme.accent ?? data.settings.branding.accentColor;
  const contactBlock = document.blocks.find((block) => block.type === "contact");
  const channels = data.settings.channels;
  const phone = channels.phone ?? channels.mobile;

  return (
    <div
      data-expose-theme
      lang={document.meta.lang}
      className={`${displayFont.variable} min-h-dvh bg-background text-foreground`}
    >
      {mode === "public" ? <ExposeTracker slug={data.expose.slug} /> : null}
      <style nonce={nonce}>
        {exposeThemeCss({ accent, appearance: document.theme.appearance })}
      </style>
      <a
        href="#inhalt"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Zum Inhalt springen
      </a>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md print:static">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          {logo ? (
            <Picture
              image={{ ...logo, alt: logo.alt || data.prospect.companyName }}
              sizes="200px"
              className="block shrink-0 rounded-md bg-(--expose-logo-plate) px-1.5 py-1"
              sizing="h-9 w-auto"
              priority
            />
          ) : (
            <span className="font-display text-xl">{data.prospect.companyName}</span>
          )}
          <details className="relative print:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
              <List aria-hidden className="size-4" />
              Inhalt
            </summary>
            <nav
              aria-label="Inhalt"
              className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg"
            >
              <ol className="grid">
                {toc.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={`#${entry.id}`}
                      className="flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-surface-sunken"
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </details>
        </div>
        <div aria-hidden className="expose-progress h-0.5 origin-left bg-accent" />
      </header>

      <main id="inhalt" tabIndex={-1} className="outline-none">
        {document.blocks.map((block) => (
          <Block key={block.id} block={block} context={context} />
        ))}
      </main>

      {mode === "public" ? (
        <ContactLayerLazy
          slug={data.expose.slug}
          chat={data.settings.chat}
          nudges={data.settings.nudges}
          owner={{ name: ownerName(context), photo: ownerPhoto(context, "")?.src ?? null }}
          whatsappHref={whatsappHref(
            channels,
            prefilledMessage(
              contactBlock?.type === "contact" ? contactBlock.message : undefined,
              data.prospect.companyName,
              data.expose.refCode,
            ),
          )}
          phoneHref={phone ? telHref(phone) : null}
          contactBlockId={contactBlock?.id ?? null}
        />
      ) : null}

      <footer className="border-t border-border bg-surface-sunken px-5 pt-10 pb-28 sm:px-8 md:pb-10">
        <div className="mx-auto grid max-w-6xl gap-6 text-sm text-foreground-muted">
          <FooterActions title={document.meta.title} />
          <p>
            Erstellt von {ownerName(context)}
            {company !== ownerName(context) ? `, ${company}` : ""} für {data.prospect.companyName}.
            Ref {data.expose.refCode}.
          </p>
          <nav aria-label="Rechtliches" className="flex flex-wrap gap-x-5 gap-y-2">
            {links.imprint ? (
              <a
                href={links.imprint}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Impressum
              </a>
            ) : null}
            {links.privacy ? (
              <a
                href={links.privacy}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Datenschutz
              </a>
            ) : null}
            {links.optOut ? (
              <a href={links.optOut} className="underline underline-offset-4 hover:text-foreground">
                Kein Interesse, bitte nicht mehr kontaktieren
              </a>
            ) : null}
          </nav>
        </div>
      </footer>
    </div>
  );
}
