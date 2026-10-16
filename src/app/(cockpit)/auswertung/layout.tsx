import { Suspense } from "react";
import { AnalyticsTabs } from "@/components/analytics/tabs";
import { PageHeader } from "@/components/ui/misc";

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Auswertung"
        description="Was Ihre Briefe bewirken: von der Öffnung bis zum Auftrag. Gezählt werden nur echte Besuche, ohne Bots und ohne Ihre eigenen Geräte."
      />
      <Suspense fallback={<div className="h-11 border-b border-border" />}>
        <AnalyticsTabs />
      </Suspense>
      {children}
    </div>
  );
}
