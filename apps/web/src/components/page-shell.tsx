// Shared layout primitives for the non-sidebar pages. Keeps the typography
// rhythm consistent across Sources / Query / Lint / Settings / Schema / wiki
// detail pages.

import { cn } from "@/lib/utils";

export function PageContainer({
  children,
  className,
  width = "md",
}: {
  children: React.ReactNode;
  className?: string;
  width?: "sm" | "md" | "lg" | "wide" | "xl";
}) {
  const widthClass =
    width === "sm"
      ? "max-w-2xl"
      : width === "md"
        ? "max-w-3xl"
        : width === "lg"
          ? "max-w-4xl"
          : width === "wide"
            ? "max-w-6xl"
            : "max-w-[1400px]"; // xl — for split-pane editors
  return (
    <div className={cn("mx-auto w-full px-4 pb-12 pt-7 sm:px-6 sm:pt-9", widthClass, className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-tight sm:text-h1">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-ui text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}

export function Card({
  children,
  className,
  padding = "md",
}: {
  children: React.ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg";
}) {
  const pad = padding === "sm" ? "p-4" : padding === "md" ? "p-5" : "p-6";
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card text-card-foreground shadow-[0_2px_8px_-6px_hsl(var(--foreground)/0.12)]",
        pad,
        className,
      )}
    >
      {children}
    </div>
  );
}
