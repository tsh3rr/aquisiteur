/** A labelled checkbox with an optional hint, for the settings forms. */
export function Toggle({
  name,
  label,
  hint,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
  disabled: boolean;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5 size-5 shrink-0 accent-accent"
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-foreground-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
