# KnowWeave 项目架构

最后核对：2026-10-17（Asia/Shanghai）。当前实现范围：Round 01。
本文件是当前架构的统一入口；实现、接口或部署方式变化时，随代码在同一次提交中更新。
当前产品名与项目目录统一为 **KnowWeave**。`KNOWWAEVE_*` 环境变量及既有内部兼容名继续保留。

## 技术栈与入口

- Node.js 22、pnpm 10.12.1、TypeScript、Next.js 14 App Router、React 18。
- Markdown 保存原文、Wiki 页面、索引和日志；SQLite（better-sqlite3）保存来源/页面/会话元数据、来源关联、用量与响应缓存。其中页面元数据与 FTS5 索引可由 Markdown 同步重建，数据库应随 Wiki 一起备份。
- `apps/web` 是 UI 和 API；`packages/core` 是 Wiki 操作；`packages/ingestion` 是输入解析；`packages/llm` 是模型传输和响应校验。
- Python 3 标准库只用于数据准备和验收脚本，无常驻 Python 服务。
- `scripts/local.mjs` 是本项目启动入口，绑定 127.0.0.1，默认隔离到仓库 `.local/wiki` 与 `.local/config`。

```mermaid
flowchart LR
  A[SciFact 原始 corpus / queries / qrels] --> B[确定性小样本和 manifest]
  B --> C[POST /api/ingest]
  C --> D[core ingest + prompt + JSON schema]
  D --> E[Ollama qwen3.8:27b]
  E --> F[Markdown Wiki + SQLite FTS5 + page_sources]
  Q[用户问题] --> R[POST /api/query]
  F --> R
  R --> S[BM25 检索相关正文]
  S --> E
  E --> T[回答及 Wiki 引用]
  T --> U[Wiki sources → 原文 → SciFact corpus ID]
```

## 模块职责与依赖

| 模块 | 职责 | 主要入口 |
| --- | --- | --- |
| `apps/web` | 页面、HTTP API、当前 Wiki 和模型配置选择 | [API 路由](apps/web/src/app/api)、[Wiki 配置入口](apps/web/src/lib/server-wiki.ts) |
| `packages/core` | Ingest、Wiki 更新、检索问答、来源关系和持久化 | [ingest.ts](packages/core/src/ingest.ts)、[query.ts](packages/core/src/query.ts)、[db.ts](packages/core/src/db.ts) |
| `packages/ingestion` | 文本、URL 和文件解析，向核心流程提供输入 | [源码目录](packages/ingestion/src) |
| `packages/llm` | 模型调用、Ollama 协议适配、响应解析和错误处理 | [client.ts](packages/llm/src/client.ts)、[ollama.ts](packages/llm/src/ollama.ts) |
| `scripts` | 本地启动、SciFact 数据准备与真实 API 验收 | [local.mjs](scripts/local.mjs)、[scifact.py](scripts/scifact.py)、[demo_scifact.py](scripts/demo_scifact.py) |

Web 层调用工作区包完成业务；核心流程调用解析与模型模块。数据准备和演示脚本不是独立后端服务，演示脚本通过应用 HTTP API 验证完整流程。

## 已审阅的真实调用链

导入：`apps/web/src/app/api/ingest/route.ts` → `ingestPastedText` / `ingestSource`
（`packages/core/src/ingest.ts`）→ `buildIngestPrompt` → `callLLM` →
Zod `IngestResponseSchema` → `applyIngestResponse`。
写入 `raw/`、`wiki/*.md`、`index.md`、`log.md`；更新 `pages`、`pages_fts`、
`sources`、`page_sources`，来源 UUID 同时存入 Markdown frontmatter。

问答：`apps/web/src/app/api/query/route.ts` → `queryWiki`
（`packages/core/src/query.ts`）→ `searchPages` → `readPage` → `buildQueryPrompt` →
`callLLM` → `QueryResponseSchema` → 校验回答引用必须来自实际提供的正文。
API 返回 `pagesUsed`，UI 中 `[[slug]]` 可跳到 Wiki 页面，页面来源链接跳到原始文档。
原始内容 API 是 `/api/sources/[id]`，页面 API 是 `/api/pages/[slug]`。

模型：API 根据 `defaultModels` 的操作槽选择 provider/model；本轮默认全部为
`ollama` / `qwen3.8:27b`。`packages/llm/src/client.ts` 继续提供共享 OpenAI SDK 接口，
`ollama.ts` 将本地请求转换为 `/api/chat`，以支持每请求 `num_ctx=32768`、
`num_predict=4096`、`think=false`、`temperature=0`。保留真实模型 tag，无额外模型下载。
文本输入按UTF-8字节上界加输出预算检查，超过上下文时拒绝，避免静默截断证据。
JSON 仍经过已有解析、Zod 校验与重试逻辑；无付费 API 强制依赖。
OpenRouter 为继承的可选入口，必须显式设置对应 provider 与 Key 才使用。

## 运行与部署边界

当前部署中，Next.js 应用与 Ollama 运行在同一服务器。应用默认监听 `127.0.0.1:3000`，Ollama 默认监听 `127.0.0.1:11434`。电脑上的浏览器通过 VS Code Remote SSH 或 SSH 本地端口转发访问应用，具体操作见 [README](README.md)。

项目默认 Wiki 为 `.local/wiki`，隔离配置为 `.local/config`；它们以及下载数据、模型和个人运行证据不进入 Git。兼容配置变量、模型上下文预算与 PDF 限制见 README。当前应用没有用户登录与远程访问控制，端口转发是当前访问方式。

[`sync.ts`](packages/core/src/sync.ts) 的重建范围是页面元数据、FTS5 和同步状态；它不能恢复所有来源关联或用量记录。因此，不能将整个 SQLite 数据库视为可删除的缓存。

本机已验证 `qwen3.8:27b` 使用 GPU，驱动修复和测试摘要见 [验收报告](docs/ROUND_01_ACCEPTANCE.md) 与 [机器结果摘要](docs/evidence/ROUND_01_RESULTS.json)。这属于已验证部署环境，不能视为所有机器的硬件要求或性能承诺。

## 检索入口及 Round 02 接入点

- `packages/core/src/db.ts`：创建 `pages_fts`。
- `packages/core/src/db-pages.ts::indexPageForSearch`：页面内容索引；`searchPages` 使用 MATCH 和默认 BM25 `rank`。
- 本轮将全文问题的 AND 改成转义后的词项 OR，最多 64 个词，修复自然语言问题的空上下文问题；未引入向量检索。
- `query.ts` 的 `loadRelevantPages`、`ingest.ts` 的同名函数，以及 `chat.ts` 中的检索调用是后续统一检索接口的候选接入点。
- 更新/删除索引需覆盖 `ingest.ts`、`editor.ts`、`sync.ts` 的页面生命周期；后续向量索引必须同时覆盖这些入口。
- Wiki 页面检索与 SciFact 原始 corpus 检索是两个集合。Round 02 基准须从原始 corpus/queries/qrels 独立建索引，保持三种方法的集合与参数一致。

## 本轮边界与已知限制

本轮不实现 Embedding、Hybrid、RRF 或全量评测，不新增 MCP、GraphRAG、登录、云部署和数据库服务。
引用检查验证页面存在于模型上下文，不证明模型对文献的理解或科学结论正确，仍需阅读原文。
英文 SciFact 可用 FTS5 原始 tokenizer；中文分词、多语种检索尚未专项优化。
Qwen 的图片能力不等于接受 OpenRouter PDF 文件协议；本轮仅验证文本，小样本脚本不涉及 PDF/OCR。
模型导入不是事务性编译：网络失败会保留待重试的原始来源；重复演示会再新增来源。
项目通过仓库中的 `scripts/local.mjs` 启动；旧版 CLI/发布脚本已移出当前源码树。

代码来源、继承能力和独立改造范围见 [NOTICE](NOTICE.md)；本项目不宣称全部功能从零原创。
当前源码审阅顺序与验收代码映射见 [GPT 审阅指南](docs/GPT_REVIEW_GUIDE.md)。历史报告只描述指定提交和当时机器上的实测，不替代对当前 checkout 的独立验证。

## 持续维护约定

- 更改模块职责、调用链、HTTP 接口、数据格式、检索策略、模型协议或部署入口时，在同一次代码提交中更新本文件，并更新“最后核对”日期。
- 以当前源码为依据，列出真实入口；明确区分已实现行为、已知限制和未来接入点，不把计划写成现状。
- 重大技术决策同步记入 [开发日志](docs/DEVLOG.md)，完成范围同步到 [进度](docs/PROGRESS.md)。测试结果记录到对应验收报告，保留历史结果的时间与版本边界。
- 调整文件路径或接口后，核对本文件、README 与 [GPT 审阅指南](docs/GPT_REVIEW_GUIDE.md) 的链接和描述；架构变更的 PR 应说明影响与验证。
- `docs/PROJECT_OVERVIEW.md` 仅保留兼容入口，不维护第二份架构正文，避免两份描述不一致。

## 文档更新记录

| 日期（Asia/Shanghai） | 变更 |
| --- | --- |
| 2026-10-17 | 从工程概览迁移为根目录 `architecture.md`，整理模块职责、服务器访问边界和持续维护约定；当前业务范围仍为 Round 01。 |
