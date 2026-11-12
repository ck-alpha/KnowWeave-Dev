"use client";

import { useEffect, useState } from "react";

import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type UiTheme } from "@/components/theme-provider";

const ORDER: UiTheme[] = ["light", "dark", "auto"];
const LABEL: Record<UiTheme, string> = {
  light: "切换到深色主题",
  dark: "切换为跟随系统",
  auto: "切换到浅色主题",
};

// Cycles light → dark → auto → light. Single click target so it stays out
// of the way; the Settings → General tab has the explicit 3-way picker for
// users who'd rather not cycle.
//
// Hydration note: theme state is read from localStorage on the client, which
// the server can't see. To avoid a server/client SVG-path mismatch, we render
// a sized placeholder until the component mounts client-side, then swap in
// the real icon. The actual `dark` class on <html> is set synchronously by
// THEME_INIT_SCRIPT in <head> so there's no visual flash.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function next() {
    const i = ORDER.indexOf(theme);
    const upcoming = ORDER[(i + 1) % ORDER.length] ?? "auto";
    setTheme(upcoming);
  }

  if (!mounted) {
    return <div className="h-11 w-11 shrink-0" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={next}
      aria-label={LABEL[theme]}
      title={LABEL[theme]}
      className="ui-pressable ui-button-ghost inline-flex h-11 w-11 items-center justify-center shrink-0 rounded-lg text-muted-foreground"
    >
      {theme === "light" ? (
        <Sun className="h-5 w-5" />
      ) : theme === "dark" ? (
        <Moon className="h-5 w-5" />
      ) : (
        <Monitor className="h-5 w-5" />
      )}
    </button>
  );
}
