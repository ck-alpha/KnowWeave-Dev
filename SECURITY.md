# KnowWaeve security notes

KnowWaeve 是供本人使用的本地应用，目前没有登录或远程访问控制。仅在本机回环地址启动，不应直接暴露到公网。

默认模型调用发往本地 Ollama。若主动选择 OpenRouter 或修改模型服务地址，相应文档内容会发送到该服务。URL 导入也需要访问对应网站。

Wiki 文件、SQLite 索引及会话保存在所选本地目录。为兼容上游磁盘格式，内部元数据目录仍使用 `.llm-wiki/`，源码启动脚本使用仓库内被忽略的 `.local/config/`，直接启动的全局配置默认使用 `~/.knowwaeve/`；可通过 `KNOWWAEVE_CONFIG_DIR` 指定。可选 API 密钥使用现有 keychain / 受限配置文件存储；这些文件不应提交到仓库。

目前尚未配置本项目的公开漏洞报告渠道或响应 SLA。发现漏洞时，请向本项目仓库所有者私下提供复现步骤、影响范围和涉及版本，不要在公开 issue 中发布密钥、私有文档或可直接利用的敏感信息。原项目维护者不是 KnowWaeve 的联系渠道。

历史上游策略仅归档于 [docs/upstream/SECURITY.md](docs/upstream/SECURITY.md)，其版本支持和服务承诺不适用于本项目。
