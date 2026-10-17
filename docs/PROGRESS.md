# KnowWeave 当前进度

更新：2026-10-17（Asia/Shanghai）。当前展示名与个人仓库目标名均为 KnowWeave；旧环境变量和内部路径为兼容保留。

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

本次整理统一当前展示名 KnowWeave，并补齐供 GPT / 开发者阅读的 [独立审阅指南](GPT_REVIEW_GUIDE.md)。个人 GitHub 仓库 [ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave) 为 private 独立仓库，`main` 是代码与文档交付入口。2026-10-17 15:42（Asia/Shanghai）完成整理后的测试、typecheck/lint/build、5 条路由与既有 Wiki 的真实 GPU 问答复测；范围与历史首次导入验收分开记录，见验收报告。

## Round 02

代码已实现：

- Ollama `nomic-embed-text:v1.5`，独立于 Qwen 的向量协议、模型 digest/前缀/维度校验与超时，无静默截断。
- 每 Wiki SQLite 持久化向量；内容 hash 失效、增量刷新、强制重建、删除级联、启动旧页补齐及跨 Wiki 隔离。
- Query API/UI 切换 BM25 / Embedding / Hybrid（固定等权 RRF）；实际正文进入 Qwen，返回正文 SHA256 与取证页、延续引用检查与无证据处理。
- 原始 SciFact 全量评测 runner 复用产品核心，输出三指标、数据/源码指纹、实际模型、索引代价与查询延迟；小型 Wiki 闭环与基准分开。
- 纠正干净环境先 `download` 再 `prepare` 的复现命令；更新架构、开发日志、审阅入口和第二轮验收记录。

本机实测及 Git 交付：见 [Round 02 验收报告](ROUND_02_ACCEPTANCE.md) 与 [结构化结果](evidence/ROUND_02_RESULTS.json)。报告逐项区分代码、真实 Ollama/SciFact、单元测试与未验证范围；旧 Round 01 测试计数不替代本轮结果。

## 尚未完成 / 未验证

- Round 03：完整用户路径稳定性专项、演示素材、简历/架构交付及公开发布准备。
- 大规模 Wiki 的精确向量扫描性能、并发压力、中文/多语言专项和 PDF/OCR；本轮不宣称覆盖。
- MCP、GraphRAG、复杂 Agent 编排、独立向量服务、登录和云部署不在本轮范围。

离线指标仅代表固定 SciFact 英文 test 集的原始论文检索，不代表所有知识库或问答事实准确率。
