/** Macro-averaged, per-query retrieval metrics. Unjudged documents have gain 0. */
export interface RetrievalMetrics {
  recall: number;
  ndcg: number;
  mrr: number;
}

export function scoreRanking(
  rankedIds: readonly string[],
  qrels: ReadonlyMap<string, number>,
  k = 10,
): RetrievalMetrics {
  if (!Number.isInteger(k) || k < 1) throw new Error("Metric cutoff must be a positive integer");
  if (new Set(rankedIds).size !== rankedIds.length) throw new Error("Duplicate ranked document ID");
  const relevant: number[] = [];
  for (const relevance of qrels.values()) {
    if (!Number.isFinite(relevance) || relevance < 0) throw new Error("Invalid relevance grade");
    if (relevance > 0) relevant.push(relevance);
  }
  if (!relevant.length) throw new Error("Each evaluated query must have a positive qrel");
  let found = 0;
  let dcg = 0;
  let mrr = 0;
  rankedIds.slice(0, k).forEach((id, index) => {
    const relevance = qrels.get(id) ?? 0;
    if (relevance > 0) {
      found += 1;
      // Linear relevance gain agrees with trec_eval/BEIR nDCG. SciFact is binary.
      dcg += relevance / Math.log2(index + 2);
      if (mrr === 0) mrr = 1 / (index + 1);
    }
  });
  const idealDcg = relevant
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, relevance, index) => sum + relevance / Math.log2(index + 2), 0);
  return { recall: found / relevant.length, ndcg: dcg / idealDcg, mrr };
}

export function averageMetrics(rows: readonly RetrievalMetrics[]): RetrievalMetrics {
  if (!rows.length) throw new Error("Cannot average an empty query set");
  return {
    recall: rows.reduce((sum, row) => sum + row.recall, 0) / rows.length,
    ndcg: rows.reduce((sum, row) => sum + row.ndcg, 0) / rows.length,
    mrr: rows.reduce((sum, row) => sum + row.mrr, 0) / rows.length,
  };
}

/** Nearest-rank percentile, explicitly shared by every mode's latency report. */
export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Percentile requires nonempty finite nonnegative samples");
  }
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    throw new Error("Invalid percentile");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
}
