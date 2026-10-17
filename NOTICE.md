# KnowWaeve 来源与改造说明

KnowWaeve 是基于 [LLM Wiki](https://github.com/ddsyasas/llm-wiki) 的独立二次开发项目，
导入基线为 `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`（2026-10-17 获取）。
原项目作者 Yasas，`LICENSE` 原文完整保留，包括 Copyright (c) 2026 Yasas。
LLM Wiki 实现了 Andrej Karpathy 提出的 LLM Wiki 工作流。

继承能力：Next.js UI/API、文档解析、Wiki Ingest/更新、问答、聊天、Lint、
Markdown 存储、SQLite FTS5、来源关系、多 Wiki 与初版 Ollama 支持。
这些能力不宣称为本项目从零原创。

本轮改造：KnowWaeve 品牌与本地运行入口；Qwen3.8 默认配置与实际 tag 检查；
有界上下文的 Ollama 原生请求适配；自然语言 FTS 查询修复与问答引用约束；
SciFact 自动获取、校验和确定性小样本；真实 API 验证脚本、回归测试及开发记录。
Embedding、Hybrid、RRF 与全量检索评测尚未实现。

`docs/upstream/` 是原项目文档和历史截图，不代表 KnowWaeve 当前进度或实测结果。
仓库根目录的两份 AgentWiki 任务文档为用户提供的原始需求，保留原名，产品名以 KnowWaeve 为准。
兼容内部包名 `@llm-wiki/*` 和 Wiki 内部 `.llm-wiki/` 目录，避免无关迁移。

第三方依赖保留各自许可证；版本以 `pnpm-lock.yaml` 为准。
SciFact 数据不受本仓库 MIT 许可证覆盖：claims/evidence 为 CC BY 4.0，
论文摘要为 ODC-By 1.0。详见 [数据说明](docs/SCIFACT.md) 和
[SciFact 官方许可](https://github.com/allenai/scifact/blob/master/LICENSE.md)。
数据、模型、数据库、个人文档、密钥及本地运行产物不提交 Git。
