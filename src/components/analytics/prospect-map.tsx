"use client";

import "leaflet/dist/leaflet.css";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  STATUS_LABELS,
  STATUS_TONES,
  type ProspectStatus,
  type StatusTone,
} from "@/domain/prospects/status";
import { MAP_TILE_URL } from "@/lib/security-headers";
import { cn } from "@/lib/cn";

export interface ProspectMapPoint {
  id: string;
  companyName: string;
  city: string | null;
  status: ProspectStatus;
  score: number | null;
  latitude: number;
  longitude: number;
}

type ColorMode = "status" | "score";

/** Status groups by badge tone; the legend names them, the popup names the status. */
const TONE_GROUPS: { tone: StatusTone; label: string; color: string }[] = [
  { tone: "neutral", label: "Entwurf oder Brief versendet", color: "--aq-foreground-subtle" },
  { tone: "accent", label: "Geöffnet oder interessiert", color: "--aq-accent" },
  { tone: "warning", label: "Kontakt oder Termin", color: "--aq-warning" },
  { tone: "success", label: "Gewonnen", color: "--aq-success" },
  { tone: "danger", label: "Verloren oder kein Interesse", color: "--aq-danger" },
];

/** Sequential, one hue: higher intent, darker. */
const SCORE_STEPS: { min: number; label: string; opacity: number }[] = [
  { min: 75, label: "75–100 %", opacity: 1 },
  { min: 50, label: "50–74 %", opacity: 0.75 },
  { min: 25, label: "25–49 %", opacity: 0.5 },
  { min: 0, label: "0–24 %", opacity: 0.25 },
];

const GERMANY: [number, number] = [51.1, 10.4];

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "gray";
}

function style(point: ProspectMapPoint, mode: ColorMode) {
  if (mode === "status") {
    const group = TONE_GROUPS.find((entry) => entry.tone === STATUS_TONES[point.status])!;
    return { fillColor: cssVar(group.color), fillOpacity: 0.9 };
  }
  if (point.score === null)
    return { fillColor: cssVar("--aq-foreground-subtle"), fillOpacity: 0.4 };
  const step = SCORE_STEPS.find((entry) => point.score! >= entry.min)!;
  return { fillColor: cssVar("--aq-accent"), fillOpacity: step.opacity };
}

/**
 * Prospects on an OpenStreetMap map (§7.8 „Karte“). Leaflet loads only in
 * the browser; the list below the map carries the same data as text.
 */
export function ProspectMap({ points }: { points: ProspectMapPoint[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<{ point: ProspectMapPoint; marker: CircleMarker }[]>([]);
  const [mode, setMode] = useState<ColorMode>("status");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current || map.current) return;
      const instance = L.map(container.current, { scrollWheelZoom: false });
      L.tileLayer(MAP_TILE_URL, {
        maxZoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
      }).addTo(instance);
      markers.current = points.map((point) => {
        const marker = L.circleMarker([point.latitude, point.longitude], {
          radius: 8,
          weight: 2,
          color: cssVar("--aq-surface"),
        }).addTo(instance);
        const popup = document.createElement("div");
        const link = document.createElement("a");
        link.href = `/kunden/${point.id}`;
        link.textContent = point.companyName;
        link.style.fontWeight = "600";
        const detail = document.createElement("div");
        detail.textContent = [
          STATUS_LABELS[point.status],
          point.score === null ? null : `Kontaktabsicht ${point.score} %`,
          point.city,
        ]
          .filter(Boolean)
          .join(" · ");
        popup.append(link, detail);
        marker.bindPopup(popup);
        marker.bindTooltip(point.companyName);
        return { point, marker };
      });
      if (points.length > 0) {
        instance.fitBounds(
          L.latLngBounds(points.map((point) => [point.latitude, point.longitude])),
          { padding: [32, 32], maxZoom: 13 },
        );
      } else {
        instance.setView(GERMANY, 6);
      }
      map.current = instance;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [points]);

  useEffect(() => {
    if (!ready) return;
    for (const { point, marker } of markers.current) marker.setStyle(style(point, mode));
  }, [mode, ready]);

  return (
    <div className="grid gap-4">
      <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <legend className="sr-only">Einfärben nach</legend>
        <span className="text-sm text-foreground-muted" aria-hidden>
          Einfärben nach
        </span>
        {(
          [
            ["status", "Status"],
            ["score", "Kontaktabsicht"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="map-color"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
              className="size-5 accent-accent"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="relative">
        {/* Leaflet makes the container focusable and pannable with the arrow keys. */}
        <div
          ref={container}
          role="region"
          aria-label="Karte der Kunden"
          className="h-[28rem] overflow-hidden rounded-lg border border-border bg-surface-sunken"
        />
        {ready ? null : (
          <div
            aria-hidden
            className="absolute inset-0 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none"
          />
        )}
      </div>
      <ul aria-label="Legende" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {mode === "status"
          ? TONE_GROUPS.map((group) => (
              <li key={group.tone} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-3 rounded-full ring-2 ring-surface"
                  style={{ background: `var(${group.color})` }}
                />
                {group.label}
              </li>
            ))
          : [
              ...SCORE_STEPS.map((step) => (
                <li key={step.min} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-3 rounded-full bg-accent ring-2 ring-surface"
                    style={{ opacity: step.opacity }}
                  />
                  {step.label}
                </li>
              )),
              <li key="none" className="flex items-center gap-2">
                <span aria-hidden className="size-3 rounded-full bg-foreground-subtle/40" />
                Noch kein Wert
              </li>,
            ]}
      </ul>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent underline-offset-4 hover:underline">
          Kunden auf der Karte als Liste ({points.length})
        </summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Firma
              </th>
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Ort
              </th>
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Status
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Kontaktabsicht
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.id} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-4">
                  <Link
                    href={`/kunden/${point.id}`}
                    className={cn("text-accent underline-offset-4 hover:underline")}
                  >
                    {point.companyName}
                  </Link>
                </td>
                <td className="py-1.5 pr-4">{point.city ?? "–"}</td>
                <td className="py-1.5 pr-4">{STATUS_LABELS[point.status]}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {point.score === null ? "–" : `${point.score} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
