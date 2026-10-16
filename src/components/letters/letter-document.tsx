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
import { parseRichText, type Inline } from "@/domain/expose/rich-text";
import type { PrintableLetterData } from "./types";

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

function LetterPage({ letter }: { letter: PrintableLetterData }) {
  const size = letter.qrModules.size;
  return (
    <Page size="A4" style={styles.page}>
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

      <View style={styles.qr} wrap={false}>
        <Svg width={mm(28)} height={mm(28)} viewBox={`0 0 ${size} ${size}`}>
          <Path d={letter.qrModules.path} fill="#000000" />
        </Svg>
        <View style={styles.qrText}>
          <Text>{letter.qr.hint}</Text>
          {letter.qr.shortLink ? (
            <>
              <Text style={{ marginTop: mm(2), color: "#555555" }}>Oder im Browser eingeben:</Text>
              <Link src={`https://${letter.qr.shortLink}`} style={styles.link}>
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

export function LettersDocument({ letters }: { letters: PrintableLetterData[] }) {
  return (
    <Document title={letters.length === 1 ? letters[0]!.subject : "Briefe"} language="de-DE">
      {letters.map((letter) => (
        <LetterPage key={letter.id} letter={letter} />
      ))}
    </Document>
  );
}

/** One PDF with every letter starting on its own page. */
export async function renderLettersPdf(letters: PrintableLetterData[]): Promise<Blob> {
  return pdf(<LettersDocument letters={letters} />).toBlob();
}
