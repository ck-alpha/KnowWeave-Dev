# KnowWaeve 当前进度

更新：2026-10-17（Asia/Shanghai）。产品名按用户指定 KnowWaeve，目录 KnowWeave。

## Round 01

已实现：

- 导入并审阅指定 MIT 上游，保留 LICENSE，记录基线提交及继承/自研边界。
- 产品 UI/README、本地启动和隔离配置，默认 Ollama `qwen3.8:27b`。
- 本地模型 tag 检查、原生有界上下文请求、JSON校验、自然语言 FTS 和引用校验。
- SciFact 官方下载/校验、确定性样本、真实 API 闭环验收脚本。
- 默认 Wiki 切换一致性修复；固定路径模式明确拒绝虚假的切换成功。
- 根据用户要求恢复 GPU：重新加载已安装的 580.178.04 模块，Ollama 日志确认 66/66 层 GPU。

实测状态与 Git 交付以 [Round 01 验收报告](ROUND_01_ACCEPTANCE.md) 为准。

## 尚未实现

- Round 02：本地 Embedding、向量索引与更新、RRF 融合及 BM25/Embedding/Hybrid 的公平全量评测。
- Round 03：完整用户路径稳定性专项、演示素材、简历/架构交付及公开发布准备。

没有全量 SciFact 检索指标，也没有“提升百分比”。小样本 Wiki 演示不能替代 benchmark。
