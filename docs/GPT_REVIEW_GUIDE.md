# KnowWeave 独立审阅与 Round 01 验收指南

本指南帮助审阅者从源码、测试、运行产物和需求逐项判断 Round 01 是否满足要求。**不能仅凭 README、验收报告或本指南中的“通过”就直接判定通过。** 文档是待核对的项目陈述，结论应说明已经检查的证据、缺口和无法验证的部分。

当前展示名与目标个人仓库名为 **KnowWeave**。历史名称兼容说明见 README；`KNOWWAEVE_*` 环境变量、内部包名和已有磁盘路径为兼容保留。需求文档已归档并统一当前名称，原有验收要求实质不变。

## 获取仓库与阅读顺序

个人仓库：[ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave)，为 private 独立仓库，`main` 是代码与文档交付入口。审阅方必须具有读取授权；仅提供普通 URL 不保证 GPT 能读取。可为审阅工具授权读取私有仓库，或向审阅者提供不含数据、密钥和本地配置的源码包。

建议按以下顺序阅读：

1. [README](../README.md)：产品范围、启动、远程访问和复现命令。
2. [三轮计划](THREE_ROUND_PLAN.md) 与 [Round 01 需求](ROUND_01_REQUIREMENTS.md)：核对本轮验收边界；当前项目名以最新说明为准。
3. [NOTICE](../NOTICE.md) 与 [LICENSE](../LICENSE)：区分继承能力、本轮独立改造及许可，不把已有 UI/Ingest 等说成完全原创。
4. [工程架构](PROJECT_OVERVIEW.md)：真实调用链与检索接入位置，再沿下表阅读源码。
5. [SciFact 数据流程](SCIFACT.md)：原始数据、固定选择规则、manifest、数据许可和样本边界。
6. [验收报告](ROUND_01_ACCEPTANCE.md) 与 [历史证据摘要](evidence/ROUND_01_RESULTS.json)：核对运行日期、模型、样本、结果和原始产物哈希。
7. [开发日志](DEVLOG.md)、[当前进度](PROGRESS.md) 及 Git 历史：查阅决策、故障、修复、未实现事项，并确认当前代码相对历史验收提交的变化。

历史实现提交为 `395747308fb0f888702f224c6be5e3eeefa491ca`；历史验收补充提交为 `4620b8c34040be64404541ffd8160f95310fec6f`。提交标题中的旧名属于历史事实。审阅新 checkout 时应记录 `git rev-parse HEAD`，不能默认它与历史验收提交完全相同。

## 验收条件到代码的映射

| 要核对的条件 | 主要源码与检查入口 | 验收重点 |
| --- | --- | --- |
| 本地启动、隔离配置、实际模型 tag，无强制云端 Key | [scripts/local.mjs](../scripts/local.mjs)、[server-wiki.ts](../apps/web/src/lib/server-wiki.ts)、[local-launcher.test.ts](../tests/local-launcher.test.ts)、[wiki-selection.test.ts](../tests/wiki-selection.test.ts) | `doctor/setup/start` 行为、回环监听、active Wiki 与显式路径模式、启动器停止后是否释放端口 |
| Ollama/Qwen 请求真正使用本地模型并限制上下文 | [client.ts](../packages/llm/src/client.ts)、[ollama.ts](../packages/llm/src/ollama.ts)、[ollama.test.ts](../packages/llm/src/ollama.test.ts)、[models.ts](../packages/llm/src/models.ts) | 原生 `/api/chat`、真实 tag、`num_ctx/num_predict/think`、输入预算、JSON 校验；不能只看 UI 上的模型名称 |
| 添加原文、Ingest、生成或更新 Wiki、保存来源关系 | [Ingest API](../apps/web/src/app/api/ingest/route.ts)、[ingest.ts](../packages/core/src/ingest.ts)、[schema.ts](../packages/core/src/schema.ts)、[ingest.test.ts](../packages/core/src/ingest.test.ts) | Markdown 页面确实落盘，SQLite 与 frontmatter 记录来源；原文保存有标题包装，不可将转换后的字节误当输入原始哈希 |
| 检索问答与可检查引用 | [Query API](../apps/web/src/app/api/query/route.ts)、[query.ts](../packages/core/src/query.ts)、[db-pages.ts](../packages/core/src/db-pages.ts)、[query.test.ts](../packages/core/src/query.test.ts)、[db.test.ts](../packages/core/src/db.test.ts) | FTS5 MATCH/BM25、转义 OR 词项、无命中返回证据不足、拒绝不在模型上下文中的引用；这些检查不自动证明答案正确 |
| 回答 → Wiki → 原始来源的 UI/API 链 | [query-view.tsx](../apps/web/src/app/query/query-view.tsx)、[page-view.tsx](../apps/web/src/components/wiki/page-view.tsx)、[Source API](../apps/web/src/app/api/sources/[id]/route.ts)、[Source 页面](../apps/web/src/app/sources/[id]/page.tsx) | 引用可点击、来源 UUID 一致、原文完整且可对应原始 corpus ID；HTTP 200 本身不算闭环 |
| 官方 SciFact 获取与确定性小样本 | [scifact.py](../scripts/scifact.py)、[test_scifact.py](../tests/test_scifact.py)、[SCIFACT.md](SCIFACT.md) | 官方 ZIP 校验、解压安全、原始文件保留、固定选择与 query/corpus/qrels 溯源，不提交下载数据 |
| 真实闭环验收不会误报成功 | [demo_scifact.py](../scripts/demo_scifact.py)、[test_demo_scifact.py](../tests/test_demo_scifact.py) | 预校验输入、`ok/applied`、真实页面内容、Source ID/完整正文哈希、当前问题正相关 qrels、非空带引用回答、失败退出码、本机请求绕过外部代理 |
| 测试/构建/版权/提交可核对 | [package.json](../package.json)、[pnpm-lock.yaml](../pnpm-lock.yaml)、[NOTICE](../NOTICE.md)、[LICENSE](../LICENSE)、验收报告与 Git 历史 | 区分测试通过与跳过，检查锁文件与构建，确认许可和改造边界；检查数据、模型、个人数据库等未入库 |

## 历史实测、可复现命令与证据边界

2026-10-17 的历史验收记录如下，不能自动等同于当前 checkout 已重新通过：

| 项目 | 已记录结果 | 审阅时应保留的限制 |
| --- | --- | --- |
| JavaScript/TypeScript 测试 | 19 个测试文件，**210 项通过、1 项跳过** | 跳过项是需要 OpenRouter Key 的云端 smoke；不是成功验证云端路径 |
| Python 测试 | **30 项通过** | 使用离线 fixture/mocks；不凭单元测试推断真实下载和模型调用已经完成 |
| typecheck | llm/core/ingestion/web 通过 | 当前改动仍需重新执行 |
| lint | 退出 0，**2 条 React Hooks 警告** | 包级 lint 仍有继承的 no-op，不能描述为零警告或全项目完整静态扫描 |
| 生产 build | Next.js 14.2.35 构建通过，18 个静态页面生成 | 构建通过不等于运行时业务闭环通过 |
| 真实 API 演示 | 2 篇导入，生成 3 页，并完成一次页面更新及 query 51 问答 | 小样本、单次机器环境；来源 UUID、哈希和计时见验收报告 |
| Chromium | 5 个页面检查及问答 → 引用 → 原文操作链通过 | 已观测 0 console.error/未捕获异常/资源错误，不代表全 UI 覆盖 |
| 停止/重启 | SIGTERM 后释放 3000，重启主要页面/API 返回 200 | 与独立进程管理测试一起核对，不能只凭启动日志 |

另有 **2026-10-17 15:42（Asia/Shanghai）交付前复测**：整理后的工作树重新得到 210 项通过 / 1 项跳过、Python 30 项通过，typecheck/lint/build 退出 0（lint 仍有 2 条警告）；5 条 HTTP 路由使用新标题 KnowWeave，Chromium 页面复测 5 项通过、错误 0，既有 Wiki 的真实 GPU 问答引用 `aldh1`。证据摘要的 `remote_delivery_recheck` 与验收报告单独记录该轮结果。它是同一开发环境的后续实测，不能说成外部审阅者的独立验证，也不能替代历史首次导入与完整 UI 链记录。

完整原始日志、截图和机器状态存在本地 `.local/evidence/`，不会随仓库提供。[仓库内证据摘要](evidence/ROUND_01_RESULTS.json) 整理历史运行结果与产物 SHA256，便于追踪与比对；它**不是一次新的独立复现**。没有原文件时，哈希不能让审阅者重新算验，也不能单独证明事件发生。只有源码访问时，应将相关机器级结论标为“历史记录，尚未独立复核”，不要把“未复核”改写为失败或已经实测通过。

可在具有 Node/pnpm/Python 的独立环境先运行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm test:data
pnpm typecheck
pnpm lint
NEXT_TELEMETRY_DISABLED=1 pnpm build
```

具备 Ollama 和对应模型时，再按 README 的 `doctor → setup:local → start` 与 SciFact 演示流程检查真实闭环。记录自己的命令、HEAD、环境、退出码和输出；没有 GPU/Ollama/网络条件时，明确未验证的环节，不编造运行结果。复现演示会新增原文来源，宜使用独立 Wiki 目录。

## GPU 与数据范围

GPU 历史证据需综合查看 `nvidia-before.txt`、`nvidia-after.txt`、`ollama-gpu-ps.txt`、GPU 探针 JSON，以及应用 API 记录的模型与 usage；对应摘要见证据 JSON。报告记录驱动模块/库从不匹配恢复到 580.178.04、Ollama 66/66 层 GPU 和 `100% GPU`。硬件名称与显存按系统输出记录，不能由一次探针推导通常硬件规格或对所有机器有效的性能保证。

预热探针 29 个输出 token / 0.629 秒只是连通性检查。应用导入 5.606 秒、6.423 秒和问答 2.446 秒是本次样例的 API 与校验耗时，不能推广为吞吐指标或 GPU 相比 CPU 的提升百分比。

原始 SciFact 包含 5,183 篇 corpus、1,109 条 queries，test split 为 300 条 query、339 条 qrels。固定规则准备 3 篇文献，历史实际导入前 2 篇。query 51 的声明应被证据反驳；正相关 qrel 不等于文献支持该声明。应读原文验证回答，而不是只看 `confidence`、引用数量或模型自述。

本轮没有全量 nDCG@10、Recall@10、MRR@10，没有检索提升比例，也没有公平比较 BM25/Embedding/Hybrid。将来比较必须使用同一原始 corpus/queries/qrels，不能用模型重写的小型 Wiki 代替 SciFact 原始基准。

## 独立审阅应输出什么

- 明确审阅的提交 SHA、能读取的文件、实际执行的命令与尚未具备的运行条件。
- 按验收条件分别给出“已验证 / 有历史证据但未独立复核 / 不满足 / 证据不足”，并附源码位置或实际运行输出。
- 对真实缺陷说明触发条件、影响和最小修复；检查关键失败路径，特别是无证据回答、无引用回答、来源丢失、损坏数据和只返回 HTTP 200 的假成功。
- 对源码来源、许可证、数据许可和原创范围单独核对，不把继承能力计作本项目完全独立开发成果。
- 将本轮缺陷与下一轮计划分开，避免因文档写了计划就声称功能已实现。

**Round 02 尚未实现**：Embedding、向量索引及更新、RRF、Hybrid 检索与公平全量评测。MCP、GraphRAG、复杂多 Agent、登录、云服务和微服务不属于本轮交付。只有审阅者确认 Round 01 的必要条件满足后，才应进入下一轮开发。
