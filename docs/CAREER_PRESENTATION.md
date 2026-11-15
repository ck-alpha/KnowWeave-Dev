# KnowWeave 求职展示与面试提纲

更新：2026-11-12（Asia/Shanghai）。专题阅读与界面升级见 [产品升级记录](PRODUCT_UPGRADE.md)，模型与检索链路见 [Round 03 验收](ROUND_03_ACCEPTANCE.md)。指标引用 [Round 02 验收](ROUND_02_ACCEPTANCE.md)，不把小型 Demo 当成检索 benchmark，也不把检索相关性当成回答正确率。

AI 产品经理面试可直接使用 [5–8 分钟演示手册](INTERVIEW_DEMO.md)：附独立样例与启动命令、逐步点击和讲稿、3 分钟版本、产品追问、AI 辅助开发责任边界以及现场故障后备方案。

## 新版产品讲解补充

以科研或项目任务开场：“资料整理成 Wiki 后，用户还需要知道哪些值得读、正在读什么、为哪个课题服务，以及自己的判断是什么。”展示首页的继续阅读 → Workspace 专题 → Wiki 笔记与原文 → Query 引用回答 → Markdown 导出。这一轮把已有模型/检索能力连接成持续使用流程，功能审查与优先级来自源码和目标用户任务推导，未开展正式访谈。

开发岗可补充：“设计每 Wiki SQLite 的专题多对多关系和阅读记录，分离个人笔记与模型证据；通过事务校验、软删除 sidecar、同 slug 切库状态隔离及一致数据库快照，解决保存、撤销与导出的数据完整性问题。”可沿 [workspace.ts](../packages/core/src/workspace.ts)、[editor.ts](../packages/core/src/editor.ts)、[导出接口](../apps/web/src/app/api/wikis/export/route.ts) 解释。

产品岗可补充：“将工具入口式首页改为真实近期更新、继续阅读和待办；补齐按目标归类、馆藏筛选、阅读笔记与带引用导出的完整路径，并使用桌面/窄屏深浅色真实浏览器验收。”不要把人工演示页说成模型整理成果，也不要把通过的交互数量表述为用户效率提升。可用 `pnpm demo:workspace:prepare` 准备独立演示，详细命令见 README。

## 贡献边界与项目定位

KnowWeave 基于 MIT 项目 LLM Wiki。Next.js UI/API、Wiki 编译/更新、Markdown 存储、SQLite FTS5、来源关系和初版 Ollama 支持来自上游；本项目进一步实现本地 Qwen 配置与协议约束、向量索引生命周期、三路检索、引用校验和可复现评测。原作者与许可证完整保留，详情见 [NOTICE](../NOTICE.md)。

投递时按实际参与程度选择“实现”“负责”或“参与”，并能沿下方代码入口说明实现。不要写“从零开发完整知识管理系统”“自研大模型”“Hybrid 全面优于向量检索”或“准确率达到 84%”。

## Agent 应用开发岗版本

**KnowWeave｜本地知识整理与可追溯检索问答（二次开发）**

技术栈：TypeScript / Next.js / React / Node.js / SQLite FTS5 / Ollama / Qwen / Embedding / RRF / Python。

- 在 MIT LLM Wiki 基础上完成本地 Qwen/Ollama 适配：校验实际模型 tag，使用原生 `/api/chat` 配置上下文与输出预算，结合 JSON Schema 校验和来源约束，贯通原文 → Wiki → 引用问答。
- 为独立 Query 扩展 BM25、Embedding 和 Hybrid 三路检索，采用 Nomic 向量、精确余弦扫描与固定等权 RRF；在各 Wiki 的 SQLite 中持久化内容/模型指纹，实现更新失效、增量刷新、删除清理和异常时显式拒绝。Ingest 与 Chat 的候选检索仍为 BM25。
- 将检索页的实际正文供给 Qwen，记录正文 SHA256 与字节数，拒绝引用未供给的页面；保留回答 → Wiki → 原始来源链，并编写真实 API 演示与索引生命周期验证脚本。
- 复用产品检索核心，在 SciFact 原始 **5,183 篇文献 / 300 条 test queries** 上进行可复现对比：BM25 / Embedding / Hybrid 的 Recall@10 为 **0.791889 / 0.843556 / 0.822722**；明确报告 Hybrid 召回较低、延迟与缓存口径，不按 test 标签调参。

代码入口：[Ollama](../packages/llm/src/ollama.ts)、[向量协议](../packages/llm/src/embedding.ts)、[检索](../packages/core/src/retrieval.ts)、[索引存储](../packages/core/src/retrieval-store.ts)、[问答取证](../packages/core/src/query.ts)、[评测](../scripts/benchmark-scifact.mts)。

## AI 产品经理实习版本

**KnowWeave｜面向资料整理与核验的本地知识库原型**

用户问题：资料散落、重复阅读成本高，模型回答难以核对；需要持续补充知识并保留原始依据。该问题定位来自项目设计，未开展正式用户访谈或规模化用户研究。

- 将“导入资料后快速理解，并能回到原文核验”转化为明确流程：Sources 导入 → Qwen 整理 Wiki → 检索提问 → 点击引用 → 查原文；保留可编辑 Wiki，支持后续资料补充与纠错。
- 将检索模式和索引状态纳入交互：默认 BM25，Embedding/Hybrid 显式构建；页面变更后提示刷新，模型离线或索引失效时给出可执行说明，避免用户把过时结果当成成功检索。
- 区分“检索质量”和“回答质量”的验收：前者使用 SciFact 5,183/300 的 Recall、nDCG、MRR，后者通过真实导入、回答引用、正文指纹与原文追溯检查；未以检索指标宣称答案准确率。
- 据实验展示效果与成本的取舍：Embedding Recall@10 最高（0.843556），Hybrid 为 0.822722；两者 nDCG 约为 0.7033/0.7035，差异未经显著性检验。保留低依赖 BM25 与可选语义检索，优先完成可复现流程，暂缓云部署、复杂 Agent 和大规模索引。

本项目没有真实用户增长、留存、商业化或节省工时的量化实验，不编造这些指标。

## 一分钟讲解

- **0–15 秒：问题与方案。** “KnowWeave 是基于开源 LLM Wiki 二次开发的本地知识库。它先把资料整理成可更新的 Markdown Wiki，再检索回答，并保留回到原文的路径。”
- **15–35 秒：自己的改造。** “我的工作重点是本地 Qwen/Ollama 适配、BM25/Embedding/RRF 三路检索、更新后向量失效与增量刷新，以及引用来自实际供给正文的校验。”
- **35–50 秒：结果与取舍。** “在 SciFact 5,183 篇原文、300 条 test queries 上，Embedding 的 Recall@10 约 0.844，Hybrid 约 0.823。融合并没有全面领先，所以我保留完整对比，没有为了好看的数字调整 test 参数。”
- **50–60 秒：展示。** “现场可以从来源导入到回答引用，再点回原文；遇到未建索引或模型故障会明确提示。大型 Wiki、中文专项和 PDF/OCR 仍未验证。”

## 三分钟讲解

| 时间 | 讲解内容 | 可展示证据 |
| --- | --- | --- |
| 0:00–0:30 | 用户需要持续整理资料，也需要核对模型依据；说明上游基础与个人改造范围 | [README](../README.md)、[NOTICE](../NOTICE.md) |
| 0:30–1:10 | 原文经 Qwen 整理为 Wiki；Query 检索 Wiki 全文、生成回答、校验引用，最后回到原文 | [架构图](../architecture.md)、Query / Wiki 截图 |
| 1:10–1:50 | BM25 适合明确词项，Embedding 补充语义措辞；RRF 用名次融合；内容/模型指纹避免旧向量混用 | [retrieval.ts](../packages/core/src/retrieval.ts)、[retrieval-store.ts](../packages/core/src/retrieval-store.ts) |
| 1:50–2:30 | 展示原始 SciFact 指标、延迟口径与 Hybrid 的局限；小 Wiki Demo 验证产品链路，不能替代 benchmark | [Round 02 表格](ROUND_02_ACCEPTANCE.md)、[结果摘要](evidence/ROUND_02_RESULTS.json) |
| 2:30–3:00 | 演示索引刷新与引用追溯；解释精确扫描、显式刷新、有界上下文的工程取舍和未验证边界 | [Round 03 验收](ROUND_03_ACCEPTANCE.md)、[最终 Demo](../scripts/demo_round03.py) |

现场演示按 README 使用独立空 Wiki。优先展示 1 个可回溯的回答；语义措辞可作为第 2 个例子，不承诺模型每次生成相同页面或三路每次排名都不同。手工页面更新用于验证索引失效时，要明确它是手工编辑，不能说成模型自动合并的成果。

## 典型追问与真实代码位置

| 追问 | 回答要点 | 可核对位置 |
| --- | --- | --- |
| Wiki 与传统 RAG 有什么关系？ | Query 仍是检索增强生成；区别在于检索对象是可维护的 Wiki。Ingest 先用模型整理或更新知识，增加可读性，也引入整理错误风险，所以保留原始来源。 | [ingest.ts](../packages/core/src/ingest.ts)、[query.ts](../packages/core/src/query.ts)、[架构](../architecture.md) |
| 为什么同时保留 BM25 和 Embedding？ | BM25 利于术语/精确词匹配，依赖少、成本低；Embedding 可补语义改写。两者优势取决于任务；当前默认 BM25，语义模式需模型与有效索引。 | [db-pages.ts](../packages/core/src/db-pages.ts)、[retrieval.ts](../packages/core/src/retrieval.ts)、[语义小样本记录](ROUND_02_ACCEPTANCE.md) |
| RRF 怎么算，为什么不直接加原始分数？ | 两路原始分数尺度不同；每个候选按 `sum(1 / (60 + rank))` 融合，rank 从 1 开始，等权、各取最多 100 候选、最终 10 页，同分按 slug。参数预先固定。 | [reciprocalRankFusion](../packages/core/src/retrieval.ts)、[检索测试](../packages/core/src/retrieval.test.ts) |
| Hybrid 为什么召回反而低？ | 融合会重排；仅在向量路靠前的相关文献可能被共同命中的候选挤出 top10。此机制解释与观测一致，但未证明调某个参数就改善；应在独立开发集或新基准验证。 | [Round 02 验收](ROUND_02_ACCEPTANCE.md)：相对 Embedding，13 条 query 提高、266 条相同、21 条降低 |
| 页面改了，如何避免旧向量继续回答？ | 页面内容指纹变化即失效；查询检查完整性，提示刷新。构建前记录 hash，向量返回后再次比对，期间编辑/删除的旧结果不写回；模型 digest/前缀也进入模型键。 | [retrieval-store.ts](../packages/core/src/retrieval-store.ts)、[refreshEmbeddings](../packages/core/src/retrieval.ts)、[生命周期脚本](../scripts/verify-retrieval.mts) |
| 来源可追溯能保证回答正确吗？ | 只能保证引用属于实际供给页面，并能沿来源关系核对原文。正文 SHA256 证明取证内容一致，不证明模型推理正确、资料真实或科学结论有效。 | [query.ts](../packages/core/src/query.ts)、[page-view.tsx](../apps/web/src/components/wiki/page-view.tsx)、[在线检查](../scripts/demo_retrieval.py) |
| Recall、nDCG、MRR 各衡量什么？ | Recall@10 看相关文献覆盖；nDCG@10 看相关项的排名位置；MRR@10 看首个相关项的倒数排名。按 query 宏平均；qrels 表示相关性，不是支持/反驳标签，更不是答案事实准确率。 | [retrieval-metrics.ts](../scripts/retrieval-metrics.ts)、[benchmark-scifact.mts](../scripts/benchmark-scifact.mts)、[SCIFACT.md](SCIFACT.md) |
| 为什么不用独立向量数据库？ | 当前约 5 千原文基准规模下，SQLite 同库便于本地部署和生命周期一致性；代价是每次读取、解码、精确扫描 O(Nd)。更大集合需先测瓶颈，再考虑 ANN 等改造。 | [retrieval.ts](../packages/core/src/retrieval.ts)、[Round 02 延迟](ROUND_02_ACCEPTANCE.md) |
| 成本和延迟怎么量化？ | Round 02 检索 p50：BM25 28.483ms、Embedding 390.821ms、Hybrid 420.761ms；含问题向量的 Ollama HTTP 调用，不含产品 Query API、Next.js 同步或 Qwen 回答生成。增量构建复用未变页，查询只生成问题向量；本地运行也有硬件和电力成本，没有与云模型的同条件成本实验。 | [结果摘要](evidence/ROUND_02_RESULTS.json)、[检索核心](../packages/core/src/retrieval.ts) |
| 无证据、离线、长文档如何处理？ | BM25 零命中直接低置信返回，不调用生成模型；向量近邻不等于有证据，模型可低置信且无引用。索引或向量服务异常明确失败，用户可选 BM25；长正文超预算拒绝，避免隐藏截断。 | [query.ts](../packages/core/src/query.ts)、[retrieval API](../apps/web/src/app/api/retrieval/route.ts)、[ollama.ts](../packages/llm/src/ollama.ts) |
| 如何证明项目不是静态演示？ | 查看原始导入 API、页面/来源落盘、三模式实际请求、正文指纹、更新失效与增量刷新，再用浏览器点击原文。验收报告与截图只是证据入口，独立审阅者仍应运行脚本。 | [最终 Demo](../scripts/demo_round03.py)、[Round 03 验收](ROUND_03_ACCEPTANCE.md)、[独立审阅指南](GPT_REVIEW_GUIDE.md) |

## 指标引用备忘

| Round 02 模式 | Recall@10 | nDCG@10 | MRR@10 |
| --- | ---: | ---: | ---: |
| BM25 | 0.791889 | 0.661625 | 0.624677 |
| Embedding | 0.843556 | 0.703265 | 0.666762 |
| Hybrid | 0.822722 | 0.703476 | 0.670402 |

范围：英文 SciFact 官方原始标题/摘要，5,183 篇、300 条 test queries、339 条 qrels；本机一次完整正式实验。Hybrid 相比 Embedding 的 nDCG 仅高约 0.000212，未做显著性检验。报告中的首次向量构建 48.916 秒与后续 45.413 毫秒缓存刷新是不同操作，不能互相替代。
