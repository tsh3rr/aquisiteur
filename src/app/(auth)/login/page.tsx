import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/domain/redirect";
import { getSession } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (await getSession()) redirect("/");
  const { next, error } = await searchParams;
  return <LoginForm next={safeNextPath(next)} linkError={error} />;
}
