# KnowWeave 当前进度

更新：2026-10-17（Asia/Shanghai）。产品展示名为 KnowWeave；私有开发仓库已改名为 KnowWeave-Dev，独立公开快照正在验证、尚未发布。旧环境变量和内部路径为兼容保留。

当前架构统一维护在根目录 [architecture.md](../architecture.md)；模块、接口、存储或部署变化时随代码同步更新，具体要求见该文件的维护约定。

## Round 01

已实现：

- 导入并审阅指定 MIT 上游，保留 LICENSE，记录基线提交及继承/自研边界。
- 产品 UI/README、本地启动和隔离配置，默认 Ollama `qwen3.8:27b`。
- 本地模型 tag 检查、原生有界上下文请求、JSON校验、自然语言 FTS 和引用校验。
- SciFact 官方下载/校验、确定性样本、真实 API 闭环验收脚本。
- 默认 Wiki 切换一致性修复；固定路径模式明确拒绝虚假的切换成功。
- 根据用户要求恢复 GPU：重新加载已安装的 580.178.04 模块，Ollama 日志确认 66/66 层 GPU。

Round 01 历史本地验收已通过，包括 GPU 真实导入/更新/问答、浏览器引用到原文的操作链，以及服务停止/重启检查。实现提交为 `395747308fb0f888702f224c6be5e3eeefa491ca`，最终历史记录提交为 `4620b8c34040be64404541ffd8160f95310fec6f`。实测结果及边界见 [验收报告](ROUND_01_ACCEPTANCE.md)。

本次整理统一当前展示名 KnowWeave，并补齐供 GPT / 开发者阅读的 [独立审阅指南](GPT_REVIEW_GUIDE.md)。个人 GitHub 仓库 [ck-alpha/KnowWeave-Dev](https://github.com/ck-alpha/KnowWeave-Dev) 为 private 独立仓库，`main` 是代码与文档交付入口。2026-10-17 15:42（Asia/Shanghai）完成整理后的测试、typecheck/lint/build、5 条路由与既有 Wiki 的真实 GPU 问答复测；范围与历史首次导入验收分开记录，见验收报告。

## Round 02

代码已实现：

- Ollama `nomic-embed-text:v1.5`，独立于 Qwen 的向量协议、模型 digest/前缀/维度校验与超时，无静默截断。
- 每 Wiki SQLite 持久化向量；内容 hash 失效、增量刷新、强制重建、删除级联、启动旧页补齐及跨 Wiki 隔离。
- Query API/UI 切换 BM25 / Embedding / Hybrid（固定等权 RRF）；实际正文进入 Qwen，返回正文 SHA256 与取证页、延续引用检查与无证据处理。
- 原始 SciFact 全量评测 runner 复用产品核心，输出三指标、数据/源码指纹、实际模型、索引代价与查询延迟；小型 Wiki 闭环与基准分开。
- 纠正干净环境先 `download` 再 `prepare` 的复现命令；更新架构、开发日志、审阅入口和第二轮验收记录。

Round 02 实现提交：[`94464cc`](https://github.com/ck-alpha/KnowWeave-Dev/commit/94464cce3859203a574527df5e7bac560be7b040)；逐文件核对评测源码与提交一致。本机实测及 Git 交付：见 [Round 02 验收报告](ROUND_02_ACCEPTANCE.md) 与 [结构化结果](evidence/ROUND_02_RESULTS.json)。报告逐项区分代码、真实 Ollama/SciFact、单元测试与未验证范围；旧 Round 01 测试计数不替代本轮结果。

## Round 03

代码与材料已实现：

- 同名来源 UUID 独立原文、排他创建；Ingest 同 Wiki 进程内写入互斥、提案冲突预检；使用实际落盘正文索引，修复首问使新向量失效的问题。
- 输入校验、Retry 审批和重复应用拒绝、来源删除 I/O/历史共享文件保护、缺失来源提示；索引空库/失效/失败/刷新反馈与模式解释。
- 安全隔离的 SciFact API Demo 与真实 Chromium 导入、三模式问答、引用至原文的截图脚本；分别记录 LLM 更新与手工阅读列表更新。
- README 门面、真实项目截图、双岗位简历与讲解材料、审阅指南，保留继承贡献和 Round 02 指标边界。

实现提交：[`171f4cc`](https://github.com/ck-alpha/KnowWeave-Dev/commit/171f4ccc49a7b4cad8afd46b6d7e978b6007e47e)，已推送个人main；后续文档提交仅补记SHA。

本机最终实测：299项JS/TS与47项Python通过，1项云端跳过；typecheck/lint/build成功，2条继承Hooks警告。真实API、完整浏览器链路、8项索引生命周期、26项HTTP边界与服务重启均通过。具体实测结果、首次演示发现的问题与重跑、截图、环境和交付提交集中记录于 [Round 03 验收](ROUND_03_ACCEPTANCE.md)，不以历史测试计数代替当前验证。

## 公开前最小检查

2026-10-17 已完成本次检查，范围为文档勘误与回归，不是 Round 04。修正 Round 01 的个人路径、`pnpm run doctor` 项目诊断入口及检索延迟的 HTTP 口径，简历明确三模式仅用于独立 Query；应用源码、参数及历史指标未变。

本次重新执行 299 项 JS/TS、47 项 Python 通过，1 项云端跳过；typecheck/lint/隔离生产 build 退出 0，保留两条 Hooks 警告。独立 Wiki 的真实 API Demo、Chromium 第三篇导入/三模式问答/原文追溯及停止重启通过。公开内容扫描未发现真实凭据，但历史提交邮箱和旧路径仍需所有者确认；当前路径修正不会清除 Git 历史。详细范围、未跑项及提交记录见 [公开前检查](PRE_PUBLIC_CHECK.md)。

## 独立公开源码发布

2026-10-17 已将原开发仓库改名为 KnowWeave-Dev，保持 private 与完整历史；新 Public KnowWeave 是独立非 Fork 仓库，唯一初始提交 `0db60428e3a65eab79c222fb46e5c68f690202da`，导出自私有基线 `29a34ff6bc76a68ba727f628727d5493d7102bfe`。两处 origin 已分离。公开 226 文件仅含源码/配置/测试/README/许可，不含过程文档或旧历史。

公开快照重新安装、299 项 JS/TS、47 项 Python、typecheck/lint/build 通过，1 项云端跳过、2 条既有 Hooks 警告；匿名独立克隆、冻结安装与生产构建也通过，公开 HTTP 200、私有匿名 HTTP 404；实际范围、隐私检查和完整文件清单见 [发布记录](PUBLIC_RELEASE.md)。

## 尚未完成 / 未验证

- 本次未跑真实模型 Demo 或完整 benchmark；全新机器/空缓存安装仍未验证。
- 大规模 Wiki 的精确向量扫描性能、并发压力、中文/多语言专项和 PDF/OCR；本轮不宣称覆盖。
- MCP、GraphRAG、复杂 Agent 编排、独立向量服务、登录和云部署不在本轮范围。

离线指标仅代表固定 SciFact 英文 test 集的原始论文检索，不代表所有知识库或问答事实准确率。
