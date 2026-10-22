"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatQuantity, parseEuroInput } from "@/domain/offers/totals";

/** Number inputs of the offer and invoice editors: typed freely, kept as numbers once they parse. */

function parseQuantity(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : null;
}

/** Euro amount typed freely ("1.234,50"), kept as cents once it parses. */
export function EuroInput({
  cents,
  onChange,
  ...props
}: { cents: number; onChange: (cents: number) => void } & Omit<
  React.ComponentProps<"input">,
  "onChange" | "value"
>) {
  const [raw, setRaw] = useState(() => (cents / 100).toFixed(2).replace(".", ","));
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        const parsed = parseEuroInput(event.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setRaw((cents / 100).toFixed(2).replace(".", ","))}
    />
  );
}

export function QuantityInput({
  value,
  onChange,
  ...props
}: { value: number; onChange: (value: number) => void } & Omit<
  React.ComponentProps<"input">,
  "onChange" | "value"
>) {
  const [raw, setRaw] = useState(() => formatQuantity(value));
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        const parsed = parseQuantity(event.target.value);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => setRaw(formatQuantity(value))}
    />
  );
}
