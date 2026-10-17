import { describe, expect, it } from "vitest";

import { averageMetrics, percentile, scoreRanking } from "../scripts/retrieval-metrics";
import { parseDataset } from "../scripts/scifact-dataset";

describe("retrieval metrics", () => {
  it("scores imperfect ranks against all positive qrels and ignores unjudged documents", () => {
    const score = scoreRanking(
      ["unjudged", "a", "unrelated", "b"],
      new Map([
        ["a", 1],
        ["b", 1],
        ["c", 1],
        ["unrelated", 0],
      ]),
    );
    expect(score.recall).toBeCloseTo(2 / 3);
    expect(score.mrr).toBe(1 / 2);
    expect(score.ndcg).toBeCloseTo(
      (1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3) + 1 / Math.log2(4)),
    );
  });

  it("uses linear graded relevance gain and an ideal ranking truncated at k", () => {
    const qrels = new Map([
      ["low", 1],
      ["high", 3],
      ["middle", 2],
    ]);
    const score = scoreRanking(["low", "high", "middle"], qrels, 2);
    expect(score.recall).toBeCloseTo(2 / 3);
    expect(score.ndcg).toBeCloseTo((1 + 3 / Math.log2(3)) / (3 + 2 / Math.log2(3)));
    expect(score.mrr).toBe(1);
  });

  it("returns zero for misses and excludes a hit at rank eleven", () => {
    expect(scoreRanking([], new Map([["a", 1]]))).toEqual({ recall: 0, ndcg: 0, mrr: 0 });
    expect(
      scoreRanking(
        [...Array.from({ length: 10 }, (_, i) => `miss-${i}`), "a"],
        new Map([["a", 1]]),
      ),
    ).toEqual({ recall: 0, ndcg: 0, mrr: 0 });
  });

  it("gives a perfect full ranking one for every metric", () => {
    expect(
      scoreRanking(
        ["a", "b"],
        new Map([
          ["a", 1],
          ["b", 1],
        ]),
      ),
    ).toEqual({ recall: 1, ndcg: 1, mrr: 1 });
  });

  it("macro averages queries, not relevant documents", () => {
    const rows = [
      scoreRanking(["a"], new Map([["a", 1]])),
      scoreRanking(
        [],
        new Map([
          ["b", 1],
          ["c", 1],
        ]),
      ),
    ];
    expect(averageMetrics(rows)).toEqual({ recall: 0.5, ndcg: 0.5, mrr: 0.5 });
    expect(() => averageMetrics([])).toThrow("empty query");
  });

  it("rejects invalid rankings and qrels instead of inflating scores", () => {
    expect(() => scoreRanking(["a", "a"], new Map([["a", 1]]))).toThrow("Duplicate");
    expect(() => scoreRanking([], new Map())).toThrow("positive qrel");
    expect(() => scoreRanking([], new Map([["a", -1]]))).toThrow("relevance");
    expect(() => scoreRanking([], new Map([["a", NaN]]))).toThrow("relevance");
    expect(() => scoreRanking([], new Map([["a", 1]]), 0)).toThrow("cutoff");
  });

  it("reports nearest-rank p50/p95 without mutating the samples", () => {
    const values = [100, 1, 4, 3, 2];
    expect(percentile(values, 0.5)).toBe(3);
    expect(percentile(values, 0.95)).toBe(100);
    expect(values).toEqual([100, 1, 4, 3, 2]);
    expect(() => percentile([], 0.5)).toThrow();
    expect(() => percentile([1, Infinity], 0.5)).toThrow();
  });
});

describe("benchmark dataset integrity", () => {
  const corpus = [
    JSON.stringify({ _id: "a", title: "Paper A", text: "Abstract A" }),
    JSON.stringify({ _id: "b", title: "Paper B", text: "Abstract B" }),
  ].join("\n");
  const queries = [
    JSON.stringify({ _id: "1", text: "Test query" }),
    JSON.stringify({ _id: "2", text: "Non-test query" }),
  ].join("\n");
  const qrels = "query-id\tcorpus-id\tscore\n1\ta\t1\n1\tb\t1\n";

  it("keeps original text and selects the complete qrels test split", () => {
    const data = parseDataset(corpus, queries, qrels);
    expect(data.corpus.get("a")!.text).toBe("Abstract A");
    expect(data.testQueries).toEqual(["1"]);
    expect(data.qrels.get("1")!.size).toBe(2);
    expect(data.queries.size).toBe(2);
  });

  it("rejects duplicate corpus IDs and duplicate relevance rows", () => {
    expect(() => parseDataset(`${corpus}\n${corpus}`, queries, qrels)).toThrow("duplicate ID");
    expect(() => parseDataset(corpus, queries, `${qrels}1\ta\t1\n`)).toThrow("Duplicate qrel");
  });

  it("rejects missing references, negative grades and empty positive judgments", () => {
    expect(() => parseDataset(corpus, queries, qrels.replace("1\ta", "3\ta"))).toThrow(
      "unknown ID",
    );
    expect(() => parseDataset(corpus, queries, qrels.replace("1\ta", "1\tmissing"))).toThrow(
      "unknown ID",
    );
    expect(() => parseDataset(corpus, queries, qrels.replace("\t1\n", "\t-1\n"))).toThrow(
      "invalid qrel",
    );
    expect(() => parseDataset(corpus, queries, "query-id\tcorpus-id\tscore\n1\ta\t0\n")).toThrow(
      "No positive qrels",
    );
  });
});
