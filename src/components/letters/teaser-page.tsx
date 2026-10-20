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
import type { PrintImage, PrintableTeaser } from "@/domain/letters/teaser";
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
 * small „Hi!“ badge in the middle (level H keeps it readable with the hole).
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
  badge: { background: string; color: string; font: Style } | null;
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
          <Text style={{ ...badge.font, color: badge.color, fontSize: badgeSize * 0.42 }}>Hi!</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A fat hand-drawn arrow, bending from the left down to the right. */
function FatArrow({ width, color, style }: { width: number; color: string; style?: Style }) {
  return (
    <Svg width={width} height={width * 0.7} viewBox="0 0 120 84" style={style}>
      <Path
        d="M10 18 C 44 2, 90 10, 98 52"
        stroke={color}
        strokeWidth={11}
        strokeLinecap="round"
        fill="none"
      />
      <Polygon points="80,46 117,42 101,78" fill={color} />
    </Svg>
  );
}

/** A tilted round sticker, like the ones on a shop window. */
function Sticker({
  children,
  background,
  color,
  style,
}: {
  children: string;
  background: string;
  color: string;
  style?: Style;
}) {
  return (
    <View
      style={{
        position: "absolute",
        paddingVertical: mm(1.2),
        paddingHorizontal: mm(2.6),
        borderRadius: mm(4),
        backgroundColor: background,
        transform: "rotate(-8deg)",
        ...style,
      }}
    >
      <Text style={{ color, fontSize: 8.5, fontWeight: 600, letterSpacing: 0.4 }}>{children}</Text>
    </View>
  );
}

/** The white tile with the dotted code and a „Scan mich“ sticker on its corner. */
function QrTile({
  letter,
  teaser,
  size,
  tilt,
}: {
  letter: PrintableLetterData;
  teaser: PrintableTeaser;
  size: number;
  tilt: number;
}) {
  const { colors } = teaser;
  return (
    <View style={{ transform: `rotate(${tilt}deg)`, padding: mm(2) }}>
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
            badge={{
              background: colors.accent,
              color: colors.onAccent,
              font: displayStyle(teaser.style),
            }}
          />
        </Link>
      </View>
      <Sticker
        background={colors.accent}
        color={colors.onAccent}
        style={{ bottom: -mm(2.5), right: -mm(6) }}
      >
        SCAN MICH!
      </Sticker>
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
          paddingRight: mm(6),
          borderRadius: mm(4),
          backgroundColor: colors.accentSoft,
        }}
      >
        <QrTile letter={letter} teaser={teaser} size={mm(27)} tilt={-3} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...display, fontSize: 16, color: colors.ink }}>
            Ihre persönliche Seite
          </Text>
          <Text style={{ marginTop: mm(1.5), fontSize: 9.5, color: colors.muted }}>
            {letter.qr.hint}
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
              <Text style={{ fontSize: 9, color: colors.muted, marginRight: mm(2) }}>
                oder eintippen:
              </Text>
              <Link
                src={`https://${letter.qr.shortLink}`}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: colors.onAccent,
                  backgroundColor: colors.accent,
                  paddingVertical: mm(1),
                  paddingHorizontal: mm(2.5),
                  borderRadius: mm(3),
                  textDecoration: "none",
                }}
              >
                {letter.qr.shortLink}
              </Link>
            </View>
          ) : null}
        </View>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          marginTop: mm(2),
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
            marginTop: mm(3),
            marginRight: mm(2),
          }}
        >
          {`Bitte umblättern: ${letter.duplex ? "Auf der Rückseite" : "Auf der nächsten Seite"} sehen Sie schon, ${preview}.`}
        </Text>
        <FatArrow width={mm(20)} color={colors.accent} />
      </View>
    </View>
  );
}

/* ---------- page 2 ---------- */

const PHONE_RATIO = 760 / 360;

function Phone({
  image,
  width,
  desktop,
  tilt,
}: {
  image: PrintImage;
  width: number;
  desktop: boolean;
  tilt: number;
}) {
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
        transform: `rotate(${tilt}deg)`,
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

function Pill({
  children,
  background,
  color,
}: {
  children: string;
  background: string;
  color: string;
}) {
  return (
    <Text
      style={{
        alignSelf: "center",
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color,
        backgroundColor: background,
        paddingVertical: mm(1),
        paddingHorizontal: mm(2.8),
        borderRadius: mm(3),
        marginBottom: mm(3),
      }}
    >
      {children}
    </Text>
  );
}

function BeforeAfterStage({ teaser }: { teaser: PrintableTeaser }) {
  const stage = teaser.beforeAfter!;
  const { colors } = teaser;
  const arrow = (
    <View style={{ alignItems: "center", width: mm(30), marginTop: mm(18) }}>
      <FatArrow width={mm(26)} color={colors.accent} style={{ transform: "rotate(-18deg)" }} />
    </View>
  );
  if (stage.kind === "phones") {
    return (
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "flex-start" }}>
        <View>
          <Pill background={colors.ink} color="#ffffff">
            {stage.beforeLabel}
          </Pill>
          <Phone image={stage.before} width={mm(40)} desktop={stage.beforeIsDesktop} tilt={-4} />
        </View>
        {arrow}
        <View>
          <Pill background={colors.accent} color={colors.onAccent}>
            {stage.afterLabel}
          </Pill>
          <Phone image={stage.after} width={mm(46)} desktop={false} tilt={3} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "flex-start" }}>
      <View>
        <Pill background={colors.ink} color="#ffffff">
          {stage.beforeLabel}
        </Pill>
        <BrowserWindow image={stage.before} width={mm(68)} />
      </View>
      {arrow}
      <View>
        <Pill background={colors.accent} color={colors.onAccent}>
          {stage.afterLabel}
        </Pill>
        <BrowserWindow image={stage.after} width={mm(68)} />
      </View>
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

/** The way in once more: headline, the link and the code, each with its own cue. */
function CtaBand({ letter, teaser }: { letter: PrintableLetterData; teaser: PrintableTeaser }) {
  const { colors, contact } = teaser;
  const display = displayStyle(teaser.style);
  const reach = [contact?.phone ? `Tel. ${contact.phone}` : null, contact?.email ?? null].filter(
    Boolean,
  );
  return (
    <View
      wrap={false}
      style={{
        position: "absolute",
        bottom: mm(12),
        left: mm(18),
        right: mm(18),
        flexDirection: "row",
        alignItems: "center",
        padding: mm(5),
        paddingRight: mm(3),
        borderRadius: mm(5),
        backgroundColor: colors.accent,
      }}
    >
      <View style={{ flex: 1, color: colors.onAccent }}>
        <Text style={{ ...display, fontSize: 22 }}>Alles Weitere auf dieser Seite</Text>
        <Text style={{ fontSize: 10, marginTop: mm(2.5) }}>
          Alle Entwürfe, Beispiele und ein Preisrahmen, ganz in Ruhe zum Durchsehen.
        </Text>
        {letter.qr.shortLink ? (
          <View style={{ flexDirection: "row", marginTop: mm(8) }}>
            <View>
              <Link
                src={`https://${letter.qr.shortLink}`}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: colors.ink,
                  backgroundColor: "#ffffff",
                  paddingVertical: mm(1.6),
                  paddingHorizontal: mm(3.5),
                  borderRadius: mm(3.5),
                  textDecoration: "none",
                }}
              >
                {letter.qr.shortLink}
              </Link>
              <Sticker
                background={colors.ink}
                color="#ffffff"
                style={{ top: -mm(6.5), left: -mm(1) }}
              >
                TIPP MICH EIN!
              </Sticker>
            </View>
          </View>
        ) : null}
        {letter.signer.name || teaser.ownerPhoto || reach.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: mm(4) }}>
            {teaser.ownerPhoto ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
              <Image
                src={teaser.ownerPhoto}
                style={{
                  width: mm(10),
                  height: mm(10),
                  borderRadius: mm(5),
                  objectFit: "cover",
                  marginRight: mm(2.5),
                }}
              />
            ) : null}
            <View style={{ flexShrink: 1 }}>
              {letter.signer.name ? (
                <Text style={{ fontSize: 10, fontWeight: 600 }}>
                  {reach.length > 0 ? `Lieber direkt? ${letter.signer.name}` : letter.signer.name}
                </Text>
              ) : null}
              {reach.length > 0 ? (
                <Text style={{ fontSize: 9.5, marginTop: mm(0.5) }}>{reach.join("  ·  ")}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
      <FatArrow
        width={mm(16)}
        color={colors.onAccent}
        style={{ transform: "rotate(-30deg)", marginHorizontal: mm(1) }}
      />
      <QrTile letter={letter} teaser={teaser} size={mm(28)} tilt={3} />
    </View>
  );
}
