import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { installableAppMetadata } from "@/app/installable-app";
import { CommandPaletteProvider, SearchButton } from "@/components/cockpit/command-palette";
import { LiveProvider } from "@/components/cockpit/live";
import { CockpitNav } from "@/components/cockpit/nav";
import { NotificationBell } from "@/components/cockpit/notification-bell";
import { NotificationNavigator } from "@/components/cockpit/notification-navigator";
import { SignOutButton } from "@/components/cockpit/sign-out-button";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { parseTheme, THEME_COOKIE } from "@/components/theme/theme";
import { chatInboxCount } from "@/server/chat/owner";
import { unreadNotificationCount } from "@/server/notifications/manage";
import { liveSubscription, workspaceTopic } from "@/server/realtime";
import { requireCockpit } from "@/server/session";

export const metadata: Metadata = installableAppMetadata;

/**
 * Edge-to-edge on phones, so the env(safe-area-inset-*) values below are real:
 * without it iOS reports 0 and the bottom bar runs into the rounded corners
 * and the home indicator.
 */
export const viewport: Viewport = { viewportFit: "cover" };

export default async function CockpitLayout({ children }: { children: ReactNode }) {
  const { user, workspace, tenant } = await requireCockpit();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const [unread, notifications, live] = await Promise.all([
    tenant((tx) => chatInboxCount(tx, workspace.id)),
    tenant((tx) => unreadNotificationCount(tx, workspace.id)),
    liveSubscription(workspaceTopic(workspace.id)),
  ]);

  return (
    <LiveProvider subscription={live}>
      <CommandPaletteProvider>
        <NotificationNavigator />
        <div className="min-h-dvh pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:grid lg:grid-cols-[16rem_1fr]">
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Zum Inhalt springen
          </a>

          <aside className="hidden border-r border-border bg-surface-sunken/60 lg:flex lg:flex-col">
            <div className="flex h-16 items-center justify-between pr-2 pl-5">
              <Logo />
              <NotificationBell initial={notifications} />
            </div>
            <div className="grid gap-2 px-3 pb-3">
              <p
                className="truncate rounded-md px-2 py-1.5 text-sm font-medium"
                title={workspace.name}
              >
                {workspace.name}
              </p>
              <SearchButton variant="sidebar" />
            </div>
            <CockpitNav orientation="vertical" unread={unread} />
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

          <div className="flex min-h-dvh flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
            <header className="sticky top-0 z-30 box-content flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
              <Logo compact />
              <p className="truncate text-sm font-medium">{workspace.name}</p>
              <div className="flex items-center">
                <SearchButton variant="icon" />
                <NotificationBell initial={notifications} />
                <ThemeToggle initial={theme} />
              </div>
            </header>
            <main
              id="main"
              tabIndex={-1}
              className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-10"
            >
              {children}
            </main>
          </div>

          {/* Inset from the rounded display corners: the outer items keep clear of
            the curve, and the home indicator gets its strip below the bar. */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.25rem,calc(env(safe-area-inset-bottom)-0.5rem))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur lg:hidden">
            <CockpitNav orientation="horizontal" unread={unread} />
          </div>
        </div>
      </CommandPaletteProvider>
    </LiveProvider>
  );
}
