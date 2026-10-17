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

## 尚未实现

- Round 02：本地 Embedding、向量索引与更新、RRF 融合及 BM25/Embedding/Hybrid 的公平全量评测。
- Round 03：完整用户路径稳定性专项、演示素材、简历/架构交付及公开发布准备。

没有全量 SciFact 检索指标，也没有“提升百分比”。小样本 Wiki 演示不能替代 benchmark。
