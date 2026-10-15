import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { CockpitNav } from "@/components/cockpit/nav";
import { SignOutButton } from "@/components/cockpit/sign-out-button";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { parseTheme, THEME_COOKIE } from "@/components/theme/theme";
import { requireCockpit } from "@/server/session";

export default async function CockpitLayout({ children }: { children: ReactNode }) {
  const { user, workspace } = await requireCockpit();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Zum Inhalt springen
      </a>

      <aside className="hidden border-r border-border bg-surface-sunken/60 lg:flex lg:flex-col">
        <div className="flex h-16 items-center px-5">
          <Logo />
        </div>
        <div className="px-3 pb-3">
          <p className="truncate rounded-md px-2 py-1.5 text-sm font-medium" title={workspace.name}>
            {workspace.name}
          </p>
        </div>
        <CockpitNav orientation="vertical" />
        <div className="mt-auto grid gap-3 border-t border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle initial={theme} />
            <SignOutButton />
          </div>
          <p className="truncate text-xs text-foreground-muted" title={user.email}>
            {user.email}
          </p>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:hidden">
          <Logo compact />
          <p className="truncate text-sm font-medium">{workspace.name}</p>
          <ThemeToggle initial={theme} />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <CockpitNav orientation="horizontal" />
      </div>
    </div>
  );
}
