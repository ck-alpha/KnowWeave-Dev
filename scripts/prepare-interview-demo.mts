#!/usr/bin/env node
// Handwritten interview materials. Preparation never calls a model or downloads data.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_WIKI_SETTINGS,
  categoryForType,
  createSourceExcerpt,
  createWorkspaceCollection,
  getSource,
  initWikiFolder,
  insertSource,
  linkPageSource,
  openDb,
  readExcerptText,
  renderIndex,
  saveWikiSettings,
  syncWikiToDb,
  updatePageWorkspace,
  writeIndex,
  writePage,
  type PageType,
} from "../packages/core/src/index";

const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith("-")) {
  throw new Error("Usage: pnpm demo:interview:prepare [new-empty-directory]");
}
const output = resolve(args[0] ?? ".local/interview-demo");
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) {
  throw new Error("演示目录必须为空；请换一个新目录，不覆盖现有 Wiki 或已经排练的内容。");
}

const wikiPath = join(output, "fixture-wiki");
const configPath = join(output, "fixture-config");
const stamp = new Date().toISOString();
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const kind = "KnowWeave Interview Demo";
const sourceIds = {
  brief: "interview-project-brief",
  retrieval: "interview-retrieval-notes",
  engineering: "interview-engineering-notes",
  cloud: "interview-cloud-proposal",
  pending: "interview-pending-review",
};
const quotes = {
  lifecycle: "页面内容或模型身份变化后，旧向量不能继续作为有效索引使用；需要显式刷新。",
  personal: "阅读状态只记录个人进度，个人笔记与独立摘录批注不自动成为模型证据。",
};

const sources = [
  {
    id: sourceIds.brief,
    title: "项目简报：本地知识助手（人工演示）",
    text: `项目简报：本地知识助手\n\n人工编写的面试情景资料，不是用户访谈、真实客户项目或模型生成成果。\n\n问题\n资料散落在原文、阅读笔记和模型回答里，做技术选型时难以重新找到依据。这个虚构任务要求把技术资料整理为 Wiki，按专题阅读，再从回答回到原文。\n\n范围\n本地版面向一位使用者，在本机运行。用户按专题保存资料、阅读进度和个人判断。当前决定先完成可持续使用的资料到决策闭环，团队账户与云端协作另开专题讨论。\n\n工作流\n来源 → Wiki → 专题 → 阅读和个人笔记 → 检索问答 → 引用核验 → Markdown 复用。\n${quotes.personal}\n\n阶段决策\n先保留低依赖 BM25 入口，按需构建 Embedding 索引，Hybrid 作为可比较的第三种检索方式。没有证明哪种方式适用于所有问题。已读只表示阅读进度，不能解释成结论已经验证。\n`,
  },
  {
    id: sourceIds.retrieval,
    title: "检索选型备忘：BM25 / Embedding / Hybrid（人工演示）",
    text: `检索选型备忘\n\n人工整理的演示说明，以 KnowWeave 当前实现为背景；不是独立研究论文，不包含新的评测结果。\n\nBM25\nBM25 使用 SQLite FTS5，适合包含明确术语的问题。它无需 Embedding 模型，但命中页面后的回答生成仍需要 Qwen。中文分词没有专项验证；现场问题保留 BM25、Embedding、Hybrid 等原文术语，方便复现。\n\nEmbedding\nEmbedding 用 Nomic 表示问题和页面，以余弦相似度排序。KnowWeave 将 Float32 向量存于 SQLite，使用精确扫描。相似不等于证据支持，没有校准的相关性阈值。首次使用要显式构建索引。\n\nHybrid\nHybrid 使用等权 RRF 合并两路名次，避免直接相加不同尺度的原始分数。当前 k=60，每路最多100个候选，默认最终10页。融合改变排序，不保证所有问题的召回都提高。\n\n如何决策\n先用相同问题、相同专题比较命中与可追溯证据，再比较成本和延迟。人工样例只演示流程，不能输出检索准确率。SciFact 原始语料 benchmark 属于单独实验，其检索指标不能等同于答案正确率。\n`,
  },
  {
    id: sourceIds.engineering,
    title: "工程约束：索引、引用与本地运行（人工演示）",
    text: `工程约束与边界\n\n人工整理的面试情景资料，描述 KnowWeave 当前约束，不构成压力测试或安全认证。\n\nSQLite local deployment\n本地版使用 Next.js、Markdown 与每 Wiki 的 SQLite 数据库；启动监听回环地址。模型由 Ollama 提供。当前面向本机单用户，没有登录系统、云端部署或跨进程写入锁。同 Wiki 导入和向量构建的互斥只覆盖同一应用进程。不能把本地部署称为已经通过企业级安全审计。\n\n索引生命周期\n${quotes.lifecycle}\n正文指纹标识具体页面内容；模型身份参与向量索引身份。新增页面、编辑正文和变更模型后都要检查索引状态。刷新复用未改变的有效向量；旧结果不能因为还在数据库中就继续参与查询。BM25 是用户可以明确选择的入口，系统不应把失败的向量查询悄悄说成成功。\n\n引用边界\nQuery 从命中页面读取实际正文供给模型，记录正文 SHA256 与字节数。回答引用必须属于实际供给的页面，再由 Wiki 的来源关系找到原文。引用存在与正文一致不证明推理正确；仍需阅读原始资料。Graph 连线来自 Wiki 引用，节点距离不表示语义相似度。\n\n阅读与复用\n${quotes.personal}\n模板保存后的 Wiki 正文会参与检索；因此要把事实、假设和个人判断分开。专题阅读清单不是完整备份；Wiki ZIP 包括文档、raw 与数据库快照，但数据库和文件不是同一时点事务。\n\n下一轮验证\n中文真实任务、长文、PDF/OCR、大库精确扫描和多进程并发仍需专项验证。只有取得瓶颈数据，才讨论 ANN 或独立服务。\n`,
  },
  {
    id: sourceIds.cloud,
    title: "云端团队版提案（虚构对照，尚未实现）",
    text: `云端团队版提案\n\n这是一份专为范围隔离演示编写的虚构提案，不是 KnowWeave 已实现能力。\n\nSQLite local deployment 对照\n假设未来有一个50人团队需要公网访问、组织身份、角色权限和审计记录。这些是虚构目标需求，没有实现或压测数据。本地版的单用户部署不能直接满足这些要求。\n\n另一个专题\n团队版需要评估账户隔离、来源权限、并发编辑、备份与运维成本。不能将这里的50人目标冒充本地版并发能力，也不能用团队版提案回答仅限本地专题的问题。\n\n共同原则\n即使未来提供团队服务，也应保留回答 → Wiki → 原始来源的核验路径。是否采用独立向量服务必须根据容量和访问模式验证，不能仅因云端部署就认定必须拆分。\n`,
  },
  {
    id: sourceIds.pending,
    title: "补充评审：先验证，再扩展（待整理）",
    text: `补充评审：先验证，再扩展\n\n人工编写的面试演示增量资料，不是真实会议纪要。\n\n本次决定新增一个“下一轮验证清单”：先收集中文真实任务的问题与相关资料，分开评估检索命中、引用是否支持回答和用户是否能完成核验。不能把英文 SciFact 的检索指标当成中文问答准确率。\n\n先记录不同页面数量下 SQLite 精确向量扫描的耗时和内存，再决定是否引入 ANN。没有数据前不承诺大型库或多人并发。\n\n任何新增或编辑的 Wiki 页面都应检查向量索引状态。BM25 可以作为明确选择的检索模式，回答生成仍需要实际模型。\n\n请将这份补充资料整理为一篇简短的验证清单 Wiki，与已有 evaluation-plan 或 index-lifecycle 建立真实引用；保留人工情景资料的说明，不新增不存在的测试结果。\n`,
  },
];

type DemoPage = {
  slug: string;
  title: string;
  type: PageType;
  summary: string;
  sourceIds: string[];
  body: string;
  links: string[];
};
const pages: DemoPage[] = [
  {
    slug: "local-knowledge-assistant",
    title: "本地知识助手：从资料到决策",
    type: "overview",
    summary: "围绕一个技术选型任务，把零散资料、阅读判断与可追溯回答连接起来。",
    sourceIds: [sourceIds.brief],
    body: "## 要解决的问题\n\n做技术选型时，结论散落在文档、笔记和聊天记录里。这个人工任务需要在下一次讨论中找回依据，而不是重新问一遍模型。\n\n## 当前选择\n\n以本机单用户为边界，先完成资料 → Wiki → 专题阅读 → 引用问答 → 原文核验 → 导出复用。检索保留 BM25、Embedding 和 Hybrid 三种方式，选择需要由问题与证据决定。\n\n## 这次评审要回答\n\n1. 三种检索如何取舍？\n2. 页面变了，如何避免继续使用旧向量？\n3. 回答有引用，为什么仍要查看原文？",
    links: [
      "retrieval-comparison",
      "index-lifecycle",
      "evidence-chain",
      "reading-workflow",
      "decision-record",
    ],
  },
  {
    slug: "retrieval-comparison",
    title: "BM25 / Embedding / Hybrid 选型比较",
    type: "comparison",
    summary: "比较检索依赖、适用线索与局限；不预设融合一定更好。",
    sourceIds: [sourceIds.retrieval],
    body: "## 三种选择\n\n| 模式 | 本项目的行为 | 使用前提与局限 |\n| --- | --- | --- |\n| BM25 | SQLite FTS5 术语匹配 | 不需要向量模型；生成回答仍需 Qwen |\n| Embedding | Nomic 向量与精确余弦扫描 | 需要有效索引；相似不等于支持 |\n| Hybrid | 对两路名次做等权 RRF | 需要有效索引；融合不保证全面提升 |\n\n## 选择依据\n\n本地版默认 BM25，语义模式由用户主动选择。相同问题与专题下先核对原文，再看检索代价。现场样例不能用于声称准确率。\n\n## 与索引的关系\n\nEmbedding 与 Hybrid 使用内容和模型身份匹配的向量；页面改动后先刷新。BM25 仍可明确单独使用。",
    links: ["bm25", "embedding", "hybrid", "index-lifecycle", "evaluation-plan"],
  },
  {
    slug: "bm25",
    title: "BM25：从明确术语开始",
    type: "concept",
    summary: "低依赖的词项匹配入口；命中后的回答生成依旧需要模型。",
    sourceIds: [sourceIds.retrieval],
    body: "## 在本项目中的位置\n\nBM25 使用 SQLite FTS5 搜索 Wiki 页面，适合问题带有明确术语的场景。默认检索模式为 BM25，未构建向量时也能检索。\n\n## 不能混淆\n\nBM25 无需 Embedding 模型不代表整个问答离线：命中后的回答仍调用 Qwen。中文分词没有专项验证；面试问题保留 BM25、Embedding、Hybrid 等资料中的术语。\n\n## 现场核对\n\n观察实际被供给的页面与回答引用，再返回原文。检索分数只是候选排序，不能作为事实证据。",
    links: ["retrieval-comparison", "evidence-chain"],
  },
  {
    slug: "embedding",
    title: "Embedding：语义相似与有效索引",
    type: "concept",
    summary: "Nomic 向量补充语义检索，依赖内容与模型身份一致的有效索引。",
    sourceIds: [sourceIds.retrieval, sourceIds.engineering],
    body: "## 实现范围\n\nEmbedding 将问题与页面映射为向量。本项目使用 Nomic、SQLite Float32 存储与精确余弦扫描。首次运行需显式构建，页面改变后刷新。\n\n## 证据边界\n\n向量近邻总能找到相近页面，但相近不代表能回答问题。当前没有校准的相关性阈值，不能把近邻存在解释成事实充分。\n\n## 下一步\n\n先在真实中文任务与不同规模页面上测质量、耗时和内存，再决定分块或 ANN 改造。",
    links: ["retrieval-comparison", "index-lifecycle", "hybrid"],
  },
  {
    slug: "hybrid",
    title: "Hybrid：用名次融合两路检索",
    type: "concept",
    summary: "等权 RRF 合并 BM25 与向量名次，融合结果仍需独立验证。",
    sourceIds: [sourceIds.retrieval],
    body: "## 计算方式\n\nHybrid 将 BM25 与 Embedding 的排名做等权 RRF：每一路贡献 1 / (60 + rank)，rank 从1开始。每路最多100候选，默认最后10页。\n\n## 为什么使用名次\n\n两路原始分数尺度不同，不能直接解释为同一种概率。RRF 避开直接相加分数，但会改变候选顺序；因此不能承诺融合总比单路更好。\n\n## 展示重点\n\n同一问题切换模式，核对范围和引用。面试不要求三种答案固定相同，也不要求每次排名不同。",
    links: ["retrieval-comparison", "bm25", "embedding", "evaluation-plan"],
  },
  {
    slug: "index-lifecycle",
    title: "向量索引：更新后如何保持可信",
    type: "concept",
    summary: "内容或模型身份变化使旧向量失效，通过显式增量刷新恢复可用状态。",
    sourceIds: [sourceIds.engineering],
    body: `## 核心规则\n\n${quotes.lifecycle}\n\n## 一次可观察的变化\n\n新增或编辑 Wiki → 当前正文指纹改变 → Embedding / Hybrid 索引出现待更新页面 → 用户刷新 → 复用未改变向量，补齐变化页面。\n\n## 工程取舍\n\nBM25 可以由用户明确选用。系统不能把无效的语义索引悄悄当成完整结果。SQLite 精确扫描降低本地部署复杂度，但大型库性能与多进程并发仍需专项验证。`,
    links: ["embedding", "local-runtime", "evaluation-plan"],
  },
  {
    slug: "evidence-chain",
    title: "回答引用 → Wiki → 原始来源",
    type: "concept",
    summary: "引用必须来自实际供给正文，原始资料保留为进一步核验入口。",
    sourceIds: [sourceIds.engineering],
    body: "## 三层证据路径\n\nQuery 检索当前 Wiki 页面，读取实际正文并记录 SHA256 与字节数，再调用 Qwen。回答引用只能使用实际供给的页面。打开 Wiki 后，经来源关系继续读 raw 原文。\n\n## 能保证什么\n\n能核对引用属于哪些页面、当时供给了什么内容。引用存在不证明推理正确，原始资料本身也可能有局限。\n\n## 与图谱的关系\n\nGraph 连线来自现有 Wiki 引用，便于发现引用、被引和双向关系。节点距离不是语义相似度。",
    links: ["local-knowledge-assistant", "reading-workflow", "cloud-team-plan"],
  },
  {
    slug: "local-runtime",
    title: "Local deployment：本机单用户边界",
    type: "entity",
    summary: "Next.js、Markdown、SQLite 与 Ollama 组成当前本机单用户运行方式。",
    sourceIds: [sourceIds.engineering],
    body: "## SQLite local deployment\n\n本地版使用 Next.js、Markdown 与每 Wiki 的 SQLite 数据库，应用监听回环地址，模型由 Ollama 提供。当前部署面向本机单用户。\n\n## 并发与部署约束\n\n当前没有登录系统、云端部署或跨进程写入锁。同 Wiki 的导入与向量构建互斥只覆盖同一应用进程。团队版需求要独立评估，不能直接套用本地版结论。\n\n## 取舍\n\n本地存储减少额外服务，但不等同于已通过安全审计。大库、并发与备份时点一致性都有需要说明的边界。",
    links: ["index-lifecycle", "decision-record"],
  },
  {
    slug: "reading-workflow",
    title: "专题阅读：把个人判断单独留下",
    type: "concept",
    summary: "阅读状态、个人笔记和原文摘录分别保存，避免将个人判断自动当成证据。",
    sourceIds: [sourceIds.brief, sourceIds.engineering],
    body: `## 持续使用\n\n同一页面可加入多个专题。收藏帮助回访，待读、阅读中、已读记录进度，个人笔记保存疑问和下一步。\n\n## 个人记录的边界\n\n${quotes.personal}\n\n## 原文摘录\n\n在 UTF-8 文本原文选择片段，独立保存批注和专题。返回来源时依靠内容指纹与偏移核验位置；原文变化就显示失效，保留摘录快照。\n\n## 导出\n\n专题阅读清单包含成员与个人记录，用于讨论或复用；不含全部原文，不替代 Wiki ZIP 备份。`,
    links: ["evidence-chain", "decision-record"],
  },
  {
    slug: "evaluation-plan",
    title: "评估计划：区分检索与回答质量",
    type: "overview",
    summary: "人工样例验证产品流程，真实质量结论需要独立数据与清晰指标口径。",
    sourceIds: [sourceIds.retrieval, sourceIds.engineering],
    body: "## 本场 Demo 的目标\n\n验证能完成资料整理、专题问答、引用核验和导出。人工页面数量与通过的操作数不等于准确率或用户效率提升。\n\n## 独立测量\n\nBM25、Embedding、Hybrid 的检索质量看 Recall、nDCG、MRR；回答质量要另查原文支持、范围和推理。仓库已有 SciFact 原始语料实验，应按其报告范围说明，不能当成中文或端到端问答成绩。\n\n## 尚需验证\n\n中文真实任务、长文、PDF/OCR、大库性能和并发都需要专项工作。没有新的测量就不填写改善百分比。",
    links: ["retrieval-comparison", "evidence-chain", "index-lifecycle"],
  },
  {
    slug: "decision-record",
    title: "决策记录：先完成可核验的本地闭环",
    type: "source",
    summary: "保留三路检索和原文核验，依据后续真实任务数据再扩展服务与规模。",
    sourceIds: [sourceIds.brief, sourceIds.engineering],
    body: "## 人工情景中的决定\n\n先完成本机单用户闭环：默认 BM25，按需构建 Embedding，提供 Hybrid 比较，保留 Wiki 编辑与回答到原文的核验路径。\n\n## 依据与代价\n\nSQLite 与 Markdown 降低本地运行复杂度，代价是需要明确索引生命周期、单进程边界与备份时点限制。个人笔记单独保存，避免无意进入回答证据。\n\n## 再次评审的触发条件\n\n拿到中文真实任务与规模测量后再讨论分块、ANN、账户系统和云服务。本页是人工演示决策，不代表已经完成用户验证。",
    links: ["local-knowledge-assistant", "local-runtime", "evaluation-plan"],
  },
  {
    slug: "cloud-team-plan",
    title: "云端团队版：不同的部署约束",
    type: "overview",
    summary: "虚构的50人团队提案，展示跨专题资料不能被当成本地版现状。",
    sourceIds: [sourceIds.cloud],
    body: "## 虚构的另一项需求\n\nSQLite local deployment 对照：假设未来有50人团队需要公网访问、组织身份、角色权限和审计。这只是提案，当前没有实现或压测。\n\n## 范围隔离\n\n此页仅属于云端对照专题。查询本地专题时不应供给此页，也不能把50人目标描述为当前产品并发能力。\n\n## 共同原则\n\n仍要保留回答、Wiki 与原始来源的核验路径。是否拆分向量服务取决于容量与访问模式测量。",
    links: ["collaboration-requirements", "evidence-chain"],
  },
  {
    slug: "collaboration-requirements",
    title: "团队协作需求：权限与运维待评估",
    type: "concept",
    summary: "账户隔离、来源权限与并发编辑是虚构团队提案的待验证需求。",
    sourceIds: [sourceIds.cloud],
    body: "## 提案中的需求\n\n账户隔离、来源权限、并发编辑、备份和运维成本都需要独立设计。这里没有已完成的方案或效果数据。\n\n## 与本地版的关系\n\n本地单用户流程能帮助讨论证据核验，但不自动提供团队协作保障。不能把未来需求写成现有能力。",
    links: ["cloud-team-plan"],
  },
  {
    slug: "open-questions",
    title: "尚未验证的问题",
    type: "source",
    summary: "未建立 Wiki 关联的待整理页，用来演示发现全库未连接页面。",
    sourceIds: [sourceIds.engineering],
    body: "## 待验证清单\n\n- 中文真实任务的检索与回答表现。\n- 长文、PDF/OCR 与复杂原文定位。\n- 大型 Wiki 精确扫描成本。\n- 多进程并发与数据一致性。\n\n## 本页状态\n\n暂未加入专题，也尚未建立 Wiki 页面引用。它用于演示如何找到未连接页面；这不是一个已经完成研究的结论页。",
    links: [],
  },
];

await initWikiFolder(wikiPath);
await mkdir(configPath);
await saveWikiSettings(wikiPath, {
  ...DEFAULT_WIKI_SETTINGS,
  topic: kind,
  showCostEstimates: false,
  defaultModels: Object.fromEntries(
    ["ingest", "query", "chat", "lint", "vision"].map((slot) => [
      slot,
      { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "qwen3.8:27b" },
    ]),
  ) as typeof DEFAULT_WIKI_SETTINGS.defaultModels,
});
await writeFile(
  join(configPath, "config.json"),
  JSON.stringify(
    {
      version: 1,
      recentWikis: [wikiPath],
      activeWiki: wikiPath,
      uiTheme: "light",
      onboardingCompletedAt: stamp,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(wikiPath, "CLAUDE.md"),
  "# Wiki Schema — KnowWeave Interview Demo\n\n## Topic\n\n中文技术选型的人工面试情景资料。所有预置页面和来源都是人工演示材料，不是模型生成成果、真实访谈或新实验。\n\n## Style guidelines\n\n- 回答使用中文，保留 BM25、Embedding、Hybrid、SQLite 等术语。\n- 一个概念一页，使用 [[slug]] 建立真实关联。\n- 区分本地版当前约束、云端团队版虚构提案、尚未验证的计划。\n- 不编造数字、测试结果或模型能力；原始资料的人工样例说明应保留。\n- 来源通过来源ID关联，回答引用只能使用实际提供的 Wiki 页面。\n",
);
const sourcePaths: Record<string, string> = {};
for (const source of sources) {
  const path = join(wikiPath, "raw", `${source.id}.txt`);
  await writeFile(path, source.text, { flag: "wx" });
  sourcePaths[source.id] = path;
}
const titleBySlug = new Map(pages.map((page) => [page.slug, page.title]));
for (const page of pages) {
  for (const target of page.links) {
    if (!titleBySlug.has(target)) throw new Error(`Unknown demo link: ${page.slug} → ${target}`);
  }
  const references = page.links.length
    ? "\n\n## 继续阅读\n\n" +
      page.links.map((slug) => `- [[${slug}|${titleBySlug.get(slug)}]]`).join("\n")
    : "";
  await writePage(wikiPath, {
    slug: page.slug,
    frontmatter: {
      slug: page.slug,
      title: page.title,
      type: page.type,
      tags: [
        "人工演示",
        page.slug.startsWith("cloud-") || page.slug === "collaboration-requirements"
          ? "团队版提案"
          : "本地知识助手",
      ],
      sources: page.sourceIds,
      created: date,
      updated: date,
    },
    content: `# ${page.title}\n\n> 人工面试演示资料；不代表模型生成成果、真实客户需求或新的实验结论。\n\n${page.body}${references}\n`,
  });
}
await writeIndex(
  wikiPath,
  renderIndex(
    new Map(
      pages.map((page) => [
        page.slug,
        { category: categoryForType(page.type), summary: page.summary },
      ]),
    ),
  ),
);

const db = openDb(wikiPath);
const mainSlugs = pages.slice(0, 11).map((page) => page.slug);
const comparisonSlugs = ["evidence-chain", "cloud-team-plan", "collaboration-requirements"];
let collectionId = "";
let comparisonCollectionId = "";
let emptyCollectionId = "";
const excerptIds: string[] = [];
const collectionTitles = {
  main: "本地知识助手 · 技术选型",
  comparison: "云端团队版 · 对照方案",
  empty: "下一轮 · 用户研究",
};
try {
  await syncWikiToDb(wikiPath, db);
  for (const source of sources) {
    insertSource(db, {
      id: source.id,
      title: source.title,
      filename: `${source.id}.txt`,
      original_name: `${source.id}.txt`,
      format: "txt",
      size_bytes: Buffer.byteLength(source.text),
      added_at: stamp,
      // This marks fixture readiness, not model provenance; every source says it is handwritten.
      ingested_at: source.id === sourceIds.pending ? null : stamp,
      url: null,
    });
  }
  for (const page of pages) {
    for (const id of page.sourceIds) linkPageSource(db, page.slug, id);
  }
  emptyCollectionId = createWorkspaceCollection(db, {
    title: collectionTitles.empty,
    description: "待开展的用户研究；当前没有页面，不能当作已有访谈或用户验证。",
  }).id;
  comparisonCollectionId = createWorkspaceCollection(db, {
    title: collectionTitles.comparison,
    description: "人工虚构的团队版提案；50人是需求假设，不是当前产品并发能力。",
  }).id;
  collectionId = createWorkspaceCollection(db, {
    title: collectionTitles.main,
    description:
      "人工情景：为本机单用户知识助手选择检索与证据方案。先核对来源，再留下决策与下一步。",
  }).id;
  for (const page of pages) {
    updatePageWorkspace(db, page.slug, {
      collectionIds: [
        ...(mainSlugs.includes(page.slug) ? [collectionId] : []),
        ...(comparisonSlugs.includes(page.slug) ? [comparisonCollectionId] : []),
      ],
      starred: ["local-knowledge-assistant", "retrieval-comparison", "evidence-chain"].includes(
        page.slug,
      ),
      readingStatus: ["local-knowledge-assistant", "retrieval-comparison"].includes(page.slug)
        ? "reading"
        : ["bm25", "evidence-chain", "reading-workflow"].includes(page.slug)
          ? "reviewed"
          : "unread",
      note:
        page.slug === "retrieval-comparison"
          ? "个人判断：先用当前任务核对三路证据，不能只凭某次答案看起来完整就选择 Hybrid。下一步补中文任务样本。"
          : page.slug === "local-knowledge-assistant"
            ? "本次评审：讲清检索取舍、索引变化和原文核验。这里是个人阅读笔记，不自动供给模型。"
            : "",
    });
  }
  // Keep the intended entry at the top of the real continuation list.
  updatePageWorkspace(db, "local-knowledge-assistant", { readingStatus: "reading" });
  const engineeringSource = getSource(db, sourceIds.engineering)!;
  const original = await readExcerptText(wikiPath, engineeringSource);
  for (const [quote, annotation] of [
    [
      quotes.lifecycle,
      "个人批注：现场编辑 Wiki 后查看 pending，再刷新；不要把页面目录重建说成向量重建。",
    ],
    [quotes.personal, "个人批注：侧栏笔记与摘录批注保持独立；模板保存成 Wiki 后则会参与检索。"],
  ]) {
    const start = original.text.indexOf(quote!);
    if (start < 0) throw new Error("Demo excerpt is missing from its source.");
    const excerpt = await createSourceExcerpt(db, wikiPath, {
      sourceId: engineeringSource.id,
      quote,
      start,
      end: start + quote!.length,
      contentHash: original.contentHash,
      annotation,
      collectionIds: [collectionId],
    });
    excerptIds.push(excerpt.id);
  }
} finally {
  db.close();
}

const fixture = {
  kind,
  version: 1,
  synthetic: true,
  provenance:
    "All seeded pages, sources, reading records and excerpts are handwritten interview fixtures. No model was called during preparation.",
  wikiPath,
  configPath,
  configDir: configPath,
  createdAt: stamp,
  pages: pages.length,
  linksCount: pages.reduce((sum, page) => sum + page.links.length, 0),
  sources: sources.length,
  collectionId,
  comparisonCollectionId,
  emptyCollectionId,
  collections: {
    main: { id: collectionId, title: collectionTitles.main, pageSlugs: mainSlugs },
    comparison: {
      id: comparisonCollectionId,
      title: collectionTitles.comparison,
      pageSlugs: comparisonSlugs,
    },
    empty: { id: emptyCollectionId, title: collectionTitles.empty, pageSlugs: [] },
  },
  slugs: {
    overview: "local-knowledge-assistant",
    comparison: "retrieval-comparison",
    lifecycle: "index-lifecycle",
    evidence: "evidence-chain",
    runtime: "local-runtime",
    outside: "cloud-team-plan",
    isolated: "open-questions",
  },
  sourceIds,
  sourcePaths,
  excerptIds,
  quotes,
  pendingTextPath: sourcePaths[sourceIds.pending],
  questions: {
    main: "BM25 Embedding Hybrid 应该如何选择？为什么需要显式刷新向量索引？",
    scope: "SQLite local deployment 方案的部署范围和并发约束是什么？",
    noEvidence: "ZXQ2029 深海量子发动机的校准系数是多少？",
  },
  models: {
    generation: process.env.OLLAMA_MODEL ?? "qwen3.8:27b",
    embedding: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text:v1.5",
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  },
  links: {
    home: "/",
    workspace: `/workspace?collection=${collectionId}`,
    query: `/query?collection=${collectionId}`,
    graph: `/graph?collection=${collectionId}&node=local-knowledge-assistant`,
    overview: "/wiki/local-knowledge-assistant",
    comparison: "/wiki/retrieval-comparison",
    source: `/sources/${sourceIds.engineering}`,
    excerpt: `/sources/${sourceIds.engineering}?excerpt=${excerptIds[0]}`,
    pending: `/sources/${sourceIds.pending}`,
    emptyQuery: `/query?collection=${emptyCollectionId}`,
  },
};
await writeFile(join(output, "fixture.json"), JSON.stringify(fixture, null, 2) + "\n", {
  flag: "wx",
});
console.log(JSON.stringify(fixture, null, 2));
