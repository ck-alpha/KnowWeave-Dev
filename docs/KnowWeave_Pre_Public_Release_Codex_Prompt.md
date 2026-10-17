# KnowWeave — 对外公开前的最小检查（交给 Codex）

你是 KnowWeave 的开发 Agent，当前仓库为 `ck-alpha/KnowWeave`。**三轮正式开发已经完成，此任务只是发布前检查，不是 Round 04，不得扩充功能范围。**

请先确认本地 Git HEAD、远端 `main` 一致，并阅读 `README.md`、`architecture.md`、`docs/PROGRESS.md`、`docs/ROUND_03_ACCEPTANCE.md` 和 `docs/CAREER_PRESENTATION.md`。

## 本次任务

1. **公开信息与合规检查**：检查全部 Git 已跟踪文件是否含凭据、个人本机路径、私人 Wiki、IP/账号信息等不适合公开的内容；尤其检查 `docs/ROUND_01_ACCEPTANCE.md` 中约第 98 行的个人绝对路径，改为可复现的通用相对命令。人工截图检查留给用户，Codex 也可检查图像和元数据。保留 LICENSE 原作者版权与 NOTICE 来源声明，不篡改历史测试事实，不改写原始 Git 历史。
2. **发布前最小回归**：在当前代码上执行合适的测试、类型检查、构建；若条件具备，复跑已有小样本 Demo 或端到端短链路。任何未跑或失败项如实记录，不能拿历史验收代替本次执行。优先修复真正阻断复现的问题，不做大重构。
3. **README 与简历数据一致性**：核对主要截图/链接、安装/模型要求、SciFact 指标、检索延迟、模型和索引使用说明。区分 Round 02 全量原始 corpus benchmark 与 Round 03 小型 Wiki Demo；强调 Hybrid 不全面优于 Embedding、引用存在不等于事实正确、在线三路模式目前针对 Query 而非所有工作流。
4. **最终交付**：如有必要的小改动，更新 `docs/DEVLOG.md`、`docs/PROGRESS.md` 和一个简短的 `docs/PRE_PUBLIC_CHECK.md`，记录实际变更、执行结果、仍需用户确认的隐私项以及 commit SHA；提交并推送到用户仓库 `main`。

## 严格范围

- 不增加 MCP、Agent 新工作流、第二套数据集、ANN/向量数据库、中文检索优化、云部署或大型 UI 改造。
- 不修改 Round 02 历史 benchmark 数字，不伪造新结果；不为了追求更好指标重调 SciFact test 集上的参数。
- **不自行将仓库改成 Public**；是否公开、何时公开由用户最终决定。
- 不删除 LICENSE 中原作者版权及必要 NOTICE，不把继承功能写成从零原创。

完成后只需要简要汇报：当前远端 SHA、改动内容、检测过的风险与处理结果、执行过的命令及结果、仍需用户确认的事项。直接开展检查，避免无关提问或任务扩张。
