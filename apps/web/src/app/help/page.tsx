import Link from "next/link";

import { Card, PageContainer, PageHeader } from "@/components/page-shell";

export default function HelpPage() {
  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="KnowWaeve"
        title="Using your local knowledge workspace"
        description="Create a wiki, add evidence, ask questions, and check the sources."
      />
      <div className="space-y-6 text-body leading-relaxed">
        <Card>
          <h2 className="font-display text-h2 font-semibold">Set up the wiki</h2>
          <p className="mt-3 text-muted-foreground">
            Give the wiki a focused topic. In Settings → Models, select Ollama and a model tag
            installed on your machine. Local model calls do not require an OpenRouter key. See the{" "}
            <Link href="/local-models" className="text-primary underline underline-offset-2">
              local setup guide
            </Link>{" "}
            for connection checks. Settings → Wikis creates or switches between separate wiki
            folders.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Add a document and run Ingest</h2>
          <p className="mt-3 text-muted-foreground">
            Open{" "}
            <Link href="/sources" className="text-primary underline underline-offset-2">
              Sources
            </Link>{" "}
            and paste text, upload a supported file, or enter a URL. The app keeps the source and
            asks the model to create or update linked Wiki pages. When ingest approval is enabled in
            Settings → General, review and apply the proposal before expecting pages to appear.
          </p>
          <p className="mt-3 text-muted-foreground">
            Begin with a short text document. The SciFact sample procedure lives in the repository
            README; it is a small workflow demonstration, not a full dataset evaluation.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Ask and verify</h2>
          <p className="mt-3 text-muted-foreground">
            <Link href="/query" className="text-primary underline underline-offset-2">
              Query
            </Link>{" "}
            answers a single question from your wiki. Chats keeps a conversation. Open cited pages,
            inspect their sources, and compare the answer with the original text. A citation is a
            navigation aid; verify that its content actually supports the claim. You can save useful
            answers as wiki pages.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Maintain the knowledge</h2>
          <p className="mt-3 text-muted-foreground">
            Wiki supports browsing, editing, history, and linked pages. Graph displays existing wiki
            links. Lint checks local link/index issues and can request semantic checks from the
            configured model. Schema edits the wiki&apos;s
            <code> CLAUDE.md</code> guidance. Log records changes.
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Your files</h2>
          <pre className="mt-3 overflow-x-auto text-caption">{`<wiki folder>/
├── CLAUDE.md       Wiki schema and model guidance
├── index.md        Wiki page catalog
├── log.md          Change log
├── raw/            Imported sources
├── wiki/           Markdown pages
├── chats/          Conversations
└── .llm-wiki/      SQLite metadata, settings, and history`}</pre>
          <p className="mt-3 text-muted-foreground">
            The internal metadata name is retained for compatibility. Back up your wiki folder
            before upgrading. For source updates, dependency setup, and tested commands, use this
            project&apos;s README and current development records.
          </p>
        </Card>
        <div className="flex gap-6 text-ui">
          <Link href="/about" className="text-primary underline underline-offset-2">
            About KnowWaeve
          </Link>
          <Link href="/developers" className="text-primary underline underline-offset-2">
            Developer overview
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
