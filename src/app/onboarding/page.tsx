import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { serverEnv } from "@/config/env";
import { getDb, withTenant } from "@/db";
import { domains, workspaceSettings } from "@/db/schema";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/domain/onboarding";
import { workspaceSettingsSchema } from "@/domain/workspace-settings";
import {
  loadBrandImages,
  type BrandImageKind,
  type BrandImagePreview,
} from "@/server/brand-images";
import { getWorkspaceContext } from "@/server/session";
import { PasskeyStep, ProfileStep, SenderStep, WorkspaceStep } from "./steps";

export const metadata: Metadata = { title: "Einrichtung" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { user, active } = await getWorkspaceContext();
  if (active?.onboardingCompletedAt) redirect("/");

  const requested = Number((await searchParams).step ?? 1);
  const step = (active ? Math.min(Math.max(requested, 1), 4) : 1) as OnboardingStep;
  const platformDomain = serverEnv().PLATFORM_DOMAIN;

  let settings = workspaceSettingsSchema.parse({});
  let customDomain = "";
  let brandImages: Record<BrandImageKind, BrandImagePreview | null> = {
    photo: null,
    logo: null,
    signature: null,
  };
  if (active) {
    const loaded = await withTenant(
      getDb(),
      { userId: user.id, workspaceId: active.id },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(workspaceSettings)
          .where(eq(workspaceSettings.workspaceId, active.id));
        const [domain] = await tx
          .select({ hostname: domains.hostname })
          .from(domains)
          .where(eq(domains.workspaceId, active.id))
          .limit(1);
        const parsed = workspaceSettingsSchema.parse(row ?? {});
        return { row, domain, images: await loadBrandImages(tx, active.id, parsed) };
      },
    );
    settings = workspaceSettingsSchema.parse(loaded.row ?? {});
    customDomain = loaded.domain?.hostname ?? "";
    brandImages = loaded.images;
  }

  const current = ONBOARDING_STEPS.find((s) => s.id === step) ?? ONBOARDING_STEPS[0];

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <p className="text-sm font-medium text-accent">
          Schritt {step} von {ONBOARDING_STEPS.length}
        </p>
        <h1 className="text-3xl font-semibold">{headline(step)}</h1>
        <p className="text-foreground-muted">{intro(step)}</p>
      </div>

      <nav aria-label="Fortschritt der Einrichtung">
        <ol className="grid grid-cols-4 gap-2">
          {ONBOARDING_STEPS.map((s) => (
            <li
              key={s.id}
              aria-current={s.id === current.id ? "step" : undefined}
              className="grid gap-2"
            >
              <span
                aria-hidden
                className={
                  s.id <= step ? "h-1.5 rounded-full bg-accent" : "h-1.5 rounded-full bg-border"
                }
              />
              <span
                className={
                  s.id === step
                    ? "text-xs font-medium text-foreground"
                    : "text-xs text-foreground-muted"
                }
              >
                <span className="sr-only">
                  {s.id < step ? "Erledigt: " : s.id === step ? "Aktuell: " : "Offen: "}
                </span>
                {s.title}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      {step === 1 ? (
        <WorkspaceStep
          defaults={{ name: active?.name ?? "", slug: active?.slug ?? "" }}
          platformDomain={platformDomain}
        />
      ) : null}
      {step === 2 ? (
        <ProfileStep
          images={brandImages}
          defaults={{
            "profile.displayName": settings.profile.displayName ?? user.name ?? "",
            "profile.role": settings.profile.role ?? "",
            "channels.email": settings.channels.email ?? user.email,
            "channels.phone": settings.channels.phone ?? "",
            "channels.mobile": settings.channels.mobile ?? "",
            "channels.whatsapp": settings.channels.whatsapp ?? "",
          }}
        />
      ) : null}
      {step === 3 ? (
        <SenderStep
          defaults={{
            "senderAddress.company": settings.senderAddress.company ?? active?.name ?? "",
            "senderAddress.street": settings.senderAddress.street ?? "",
            "senderAddress.postalCode": settings.senderAddress.postalCode ?? "",
            "senderAddress.city": settings.senderAddress.city ?? "",
            customDomain,
          }}
          platformHost={`${active?.slug ?? "ihr-workspace"}.${platformDomain}`}
        />
      ) : null}
      {step === 4 ? <PasskeyStep /> : null}
    </div>
  );
}

function headline(step: OnboardingStep): string {
  switch (step) {
    case 1:
      return "Ihr Workspace";
    case 2:
      return "Wie Interessenten Sie erreichen";
    case 3:
      return "Absender und Adresse Ihrer Exposés";
    case 4:
      return "Schneller anmelden mit Passkey";
  }
}

function intro(step: OnboardingStep): string {
  switch (step) {
    case 1:
      return "Der Name erscheint im Cockpit, die Adresse in Ihren Kurzlinks, solange Sie keine eigene Domain nutzen.";
    case 2:
      return "Diese Angaben nutzt Aquisiteur für die Kontaktknöpfe in Ihren Exposés. Sie können alles später ändern.";
    case 3:
      return "Die Absenderadresse steht in Ihren Briefen. Eine eigene Domain lässt Kurzlinks vertrauter wirken.";
    case 4:
      return "Ein Passkey meldet Sie per Fingerabdruck, Gesicht oder Geräte-PIN an. Kein Passwort, kein Warten auf E-Mails.";
  }
}
