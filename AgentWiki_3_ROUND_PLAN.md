# AgentWiki — 三轮二次开发与验收计划

## 项目定位

AgentWiki：本地优先的 Agent 智能知识管理系统。基础能力包括文档 Ingest、LLM 自动维护 Wiki、知识组织与关联、检索问答、来源追溯；个人新增重点是本地模型接入、混合检索与可复现评测。

- 源代码起点：https://github.com/ddsyasas/llm-wiki （MIT）
- 唯一必选数据集：BEIR SciFact（官方仓库 https://github.com/beir-cellar/beir ；下载 https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip ）
- 已有模型：本地 Ollama 上的 Qwen（运行时检查实际模型 tag）
- Embedding 预选：Ollama `nomic-embed-text`（本地按需安装）
- 关键词检索：SQLite FTS5/BM25；混合检索：向量检索 + RRF
- 减法原则：不新增 MCP、GraphRAG、微服务、登录、云部署或额外数据集作为强制范围。

## 三轮任务

### Round 01 — 运行与基础闭环

审阅工程、独立产品命名、Ollama/Qwen 闭环、SciFact 自动获取与小样本 Wiki Ingest、开发日志/进度/验收文档、基础测试和 Git 提交。只在满足实际条件时推送到本人 private GitHub 仓库。

### Round 02 — 混合检索与评测

在原有 FTS5/BM25 基础上接入本地 Embedding，建立适当的向量索引与更新机制，引入 RRF 融合，并将方案真正用于知识检索/问答。基于 SciFact 原始 corpus/queries/qrels，公平对比 BM25、Embedding、Hybrid 的 nDCG@10、Recall@10、MRR@10，并报告样本数、模型与参数、索引耗时、查询延迟和局限性。全量索引与 Qwen 逐篇知识编译应分开处理，不强制大规模生成 Wiki。

### Round 03 — 稳定性、演示与求职交付

梳理和修复关键用户路径：导入、知识更新、Wiki 浏览、检索问答、引用、基本错误处理。整理一键启动或清晰操作说明、真实截图/演示、技术架构与测试报告、简历描述。完成代码清理、合规说明与 GitHub 公开发布准备，复核许可证与隐私数据保护。

## 固定开发工作流

1. 助手给出当轮 Codex Prompt；用户在本地交给 Codex。
2. Codex 自行读源码、设计方案、实现、测试和维护开发日志/进度/当轮验收报告，然后提交并在远端可用时推送至个人仓库。
3. 用户将个人 GitHub 仓库链接及当轮报告交给助手。
4. 助手读取实际仓库源码、开发日志、测试结果和验收报告；必要时要求补修，不预先假定该轮成功。
5. 验收通过后才给出下一轮 Prompt。每轮可按实际问题收敛范围，但不随意扩充技术栈。

## 边界与诚信

可建立不带 Fork 标识的独立个人 GitHub 仓库，并使用自己的产品名称；但复制或二次开发的开源代码必须保留原作者版权声明、MIT 许可和依法需要保留的第三方通知。 README/NOTICE 中应准确交代项目来源及独立开发的功能，面试时不能把原有 Ingest、UI 等功能说成完全自己从零实现。自定义改造成果、评测指标和调试证据才是简历核心。

评测需在相同 corpus、queries、qrels 和固定参数下进行，报告原始数据和完整运行方式；不可填写未实际跑出的“提升 XX%”。小样例演示、子集评测与完整 SciFact 评测须明确分开。
