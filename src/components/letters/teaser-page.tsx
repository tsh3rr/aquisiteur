import {
  Circle,
  Font,
  G,
  Image,
  Link,
  Page,
  Path,
  Polygon,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import type { Styles } from "@react-pdf/renderer";

type Style = Styles[string];
import type { ReactNode } from "react";
import type { ExposeStyle } from "@/domain/expose/schema";
import type { PrintImage, PrintableTeaser, QrBadge } from "@/domain/letters/teaser";
import type { PrintableLetterData } from "./types";

/**
 * The designed parts of a letter with exposé teaser (§7.9, ADR-0055): the
 * QR card on page 1 that points to the next page, and the teaser page with
 * before/after phones, the three ideas and the way in once more. Shapes,
 * headline face and colours follow the exposé, so letter and exposé look
 * like one piece.
 */

const mm = (value: number) => value * 2.8346;

// Headline faces of the exposé styles; React-PDF reads WOFF, not WOFF2.
Font.register({ family: "AqSerif", src: "/fonts/letter/instrument-serif-latin-400-normal.woff" });
Font.register({ family: "AqAnton", src: "/fonts/letter/anton-latin-400-normal.woff" });
Font.register({
  family: "AqNunito",
  src: "/fonts/letter/nunito-latin-800-normal.woff",
  fontWeight: 800,
});

const DISPLAY: Record<ExposeStyle, Style> = {
  editorial: { fontFamily: "AqSerif", fontWeight: 400, lineHeight: 1.05 },
  bold: { fontFamily: "AqAnton", fontWeight: 400, lineHeight: 1.05, textTransform: "uppercase" },
  soft: { fontFamily: "AqNunito", fontWeight: 800, lineHeight: 1.12 },
};

/** Headline style of the exposé, for the subject line on page 1 too. */
export const displayStyle = (style: ExposeStyle) => DISPLAY[style];

/* ---------- small drawn pieces ---------- */

/**
 * The QR code as dots with rounded finder eyes in the accent colour and a
 * small badge in the middle (level H keeps it readable with the hole): by
 * default an arrow saying „this leads somewhere“, or a short word.
 * Includes one module of quiet zone; the white tile around it adds the rest.
 */
function DottedQr({
  qr,
  size,
  dot,
  eye,
  badge,
}: {
  qr: PrintableTeaser["qr"];
  size: number;
  dot: string;
  eye: string;
  badge: { content: NonNullable<QrBadge>; background: string; color: string; font: Style } | null;
}) {
  const n = qr.size;
  const isEye = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  // Badge hole: about a fifth of the width, an odd number of modules, centred.
  const hole = badge ? Math.max(5, Math.round(n * 0.2) | 1) : 0;
  const holeStart = (n - hole) / 2;
  const inHole = (x: number, y: number) =>
    hole > 0 &&
    x >= holeStart - 0.5 &&
    x < holeStart + hole - 0.5 &&
    y >= holeStart - 0.5 &&
    y < holeStart + hole - 0.5;
  const dots: ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.bits[y * n + x] !== "1" || isEye(x, y) || inHole(x, y)) continue;
      dots.push(<Circle key={`${x}-${y}`} cx={x + 1.5} cy={y + 1.5} r={0.46} fill={dot} />);
    }
  }
  const eyes = [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ].map(([x, y]) => (
    <G key={`${x}-${y}`}>
      <Rect
        x={x! + 1.5}
        y={y! + 1.5}
        width={6}
        height={6}
        rx={1.9}
        fill="none"
        stroke={eye}
        strokeWidth={1}
      />
      <Rect x={x! + 3} y={y! + 3} width={3} height={3} rx={0.9} fill={eye} />
    </G>
  ));
  const view = n + 2;
  const badgeSize = ((hole - 0.6) / view) * size;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${view} ${view}`}>
        {dots}
        {eyes}
      </Svg>
      {badge ? (
        <View
          style={{
            position: "absolute",
            left: (size - badgeSize) / 2,
            top: (size - badgeSize) / 2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: badge.background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {badge.content.kind === "arrow" ? (
            <StraightArrow width={badgeSize * 0.68} color={badge.color} />
          ) : (
            <Text
              style={{
                ...badge.font,
                color: badge.color,
                fontSize: badgeSize * (badge.content.text.length > 3 ? 0.32 : 0.42),
              }}
            >
              {badge.content.text}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** A fat level arrow pointing right, from before to after. */
function StraightArrow({ width, color }: { width: number; color: string }) {
  return (
    <Svg width={width} height={width * 0.5} viewBox="0 0 120 60">
      <Path d="M8 30 H 84" stroke={color} strokeWidth={12} strokeLinecap="round" />
      <Polygon points="78,8 116,30 78,52" fill={color} />
    </Svg>
  );
}

/**
 * A fat arrow that leaves to the right and bends straight down, as in „turn
 * the page“. It starts at the vertical middle of its box, so centring the box
 * on a text block starts the arrow at the text's middle.
 */
function DownArrow({ width, color }: { width: number; color: string }) {
  return (
    <Svg width={width} height={width * 1.5} viewBox="0 0 80 120">
      <Path
        d="M6 60 C 40 54, 60 70, 58 96"
        stroke={color}
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
      />
      <Polygon points="43,92 73,93 58,118" fill={color} />
    </Svg>
  );
}

/** Small line icons for the contact card; the text next to them carries the meaning. */
function ContactIcon({ kind, color }: { kind: "phone" | "mail"; color: string }) {
  return (
    <Svg
      width={mm(3.4)}
      height={mm(3.4)}
      viewBox="0 0 24 24"
      style={{ marginRight: mm(1.5), marginTop: mm(0.5) }}
    >
      {kind === "phone" ? (
        <Path
          d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          fill="none"
        />
      ) : (
        <G>
          <Rect
            x={3}
            y={5}
            width={18}
            height={14}
            rx={2}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />
          <Path
            d="M3 7l9 6 9-6"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            fill="none"
          />
        </G>
      )}
    </Svg>
  );
}

/**
 * The white tile with the dotted code and a small „Scannen“ label centred on
 * its lower edge. Half the label overlaps the tile's padding and the quiet
 * module, never the modules themselves. Everything stays upright: rotated raster and fine dots
 * print blurry.
 */
function QrTile({
  letter,
  teaser,
  size,
}: {
  letter: PrintableLetterData;
  teaser: PrintableTeaser;
  size: number;
}) {
  const { colors } = teaser;
  return (
    <View style={{ paddingBottom: LABEL_HEIGHT / 2 }}>
      <View
        style={{
          backgroundColor: "#ffffff",
          padding: mm(2.2),
          borderRadius: mm(3),
          borderWidth: 1.2,
          borderColor: colors.ink,
        }}
      >
        <Link src={letter.qr.url} style={{ textDecoration: "none" }}>
          <DottedQr
            qr={teaser.qr}
            size={size}
            dot={colors.ink}
            eye={colors.accent}
            badge={
              teaser.qrBadge
                ? {
                    content: teaser.qrBadge,
                    background: colors.accent,
                    color: colors.onAccent,
                    font: displayStyle(teaser.style),
                  }
                : null
            }
          />
        </Link>
      </View>
      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center" }}>
        <Label background={colors.accent} color={colors.onAccent}>
          Scannen
        </Label>
      </View>
    </View>
  );
}

/**
 * Soft circles behind the content, bleeding off the page edge like the
 * shapes in the exposé mockups. One page-sized SVG clips them, so they
 * never push content onto a new page.
 */
function Blobs({ circles }: { circles: { color: string; cx: number; cy: number; r: number }[] }) {
  return (
    <Svg
      fixed
      width={mm(210)}
      height={mm(297)}
      viewBox="0 0 210 297"
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      {circles.map((circle, index) => (
        <Circle key={index} cx={circle.cx} cy={circle.cy} r={circle.r} fill={circle.color} />
      ))}
    </Svg>
  );
}

/* ---------- page 1 ---------- */

/** Background shapes of page 1, kept clear of the window and info block (DIN 5008). */
export function LetterDecor({ teaser }: { teaser: PrintableTeaser }) {
  return (
    <Blobs
      circles={[
        { color: teaser.colors.accentSoft, cx: 196, cy: -4, r: 43 },
        { color: teaser.colors.paper, cx: -4, cy: 284, r: 26 },
      ]}
    />
  );
}

/** The way in on page 1: dotted code, typed link and an arrow to the teaser page. */
export function TeaserQrCard({
  letter,
  teaser,
}: {
  letter: PrintableLetterData;
  teaser: PrintableTeaser;
}) {
  const { colors } = teaser;
  const display = displayStyle(teaser.style);
  const preview = teaser.beforeAfter
    ? "wie Ihre neue Website aussehen könnte"
    : "meine Ideen für Sie";
  return (
    <View wrap={false} style={{ marginTop: mm(3), marginBottom: mm(5) }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: mm(5),
          padding: mm(4),
          paddingLeft: mm(6),
          borderRadius: mm(4),
          backgroundColor: colors.accentSoft,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ ...display, fontSize: 16, color: colors.ink }}>
            Mein Vorschlag für Ihre Website
          </Text>
          <Text style={{ marginTop: mm(1.5), fontSize: 9.5, color: colors.muted }}>
            {letter.qr.shortLink
              ? "Scannen Sie den Code mit der Handykamera oder tippen Sie den Link ein:"
              : letter.qr.hint}
          </Text>
          {letter.qr.shortLink ? (
            <View
              style={{
                marginTop: mm(2.5),
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                rowGap: mm(1),
              }}
            >
              <LinkPill
                href={`https://${letter.qr.shortLink}`}
                text={letter.qr.shortLink}
                size={12}
                colors={colors}
              />
            </View>
          ) : null}
        </View>
        <QrTile letter={letter} teaser={teaser} size={mm(27)} />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          marginTop: mm(1),
          paddingRight: mm(2),
        }}
      >
        <Text
          style={{
            ...display,
            fontSize: 13,
            color: colors.accent,
            textAlign: "right",
            maxWidth: mm(95),
            marginRight: mm(2),
          }}
        >
          {`Bitte umblättern: ${letter.duplex ? "Auf der Rückseite" : "Auf der nächsten Seite"} sehen Sie schon, ${preview}.`}
        </Text>
        <DownArrow width={mm(14)} color={colors.accent} />
      </View>
    </View>
  );
}

/* ---------- page 2 ---------- */

const PHONE_RATIO = 760 / 360;

function Phone({ image, width, desktop }: { image: PrintImage; width: number; desktop: boolean }) {
  const bezel = width * 0.04;
  const screenWidth = width - bezel * 2;
  const screenHeight = screenWidth * PHONE_RATIO;
  // A desktop page inside a phone shrinks to the phone's width: what most old sites look like.
  const imageHeight = desktop ? (screenWidth * image.height) / image.width : screenHeight;
  return (
    <View
      style={{
        width,
        padding: bezel,
        borderRadius: width * 0.17,
        backgroundColor: "#1d2320",
      }}
    >
      <View
        style={{
          width: screenWidth,
          height: screenHeight,
          borderRadius: width * 0.14,
          backgroundColor: desktop ? "#ececec" : "#ffffff",
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML */}
        <Image
          src={image.src}
          style={{
            width: screenWidth,
            height: Math.min(imageHeight, screenHeight),
            objectFit: "cover",
            objectPositionY: 0,
          }}
        />
      </View>
      <View
        style={{
          position: "absolute",
          top: bezel + width * 0.03,
          left: (width - width * 0.28) / 2,
          width: width * 0.28,
          height: width * 0.07,
          borderRadius: width * 0.035,
          backgroundColor: "#1d2320",
        }}
      />
    </View>
  );
}

function BrowserWindow({ image, width }: { image: PrintImage; width: number }) {
  return (
    <View style={{ width, borderRadius: mm(2.5), backgroundColor: "#1d2320", padding: mm(0.8) }}>
      <View style={{ flexDirection: "row", gap: mm(1), padding: mm(1.2) }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <View
            key={color}
            style={{
              width: mm(1.8),
              height: mm(1.8),
              borderRadius: mm(0.9),
              backgroundColor: color,
            }}
          />
        ))}
      </View>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML */}
      <Image
        src={image.src}
        style={{
          width: width - mm(1.6),
          height: ((width - mm(1.6)) * image.height) / image.width,
          borderRadius: mm(1.6),
        }}
      />
    </View>
  );
}

/** Label box: 8.5 pt text at line height 1 plus 1.3 mm padding top and bottom. */
const LABEL_HEIGHT = 8.5 + mm(2.6);

/**
 * The typed link as a pill. Line height 1 so padding alone sets the box and
 * the text sits in its middle, not on the leading of the page.
 */
function LinkPill({
  href,
  text,
  size,
  colors,
}: {
  href: string;
  text: string;
  size: number;
  colors: PrintableTeaser["colors"];
}) {
  return (
    <View style={{ flexDirection: "row" }}>
      <Link
        src={href}
        style={{
          backgroundColor: colors.accent,
          // Geist sits low in its line box; less top padding centres it optically.
          paddingTop: size * 0.16,
          paddingBottom: size * 0.46,
          paddingHorizontal: size * 0.7,
          borderRadius: size,
          textDecoration: "none",
        }}
      >
        <Text style={{ fontSize: size, lineHeight: 1, fontWeight: 600, color: colors.onAccent }}>
          {text}
        </Text>
      </Link>
    </View>
  );
}

/** A small upright label in capitals; centring is up to the parent. */
function Label({
  children,
  background,
  color,
}: {
  children: string;
  background: string;
  color: string;
}) {
  return (
    <View
      style={{
        backgroundColor: background,
        paddingTop: mm(1.1),
        paddingBottom: mm(1.5),
        paddingHorizontal: mm(2.8),
        borderRadius: mm(3),
      }}
    >
      <Text
        style={{
          fontSize: 8.5,
          lineHeight: 1,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/** A screen with its label centred above it. */
function Labelled({
  label,
  background,
  color,
  children,
}: {
  label: string;
  background: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ marginBottom: mm(3) }}>
        <Label background={background} color={color}>
          {label}
        </Label>
      </View>
      {children}
    </View>
  );
}

function BeforeAfterStage({ teaser }: { teaser: PrintableTeaser }) {
  const stage = teaser.beforeAfter!;
  const { colors } = teaser;
  const phones = stage.kind === "phones";
  const screen = (image: PrintImage, desktop: boolean) =>
    phones ? (
      <Phone image={image} width={mm(40)} desktop={desktop} />
    ) : (
      <BrowserWindow image={image} width={mm(68)} />
    );
  // Both screens share one size and baseline; the arrow sits on their middle.
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "stretch" }}>
      <Labelled label={stage.beforeLabel} background={colors.ink} color="#ffffff">
        {screen(stage.before, stage.beforeIsDesktop)}
      </Labelled>
      <View
        style={{ width: mm(30), alignItems: "center", justifyContent: "center", paddingTop: mm(8) }}
      >
        <StraightArrow width={mm(18)} color={colors.accent} />
      </View>
      <Labelled label={stage.afterLabel} background={colors.accent} color={colors.onAccent}>
        {screen(stage.after, false)}
      </Labelled>
    </View>
  );
}

const page2 = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 10,
    lineHeight: 1.4,
    paddingTop: mm(14),
    paddingBottom: mm(14),
    paddingHorizontal: mm(18),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: mm(10),
  },
  eyebrow: { fontSize: 8.5, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase" },
  logoChip: {
    backgroundColor: "#ffffff",
    borderRadius: mm(3),
    paddingVertical: mm(1.5),
    paddingHorizontal: mm(3),
  },
  logo: { height: mm(8), maxWidth: mm(40), objectFit: "contain" },
});

export function TeaserPage({
  letter,
  teaser,
}: {
  letter: PrintableLetterData;
  teaser: PrintableTeaser;
}) {
  const { colors } = teaser;
  const display = displayStyle(teaser.style);
  const compact = Boolean(teaser.beforeAfter);
  return (
    <Page size="A4" style={[page2.page, { color: colors.ink }]}>
      <Blobs
        circles={[
          { color: colors.accentSoft, cx: 193, cy: 15, r: 75 },
          { color: colors.paper, cx: 5, cy: 205, r: 55 },
        ]}
      />

      <View style={page2.header}>
        <Text style={[page2.eyebrow, { color: colors.accent }]}>
          {teaser.eyebrow ?? `Für ${letter.companyName}`}
        </Text>
        {teaser.logo ? (
          <View style={page2.logoChip}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML */}
            <Image src={teaser.logo.src} style={page2.logo} />
          </View>
        ) : null}
      </View>

      <Text style={{ ...display, fontSize: 28, marginTop: mm(4), maxWidth: mm(160) }}>
        {teaser.headline}
      </Text>
      {teaser.lead ? (
        <Text style={{ fontSize: 10, color: colors.muted, marginTop: mm(2.5), maxWidth: mm(150) }}>
          {teaser.lead}
        </Text>
      ) : null}

      <View style={{ marginTop: mm(7) }}>
        {teaser.beforeAfter ? (
          <BeforeAfterStage teaser={teaser} />
        ) : teaser.image ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
          <Image
            src={teaser.image.src}
            style={{ width: "100%", height: mm(84), objectFit: "cover", borderRadius: mm(4) }}
          />
        ) : null}
      </View>

      {teaser.ideas.length > 0 ? (
        <View style={{ marginTop: mm(compact ? 7 : 9) }}>
          <Text style={[page2.eyebrow, { color: colors.accent, marginBottom: mm(2.5) }]}>
            {teaser.ideasTitle}
          </Text>
          <View style={{ flexDirection: "row", gap: mm(6) }}>
            {teaser.ideas.map((idea, index) => (
              <View key={index} style={{ flex: 1 }} wrap={false}>
                <Text style={{ ...display, fontSize: 26, color: colors.accent, lineHeight: 1 }}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <Text style={{ fontSize: 10.5, fontWeight: 600, marginTop: mm(1.5) }}>
                  {idea.title}
                </Text>
                <Text style={{ fontSize: 8.6, color: colors.muted, marginTop: mm(1) }}>
                  {idea.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <CtaBand letter={letter} teaser={teaser} />
    </Page>
  );
}

/**
 * The way in once more, built like the card on page 1 so both pages read as
 * one piece: what waits there, the link, the code, and how to reach the
 * sender. Show, don't tell: link, number and address explain themselves,
 * only the code gets a small „Scannen“.
 */
function CtaBand({ letter, teaser }: { letter: PrintableLetterData; teaser: PrintableTeaser }) {
  const { colors, contact } = teaser;
  const display = displayStyle(teaser.style);
  const name = letter.signer.name;
  const showContact = Boolean(name || teaser.ownerPhoto || contact?.phone || contact?.email);
  const gap = mm(4);
  // The code spans the left column: its top on the headline, its label's
  // bottom on the contact row. Heights of the fixed parts, in points.
  const leftHeight =
    20 +
    mm(2) +
    10 * 1.4 +
    (letter.qr.shortLink ? gap + 14 * 1.62 : 0) +
    (showContact ? gap * 2 + 0.75 + mm(11) : 0);
  // The tile starts on the headline's cap height, not on its line box.
  const capInset = mm(1.3);
  const qrSize = Math.max(mm(28), leftHeight - capInset - mm(4.4) - 2.4 - LABEL_HEIGHT / 2);
  return (
    <View
      wrap={false}
      style={{
        position: "absolute",
        bottom: mm(12),
        left: mm(18),
        right: mm(18),
        flexDirection: "row",
        alignItems: "stretch",
        padding: mm(6),
        borderRadius: mm(5),
        backgroundColor: colors.accentSoft,
        color: colors.ink,
      }}
    >
      {/* Left column: top edge on the headline, bottom edge on the contact row. */}
      <View style={{ flex: 1, justifyContent: "space-between", marginRight: mm(8) }}>
        <View>
          <Text style={{ ...display, fontSize: 20, lineHeight: 1 }}>
            Alles Weitere auf dieser Seite
          </Text>
          <Text style={{ fontSize: 10, marginTop: mm(2), color: colors.muted }}>
            Alle Entwürfe, Beispiele und ein Preisrahmen.
          </Text>
          {letter.qr.shortLink ? (
            <View style={{ marginTop: gap }}>
              <LinkPill
                href={`https://${letter.qr.shortLink}`}
                text={letter.qr.shortLink}
                size={14}
                colors={colors}
              />
            </View>
          ) : null}
        </View>
        {showContact ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: gap,
              paddingTop: gap,
              borderTopWidth: 0.75,
              borderTopColor: colors.muted,
            }}
          >
            {teaser.ownerPhoto ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
              <Image
                src={teaser.ownerPhoto}
                style={{
                  width: mm(11),
                  height: mm(11),
                  borderRadius: mm(5.5),
                  objectFit: "cover",
                  marginRight: mm(3),
                }}
              />
            ) : null}
            <View style={{ flexShrink: 1 }}>
              {name ? (
                <Text style={{ fontSize: 10.5, lineHeight: 1, fontWeight: 600 }}>{name}</Text>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: name ? mm(2) : 0 }}>
                {contact?.phone ? (
                  <ContactLine kind="phone" color={colors.accent} text={contact.phone} />
                ) : null}
                {contact?.email ? (
                  <ContactLine kind="mail" color={colors.accent} text={contact.email} />
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
      </View>
      {/* Right column: code on the top edge, its label on the bottom edge. */}
      <View style={{ justifyContent: "flex-end", alignItems: "center", paddingTop: capInset }}>
        <QrTile letter={letter} teaser={teaser} size={qrSize} />
      </View>
    </View>
  );
}

/** Icon and text on one centre line. */
function ContactLine({
  kind,
  color,
  text,
}: {
  kind: "phone" | "mail";
  color: string;
  text: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginRight: mm(6) }}>
      <ContactIcon kind={kind} color={color} />
      <Text style={{ fontSize: 10, lineHeight: 1 }}>{text}</Text>
    </View>
  );
}
