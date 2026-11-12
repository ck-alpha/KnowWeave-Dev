"use client";

import { useEffect, useState } from "react";

type BreakdownRow = {
  model: string;
  operation: "ingest" | "query" | "lint" | "chat";
  call_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
};

type UsageResponse = {
  breakdown: BreakdownRow[];
  totals: {
    cost_cents: number;
    calls: number;
    input_tokens: number;
    output_tokens: number;
  };
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function fmtCost(cents: number): string {
  if (cents === 0) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function CostsTab() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as UsageResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (error) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">加载中…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Cumulative usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          查看当前 Wiki 已记录的模型调用、Token 用量与费用。统计会随知识库保存在本地。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="调用次数" value={data.totals.calls.toString()} />
        <Metric label="输入 Token" value={fmtTokens(data.totals.input_tokens)} />
        <Metric label="输出 Token" value={fmtTokens(data.totals.output_tokens)} />
        <Metric label="已记录费用" value={fmtCost(data.totals.cost_cents)} />
      </div>

      {data.breakdown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          还没有模型调用记录。导入资料或完成一次问答后，这里会显示统计。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">模型</th>
                <th className="px-3 py-2 font-medium">操作</th>
                <th className="px-3 py-2 text-right font-medium">次数</th>
                <th className="px-3 py-2 text-right font-medium">输入</th>
                <th className="px-3 py-2 text-right font-medium">输出</th>
                <th className="px-3 py-2 text-right font-medium">费用</th>
              </tr>
            </thead>
            <tbody>
              {data.breakdown.map((r, i) => (
                <tr key={`${r.model}-${r.operation}-${i}`} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                  <td className="px-3 py-2 capitalize">{r.operation}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.call_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(r.total_input_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(r.total_output_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtCost(r.total_cost_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        费用根据本地价格表记录；没有价格记录或费用为零时显示 <code>—</code>。Token
        用量按模型服务返回值统计。
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
