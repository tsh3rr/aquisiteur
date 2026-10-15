import { type ReactElement, cloneElement, useId } from "react";
import { cn } from "@/lib/cn";
import { Label } from "./label";

interface FieldProps {
  label: string;
  /** Shown below the label, linked via aria-describedby. */
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>;
}

/** Label + control + hint + error, wired up for screen readers. */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="ml-1.5 font-normal text-foreground-muted">(optional)</span> : null}
      </Label>
      {hint ? (
        <p id={hintId} className="-mt-0.5 text-sm text-foreground-muted">
          {hint}
        </p>
      ) : null}
      {cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
