import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openWikiContext: vi.fn(),
  close: vi.fn(),
  getApiKey: vi.fn(),
  getSource: vi.fn(),
  ingestSource: vi.fn(),
  ingestVisionSource: vi.fn(),
  saveRawSource: vi.fn(),
  markSourceIngested: vi.fn(),
  deleteSource: vi.fn(),
  applyIngestResponse: vi.fn(),
  otherReference: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  extractSourceFile: vi.fn(),
}));

vi.mock("../packages/core/src/index", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getApiKey: mocks.getApiKey,
  getSource: mocks.getSource,
  ingestSource: mocks.ingestSource,
  ingestVisionSource: mocks.ingestVisionSource,
  saveRawSource: mocks.saveRawSource,
  markSourceIngested: mocks.markSourceIngested,
  deleteSource: mocks.deleteSource,
  applyIngestResponse: mocks.applyIngestResponse,
}));
vi.mock("../packages/llm/src/index", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createClient: () => ({ chat: {} }),
}));
vi.mock("../packages/ingestion/src/index", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractSourceFile: mocks.extractSourceFile,
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readFile: mocks.readFile,
  mkdir: mocks.mkdir,
  rename: mocks.rename,
  stat: mocks.stat,
}));
vi.mock("../apps/web/src/lib/server-wiki", () => ({
  openWikiContext: mocks.openWikiContext,
  resolveWikiPath: () => "/wiki/test",
}));

import { POST as ingest } from "../apps/web/src/app/api/ingest/route";
import { POST as apply } from "../apps/web/src/app/api/ingest/apply/route";
import { POST as retry } from "../apps/web/src/app/api/sources/[id]/retry/route";
import { POST as remove } from "../apps/web/src/app/api/sources/[id]/delete/route";
import { POST as createPage } from "../apps/web/src/app/api/pages/route";
import { PUT as editPage } from "../apps/web/src/app/api/pages/[slug]/route";

const source = {
  id: "source-1",
  title: "Original study",
  filename: "study.md",
  format: "md",
  ingested_at: null,
};
const response = {
  summary: "Compiled",
  newPages: [],
  pageUpdates: [],
  contradictions: [],
  indexEntries: [],
  logEntry: "Compiled source",
};
const db = { close: mocks.close, prepare: () => ({ get: mocks.otherReference }) };
const params = { params: { id: source.id } };
const settings = {
  requireApprovalForIngest: false,
  defaultModels: {
    ingest: { provider: "ollama", model: "qwen3.8:27b" },
    vision: { provider: "ollama", model: "test-vision" },
  },
};
function request(body: unknown) {
  return new Request("http://127.0.0.1/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiKey.mockResolvedValue({ key: "" });
  mocks.openWikiContext.mockResolvedValue({ wikiPath: "/wiki/test", db, settings });
  mocks.getSource.mockReturnValue({ ...source });
  mocks.ingestSource.mockResolvedValue(response);
  mocks.ingestVisionSource.mockResolvedValue(response);
  mocks.saveRawSource.mockResolvedValue({ sourceId: source.id, rawFilename: "saved.pdf" });
  mocks.otherReference.mockReturnValue(undefined);
  mocks.readFile.mockResolvedValue(Buffer.from("original evidence"));
  mocks.stat.mockResolvedValue({ size: 17 });
  mocks.extractSourceFile.mockImplementation(
    async (buffer: Buffer, filename: string, format = "md") => ({
      kind: "text",
      content: buffer.toString("utf8"),
      title: filename,
      format,
      metadata: {},
    }),
  );
  mocks.rename.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
});

describe("source and page input boundaries", () => {
  it.each([null, [], "text", 5])(
    "rejects non-object JSON without opening a Wiki: %j",
    async (body) => {
      const routes = [
        ingest,
        apply,
        createPage,
        (req: Request) => editPage(req, { params: { slug: "study" } }),
        (req: Request) => retry(req, params),
      ];
      for (const route of routes) expect((await route(request(body))).status).toBe(400);
      expect(mocks.openWikiContext).not.toHaveBeenCalled();
      expect(mocks.ingestSource).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { text: " " }, { text: "study", title: 5 }, { text: "study", model: "" }])(
    "rejects empty or malformed ingest %j",
    async (body) => {
      expect((await ingest(request(body))).status).toBe(400);
      expect(mocks.openWikiContext).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty uploaded file before extraction", async () => {
    const form = new FormData();
    form.set("file", new File([], "empty.md"));
    expect(
      (await ingest(new Request("http://127.0.0.1/api", { method: "POST", body: form }))).status,
    ).toBe(400);
    expect(mocks.openWikiContext).not.toHaveBeenCalled();
  });

  it("rejects uploads over 20 MiB before extraction or saving", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.pdf"));
    const result = await ingest(
      new Request("http://127.0.0.1/api", { method: "POST", body: form }),
    );
    expect(result.status).toBe(413);
    expect(mocks.extractSourceFile).not.toHaveBeenCalled();
    expect(mocks.saveRawSource).not.toHaveBeenCalled();
  });

  it("uploads PDF text through the text model while saving original bytes", async () => {
    const bytes = "%PDF-original bytes";
    const form = new FormData();
    form.set("file", new File([bytes], "study.pdf"));
    mocks.extractSourceFile.mockResolvedValueOnce({
      kind: "text",
      content: "PDF text evidence",
      title: "study",
      format: "pdf",
      metadata: {},
    });
    expect(
      (await ingest(new Request("http://127.0.0.1/api", { method: "POST", body: form }))).status,
    ).toBe(200);
    expect(mocks.extractSourceFile).toHaveBeenCalledWith(Buffer.from(bytes), "study.pdf");
    expect(mocks.saveRawSource).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: Buffer.from(bytes), format: "pdf" }),
    );
    expect(mocks.ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "qwen3.8:27b",
        source: { content: "PDF text evidence", title: "study", format: "pdf" },
      }),
    );
    expect(mocks.ingestVisionSource).not.toHaveBeenCalled();
  });

  it("does not save or call a model when extraction fails", async () => {
    const form = new FormData();
    form.set("file", new File(["%PDF-empty text layer"], "scan.pdf"));
    mocks.extractSourceFile.mockRejectedValueOnce(new Error("PDF 中没有可提取的文字层，请先 OCR"));
    const result = await ingest(
      new Request("http://127.0.0.1/api", { method: "POST", body: form }),
    );
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain("OCR");
    expect(mocks.saveRawSource).not.toHaveBeenCalled();
    expect(mocks.ingestSource).not.toHaveBeenCalled();
  });

  it("uploads images through the vision slot and preserves the approval preview", async () => {
    mocks.openWikiContext.mockResolvedValueOnce({
      wikiPath: "/wiki/test",
      db,
      settings: { ...settings, requireApprovalForIngest: true },
    });
    const form = new FormData();
    form.set("file", new File(["image bytes"], "scan.png"));
    mocks.extractSourceFile.mockResolvedValueOnce({
      kind: "vision",
      format: "image",
      title: "scan",
      base64: "image-bytes",
      mediaType: "image/png",
      sizeBytes: 11,
      metadata: {},
    });
    const result = await ingest(
      new Request("http://127.0.0.1/api", { method: "POST", body: form }),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      kind: "preview",
      model: "test-vision",
      fullResponse: response,
    });
    expect(mocks.ingestVisionSource).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-vision", sourceId: source.id, dryRun: true }),
    );
    expect(mocks.ingestSource).not.toHaveBeenCalled();
    expect(mocks.markSourceIngested).not.toHaveBeenCalled();
  });

  it("rejects malformed edit metadata without writing", async () => {
    expect(
      (
        await editPage(request({ content: "body", tags: "not-an-array" }), {
          params: { slug: "study" },
        })
      ).status,
    ).toBe(400);
    expect(mocks.openWikiContext).not.toHaveBeenCalled();
  });
});

describe("retry preserves ingestion contracts", () => {
  it("rejects applying the same proposal twice", async () => {
    mocks.getSource.mockReturnValueOnce({ ...source, ingested_at: "2026-10-17T00:00:00Z" });
    expect((await apply(request({ sourceId: source.id, response }))).status).toBe(409);
    expect(mocks.applyIngestResponse).not.toHaveBeenCalled();
    expect(mocks.markSourceIngested).not.toHaveBeenCalled();
  });

  it("rejects a proposal whose source was deleted before approval", async () => {
    mocks.getSource.mockReturnValueOnce(null);
    expect((await apply(request({ sourceId: source.id, response }))).status).toBe(404);
    expect(mocks.applyIngestResponse).not.toHaveBeenCalled();
  });

  it("returns an approval preview without applying or marking the source ingested", async () => {
    mocks.openWikiContext.mockResolvedValueOnce({
      wikiPath: "/wiki/test",
      db,
      settings: { ...settings, requireApprovalForIngest: true },
    });
    const result = await retry(request({}), params);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      kind: "preview",
      fullResponse: response,
      rawFilename: "study.md",
    });
    expect(mocks.ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: source.id, dryRun: true }),
    );
    expect(mocks.markSourceIngested).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("reuses the existing original source for normal retries", async () => {
    const result = await retry(request({}), params);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      kind: "applied",
      sourceId: source.id,
      fullResponse: null,
    });
    expect(mocks.ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ content: "original evidence" }),
        dryRun: false,
      }),
    );
    expect(mocks.markSourceIngested).toHaveBeenCalledWith(db, source.id);
  });

  it("extracts Office input before passing evidence to the text model", async () => {
    mocks.getSource.mockReturnValueOnce({ ...source, format: "docx", original_name: "study.docx" });
    mocks.extractSourceFile.mockResolvedValueOnce({
      kind: "text",
      format: "docx",
      content: "extracted evidence",
      metadata: {},
    });
    expect((await retry(request({}), params)).status).toBe(200);
    expect(mocks.ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ content: "extracted evidence" }),
      }),
    );
    expect(mocks.extractSourceFile).toHaveBeenCalledWith(expect.any(Buffer), "study.docx", "docx");
  });

  it("retries PDFs using extracted text and the existing source ID", async () => {
    mocks.getSource.mockReturnValueOnce({ ...source, format: "pdf", original_name: "study.pdf" });
    mocks.extractSourceFile.mockResolvedValueOnce({
      kind: "text",
      format: "pdf",
      content: "PDF text evidence",
      metadata: {},
    });
    expect((await retry(request({}), params)).status).toBe(200);
    expect(mocks.ingestSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: source.id,
        model: "qwen3.8:27b",
        source: expect.objectContaining({ content: "PDF text evidence", format: "pdf" }),
      }),
    );
    expect(mocks.saveRawSource).not.toHaveBeenCalled();
    expect(mocks.ingestVisionSource).not.toHaveBeenCalled();
  });

  it("retries images through the configured vision model and preserves approval", async () => {
    mocks.openWikiContext.mockResolvedValueOnce({
      wikiPath: "/wiki/test",
      db,
      settings: { ...settings, requireApprovalForIngest: true },
    });
    mocks.getSource.mockReturnValueOnce({ ...source, format: "image", original_name: "scan.png" });
    mocks.extractSourceFile.mockResolvedValueOnce({
      kind: "vision",
      format: "image",
      base64: "image-bytes",
      mediaType: "image/png",
      sizeBytes: 10,
      metadata: {},
    });
    const result = await retry(request({}), params);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      kind: "preview",
      fullResponse: response,
      model: "test-vision",
    });
    expect(mocks.ingestVisionSource).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-vision",
        sourceId: source.id,
        dryRun: true,
        source: expect.objectContaining({ mediaType: "image/png", title: source.title }),
      }),
    );
    expect(mocks.ingestSource).not.toHaveBeenCalled();
    expect(mocks.markSourceIngested).not.toHaveBeenCalled();
  });

  it("retains actionable extraction errors and pending sources on retry", async () => {
    mocks.getSource.mockReturnValueOnce({ ...source, format: "pdf" });
    mocks.extractSourceFile.mockRejectedValueOnce(new Error("PDF 中没有可提取的文字层，请先 OCR"));
    const result = await retry(request({}), params);
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain("OCR");
    expect(mocks.ingestSource).not.toHaveBeenCalled();
    expect(mocks.markSourceIngested).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects oversized retry originals before reading them", async () => {
    mocks.stat.mockResolvedValueOnce({ size: 20 * 1024 * 1024 + 1 });
    expect((await retry(request({}), params)).status).toBe(413);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.ingestSource).not.toHaveBeenCalled();
  });

  it("does not mark image sources ingested when the vision model fails", async () => {
    mocks.getSource.mockReturnValueOnce({ ...source, format: "image", original_name: "scan.png" });
    mocks.extractSourceFile.mockResolvedValueOnce({
      kind: "vision",
      format: "image",
      base64: "image-bytes",
      mediaType: "image/png",
      sizeBytes: 11,
      metadata: {},
    });
    mocks.ingestVisionSource.mockRejectedValueOnce(new Error("model does not support images"));
    const result = await retry(request({}), params);
    expect(result.status).toBe(500);
    expect((await result.json()).error).toContain("does not support images");
    expect(mocks.markSourceIngested).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects retrying an already applied source", async () => {
    mocks.getSource.mockReturnValueOnce({ ...source, ingested_at: "2026-10-17T00:00:00Z" });
    expect((await retry(request({}), params)).status).toBe(409);
    expect(mocks.ingestSource).not.toHaveBeenCalled();
  });

  it("reports a missing original without an absolute machine path", async () => {
    mocks.readFile.mockRejectedValueOnce(
      Object.assign(new Error("private path"), { code: "ENOENT" }),
    );
    const result = await retry(request({}), params);
    expect(result.status).toBe(404);
    expect((await result.json()).error).not.toContain("/wiki/test");
    expect(mocks.ingestSource).not.toHaveBeenCalled();
  });

  it("closes the database once when a provider key is missing", async () => {
    mocks.openWikiContext.mockResolvedValueOnce({
      wikiPath: "/wiki/test",
      db,
      settings: {
        ...settings,
        defaultModels: { ingest: { provider: "openrouter", model: "model" } },
      },
    });
    expect((await retry(request({}), params)).status).toBe(400);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});

describe("source deletion preserves recoverability", () => {
  it("keeps metadata on a trash move permission error", async () => {
    mocks.rename.mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { code: "EACCES" }),
    );
    expect((await remove(request({}), params)).status).toBe(500);
    expect(mocks.deleteSource).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("removes an orphaned row when the original is already missing", async () => {
    mocks.rename.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect((await remove(request({}), params)).status).toBe(200);
    expect(mocks.deleteSource).toHaveBeenCalledWith(db, source.id);
  });

  it("preserves a legacy shared original while deleting just one source", async () => {
    mocks.otherReference.mockReturnValueOnce({ id: "source-2" });
    expect((await remove(request({}), params)).status).toBe(200);
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.deleteSource).toHaveBeenCalledWith(db, source.id);
  });

  it("returns 404 for a source that was already removed", async () => {
    mocks.getSource.mockReturnValueOnce(null);
    expect((await remove(request({}), params)).status).toBe(404);
    expect(mocks.deleteSource).not.toHaveBeenCalled();
  });
});
