import { Picture } from "./picture";
import { ownerPhoto, type RenderContext } from "./render-context";

export function ownerName(context: RenderContext): string {
  return context.settings.profile.displayName ?? context.workspaceName;
}

/** Face of the owner: trust signal (§8 "sichtbares Gesicht des Owners"). */
export function OwnerBadge({
  context,
  size = "md",
  showRole = true,
}: {
  context: RenderContext;
  size?: "sm" | "md";
  showRole?: boolean;
}) {
  const name = ownerName(context);
  const photo = ownerPhoto(context, "");
  const company = context.settings.senderAddress.company ?? context.workspaceName;
  const role = [context.settings.profile.role, company].filter(Boolean).join(", ");
  return (
    <div className="flex items-center gap-3">
      {photo ? (
        <Picture
          image={photo}
          sizes={size === "sm" ? "40px" : "56px"}
          className={size === "sm" ? "size-10 shrink-0" : "size-14 shrink-0"}
          sizing="size-full"
          imgClassName="rounded-full object-cover ring-2 ring-surface"
        />
      ) : null}
      <div className="grid leading-tight">
        <span className="font-semibold">{name}</span>
        {showRole && role ? <span className="text-sm text-foreground-muted">{role}</span> : null}
      </div>
    </div>
  );
}
