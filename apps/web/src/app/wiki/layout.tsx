import { createHash } from "node:crypto";

import { SidebarLayoutWrapper } from "@/components/sidebar-layout-wrapper";
import { WikiSidebar } from "@/components/wiki/sidebar";
import { requireSetup, resolveWikiPath } from "@/lib/server-wiki";

// Sidebar (left) + content (right) split. On desktop: side-by-side, sidebar's
// fixed width takes over. On mobile: sidebar collapses to an off-canvas drawer
// with a floating ≡ trigger; behavior lives in SidebarLayoutWrapper.
//
// Layout-level requireSetup() gate catches direct-bookmark hits to /wiki and
// /wiki/<slug> when the user hasn't completed the welcome wizard yet. Same
// pattern in chats/layout.tsx.
export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  await requireSetup();
  return (
    <SidebarLayoutWrapper
      sidebar={<WikiSidebar key={createHash("sha256").update(resolveWikiPath()).digest("hex")} />}
      triggerLabel="打开 Wiki 页面列表"
    >
      {children}
    </SidebarLayoutWrapper>
  );
}
