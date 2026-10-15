import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const inputClassName = cn(
  "block h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-foreground",
  "placeholder:text-foreground-subtle shadow-sm transition-[border-color,box-shadow] duration-150",
  "hover:border-foreground-muted focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus-ring",
  "aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-70",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClassName, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClassName, "h-auto min-h-24 py-2.5", className)} {...props} />;
}
