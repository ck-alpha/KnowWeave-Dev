"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  /** Aria label for the open-sidebar trigger button (e.g. "Open wiki pages"). */
  triggerLabel: string;
};

// Sidebar shell shared between /wiki and /chats.
//
// Desktop (sm+): sidebar sits side-by-side with content, identical to the
// pre-mobile-fix behavior — the inner sidebar component controls its own
// fixed width.
//
// Mobile (< sm): sidebar becomes an off-canvas drawer. A floating "≡"
// trigger lives in the top-left of the content area; tapping it slides
// the drawer in from the left with a backdrop. Tapping the backdrop OR
// navigating to a new route auto-closes the drawer.
//
// Layout files (wiki/layout.tsx, chats/layout.tsx) are async server
// components (they await requireSetup), so they pass the sidebar as a
// children-shaped prop into this client wrapper — server-side render
// for the gate, client-side state for the drawer.
export function SidebarLayoutWrapper({ sidebar, children, triggerLabel }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sidebarId = useId();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Auto-close on route change so picking a page/chat from the drawer
  // immediately reveals it on mobile (the user expects the drawer to
  // get out of the way).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    if (!open || desktop.matches) return;

    const sidebarElement = sidebarRef.current;
    const triggerElement = triggerRef.current;
    const frame = window.requestAnimationFrame(() => {
      sidebarElement
        ?.querySelector<HTMLElement>(
          'input:not(:disabled), button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        )
        ?.focus({ preventScroll: true });
    });
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      triggerElement?.focus({ preventScroll: true });
    }
    function onBreakpointChange(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }

    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onBreakpointChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onBreakpointChange);
      // A route change may close the drawer while its selected link has focus.
      // Do not move focus to a hidden mobile trigger after a desktop resize.
      if (!desktop.matches && sidebarElement?.contains(document.activeElement)) {
        triggerElement?.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Mobile backdrop. Captures taps to dismiss the drawer. Desktop
          ignores this entirely since the drawer doesn't overlay there. */}
      {open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
          }}
          aria-label="关闭侧栏"
          className="absolute inset-0 z-30 bg-black/40 sm:hidden"
        />
      ) : null}

      {/* Sidebar. On desktop: normal flex item, the inner sidebar's
          fixed width takes over. On mobile: absolute positioning,
          slides in/out via translate.
          `flex` on the wrapper is critical — without it, the inner
          aside's `self-stretch` would no-op (self-stretch requires a
          flex parent) and the sidebar would only be as tall as its
          content, leaving a visible white gap below. */}
      <div
        id={sidebarId}
        ref={sidebarRef}
        className={cn(
          "z-40 flex transition-transform duration-200 ease-out",
          // Desktop: in-flow, no transform applied.
          "sm:relative sm:translate-x-0",
          // Mobile: anchored to the wrapper's left edge, full height.
          "absolute inset-y-0 left-0",
          // Visibility also removes a closed drawer from keyboard navigation
          // and the accessibility tree; a transform alone leaves it focusable.
          open
            ? "visible translate-x-0"
            : "invisible -translate-x-full sm:visible sm:translate-x-0",
        )}
      >
        {sidebar}
      </div>

      {/* Content area. min-w-0 so flex children with long text don't
          break the layout. Owns its own scroll.
          The sticky mobile chrome bar sits inside the scroll container
          so position: sticky pins it to the top of the visible area
          — gives mobile users a constant trigger affordance without
          fighting whatever page header is below it. */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur sm:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label={triggerLabel}
            aria-expanded={open}
            aria-controls={sidebarId}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1 text-sm hover:bg-accent"
          >
            <span aria-hidden className="font-mono leading-none">
              ≡
            </span>
            <span>{triggerLabel.replace(/^(Open |打开)/, "")}</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
