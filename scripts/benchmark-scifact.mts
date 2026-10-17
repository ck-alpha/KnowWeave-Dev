#!/usr/bin/env node
/** Complete original-corpus SciFact test evaluation using the production retriever. */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { openDb, type Db } from "../packages/core/src/db";
import { indexPageForSearch, unindexPageFromSearch } from "../packages/core/src/db-pages";
import { refreshEmbeddings, retrievePages } from "../packages/core/src/retrieval";
import { createOllamaEmbedder } from "../packages/llm/src/embedding";
import {
  averageMetrics,
  percentile,
  scoreRanking,
  type RetrievalMetrics,
} from "./retrieval-metrics";
import { loadDataset, sha256 } from "./scifact-dataset";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODES = ["bm25", "embedding", "hybrid"] as const;
type Mode = (typeof MODES)[number];

function command(executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function optionalCommand(executable: string, args: string[]): string | null {
  try {
    return command(executable, args);
  } catch {
    return null;
  }
}

function sourceFingerprint() {
  // Only the modules used by this experiment determine validity; unrelated UI,
  // Query prompt, tests and documentation can be edited without changing it.
  const paths = [
    "packages/core/src/db.ts",
    "packages/core/src/db-pages.ts",
    "packages/core/src/retrieval.ts",
    "packages/core/src/retrieval-store.ts",
    "packages/core/src/wiki.ts",
    "packages/llm/src/embedding.ts",
    "scripts/scifact.py",
    "scripts/scifact-dataset.ts",
    "scripts/retrieval-metrics.ts",
    "scripts/benchmark-scifact.mts",
    "package.json",
    "pnpm-lock.yaml",
  ];
  const files = Object.fromEntries(
    paths.sort().map((path) => [path, sha256(readFileSync(join(ROOT, path)))]),
  );
  return { sha256: sha256(JSON.stringify(files)), files };
}

function gitState() {
  const status = command("git", ["status", "--porcelain"]);
  return {
    head: command("git", ["rev-parse", "HEAD"]),
    committed_tree: command("git", ["rev-parse", "HEAD^{tree}"]),
    dirty: status.length > 0,
    status: status.split("\n").filter(Boolean),
    tracked_diff_sha256: sha256(command("git", ["diff", "--binary", "HEAD"])),
    source: sourceFingerprint(),
  };
}

async function environment() {
  const baseURL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
  let ollamaVersion: unknown = null;
  try {
    const response = await fetch(`${baseURL}/api/version`, { signal: AbortSignal.timeout(10000) });
    if (response.ok) ollamaVersion = await response.json();
  } catch {
    /* The required embedder request reports service errors below. */
  }
  return {
    node: process.version,
    pnpm: optionalCommand("pnpm", ["--version"]),
    platform: platform(),
    architecture: process.arch,
    kernel: release(),
    cpu_model: cpus()[0]?.model ?? null,
    logical_cpus: cpus().length,
    memory_bytes: totalmem(),
    ollama: ollamaVersion,
    gpu: optionalCommand("nvidia-smi", [
      "--query-gpu=name,driver_version,memory.total",
      "--format=csv,noheader",
    ]),
  };
}

async function ollamaRuntime() {
  const baseURL = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
  try {
    const response = await fetch(`${baseURL}/api/ps`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const value = (await response.json()) as { models?: Array<Record<string, unknown>> };
    return (
      value.models?.map(({ name, digest, size_vram, context_length }) => ({
        name,
        digest,
        size_vram,
        context_length,
      })) ?? []
    );
  } catch {
    return null;
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`${name} must be a positive integer`);
  return number;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "data-dir": { type: "string" },
      "cache-dir": { type: "string" },
      "output-dir": { type: "string" },
      "batch-size": { type: "string" },
      "candidate-limit": { type: "string" },
      "rrf-k": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: pnpm benchmark:scifact [--data-dir data/scifact] [--cache-dir .local/benchmarks/scifact/index] [--output-dir <new-directory>] [--batch-size 16] [--candidate-limit 100] [--rrf-k 60]\nAlways verifies the official release and evaluates every test query over all 5,183 original papers. Existing document vectors resume by content and model fingerprint.",
    );
    return;
  }
  const batchSize = positiveInteger(values["batch-size"], 16, "batch-size");
  if (batchSize > 256) throw new Error("batch-size must be at most 256");
  const candidateLimit = positiveInteger(values["candidate-limit"], 100, "candidate-limit");
  const rrfK = positiveInteger(values["rrf-k"], 60, "rrf-k");
  if (candidateLimit < 10)
    throw new Error("candidate-limit must be at least the metric cutoff (10)");
  const dataDir = resolve(ROOT, values["data-dir"] ?? "data/scifact");
  const cacheDir = resolve(ROOT, values["cache-dir"] ?? ".local/benchmarks/scifact/index");
  const started = new Date();
  const outputDir = resolve(
    ROOT,
    values["output-dir"] ??
      `.local/benchmarks/scifact/runs/${started.toISOString().replace(/[:.]/g, "-")}`,
  );
  mkdirSync(dirname(outputDir), { recursive: true });
  // A failed or earlier report is never overwritten by a later run.
  mkdirSync(outputDir);
  const reportPath = join(outputDir, "results.json");
  const rankingsPath = join(outputDir, "rankings.jsonl");
  const start = performance.now();
  const report: Record<string, unknown> = {
    schema_version: 1,
    status: "running",
    started_at: started.toISOString(),
    timezone: "Asia/Shanghai",
    command: ["pnpm", "benchmark:scifact", ...process.argv.slice(2)],
    dataset: {
      name: "BEIR SciFact",
      split: "test",
      representation: "original corpus title and complete abstract; no Qwen/Wiki rewriting",
    },
    parameters: {
      cutoff: 10,
      candidate_limit: candidateLimit,
      rrf_k: rrfK,
      batch_size: batchSize,
      bm25: "SQLite FTS5 default BM25; production literal-token OR query; maximum 64 terms",
      vector: "production exact cosine scan over normalized Float32 vectors",
      fusion: "unweighted reciprocal rank fusion; rank starts at 1; 1/(rrf_k + rank)",
      parameter_selection: "Fixed before test evaluation; no label-guided tuning",
    },
    metric_definition: {
      averaging: "macro over every test query",
      positive_relevance: "score > 0",
      unjudged_gain: 0,
      recall: "relevant retrieved in top 10 / all positive qrels for the query",
      ndcg: "sum(relevance/log2(rank+1)) / ideal DCG@10; linear gain (trec_eval convention)",
      mrr: "reciprocal rank of first positive qrel within top 10, or 0",
    },
    latency_definition:
      "wall time per retrievePages call, including actual query embedding HTTP request for embedding/hybrid, model lookup and full vector scan; no cached query vectors; sequential runs with rotating mode order; model warmed by indexing; nearest-rank percentiles; excludes Qwen answer generation",
    local_artifacts: {
      report: relative(ROOT, reportPath),
      rankings: relative(ROOT, rankingsPath),
      vector_cache: relative(ROOT, cacheDir),
    },
  };
  let db: Db | undefined;
  let interruption: string | null = null;
  const interrupt = (signal: string) => {
    interruption = signal;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  function checkInterruption() {
    if (interruption)
      throw new Error(`Interrupted by ${interruption}; persisted document vectors can be resumed`);
  }
  const metrics: Record<Mode, RetrievalMetrics[]> = { bm25: [], embedding: [], hybrid: [] };
  const latencies: Record<Mode, number[]> = { bm25: [], embedding: [], hybrid: [] };
  function save() {
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  try {
    report.git = gitState();
    report.environment = await environment();
    save();
    console.log("Verifying original SciFact bytes against the MD5-checked official archive...");
    // Reuse the Round 01 downloader/validator. A cached ZIP is still rechecked;
    // every original file is compared to the verified archive, not a mutable manifest.
    const verification = JSON.parse(
      command("python3", ["scripts/scifact.py", "download", "--data-dir", dataDir]),
    );
    const data = loadDataset(dataDir);
    if (
      data.statistics.corpus_documents !== 5183 ||
      data.statistics.queries_total !== 1109 ||
      data.statistics.test_queries !== 300 ||
      data.statistics.test_qrels !== 339
    ) {
      throw new Error(`Unexpected official SciFact size: ${JSON.stringify(data.statistics)}`);
    }
    report.dataset = {
      ...(report.dataset as object),
      ...data.statistics,
      input_sha256: data.fileHashes,
      archive_md5: verification.archive_md5,
      archive_sha256: verification.archive_sha256,
      verification:
        "scripts/scifact.py download: official archive checksum and extracted file byte comparison",
    };
    const embedder = createOllamaEmbedder();
    report.model = await embedder.describe();
    db = openDb(cacheDir);
    const indexingStart = performance.now();
    const indexingDb = db;
    indexingDb.transaction(() => {
      // This DB belongs only to the benchmark. Remove deleted IDs while retaining
      // valid vectors; indexPageForSearch invalidates changed content in production.
      const oldIds = indexingDb.prepare("SELECT slug FROM pages_fts").all() as Array<{
        slug: string;
      }>;
      for (const { slug } of oldIds)
        if (!data.corpus.has(slug)) unindexPageFromSearch(indexingDb, slug);
      for (const row of data.corpus.values())
        indexPageForSearch(indexingDb, {
          slug: row._id,
          title: row.title,
          content: row.text,
          tags: [],
        });
    })();
    const bm25IndexMs = performance.now() - indexingStart;
    console.log(
      `Indexed original BM25 corpus: ${data.corpus.size}; refreshing persisted document vectors...`,
    );
    let lastProgress = 0;
    const vectorIndexStart = performance.now();
    const index = await refreshEmbeddings({
      db,
      embedder,
      batchSize,
      onProgress(progress) {
        checkInterruption();
        if (performance.now() - lastProgress > 10000 || progress.completed === progress.total) {
          lastProgress = performance.now();
          console.log(
            `Embedding ${progress.completed}/${progress.total}; embedded=${progress.embedded}, reused=${progress.skipped}`,
          );
        }
      },
    });
    report.indexing = {
      bm25_ms: bm25IndexMs,
      vector_wall_ms: performance.now() - vectorIndexStart,
      ...index,
    };
    report.ollama_runtime_after_index = await ollamaRuntime();
    if (!index.ready)
      throw new Error("Vector index is incomplete; no partial benchmark will be labelled complete");
    save();
    for (const [queryIndex, queryId] of data.testQueries.entries()) {
      checkInterruption();
      const question = data.queries.get(queryId)!.text;
      const judgments = data.qrels.get(queryId)!;
      // Rotate execution order to reduce systematic warm-cache order advantage.
      for (let offset = 0; offset < MODES.length; offset++) {
        checkInterruption();
        const mode = MODES[(queryIndex + offset) % MODES.length]!;
        const queryStart = performance.now();
        const result = await retrievePages({
          db,
          question,
          mode,
          embedder,
          limit: 10,
          candidateLimit,
          rrfK,
        });
        const elapsedMs = performance.now() - queryStart;
        const ids = result.hits.map((hit) => hit.slug);
        if (ids.some((id) => !data.corpus.has(id)))
          throw new Error("Retrieved ID outside the original corpus");
        const score = scoreRanking(ids, judgments, 10);
        metrics[mode].push(score);
        latencies[mode].push(elapsedMs);
        appendFileSync(
          rankingsPath,
          `${JSON.stringify({ query_id: queryId, mode, elapsed_ms: elapsedMs, metrics: score, hits: result.hits })}\n`,
        );
      }
      if ((queryIndex + 1) % 25 === 0 || queryIndex + 1 === data.testQueries.length) {
        report.completed_queries = queryIndex + 1;
        save();
        console.log(
          `Evaluated ${queryIndex + 1}/${data.testQueries.length} test queries in all three modes`,
        );
      }
    }
    report.results = Object.fromEntries(
      MODES.map((mode) => [
        mode,
        {
          queries: metrics[mode].length,
          ...Object.fromEntries(
            Object.entries(averageMetrics(metrics[mode])).map(([metric, value]) => [
              `${metric}@10`,
              value,
            ]),
          ),
          query_latency_ms: {
            p50: percentile(latencies[mode], 0.5),
            p95: percentile(latencies[mode], 0.95),
            mean: latencies[mode].reduce((a, b) => a + b, 0) / latencies[mode].length,
            total: latencies[mode].reduce((a, b) => a + b, 0),
          },
        },
      ]),
    ) as Record<string, unknown>;
    const finalFingerprint = sourceFingerprint();
    const initialFingerprint = (report.git as ReturnType<typeof gitState>).source;
    report.source_unchanged_during_run = initialFingerprint.sha256 === finalFingerprint.sha256;
    report.source_at_end = finalFingerprint;
    if (!report.source_unchanged_during_run)
      throw new Error(
        "Source changed during the run; rerun with stable sources before accepting these results",
      );
    report.rankings_sha256 = sha256(readFileSync(rankingsPath));
    report.rankings_bytes = statSync(rankingsPath).size;
    report.status = "completed";
  } catch (error) {
    report.status = interruption ? "interrupted" : "failed";
    report.error = error instanceof Error ? error.message : String(error);
    report.completed_mode_queries = Object.fromEntries(
      MODES.map((mode) => [mode, metrics[mode].length]),
    );
    process.exitCode = 1;
    console.error(`Benchmark failed: ${String(report.error)}`);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    db?.close();
    report.finished_at = new Date().toISOString();
    report.total_wall_ms = performance.now() - start;
    save();
    console.log(`Report: ${relative(ROOT, reportPath)}`);
    if (report.status === "completed") console.log(JSON.stringify(report.results, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
