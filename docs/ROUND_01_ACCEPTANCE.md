# KnowWaeve — Round 01 验收报告

日期：2026-10-17（Asia/Shanghai）。当前状态：**Round 01 本地验收通过**（范围及限制见下文）。

范围：用户提供的 Round 01，产品名 KnowWaeve，模型固定为本机 Ollama `qwen3.8:27b`。

## 可核对交付

- 项目代码、README、MIT LICENSE 与 NOTICE；上游基线 `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`。
- 本地启动/配置/实际模型检查；保留核心 Ingest、Wiki、来源、BM25/FTS5 流程。
- SciFact 官方数据获取和确定性小样本；原始 corpus/queries/qrels 不提交。
- 测试、数据完整性与真实 API 验收脚本；开发记录及后续接入点。

## 环境与 GPU 修复

原环境无 Node/pnpm。安装并校验 Node22.23.3、pnpm10.12.1；Ollama0.34.4。
用户要求使用GPU后，检查到加载的内核驱动580.173.02与已安装用户态库580.178.04不匹配。
在无其他GPU进程/显示服务时，停止Ollama、重载已安装驱动模块、再启动Ollama。
现内核和库均580.178.04，`nvidia-smi`可用，识别RTX4090（系统报告49140MiB显存）。
Ollama日志为66/66层GPU，`ollama ps`显示100%GPU。未重装驱动、未修改服务配置、未重启机器。

最终模型请求默认 `num_ctx=32768`、`num_predict=4096`、`think=false`、`temperature=0`；
文本采用UTF-8字节上界与输出预算进行保守检查，超限明确拒绝，避免静默截断上下文。
独立GPU预热后探针成功输出29个token，总时间0.629秒；这只是连通性探针，不是性能基准。

## 实测结果

| 检查 | 实际结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 成功；SQLite/keytar原生加载检查通过 |
| `pnpm test` | 19个测试文件通过；210项通过、1项跳过（需要OpenRouter Key的上游云端smoke） |
| `python3 -m unittest discover -s tests -v` | 30项通过，涵盖数据完整性/安全解压/确定性/验收误报防止/本机代理绕过 |
| `pnpm typecheck` | llm/core/ingestion/web全部通过 |
| `pnpm lint` | 退出0；2条继承的React Hooks警告，包级lint仍是上游no-op |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | Next.js14.2.35生产构建通过；18个静态页面生成成功 |
| `pnpm start` | 127.0.0.1:3000生产服务启动成功，无standalone启动冲突 |
| Chromium151浏览器主页面 | `/`、`/sources`、`/wiki`、`/query`全部HTTP200；品牌/标题/输入框正常；0 console.error、0未捕获异常、0资源错误 |
| 实际错误与无证据路径 | 空Query/空Ingest返回400；不存在页面/来源返回404；无检索命中返回低置信、空引用、明确证据不足；5项通过 |
| 本地配置/停止回归 | Wiki选择5项回归通过；launcher变更后2项定向回归通过 |
| LICENSE/忽略规则 | LICENSE与上游逐字节一致；数据/配置/SQLite/node_modules均被忽略 |

Lint的两条非阻塞警告位于 `command-palette.tsx:240` 与 `graph/vault-graph.tsx:139`，留待后续UI稳定性整理。

### 真实 GPU + SciFact API 运行

运行时间：2026-10-17 15:11（Asia/Shanghai）。命令：
`python3 scripts/demo_scifact.py --limit 2 --questions 1`，最终状态 `passed`。

原始数据：5183篇corpus、1109条queries、300条test queries、339条test qrels。
官方ZIP的MD5匹配 `5f7d1de60b170fc8027bb7898e2efca1`，SHA256为
`536e14446a0ba56ed1398ab1055f39fe852686ecad24a6306c80c490fa8e0165`。
准备3篇、实际仅导入前2篇，未对全量corpus调用Qwen。

| corpus ID / 操作 | 实际变化 | API调用及持久化核查耗时 |
|---|---|---:|
| 45638119 | 新建 `aldh1`、`mammary-stem-cells` | 5.606s |
| 16322674 | 新建 `birth-size-breast-cancer-risk`，更新 `mammary-stem-cells` | 6.423s |
| query 51 | 回答并核验引用/来源 | 2.446s |

运行后2个原始来源、3个Wiki页面、4条page_sources关系。
三次模型调用均为 `qwen3.8:27b`；输入/输出token依次为1299/535、1992/597、1311/145。
这是本次演示的实测时间与usage，不是吞吐或检索质量基准。

query51的声明为“ALDH1表达与更好的乳腺癌结局相关”；回答根据Wiki证据反驳该声明，指出与较差预后相关。
可检查链：`[[aldh1]]` → 来源UUID `0bfe3bbc-7b3a-4d9d-92c3-08d69c5d6f55` → corpus `45638119`。
原始来源内容SHA256为 `28a9e390bd936984a99cab1cf71db70a36e4419e423ff862a0484042e564bca7`。
脚本同时验证页面已落盘、frontmatter来源、来源API正文、输入hash和该问题的正相关qrel。
模型caveats仍可能不精确，例如本次生成了对来源细节不足的笼统提示；页面/原文溯源由应用元数据验证，不把模型自述当成来源完整性证据。

最终运行的 `ollama ps` 显示100%GPU、32768上下文；应用闭环期间GPU显存约20490MiB。
本次GPU修复遵循实际模块/库版本与占用检查，背景说明可参见
[Ubuntu驱动错配文档](https://ubuntu.com/server/docs/nvidia-drivers-installation/)。

## 复现

```bash
cd /home/linchengkai/KnowWeave
export PATH=/opt/knowwaeve-node/bin:$PATH
pnpm install --frozen-lockfile
pnpm doctor
pnpm setup:local
NEXT_TELEMETRY_DISABLED=1 pnpm build
pnpm start
# 另一个终端
python3 scripts/scifact.py prepare
python3 scripts/demo_scifact.py --limit 2 --questions 1
```

默认浏览器地址 `http://127.0.0.1:3000`。测试命令见README。
完整机器生成的本地日志、API结果和驱动证据在 `.local/evidence/`，均不进入Git；
本报告会保留必要的结果摘要和溯源ID，避免提交数据或个人运行目录。

## 局限与下一轮

本轮文本小样本，不是全量benchmark，不报告nDCG/Recall/MRR或提升比例。
Embedding、Hybrid、RRF尚未实现。PDF/OCR与多语种检索未专项验证。
引用存在性和来源完整性检查不能替代对生成内容的人工事实核查。

## Git

将在测试完成后记录实际代码提交SHA。当前没有个人远端，不会推送上游。
