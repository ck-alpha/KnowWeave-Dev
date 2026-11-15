"use client";

import Link from "next/link";
import {
  FileText,
  Globe2,
  ImageIcon,
  LoaderCircle,
  ScanText,
  Upload,
  Check,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { CostPreview } from "@/components/cost-preview";
import { PageContainer, PageHeader } from "@/components/page-shell";
import { SourcesList } from "@/components/sources/sources-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { IngestSuccess } from "@/lib/ingest-result";
import { useWikiSettings } from "@/lib/use-wiki-settings";
import { cn } from "@/lib/utils";
import styles from "./sources.module.css";

type Mode = "paste" | "file" | "url";

type IngestResult = IngestSuccess | { ok: false; error: string; type?: string } | { error: string };

const ACCEPTED_EXTENSIONS =
  ".md,.markdown,.txt,.html,.htm,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MODES = [
  { value: "paste", label: "粘贴文本", Icon: FileText },
  { value: "file", label: "上传文件", Icon: Upload },
  { value: "url", label: "网页 URL", Icon: Globe2 },
] as const;

export function SourcesView() {
  const [mode, setMode] = useState<Mode>("paste");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [sourceActionBusy, setSourceActionBusy] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const controlsLocked =
    busy || applyBusy || discardBusy || sourceActionBusy || result?.kind === "preview";

  function chooseFile(picked: File | null) {
    if (controlsLocked) return;
    setError(null);
    setResult(null);
    setFile(null);
    if (!picked) return;
    const extension = picked.name.slice(picked.name.lastIndexOf(".")).toLowerCase();
    let problem: string | null = null;
    if (extension === ".doc")
      problem = "旧版 Word .doc 暂不支持，请在 Word 中另存为 .docx 后上传。";
    else if (!ACCEPTED_EXTENSIONS.split(",").includes(extension))
      problem = "请选择支持的文本、PDF、Office 或 PNG / JPG / WebP 图片。";
    else if (picked.size === 0) problem = "这个文件是空的，请选择有内容的资料。";
    else if (picked.size > MAX_FILE_BYTES) problem = "文件超过 20 MiB，请拆分或压缩后再上传。";
    if (problem) {
      setError(problem);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(picked);
  }

  async function onApplyPreview() {
    if (!result || result.kind !== "preview") return;
    setApplyBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: result.sourceId,
          response: result.fullResponse,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      // Flip the local result to applied so the preview UI clears.
      setResult({ ...result, kind: "applied" });
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplyBusy(false);
    }
  }

  async function onDiscardPreview() {
    if (!result || result.kind !== "preview") return;
    if (!confirm(`放弃这份整理建议并移除来源？原始文件将移入回收站，30 天内可恢复。`)) return;
    setDiscardBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sources/${result.sourceId}/delete`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setResult(null);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiscardBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    !applyBusy &&
    !discardBusy &&
    !sourceActionBusy &&
    result?.kind !== "preview" &&
    ((mode === "paste" && text.trim().length > 0) ||
      (mode === "url" && url.trim().length > 0) ||
      (mode === "file" && file !== null));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    setError(null);
    const sourceLabel = mode === "file" ? file?.name : mode === "url" ? url : "pasted text";
    console.log(
      `%c[Ingest Send] Ingesting source: "${sourceLabel}" (${mode})`,
      "color: #3b82f6; font-weight: bold;",
    );
    try {
      let res: Response;
      if (mode === "file" && file) {
        const form = new FormData();
        form.append("file", file);
        if (title.trim()) form.append("title", title.trim());
        res = await fetch("/api/ingest", { method: "POST", body: form });
      } else {
        const body: Record<string, string> = {};
        if (mode === "paste") body["text"] = text;
        if (mode === "url") body["url"] = url.trim();
        if (title.trim()) body["title"] = title.trim();
        res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const json = (await res.json()) as IngestResult & {
        providerUsed?: string;
        modelUsed?: string;
      };
      if (!res.ok || !("ok" in json) || json.ok !== true) {
        const msg = "error" in json ? json.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      console.log(
        `%c[Ingest Success] Selected ${json.providerUsed || "unknown"} to ingest: "${sourceLabel}" -> Status: Success`,
        "color: #10b981; font-weight: bold;",
      );
      console.log(
        `%c[Ingest Success] Model used: ${json.model || json.modelUsed || "unknown"}`,
        "color: #10b981;",
      );
      setResult(json);
      // Don't clear file/url so the user can see what they ingested.
      setText("");
      setTitle("");
    } catch (err) {
      console.error(
        `[Ingest Failed] source: "${sourceLabel}" -> Status: Failed. Error: ${(err as Error).message}`,
      );
      setError((err as Error).message);
    } finally {
      setBusy(false);
      // Failed model calls may still save a raw source for Retry.
      setRefreshNonce((n) => n + 1);
    }
  }

  function onDrop(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (controlsLocked) return;
    if (e.dataTransfer.files.length > 1) {
      setError("每次整理一份资料，请只拖入一个文件。");
      return;
    }
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    setMode("file");
    chooseFile(dropped);
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow="From sources to knowledge"
        title="Sources"
        description="把散落的文章、论文和阅读笔记，整理成彼此连接的知识。支持文本、PDF、Word 和图片，保留原件供你回查。"
      />

      <section className="mb-8 rounded-lg border border-border/70 bg-card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-h3 font-semibold">资料库</h2>
          <p className="text-caption text-muted-foreground">每份资料都保留原件</p>
        </div>
        <SourcesList
          refreshNonce={refreshNonce}
          onPreview={(preview) => {
            setResult(preview);
            setError(null);
          }}
          onBusyChange={setSourceActionBusy}
          disabled={busy || applyBusy || discardBusy || result?.kind === "preview"}
        />
      </section>

      <div className={styles.importLayout}>
        <section
          aria-labelledby="source-import-heading"
          className={cn(
            "rounded-lg border bg-card p-5 text-card-foreground transition-colors",
            dragOver ? "border-primary ring-2 ring-primary/30" : "border-border/70",
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            if (controlsLocked || !e.dataTransfer.types.includes("Files")) return;
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = controlsLocked ? "none" : "copy";
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragOver(false);
          }}
          onDrop={onDrop}
        >
          <h2 id="source-import-heading" className="mb-4 font-display text-h3 font-semibold">
            添加一份资料
          </h2>
          <div className={styles.modes} role="group" aria-label="添加资料的方式">
            {MODES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                disabled={controlsLocked}
                aria-pressed={mode === value}
                className={cn(styles.mode, "ui-pressable")}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <p className="text-xs text-muted-foreground">
              每次导入都会保留一份独立原文。失败时点击上方「重试」，即可复用已保存的资料。整理完成后，前往
              Query 刷新向量索引。
            </p>
            <fieldset disabled={controlsLocked} className="min-w-0 space-y-4">
              <legend className="sr-only">资料内容</legend>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="title">
                  标题（选填）
                </label>
                <Input
                  id="title"
                  type="text"
                  placeholder="留空时，使用文本首行、网页标题或文件名"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={controlsLocked}
                />
              </div>

              {mode === "paste" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="text">
                    资料内容
                  </label>
                  <Textarea
                    id="text"
                    rows={14}
                    placeholder="在这里粘贴文章、论文摘要或阅读笔记…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={controlsLocked}
                    className="min-h-[280px] font-mono text-sm leading-relaxed"
                  />
                </div>
              ) : null}

              {mode === "url" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="url">
                    URL
                  </label>
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={controlsLocked}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    自动提取网页正文，过滤导航和广告后，再整理为知识页面。
                  </p>
                </div>
              ) : null}

              {mode === "file" ? (
                <div>
                  <p className="mb-1 block text-sm font-medium">选择文件</p>
                  <div className={styles.dropzone} data-drag-over={dragOver}>
                    {file ? (
                      <Check className={styles.fileIcon} size={28} aria-hidden="true" />
                    ) : (
                      <Upload className={styles.fileIcon} size={28} aria-hidden="true" />
                    )}
                    <p className={styles.fileName} role="status">
                      {file ? (
                        <>
                          已选择：<strong>{file.name}</strong>{" "}
                          <span className="text-muted-foreground">
                            (
                            {file.size < 1024
                              ? `${file.size} B`
                              : `${(file.size / 1024).toFixed(1)} KiB`}
                            )
                          </span>
                        </>
                      ) : (
                        <>
                          将文件拖到这里，或{" "}
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="text-primary underline underline-offset-2"
                          >
                            点击选择
                          </button>
                          。
                        </>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      每次一个文件，最大 20 MiB。PDF 提取文字层；图片需支持图像的视觉模型。
                    </p>
                    {file ? (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          更换文件
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                        >
                          <X size={16} className="mr-1" aria-hidden="true" />
                          移除
                        </Button>
                      </div>
                    ) : null}
                    <input
                      ref={fileInputRef}
                      type="file"
                      aria-label="选择要整理的文件"
                      accept={ACCEPTED_EXTENSIONS}
                      className="hidden"
                      onChange={(e) => {
                        const picked = e.target.files?.[0] ?? null;
                        if (picked) chooseFile(picked);
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </fieldset>

            <CostPreviewForSources mode={mode} text={text} file={file} url={url} />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!canSubmit} aria-busy={busy} className="gap-2">
                {busy ? (
                  <LoaderCircle size={18} className={styles.spinner} aria-hidden="true" />
                ) : (
                  <ScanText size={18} aria-hidden="true" />
                )}
                {busy ? "正在阅读与整理…" : "导入并整理"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {mode === "file" && file && /\.(png|jpg|jpeg|webp)$/i.test(file.name)
                  ? "图片使用 vision 模型；请在 Settings → Models 中配置支持图像输入的模型。"
                  : "由 Ingest 模型整理。所需时间取决于资料长度和本机性能，请稍候。"}
              </p>
            </div>
            {busy ? (
              <p role="status" className={styles.busyNote}>
                正在提取资料并等待模型整理，请保持页面打开。
              </p>
            ) : null}
          </form>

          {error ? <IngestErrorBanner message={error} /> : null}

          {result ? (
            <div
              className={cn(
                "mt-6 space-y-3 rounded-md px-4 py-3 text-sm [overflow-wrap:anywhere]",
                result.kind === "preview"
                  ? "border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                  : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
              )}
            >
              <div role="status">
                {result.kind === "preview" ? (
                  <>
                    <strong>整理建议已生成，等待确认。</strong>你已开启导入审批（Settings →
                    General），确认后才会写入 Wiki。
                  </>
                ) : (
                  <>
                    <strong>整理完成。</strong> {result.response.summary}
                  </>
                )}
              </div>
              {result.kind === "applied" ? (
                <div className="flex flex-wrap gap-3">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/wiki">阅读 Wiki</Link>
                  </Button>
                  <Link
                    href={`/sources/${result.sourceId}`}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    查看保存的原件
                  </Link>
                </div>
              ) : null}
              {result.kind === "preview" && result.response.summary ? (
                <div className="text-xs">
                  <strong>内容摘要：</strong> {result.response.summary}
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground">
                原文已保存至 <code>raw/{result.rawFilename}</code> · 模型{" "}
                <code>{result.model}</code>。
                {result.kind === "preview" ? " 确认后保留原文，放弃后原文会移入回收站。" : null}
              </div>

              {result.kind === "preview" ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-amber-500/30 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onApplyPreview()}
                    disabled={applyBusy || discardBusy || sourceActionBusy}
                  >
                    {applyBusy ? "写入中…" : "确认并写入 Wiki"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onDiscardPreview()}
                    disabled={applyBusy || discardBusy || sourceActionBusy}
                  >
                    {discardBusy ? "正在放弃…" : "放弃建议"}
                  </Button>
                  <span className="text-xs text-amber-800/70 dark:text-amber-200/70">
                    确认后将创建或更新下方列出的页面。
                  </span>
                </div>
              ) : null}

              {result.response.newPages.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    新建页面
                  </h3>
                  <ul className="mt-1 space-y-0.5">
                    {result.response.newPages.map((p) => (
                      <li key={p.slug}>
                        <Link href={`/wiki/${p.slug}`} className="underline underline-offset-2">
                          {p.slug}
                        </Link>{" "}
                        — {p.title} <span className="text-muted-foreground">({p.type})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.response.pageUpdates.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    更新页面
                  </h3>
                  <ul className="mt-1 space-y-0.5">
                    {result.response.pageUpdates.map((p) => (
                      <li key={p.slug}>
                        <Link href={`/wiki/${p.slug}`} className="underline underline-offset-2">
                          {p.slug}
                        </Link>{" "}
                        — {p.updateReason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.response.contradictions.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    需要核对的矛盾
                  </h3>
                  <ul className="mt-1 space-y-0.5">
                    {result.response.contradictions.map((c, i) => (
                      <li key={i}>
                        {c.description}{" "}
                        <span className="text-muted-foreground">[{c.pages.join(", ")}]</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        <aside className={styles.guide} aria-labelledby="source-format-heading">
          <h2 id="source-format-heading">不同资料，同一份知识库</h2>
          <p>原件保留下来，提取出的内容交给模型整理，最后生成可编辑的 Markdown Wiki。</p>
          <dl className={styles.formats}>
            <div>
              <dt>
                <FileText size={20} aria-hidden="true" />
                文本与 Word
              </dt>
              <dd>
                Markdown、TXT、HTML、DOCX，直接提取正文。也支持 PPTX、XLSX。旧版 .doc 请先另存为
                .docx；Word 内嵌图片需单独上传识别。
              </dd>
            </div>
            <div>
              <dt>
                <ScanText size={20} aria-hidden="true" />
                PDF 文档
              </dt>
              <dd>在本地提取文字层，再由整理模型生成 Wiki。扫描页、图表和公式可能需要补充识别。</dd>
            </div>
            <div>
              <dt>
                <ImageIcon size={20} aria-hidden="true" />
                图片与扫描资料
              </dt>
              <dd>
                PNG、JPG、WebP 交给支持图像的 vision 模型。扫描 PDF 请先 OCR
                转为文本，或逐页导出图片。
              </dd>
            </div>
          </dl>
          <div className={styles.guideNote}>
            <h3>原件与 Wiki 各有用途</h3>
            <p>
              Sources 保存依据，Wiki
              用来阅读、连接和问答。识别结果仍需对照原件核对；当前精确摘录仅支持 TXT / Markdown。
            </p>
            <Link href="/settings?tab=models" className="underline underline-offset-4">
              查看模型设置
            </Link>
          </div>
        </aside>
      </div>

      <p className="mt-6 text-caption text-muted-foreground">
        整理完成后，前往{" "}
        <Link href="/wiki" className="underline underline-offset-2">
          Wiki
        </Link>{" "}
        阅读页面，或在{" "}
        <Link href="/graph" className="underline underline-offset-2">
          Graph
        </Link>{" "}
        探索它们之间的联系。
      </p>
    </PageContainer>
  );
}

// Schema-validation errors come back as a single long string from the LLM
// wrapper. Surface a friendly summary at the top with the raw detail
// collapsed underneath so power users can still see what the model returned.
function IngestErrorBanner({ message }: { message: string }) {
  const isSchemaError = message.includes("schema validation") || message.includes("not valid JSON");
  return (
    <div
      role="alert"
      className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive [overflow-wrap:anywhere]"
    >
      <p className="font-medium">
        {isSchemaError ? "模型返回的数据格式不完整，暂时无法写入 Wiki。" : message}
      </p>
      {isSchemaError ? (
        <p className="mt-1 text-destructive/85">
          在上方资料列表点击<strong>重试</strong>，即可复用已保存的原文。 如果问题持续，请在{" "}
          <a href="/settings" className="underline underline-offset-2 hover:text-destructive/70">
            Settings → Models → ingest
          </a>{" "}
          检查模型配置，并确认本地模型服务正在运行。
        </p>
      ) : null}
      {isSchemaError ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-destructive/70 hover:text-destructive">
            查看错误详情
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-background/50 p-2 font-mono text-xs text-destructive/80">
            {message}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function CostPreviewForSources({
  mode,
  text,
  file,
  url,
}: {
  mode: Mode;
  text: string;
  file: File | null;
  url: string;
}) {
  const settings = useWikiSettings();
  if (!settings) return null;
  if (!settings.settings.showCostEstimates) return null;

  const isVision = mode === "file" && file !== null && /\.(png|jpg|jpeg|webp)$/i.test(file.name);
  const slot = isVision
    ? settings.settings.defaultModels.vision
    : settings.settings.defaultModels.ingest;
  const model = slot.model;

  // File-size estimates are approximate; PDF and Office content is extracted
  // locally, while images use the configured vision model.
  let estimateInput = "";
  if (mode === "paste") estimateInput = text;
  else if (mode === "url") estimateInput = url ? `Article from ${url}, est. 3000 words` : "";
  else if (mode === "file" && file) {
    if (isVision) {
      // Vision: 1 image-ish payload ≈ 1500 tokens for a typical page.
      estimateInput = "x".repeat(Math.min(file.size, 50_000));
    } else {
      // Text file: estimate from size, capped to avoid huge previews.
      estimateInput = "x".repeat(Math.min(file.size, 200_000));
    }
  }

  return <CostPreview text={estimateInput} model={model} contextOverhead={5000} />;
}
