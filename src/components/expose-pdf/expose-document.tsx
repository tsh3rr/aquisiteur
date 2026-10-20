import { Document, Image, Link, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { Children, type ReactNode } from "react";
import { printPricing, type PrintContact, type PrintableExpose } from "@/domain/expose/print";
import { parseRichText, type Inline } from "@/domain/expose/rich-text";
import type { BlockOf, ExposeBlock } from "@/domain/expose/schema";
import type { PrintImage } from "@/domain/letters/teaser";
import { qrMatrix } from "@/domain/tracking/qr";
import { displayStyle } from "../letters/pdf-fonts";
import { printableImage } from "../letters/pdf-image";
import {
  Blobs,
  BrowserWindow,
  ContactIcon,
  DottedQr,
  Label,
  LinkPill,
} from "../letters/teaser-page";

/**
 * The designed PDF of a whole exposé (§7.9, ADR-0059): a cover with the
 * hero, every block laid out for paper in the exposé's colours and headline
 * face, and a closing page with the way back online. Rendered in the
 * browser like the letters (ADR-0037).
 */

const mm = (value: number) => value * 2.8346;
const CONTENT = mm(170);
const GAP = mm(6);
const HALF = (CONTENT - GAP) / 2;

type Colors = PrintableExpose["colors"];

const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 10,
    lineHeight: 1.45,
    paddingTop: mm(20),
    paddingBottom: mm(24),
    paddingHorizontal: mm(20),
  },
  eyebrow: { fontSize: 8.5, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase" },
  // Placed from the top: with the page's line height, a footer anchored at
  // `bottom` falls off the page in React-PDF.
  footer: {
    position: "absolute",
    top: mm(282),
    left: mm(20),
    right: mm(20),
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    lineHeight: 1,
    paddingTop: mm(2),
    borderTopWidth: 0.5,
  },
  section: { marginBottom: mm(12) },
  card: { borderRadius: mm(3), padding: mm(4.5) },
  strong: { fontWeight: 600 },
});

/* ---------- text ---------- */

function InlineText({ nodes, colors }: { nodes: Inline[]; colors: Colors }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "text":
            return node.text;
          case "break":
            return "\n";
          case "strong":
            return (
              <Text key={index} style={styles.strong}>
                <InlineText nodes={node.children} colors={colors} />
              </Text>
            );
          case "em":
            return (
              <Text key={index}>
                <InlineText nodes={node.children} colors={colors} />
              </Text>
            );
          case "link":
            return (
              <Link key={index} src={node.href} style={{ color: colors.accent }}>
                <InlineText nodes={node.children} colors={colors} />
              </Link>
            );
        }
      })}
    </>
  );
}

/** Paragraphs and lists as separate nodes, so a long text may break between them. */
function richText(source: string, colors: Colors, size = 10): ReactNode[] {
  return parseRichText(source).map((block, index) =>
    block.kind === "paragraph" ? (
      <Text key={index} style={{ fontSize: size, marginBottom: mm(2.5) }}>
        <InlineText nodes={block.children} colors={colors} />
      </Text>
    ) : (
      <View key={index} style={{ marginBottom: mm(2.5) }}>
        {block.items.map((item, itemIndex) => (
          <View key={itemIndex} style={{ flexDirection: "row", marginBottom: mm(1) }}>
            <Text style={{ width: mm(5), fontSize: size, color: colors.accent }}>•</Text>
            <Text style={{ flex: 1, fontSize: size }}>
              <InlineText nodes={item} colors={colors} />
            </Text>
          </View>
        ))}
      </View>
    ),
  );
}

/* ---------- building blocks ---------- */

function SectionTitle({
  doc,
  title,
  intro,
}: {
  doc: PrintableExpose;
  title: string;
  intro?: string;
}) {
  return (
    <View style={{ marginBottom: mm(5) }}>
      <View
        style={{
          width: mm(12),
          height: mm(1.4),
          borderRadius: mm(0.7),
          backgroundColor: doc.colors.accent,
          marginBottom: mm(3),
        }}
      />
      <Text style={{ ...displayStyle(doc.style), fontSize: 21 }}>{title}</Text>
      {intro ? (
        <Text style={{ marginTop: mm(2), fontSize: 10.5, color: doc.colors.muted }}>{intro}</Text>
      ) : null}
    </View>
  );
}

function Picture({
  image,
  width,
  height,
  radius = mm(3),
}: {
  image: PrintImage | undefined;
  width: number;
  height?: number;
  radius?: number;
}) {
  if (!image) return null;
  return (
    // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
    <Image
      src={image.src}
      style={{
        width,
        height: height ?? (width * image.height) / image.width,
        objectFit: "cover",
        objectPositionY: 0,
        borderRadius: radius,
      }}
    />
  );
}

function Caption({ text, colors }: { text: string | undefined; colors: Colors }) {
  return text ? (
    <Text style={{ fontSize: 8.5, color: colors.muted, marginTop: mm(1.5) }}>{text}</Text>
  ) : null;
}

/**
 * A titled block. The title travels with the first piece of content, so it
 * never stands alone at the bottom of a page; later pieces may break.
 */
function Section({
  doc,
  title,
  intro,
  children,
}: {
  doc: PrintableExpose;
  title?: string;
  intro?: string;
  children: ReactNode;
}) {
  const [first, ...rest] = Children.toArray(children);
  return (
    <View style={styles.section}>
      <View wrap={false}>
        {title ? <SectionTitle doc={doc} title={title} intro={intro} /> : null}
        {first}
      </View>
      {rest}
    </View>
  );
}

/** Two columns, one unbreakable row per pair. */
function rows(cells: ReactNode[]): ReactNode[] {
  const result: ReactNode[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    result.push(
      <View
        key={index}
        wrap={false}
        style={{ flexDirection: "row", columnGap: GAP, marginBottom: GAP }}
      >
        {cells.slice(index, index + 2)}
      </View>,
    );
  }
  return result;
}

function OwnerCard({ doc, photoSize = mm(16) }: { doc: PrintableExpose; photoSize?: number }) {
  const { owner, colors } = doc;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {owner.photo ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
        <Image
          src={owner.photo}
          style={{
            width: photoSize,
            height: photoSize,
            borderRadius: photoSize / 2,
            objectFit: "cover",
            marginRight: mm(3.5),
          }}
        />
      ) : null}
      <View>
        <Text style={{ fontSize: 11, fontWeight: 600 }}>{owner.name}</Text>
        <Text style={{ fontSize: 9, color: colors.muted }}>
          {[owner.role, owner.company !== owner.name ? owner.company : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </View>
  );
}

/* ---------- blocks ---------- */

const SEVERITY = {
  high: "Hohe Priorität",
  medium: "Mittlere Priorität",
  low: "Geringe Priorität",
} as const;

const TYPE_FACE: Record<BlockOf<"brand_preview">["typography"][number]["style"], object> = {
  sans: { fontFamily: "Geist", fontWeight: 600 },
  serif: { fontFamily: "AqSerif" },
  display: { fontFamily: "AqAnton", textTransform: "uppercase" },
  mono: { fontFamily: "Courier" },
};

function BlockView({
  block,
  doc,
  selected,
}: {
  block: ExposeBlock;
  doc: PrintableExpose;
  selected: Record<string, string[]> | undefined;
}) {
  const { colors, images } = doc;
  const image = (src: string | undefined) => (src ? images[src] : undefined);
  const display = displayStyle(doc.style);

  switch (block.type) {
    case "hero":
      // The first hero is the cover; a later one reads as a statement.
      return (
        <View style={styles.section} wrap={false}>
          <Text style={{ ...display, fontSize: 24 }}>{block.headline}</Text>
          {block.lead ? (
            <Text style={{ marginTop: mm(2), color: colors.muted }}>{block.lead}</Text>
          ) : null}
        </View>
      );

    case "personal_note":
      return (
        <Section doc={doc} title={block.title}>
          {richText(block.body, colors, 10.5)}
          {block.video ? (
            <Text style={{ fontSize: 9, color: colors.muted }}>
              Dazu gibt es ein kurzes Video im Online-Exposé: {block.video.title}
            </Text>
          ) : null}
          {block.showSignature ? (
            <View style={{ marginTop: mm(4) }} wrap={false}>
              <OwnerCard doc={doc} photoSize={mm(12)} />
            </View>
          ) : null}
        </Section>
      );

    case "audit":
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          {block.scores.map((score, index) => (
            <View key={index} wrap={false} style={{ marginBottom: mm(4) }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.strong}>{score.label}</Text>
                <Text style={styles.strong}>{Math.round(score.value)} von 100</Text>
              </View>
              <View
                style={{
                  marginTop: mm(1.5),
                  height: mm(2.4),
                  borderRadius: mm(1.2),
                  backgroundColor: colors.paper,
                }}
              >
                <View
                  style={{
                    width: `${Math.max(2, Math.min(100, score.value))}%`,
                    height: mm(2.4),
                    borderRadius: mm(1.2),
                    backgroundColor: colors.accent,
                  }}
                />
              </View>
              {score.detail ? <Text style={{ marginTop: mm(1.5) }}>{score.detail}</Text> : null}
              <Text style={{ fontSize: 8, color: colors.muted, marginTop: mm(0.8) }}>
                Quelle: {score.source}
              </Text>
            </View>
          ))}
        </Section>
      );

    case "before_after": {
      const before = image(block.before.src);
      const after = image(block.after.src);
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          <View style={{ flexDirection: "row", columnGap: GAP }} wrap={false}>
            {[
              { label: block.beforeLabel, picture: before, accent: false },
              { label: block.afterLabel, picture: after, accent: true },
            ].map((side) => (
              <View key={side.label} style={{ width: HALF, alignItems: "center" }}>
                <View style={{ marginBottom: mm(2.5) }}>
                  <Label
                    background={side.accent ? colors.accent : colors.ink}
                    color={side.accent ? colors.onAccent : "#ffffff"}
                  >
                    {side.label}
                  </Label>
                </View>
                {side.picture ? <BrowserWindow image={side.picture} width={HALF} /> : null}
              </View>
            ))}
          </View>
        </Section>
      );
    }

    case "findings":
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          {block.items.map((item, index) => (
            <View
              key={index}
              wrap={false}
              style={[
                styles.card,
                { borderWidth: 0.75, borderColor: colors.accentSoft, marginBottom: mm(4) },
              ]}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: 600, flex: 1, marginRight: mm(3) }}>
                  {item.title}
                </Text>
                <Label
                  background={item.severity === "high" ? colors.accent : colors.accentSoft}
                  color={item.severity === "high" ? colors.onAccent : colors.onAccentSoft}
                >
                  {SEVERITY[item.severity]}
                </Label>
              </View>
              <Text style={{ marginTop: mm(2) }}>
                <Text style={styles.strong}>Heute: </Text>
                {item.impact}
              </Text>
              <Text style={{ marginTop: mm(1.5) }}>
                <Text style={[styles.strong, { color: colors.accent }]}>Mein Vorschlag: </Text>
                {item.solution}
              </Text>
            </View>
          ))}
        </Section>
      );

    case "proposal":
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          {rows(
            block.items.map((item, index) => (
              <View
                key={index}
                wrap={false}
                style={[styles.card, { width: HALF, backgroundColor: colors.accentSoft }]}
              >
                <Text style={{ ...display, fontSize: 22, color: colors.accent, lineHeight: 1 }}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <Text style={{ fontSize: 11, fontWeight: 600, marginTop: mm(2) }}>
                  {item.title}
                </Text>
                <Text style={{ marginTop: mm(1.5), color: colors.ink }}>{item.description}</Text>
                <Text style={{ marginTop: mm(2), fontWeight: 600, color: colors.onAccentSoft }}>
                  → {item.benefit}
                </Text>
              </View>
            )),
          )}
        </Section>
      );

    case "mockup_gallery":
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          {rows(
            block.images.map((item, index) => (
              <View key={index} wrap={false} style={{ width: HALF }}>
                <Picture image={image(item.src)} width={HALF} />
                <Caption text={item.caption} colors={colors} />
              </View>
            )),
          )}
        </Section>
      );

    case "brand_preview":
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          {block.colors.length > 0 ? (
            <View
              wrap={false}
              style={{ flexDirection: "row", flexWrap: "wrap", gap: mm(4), marginBottom: mm(5) }}
            >
              {block.colors.map((color) => (
                <View key={color.value + color.name} style={{ width: mm(38) }}>
                  <View
                    style={{
                      height: mm(16),
                      borderRadius: mm(2.5),
                      backgroundColor: color.value,
                      borderWidth: 0.5,
                      borderColor: "#d4d4d4",
                    }}
                  />
                  <Text style={{ fontWeight: 600, marginTop: mm(1.5) }}>{color.name}</Text>
                  <Text style={{ fontSize: 8.5, color: colors.muted }}>
                    {color.value.toUpperCase()}
                    {color.usage ? ` · ${color.usage}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {block.typography.map((type, index) => (
            <View key={index} wrap={false} style={{ marginBottom: mm(3) }}>
              <Text style={{ fontSize: 8.5, color: colors.muted }}>
                {type.role} · {type.family}
              </Text>
              <Text style={{ ...TYPE_FACE[type.style], fontSize: 16 }}>{type.sample}</Text>
            </View>
          ))}
          {block.logos.length > 0 ? (
            <View wrap={false} style={{ flexDirection: "row", gap: GAP, marginTop: mm(2) }}>
              {block.logos.map((logo, index) => {
                const picture = image(logo.src);
                return picture ? (
                  // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
                  <Image
                    key={index}
                    src={picture.src}
                    style={{ height: mm(18), maxWidth: mm(50), objectFit: "contain" }}
                  />
                ) : null;
              })}
            </View>
          ) : null}
        </Section>
      );

    case "roadmap":
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          {block.steps.map((step, index) => (
            <View key={index} wrap={false} style={{ flexDirection: "row", marginBottom: mm(4) }}>
              <View
                style={{
                  width: mm(9),
                  height: mm(9),
                  borderRadius: mm(4.5),
                  backgroundColor: colors.accent,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: mm(4),
                }}
              >
                <Text style={{ color: colors.onAccent, fontWeight: 600, lineHeight: 1 }}>
                  {index + 1}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: 600 }}>
                  {step.title}
                  {step.duration ? (
                    <Text style={{ fontWeight: 400, color: colors.muted }}> · {step.duration}</Text>
                  ) : null}
                </Text>
                <Text style={{ marginTop: mm(1) }}>{step.description}</Text>
              </View>
            </View>
          ))}
        </Section>
      );

    case "pricing": {
      const own = selected?.[block.id];
      const pricing = printPricing(block, own ? new Set(own) : null);
      return (
        <Section doc={doc} title={block.title} intro={block.intro}>
          {pricing.rows.map((row, index) => (
            <View
              key={index}
              wrap={false}
              style={{
                flexDirection: "row",
                paddingVertical: mm(3),
                borderBottomWidth: 0.5,
                borderBottomColor: colors.accentSoft,
              }}
            >
              <View style={{ flex: 1, marginRight: mm(4) }}>
                <Text style={styles.strong}>{row.title}</Text>
                {row.description ? (
                  <Text style={{ fontSize: 9, color: colors.muted, marginTop: mm(0.8) }}>
                    {row.description}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.strong}>{row.price}</Text>
                {row.mark ? (
                  <Text style={{ fontSize: 8, color: colors.accent, fontWeight: 600 }}>
                    {row.mark === "included" ? "Immer enthalten" : "Ausgewählt"}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
          <View wrap={false}>
            {pricing.totals.length > 0 ? (
              <View
                wrap={false}
                style={[styles.card, { backgroundColor: colors.accentSoft, marginTop: mm(4) }]}
              >
                <Text style={[styles.eyebrow, { color: colors.onAccentSoft }]}>
                  {own ? "Ihre Auswahl" : "Empfohlene Auswahl"}
                </Text>
                {pricing.totals.map((total) => (
                  <View
                    key={total.label}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginTop: mm(2),
                    }}
                  >
                    <Text style={{ color: colors.ink }}>{total.label}</Text>
                    <Text style={{ ...display, fontSize: 18, color: colors.ink }}>
                      {total.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={{ fontSize: 8.5, color: colors.muted, marginTop: mm(2) }}>
              {block.vatNote}
            </Text>
          </View>
          {block.note ? <Text style={{ marginTop: mm(2) }}>{block.note}</Text> : null}
        </Section>
      );
    }

    case "testimonials":
      return (
        <Section doc={doc} title={block.title}>
          {block.items.map((item, index) => (
            <View
              key={index}
              wrap={false}
              style={{
                marginBottom: mm(5),
                paddingLeft: mm(5),
                borderLeftWidth: 2,
                borderLeftColor: colors.accent,
              }}
            >
              <Text style={{ fontSize: 11.5 }}>„{item.quote}“</Text>
              <Text style={{ marginTop: mm(2), fontWeight: 600 }}>
                {item.author}
                <Text style={{ fontWeight: 400, color: colors.muted }}>
                  {[item.role, item.company].filter(Boolean).length > 0
                    ? ` · ${[item.role, item.company].filter(Boolean).join(", ")}`
                    : ""}
                </Text>
              </Text>
            </View>
          ))}
        </Section>
      );

    case "faq":
      return (
        <Section doc={doc} title={block.title}>
          {block.items.map((item, index) => (
            <View key={index} wrap={false} style={{ marginBottom: mm(3.5) }}>
              <Text style={{ fontSize: 10.5, fontWeight: 600, marginBottom: mm(1) }}>
                {item.question}
              </Text>
              {richText(item.answer, colors)}
            </View>
          ))}
        </Section>
      );

    case "about": {
      const picture = image(block.image?.src);
      return (
        <Section doc={doc} title={block.title}>
          <View style={{ flexDirection: "row", columnGap: GAP }}>
            {picture || doc.owner.photo ? (
              <View style={{ width: mm(45) }}>
                <Picture
                  image={picture ?? { src: doc.owner.photo!, alt: "", width: 1, height: 1 }}
                  width={mm(45)}
                  height={mm(45)}
                  radius={mm(4)}
                />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>{richText(block.body, colors)}</View>
          </View>
          {block.facts.length > 0 ? (
            <View
              wrap={false}
              style={{ flexDirection: "row", flexWrap: "wrap", gap: mm(4), marginTop: mm(4) }}
            >
              {block.facts.map((fact, index) => (
                <View
                  key={index}
                  style={[styles.card, { width: mm(52), backgroundColor: colors.paper }]}
                >
                  <Text style={{ ...display, fontSize: 18 }}>{fact.value}</Text>
                  <Text style={{ fontSize: 8.5, color: colors.muted }}>{fact.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Section>
      );
    }

    case "contact":
      return <ContactSection doc={doc} title={block.title} intro={block.intro} />;

    case "cta":
      return (
        <View
          wrap={false}
          style={[styles.card, styles.section, { backgroundColor: colors.accent, padding: mm(7) }]}
        >
          <Text style={{ ...display, fontSize: 20, color: colors.onAccent }}>{block.headline}</Text>
          {block.text ? (
            <Text style={{ marginTop: mm(2), color: colors.onAccent }}>{block.text}</Text>
          ) : null}
        </View>
      );
  }
}

/* ---------- contact and the way back online ---------- */

const CONTACT_ICON: Record<PrintContact["kind"], "phone" | "mail"> = {
  phone: "phone",
  mobile: "phone",
  whatsapp: "phone",
  email: "mail",
  booking: "mail",
};

function ContactSection({
  doc,
  title,
  intro,
}: {
  doc: PrintableExpose;
  title: string;
  intro?: string;
}) {
  const { colors, owner } = doc;
  const qr = doc.url ? qrMatrix(doc.url, "H") : null;
  const qrSize = mm(36);
  return (
    <View wrap={false} style={styles.section}>
      <SectionTitle doc={doc} title={title} intro={intro} />
      <View
        style={[
          styles.card,
          { flexDirection: "row", backgroundColor: colors.accentSoft, padding: mm(7) },
        ]}
      >
        <View style={{ flex: 1, marginRight: qr ? mm(8) : 0 }}>
          <OwnerCard doc={doc} />
          <View style={{ marginTop: mm(5) }}>
            {owner.contacts.map((contact) => (
              <View
                key={contact.kind}
                style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: mm(2) }}
              >
                <ContactIcon kind={CONTACT_ICON[contact.kind]} color={colors.ink} />
                <Text style={{ color: colors.ink }}>
                  <Text style={{ color: colors.muted }}>{contact.label}: </Text>
                  <Link src={contact.href} style={{ color: colors.ink, textDecoration: "none" }}>
                    {contact.value}
                  </Link>
                </Text>
              </View>
            ))}
          </View>
          <Text style={{ marginTop: mm(3), fontSize: 9, color: colors.muted }}>
            Ihre Referenz: <Text style={[styles.strong, { color: colors.ink }]}>{doc.refCode}</Text>
          </Text>
        </View>
        {qr && doc.url ? (
          <View style={{ alignItems: "center", width: qrSize + mm(6) }}>
            <View
              style={{
                backgroundColor: "#ffffff",
                padding: mm(2.2),
                borderRadius: mm(3),
                borderWidth: 1.2,
                borderColor: colors.ink,
              }}
            >
              <Link src={doc.url} style={{ textDecoration: "none" }}>
                <DottedQr
                  qr={qr}
                  size={qrSize}
                  dot={colors.ink}
                  eye={colors.accent}
                  badge={{
                    background: colors.accent,
                    color: colors.onAccent,
                    font: displayStyle(doc.style),
                  }}
                />
              </Link>
            </View>
            <Text
              style={{ fontSize: 8.5, color: colors.muted, marginTop: mm(2), textAlign: "center" }}
            >
              Online weiterlesen, chatten oder Rückruf anfordern
            </Text>
          </View>
        ) : null}
      </View>
      {doc.url ? (
        <View style={{ marginTop: mm(4), flexDirection: "row" }}>
          <LinkPill
            href={doc.url}
            text={doc.url.replace(/^https?:\/\//, "")}
            size={10}
            colors={colors}
          />
        </View>
      ) : null}
    </View>
  );
}

/* ---------- pages ---------- */

function Cover({ doc }: { doc: PrintableExpose }) {
  const { colors } = doc;
  const hero = doc.blocks.find((block): block is BlockOf<"hero"> => block.type === "hero");
  const heroImage = hero?.image ? doc.images[hero.image.src] : undefined;
  const logo = doc.logo ? doc.images[doc.logo] : undefined;
  const display = displayStyle(doc.style);
  const contents = doc.blocks
    .map((block) => ("title" in block && block.type !== "contact" ? block.title : undefined))
    .filter((title): title is string => Boolean(title))
    .slice(0, 9);
  return (
    <Page size="A4" style={[styles.page, { color: colors.ink, paddingBottom: mm(20) }]}>
      <Blobs
        circles={[
          { color: colors.accentSoft, cx: 195, cy: 10, r: 80 },
          { color: colors.paper, cx: 0, cy: 290, r: 60 },
        ]}
      />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          minHeight: mm(12),
        }}
      >
        <Text style={[styles.eyebrow, { color: colors.accent }]}>
          {hero?.eyebrow ?? `Für ${doc.company}`}
        </Text>
        {logo ? (
          <View
            style={{
              backgroundColor: "#ffffff",
              borderRadius: mm(3),
              paddingVertical: mm(1.5),
              paddingHorizontal: mm(3),
            }}
          >
            {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML */}
            <Image
              src={logo.src}
              style={{ height: mm(9), maxWidth: mm(45), objectFit: "contain" }}
            />
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: mm(heroImage ? 10 : 40) }}>
        {hero ? <Text style={{ fontSize: 12, marginBottom: mm(3) }}>{hero.greeting}</Text> : null}
        <Text style={{ ...display, fontSize: heroImage ? 34 : 42, maxWidth: CONTENT }}>
          {hero?.headline ?? doc.title}
        </Text>
        {hero?.lead ? (
          <Text
            style={{ fontSize: 11.5, color: colors.muted, marginTop: mm(4), maxWidth: mm(150) }}
          >
            {hero.lead}
          </Text>
        ) : null}
      </View>

      {heroImage ? (
        <View style={{ marginTop: mm(9) }}>
          <Picture image={heroImage} width={CONTENT} height={mm(95)} radius={mm(5)} />
        </View>
      ) : contents.length > 0 ? (
        <View style={{ marginTop: mm(14), maxWidth: mm(120) }}>
          <Text style={[styles.eyebrow, { color: colors.accent, marginBottom: mm(3) }]}>
            Was Sie erwartet
          </Text>
          {contents.map((title, index) => (
            <View
              key={index}
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                paddingVertical: mm(2),
                borderBottomWidth: 0.5,
                borderBottomColor: colors.accentSoft,
              }}
            >
              <Text style={{ ...display, width: mm(12), fontSize: 14, color: colors.accent }}>
                {String(index + 1).padStart(2, "0")}
              </Text>
              <Text style={{ fontSize: 11 }}>{title}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View
        style={{
          position: "absolute",
          left: mm(20),
          right: mm(20),
          bottom: mm(18),
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <OwnerCard doc={doc} />
        <Text style={{ fontSize: 8.5, color: colors.muted }}>Referenz {doc.refCode}</Text>
      </View>
    </Page>
  );
}

export function ExposePdfDocument({
  doc,
  selected,
}: {
  doc: PrintableExpose;
  /** Pricing block id → option ids the reader chose on the page. */
  selected?: Record<string, string[]>;
}) {
  const { colors } = doc;
  const firstHero = doc.blocks.findIndex((block) => block.type === "hero");
  const blocks = doc.blocks.filter((_, index) => index !== firstHero);
  const hasContact = blocks.some((block) => block.type === "contact");
  return (
    <Document title={doc.title} author={doc.owner.company} subject={`Exposé für ${doc.company}`}>
      <Cover doc={doc} />
      <Page size="A4" style={[styles.page, { color: colors.ink }]} wrap>
        <View
          fixed
          style={[styles.footer, { color: colors.muted, borderTopColor: colors.accentSoft }]}
        >
          <Text>{doc.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
        </View>
        {blocks.map((block) => (
          <BlockView key={block.id} block={block} doc={doc} selected={selected} />
        ))}
        {hasContact ? null : <ContactSection doc={doc} title="So erreichen Sie mich" />}
      </Page>
    </Document>
  );
}

/** Converts every image (WebP → JPEG, see pdf-image.ts); missing ones are left out. */
async function withPrintableImages(doc: PrintableExpose) {
  let missing = 0;
  const entries = await Promise.all(
    Object.entries(doc.images).map(async ([path, image]) => {
      const src = await printableImage(image.src);
      if (!src) missing += 1;
      return src ? ([path, { ...image, src }] as const) : null;
    }),
  );
  const photo = doc.owner.photo ? await printableImage(doc.owner.photo) : null;
  if (doc.owner.photo && !photo) missing += 1;
  return {
    doc: {
      ...doc,
      images: Object.fromEntries(entries.filter((entry) => entry !== null)),
      owner: { ...doc.owner, photo },
    },
    missing,
  };
}

export async function renderExposePdf(
  doc: PrintableExpose,
  selected?: Record<string, string[]>,
): Promise<{ blob: Blob; missingImages: number }> {
  const printable = await withPrintableImages(doc);
  const blob = await pdf(<ExposePdfDocument doc={printable.doc} selected={selected} />).toBlob();
  return { blob, missingImages: printable.missing };
}
