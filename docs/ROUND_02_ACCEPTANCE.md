# KnowWeave — Round 02 验收报告

日期：2026-10-17（Asia/Shanghai）。本机 Round 02 验收通过：三模式检索已进入实际 Wiki Query，官方原始 SciFact 全量对比已完成。当前结果不等于外部独立复现。

## 版本与证据

实现基线：`92ba903bfb230caabc2ac0458827a1257ca5fbcd`。测试和实验运行在其上的未提交实现工作树；评测源码指纹为 `8307895a7535d4af7fe6e74dc684b8a7c568f721b80b19a1a227da1e9538d446`，运行期间未变化，文件级 SHA256 保存在 [结构化结果](evidence/ROUND_02_RESULTS.json)。实现提交为 [`94464cce3859203a574527df5e7bac560be7b040`](https://github.com/ck-alpha/KnowWeave/commit/94464cce3859203a574527df5e7bac560be7b040)，已逐文件核对提交内容与上述评测指纹一致。其后的文档提交补记此 SHA；这不是重新运行实验，也不把工作树实测误写成当时已存在的 commit 上的运行。

仓库：[ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave)，private，交付分支 main；未设置或推送第三方远端。MIT LICENSE 原文保留，继承与独立改造边界见 [NOTICE](../NOTICE.md)。模型、原始数据、向量缓存、数据库、个人配置和完整本地证据不入 Git。

## 代码已实现

- [embedding.ts](../packages/llm/src/embedding.ts)：Ollama `nomic-embed-text:v1.5`，实际 tag/digest、文档/问题前缀、超时、维度/有限非零向量校验、`truncate:false`。
- [retrieval.ts](../packages/core/src/retrieval.ts) / [retrieval-store.ts](../packages/core/src/retrieval-store.ts)：每 Wiki SQLite Float32 向量、内容/模型指纹、精确余弦扫描、固定等权 RRF，增量刷新与强制重建。
- [query.ts](../packages/core/src/query.ts) → [Query API](../apps/web/src/app/api/query/route.ts) → [UI](../apps/web/src/app/query/query-view.tsx)：BM25 / Embedding / Hybrid 可切换；实际页面全文送 Qwen，返回正文 SHA256/字节数，保留可信引用和无证据路径。默认 BM25，无需向量服务；未就绪或服务异常不伪装为成功的 Hybrid。
- [索引 API](../apps/web/src/app/api/retrieval/route.ts)：GET 状态、POST 增量刷新、POST `{force:true}` 重建。页面创建/编辑/Ingest/删除/恢复及启动同步覆盖索引生命周期；过时内容立即失效，查询不重复生成文档向量。
- [benchmark-scifact.mts](../scripts/benchmark-scifact.mts)：直接复用产品检索核心评测原始标题/摘要；[在线脚本](../scripts/demo_retrieval.py) 和 [生命周期脚本](../scripts/verify-retrieval.mts) 可复现真实 Ollama 检查。
- README 补正为先 `scifact.py download` 再 `prepare`，后者不会自动下载。架构、进度、开发日志和审阅指南同步更新。

## 本机全量检索实测

正式运行：2026-10-17 **16:22:35–16:27:02**，总计 267.356 秒。官方原始 **5,183 篇 corpus、300 条 test queries、339 条 qrels**；`queries.jsonl` 总计 1,109 条，只有 test split 的 300 条参与评分。没有 Qwen 全量 Wiki 编译，没有摘要截断、子集替代或按 test 标签调参。

数据通过既有下载器按官方 ZIP MD5 `5f7d1de60b170fc8027bb7898e2efca1` 及解压后原文件逐字节核对；ZIP SHA256 为 `536e14446a0ba56ed1398ab1055f39fe852686ecad24a6306c80c490fa8e0165`。文件级指纹见结果 JSON，许可与来源见 [SciFact 说明](SCIFACT.md)。

模型 `nomic-embed-text:v1.5`（137M/F16），digest `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`，768 维。文档使用 `search_document: title\n\nabstract`，问题使用 `search_query: text`。请求 `num_ctx=8192`，实际 Ollama runner 报告 **2048**；不把请求值当成实生效值，`truncate:false` 保证超长输入报错，本次所有原文均成功。

三路使用同一输入与 qrels。BM25 为 SQLite FTS5 默认 tokenizer/权重、转义 OR、最多 64 词；每路候选 100，RRF k=60、等权、rank 从 1 开始，最终 top10；同分按 slug 排序。指标按 300 条 query 宏平均，未标注文献得分 0，正相关为 qrel>0，nDCG 使用线性 gain（本数据为二元相关），MRR 只计 top10 首个正相关位置。

| 模式 | Recall@10 | nDCG@10 | MRR@10 | p50 / p95（ms） |
| --- | ---: | ---: | ---: | ---: |
| bm25 | 0.791889 | 0.661625 | 0.624677 | 28.483 / 41.049 |
| embedding | 0.843556 | 0.703265 | 0.666762 | 390.821 / 429.459 |
| hybrid | 0.822722 | 0.703476 | 0.670402 | 420.761 / 451.159 |

Hybrid 三项均高于本次 BM25，但**召回低于纯 Embedding**；相比 Embedding，nDCG 仅高约 0.000212，未做显著性检验，不能宣称可靠或普遍优势。逐 query 召回比较为提高 13 条、相同 266 条、降低 21 条。固定 RRF 会把同时有词面和语义命中的候选向前排，也可能把仅向量召回的相关论文挤出 top10；这是对排名机制的解释，不是经过调参验证的改善方案。

延迟是独立进程中 `retrievePages` 的墙钟时间，Embedding/Hybrid 每次均实际生成问题向量（含 Ollama HTTP 调用），并读取/解码/扫描全部向量；复用模型元信息，不缓存问题向量。轮转三模式执行顺序；不含产品 Query API、Next.js 同步或 Qwen 回答生成。精确扫描有明确代价，不能把这些数值直接当作在线回答延迟。

首次建库：BM25 **4.997s**，5,183 个文档向量 **48.916s**。该轮在代码复审修复后主动中断，保留完整索引和失败/中断记录，不采纳其部分查询指标。正式完整重跑：BM25 重建 **9.802s**，复用全部 5,183 个向量、生成 0 个新文档向量，刷新 **45.413ms**。两次耗时口径分开，缓存复用不是首次建库速度。

运行环境：Node 22.23.3、pnpm 10.12.1、Ollama 0.34.4、Linux x64 / kernel 6.8.0-142-generic；Intel Xeon Gold 6530、16 个逻辑 CPU、约 31.3 GiB 内存。GPU 按系统报告为 NVIDIA RTX 4090、49,140 MiB、驱动 580.178.04；不推广为通常硬件配置或性能承诺。

完整结果本地路径：`.local/benchmarks/scifact/runs/2026-10-17T08-22-35-059Z/results.json`，SHA256 `3fe4eda2d7a8de69d70b514567955a87a62605f80a57709193ff134ef2959feb`。900 条排名的 SHA256 为 `f78bb1f3ab6f98e0800b59152a7902f90b131313e5073494bc2ae5d850b677e9`。另用 Python 标准库逐条重算指标、全量 query 覆盖、原始 corpus ID、p50/p95 与源码指纹，均一致。公开摘要不包含大排名文件；没有本地产物时哈希不能单独证明结论，应重新运行。

## 本机在线问答与索引实测

现有 Wiki 为 Round 01 的 3 页、2 个来源；三模式均真实调用 `qwen3.8:27b`。问题：

> Does elevated aldehyde dehydrogenase in breast tumours predict a favorable patient outcome?

三模式均回答“不支持，ALDH1 与 poor prognosis 相关”，引用 `[[aldh1]]`。API 核对每页实际供给正文 SHA256/字节数与持久化页面一致、引用属于检索和上下文；沿来源 UUID `0bfe3bbc-7b3a-4d9d-92c3-08d69c5d6f55` 追溯到原始 SciFact `corpus_id=45638119`，核验完整原文。三模式该问题的命中顺序相同，不将它描述为排名改善。

额外语义措辞 **“Unfavourable survival?”**：BM25 零命中并直接返回证据不足；Embedding/Hybrid 均取到 `aldh1` 并给出低置信、带引用的解释，说明 Wiki 没有独立定义该概念，但记录了较差预后的关联。额外无关问题 **“What orbital period does Neptune have?”**：Hybrid 虽返回近邻，Qwen 仍低置信说明资料不覆盖、空引用。空问题、无效 mode、JSON null 实际均 HTTP 400。

首次在线构建嵌入 3 页，紧接着刷新生成 0 个文档向量、复用 3 页。真实临时 Wiki 的 8 项生命周期检查通过：初建、语义措辞、重启复用、更新即时失效后只刷新 1 页、删除不再命中、启动同步外部修改、同 slug 跨 Wiki 隔离、模型缺失/服务离线时 BM25 仍可用。语料为测试用临时页面，该检查不调用 Qwen、不计入 SciFact benchmark。

Chromium 151 实际选择 Hybrid 并提交问题 → 点击正文 `aldh1` 引用 → Wiki → Sources → 完整 SciFact 原文，**2026-10-17 16:29:28–16:29:38 通过**；验证请求 mode、响应取证页、可点击引用和 corpus ID，浏览器 console/异常/资源错误为 0。第一次浏览器脚本误选隐藏的移动导航 details，等待展开超时；修正选择器后完整重跑通过，失败记录保留，不归因于产品故障。

## 工程检查

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | 退出 0；pnpm 提示忽略 esbuild 安装脚本，本机预编译二进制可用，tsx 评测和验证实际成功 |
| `pnpm test` | 24 个文件、266 项通过；1 项继承的云端 smoke 跳过，不计为通过 |
| `pnpm test:data` 的等价 Python unittest 命令 | 36 项通过 |
| `pnpm typecheck` | 所有工作区包及评测 scripts 通过；后加入生命周期脚本的 scripts tsc 也通过 |
| `pnpm lint` | 退出 0，仍有 2 条继承的 React Hooks 警告；包级 lint 有继承的 no-op |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | 生产构建退出 0，新增检索 API 编译成功 |
| 生产启动 | 旧启动器 SIGTERM 后释放 3000，新生产服务运行成功 |
| 指标审计、真实在线和生命周期 | 900 条排名复算一致；3 模式问答/来源、语义差异、无证据及 8 项生命周期通过 |
| 浏览器 | Hybrid 完整引用点击链通过，0 浏览器错误 |

新增测试覆盖向量失败/维度/超时、增量失效与恢复、推理过程中编辑防陈旧写入、同 Wiki 不同连接构建互斥、超过 1,100 词的正文真正进入模型上下文、空 Wiki 不调用模型、HTTP 输入与错误状态、评价公式及非法数据、在线验收不能把“有排名但没供给正文”误判成功。单元测试不是上述真实实验的替代品。

## 复现

Node 22 / pnpm 10.12.1 / Python 3.10+、本地 Ollama 和既有 Qwen 模型准备好后：

```bash
export PATH=/opt/knowwaeve-node/bin:$PATH  # 仅本服务器；其他机器使用自己的 Node 22
pnpm install --frozen-lockfile
ollama pull nomic-embed-text:v1.5
pnpm run doctor
pnpm setup:local
python3 scripts/scifact.py download
python3 scripts/scifact.py prepare
pnpm benchmark:scifact
pnpm exec tsx scripts/verify-retrieval.mts
pnpm test
pnpm test:data
pnpm typecheck
pnpm lint
NEXT_TELEMETRY_DISABLED=1 pnpm build
pnpm start
# 另一个终端：仅干净 Wiki 需要先导入样本；重复导入会新增来源
python3 scripts/demo_scifact.py --limit 2 --questions 1
python3 scripts/demo_retrieval.py
```

发布前将复现入口修正为 `pnpm run doctor`（避免调用 pnpm 内置同名命令），并澄清延迟包含 Ollama 问题向量 HTTP 调用；未重跑或修改历史 benchmark 数字。

在 Query 页面点击 **Build / refresh embedding index** 后选择模式，损坏缓存使用 **Rebuild all vectors**。HTTP 操作、隔离 Wiki 和远程端口转发见 [README](../README.md)。评测可用 `--data-dir`、`--cache-dir`、`--output-dir` 指定隔离路径；输出目录必须新建，以免覆盖失败证据。需要测首次建库时使用新的 `--cache-dir`；正常重复命令会复用有效向量。不要同时运行其他 GPU 请求来比较延迟。

## 未验证 / 未完成与下一轮

- Round 03 的完整用户路径稳定性专项、演示素材和公开发布准备未完成；当前仓库仍为私有。
- 中文/多语言专项、PDF/OCR、较大 Wiki 和并发负载未验证；本轮不加入新的向量数据库、登录或云部署。
- 精确向量扫描与解码为 O(Nd)，本次约 5 千篇的代价不可直接推广。构建锁仅覆盖同进程，未协调多个服务进程同时写一个 Wiki。
- 语义近邻没有校准相关性阈值，引用检查只证明引用来自实际供给正文，不证明科学结论。Hybrid 未全面超过纯 Embedding；若后续比较其他参数，应使用独立开发集或新基准，不能追着 test 标签调参。
- 完整正文超过 Qwen 预算会明确拒绝。更长文档需要下一轮设计可追溯的分块取证，而非恢复隐藏截断。
- Ingest 与 Chat 继续使用 BM25，本轮三模式接入独立 Query；云端 OpenRouter 路径未重新验证。

## Git 交付核对

实现与首版验收在上述实现提交中；后续文档提交记录该不可变 SHA。读取仓库时以 main 当前 HEAD 为交付入口，可执行 `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 核对本地/远端一致性。
