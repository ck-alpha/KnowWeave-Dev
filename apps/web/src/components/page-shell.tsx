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
    <header className="mb-7 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="mt-2 font-display text-[34px] font-medium leading-tight tracking-tight sm:text-[40px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {description}
          </p>
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
        "rounded-lg border border-border/80 bg-card text-card-foreground",
        pad,
        className,
      )}
    >
      {children}
    </div>
  );
}
