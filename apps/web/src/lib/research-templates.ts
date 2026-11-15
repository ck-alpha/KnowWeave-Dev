export type ResearchTemplateId = "literature" | "comparison" | "decision";

export type ResearchTemplate = {
  id: ResearchTemplateId;
  label: string;
  description: string;
  pageType: "source" | "comparison" | "overview";
  content: string;
};

const DRAFT_NOTICE = "> 个人研究草稿：以下证据、局限与判断需要逐项核对；保存不代表已验证。";

/** Plain Markdown only. Templates never read or copy personal reading notes. */
export const RESEARCH_TEMPLATES: readonly ResearchTemplate[] = [
  {
    id: "literature",
    label: "文献阅读",
    description: "围绕一个研究问题，记录文献证据、方法与自己的理解。",
    pageType: "source",
    content: `${DRAFT_NOTICE}

## 研究问题

这份文献试图回答什么问题？它与我的课题有什么关系？

## 文献信息与来源

记录题名、作者、年份及原文链接；在保存时勾选实际使用的来源。

## 原文证据

逐条记录原文片段、来源及定位链接。尚未找到的证据请明确写“待补充”。

## 方法与局限

记录研究对象、方法、样本、适用条件，以及作者承认或自己发现的局限。

## 个人判断（待核对）

区分作者的结论与自己的推断，记录仍不确定之处。

## 下一步

- [ ] 核对原文及证据位置
- [ ] 寻找相反或补充证据
- [ ] 写下下一步阅读或实验任务
`,
  },
  {
    id: "comparison",
    label: "研究比较",
    description: "按相同问题和比较维度，整理多份研究的共识与分歧。",
    pageType: "comparison",
    content: `${DRAFT_NOTICE}

## 研究问题

需要比较哪些研究或方法？这次比较要支持什么判断？

## 比较对象与维度

记录各对象的现有 Wiki 链接、来源，以及可比较的指标和条件。

| 比较维度 | 研究 A | 研究 B | 证据来源与位置 |
| --- | --- | --- | --- |
| 研究对象与条件 | 待填写 | 待填写 | 待补充 |
| 方法与结果 | 待填写 | 待填写 | 待补充 |

## 原文证据与分歧

分别记录每份研究的原文证据、定位链接，以及共识或冲突。

## 局限与不可比之处

指出样本、指标、时间或实验条件的差异，不把缺少证据当作没有差异。

## 个人判断（待核对）

哪些解释得到证据支持？哪些只是个人推测？还缺什么证据？

## 下一步

- [ ] 核对各对象的原始研究
- [ ] 补充缺失的比较条件
- [ ] 记录可以检验分歧的阅读或实验任务
`,
  },
  {
    id: "decision",
    label: "决策记录",
    description: "记录选择的依据、代价与复核条件，保留当时的判断背景。",
    pageType: "overview",
    content: `${DRAFT_NOTICE}

## 研究问题与决策背景

需要作出什么选择？记录日期、目标、约束与参与讨论的人。

## 候选方案

记录各方案、预期收益、成本以及放弃其他方案的理由。

## 原文证据

列出支持或反对各方案的证据、实际来源及定位链接。

## 局限与风险

记录证据缺口、假设、不可逆代价及可能使决策失效的条件。

## 个人判断与暂定决策（待核对）

记录自己的权衡与暂定选择；区分已经观察到的事实和预期。

## 下一步与复核条件

- [ ] 核对关键证据与假设
- [ ] 写下执行任务和负责人
- [ ] 指定何时、出现什么新证据时重新评估
`,
  },
];

export type ResearchDraft = { title: string; content: string; type: string };

/** A template may fill an empty body, but must never replace a draft. */
export function prefillResearchTemplate(
  draft: ResearchDraft,
  templateId: ResearchTemplateId,
): ResearchDraft {
  if (draft.content.trim()) return draft;
  const template = RESEARCH_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return draft;
  return { ...draft, type: template.pageType, content: template.content };
}
