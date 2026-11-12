"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ChatRow = {
  id: string;
  filename: string;
  folder: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  message_count: number;
};

export function ChatsSidebar() {
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [chatsRes, foldersRes] = await Promise.all([
        fetch("/api/chats", { cache: "no-store" }),
        fetch("/api/chats/folders", { cache: "no-store" }),
      ]);
      if (!chatsRes.ok) throw new Error(`会话列表加载失败（HTTP ${chatsRes.status}）`);
      const chatsData = (await chatsRes.json()) as { chats: ChatRow[] };
      const foldersData = foldersRes.ok
        ? ((await foldersRes.json()) as { folders: string[] })
        : { folders: ["inbox"] };
      setChats(chatsData.chats);
      setFolders(foldersData.folders);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  async function onNewChat() {
    setCreating(true);
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder: "inbox" }),
      });
      if (!res.ok) throw new Error(`会话创建失败（HTTP ${res.status}）`);
      const data = (await res.json()) as { chat: ChatRow };
      await refresh();
      router.push(`/chats/${data.chat.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const grouped = useMemo(() => {
    if (!chats) return null;
    const needle = filter.trim().toLowerCase();
    const filtered = needle ? chats.filter((c) => c.title.toLowerCase().includes(needle)) : chats;
    const byFolder = new Map<string, ChatRow[]>();
    for (const f of folders) byFolder.set(f, []);
    for (const c of filtered) {
      const list = byFolder.get(c.folder) ?? [];
      list.push(c);
      byFolder.set(c.folder, list);
    }
    for (const list of byFolder.values()) {
      list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.updated_at < b.updated_at ? 1 : -1;
      });
    }
    return byFolder;
  }, [chats, folders, filter]);

  const activeId = pathname.startsWith("/chats/") ? pathname.slice("/chats/".length) : null;
  const totalChats = chats?.length ?? 0;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col self-stretch border-r border-border bg-secondary">
      <div className="space-y-2 px-4 pb-2 pt-4">
        <Button onClick={onNewChat} disabled={creating} className="h-10 w-full text-ui">
          {creating ? "创建中…" : "+ 新建会话"}
        </Button>
        <Input
          type="search"
          placeholder="搜索会话…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-10 border-border/70 bg-background/60 text-base"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4 text-ui">
        {error ? <p className="px-3 text-caption text-destructive">{error}</p> : null}
        {!chats && !error ? (
          <p className="px-3 text-caption text-muted-foreground">加载中…</p>
        ) : null}

        {chats && totalChats === 0 ? (
          <div className="mx-2 mt-2 rounded-md border border-dashed border-border/70 bg-background/40 px-3 py-3 text-caption text-muted-foreground">
            还没有会话。点击 <span className="text-foreground">+ 新建会话</span>，围绕 Wiki
            内容展开讨论。会话会自动保存在本地。
          </div>
        ) : null}

        {grouped
          ? Array.from(grouped.entries()).map(([folder, items]) => (
              <section key={folder} className="mb-3">
                <h3 className="mt-3 px-3 pb-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                  {folder}
                  {items.length > 0 ? (
                    <span className="ml-1.5 font-normal normal-case text-muted-foreground/70">
                      {items.length}
                    </span>
                  ) : null}
                </h3>
                {items.length === 0 ? (
                  <p className="px-3 text-caption text-muted-foreground/60">暂无会话</p>
                ) : (
                  <ul>
                    {items.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/chats/${c.id}`}
                          className={cn(
                            "mx-2 flex items-center justify-between gap-2 truncate rounded-md px-2 py-1.5",
                            activeId === c.id
                              ? "bg-primary/10 text-foreground"
                              : "text-foreground/70 hover:bg-accent/60",
                          )}
                          title={c.title}
                        >
                          <span className="truncate">
                            {c.pinned ? <span className="mr-1 text-primary">★</span> : null}
                            {c.title}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground/80">
                            {c.message_count}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          : null}
      </nav>
    </aside>
  );
}
