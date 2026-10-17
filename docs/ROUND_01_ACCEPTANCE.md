# KnowWeave — Round 01 验收报告

日期：2026-10-17（Asia/Shanghai）。历史结果：**Round 01 本地验收通过**（范围及限制见下文）。

范围：用户提供的 Round 01，模型固定为本机 Ollama `qwen3.8:27b`。当前展示名为 **KnowWeave**；名称兼容说明见 README；下面保留历史提交、命令、来源 ID 和测量值。

本报告描述历史实现提交及当时本机的实测。后续命名和文档整理不等于重新执行全部验收；审阅当前代码时应按 [GPT 审阅指南](GPT_REVIEW_GUIDE.md) 检查差异并独立复现。

## 可核对交付

- 项目代码、README、MIT LICENSE 与 [NOTICE](../NOTICE.md)；具体来源基线与继承/改造边界集中记录于 NOTICE。
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
| Chromium151浏览器页面 | 首页、Sources、Wiki、Query和原文Source共5项通过；全部HTTP200；品牌/标题/输入框正常；0 console.error、0未捕获异常、0资源错误 |
| 浏览器完整操作链 | 实际填写问题并点击Ask → 点击正文`aldh1`引用 → Wiki → 原始Source；核对完整输入文本与`corpus_id=45638119`，通过 |
| 实际错误与无证据路径 | 空Query/空Ingest返回400；不存在页面/来源返回404；无检索命中返回低置信、空引用、明确证据不足；5项通过 |
| 本地配置/停止回归 | Wiki选择5项回归通过；launcher变更后2项定向回归通过；真实SIGTERM释放3000端口，重新启动后首页/设置/页面/来源API均200 |
| LICENSE/忽略规则 | LICENSE与上游逐字节一致；数据/配置/SQLite/node_modules均被忽略 |

历史 lint 日志的两条非阻塞警告位于 `command-palette.tsx:240` 与 `graph/vault-graph.tsx:139`（后续修改可能改变行号），留待 UI 稳定性整理。云端 smoke 的跳过不计为通过，也不表示本轮验证了付费云端路径。

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

## 2026-10-17 15:42（Asia/Shanghai）交付前复测

统一当前名称并整理个人仓库文档后，对当时待提交工作树执行了新的验证，与前述历史验收分开记录：

| 本次检查 | 实际结果 |
| --- | --- |
| `pnpm test` | 210 项通过、1 项云端 smoke 跳过 |
| Python 测试 | 30 项通过 |
| typecheck / lint / build | 均退出 0；lint 仍为 2 条 React Hooks 警告 |
| 新生产服务路由 | `/`、`/about`、`/query`、`/sources`、`/wiki` 均 HTTP 200，页面标题为 KnowWeave |
| Chromium 页面复测 | 5 个页面通过，浏览器错误 0；这是页面检查，完整点击链见历史验收 |
| 已有 Wiki 的真实 Query | 模型 `qwen3.8:27b`，引用 `aldh1` |
| GPU 状态 | NVIDIA 驱动 580.178.04；Ollama `100% GPU`、上下文 32768 |

原始业务复测证据为 `.local/evidence/remote-delivery-gpu.json`，时间 `2026-10-17T15:42:45.787667+08:00`；新测试日志采用 `remote-delivery-*` 前缀；浏览器页面复测产物为 `.local/evidence/remote-delivery-browser/browser-smoke.json`。仓库内证据 JSON 的 `remote_delivery_recheck` 汇总该轮结果和原始产物哈希。本次业务复测针对已有 Wiki 问答与 HTTP 页面；首次导入/更新和完整浏览器点击链仍依据上面的历史运行记录。

这些是同一开发环境内的新实测，不是外部审阅者的独立复现，也不是全量检索评测。最终交付提交应由 Git 历史核对，不能将待提交工作树上的复测误标成某个尚未产生的 commit 上的运行。

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
python3 scripts/scifact.py download  # 干净环境先下载；Round 02 补正复现步骤
python3 scripts/scifact.py prepare
python3 scripts/demo_scifact.py --limit 2 --questions 1
```

默认浏览器地址 `http://127.0.0.1:3000`。测试命令见README。
完整机器生成的本地日志、API 结果、驱动证据和截图在 `.local/evidence/`，不进入 Git；远端仓库阅读者不能直接访问该目录。
仓库内的 [Round 01 证据摘要](evidence/ROUND_01_RESULTS.json) 保留必要的历史结果与原始产物 SHA256，供核对报告与追踪来源。该摘要是对已有运行产物的整理，不是独立重跑，也不单凭哈希证明报告中的结论。
浏览器证据为`browser-smoke.json`、`browser-ui-chain.json`与对应截图；
停止/重启证据为`launcher-stop.json`、`launcher-restart.json`。

## 局限与下一轮

本轮文本小样本，不是全量benchmark，不报告nDCG/Recall/MRR或提升比例。
Embedding、Hybrid、RRF尚未实现。PDF/OCR与多语种检索未专项验证。
引用存在性和来源完整性检查不能替代对生成内容的人工事实核查。

## Git

实现与首版验收提交：`395747308fb0f888702f224c6be5e3eeefa491ca`。
历史验收补充提交：`4620b8c34040be64404541ffd8160f95310fec6f`，记录浏览器操作链、真实停止/重启结果和上述实现 SHA。使用 `git show <SHA>` 可分别检查这两次历史提交；历史提交时未配置个人远端、未推送。

本次后续整理将当前展示名统一为 KnowWeave，并准备个人仓库及 GPT 审阅文档。个人仓库 [ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave) 为 private 独立仓库，`main` 是代码与文档交付入口。私有仓库需读取授权或由用户提供源码包，参见审阅指南。

交付版本可用以下命令核对；本地 HEAD 应与远端 main 相同：

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```
