export type IngestSuccess = {
  ok: true;
  kind: "applied" | "preview";
  wikiPath: string;
  sourceId: string;
  rawFilename: string;
  model: string;
  response: {
    summary: string;
    newPages: Array<{ slug: string; title: string; type: string }>;
    pageUpdates: Array<{ slug: string; updateReason: string }>;
    contradictions: Array<{ description: string; pages: string[] }>;
  };
  fullResponse: unknown | null;
};
