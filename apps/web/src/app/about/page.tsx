import Link from "next/link";

import { Card, PageContainer, PageHeader } from "@/components/page-shell";

export default function AboutPage() {
  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="About the project"
        title="KnowWaeve"
        description="A local-first knowledge workspace: turn source documents into a maintainable wiki, ask questions, and inspect the evidence."
      />
      <div className="space-y-6 text-body leading-relaxed">
        <Card>
          <h2 className="font-display text-h2 font-semibold">Documents → Wiki → Answers</h2>
          <p className="mt-3 text-muted-foreground">
            Add a document in Sources. An LLM proposes or applies linked Markdown pages. Browse the
            wiki, ask a question, then follow its page citations and source links back to the
            imported material. The source files and generated pages stay in your selected wiki
            folder.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Local models first</h2>
          <p className="mt-3 text-muted-foreground">
            KnowWaeve uses Ollama for local inference. This project&apos;s Round 01 setup targets
            the locally installed <code>qwen3.8:27b</code> model. Check the exact model tag on your
            machine before use. A paid cloud API is not required. If you choose an external provider
            in Settings, its selected operations send content to that provider.
          </p>
          <Link
            href="/local-models"
            className="mt-3 inline-block text-primary underline underline-offset-2"
          >
            Local model setup →
          </Link>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Current scope</h2>
          <p className="mt-3 text-muted-foreground">
            Round 01 focuses on a reproducible local workflow with a small BEIR SciFact sample.
            Search currently uses SQLite FTS5/BM25. Embedding retrieval, hybrid search, RRF, and
            full SciFact retrieval evaluation are planned for a later round; the sample wiki is a
            demonstration, not a benchmark result.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Source and license</h2>
          <p className="mt-3 text-muted-foreground">
            KnowWaeve is derived from{" "}
            <a
              href="https://github.com/ddsyasas/llm-wiki"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              LLM Wiki by Yasas
            </a>{" "}
            under the MIT License. The inherited implementation provides the wiki, ingestion, query,
            and UI foundations. The repository&apos;s LICENSE retains the original copyright; its
            third-party notice records the source and this project&apos;s changes. The upstream
            design credits Andrej Karpathy&apos;s LLM Wiki pattern.
          </p>
        </Card>
        <div className="flex gap-6 text-ui">
          <Link href="/help" className="text-primary underline underline-offset-2">
            Using KnowWaeve
          </Link>
          <Link href="/developers" className="text-primary underline underline-offset-2">
            Developer overview
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
