# KnowWaeve

本地优先的 Agent 知识管理项目：文档 → Qwen Ingest → 可维护的 Markdown Wiki → 检索问答 → 原始来源。

基于 MIT 开源 [LLM Wiki](https://github.com/ddsyasas/llm-wiki) 二次开发；继承能力与本项目改造范围见 [NOTICE](NOTICE.md)，原作者许可见 [LICENSE](LICENSE)。产品名为 **KnowWaeve**，当前本地目录仍是 `KnowWeave`。

当前为 Round 01。使用 Ollama `qwen3.8:27b`；保留 SQLite FTS5/BM25 检索。Embedding、Hybrid、RRF 与全量评测留待 Round 02。

## 本地启动

需要 Node.js 22、pnpm 10.12.1、Python 3.10+，以及运行中的 Ollama 和已有 Qwen3.8 模型。

```bash
cd /home/linchengkai/KnowWeave
# 本次环境安装的 Node/pnpm 在此目录；其他机器使用自己的 Node 22 即可。
export PATH=/opt/knowwaeve-node/bin:$PATH
pnpm install --frozen-lockfile
pnpm doctor
pnpm setup:local
pnpm dev
```

打开 <http://127.0.0.1:3000>。`setup:local` 先读取 `/api/tags` 验证实际 tag，再将全部模型槽配置为 Ollama。它只初始化本项目 Wiki 设置；重新执行会将已有模型槽切回本地 Qwen3.8。默认 Wiki 是 `.local/wiki`，全局配置隔离在 `.local/config`，均不提交 Git。

在 Sources 粘贴一篇文档并 Ingest，然后到 Wiki 浏览页面，在 Ask/Query 提问；点击答案的 Wiki 引用，再点击 Sources 查看原文。

生产构建与运行：

```bash
NEXT_TELEMETRY_DISABLED=1 pnpm build
pnpm start
```

应用监听本机回环地址。Node 原生依赖首次安装可能需要 `make`、`g++`、Python 和 Linux 的 `libsecret-1-dev`。

## SciFact 小样本复现

保持应用运行，在另一终端执行：

```bash
python3 scripts/scifact.py prepare
python3 scripts/demo_scifact.py --limit 2 --questions 1
```

准备脚本自动下载并校验官方 ZIP，原始 5,183 篇 corpus、queries、test qrels 保存在 `data/scifact`；按固定规则生成 3 篇乳腺癌相关样本到 `data/scifact-demo`。演示默认只导入其中 2 篇，实际调用应用 Ingest 和 Query API，并核对 Wiki 引用、来源正文和原始 corpus ID。运行证据输出至 `.local/evidence/scifact-demo.json`，失败返回非零状态并记录原因。

重复运行会新增来源；需要独立重跑时使用新的 Wiki 目录，如 `KNOWWAEVE_WIKI_PATH="$PWD/.local/replay-wiki" pnpm dev --port 3001`，再给演示脚本加 `--base-url http://127.0.0.1:3001`。

这只是小型 Wiki 闭环演示，不是 SciFact 检索 benchmark；qrels 表示相关性，不代表支持声明。下载来源、许可、选择规则见 [SCIFACT.md](docs/SCIFACT.md)。

## 配置与排错

通过 shell 环境变量配置（`.env.example` 是示例，不会自动加载）：

| 变量 | 默认值 / 用途 |
|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434`，兼容末尾 `/v1` |
| `OLLAMA_MODEL` | `qwen3.8:27b`，setup/doctor 校验真实安装 tag |
| `OLLAMA_NUM_CTX` | `32768`，每请求本地上下文长度 |
| `OLLAMA_NUM_PREDICT` | `4096`，每请求最大生成长度 |
| `KNOWWAEVE_WIKI_PATH` | `.local/wiki`，绝对路径可覆盖 |
| `KNOWWAEVE_CONFIG_DIR` | `.local/config`，绝对路径可覆盖 |

使用模型自身的 262K 上下文在本次 CPU 环境曾触发 OOM。因此本地传输通过 Ollama 原生 `/api/chat` 限定上下文，并关闭 thinking；模型仍为原来的 `qwen3.8:27b`。GPU 修复后默认上下文为32768；请求按UTF-8字节数为文本token数保守估计并预留完整输出预算，过长请求明确拒绝，避免静默丢弃证据。大文档需缩小或明确调节上下文，不能把小样本验证理解为长文档保证。若出现驱动错误，请先运行 `nvidia-smi` 并检查 Ollama 日志；本次已通过重新加载磁盘上的580.178.04驱动模块修复版本错配，并实测100% GPU；未重装驱动或修改系统服务配置。

本轮验证文本导入。Ollama 不接受继承的 OpenRouter PDF 文件块协议；PDF 请先转换为文本/Markdown。问答只允许引用提供给模型的页面，但内容正确性仍需核对原文。

## 检查与开发记录

```bash
pnpm test
pnpm test:data
pnpm typecheck
pnpm lint
NEXT_TELEMETRY_DISABLED=1 pnpm build
```

- [工程现状与调用链](docs/PROJECT_OVERVIEW.md)
- [当前进度](docs/PROGRESS.md)
- [开发日志](docs/DEVLOG.md)
- [Round 01 验收报告](docs/ROUND_01_ACCEPTANCE.md)
- [数据来源与许可](docs/SCIFACT.md)

`docs/upstream/` 保存上游历史说明与截图，不作为 KnowWaeve 的实测证据。原始需求文件仍保留 AgentWiki 文件名；产品名以本 README 为准。

## Git 与远端

本项目使用独立本地 Git 仓库，未配置原作者远端。若尚无个人仓库，可自行创建空的 private 仓库后执行：

```bash
git remote add origin git@github.com:<你的账号>/KnowWaeve.git
git push -u origin main
```

数据、模型、缓存、数据库、密钥、私有文档和本地证据均不提交 Git；请保留原 MIT 许可和来源说明。
