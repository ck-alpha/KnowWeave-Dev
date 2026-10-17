import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface SciFactDocument {
  _id: string;
  title: string;
  text: string;
}

export interface SciFactQuery {
  _id: string;
  text: string;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function jsonl<T extends SciFactQuery>(
  text: string,
  label: string,
  corpus: boolean,
): Map<string, T> {
  const items = new Map<string, T>();
  text
    .trimEnd()
    .split(/\r?\n/)
    .forEach((line, index) => {
      const item: unknown = JSON.parse(line);
      if (
        !item ||
        typeof item !== "object" ||
        !("_id" in item) ||
        typeof item._id !== "string" ||
        !item._id ||
        !("text" in item) ||
        typeof item.text !== "string" ||
        (corpus && (!("title" in item) || typeof item.title !== "string"))
      )
        throw new Error(`${label}:${index + 1}: invalid document/query`);
      if (items.has(item._id)) throw new Error(`${label}: duplicate ID ${item._id}`);
      items.set(item._id, item as T);
    });
  return items;
}

export function parseDataset(corpusText: string, queryText: string, qrelsText: string) {
  const corpus = jsonl<SciFactDocument>(corpusText, "corpus", true);
  const queries = jsonl<SciFactQuery>(queryText, "queries", false);
  const lines = qrelsText.trimEnd().split(/\r?\n/);
  if (lines.shift() !== "query-id\tcorpus-id\tscore") throw new Error("Unexpected qrels header");
  const qrels = new Map<string, Map<string, number>>();
  for (const [index, line] of lines.entries()) {
    const fields = line.split("\t");
    const [queryId, corpusId, scoreText] = fields;
    if (
      fields.length !== 3 ||
      !queryId ||
      !corpusId ||
      !scoreText ||
      !queries.has(queryId) ||
      !corpus.has(corpusId) ||
      !/^\d+$/.test(scoreText)
    )
      throw new Error(`qrels:${index + 2}: invalid qrel or unknown ID`);
    const score = Number(scoreText);
    if (!Number.isSafeInteger(score)) throw new Error("Invalid qrel grade");
    const rows = qrels.get(queryId) ?? new Map<string, number>();
    if (rows.has(corpusId)) throw new Error(`Duplicate qrel ${queryId}/${corpusId}`);
    rows.set(corpusId, score);
    qrels.set(queryId, rows);
  }
  if (!qrels.size) throw new Error("Empty test qrels");
  for (const [queryId, rows] of qrels) {
    if (![...rows.values()].some((score) => score > 0))
      throw new Error(`No positive qrels for ${queryId}`);
  }
  // Dataset order never selects an easier subset. Every query in test qrels is evaluated.
  const testQueries = [...qrels.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return { corpus, queries, qrels, testQueries };
}

export function loadDataset(directory: string) {
  const files = ["corpus.jsonl", "queries.jsonl", "qrels/test.tsv"] as const;
  const buffers = files.map((file) => readFileSync(join(directory, file)));
  const dataset = parseDataset(
    buffers[0]!.toString("utf8"),
    buffers[1]!.toString("utf8"),
    buffers[2]!.toString("utf8"),
  );
  return {
    ...dataset,
    fileHashes: Object.fromEntries(files.map((file, index) => [file, sha256(buffers[index]!)])),
    statistics: {
      corpus_documents: dataset.corpus.size,
      queries_total: dataset.queries.size,
      test_queries: dataset.qrels.size,
      test_qrels: [...dataset.qrels.values()].reduce((sum, rows) => sum + rows.size, 0),
    },
  };
}
