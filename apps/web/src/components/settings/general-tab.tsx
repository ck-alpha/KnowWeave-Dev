"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme, type UiTheme } from "@/components/theme-provider";

type SettingsResponse = {
  settings: {
    topic: string;
    requireApprovalForIngest?: boolean;
  };
  wikiPath: string;
};

export function GeneralTab() {
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);

  const [topic, setTopic] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [wikiPath, setWikiPath] = useState<string>("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SettingsResponse;
        setTopic(data.settings.topic);
        setOriginal(data.settings.topic);
        setWikiPath(data.wikiPath);
        setRequireApproval(Boolean(data.settings.requireApprovalForIngest));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  async function toggleRequireApproval(next: boolean) {
    setApprovalSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requireApprovalForIngest: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRequireApproval(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovalSaving(false);
    }
  }

  async function onSave() {
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOriginal(topic);
      setFlash("已保存。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dirty = topic !== original;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Wiki topic · 知识库主题</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          用一句话说明这个知识库的范围。模型整理资料和回答问题时都会参考它，建议写得具体一些。
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="例如：量子计算研究"
            className="sm:flex-1"
          />
          <Button onClick={onSave} disabled={!dirty || busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          保存位置：
          <code className="break-all">{wikiPath || "<wiki>"}/.llm-wiki/settings.json</code>
        </p>

        <div className="mt-4 rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">每个 Wiki 聚焦一个主题。</strong>
            如需整理不同领域的资料，可在 Settings → Wikis 中创建独立知识库。
            切换知识库时，页面、对话、来源和整理规则会一起切换。若启动配置固定了 Wiki 目录，请按
            Wikis 页提示调整。
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium">Ingest review · 导入审批</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          开启后，先预览模型建议的新页面、更新和矛盾提示，再决定是否应用到
          Wiki。原始资料仍会保存，便于之后重试。
        </p>
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={requireApproval}
            disabled={approvalSaving}
            onChange={(e) => void toggleRequireApproval(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm">
            应用导入结果前需要我确认
            {approvalSaving ? (
              <span className="ml-2 text-xs text-muted-foreground">保存中…</span>
            ) : null}
          </span>
        </label>
      </div>

      <div>
        <h2 className="text-lg font-medium">Theme</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          选择后立即生效，下次打开仍使用这个偏好。
        </p>
        {/* Server can't read localStorage, so render a placeholder until the
            client mounts. Avoids a hydration-mismatch on the active button's
            background color. */}
        {themeMounted ? (
          <div className="mt-3 inline-flex rounded-md border border-border bg-secondary/40 p-1 text-sm">
            {(["light", "dark", "auto"] as UiTheme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={
                  "rounded px-3 py-1 capitalize " +
                  (theme === t
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {{ light: "浅色", dark: "深色", auto: "跟随系统" }[t]}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 inline-block h-9 w-[14rem] rounded-md border border-border bg-secondary/40" />
        )}
      </div>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {flash ? <p className="text-sm text-muted-foreground">{flash}</p> : null}
    </div>
  );
}
