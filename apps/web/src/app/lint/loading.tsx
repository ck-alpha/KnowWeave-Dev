import { ListSkeleton } from "@/components/loading-skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="正在加载知识体检页面">
      <span className="sr-only">正在加载知识体检页面…</span>
      <ListSkeleton />
    </div>
  );
}
