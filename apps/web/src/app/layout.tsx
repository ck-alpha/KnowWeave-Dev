import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "KnowWeave",
  description: "Local-first knowledge base maintained by an LLM agent.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before hydration to avoid a light->dark flash on first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-screen flex-col overflow-hidden">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          <CommandPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
