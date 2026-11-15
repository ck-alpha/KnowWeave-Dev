"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SLOTS = ["ingest", "query", "chat", "lint", "vision"] as const;
type Slot = (typeof SLOTS)[number];

// ─── Provider types ────────────────────────────────────────────────────────────
type Provider = "openrouter" | "ollama";

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "ollama", label: "Ollama · 本地" },
  { value: "openrouter", label: "OpenRouter · 可选" },
];

// ─── OpenRouter model catalogue ────────────────────────────────────────────────
type ModelChoice = {
  id: string;
  label: string;
  notes: string;
  vision: boolean;
};

const SUGGESTED: ReadonlyArray<ModelChoice> = [
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    notes: "外部服务",
    vision: true,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    notes: "外部服务",
    vision: true,
  },
  {
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
    notes: "外部服务",
    vision: true,
  },
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o mini",
    notes: "外部服务",
    vision: true,
  },
  { id: "openai/gpt-4o", label: "GPT-4o", notes: "外部服务", vision: true },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    notes: "外部服务",
    vision: true,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    notes: "外部服务",
    vision: true,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B",
    notes: "外部服务",
    vision: false,
  },
];

// ─── Ollama local model suggestions ───────────────────────────────────────────
type OllamaChoice = { id: string; label: string; notes: string; vision: boolean };

const OLLAMA_SUGGESTED: ReadonlyArray<OllamaChoice> = [
  {
    id: "qwen3.8:27b",
    label: "Qwen 3.8 (27B)",
    notes: "请用 ollama list 核对",
    vision: false,
  },
];

const CUSTOM_SENTINEL = "__custom__";

const SLOT_HINT: Record<Slot, string> = {
  ingest: "将原始资料整理为 Wiki 页面，并校验变更格式。",
  query: "检索 Wiki 页面，生成附带引用的回答。",
  chat: "用于多轮对话，作为新建会话的默认模型。",
  lint: "检查 Wiki 内容中的语义问题。",
  vision:
    "PNG / JPG / WebP 图片需要支持图像输入的模型。PDF 文字层使用 ingest；扫描 PDF 请先 OCR 或逐页导出图片。",
};

// ─── State shape ───────────────────────────────────────────────────────────────
// Mirrors the server's ModelSlotConfig: each slot stores both provider + model.
type SlotConfig = { provider: Provider; model: string };
type Models = Record<Slot, SlotConfig>;

// Shared <select> className to keep all dropdowns visually identical.
const SELECT_CLS = cn(
  "h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

export function ModelsTab() {
  const [models, setModels] = useState<Models | null>(null);
  const [original, setOriginal] = useState<Models | null>(null);

  // Per-slot: is this slot's value currently a custom slug (not in the relevant list)?
  const [customMode, setCustomMode] = useState<Record<Slot, boolean>>({
    ingest: false,
    query: false,
    chat: false,
    lint: false,
    vision: false,
  });

  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { settings: { defaultModels: Models } };
        const dm = data.settings.defaultModels;
        setModels(dm);
        setOriginal(dm);

        const knownOR = new Set(SUGGESTED.map((s) => s.id));
        const knownOL = new Set(OLLAMA_SUGGESTED.map((s) => s.id));
        const derivedCustom = {} as Record<Slot, boolean>;
        for (const slot of SLOTS) {
          const { provider, model } = dm[slot];
          derivedCustom[slot] = provider === "ollama" ? !knownOL.has(model) : !knownOR.has(model);
        }
        setCustomMode(derivedCustom);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  function updateSlot(slot: Slot, patch: Partial<SlotConfig>) {
    setModels((prev) => (prev ? { ...prev, [slot]: { ...prev[slot], ...patch } } : prev));
  }

  function onProviderChange(slot: Slot, value: Provider) {
    setCustomMode((m) => ({ ...m, [slot]: false }));
    // Reset model to a sensible default for the new provider
    const defaultModel =
      value === "ollama"
        ? (OLLAMA_SUGGESTED.find((m) => (slot === "vision" ? m.vision : true))?.id ?? "qwen3.8:27b")
        : (SUGGESTED.find((s) => (slot === "vision" ? s.vision : true))?.id ??
          SUGGESTED[0]?.id ??
          "openai/gpt-4o-mini");
    updateSlot(slot, { provider: value, model: defaultModel });
  }

  function onModelSelectChange(slot: Slot, value: string) {
    if (value === CUSTOM_SENTINEL) {
      setCustomMode((m) => ({ ...m, [slot]: true }));
      updateSlot(slot, { model: "" });
      return;
    }
    setCustomMode((m) => ({ ...m, [slot]: false }));
    updateSlot(slot, { model: value });
  }

  async function onSave() {
    if (!models) return;
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultModels: models }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOriginal(models);
      setFlash("已保存，之后的操作将使用这些模型。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dirty = useMemo(
    () =>
      !!models &&
      !!original &&
      SLOTS.some((s) => {
        return models[s].provider !== original[s].provider || models[s].model !== original[s].model;
      }),
    [models, original],
  );

  // Show the Ollama setup banner if ANY slot is currently configured to use
  // Ollama (saved state, not draft). Without local Ollama running, those slot
  // operations all fail with a generic "Connection error" — the banner makes
  // the requirement obvious before the user finds out the painful way.
  const ollamaSlots = useMemo(
    () => (original ? SLOTS.filter((s) => original[s].provider === "ollama") : []),
    [original],
  );

  // Free-tier banner trigger: any saved slot whose model slug is an
  // OpenRouter `:free` route. Distinct concern from Ollama (rate limits +
  // data-retention vs. local-install), distinct banner. Reads the *saved*
  // shape, not the draft, so editing doesn't make the banner flicker.
  const freeSlots = useMemo(
    () =>
      original
        ? SLOTS.filter(
            (s) => original[s].provider === "openrouter" && original[s].model.endsWith(":free"),
          )
        : [],
    [original],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Models · 按用途选择模型</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          本地运行请选择 Ollama，并填写 <code>ollama list</code> 中的完整模型名称。 默认文本模型为{" "}
          <code>qwen3.8:27b</code>，也可按需配置 OpenRouter。
        </p>
      </div>

      {/* Free-tier banner — visible when one or more slots use an
          OpenRouter `:free` model. Surfaces the rate-limit + data-retention
          tradeoffs the user implicitly opted into. Same amber palette as
          the Ollama banner since both are "you made a non-default choice
          with operational caveats". */}
      {freeSlots.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            正在使用免费模型： {freeSlots.join(", ")}{" "}
            {freeSlots.length === 1 ? "（1 个用途）" : `（${freeSlots.length} 个用途）`}
          </p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
            这些操作使用外部服务，可用性、频率限制与数据处理方式由服务商设置决定。选择 Ollama
            可在本地运行。
          </p>
        </div>
      ) : null}

      {/* Ollama setup banner — visible when one or more slots already use
          Ollama. Static link to /local-models with install + hardware guidance.
          Not gated on Ollama actually being reachable (would need a server-
          side ping every render); just a "did you set this up?" reminder. */}
      {ollamaSlots.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            已为以下用途选择 Ollama：{" "}
            {ollamaSlots.length === 1 ? "1 项" : `${ollamaSlots.length} 项`}
            {ollamaSlots.length > 0 ? ` (${ollamaSlots.join(", ")})` : ""}
          </p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
            请确保应用所在服务器上的 Ollama
            已启动，并且对应模型已经安装。遇到连接错误时，可按配置指南检查服务地址和模型名称。
          </p>
          <Link
            href="/local-models"
            className="mt-2 inline-block text-amber-900 underline underline-offset-2 hover:text-amber-700 dark:text-amber-200 dark:hover:text-amber-100"
          >
            查看 Ollama 配置指南 →
          </Link>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {!models ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : (
        <div className="space-y-5">
          {SLOTS.map((slot) => {
            const provider = models[slot].provider;
            const visionOnly = slot === "vision";
            const isOllama = provider === "ollama";

            // Pick which suggestion list to show
            const visibleOptions = isOllama
              ? visionOnly
                ? OLLAMA_SUGGESTED.filter((s) => s.vision)
                : OLLAMA_SUGGESTED
              : visionOnly
                ? SUGGESTED.filter((s) => s.vision)
                : SUGGESTED;

            const knownIds = new Set(visibleOptions.map((o) => o.id));
            const isCustom = customMode[slot] || !knownIds.has(models[slot].model);

            return (
              <div key={slot}>
                <label
                  className="mb-1.5 block text-sm font-medium capitalize"
                  htmlFor={`m-${slot}`}
                >
                  {slot}
                </label>

                <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                  {/* ── Provider picker ─────────────────────────────────── */}
                  <select
                    id={`p-${slot}`}
                    aria-label={`${slot} 服务提供方`}
                    value={provider}
                    onChange={(e) => onProviderChange(slot, e.target.value as Provider)}
                    className={cn(SELECT_CLS, "min-w-[10rem]")}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  {/* ── Model picker ────────────────────────────────────── */}
                  <select
                    id={`m-${slot}`}
                    value={isCustom ? CUSTOM_SENTINEL : models[slot].model}
                    onChange={(e) => onModelSelectChange(slot, e.target.value)}
                    className={cn(SELECT_CLS, "lg:max-w-[22rem]")}
                  >
                    {visibleOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label} — {o.notes}
                      </option>
                    ))}
                    <option value={CUSTOM_SENTINEL}>
                      {isOllama ? "自定义（在下方输入模型名称）" : "自定义（在下方输入模型 ID）"}
                    </option>
                  </select>

                  {/* ── Custom model input ──────────────────────────────── */}
                  {isCustom ? (
                    <Input
                      value={models[slot].model}
                      onChange={(e) => updateSlot(slot, { model: e.target.value })}
                      placeholder={isOllama ? "例如：qwen3.8:27b" : "provider/model-id"}
                      className="font-mono text-sm sm:flex-1"
                    />
                  ) : (
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {models[slot].model}
                    </span>
                  )}
                </div>

                {/* Ollama hint */}
                {isOllama && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    保存前请确认{" "}
                    <code className="font-mono">ollama run {models[slot].model || "<model>"}</code>{" "}
                    可以在服务器上正常运行。
                  </p>
                )}

                <p className="mt-1 text-xs text-muted-foreground">{SLOT_HINT[slot]}</p>
              </div>
            );
          })}

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={onSave} disabled={!dirty || busy}>
              {busy ? "保存中…" : dirty ? "保存模型设置" : "已保存"}
            </Button>
            {flash ? <span className="text-sm text-muted-foreground">{flash}</span> : null}
          </div>
        </div>
      )}

      <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">模型名称需要与实际可用版本一致。</strong>
        如果提示模型不可用，请更新对应用途的配置。Ollama 可用模型以
        <code className="font-mono"> ollama list</code> 的输出为准。
      </div>
    </div>
  );
}
