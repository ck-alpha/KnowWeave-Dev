"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Client-safe mirror of the SCHEMA_TEMPLATES metadata in
// packages/core/src/templates.ts. Importing the value from @llm-wiki/core
// here pulls the whole barrel — including secrets.ts → keytar (a Node-only
// native module) → webpack bundle error. The server-side route at
// /api/wikis (handleCreate) still imports the real SCHEMA_TEMPLATES from
// core to look up the body by id; we just need the id/label/description
// triple on the client for the dropdown. Keep this list in sync if you
// add/rename templates over there.
type SchemaTemplateId = "blank" | "research" | "legal" | "clinical" | "project" | "personal";

type SchemaTemplateMeta = {
  id: SchemaTemplateId;
  label: string;
  description: string;
};

const SCHEMA_TEMPLATES: ReadonlyArray<SchemaTemplateMeta> = [
  {
    id: "blank",
    label: "Blank",
    description: "通用整理规则，可在 Schema 中继续调整。",
  },
  {
    id: "research",
    label: "Research",
    description: "采用学术表达，要求观点有来源依据，保留术语与开放问题。",
  },
  {
    id: "legal",
    label: "Legal",
    description: "要求精确引用、区分判决依据与附带意见，并标注已被推翻的先例。",
  },
  {
    id: "clinical",
    label: "Clinical",
    description: "要求标注证据等级与过时指南，准确保留剂量和单位。",
  },
  {
    id: "project",
    label: "Project",
    description: "围绕项目决策组织知识，标记观点日期并记录失败情形。",
  },
  {
    id: "personal",
    label: "Personal KB",
    description: "采用轻松、探索式表达，保留疑问和来源，方便日后查找。",
  },
];

type WikiDetail = {
  path: string;
  topic: string | null;
  exists: boolean;
};

type ListResponse = {
  active: WikiDetail;
  recents: WikiDetail[];
  fixedPath?: boolean;
};

// Suggests a default folder path from a topic. Matches the convention
// `~/knowwaeve-<slug>` so users have a sensible starting point without
// having to type a full path.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function suggestedPath(topic: string): string {
  const slug = slugify(topic);
  if (!slug) return "~/knowwaeve-untitled";
  return `~/knowwaeve-${slug}`;
}

export function WikisTab() {
  const router = useRouter();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Create form
  const [createOpen, setCreateOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newTemplate, setNewTemplate] = useState<SchemaTemplateId>("blank");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/wikis", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function doAction(label: string, body: object, successFlash: string): Promise<boolean> {
    setBusyAction(label);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/wikis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFlash(successFlash);
      await refresh();
      // Re-render every server component so the new active wiki is read
      // throughout the app, not just by this tab.
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function onSwitch(path: string) {
    await doAction(`switch:${path}`, { type: "switch", path }, `已切换到 ${path}`);
  }

  async function onRemove(path: string, isActive: boolean) {
    const msg = isActive
      ? `从列表中移除此 Wiki，并切回默认 Wiki？磁盘上的目录和文件会保留。`
      : `从列表中移除此 Wiki？磁盘上的目录和文件会保留。`;
    if (!confirm(msg)) return;
    await doAction(`remove:${path}`, { type: "remove", path }, "已从列表中移除");
  }

  async function onCreate() {
    const topic = newTopic.trim();
    const path = newPath.trim() || suggestedPath(topic);
    if (!topic) {
      setError("请填写 Wiki 主题。");
      return;
    }
    const ok = await doAction(
      "create",
      { type: "create", path, topic, templateId: newTemplate },
      `已在 ${path} 创建 Wiki${newTemplate !== "blank" ? `，使用 ${newTemplate} 模板` : ""}`,
    );
    if (ok) {
      setNewTopic("");
      setNewPath("");
      setNewTemplate("blank");
      setCreateOpen(false);
    }
  }

  if (data === null && !error) {
    return <p className="text-sm text-muted-foreground">正在加载 Wiki…</p>;
  }

  if (error && data === null) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Wiki 加载失败： {error}
      </p>
    );
  }

  const active = data?.active;
  const rows = data?.recents ?? [];
  const activeIsInRecents = active ? rows.some((r) => r.path === active.path) : false;

  // Stale entries left over from prior testing or removed-from-disk wikis.
  // Surface a single bulk-cleanup affordance so users don't have to click
  // Remove on each one.
  const missing = rows.filter((r) => !r.exists);

  async function onCleanMissing() {
    if (missing.length === 0) return;
    if (!confirm(`从列表中清理 ${missing.length} 条失效记录？这些记录指向的目录已不存在。`)) return;
    setBusyAction("clean-missing");
    setError(null);
    setFlash(null);
    try {
      // Sequential — small N + we want each remove to see the prior's
      // updated config, since removing the currently-active wiki resets it.
      for (const m of missing) {
        const res = await fetch("/api/wikis", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "remove", path: m.path }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
      }
      setFlash(`已清理 ${missing.length} 条失效记录。`);
      await refresh();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Wikis</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            为不同主题分别建立 Wiki。应用中的资料、页面和会话都来自当前选中的知识库。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <a
            href="/dashboard"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:border-primary/40 hover:bg-accent"
            title="查看各 Wiki 的页面、来源、会话数量与累计模型用量。"
          >
            ↗ 查看 Dashboard
          </a>
          {active?.exists ? (
            <a
              href="/api/wikis/export"
              download
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:border-primary/40 hover:bg-accent"
              title="导出当前 Wiki 的 Markdown、原始资料、会话、规则、索引和日志；不包含 .llm-wiki/ 元数据。"
            >
              ↓ 导出当前 Wiki
            </a>
          ) : null}
        </div>
      </div>

      {data?.fixedPath ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          服务器启动配置已固定当前 Wiki 目录。若要新建或切换 Wiki，需先取消启动时的 Wiki
          路径覆盖配置，再重启服务。
        </p>
      ) : null}

      {flash ? (
        <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {missing.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="text-amber-800 dark:text-amber-200">
            有 {missing.length} 条记录指向的目录已不存在，可以从列表中清理。
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onCleanMissing()}
            disabled={busyAction !== null}
          >
            {busyAction === "clean-missing" ? "清理中…" : `清理 ${missing.length} 条失效记录`}
          </Button>
        </div>
      ) : null}

      {/* If the active wiki isn't in the recents list (typical on first run —
          the default ~/knowwaeve-default), render it as its own row. We now
          use the server-enriched detail so topic + exists are correct. */}
      {active && !activeIsInRecents ? (
        <WikiRow
          path={active.path}
          topic={active.topic}
          exists={active.exists}
          isActive={true}
          busyAction={busyAction}
          onSwitch={() => Promise.resolve()}
          onRemove={() => onRemove(active.path, true)}
        />
      ) : null}

      <ul className="space-y-2">
        {rows.map((row) => (
          <WikiRow
            key={row.path}
            path={row.path}
            topic={row.topic}
            exists={row.exists}
            isActive={active?.path === row.path}
            busyAction={busyAction}
            onSwitch={() => onSwitch(row.path)}
            onRemove={() => onRemove(row.path, active?.path === row.path)}
          />
        ))}
      </ul>

      {/* Create form, collapsed by default. */}
      <div className="rounded-md border border-border/70 bg-muted/20 p-4">
        {!createOpen ? (
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            + 新建 Wiki
          </Button>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">新建 Wiki</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                填写主题和保存目录。模型会在每次操作时参考主题；目录不存在时会自动创建。
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="new-topic">
                主题
              </label>
              <Input
                id="new-topic"
                value={newTopic}
                onChange={(e) => {
                  setNewTopic(e.target.value);
                  if (!newPath) setNewPath(suggestedPath(e.target.value));
                }}
                placeholder="例如：机器学习研究与核心论文"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="new-path">
                保存目录
              </label>
              <Input
                id="new-path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder={newTopic ? suggestedPath(newTopic) : "~/knowwaeve-…"}
                className="font-mono text-[13px]"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                <code className="font-mono">~</code> 表示服务器上当前运行用户的主目录。
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="new-template">
                Schema 模板
              </label>
              <select
                id="new-template"
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value as SchemaTemplateId)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {SCHEMA_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {SCHEMA_TEMPLATES.find((t) => t.id === newTemplate)?.description} 模板会填入{" "}
                <code className="font-mono">CLAUDE.md</code>，之后可在 Schema 中编辑。
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={onCreate} disabled={!newTopic.trim() || busyAction === "create"}>
                {busyAction === "create" ? "创建中…" : "创建并切换"}
              </Button>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        切换后，各页面会重新读取新 Wiki 的内容。如仍显示旧内容，请刷新浏览器。
      </p>
    </div>
  );
}

function WikiRow({
  path,
  topic,
  exists,
  isActive,
  busyAction,
  onSwitch,
  onRemove,
}: {
  path: string;
  topic: string | null;
  exists: boolean;
  isActive: boolean;
  busyAction: string | null;
  onSwitch: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const switching = busyAction === `switch:${path}`;
  const removing = busyAction === `remove:${path}`;
  return (
    <li
      className={
        "flex flex-wrap items-baseline justify-between gap-3 rounded-md border p-3 " +
        (isActive ? "border-primary/40 bg-primary/[0.04]" : "border-border/70 bg-card")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-sm font-medium">
            {topic ?? <span className="text-muted-foreground italic">尚未设置主题</span>}
          </p>
          {isActive ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
              当前
            </span>
          ) : null}
          {!exists ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
              目录缺失
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{path}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {!isActive && exists ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onSwitch()}
            disabled={busyAction !== null}
          >
            {switching ? "切换中…" : "切换"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onRemove()}
          disabled={busyAction !== null}
        >
          {removing ? "移除中…" : "从列表移除"}
        </Button>
      </div>
    </li>
  );
}
