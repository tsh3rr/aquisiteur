"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { PROSPECT_STATUSES, STATUS_LABELS, type ProspectStatus } from "@/domain/prospects/status";
import { changeStatus } from "../actions";

export function StatusSelect({ id, status }: { id: string; status: ProspectStatus }) {
  const [value, setValue] = useState(status);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="prospect-status" className="text-sm font-medium">
        Status
      </label>
      <Select
        id="prospect-status"
        value={value}
        disabled={pending}
        className="h-11 w-auto"
        onChange={(event) => {
          const next = event.target.value as ProspectStatus;
          setValue(next);
          startTransition(async () => {
            const result = await changeStatus([id], next);
            setMessage(result.message ?? "");
          });
        }}
      >
        {PROSPECT_STATUSES.map((option) => (
          <option key={option} value={option}>
            {STATUS_LABELS[option]}
          </option>
        ))}
      </Select>
      <p aria-live="polite" className="text-sm text-foreground-muted">
        {message}
      </p>
    </div>
  );
}
