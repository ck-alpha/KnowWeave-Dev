# KnowWeave 开发日志

## 2026-10-17（Asia/Shanghai）— Round 01

输入是用户提供的三轮计划与 Round 01 需求；当轮任务明确为 Round 01，LLM 按用户要求使用 **Qwen3.8**。本次后续整理将当前展示名统一为 **KnowWeave**；名称兼容说明见 README，以下保留历史过程及实测事实。

### 审阅与初始化

初始目录仅含任务文档，并无源码或 Git。获取用户指定的开源基线，导入独立 Git 仓库，不设置原作者远端。具体代码来源、基线提交和版权声明集中记录于 [NOTICE](../NOTICE.md)。
审阅 README、设计文档、Ingest/Query/FTS5/来源/模型配置与测试。UI/API、原始解析与 Wiki 工作流属于继承能力，详见 NOTICE。

### 环境

本机原 PATH 无 Node/npm/pnpm，安装官方 Node 22.23.3（SHA256 校验）到 `/opt/knowwaeve-node`，pnpm 10.12.1；原生依赖需要的 libsecret 开发包已补齐，不修改用户 shell profile。
Ollama 0.34.4 可访问，实际安装 tag 为 `qwen3.8:27b` 与 `qwen2.5:14b`；按用户要求仅使用 Qwen3.8。

首次标准兼容 API 调用按模型默认 262K 上下文加载。GPU 驱动/库错配使 Ollama 回退 CPU，分配16GiB KV 缓存后被 OOM killer 终止，服务自动重启。为保持原模型 tag 和避免修改全局服务，增加原生 `/api/chat` 适配，支持请求级上下文8192、生成上限4096、temperature0和关闭thinking；CPU探针曾成功。

用户随后明确要求修复 GPU。检查到内存中模块580.173.02，磁盘DKMS与NVML/CUDA库均580.178.04；没有GPU占用进程或显示服务。停止Ollama，卸载无占用旧模块并加载磁盘新模块，重启Ollama。未重装驱动、未更改服务配置、未重启机器。`nvidia-smi`恢复，Ollama报告66/66层GPU；独立GPU探针成功输出JSON，预热后的第二次调用耗时0.63秒（29个输出token）。最终应用默认上下文设为32768，并按UTF-8字节上界+完整生成预算拒绝过长文本请求，解决固定窗口下静默丢失引用上下文的风险。

### 实现与决策

- 本地入口隔离配置和Wiki，默认绑定127.0.0.1；模型tag先读取`/api/tags`核验。
- 保留内部兼容包名和磁盘格式，收敛产品品牌/说明/云营销内容；当时归档了参考文档和截图，不当成本项目证据；本次整理将这些历史归档移出当前文档树；移除字体构建网络依赖。
- FTS5原来将完整问题按AND连接，可能零命中；改为转义词项OR+原有BM25排序，限制64词。没有实现Hybrid。
- 问答无命中直接返回证据不足；拒绝未实际提供页面的引用；非低置信回答不得无引用。
- 默认启动采用activeWiki，修复UI已切换而实际仍访问旧Wiki的问题；显式路径模式返回明确409。
- Python只负责数据/验收，不作为后端服务。下载/安全解压/校验可重复，保留官方原始文件；小样本按固定qrels规则选取。
- 验收脚本使用真实API，校验输入hash、页面落盘、双向来源和当前问题的相关文献；识别raw保存时的Markdown标题包装，未放宽完整性要求。

### 检查与后续

所有实测结论、限制和运行命令统一见 `ROUND_01_ACCEPTANCE.md`，避免在多份文档复制不同测试计数。生产启动时移除继承的standalone发布模式冲突，直接使用源码checkout的next build/start；修复启动器只停止pnpm却留下Next进程的问题。实际API演示首次被系统HTTP代理转发返回502，已限定loopback直连并补离线回归；最终GPU导入/更新/问答/来源校验通过。
Chromium真实提交问题、点击答案引用并打开原文，完整文本与corpus ID核对通过；页面检查未发现浏览器错误。真实SIGTERM停止启动器后3000端口释放，重新启动后首页与主要API均返回200，服务继续在本地运行。实现已提交为`395747308fb0f888702f224c6be5e3eeefa491ca`，随后在 `4620b8c34040be64404541ffd8160f95310fec6f` 补充最终验收记录；当时未配置远端、未推送。
下一轮仅在本轮验收后实现混合检索与公平评测；本轮不填未测指标，不将上游功能称为从零原创。

## 2026-10-17（Asia/Shanghai）— 个人仓库与审阅文档整理

用户要求以 **KnowWeave** 创建个人 GitHub 仓库，并提交相关文档供 GPT 阅读和验收。当前展示名统一为 KnowWeave；兼容环境变量 `KNOWWAEVE_*`、本机安装路径 `/opt/knowwaeve-node` 及内部包名/磁盘格式保持不变。

更新 README、架构、进度和验收说明，新增 `GPT_REVIEW_GUIDE.md`，按验收条件映射真实源码、测试和复现命令。保留历史实现与验收提交 SHA、210 + 30 项通过、1 项云端跳过、2 条 lint 警告，以及 GPU、小样本和浏览器结果；明确历史实测、文档中可执行的复现方式、尚未运行的新检查之间的区别。

README 增加 VS Code Remote SSH 的 `code --openExternal` 与本机 13000 端口 SSH 转发方式，移除历史归档路径引用。源码归属与继承/改造范围集中在 NOTICE，未宣称全部从零原创。

个人仓库 [ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave) 已创建为 private 独立仓库，配置 `origin` 指向该仓库，`main` 用于交付代码与文档；没有 Fork 关系或 upstream 远端。需求文档整理为 `THREE_ROUND_PLAN.md` 和 `ROUND_01_REQUIREMENTS.md`；保留要求实质，名称与来源说明引用统一到当前文档。本次文档整理不产生新的检索指标或 GPU 性能结论；Round 02 的 Embedding / Hybrid / RRF / 全量评测仍未实现。

### 2026-10-17 15:42（Asia/Shanghai）— 交付前再次验证

命名与文档整理后重新运行：`pnpm test` 210 项通过、1 项云端 smoke 跳过，Python 30 项通过；typecheck、lint、build 均退出 0，lint 仍为 2 条 React Hooks 警告。此处记录本次实际重跑，不覆盖前述历史验收。

新生产服务的 `/`、`/about`、`/query`、`/sources`、`/wiki` 均 HTTP 200，HTML 标题为 KnowWeave。真实 Query 使用已有 Wiki，返回 `qwen3.8:27b` 的回答并引用 `aldh1`；驱动 580.178.04，Ollama 显示 `100% GPU`、上下文 32768。Chromium 页面复测 5 项通过、浏览器错误 0，产物为 `.local/evidence/remote-delivery-browser/browser-smoke.json`。原始业务复测产物为 `.local/evidence/remote-delivery-gpu.json`，检查时间 `2026-10-17T15:42:45.787667+08:00`；测试日志使用 `remote-delivery-*` 文件名前缀，必要摘要汇入 `docs/evidence/ROUND_01_RESULTS.json` 的 `remote_delivery_recheck`。

本次业务复测范围为已有 Wiki 的问答与 HTTP 页面检查；首次 SciFact 导入/更新及完整浏览器点击链仍由前述历史验收记录支撑。实际交付版本以远端 `main` 提交为准。
