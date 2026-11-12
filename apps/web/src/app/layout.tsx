import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "KnowWeave",
  description:
    "把论文、工作资料与个人思考整理成可追溯的 Wiki。专题阅读、知识连接与有据可循的问答。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Runs before hydration to avoid a light->dark flash on first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          <CommandPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
