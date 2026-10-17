#!/usr/bin/env node
/** Eight real-Ollama lifecycle checks on temporary synthetic Wikis.
 * Run: pnpm exec tsx scripts/verify-retrieval.mts
 * Requires Ollama and nomic-embed-text:v1.5; does not call Qwen.
 * Evidence: .local/evidence/round02/lifecycle.json (nonzero exit on failure).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb,
  initWikiFolder,
  createPage,
  applyManualEdit,
  softDeletePage,
  readPage,
  writePage,
  syncWikiToDb,
  refreshEmbeddings,
  retrievalStatus,
  retrievePages,
} from "../packages/core/src/index";
import { createOllamaEmbedder } from "../packages/llm/src/embedding";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, ".local/evidence/round02");
const output = join(outputDirectory, "lifecycle.json");
await mkdir(outputDirectory, { recursive: true });
const directory = await mkdtemp(join(outputDirectory, "lifecycle-wikis-"));
const wikiA = join(directory, "wiki-a");
const wikiB = join(directory, "wiki-b");

const checks: Array<Record<string, unknown>> = [];
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  status: "running",
  note: "Real Ollama embeddings on synthetic temporary Wiki pages; no Qwen was invoked by this lifecycle check.",
  checks,
};
async function check(name: string, run: () => Promise<unknown>) {
  const started = performance.now();
  try {
    const result = await run();
    checks.push({ name, passed: true, elapsedMs: performance.now() - started, result });
  } catch (error) {
    checks.push({
      name,
      passed: false,
      elapsedMs: performance.now() - started,
      error: String(error),
    });
    throw error;
  }
}
async function verify() {
  await initWikiFolder(wikiA);
  await initWikiFolder(wikiB);
  let a = openDb(wikiA);
  let b: ReturnType<typeof openDb> | undefined;
  try {
    b = openDb(wikiB);
    const secondDb = b;
    const embedder = createOllamaEmbedder();
    evidence.model = await embedder.describe();
    await createPage(wikiA, a, {
      slug: "renal-filtration",
      title: "Renal filtration",
      type: "concept",
      content:
        "The kidneys use nephrons to filter blood, remove metabolic waste, and maintain fluid and electrolyte balance.",
    });
    await createPage(wikiA, a, {
      slug: "cardiac-cycle",
      title: "Cardiac cycle",
      type: "concept",
      content:
        "The heart rhythmically contracts to pump blood and deliver oxygen through the circulation.",
    });
    await check("initial_build_real_ollama", async () => {
      const result = await refreshEmbeddings({ db: a, embedder });
      assert.equal(result.embedded, 2);
      assert.equal(result.ready, true);
      assert.equal(result.dimensions, 768);
      return result;
    });
    await check("semantic_rewording", async () => {
      const question = "Which organ removes metabolic waste from circulating fluid?";
      const results = {} as Record<string, unknown>;
      for (const mode of ["bm25", "embedding", "hybrid"] as const) {
        const result = await retrievePages({ db: a, embedder, question, mode, limit: 2 });
        if (mode !== "bm25") assert.equal(result.hits[0]?.slug, "renal-filtration");
        results[mode] = result;
      }
      return results;
    });
    await check("restart_reuses_persistent_vectors", async () => {
      a.close();
      a = openDb(wikiA);
      await syncWikiToDb(wikiA, a);
      const result = await refreshEmbeddings({ db: a, embedder });
      assert.equal(result.embedded, 0);
      assert.equal(result.skipped, 2);
      return result;
    });
    await check("update_invalidates_then_embeds_one_page", async () => {
      const before = a
        .prepare("SELECT hex(vector) AS vector FROM page_embeddings WHERE slug=?")
        .get("renal-filtration") as { vector: string };
      await applyManualEdit(wikiA, a, "renal-filtration", {
        content:
          "The kidneys secrete erythropoietin, a hormone that stimulates the bone marrow to produce red blood cells when oxygen levels are low.",
      });
      const pending = retrievalStatus(a);
      assert.equal(pending.pending, 1);
      await assert.rejects(
        () => retrievePages({ db: a, embedder, question: "kidney", mode: "hybrid" }),
        /need embeddings/,
      );
      const refreshed = await refreshEmbeddings({ db: a, embedder });
      assert.equal(refreshed.embedded, 1);
      const after = a
        .prepare("SELECT hex(vector) AS vector FROM page_embeddings WHERE slug=?")
        .get("renal-filtration") as { vector: string };
      assert.notEqual(before.vector, after.vector);
      const retrieved = await retrievePages({
        db: a,
        embedder,
        question: "Which organ releases a signal for marrow to make erythrocytes?",
        mode: "hybrid",
        limit: 2,
      });
      assert.equal(retrieved.hits[0]?.slug, "renal-filtration");
      return { pending, refreshed, retrieved };
    });
    await check("delete_removes_vectors_and_retrieval_hits", async () => {
      await softDeletePage(wikiA, a, "renal-filtration");
      const result = await retrievePages({
        db: a,
        embedder,
        question: "kidney erythropoietin",
        mode: "hybrid",
      });
      assert.equal(
        result.hits.some((hit) => hit.slug === "renal-filtration"),
        false,
      );
      assert.equal(retrievalStatus(a).total, 1);
      return { status: retrievalStatus(a), retrieved: result };
    });
    await check("startup_sync_external_edit", async () => {
      const page = await readPage(wikiA, "cardiac-cycle");
      await writePage(wikiA, {
        ...page,
        content:
          "The left ventricle ejects oxygenated blood into the aorta during systole. Cardiac output depends on heart rate and stroke volume.",
      });
      a.close();
      a = openDb(wikiA);
      const synced = await syncWikiToDb(wikiA, a);
      assert.equal(retrievalStatus(a).pending, 1);
      const refreshed = await refreshEmbeddings({ db: a, embedder });
      assert.equal(refreshed.embedded, 1);
      return { synced, refreshed };
    });
    await check("different_wiki_same_slug_stays_isolated", async () => {
      await createPage(wikiB, secondDb, {
        slug: "cardiac-cycle",
        title: "Pacific ocean currents",
        type: "concept",
        content:
          "Ocean currents transport warm and cold seawater across the Pacific basin and influence marine ecosystems.",
      });
      assert.equal(retrievalStatus(secondDb).indexed, 0);
      await assert.rejects(
        () => retrievePages({ db: secondDb, embedder, question: "ocean", mode: "embedding" }),
        /need embeddings/,
      );
      await refreshEmbeddings({ db: secondDb, embedder });
      const own = await retrievePages({ db: a, embedder, question: "heart", mode: "embedding" });
      const other = await retrievePages({
        db: secondDb,
        embedder,
        question: "ocean",
        mode: "embedding",
      });
      assert.equal(own.hits[0]?.title, "Cardiac cycle");
      assert.equal(other.hits[0]?.title, "Pacific ocean currents");
      return { own, other };
    });
    await check("offline_and_missing_models_keep_bm25_usable", async () => {
      const offline = createOllamaEmbedder({ baseURL: "http://127.0.0.1:1", timeoutMs: 500 });
      await assert.rejects(
        () => retrievePages({ db: a, embedder: offline, question: "heart", mode: "hybrid" }),
        /request failed/,
      );
      await assert.rejects(
        () =>
          createOllamaEmbedder({
            model: "knowweave-nonexistent-model-for-test:missing",
          }).describe(),
        /not installed/,
      );
      const result = await retrievePages({
        db: a,
        embedder: offline,
        question: "heart",
        mode: "bm25",
      });
      assert.equal(result.hits[0]?.slug, "cardiac-cycle");
      return result;
    });
  } finally {
    if (a.open) a.close();
    if (b?.open) b.close();
  }
}

try {
  await verify();
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = String(error);
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.scriptSha256 = createHash("sha256")
    .update(await readFile(new URL(import.meta.url)))
    .digest("hex");
  try {
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  } finally {
    // This path was created by mkdtemp above; never remove a caller's Wiki.
    await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ output, status: evidence.status, checks: checks.length }));
}
