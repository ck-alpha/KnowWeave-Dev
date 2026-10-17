# KnowWeave development guidance

本项目名称和仓库名称为 **KnowWeave**。用户当前要求优先于附带的历史任务模板。

- 从根 README、`docs/GPT_REVIEW_GUIDE.md` 及 `docs/` 当前项目记录了解实际状态。原始任务模板是需求背景，不能覆盖当前用户要求。
- Round 01 保留现有文档 → Ingest → Markdown Wiki → 检索问答 → 来源追溯流程，默认使用 Ollama 和运行时确认的 Qwen 模型。
- 保持现有 TypeScript / Next.js / SQLite 架构与 `.llm-wiki/` 文件格式；不要为了名称重写内部包名或迁移用户数据。
- 本轮不实现 Embedding、Hybrid、RRF、MCP、全量 benchmark 或云服务。后续计划和实际结果必须清楚区分。
- 保留 LICENSE 原作者版权声明，并准确记录上游代码来源和本项目改造范围。
- 不提交数据集缓存、模型、个人 Wiki、密钥或生成的本地配置。
- 依据改动运行适当的测试、类型检查和构建。开发日志与验收报告只记录实际运行结果。
