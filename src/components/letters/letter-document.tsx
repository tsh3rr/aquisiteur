import {
  Document,
  Font,
  Image,
  Link,
  Page,
  Path,
  pdf,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import { Fragment } from "react";
import { parseRichText, type Inline } from "@/domain/expose/rich-text";
import type { PrintableLetterData } from "./types";

type Teaser = NonNullable<PrintableLetterData["teaser"]>;

/**
 * Print-ready letters (§7.9): A4, DIN 5008 Form B for a DL window envelope,
 * fonts embedded. Rendered in the browser (ADR-0037): the Worker stays
 * small and the owner's computer does the work.
 */

const mm = (value: number) => value * 2.8346;

Font.register({
  family: "Geist",
  fonts: [
    { src: "/fonts/letter/geist-latin-400-normal.woff", fontWeight: 400 },
    { src: "/fonts/letter/geist-latin-600-normal.woff", fontWeight: 600 },
  ],
});
// Words are never split with hyphens the reader would not expect.
Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 10.5,
    lineHeight: 1.45,
    color: "#111111",
    paddingTop: mm(103.4),
    paddingBottom: mm(25),
    paddingLeft: mm(25),
    paddingRight: mm(20),
  },
  returnAddress: {
    position: "absolute",
    top: mm(45 + 12.7),
    left: mm(25),
    width: mm(85),
    fontSize: 7,
    color: "#333333",
    textDecoration: "underline",
  },
  address: { position: "absolute", top: mm(62.7), left: mm(25), width: mm(85), fontSize: 10.5 },
  info: { position: "absolute", top: mm(50), left: mm(125), width: mm(65), fontSize: 9.5 },
  mark: {
    position: "absolute",
    left: mm(4),
    width: mm(5),
    height: 0.5,
    backgroundColor: "#999999",
  },
  subject: { fontWeight: 600, marginBottom: mm(8) },
  paragraph: { marginBottom: mm(3.5) },
  listItem: { flexDirection: "row", marginBottom: mm(1) },
  qr: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: mm(3),
    marginBottom: mm(6),
    padding: mm(3),
    borderWidth: 0.75,
    borderColor: "#111111",
    borderRadius: mm(2),
  },
  qrText: { marginLeft: mm(5), flexGrow: 1, flexShrink: 1 },
  link: { fontSize: 13, fontWeight: 600, color: "#111111", textDecoration: "none" },
  signature: { height: mm(16), objectFit: "contain", objectPositionX: 0, marginTop: mm(2) },
  letterhead: {
    position: "absolute",
    top: mm(10),
    left: mm(25),
    right: mm(20),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  strip: {
    position: "absolute",
    top: mm(17),
    left: mm(25),
    right: mm(20),
    height: mm(24),
    objectFit: "cover",
    borderRadius: mm(2),
  },
  stripBar: {
    position: "absolute",
    top: mm(17),
    left: mm(25),
    right: mm(20),
    height: mm(1.2),
  },
  footer: {
    position: "absolute",
    bottom: mm(10),
    left: mm(25),
    right: mm(20),
    fontSize: 7.5,
    color: "#555555",
    borderTopWidth: 0.5,
    borderTopColor: "#bbbbbb",
    paddingTop: mm(2),
  },
});

const teaserStyles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 10.5,
    lineHeight: 1.45,
    paddingTop: mm(14),
    paddingBottom: mm(14),
    paddingHorizontal: mm(18),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: mm(11),
    marginBottom: mm(4),
  },
  eyebrow: { fontSize: 9, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" },
  logo: { height: mm(11), maxWidth: mm(48), objectFit: "contain" },
  image: { width: "100%", height: mm(76), objectFit: "cover", borderRadius: mm(3) },
  headline: { fontSize: 22, fontWeight: 600, lineHeight: 1.18, marginTop: mm(7) },
  lead: { fontSize: 10.5, marginTop: mm(3) },
  label: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: mm(8),
    marginBottom: mm(3),
  },
  ideas: { flexDirection: "row", gap: mm(4) },
  idea: { flex: 1, padding: mm(4), borderRadius: mm(2.5) },
  number: {
    width: mm(7),
    height: mm(7),
    borderRadius: mm(3.5),
    alignItems: "center",
    justifyContent: "center",
  },
  ideaTitle: { fontSize: 10.5, fontWeight: 600, lineHeight: 1.25, marginTop: mm(3) },
  ideaText: { fontSize: 8.8, lineHeight: 1.4, marginTop: mm(1.5) },
  benefit: { fontSize: 8.8, fontWeight: 600, lineHeight: 1.35, marginTop: mm(2) },
  cta: {
    position: "absolute",
    bottom: mm(14),
    left: mm(18),
    right: mm(18),
    flexDirection: "row",
    alignItems: "center",
    gap: mm(5),
    padding: mm(5),
    borderRadius: mm(3),
  },
  ctaQr: { backgroundColor: "#ffffff", padding: mm(2), borderRadius: mm(1.5) },
  owner: { width: mm(34), alignItems: "center", textAlign: "center" },
  photo: {
    width: mm(16),
    height: mm(16),
    borderRadius: mm(8),
    objectFit: "cover",
    marginBottom: mm(1.5),
  },
});

function InlineText({ nodes }: { nodes: Inline[] }) {
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
              <Text key={index} style={{ fontWeight: 600 }}>
                <InlineText nodes={node.children} />
              </Text>
            );
          case "em":
            return (
              <Text key={index}>
                <InlineText nodes={node.children} />
              </Text>
            );
          case "link":
            return <InlineText key={index} nodes={node.children} />;
        }
      })}
    </>
  );
}

/** Letterhead of a letter with teaser: agency name, „persönlich für“ and a strip of the exposé image. */
function Letterhead({ letter, teaser }: { letter: PrintableLetterData; teaser: Teaser }) {
  return (
    <>
      <View style={styles.letterhead}>
        <Text style={{ fontWeight: 600, fontSize: 11 }}>{letter.senderName}</Text>
        <Text style={{ fontSize: 8.5, color: teaser.colors.accent, fontWeight: 600 }}>
          Persönlich für {letter.companyName}
        </Text>
      </View>
      {teaser.image ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
        <Image src={teaser.image.src} style={styles.strip} />
      ) : (
        <View style={[styles.stripBar, { backgroundColor: teaser.colors.accent }]} />
      )}
    </>
  );
}

function LetterPage({ letter }: { letter: PrintableLetterData }) {
  const size = letter.qrModules.size;
  const teaser = letter.teaser;
  return (
    <Page size="A4" style={styles.page}>
      {teaser ? <Letterhead letter={letter} teaser={teaser} /> : null}
      {/* Folding marks (Form B) and hole mark. */}
      <View fixed style={[styles.mark, { top: mm(105) }]} />
      <View fixed style={[styles.mark, { top: mm(148.5), width: mm(7) }]} />
      <View fixed style={[styles.mark, { top: mm(210) }]} />
      <Text fixed style={styles.returnAddress}>
        {letter.returnAddress}
      </Text>
      <View fixed style={styles.address}>
        {letter.address.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </View>
      <View fixed style={styles.info}>
        {letter.signer.name ? <Text>{letter.signer.name}</Text> : null}
        {letter.footer[1] ? <Text style={{ color: "#555555" }}>{letter.footer[1]}</Text> : null}
        <Text style={{ marginTop: mm(4) }}>{letter.date}</Text>
      </View>

      <Text style={styles.subject}>{letter.subject}</Text>
      {letter.salutation ? <Text style={styles.paragraph}>{letter.salutation}</Text> : null}
      {parseRichText(letter.body).map((block, index) =>
        block.kind === "paragraph" ? (
          <Text key={index} style={styles.paragraph}>
            <InlineText nodes={block.children} />
          </Text>
        ) : (
          <View key={index} style={styles.paragraph}>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.listItem}>
                <Text style={{ width: mm(4) }}>•</Text>
                <Text style={{ flex: 1 }}>
                  <InlineText nodes={item} />
                </Text>
              </View>
            ))}
          </View>
        ),
      )}

      <View
        style={
          teaser
            ? [styles.qr, { borderWidth: 0, backgroundColor: teaser.colors.accentSoft }]
            : styles.qr
        }
        wrap={false}
      >
        <Svg width={mm(28)} height={mm(28)} viewBox={`0 0 ${size} ${size}`}>
          <Path d={letter.qrModules.path} fill="#000000" />
        </Svg>
        <View style={styles.qrText}>
          <Text>{letter.qr.hint}</Text>
          {letter.qr.shortLink ? (
            <>
              <Text style={{ marginTop: mm(2), color: "#555555" }}>Oder im Browser eingeben:</Text>
              <Link
                src={`https://${letter.qr.shortLink}`}
                style={teaser ? [styles.link, { color: teaser.colors.onAccentSoft }] : styles.link}
              >
                {letter.qr.shortLink}
              </Link>
            </>
          ) : null}
        </View>
      </View>

      <View wrap={false}>
        <Text>{letter.closing}</Text>
        {letter.signer.signatureUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
          <Image src={letter.signer.signatureUrl} style={styles.signature} />
        ) : (
          <View style={{ height: mm(10) }} />
        )}
        {letter.signer.name ? <Text>{letter.signer.name}</Text> : null}
        {letter.signer.role ? <Text style={{ color: "#555555" }}>{letter.signer.role}</Text> : null}
      </View>

      <View fixed style={styles.footer}>
        {letter.footer.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </View>
    </Page>
  );
}

/**
 * The teaser page (§7.9 „Exposé-Vorschau im Brief“): image, headline and up
 * to three ideas of the exposé in its colours, and the way in once more.
 */
function TeaserPage({ letter, teaser }: { letter: PrintableLetterData; teaser: Teaser }) {
  const { colors } = teaser;
  const size = letter.qrModules.size;
  return (
    <Page size="A4" style={[teaserStyles.page, { color: colors.ink }]}>
      <View style={teaserStyles.header}>
        <Text style={[teaserStyles.eyebrow, { color: colors.accent }]}>
          {teaser.eyebrow ?? `Für ${letter.companyName}`}
        </Text>
        {teaser.logo ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
          <Image src={teaser.logo.src} style={teaserStyles.logo} />
        ) : null}
      </View>
      {teaser.image ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
        <Image src={teaser.image.src} style={teaserStyles.image} />
      ) : null}
      <Text style={teaserStyles.headline}>{teaser.headline}</Text>
      {teaser.lead ? (
        <Text style={[teaserStyles.lead, { color: colors.muted }]}>{teaser.lead}</Text>
      ) : null}

      {teaser.ideas.length > 0 ? (
        <>
          <Text style={[teaserStyles.label, { color: colors.accent }]}>{teaser.ideasTitle}</Text>
          <View style={teaserStyles.ideas}>
            {teaser.ideas.map((idea, index) => (
              <View
                key={index}
                style={[teaserStyles.idea, { backgroundColor: colors.accentSoft }]}
                wrap={false}
              >
                <View style={[teaserStyles.number, { backgroundColor: colors.accent }]}>
                  <Text style={{ color: colors.onAccent, fontWeight: 600, fontSize: 10 }}>
                    {index + 1}
                  </Text>
                </View>
                <Text style={teaserStyles.ideaTitle}>{idea.title}</Text>
                <Text style={[teaserStyles.ideaText, { color: colors.muted }]}>{idea.text}</Text>
                {idea.benefit ? (
                  <Text style={[teaserStyles.benefit, { color: colors.onAccentSoft }]}>
                    {idea.benefit}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={[teaserStyles.cta, { backgroundColor: colors.accent }]} wrap={false}>
        <View style={teaserStyles.ctaQr}>
          <Svg width={mm(26)} height={mm(26)} viewBox={`0 0 ${size} ${size}`}>
            <Path d={letter.qrModules.path} fill="#000000" />
          </Svg>
        </View>
        <View style={{ flex: 1, color: colors.onAccent }}>
          <Text style={{ fontSize: 14, fontWeight: 600 }}>Alles Weitere auf Ihrer Seite</Text>
          <Text style={{ fontSize: 9.5, marginTop: mm(1.5), lineHeight: 1.4 }}>
            Mit Entwürfen, Beispielen und Preisrahmen. Scannen Sie den Code mit der Handy-Kamera
            {letter.qr.shortLink ? " oder geben Sie den Link ein:" : "."}
          </Text>
          {letter.qr.shortLink ? (
            <Link
              src={`https://${letter.qr.shortLink}`}
              style={[styles.link, { color: colors.onAccent, marginTop: mm(1.5) }]}
            >
              {letter.qr.shortLink}
            </Link>
          ) : null}
        </View>
        {letter.signer.name || teaser.ownerPhoto ? (
          <View style={[teaserStyles.owner, { color: colors.onAccent }]}>
            {teaser.ownerPhoto ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
              <Image src={teaser.ownerPhoto} style={teaserStyles.photo} />
            ) : null}
            {letter.signer.name ? (
              <Text style={{ fontWeight: 600, fontSize: 9.5 }}>{letter.signer.name}</Text>
            ) : null}
            {letter.signer.phone ? (
              <Text style={{ fontSize: 8, marginTop: mm(0.5) }}>{letter.signer.phone}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Page>
  );
}

export function LettersDocument({ letters }: { letters: PrintableLetterData[] }) {
  return (
    <Document title={letters.length === 1 ? letters[0]!.subject : "Briefe"} language="de-DE">
      {letters.map((letter) => (
        <Fragment key={letter.id}>
          <LetterPage letter={letter} />
          {letter.teaser ? <TeaserPage letter={letter} teaser={letter.teaser} /> : null}
        </Fragment>
      ))}
    </Document>
  );
}

/**
 * React-PDF only embeds PNG and JPEG, exposé images are WebP. The browser
 * decodes them anyway, so a canvas turns each into a JPEG data URL once.
 * JPEG on white also for logos and the signature: every image sits on white
 * paper, and React-PDF inflates PNGs in a blob worker, which the CSP blocks
 * (`worker-src 'self'`), so a PNG would never finish. A picture that fails
 * to load is left out rather than failing the PDF.
 */
async function printableImage(src: string) {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  }
}

async function withPrintableImages(letters: PrintableLetterData[]) {
  const cache = new Map<string, Promise<string | null>>();
  const convert = async (src: string | null) => {
    if (!src) return null;
    if (!cache.has(src)) cache.set(src, printableImage(src));
    return cache.get(src)!;
  };
  return Promise.all(
    letters.map(async (letter) => {
      const { teaser, signer } = letter;
      const [image, logo, ownerPhoto, signatureUrl] = await Promise.all([
        convert(teaser?.image?.src ?? null),
        convert(teaser?.logo?.src ?? null),
        convert(teaser?.ownerPhoto ?? null),
        convert(signer.signatureUrl),
      ]);
      const missingImages =
        Boolean(teaser?.image && !image) ||
        Boolean(teaser?.logo && !logo) ||
        Boolean(teaser?.ownerPhoto && !ownerPhoto) ||
        Boolean(signer.signatureUrl && !signatureUrl);
      return {
        ...letter,
        missingImages,
        signer: { ...signer, signatureUrl },
        teaser: teaser && {
          ...teaser,
          image: image && teaser.image ? { ...teaser.image, src: image } : null,
          logo: logo && teaser.logo ? { ...teaser.logo, src: logo } : null,
          ownerPhoto,
        },
      };
    }),
  );
}

/**
 * One PDF with every letter starting on its own page, its teaser page right
 * after. `missingImages` counts letters printed without an image that failed to load.
 */
export async function renderLettersPdf(
  letters: PrintableLetterData[],
): Promise<{ blob: Blob; missingImages: number }> {
  const printable = await withPrintableImages(letters);
  const blob = await pdf(<LettersDocument letters={printable} />).toBlob();
  return { blob, missingImages: printable.filter((letter) => letter.missingImages).length };
}
