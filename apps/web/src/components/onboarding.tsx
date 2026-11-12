"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  needsTopic: boolean;
  needsKey: boolean;
  initialTopic: string;
  wikiPath: string;
  /**
   * True only on the very first app open (no onboardingCompletedAt in
   * global config yet). Drives the choice between the full 4-step welcome
   * wizard and the minimal topic+key form returning users see if they
   * spin up a new wiki later that's missing one of those.
   */
  isFirstRun: boolean;
};

type Step = "welcome" | "topic" | "key" | "tour";
const STEP_ORDER: Step[] = ["welcome", "topic", "key", "tour"];

export function Onboarding(props: Props) {
  // First-run users get the full wizard; everyone else gets the same compact
  // form we've always had. Single component so the save plumbing is shared.
  if (props.isFirstRun) {
    return <FirstRunWizard {...props} />;
  }
  return <MinimalOnboarding {...props} />;
}

// ---- the welcome wizard -------------------------------------------------

function FirstRunWizard(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [topic, setTopic] = useState(props.initialTopic);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  async function persist(topicToSave: string, keyToSave: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      if (props.needsTopic && topicToSave.trim()) {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic: topicToSave.trim() }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `主题保存失败（HTTP ${res.status}）`);
        }
      }
      if (props.needsKey && keyToSave.trim()) {
        const res = await fetch("/api/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: keyToSave.trim() }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `密钥保存失败（HTTP ${res.status}）`);
        }
      }
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function markOnboardingDone(): Promise<void> {
    try {
      await fetch("/api/onboarding", { method: "POST" });
    } catch {
      // Non-fatal — the user just sees the wizard again on next visit,
      // which is annoying but not broken. Don't gate the redirect on it.
    }
  }

  // Skip from any step: save whatever's been entered, mark onboarding done,
  // and fall back to the minimal form (which only shows if topic/key still
  // missing — otherwise the dashboard appears).
  async function onSkip() {
    await persist(topic, key);
    await markOnboardingDone();
    router.refresh();
  }

  async function onTest() {
    if (!key.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestMessage(null);
    try {
      const res = await fetch("/api/config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: key.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (json.ok) {
        setTestResult("ok");
        setTestMessage("连接成功，OpenRouter 已响应。");
      } else {
        setTestResult("fail");
        setTestMessage(json.error ?? "连接测试失败。");
      }
    } catch (err) {
      setTestResult("fail");
      setTestMessage((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  // Step 3 → Step 4 transition: save before advancing so the user can't
  // back-button into a state where their data was lost.
  async function onAdvanceFromKey() {
    const ok = await persist(topic, key);
    if (ok) goTo("tour");
  }

  // Step 4 final: mark onboarding complete + navigate the user to Sources
  // where they take their first real action (ingesting a source).
  async function onFinish(destination: "sources" | "home" = "sources") {
    await markOnboardingDone();
    if (destination === "sources") router.push("/sources");
    else router.refresh();
  }

  const currentIdx = STEP_ORDER.indexOf(step);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-16 pt-12">
      {/* Stepper — visible only after the welcome screen to keep step 1
          uncluttered. Calm dots, no labels (would crowd the layout). */}
      {step !== "welcome" ? (
        <ol className="mb-8 flex items-center justify-center gap-2" aria-label="设置进度">
          {STEP_ORDER.slice(1).map((s, i) => {
            const idx = i + 1;
            const active = currentIdx === idx;
            const done = currentIdx > idx;
            return (
              <li
                key={s}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "h-1.5 w-10 rounded-full transition-colors",
                  done ? "bg-primary" : active ? "bg-primary/70" : "bg-border",
                )}
              />
            );
          })}
        </ol>
      ) : null}

      {step === "welcome" ? (
        <WelcomeStep
          wikiPath={props.wikiPath}
          onNext={() => goTo("topic")}
          onSkip={onSkip}
          busy={busy}
        />
      ) : null}

      {step === "topic" ? (
        <TopicStep
          topic={topic}
          setTopic={setTopic}
          onBack={() => goTo("welcome")}
          onNext={() => goTo("key")}
          onSkip={onSkip}
          busy={busy}
        />
      ) : null}

      {step === "key" ? (
        <KeyStep
          apiKey={key}
          setApiKey={setKey}
          // The local default and configured providers need no additional key.
          alreadyHasKey={!props.needsKey}
          onBack={() => goTo("topic")}
          onNext={onAdvanceFromKey}
          onSkip={onSkip}
          onTest={onTest}
          testing={testing}
          testResult={testResult}
          testMessage={testMessage}
          busy={busy}
          error={error}
        />
      ) : null}

      {step === "tour" ? (
        <TourStep
          onBack={() => goTo("key")}
          onSkip={() => void onFinish("home")}
          onFinish={() => void onFinish("sources")}
          busy={busy}
        />
      ) : null}
    </div>
  );
}

// ---- step components ----------------------------------------------------

function WelcomeStep({
  wikiPath,
  onNext,
  onSkip,
  busy,
}: {
  wikiPath: string;
  onNext: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  return (
    <div className="text-center">
      <p aria-hidden className="font-mono text-3xl leading-none text-primary">
        [[
      </p>
      <h1 className="mt-4 font-display text-display font-semibold tracking-tight">KnowWeave</h1>
      <p className="mx-auto mt-4 max-w-lg text-body font-serif text-muted-foreground">
        把零散资料变成彼此关联的知识。通过本地 Ollama 与 Qwen 整理
        Wiki，再带着问题检索，并沿引用返回原文。
      </p>
      <p className="mx-auto mt-2 max-w-lg text-caption text-muted-foreground">
        资料以 Markdown 文件保存在本地：<code className="break-all font-mono">{wikiPath}</code>。
      </p>
      <div className="mt-8 flex items-center justify-center gap-4">
        <Button onClick={onNext} disabled={busy}>
          开始设置 →
        </Button>
      </div>
      <button
        type="button"
        onClick={onSkip}
        disabled={busy}
        className="mt-4 text-caption text-muted-foreground hover:text-foreground"
      >
        跳过引导
      </button>
    </div>
  );
}

function TopicStep({
  topic,
  setTopic,
  onBack,
  onNext,
  onSkip,
  busy,
}: {
  topic: string;
  setTopic: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const ready = topic.trim().length > 0;
  return (
    <div>
      <p className="text-caption uppercase tracking-wider text-muted-foreground">Step 1 of 3</p>
      <h2 className="mt-2 font-display text-h1 font-semibold tracking-tight">
        这个 Wiki 关注什么？
      </h2>
      <p className="mt-3 text-body font-serif text-muted-foreground">
        用一句话说明知识库的主题与范围。模型会在整理、问答和检查时参考它，描述越具体越有帮助。
      </p>
      <Input
        autoFocus
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ready) onNext();
        }}
        placeholder="例如：量子计算研究及其核心算法"
        className="mt-5 text-base"
      />
      <p className="mt-2 text-caption text-muted-foreground">
        之后可以在 Settings → General 中修改。
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          ← 上一步
        </Button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-caption text-muted-foreground hover:text-foreground"
          >
            跳过引导
          </button>
          <Button onClick={onNext} disabled={!ready || busy}>
            下一步 →
          </Button>
        </div>
      </div>
    </div>
  );
}

function KeyStep({
  apiKey,
  setApiKey,
  alreadyHasKey,
  onBack,
  onNext,
  onSkip,
  onTest,
  testing,
  testResult,
  testMessage,
  busy,
  error,
}: {
  apiKey: string;
  setApiKey: (v: string) => void;
  alreadyHasKey: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onTest: () => void;
  testing: boolean;
  testResult: "ok" | "fail" | null;
  testMessage: string | null;
  busy: boolean;
  error: string | null;
}) {
  if (alreadyHasKey) {
    return (
      <div>
        <p className="text-caption uppercase tracking-wider text-muted-foreground">Step 2 of 3</p>
        <h2 className="mt-2 font-display text-h1 font-semibold tracking-tight">Model connection</h2>
        <p className="mt-3 text-body font-serif text-muted-foreground">
          默认使用本地 Ollama 与 <code>qwen3.8:27b</code>。请确保 Ollama 已启动，且模型名称出现在{" "}
          <code>ollama list</code> 中。本地运行无需 API key，已有模型配置会保留。
        </p>
        <p className="mt-3 text-ui text-muted-foreground">
          前往{" "}
          <Link href="/settings?tab=models" className="text-primary underline underline-offset-2">
            Settings → Models
          </Link>{" "}
          查看配置，或阅读{" "}
          <Link href="/local-models" className="text-primary underline underline-offset-2">
            本地配置指南
          </Link>
          。
        </p>
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            ← 上一步
          </Button>
          <Button onClick={onNext} disabled={busy}>
            {busy ? "保存中…" : "下一步 →"}
          </Button>
        </div>
      </div>
    );
  }
  // This form only appears after an operation requests a missing cloud key.
  const ready = apiKey.trim().length > 0;
  return (
    <div>
      <p className="text-caption uppercase tracking-wider text-muted-foreground">Step 2 of 3</p>
      <h2 className="mt-2 font-display text-h1 font-semibold tracking-tight">OpenRouter API key</h2>
      <p className="mt-3 text-body font-serif text-muted-foreground">
        当前有功能配置为使用 OpenRouter。如需本地运行，请在 Settings → Models 中选择
        Ollama；如需继续使用 OpenRouter，请填写在以下地址获取的密钥：{" "}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          openrouter.ai/keys
        </a>
        。仅使用此云端服务的功能需要密钥。
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Input
          autoFocus
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-or-v1-..."
          className="font-mono text-sm sm:flex-1"
          autoComplete="off"
        />
        {/* Validate the newly entered key before storing it. */}
        <Button variant="outline" onClick={onTest} disabled={!apiKey.trim() || testing || busy}>
          {testing ? "测试中…" : "测试连接"}
        </Button>
      </div>
      {testMessage ? (
        <p
          className={cn(
            "mt-2 text-xs",
            testResult === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive",
          )}
        >
          {testMessage}
        </p>
      ) : null}
      <p className="mt-2 text-caption text-muted-foreground">
        密钥优先保存到系统钥匙串；不可用时存入本地配置目录，仅当前用户可读写。
      </p>

      {error ? (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          ← 上一步
        </Button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-caption text-muted-foreground hover:text-foreground"
          >
            跳过引导
          </button>
          <Button onClick={onNext} disabled={!ready || busy}>
            {busy ? "保存中…" : "下一步 →"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TourStep({
  onBack,
  onSkip,
  onFinish,
  busy,
}: {
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <p className="text-caption uppercase tracking-wider text-muted-foreground">Step 3 of 3</p>
      <h2 className="mt-2 font-display text-h1 font-semibold tracking-tight">Your workflow</h2>
      <p className="mt-3 text-body font-serif text-muted-foreground">
        先添加资料，再阅读整理好的知识，最后提问与核对来源。所有操作都围绕当前 Wiki 展开。
      </p>

      <ul className="mt-6 space-y-3">
        <TourRow
          numeral="①"
          title="Sources"
          body="粘贴文本、导入网址或文件，让模型提取要点并整理页面。"
        />
        <TourRow
          numeral="②"
          title="Wiki"
          body="按类型浏览知识页面，沿反向链接延伸阅读，或回到原始资料核对。"
        />
        <TourRow
          numeral="③"
          title="Graph"
          body="探索页面间的关联，搜索并选择节点，发现相邻知识与阅读路径。"
        />
        <TourRow
          numeral="④"
          title="Query / Chats"
          body="在 Query 中检索并查看引用，或在 Chats 中继续多轮讨论；有价值的回答可以保存到 Wiki。"
        />
        <TourRow
          numeral="⑤"
          title="Lint"
          body="检查矛盾、失效链接与知识缺口，查看问题后再选择修复。"
        />
      </ul>

      <p className="mt-6 text-caption text-muted-foreground">
        更多操作说明见{" "}
        <Link href="/help" className="text-primary underline underline-offset-2">
          /help
        </Link>{" "}
        。
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          ← 上一步
        </Button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-caption text-muted-foreground hover:text-foreground"
          >
            跳过
          </button>
          <Button onClick={onFinish} disabled={busy}>
            {busy ? "…" : "添加第一份资料 →"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TourRow({ numeral, title, body }: { numeral: string; title: string; body: string }) {
  return (
    <li className="flex items-baseline gap-4 rounded-md border border-border/70 bg-card p-4">
      <span aria-hidden className="font-display text-h2 text-primary/80">
        {numeral}
      </span>
      <div>
        <p className="font-display text-h3 font-medium tracking-tight">{title}</p>
        <p className="mt-0.5 text-ui text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

// ---- minimal form (returning users) -------------------------------------

// The original single-card layout. Fires when a wiki has missing topic/key
// AFTER the user has already completed the welcome wizard at some point.
// Common case: they created a new wiki via Settings → Wikis → Create and
// somehow ended up here (shouldn't happen often since the Create form
// collects the topic), or the API key got removed.
function MinimalOnboarding({ needsTopic, needsKey, initialTopic, wikiPath }: Props) {
  const router = useRouter();
  const [topic, setTopic] = useState(initialTopic);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const canSubmit =
    (!needsTopic || topic.trim().length > 0) && (!needsKey || key.trim().length > 0) && !busy;

  async function onTest() {
    if (!key.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestMessage(null);
    try {
      const res = await fetch("/api/config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: key.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (json.ok) {
        setTestResult("ok");
        setTestMessage("连接成功，OpenRouter 已响应。");
      } else {
        setTestResult("fail");
        setTestMessage(json.error ?? "连接测试失败。");
      }
    } catch (err) {
      setTestResult("fail");
      setTestMessage((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      if (needsTopic && topic.trim()) {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic: topic.trim() }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `主题保存失败（HTTP ${res.status}）`);
        }
      }
      if (needsKey && key.trim()) {
        const res = await fetch("/api/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: key.trim() }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `密钥保存失败（HTTP ${res.status}）`);
        }
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-16 pt-16">
      <header className="mb-8">
        <p className="text-caption uppercase tracking-wider text-muted-foreground">Almost there</p>
        <h1 className="mt-2 font-display text-display font-semibold">完成 Wiki 设置</h1>
        <p className="mt-3 text-body text-muted-foreground">
          {needsTopic && needsKey
            ? "请先填写知识库主题，再配置所选模型服务。"
            : needsTopic
              ? "为这个 Wiki 填写一个主题，即可开始使用。"
              : "当前有功能使用 OpenRouter。请填写密钥，或在 Settings → Models 中切换到本地 Ollama。"}{" "}
          Wiki 目录：<code className="break-all font-mono text-sm">{wikiPath}</code>。
        </p>
      </header>

      <div className="space-y-6 rounded-lg border border-border bg-card p-6">
        {needsTopic ? (
          <section>
            <h2 className="font-display text-h3 font-semibold">
              {needsKey ? "1. " : ""}这个 Wiki 关注什么？
            </h2>
            <p className="mt-1 text-ui text-muted-foreground">
              用一句话说明主题。模型会在每次整理与问答时参考它，请尽量具体。
            </p>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：量子计算研究"
              className="mt-3"
              autoFocus
            />
          </section>
        ) : null}

        {needsKey ? (
          <section>
            <h2 className="font-display text-h3 font-semibold">
              {needsTopic ? "2. " : ""}OpenRouter API key
            </h2>
            <p className="mt-1 text-ui text-muted-foreground">
              如需本地运行，请在 Settings → Models 中切换到 Ollama。使用 OpenRouter
              则需在以下地址获取密钥：{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                openrouter.ai/keys
              </a>
              。系统支持时，密钥会保存在钥匙串中。
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="font-mono text-sm sm:flex-1"
                autoComplete="off"
              />
              <Button variant="outline" onClick={onTest} disabled={!key.trim() || testing}>
                {testing ? "测试中…" : "测试连接"}
              </Button>
            </div>
            {testMessage ? (
              <p
                className={cn(
                  "mt-2 text-xs",
                  testResult === "ok"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-destructive",
                )}
              >
                {testMessage}
              </p>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : null}

        <div className="flex items-center justify-end border-t border-border pt-4">
          <Button onClick={onSave} disabled={!canSubmit}>
            {busy ? "保存中…" : "保存并继续"}
          </Button>
        </div>
      </div>
    </div>
  );
}
