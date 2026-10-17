# KnowWeave 公开前最小检查

日期：2026-10-17（Asia/Shanghai）。这是三轮开发后的发布前检查，不是 Round 04。起始本地 HEAD 与远端 `main` 均为 `45a59e941306caf91db581989a4a600edee5668f`；GitHub API 确认仓库为 private。本次仅修改文档，应用源码、锁文件、检索参数与历史 benchmark 数字均未变。

## 变更与一致性

- 将 [Round 01 复现命令](ROUND_01_ACCEPTANCE.md#复现) 中的个人绝对路径改成 `cd KnowWeave`，并说明从克隆目录的父目录执行。
- 实测 pnpm 10.12.1 的 `pnpm doctor` 执行包管理器内置命令；项目入口应为 `pnpm run doctor`，只核验 Ollama 服务与生成模型 tag。同步 README、Demo、架构及审阅指南；Round 01/02 只修复现说明，Round 03 保留原历史命令并加勘误。
- 澄清检索延迟包含问题向量的 Ollama HTTP 调用，排除的是产品 Query API、Next.js 同步与 Qwen 回答生成。简历明确三路模式仅用于独立 Query，Ingest/Chat 仍用 BM25。
- 原有 23 份已跟踪 Markdown 的 218 个正文相对文件/图片链接有效；官方 Qwen/Nomic 模型页及 embed API 链接可访问。README、简历及 Round 02 报告共 42 个指标/延迟展示值与 [历史结构化结果](evidence/ROUND_02_RESULTS.json) 一致，规模为 5,183/300/339。保留 Hybrid 不全面领先、引用存在不代表事实正确、原始 corpus benchmark 与小型 Wiki Demo 分开的边界。

交付前复核包含新增文件与 README 入口：25 份 Markdown、226 个正文相对文件/图片链接及 1 个片段锚点均有效，`git diff --check` 通过；下方本次结果已逐项与本地证据 JSON 核对。

## 公开内容审计

起始全部 256 个已跟踪文件（253 文本、3 PNG）已检查常见密钥/私钥模式、敏感赋值、认证 URL、个人路径、IP、邮箱及高熵字符串，并人工区分测试假值、模型摘要和公开归属。未发现真实凭据、私人 Wiki、数据集、数据库或本地日志被跟踪；这是规则扫描及人工复核结果，不是不存在任何泄露的保证。当前三张 Round 03 截图已逐张查看，仅见公开 SciFact 内容、相对来源路径与生成 UUID；PNG 只有 IHDR/IDAT/IEND，无 EXIF/XMP/文本字段。

[LICENSE](../LICENSE) 原作者版权完整，与初始提交 blob 相同；[NOTICE](../NOTICE.md) 来源、继承/改造边界及数据许可说明保留。未删除授权声明，未改写历史。

额外检查起始 8 个可达提交的 389 个唯一 blob（377 文本、12 PNG）：常见真实密钥模式未命中，但**历史仍有隐私信息**。全部历史提交 author/committer 含个人 QQ 邮箱，旧 README/验收报告保留个人路径；早期 `docs/upstream/` 也有上游作者路径及个人邮箱隐私清理叙述。9 张历史上游截图逐张查看，其中 `docs/upstream/screenshots/01-home.png`、`07-settings-general.png`、`09-wiki-switcher.png` 的像素中可见上游作者 home 路径/用户名；这些图片已不在当前目录，但仍能从历史读取。历史图像 EXIF/XMP 仅发现尺寸与 Screenshot 注释。当前文件修正不会清除这些历史内容。本轮新提交使用仓库所有者的 GitHub noreply 邮箱，仅作用于本轮提交，不修改用户全局 Git 配置。

## 本次实际验证

执行时间：18:47–18:51。Node 22.23.3、pnpm 10.12.1、Python 3.13.12、Ollama 0.34.4、Chromium 151.0.7922.34。Qwen/Nomic tag 与 digest 与 Round 03 记录一致。

| 命令 / 检查 | 本次结果 |
| --- | --- |
| `pnpm test` | 299 项通过、1 项 OpenRouter smoke 因无 Key 跳过；有 Vite CJS API 弃用提示 |
| `pnpm test:data` | 47 项通过 |
| `pnpm typecheck` | 退出 0 |
| `pnpm lint` | 退出 0，仍有 command-palette/vault-graph 两条既有 Hooks 警告；包级 no-op 不等于完整静态扫描 |
| `pnpm run doctor` | 退出 0，实际核验本地 Ollama 与 `qwen3.8:27b` |
| `NEXT_TELEMETRY_DISABLED=1 pnpm build` | 隔离源码副本生产构建退出 0；复用现有依赖，无重新安装或锁文件变化 |
| `python3 scripts/scifact.py download` / `prepare` | 退出 0；复用并校验已有官方数据，重新生成固定样本，不称为重新联网下载 |
| `python3 scripts/demo_round03.py` | 全流程退出 0：两篇真实导入、3 页、LLM 更新 `mammary-stem-cells`、三模式回答/正文指纹/原文核对通过 |
| `node scripts/demo-browser.mjs` | 退出 0；浏览器新导入第 3 篇，三模式提交、Wiki 引用到完整原文链通过，浏览器错误 0 |
| 自有临时实例停止/重启 | 4 页、3 来源、4 向量保留，5 条页面路由 200，真实 Hybrid 引用 `aldh1`；两次 SIGTERM 后 3003 端口释放（启动器 signal 退出码仍为 1） |

构建/运行使用起始 HEAD 的独立副本，205 个应用、包、脚本及依赖清单文件逐字节核对一致。临时服务通过 `node scripts/local.mjs start --port 3003` 启动，显式指定独立 Wiki/config；现有 3000/3001 服务未停止，未读写个人 Wiki。API Demo 18:50:25–18:50:53，浏览器 18:50:54–18:51:15。手工阅读列表更新明确单列：仅 1 页失效、Hybrid 返回 409，刷新生成 1 页，再次刷新 0 页；不冒充模型自动更新。

完整命令参数、日志、模型信息与原始证据仅在忽略目录 `.local/evidence/pre-public/`：回归 `regression-20261017-184755-1fcd8854/summary.json`；构建/API/浏览器/重启 `release-20261017T184819-4cf6d3/`；隐私审计 `privacy-audit.json`。没有把新截图替换为历史截图或提交完整运行数据。

本次未重新安装依赖或做干净机器安装，未复跑全量 SciFact benchmark、独立 8 项索引生命周期专项、26 项 HTTP 异常专项；本次小样本已覆盖的增量/重启路径见上表。云端、PDF/OCR、中文/多语言、大型 Wiki 与压力测试仍未验证，不借用历史结果充当本次执行。

## 用户公开前仍需确认

1. 当前三张展示截图的最终人工隐私检查，以及是否接受 Git 历史中的个人邮箱、路径与上游历史材料。需要隐藏历史信息时，应另行决定处理方案；本轮未改写历史。
2. 是否公开以及何时公开。仓库保持 private，本轮只推送 `main`。

本轮检查与勘误提交将在交付时补记；最终远端可用 `git ls-remote origin refs/heads/main` 核对，当前测试基线为本报告首段 SHA。
