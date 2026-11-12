import { ChatsSidebar } from "@/components/chats/sidebar";
import { SidebarLayoutWrapper } from "@/components/sidebar-layout-wrapper";
import { requireSetup } from "@/lib/server-wiki";

// Setup reads the active wiki from disk at request time. Static prerendering
// would cache the build machine's setup redirect for every later visitor.
export const dynamic = "force-dynamic";

// Sidebar (left) + content (right) split. See wiki/layout.tsx — same shape,
// same off-canvas drawer on mobile, same requireSetup() gate.
export default async function ChatsLayout({ children }: { children: React.ReactNode }) {
  await requireSetup("chat");
  return (
    <SidebarLayoutWrapper sidebar={<ChatsSidebar />} triggerLabel="打开会话列表">
      {children}
    </SidebarLayoutWrapper>
  );
}
