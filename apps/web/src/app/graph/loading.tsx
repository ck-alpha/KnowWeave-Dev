// Shared route loading state; Space loads its 3D scene only when selected.

export default function Loading() {
  return (
    <div className="min-h-[65vh] grid place-items-center bg-background">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full border-2 border-border bg-muted/40" />
        <p className="text-caption uppercase tracking-[0.18em] text-muted-foreground">
          正在整理知识关联…
        </p>
      </div>
    </div>
  );
}
