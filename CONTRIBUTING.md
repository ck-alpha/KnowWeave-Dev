# Contributing to KnowWeave

KnowWeave 是本地优先的 Agent 知识管理系统。当前范围是 Round 01：Ollama + Qwen 本地运行、SciFact 小样本导入、Wiki 生成和来源可追溯问答。

先阅读 [README](README.md)、[项目架构](architecture.md) 和 [GPT 验收指南](docs/GPT_REVIEW_GUIDE.md)，再阅读当前项目的架构、进度、开发日志及验收记录。

- 保留 TypeScript、Next.js、SQLite 和 Markdown 文件架构，优先修复实际用户路径。
- 关键模型响应必须通过现有 schema 校验，保持来源链接与磁盘格式兼容。
- 不提交下载的数据集、模型、Wiki 数据、缓存、密钥或个人配置。
- 运行 `pnpm test`、`pnpm typecheck` 和与改动相关的构建/复现检查，记录实际结果及限制。
- PR 应说明问题、改动、验证方式；不要把计划中的 Hybrid/RRF 或未运行的评测写成完成项。

提交的代码适用 [MIT License](LICENSE)。上游来源及本项目改造范围见根目录的第三方说明；现有作者版权声明必须保留。

- 模块职责、调用链、接口、存储、检索/模型协议或部署入口变化时，在同一次代码提交中更新根目录 `architecture.md` 和核对日期；重大决策同步到开发日志。
