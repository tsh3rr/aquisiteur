import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const tones = {
  info: { icon: Info, className: "bg-accent-soft text-accent-soft-foreground", label: "Hinweis" },
  success: {
    icon: CircleCheck,
    className: "bg-success-soft text-success-foreground",
    label: "Erfolg",
  },
  warning: {
    icon: TriangleAlert,
    className: "bg-warning-soft text-warning-foreground",
    label: "Warnung",
  },
  danger: {
    icon: CircleAlert,
    className: "bg-danger-soft text-danger-soft-foreground",
    label: "Fehler",
  },
} as const;

/** Status message with icon and text (never colour alone, §8). */
export function Alert({
  tone = "info",
  className,
  children,
  ...props
}: ComponentProps<"div"> & { tone?: keyof typeof tones }) {
  const { icon: Icon, className: toneClass, label } = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-md p-3.5 text-sm", toneClass, className)}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="sr-only">{label}: </span>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}
