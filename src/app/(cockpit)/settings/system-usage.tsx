import { AlertTriangle, CircleCheck, OctagonAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatBytes, type UsageReading } from "@/domain/system-limits";
import { cn } from "@/lib/cn";
import type { PlatformUsage, WorkspaceUsage } from "@/server/system-usage";

/** Settings → System (§5a): usage against limits, warning from 80 %. */

const number = (value: number) => value.toLocaleString("de-DE");
const ms = (value: number) => `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ms`;

function Level({ reading }: { reading: UsageReading }) {
  if (reading.level === "unlimited") return <Badge>Unbegrenzt</Badge>;
  if (reading.level === "exceeded")
    return (
      <Badge tone="danger">
        <OctagonAlert aria-hidden />
        Limit erreicht
      </Badge>
    );
  if (reading.level === "warning")
    return (
      <Badge tone="warning">
        <AlertTriangle aria-hidden />
        Über 80 %
      </Badge>
    );
  return (
    <Badge tone="success">
      <CircleCheck aria-hidden />
      Im Rahmen
    </Badge>
  );
}

function Row({
  label,
  reading,
  format = number,
  hint,
}: {
  label: string;
  reading: UsageReading;
  format?: (value: number) => string;
  hint?: string;
}) {
  const percent = reading.ratio === null ? null : Math.round(reading.ratio * 100);
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 gap-y-1.5 py-3 first:pt-0 last:pb-0">
      <dt className="font-medium">{label}</dt>
      <dd>
        <Level reading={reading} />
      </dd>
      <dd className="col-span-2 grid gap-1.5">
        <span className="text-sm text-foreground-muted">
          {format(reading.used)}
          {reading.limit === null ? "" : ` von ${format(reading.limit)} (${percent} %)`}
          {hint ? ` · ${hint}` : ""}
        </span>
        {reading.ratio === null ? null : (
          <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <span
              className={cn(
                "block h-full rounded-full",
                reading.level === "exceeded"
                  ? "bg-danger"
                  : reading.level === "warning"
                    ? "bg-warning"
                    : "bg-accent",
              )}
              style={{ width: `${Math.min(100, Math.max(2, percent ?? 0))}%` }}
            />
          </span>
        )}
      </dd>
    </div>
  );
}

export function WorkspaceUsageList({ usage }: { usage: WorkspaceUsage }) {
  return (
    <dl className="divide-y divide-border">
      <Row label="Veröffentlichte Exposés" reading={usage.publishedExposes} />
      <Row
        label="Besuche in diesem Monat"
        reading={usage.monthlyVisits}
        hint="ohne Bots und eigene Besuche"
      />
      <Row label="Mitglieder" reading={usage.members} />
      <Row
        label="Speicher"
        reading={usage.storageBytes}
        format={formatBytes}
        hint="Bilder und Aufzeichnungen"
      />
    </dl>
  );
}

export function PlatformUsageList({ usage }: { usage: PlatformUsage }) {
  return (
    <div className="grid gap-3">
      <h3 className="text-sm font-semibold">
        Installation · {usage.plan === "free" ? "Gratis-Pläne" : "Bezahlte Pläne"}
      </h3>
      <dl className="divide-y divide-border">
        {usage.requestsToday ? (
          <Row
            label="Anfragen heute"
            reading={usage.requestsToday}
            hint={usage.errorsToday ? `${number(usage.errorsToday)} mit Fehler` : undefined}
          />
        ) : null}
        {usage.cpuMsP99 ? (
          <Row
            label="CPU-Zeit pro Anfrage (99 %)"
            reading={usage.cpuMsP99}
            format={ms}
            hint={usage.cpuMsP50 === null ? undefined : `Median ${ms(usage.cpuMsP50)}`}
          />
        ) : null}
        <Row label="Datenbank" reading={usage.databaseBytes} format={formatBytes} />
        <Row label="Dateispeicher" reading={usage.storageBytes} format={formatBytes} />
      </dl>
      {usage.requestsToday ? null : (
        <p className="text-sm text-foreground-muted">
          {usage.metricsConfigured
            ? "Anfragen und CPU-Zeit sind gerade nicht abrufbar."
            : "Anfragen und CPU-Zeit erscheinen hier, sobald CLOUDFLARE_ACCOUNT_ID und CLOUDFLARE_ANALYTICS_TOKEN gesetzt sind (docs/DEPLOY.md)."}
        </p>
      )}
    </div>
  );
}
