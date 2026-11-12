"use client";

import { estimateCost, formatCostCents, formatTokens } from "@/lib/cost-estimate";

type Props = {
  text: string;
  model: string;
  /** Extra input tokens from system + index + relevant pages. */
  contextOverhead?: number;
  /** Typical response size for this operation. */
  expectedOutputTokens?: number;
};

export function CostPreview({ text, model, contextOverhead, expectedOutputTokens }: Props) {
  if (!text.trim()) {
    return <p className="text-xs text-muted-foreground">输入内容后，这里会显示用量估算。</p>;
  }
  const est = estimateCost(text, model, contextOverhead, expectedOutputTokens);
  return (
    <p className="text-xs text-muted-foreground">
      预计费用： <strong className="text-foreground">{formatCostCents(est.costCents)}</strong>{" "}
      <span className="tabular-nums">
        ({formatTokens(est.inputTokens)} 输入 / {formatTokens(est.outputTokens)} 输出)
      </span>{" "}
      · <code>{est.model}</code>
      {est.unknownPricing ? <span className="ml-1 italic">暂无此模型的价格信息</span> : null}
    </p>
  );
}
