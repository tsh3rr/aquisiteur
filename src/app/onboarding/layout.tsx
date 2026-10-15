import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { requireUser } from "@/server/session";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <div className="relative min-h-dvh overflow-hidden px-4 py-10 sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-20%] left-1/2 h-[50vh] w-[80vw] max-w-4xl -translate-x-1/2 rounded-full bg-accent/12 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-xl gap-10">
        <Logo />
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
