"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverEnv } from "@/config/env";
import { getDb, withTenant, type Transaction } from "@/db";
import { auditLog, domains, workspaceSettings, workspaces } from "@/db/schema";
import { assertCan, type Action } from "@/domain/authz";
import {
  type FieldErrors,
  fieldErrors,
  profileStepSchema,
  senderStepSchema,
  slugProblemMessages,
  workspaceStepSchema,
} from "@/domain/onboarding";
import { validateSlug } from "@/domain/slug";
import { ACTIVE_WORKSPACE_COOKIE, getWorkspaceContext } from "@/server/session";
import { createWorkspace } from "@/server/workspaces";

export interface StepState {
  errors?: FieldErrors;
  formError?: string;
  values?: Record<string, string>;
}

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}

/** Runs `fn` as tenant for the workspace being onboarded, after a can() check. */
async function asOnboardingTenant<T>(
  action: Action,
  fn: (tx: Transaction, workspaceId: string, userId: string) => Promise<T>,
) {
  const { user, active } = await getWorkspaceContext();
  if (!active) redirect("/onboarding?step=1");
  assertCan({ userId: user.id, role: active.role, workspaceId: active.id }, action, {
    workspaceId: active.id,
  });
  return withTenant(getDb(), { userId: user.id, workspaceId: active.id }, (tx) =>
    fn(tx, active.id, user.id),
  );
}

export async function saveWorkspaceStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const values = formValues(formData);
  const parsed = workspaceStepSchema.safeParse(values);
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error) };
  const { name, slug } = parsed.data;

  const slugProblem = validateSlug(slug);
  if (slugProblem) return { values, errors: { slug: slugProblemMessages[slugProblem] } };

  const { user, active } = await getWorkspaceContext();

  if (!active) {
    const result = await createWorkspace(getDb(), { userId: user.id, name, slug });
    if (!result.ok) return { values, errors: { slug: slugProblemMessages[result.error] } };
    (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, result.workspace.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: serverEnv().APP_URL.startsWith("https:"),
      path: "/",
    });
  } else {
    const outcome = await asOnboardingTenant(
      "workspace.update",
      async (tx, workspaceId, userId) => {
        try {
          // Savepoint, so a unique violation does not abort the outer transaction.
          await tx.transaction((sp) =>
            sp.update(workspaces).set({ name, slug }).where(eq(workspaces.id, workspaceId)),
          );
        } catch (error) {
          if (isUniqueViolation(error)) return "slug_taken" as const;
          throw error;
        }
        await tx.insert(auditLog).values({
          workspaceId,
          actorUserId: userId,
          action: "workspace.updated",
          targetType: "workspace",
          targetId: workspaceId,
          meta: { fields: ["name", "slug"] },
        });
        return "ok" as const;
      },
    );
    if (outcome === "slug_taken")
      return { values, errors: { slug: slugProblemMessages.slug_taken } };
  }
  redirect("/onboarding?step=2");
}

export async function saveProfileStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const values = formValues(formData);
  const parsed = profileStepSchema.safeParse({
    profile: { displayName: values["profile.displayName"], role: values["profile.role"] },
    channels: {
      email: values["channels.email"],
      phone: values["channels.phone"],
      mobile: values["channels.mobile"],
      whatsapp: values["channels.whatsapp"],
    },
  });
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error) };

  await asOnboardingTenant("settings.update", async (tx, workspaceId) => {
    await tx
      .update(workspaceSettings)
      .set({
        profile: sql`${workspaceSettings.profile} || ${JSON.stringify(parsed.data.profile)}::jsonb`,
        channels: sql`${workspaceSettings.channels} || ${JSON.stringify(parsed.data.channels)}::jsonb`,
      })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
  });
  redirect("/onboarding?step=3");
}

export async function saveSenderStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const values = formValues(formData);
  const parsed = senderStepSchema.safeParse({
    senderAddress: {
      company: values["senderAddress.company"],
      street: values["senderAddress.street"],
      postalCode: values["senderAddress.postalCode"],
      city: values["senderAddress.city"],
      country: "DE",
    },
    customDomain: values.customDomain,
  });
  if (!parsed.success) return { values, errors: fieldErrors(parsed.error) };

  const { customDomain, senderAddress } = parsed.data;
  const platformDomain = serverEnv().PLATFORM_DOMAIN;
  if (
    customDomain &&
    (customDomain === platformDomain || customDomain.endsWith(`.${platformDomain}`))
  ) {
    return { values, errors: { customDomain: "Plattform-Adressen werden automatisch vergeben." } };
  }

  const outcome = await asOnboardingTenant("settings.update", async (tx, workspaceId) => {
    await tx
      .update(workspaceSettings)
      .set({ senderAddress })
      .where(eq(workspaceSettings.workspaceId, workspaceId));
    // Drop earlier, never-activated choices from this wizard.
    await tx
      .delete(domains)
      .where(
        and(
          eq(domains.workspaceId, workspaceId),
          eq(domains.status, "pending"),
          customDomain ? ne(domains.hostname, customDomain) : undefined,
        ),
      );
    if (!customDomain) return "ok" as const;
    // Registered as pending; TLS provisioning via the DomainPort follows with exposé hosting.
    await tx
      .insert(domains)
      .values({ workspaceId, hostname: customDomain })
      .onConflictDoNothing({ target: domains.hostname });
    // RLS hides other workspaces' rows: if the hostname belongs to someone else we see nothing.
    const [own] = await tx
      .select({ id: domains.id })
      .from(domains)
      .where(eq(domains.hostname, customDomain));
    return own ? ("ok" as const) : ("domain_taken" as const);
  });
  if (outcome === "domain_taken") {
    return {
      values,
      errors: { customDomain: "Diese Domain ist bereits einem anderen Workspace zugeordnet." },
    };
  }
  redirect("/onboarding?step=4");
}

export async function completeOnboarding(): Promise<void> {
  await asOnboardingTenant("workspace.update", async (tx, workspaceId, userId) => {
    await tx
      .update(workspaces)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
    await tx.insert(auditLog).values({
      workspaceId,
      actorUserId: userId,
      action: "workspace.onboarding_completed",
      targetType: "workspace",
      targetId: workspaceId,
    });
  });
  redirect("/");
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as { code?: string })?.code === "23505" || cause?.code === "23505";
}
