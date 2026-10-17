"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function AboutTab() {
  const router = useRouter();
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);

  async function replayTour() {
    if (!confirm("Replay the first-run welcome wizard? Your topic and API key stay set.")) return;
    setReplayBusy(true);
    setReplayError(null);
    try {
      const res = await fetch("/api/onboarding", { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // /, triggers the wizard since onboardingCompletedAt is now absent.
      router.push("/");
      router.refresh();
    } catch (err) {
      setReplayError((err as Error).message);
      setReplayBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="text-lg font-medium">KnowWaeve</h2>
        <p className="mt-1 text-muted-foreground">
          Local-first knowledge management with document ingestion, linked Markdown wiki pages, and
          questions with inspectable sources.
        </p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Models and storage
        </h3>
        <p className="mt-1 text-muted-foreground">
          Ollama is the default local provider; local inference needs no cloud API key. Wiki content
          lives in your selected folder. If you choose an external provider, the selected operations
          send content to that provider.
        </p>
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          License and source
        </h3>
        <p className="mt-1 text-muted-foreground">
          MIT-licensed derivative of LLM Wiki. See the repository LICENSE and third-party notice for
          preserved copyright and the scope of local changes. The{" "}
          <a href="/about" className="underline underline-offset-2 hover:text-foreground">
            About page
          </a>{" "}
          has upstream attribution and the current project scope.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          First-run tour
        </h3>
        <p className="mt-1 text-muted-foreground">
          The 4-step welcome wizard (intro + topic + model setup + feature tour) only fires on the
          very first app open. Replay it any time:
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={replayTour}
          disabled={replayBusy}
          className="mt-2"
        >
          {replayBusy ? "Resetting…" : "Replay welcome tour"}
        </Button>
        {replayError ? <p className="mt-2 text-xs text-destructive">{replayError}</p> : null}
      </div>
    </div>
  );
}
