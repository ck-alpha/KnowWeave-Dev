# KnowWeave

**把零散资料整理成可持续更新、能够回溯原文的本地知识库。**

KnowWeave 将文档交给本地 Qwen 整理为 Markdown Wiki，支持 BM25、Embedding 和 Hybrid 检索，再基于检索到的页面回答问题。回答中的 Wiki 引用可以继续跳到原始来源，方便检查模型依据、修正知识和追加资料。

这是基于 MIT 项目 [LLM Wiki](https://github.com/ddsyasas/llm-wiki) 的二次开发作品。本项目重点实现本地 Qwen/Ollama 适配、向量索引维护、混合检索、引用约束与可复现评测；继承能力和贡献边界见 [NOTICE](NOTICE.md)，原 [LICENSE](LICENSE) 保留。

[最终轮验收](docs/ROUND_03_ACCEPTANCE.md) · [公开前检查](docs/PRE_PUBLIC_CHECK.md) · [架构](architecture.md) · [求职展示与面试提纲](docs/CAREER_PRESENTATION.md) · [独立审阅指南](docs/GPT_REVIEW_GUIDE.md)

## 看一次实际使用

查询页面：选择检索模式，查看索引状态、回答和引用。

![KnowWeave 实际 Query 页面，展示检索模式、索引状态与带引用回答](docs/images/round03-query.png)

Wiki 页面：查看整理后的知识，并沿 Sources 返回原始文献。

![KnowWeave 实际 Wiki 页面，展示知识内容与原始来源入口](docs/images/round03-wiki.png)

截图来自本地应用的真实浏览器操作；另见 [原文追溯截图](docs/images/round03-source.png)。采集范围和验证记录见 [Round 03 验收](docs/ROUND_03_ACCEPTANCE.md)，演示只使用公开 SciFact 样本。

## 主要功能与实现范围

| 能力 | 当前行为 |
| --- | --- |
| 文档 → Wiki | Qwen 生成或更新 Markdown 页面；同名原文独立保存，失败来源可 Retry，保留页面来源关系 |
| 三路检索 | Query 可选 BM25、Embedding、Hybrid（RRF）；默认 BM25，无需 Embedding 模型 |
| 可维护向量索引 | 各 Wiki 独立存储；内容变化使旧向量失效，显式增量刷新，支持全量重建 |
| 回答与证据 | 实际页面正文进入模型上下文；引用须来自供给正文，支持 Wiki → 原始来源回溯 |
| 可复现评测 | SciFact 官方原始 corpus 的三路检索对比，与小型 Wiki 问答演示分开记录 |

三模式目前用于独立 Query；Ingest 和 Chat 的候选检索仍用 BM25。继承的文本导入、Wiki 浏览与更新构成本轮演示主路径，PDF/OCR 和云端模型不属于当前已验证能力。

## 架构与技术栈

```mermaid
flowchart LR
  D[原始文档] --> I[Ollama / Qwen Ingest]
  I --> W[Markdown Wiki + 来源关系]
  W --> S[SQLite FTS5 / 文档指纹]
  W --> E[显式增量构建 / Nomic Embedding]
  E --> V[SQLite 向量]
  Q[用户问题] --> R[BM25 / Embedding / RRF]
  S --> R
  V --> R
  R --> C[当前页面正文]
  C --> A[Qwen 回答 / 引用校验]
  A --> O[Wiki 引用 → 原始来源]
```

- **应用**：TypeScript、Next.js 14 App Router、React 18；Node.js 22、pnpm 10.12.1。
- **存储与检索**：Markdown、SQLite FTS5/BM25、Float32 向量精确余弦扫描、等权 RRF。
- **本地模型**：Ollama `qwen3.8:27b` 负责整理和回答；`nomic-embed-text:v1.5` 负责向量。
- **工程验证**：Vitest、Python 标准库验收脚本、复用产品检索核心的 TypeScript benchmark。

完整调用链、接口、磁盘格式和维护约定统一见 [architecture.md](architecture.md)。

## 最简启动

需要 Node.js 22、pnpm 10.12.1、Python 3.10+，以及运行中的 [Ollama](https://ollama.com/download)。本项目使用官方提供的 [Qwen3.8 27B tag](https://ollama.com/library/qwen3.8:27b)。若本机使用其他 tag，设置 `OLLAMA_MODEL` 为 `ollama list` 中的准确名称；`pnpm run doctor` 会核验 Ollama 服务与生成模型 tag，不检查 Nomic，也不会下载模型。

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
ollama pull qwen3.8:27b
ollama pull nomic-embed-text:v1.5
pnpm run doctor
pnpm setup:local
pnpm dev
```

已有模型无需再次下载。同名 tag 可随模型注册表更新；复现实验时应核对验收报告中的模型 digest。当前记录来自既有开发环境，未验证整台干净机器从零安装。

打开 <http://127.0.0.1:3000>，依次进入 **Sources → Ingest → Wiki → Query**。首次使用 Embedding/Hybrid，先在 Query 点击 **Build / refresh embedding index**。新增或编辑页面后再次刷新；失败时根据提示处理，或手动选择 BM25。

默认 Wiki 在 `.local/wiki`，配置在 `.local/config`，均不入 Git。`setup:local` 会将已有模型槽切回本地 Qwen；启动器监听本机回环地址。原生依赖首次编译可能需要 `make`、`g++`、Python 和 Linux 的 `libsecret-1-dev`。生产运行：

```bash
NEXT_TELEMETRY_DISABLED=1 pnpm build
pnpm start
```

VS Code Remote SSH 用户可转发端口 `3000`；也可在浏览器所在电脑运行 `ssh -N -L 13000:127.0.0.1:3000 <账号>@<服务器>`，再访问 `http://127.0.0.1:13000`。演示使用端口 `3001` 时相应调整转发端口。

## 可复现的最终 Demo

先下载并校验官方数据，再生成固定小样本。`prepare` 只读取已下载数据：

```bash
python3 scripts/scifact.py download
python3 scripts/scifact.py prepare
```

在独立 Wiki 运行演示，避免混入日常资料。终端一：

```bash
KNOWWAEVE_WIKI_PATH="$PWD/.local/round03-demo-wiki" pnpm dev --port 3001
```

终端二：

```bash
python3 scripts/demo_round03.py --base-url http://127.0.0.1:3001 \
  --wiki-path "$PWD/.local/round03-demo-wiki"
```

脚本要求 `--wiki-path` 与服务一致，且 Wiki 的页面和来源均为空；否则拒绝运行。默认导入 2 篇样本，分阶段构建/刷新索引，并核对 1 个问题的三模式回答、正文指纹和原始来源；还会显式手工编辑一次跨文档链接以验证索引失效与增量刷新，不将该编辑计作模型自动更新。输出为 `.local/evidence/round03/demo-<time>-<id>.json`，逐步操作见 [Demo 说明](docs/DEMO.md)，实际结果见 [最终轮验收](docs/ROUND_03_ACCEPTANCE.md)。重跑时为两个终端换用同一个新的 Wiki 目录，不覆盖个人 Wiki。

可选的真实浏览器复现需要系统 Chromium；若它不在 `PATH`，先设置 `CHROMIUM_PATH` 为可执行文件路径。在上面的 Demo Wiki 上继续运行：

```bash
node scripts/demo-browser.mjs --base-url http://127.0.0.1:3001 \
  --wiki-path "$PWD/.local/round03-demo-wiki"
```

该脚本首次通过浏览器导入第 3 篇样本，再浏览 Wiki、刷新索引、实际提交三模式问题并点击引用和原文，输出浏览器记录与三张截图。重跑会明确记录是否复用了第 3 篇来源；复用不计作新的导入验证。

打开 <http://127.0.0.1:3001/query>，可尝试以下两个问题，再点击回答中的 Wiki 引用与 Sources 链接核对原文：

1. `Does elevated aldehyde dehydrogenase in breast tumours predict a favorable patient outcome?`
2. `Unfavourable survival?`

Round 02 的真实小样本中，第一个问题三模式均找到 ALDH1；第二个问题 BM25 无词面命中，Embedding/Hybrid 找到较差预后的相关内容并给出低置信回答。这是历史样例现象，模型生成的 Wiki 和重复运行结果可能变化，不要求每次演示都出现排名差异。qrels 表示相关文献，不表示文献支持提问中的声明。数据来源和许可见 [SCIFACT.md](docs/SCIFACT.md)。

## Round 02 真实检索评测

2026-10-17 本机实测：**5,183 篇官方原始标题/摘要、300 条 test queries、339 条 qrels**。三路复用同一检索核心、输入和评价规则；未用 Qwen 改写 corpus，未按 test 标签调参。此表保留 Round 02 历史结果，Round 03 演示不替换该结果。

| 模式 | Recall@10 | nDCG@10 | MRR@10 | 检索 p50 / p95（ms） |
| --- | ---: | ---: | ---: | ---: |
| BM25 | 0.791889 | 0.661625 | 0.624677 | 28.483 / 41.049 |
| Embedding | 0.843556 | 0.703265 | 0.666762 | 390.821 / 429.459 |
| Hybrid（RRF） | 0.822722 | 0.703476 | 0.670402 | 420.761 / 451.159 |

**Hybrid 的 Recall 低于 Embedding；nDCG 差距极小，未做显著性检验，不能称为全面领先。** 延迟包含问题向量生成（含 Ollama HTTP 调用）与精确扫描，不含产品 Query API、Next.js 同步或 Qwen 回答生成；不能当成在线回答耗时。固定每路 100 候选、RRF `k=60`、最终 top10。硬件、模型 digest、索引代价和指标口径见 [Round 02 验收](docs/ROUND_02_ACCEPTANCE.md) 与 [结构化摘要](docs/evidence/ROUND_02_RESULTS.json)。

复现原始语料 benchmark：

```bash
python3 scripts/scifact.py download
pnpm benchmark:scifact
```

有效文档向量会按模型和内容指纹复用；首次建库与缓存复用耗时必须区分。完整运行产物和缓存留在 `.local/`。

## 技术取舍与限制

- **Wiki 是可编辑的知识层。** Ingest 先整理知识，Query 再检索页面；保留原文用于纠错。模型整理可能遗漏或误解，引用存在不等于科学结论正确。
- **SQLite 降低本地部署复杂度。** 向量检索采用 O(Nd) 精确扫描，未验证大型 Wiki 与高并发；同 Wiki 构建锁只覆盖同进程。
- **索引状态优先于静默回退。** 文档变更、模型不匹配或服务故障会阻止不完整的向量查询；BM25 仍可单独使用。纯向量近邻没有校准的相关性阈值，无证据问题仍需模型判断。
- **完整证据受上下文预算约束。** Qwen 使用有界上下文，超长正文明确拒绝；Embedding 使用 `truncate:false`。请求 8192 上下文不保证服务实际采用该值，Round 02 runner 实报 2048。
- **验证范围有限。** 当前英文 SciFact 检索指标不代表生成答案正确率或中文效果；中文/多语言、PDF/OCR、复杂长文分块、云端模型和压力测试未专项验证。未引入 MCP、GraphRAG、独立向量数据库、登录或云部署。

## 配置、检查与交付

通过 shell 环境变量配置；[.env.example](.env.example) 不会自动加载。

| 变量 | 默认值 / 用途 |
| --- | --- |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `qwen3.8:27b` |
| `OLLAMA_NUM_CTX` / `OLLAMA_NUM_PREDICT` | `32768` / `4096`，请求级输入上下文与输出上限 |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text:v1.5` |
| `OLLAMA_EMBED_NUM_CTX` / `OLLAMA_EMBED_TIMEOUT_MS` | `8192` / `120000`，向量请求上下文与超时 |
| `KNOWWAEVE_WIKI_PATH` / `KNOWWAEVE_CONFIG_DIR` | 默认 `.local/wiki` / `.local/config`，可设绝对路径隔离 |

历史拼写 `KNOWWAEVE_*`、内部 `@llm-wiki/*` 包名与 `.llm-wiki/` 磁盘格式为兼容保留。模型异常先运行 `pnpm run doctor` 并查看 Ollama 日志；`pnpm doctor` 是 pnpm 内置命令，不执行本项目检查。GPU 历史修复只记录在验收报告，不是通用安装步骤。

```bash
pnpm test
pnpm test:data
pnpm typecheck
pnpm lint
NEXT_TELEMETRY_DISABLED=1 pnpm build
```

Round 03 本机代码检查：299 项 JS/TS 与 47 项 Python 通过，1 项云端 smoke 跳过；typecheck、lint、build 成功，保留 2 条继承 Hooks 警告。逐项检查、真实浏览器操作和停止/重启结果见 [Round 03 验收](docs/ROUND_03_ACCEPTANCE.md)。这些结果来自报告所列工作树；独立复现仍应在自己的 checkout 运行上述命令。

- [当前进度](docs/PROGRESS.md) · [开发日志](docs/DEVLOG.md) · [独立审阅指南](docs/GPT_REVIEW_GUIDE.md)
- [Round 01 验收](docs/ROUND_01_ACCEPTANCE.md) · [Round 02 验收](docs/ROUND_02_ACCEPTANCE.md) · [Round 03 要求](docs/KnowWeave_ROUND_03_CODEX_PROMPT.md)
- [Agent 开发 / AI 产品经理简历描述与面试材料](docs/CAREER_PRESENTATION.md)

交付仓库为 [ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave)，保持 **private**，分支 `main`。审阅私有仓库需要读取授权或源码包。数据、模型、缓存、SQLite、密钥、个人文档与完整本地运行日志不提交；仓库保留必要证据摘要和经检查的公开样本截图。
