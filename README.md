# KnowWeave

本地优先的 Agent 知识管理项目：文档 → Qwen Ingest → 可维护的 Markdown Wiki → 检索问答 → 原始来源。

当前完成 Round 01：使用 Ollama `qwen3.8:27b` 跑通文本导入、Wiki 生成与更新、带来源的问答；保留 SQLite FTS5/BM25 检索。Embedding、Hybrid、RRF 与全量评测尚未实现，属于 Round 02。

代码许可与来源说明：[LICENSE](LICENSE) · [NOTICE](NOTICE.md)。项目继承能力及本轮独立改造范围以 NOTICE 为准。

## 本地启动

需要 Node.js 22、pnpm 10.12.1、Python 3.10+，以及运行中的 Ollama 和实际安装的 Qwen3.8 模型。

```bash
cd /home/linchengkai/KnowWeave
# 本次服务器的 Node/pnpm 安装路径；其他机器使用自己的 Node 22 即可。
export PATH=/opt/knowwaeve-node/bin:$PATH
pnpm install --frozen-lockfile
pnpm doctor
pnpm setup:local
pnpm dev
```

本机浏览器打开 <http://127.0.0.1:3000>。`setup:local` 先读取 Ollama `/api/tags` 核对模型 tag，再把全部模型槽配置为 Ollama。重新执行会将已有模型槽切回本地 Qwen3.8。默认 Wiki 为 `.local/wiki`，全局配置隔离在 `.local/config`，均不提交 Git。

在 Sources 粘贴文档并 Ingest，到 Wiki 浏览生成页面，再在 Query 提问。点击回答中的 Wiki 引用，然后点击页面的 Sources 链接查看原文。

生产构建与运行：

```bash
NEXT_TELEMETRY_DISABLED=1 pnpm build
pnpm start
```

应用默认只监听本机回环地址。Node 原生依赖首次安装可能需要 `make`、`g++`、Python 和 Linux 的 `libsecret-1-dev`。

## 访问远程服务器上的页面

使用 VS Code Remote SSH 时，在已连接服务器的 VS Code 终端执行：

```bash
code --openExternal http://127.0.0.1:3000
```

也可在 VS Code 的 Ports 面板转发服务器端口 `3000`，再打开对应的本地地址。

不使用 VS Code 时，在**浏览器所在电脑**的终端建立 SSH 隧道，替换账号和服务器地址：

```bash
ssh -N -L 13000:127.0.0.1:3000 <服务器账号>@<服务器地址>
```

保持该 SSH 终端运行，在本机浏览器打开 <http://127.0.0.1:13000>。服务器上的应用仍监听 `127.0.0.1:3000`；本机的 `13000` 由隧道转发到它。

## SciFact 小样本复现

保持应用运行，在另一个终端执行：

```bash
python3 scripts/scifact.py prepare
python3 scripts/demo_scifact.py --limit 2 --questions 1
```

准备脚本自动下载并校验官方 ZIP，原始 5,183 篇 corpus、queries 和 qrels 保存在 `data/scifact`；按固定规则生成 3 篇乳腺癌相关样本到 `data/scifact-demo`。演示默认导入其中 2 篇，实际调用 Ingest 和 Query API，并核对页面落盘、引用、来源正文和原始 corpus ID。结果输出至 `.local/evidence/scifact-demo.json`；失败返回非零退出码并记录原因。

重复运行会新增来源。需要隔离重跑时，用新的 Wiki 目录启动另一个端口：

```bash
KNOWWAEVE_WIKI_PATH="$PWD/.local/replay-wiki" pnpm dev --port 3001
# 另一个终端
python3 scripts/demo_scifact.py --base-url http://127.0.0.1:3001 --limit 2 --questions 1
```

这是小型 Wiki 闭环演示，不是 SciFact 检索 benchmark；qrels 表示相关性，不表示文献支持声明。来源、许可和固定选择规则见 [数据说明](docs/SCIFACT.md)。

## 配置与排错

通过 shell 环境变量配置；`.env.example` 仅为示例，不会自动加载。

| 变量 | 默认值 / 用途 |
| --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434`，兼容末尾 `/v1` |
| `OLLAMA_MODEL` | `qwen3.8:27b`，setup/doctor 核验实际安装 tag |
| `OLLAMA_NUM_CTX` | `32768`，每请求本地上下文长度 |
| `OLLAMA_NUM_PREDICT` | `4096`，每请求最大生成长度 |
| `KNOWWAEVE_WIKI_PATH` | 默认 `.local/wiki`，支持绝对路径覆盖 |
| `KNOWWAEVE_CONFIG_DIR` | 默认 `.local/config`，支持绝对路径覆盖 |

历史展示名 KnowWaeve 现统一为 **KnowWeave**。`KNOWWAEVE_*` 环境变量、`/opt/knowwaeve-node` 安装路径，以及内部包名和磁盘格式为兼容已有环境保留，不代表另一套应用。

模型默认的大上下文曾在 GPU 驱动错配、回退 CPU 时触发 OOM。本项目使用 Ollama 原生 `/api/chat` 设置请求级上下文，关闭 thinking，按 UTF-8 字节上界和输出预算拒绝过长文本，避免静默丢失证据。大文档需缩小或按实际硬件调整上下文，小样本通过不代表任意长文档都可用。

若模型运行异常，先执行 `pnpm doctor`、`nvidia-smi` 并检查 Ollama 日志。本次服务器的驱动修复及 GPU 证据见 [验收报告](docs/ROUND_01_ACCEPTANCE.md)，不作为其他机器通用的操作指令。

本轮验证文本导入。Ollama 不接受继承的 OpenRouter PDF 文件块协议；PDF 请先转换为文本/Markdown。引用约束可防止引用未提供的页面，生成内容仍需核对原文。

## 检查与文档

```bash
pnpm test
pnpm test:data
pnpm typecheck
pnpm lint
NEXT_TELEMETRY_DISABLED=1 pnpm build
```

历史 Round 01 实测为 210 项 JavaScript/TypeScript 测试、30 项 Python 测试通过，1 项云端测试跳过；2026-10-17 15:42（Asia/Shanghai）命名整理后的交付前复测结果相同，typecheck/lint/build 均退出 0，lint 仍有 2 条继承警告。测试基线、两次验证范围和 GPU 小样本结果见验收报告；独立审阅者应针对自己的 checkout 执行以上命令。

- [GPT / 独立审阅入口](docs/GPT_REVIEW_GUIDE.md)
- [工程现状与调用链](docs/PROJECT_OVERVIEW.md)
- [当前进度](docs/PROGRESS.md)
- [开发日志](docs/DEVLOG.md)
- [Round 01 验收报告](docs/ROUND_01_ACCEPTANCE.md)
- [数据来源与许可](docs/SCIFACT.md)

需求文档已整理为 [三轮计划](docs/THREE_ROUND_PLAN.md) 与 [Round 01 需求](docs/ROUND_01_REQUIREMENTS.md)，保留原有要求实质并统一当前名称。

## 仓库与提交边界

个人仓库：[ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave)，为 private 独立仓库，`main` 是代码与文档交付入口；私有仓库审阅需读取授权或提供源码包。

实现基线提交为 `395747308fb0f888702f224c6be5e3eeefa491ca`，历史验收补充提交为 `4620b8c34040be64404541ffd8160f95310fec6f`。当前命名统一和审阅文档是后续整理，不能冒充历史提交上的再次实测。

数据、模型、缓存、数据库、密钥、私有文档和 `.local/evidence` 本地证据不提交 Git。仓库提供开发文档、可执行检查及必要的历史结果摘要；代码来源和改造边界集中记录在 NOTICE。
