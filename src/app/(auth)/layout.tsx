import type { Metadata } from "next";
import type { ReactNode } from "react";
import { installableAppMetadata } from "@/app/installable-app";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = installableAppMetadata;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-30%] mx-auto h-[60vh] max-w-3xl rounded-full bg-accent/15 blur-3xl"
      />
      <main id="main" className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        {children}
      </main>
    </div>
  );
}
