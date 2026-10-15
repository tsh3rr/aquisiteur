import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { parseTheme, THEME_COOKIE } from "@/components/theme/theme";
import "@/styles/globals.css";
import { geistMono, geistSans } from "./fonts";

export const metadata: Metadata = {
  title: { default: "Aquisiteur", template: "%s · Aquisiteur" },
  description: "Neukundengewinnung per persönlichem Brief.",
  robots: { index: false, follow: false },
  applicationName: "Aquisiteur",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfe" },
    { media: "(prefers-color-scheme: dark)", color: "#16161f" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="de"
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
