# KnowWeave 仓库分离与公开源码交付

日期：2026-10-17（Asia/Shanghai）。本次只处理仓库分离、发布整理及验证，没有新增业务功能。

## 仓库与版本

| 用途 | 仓库 | 可见性 | GitHub 仓库 ID |
| --- | --- | --- | --- |
| 原开发仓库 | [ck-alpha/KnowWeave-Dev](https://github.com/ck-alpha/KnowWeave-Dev) | Private | 1423077083 |
| 新源码仓库 | [ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave) | Public，非 Fork | 1423288657 |

公开初始提交：[`0db60428e3a65eab79c222fb46e5c68f690202da`](https://github.com/ck-alpha/KnowWeave/commit/0db60428e3a65eab79c222fb46e5c68f690202da)，无父提交，公开历史只有这一条提交。author/committer 均为 `ck-alpha <245089297+ck-alpha@users.noreply.github.com>`。

导出基线：[`29a34ff6bc76a68ba727f628727d5493d7102bfe`](https://github.com/ck-alpha/KnowWeave-Dev/commit/29a34ff6bc76a68ba727f628727d5493d7102bfe)。开始时本地 main、origin/main、远端 main 完全一致；唯一未跟踪文件为用户提供的本次任务文件，无未提交源码或未推送提交。该任务原文只随私有交付保存。

原工作区目录名仍为 `KnowWeave`，fetch/push origin 均为 `https://github.com/ck-alpha/KnowWeave-Dev.git`；相邻独立快照工作区 `KnowWeave-Public` 的 fetch/push origin 均为 `https://github.com/ck-alpha/KnowWeave.git`。各自只有 origin，main 仅跟踪自己的 origin/main，没有交叉 remote/upstream。本文所在私有交付提交只追加文档；最新 SHA 以其远端 main 和最终交付回复为准。

## 发布范围与整理差异

通过已提交文件白名单逐文件导出，没有复制原 `.git` 或完整工作目录。公开共 **226 个文件**：apps 117、packages 74、scripts 11、tests 10、根目录 14。

- 排除整个 docs/、.github/、根 AGENTS.md、CLAUDE.md、architecture.md 及开发/贡献/安全流程文档；没有历史截图、验收表、证据 JSON、任务 Prompt、私人 Wiki、数据、数据库、模型或运行产物。
- README 重写为功能、调用链、安装配置、使用、测试和独立 benchmark；NOTICE 保留上游 LLM Wiki/Yasas、继承/改造边界与 SciFact 数据许可。LICENSE 与源基线逐字节一致。
- 保留 `packages/core/src/prompts/` 等产品运行时提示词，以及用户 Wiki 的 CLAUDE.md 格式；这些不是开发 Agent 指令。
- 只在公开副本纠正五处页面/设置文案中的旧轮次、已删除过程文档指引和三模式“未来工作”描述，没有改业务逻辑。
- 通用演示命名改为 `scripts/demo_wiki.py`、`tests/test_demo_wiki.py`、`pnpm demo:wiki`，修正引用。演示/检索验证产物分别留在 `.local/evidence/wiki-demo/`、`retrieval/`、`browser/`；没有携带旧运行结果。
- .gitignore 移除历史流程注释；应用 .gitignore 清理末尾空行。少量源码注释去除轮次措辞；锁文件仅删除两条第三方包弃用说明的联系邮箱句子，版本、依赖关系、完整性 hash 不变，冻结安装再次成功。
- 原私有工作区的 README/docs 历史提交链接和证据中的仓库 URL 更新为 KnowWeave-Dev，SHA/指标/结论不变。产品包信息、User-Agent、UI LICENSE/NOTICE 链接仍指公开 KnowWeave，作为产品公开入口；它们不控制 Git 推送目标。

## 实际验证

环境：本机 Node 22.23.3、pnpm 10.12.1、Python 3.13.12；安装使用已有 pnpm store，不等同于干净机器或空缓存从零安装。

| 命令/检查 | 本次结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 退出 0，739 包从现有 store 复用；锁文件元数据整理后再次冻结安装退出 0 |
| `pnpm test` | 299 通过、1 个云端 smoke 因无 Key 跳过 |
| `pnpm test:data` | 47 通过，含改名后的 Demo 契约测试 |
| `pnpm typecheck` | 退出 0 |
| `pnpm lint` | 退出 0，保留 command-palette/vault-graph 两条既有 Hooks 警告；包级 no-op 不代表完整扫描 |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | 退出 0，生产构建完成 |
| benchmark / demo:wiki / scifact 的 `--help` | 均退出 0，新入口可执行 |
| README/NOTICE 相对链接 | 13 处有效，无 docs/ 或 architecture.md 悬空链接 |
| `git diff --cached --check` | 通过 |

独立匿名验证已完成：

- 禁用 Git 系统/全局配置、credential helper 和交互认证，从 GitHub 克隆到相邻 `KnowWeave-Public-Verify`；HEAD 与公开初始提交一致，226 文件、1 个 commit，无 alternates，全部 10 个私有历史 commit 对象均不存在。
- 使用 `curl -q`，不携带 Authorization/Cookie，TLS 校验开启：公开仓库 HTTP 200，私有 KnowWeave-Dev HTTP 404。首次 urllib 遇 TLS EOF，切换 curl 重试成功，未关闭证书校验。
- 在该克隆移除继承的 `NODE_TLS_REJECT_UNAUTHORIZED` 环境覆盖后，冻结安装与生产构建均退出 0；安装复用全部 739 个缓存包。构建仅两条既有 Hooks 警告，完成后工作树干净。
- 私有文档 167 处相对链接存在；两份历史 evidence JSON 仅仓库 URL 变更，其余结构和值完全一致。

源码内少量历史设计文档名仍作为注释、测试名称保留，不依赖被排除的 docs/ 目录，也不是公开的验收结果或开发 Prompt。

## 历史与隐私隔离

检查全部 226 个暂存文件，并逐个核对初始提交 blob 的 SHA256 与已扫描清单一致；扫描私人 home 路径、邮箱、私有仓库地址、私钥、令牌、认证 URL 和原私有仓库 10 个提交的 SHA/非 noreply 身份。未发现真实凭据或私人身份。唯一认证 URL 命中是 `tests/test_demo_wiki.py` 拒绝测试中的虚构 localhost 用户名/密码，已人工核实并记录；无未解决发现。这是规则扫描与人工复核结果，不作绝对无泄漏保证。

公开提交无父提交、无对象 alternates；对原私有 10 个 commit 逐一执行对象存在性检查，公开仓库均不含这些 commit。没有复制或推送旧分支/tag；MIT 版权声明未变。原私有仓库 ID 不变、原有提交仍可达，没有删除、强推、改写历史或改变其可见性。

完整安装/测试/构建日志、白名单基线、逐文件 SHA256、整理差异、扫描与匿名访问证据只保存在私有工作区忽略目录 `.local/evidence/public-release/`，不提交公开仓库。

本次未重新跑真实 Qwen/SciFact Demo、完整 benchmark、浏览器交互或独立索引生命周期专项；没有复用历史报告冒充本次运行。干净机器/空缓存安装、云端、PDF/OCR、中文/多语言、大型 Wiki 与并发压力仍未验证。

## 公开文件完整清单

以下与公开初始提交的 `git ls-files` 一致；运行或构建生成的忽略文件不在此清单内。

```text
.env.example
.gitignore
.nvmrc
.prettierignore
.prettierrc.json
LICENSE
NOTICE.md
README.md
apps/web/.eslintrc.json
apps/web/.gitignore
apps/web/components.json
apps/web/next.config.mjs
apps/web/package.json
apps/web/postcss.config.mjs
apps/web/public/favicon.svg
apps/web/public/logo-hero.svg
apps/web/public/logo.svg
apps/web/src/app/about/page.tsx
apps/web/src/app/api/chats/[id]/messages/route.ts
apps/web/src/app/api/chats/[id]/route.ts
apps/web/src/app/api/chats/folders/route.ts
apps/web/src/app/api/chats/route.ts
apps/web/src/app/api/config/route.ts
apps/web/src/app/api/config/test/route.ts
apps/web/src/app/api/index/route.ts
apps/web/src/app/api/ingest/apply/route.ts
apps/web/src/app/api/ingest/route.ts
apps/web/src/app/api/lint/fix/route.ts
apps/web/src/app/api/lint/history/route.ts
apps/web/src/app/api/lint/route.ts
apps/web/src/app/api/onboarding/route.ts
apps/web/src/app/api/pages/[slug]/backlinks/route.ts
apps/web/src/app/api/pages/[slug]/delete/route.ts
apps/web/src/app/api/pages/[slug]/restore/route.ts
apps/web/src/app/api/pages/[slug]/route.ts
apps/web/src/app/api/pages/route.ts
apps/web/src/app/api/query/route.ts
apps/web/src/app/api/retrieval/route.ts
apps/web/src/app/api/schema/route.ts
apps/web/src/app/api/settings/route.ts
apps/web/src/app/api/sources/[id]/delete/route.ts
apps/web/src/app/api/sources/[id]/retry/route.ts
apps/web/src/app/api/sources/[id]/route.ts
apps/web/src/app/api/sources/route.ts
apps/web/src/app/api/usage/route.ts
apps/web/src/app/api/wikis/export/route.ts
apps/web/src/app/api/wikis/health/route.ts
apps/web/src/app/api/wikis/pages/route.ts
apps/web/src/app/api/wikis/route.ts
apps/web/src/app/chats/[id]/loading.tsx
apps/web/src/app/chats/[id]/page.tsx
apps/web/src/app/chats/layout.tsx
apps/web/src/app/chats/page.tsx
apps/web/src/app/dashboard/page.tsx
apps/web/src/app/developers/page.tsx
apps/web/src/app/globals.css
apps/web/src/app/graph/loading.tsx
apps/web/src/app/graph/page.tsx
apps/web/src/app/help/page.tsx
apps/web/src/app/layout.tsx
apps/web/src/app/lint/lint-view.tsx
apps/web/src/app/lint/loading.tsx
apps/web/src/app/lint/page.tsx
apps/web/src/app/loading.tsx
apps/web/src/app/local-models/page.tsx
apps/web/src/app/log/loading.tsx
apps/web/src/app/log/page.tsx
apps/web/src/app/page.tsx
apps/web/src/app/query/page.tsx
apps/web/src/app/query/query-view.tsx
apps/web/src/app/schema/page.tsx
apps/web/src/app/schema/schema-editor-view.tsx
apps/web/src/app/settings/page.tsx
apps/web/src/app/sources/[id]/loading.tsx
apps/web/src/app/sources/[id]/page.tsx
apps/web/src/app/sources/loading.tsx
apps/web/src/app/sources/page.tsx
apps/web/src/app/sources/sources-view.tsx
apps/web/src/app/wiki/[slug]/history/page.tsx
apps/web/src/app/wiki/[slug]/loading.tsx
apps/web/src/app/wiki/[slug]/page.tsx
apps/web/src/app/wiki/layout.tsx
apps/web/src/app/wiki/loading.tsx
apps/web/src/app/wiki/page.tsx
apps/web/src/components/app-header.tsx
apps/web/src/components/app-shell.tsx
apps/web/src/components/chats/chat-view.tsx
apps/web/src/components/chats/promote-message.tsx
apps/web/src/components/chats/sidebar.tsx
apps/web/src/components/command-palette.tsx
apps/web/src/components/cost-preview.tsx
apps/web/src/components/dashboard/switch-wiki-button.tsx
apps/web/src/components/footer.tsx
apps/web/src/components/graph/vault-graph.tsx
apps/web/src/components/loading-skeleton.tsx
apps/web/src/components/onboarding.tsx
apps/web/src/components/page-shell.tsx
apps/web/src/components/settings/about-tab.tsx
apps/web/src/components/settings/api-tab.tsx
apps/web/src/components/settings/costs-tab.tsx
apps/web/src/components/settings/general-tab.tsx
apps/web/src/components/settings/models-tab.tsx
apps/web/src/components/settings/wikis-tab.tsx
apps/web/src/components/sidebar-layout-wrapper.tsx
apps/web/src/components/sources/sources-list.tsx
apps/web/src/components/theme-provider.tsx
apps/web/src/components/theme-toggle.tsx
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/input.tsx
apps/web/src/components/ui/textarea.tsx
apps/web/src/components/wiki-switcher.tsx
apps/web/src/components/wiki/history-diff-view.tsx
apps/web/src/components/wiki/markdown-view.tsx
apps/web/src/components/wiki/page-editor.tsx
apps/web/src/components/wiki/page-view.tsx
apps/web/src/components/wiki/sidebar.tsx
apps/web/src/components/wiki/undo-delete-banner.tsx
apps/web/src/lib/cost-estimate.ts
apps/web/src/lib/ingest-result.ts
apps/web/src/lib/server-config.ts
apps/web/src/lib/server-wiki.ts
apps/web/src/lib/use-wiki-settings.ts
apps/web/src/lib/utils.ts
apps/web/tailwind.config.ts
apps/web/tsconfig.json
package.json
packages/core/package.json
packages/core/src/chat.test.ts
packages/core/src/chat.ts
packages/core/src/config.test.ts
packages/core/src/config.ts
packages/core/src/db-chats.ts
packages/core/src/db-pages.ts
packages/core/src/db-sources.ts
packages/core/src/db-sync.ts
packages/core/src/db-usage.ts
packages/core/src/db.test.ts
packages/core/src/db.ts
packages/core/src/editor.test.ts
packages/core/src/editor.ts
packages/core/src/graph.test.ts
packages/core/src/graph.ts
packages/core/src/index-builder.test.ts
packages/core/src/index-builder.ts
packages/core/src/index.ts
packages/core/src/ingest.test.ts
packages/core/src/ingest.ts
packages/core/src/links.test.ts
packages/core/src/links.ts
packages/core/src/lint-fixes.ts
packages/core/src/lint.test.ts
packages/core/src/lint.ts
packages/core/src/prompts/chat.ts
packages/core/src/prompts/ingest.ts
packages/core/src/prompts/lint.ts
packages/core/src/prompts/query.ts
packages/core/src/query.test.ts
packages/core/src/query.ts
packages/core/src/retrieval-store.ts
packages/core/src/retrieval.test.ts
packages/core/src/retrieval.ts
packages/core/src/schema.ts
packages/core/src/secrets.test.ts
packages/core/src/secrets.ts
packages/core/src/sync.test.ts
packages/core/src/sync.ts
packages/core/src/templates.ts
packages/core/src/types.ts
packages/core/src/version.ts
packages/core/src/wiki.test.ts
packages/core/src/wiki.ts
packages/core/tsconfig.json
packages/ingestion/package.json
packages/ingestion/src/detect.ts
packages/ingestion/src/docx.ts
packages/ingestion/src/html.ts
packages/ingestion/src/image.ts
packages/ingestion/src/index.ts
packages/ingestion/src/ingestion.test.ts
packages/ingestion/src/markdown.ts
packages/ingestion/src/pdf.ts
packages/ingestion/src/plain.ts
packages/ingestion/src/pptx.ts
packages/ingestion/src/types.ts
packages/ingestion/src/url.ts
packages/ingestion/src/xlsx.ts
packages/ingestion/tsconfig.json
packages/llm/package.json
packages/llm/src/client.test.ts
packages/llm/src/client.ts
packages/llm/src/embedding.test.ts
packages/llm/src/embedding.ts
packages/llm/src/errors.ts
packages/llm/src/index.ts
packages/llm/src/models.test.ts
packages/llm/src/models.ts
packages/llm/src/ollama.test.ts
packages/llm/src/ollama.ts
packages/llm/src/smoke.test.ts
packages/llm/tsconfig.json
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/benchmark-scifact.mts
scripts/demo-browser.mjs
scripts/demo_retrieval.py
scripts/demo_scifact.py
scripts/demo_wiki.py
scripts/local.mjs
scripts/retrieval-metrics.ts
scripts/scifact-dataset.ts
scripts/scifact.py
scripts/tsconfig.json
scripts/verify-retrieval.mts
tests/local-launcher.test.ts
tests/query-api.test.ts
tests/retrieval-api.test.ts
tests/retrieval-metrics.test.ts
tests/source-api.test.ts
tests/test_demo_retrieval.py
tests/test_demo_scifact.py
tests/test_demo_wiki.py
tests/test_scifact.py
tests/wiki-selection.test.ts
tsconfig.base.json
tsconfig.json
vitest.config.ts
```
