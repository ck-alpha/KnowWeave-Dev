import Link from "next/link";

import { Card, PageContainer, PageHeader } from "@/components/page-shell";

export default function LocalModelsPage() {
  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="KnowWeave setup"
        title="Ollama and local Qwen"
        description="Use your existing local model for document ingestion, questions, chat, and wiki checks."
      />
      <div className="space-y-6 text-body leading-relaxed">
        <Card>
          <h2 className="font-display text-h2 font-semibold">1. Check the local runtime</h2>
          <p className="mt-3 text-muted-foreground">
            Start Ollama if it is not already running, then list installed models. Use the exact tag
            reported by your installation. This project&apos;s Round 01 environment uses{" "}
            <code>qwen3.8:27b</code>; another machine must have the selected model installed before
            inference can work.
          </p>
          <pre className="mt-3 overflow-x-auto text-caption">{`ollama --version
ollama list
curl http://127.0.0.1:11434/api/tags
# Only if the Ollama service is not already running:
ollama serve`}</pre>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">2. Select the provider and model</h2>
          <p className="mt-3 text-muted-foreground">
            In{" "}
            <Link href="/settings?tab=models" className="text-primary underline underline-offset-2">
              Settings → Models
            </Link>
            , choose Ollama (Local) for each operation and enter the installed model tag. The
            default text model is <code>qwen3.8:27b</code>. Save the settings. Local Ollama
            operations do not need an API key.
          </p>
          <p className="mt-3 text-muted-foreground">
            Round 01 uses text documents. Image and scanned PDF ingestion additionally require a
            model whose image input capabilities have been verified; a text workflow passing does
            not establish vision support.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">3. Try a small source</h2>
          <p className="mt-3 text-muted-foreground">
            Add a short document in Sources, run Ingest, inspect the generated Wiki pages, then ask
            a question in Query. Follow the answer&apos;s page citations and the page&apos;s source
            links to verify the evidence. The repository README describes the repeatable SciFact
            sample workflow.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Connection and output checks</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              Connection refused: confirm Ollama is reachable from the machine running the Next.js
              server.
            </li>
            <li>
              Model not found: compare Settings with <code>ollama list</code>, including the
              complete tag.
            </li>
            <li>
              Custom address: set <code>OLLAMA_BASE_URL</code> before starting the app, then restart
              it. The default is <code>http://127.0.0.1:11434</code>.
            </li>
            <li>
              Slow responses: allow for model loading and hardware limits; begin with a short text
              source.
            </li>
            <li>
              Invalid model output: inspect the error and retry with a smaller source. Ingest and
              Query require schema-valid JSON.
            </li>
          </ul>
        </Card>
        <Link href="/help" className="inline-block text-primary underline underline-offset-2">
          Using the wiki →
        </Link>
      </div>
    </PageContainer>
  );
}
