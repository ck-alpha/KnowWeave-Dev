"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import styles from "./sidebar-layout-wrapper.module.css";

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
  const [mobile, setMobile] = useState(false);
  const [motion, setMotion] = useState("instant");
  const sidebarId = useId();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Auto-close on route change so picking a page/chat from the drawer
  // immediately reveals it on mobile (the user expects the drawer to
  // get out of the way).
  useEffect(() => {
    setMotion("instant");
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    let lastFocused = document.activeElement;
    let focusFrame: number | undefined;
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== document.body) {
        lastFocused = event.target;
      }
    };
    const sync = () => {
      // A breakpoint can hide the focused control before this callback runs.
      const active =
        document.activeElement === document.body ? lastFocused : document.activeElement;
      const focusTrigger = media.matches && sidebarRef.current?.contains(active);
      const focusSidebar = !media.matches && active === triggerRef.current;
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
      setMobile(media.matches);
      setMotion("instant");
      setOpen(false);
      if (focusTrigger || focusSidebar) {
        focusFrame = window.requestAnimationFrame(() => {
          if (focusTrigger) {
            triggerRef.current?.focus({ preventScroll: true });
          } else {
            const first = Array.from(
              sidebarRef.current?.querySelectorAll<HTMLElement>(
                'input:not(:disabled), button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
              ) ?? [],
            ).find((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
            (first ?? sidebarRef.current)?.focus({ preventScroll: true });
          }
        });
      }
    };
    window.addEventListener("focusin", rememberFocus);
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("focusin", rememberFocus);
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  // React 18 does not serialize the native boolean inert attribute reliably.
  useEffect(() => {
    if (sidebarRef.current) sidebarRef.current.inert = mobile && !open;
    if (contentRef.current) contentRef.current.inert = mobile && open;
  }, [mobile, open]);

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
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMotion("instant");
        setOpen(false);
        requestAnimationFrame(() => triggerElement?.focus({ preventScroll: true }));
      } else if (event.key === "Tab") {
        const controls = Array.from(
          sidebarElement?.querySelectorAll<HTMLElement>(
            'input:not(:disabled), button:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ) ?? [],
        ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          sidebarElement?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || !sidebarElement?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !sidebarElement?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    function onOutsideFocus(event: FocusEvent) {
      if (event.target instanceof Node && !sidebarElement?.contains(event.target)) {
        setMotion("instant");
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("focusin", onOutsideFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focusin", onOutsideFocus);
      // A route change may close the drawer while its selected link has focus.
      // Do not move focus to a hidden mobile trigger after a desktop resize.
      if (!desktop.matches && sidebarElement?.contains(document.activeElement)) {
        requestAnimationFrame(() => {
          if (
            document.activeElement === document.body ||
            sidebarElement?.contains(document.activeElement)
          ) {
            triggerElement?.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [open]);

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Mobile backdrop. Captures taps to dismiss the drawer. Desktop
          ignores this entirely since the drawer doesn't overlay there. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden={!open}
        data-open={open}
        data-motion={motion}
        onClick={(event) => {
          setMotion(event.detail ? "pointer" : "instant");
          setOpen(false);
          requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
        }}
        aria-label="关闭侧栏"
        className={styles.backdrop}
      />

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
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-label={triggerLabel}
        tabIndex={-1}
        data-open={open}
        data-motion={motion}
        className={styles.drawer}
      >
        {sidebar}
      </div>

      {/* Content area. min-w-0 so flex children with long text don't
          break the layout. Owns its own scroll.
          The sticky mobile chrome bar sits inside the scroll container
          so position: sticky pins it to the top of the visible area
          — gives mobile users a constant trigger affordance without
          fighting whatever page header is below it. */}
      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur sm:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={(event) => {
              setMotion(event.detail ? "pointer" : "instant");
              setOpen(true);
            }}
            aria-label={triggerLabel}
            aria-expanded={open}
            aria-controls={sidebarId}
            className={cn(
              "ui-pressable ui-button-outline inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1 text-sm",
            )}
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
