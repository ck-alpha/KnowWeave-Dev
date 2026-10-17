# KnowWeave — Round 03 验收报告

日期：2026-10-17（Asia/Shanghai）。本轮面向最终 Demo、可复现流程和实习展示，保留 Round 02 检索算法与指标，不按 SciFact test 标签调参。本机验收不等于外部独立复现。

## 版本与范围

开发基线：`7b5eb844c8cd0afc0b3bfac2f0dcd9630ae60205`。测试和真实演示在其上的工作树执行；实现提交为 [`171f4ccc49a7b4cad8afd46b6d7e978b6007e47e`](https://github.com/ck-alpha/KnowWeave/commit/171f4ccc49a7b4cad8afd46b6d7e978b6007e47e)，25个变更源码文件的提交blob与实测记录SHA256逐一一致。代码、架构、进度和本报告一起提交，随后仅补充实现 SHA 的交付记录。仓库 [ck-alpha/KnowWeave](https://github.com/ck-alpha/KnowWeave) 保持 private，交付 main，不设置第三方远端。

必要公开结果见 [结构化摘要](evidence/ROUND_03_RESULTS.json)，完整运行证据留在忽略目录 `.local/evidence/round03/`。历史检索结果继续引用 [Round 02 验收](ROUND_02_ACCEPTANCE.md) 的 94464cc 实现及其源码指纹，不把本次稳定性修复写成新 benchmark。

## 实际实现

| 问题 | 最终行为与位置 |
| --- | --- |
| 同日同标题导入覆盖原文 | [ingest.ts](../packages/core/src/ingest.ts) 使用来源 UUID 文件名并排他创建；每次导入仍是独立来源，不迁移已有 Wiki |
| 异常/并发提案覆盖现存页面 | 写入前拒绝重复 slug 和现存页被误称为新页；同 Wiki 同应用进程写入互斥，保留原来源和正文 |
| 新索引在首次查询失效 | Ingest及手工创建/编辑使用实际落盘正文建立检索文档指纹，等待同步状态完成，避免 Markdown 换行规范化造成不一致 |
| 输入与重试流程不清楚 | [API 回归](../tests/source-api.test.ts) 覆盖空/异常输入400；已完成来源 Retry/Apply409，Retry遵守审批并支持预览，失败原文仍可复用 |
| 删除来源丢失元数据或共用原文 | 非ENOENT的 I/O 错误保留来源；历史共享文件有其他引用时不移动；Wiki明确提示已删除来源 |
| 索引状态滞后 | [Query UI](../apps/web/src/app/query/query-view.tsx) 区分空库、pending、模型问题、刷新数量；失败后重读，切模式/窗口聚焦时核对；不静默回退 |
| Demo 与简历归属混淆 | [双层 Demo](DEMO.md)、真实截图、[双岗位材料](CAREER_PRESENTATION.md)、README 和 NOTICE 明确继承/新增、手工/LLM更新及检索/回答质量边界 |

兼容的 `KNOWWAEVE_*` 变量、内部包名、Markdown/SQLite 目录保留。PDF/图片的 Retry 明确提示转换文本或重新上传；Office 重新提取代码有回归，未宣称本轮真实 Office/PDF 端到端验证。

## 本机验证

最终代码检查：**299 项 JS/TS 通过、1 项云端 smoke 跳过；47 项 Python 通过**。typecheck、lint、生产 build 均退出 0；lint 保留 2 条继承 React Hooks 警告（command-palette、vault-graph），不写成零警告。新增针对来源保护、API异常/审批与正文规范化的回归；没有新增框架依赖。具体命令如下：

```bash
# 本机 Node 位于 /opt/knowwaeve-node/bin；其他环境使用自己的 Node 22。
export PATH=/opt/knowwaeve-node/bin:$PATH
pnpm install --frozen-lockfile
pnpm doctor  # 当时实际命令；触发 pnpm 内置检查，项目检查应使用 pnpm run doctor
pnpm test
pnpm test:data
pnpm typecheck
pnpm lint
NEXT_TELEMETRY_DISABLED=1 pnpm build
python3 scripts/scifact.py download
python3 scripts/scifact.py prepare
```

冻结安装在现有依赖环境成功，未更新 lockfile或框架；提示 esbuild 安装脚本未批准，现有平台二进制实际通过测试和构建。未做全新操作系统/无缓存机器安装。独立复现需要按 README 安装 Ollama 与两个模型，`pnpm run doctor` 仅核验服务与生成模型 tag，不检查 Nomic 或下载模型；注册表同名 tag 可更新，应记录实际 digest。

发布前勘误：上面历史执行的 `pnpm doctor` 不能作为项目模型检查证据；本次正确入口的实测另见 [公开前检查](PRE_PUBLIC_CHECK.md)，不改写本轮历史命令或测试事实。

运行环境：Linux x64、Node 22.23.3、pnpm 10.12.1、Python 3.13.12、Ollama 0.34.4、Chromium 151.0.7922.34。GPU 系统报告 NVIDIA GeForce RTX 4090 / 49,140 MiB，驱动 580.178.04；这是本机报告，不作为通常硬件规格或延迟承诺。Qwen digest `aaee06c39dcf2437cde036998d960e1fc1494b8191be7cc9657d01e509097813`；Nomic digest `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`。`/api/ps` 实报 Qwen context32768、Nomic2048，两者均有 GPU 驻留；Nomic请求8192不等于实际生效8192。

### 真实 API 与浏览器

**最终完整演示通过**：API 17:36:53–17:37:14，浏览器 17:37:14–17:37:33（Asia/Shanghai）。两篇API导入生成3页，第二篇真实更新 `mammary-stem-cells`；第三篇通过浏览器导入后共4页/3来源。三模式均返回有引用回答并核对原文；浏览器错误0。单页手工编辑后pending=1，Hybrid409；刷新生成1页、再次生成0页。SIGTERM后3001释放，重启后4页/3来源/4个向量保留、5个路由200，真实Hybrid再次引用 `aldh1`。默认3000服务也已用最终生产构建重启，既有Wiki保留，5条页面路由200。

生产演示使用独立 Wiki，所有来源来自官方 SciFact 样本，没有访问用户日常 Wiki。实际命令（浏览器路径用本机可执行文件替代）：

```bash
KNOWWAEVE_WIKI_PATH="$PWD/.local/round03-delivery-wiki" \
KNOWWAEVE_CONFIG_DIR="$PWD/.local/round03-delivery-config" pnpm start --port 3001
# 另一个终端
python3 scripts/demo_round03.py --base-url http://127.0.0.1:3001 \
  --wiki-path "$PWD/.local/round03-delivery-wiki" \
  --output .local/evidence/round03/demo-delivery.json
CHROMIUM_PATH="<本机 Chromium 可执行文件>" node scripts/demo-browser.mjs \
  --base-url http://127.0.0.1:3001 --wiki-path "$PWD/.local/round03-delivery-wiki" \
  --output-dir .local/evidence/round03/browser-delivery
```

API 演示首先导入 corpus45638119 与16322674，每篇核验来源原文SHA256、生成页、来源UUID和向量数量；单独记录实际模型旧页更新。接着通过真实编辑API追加手工跨文档阅读列表，验证只有1页失效、Hybrid409、刷新1页、再次刷新0页，再核验三模式回答引用、实际供给正文指纹和原始来源。BM25零命中须返回低置信无引用且不生成答案。

浏览器首次真实填写表单导入 corpus18340282，打开 Wiki、点击构建索引、分别选择三个模式并提交同一问题，再点击回答内 Wiki 引用与 Sources 到原文。生成模型均为 `qwen3.8:27b`，无模拟响应。完整渲染原文按 manifest 逐字节SHA校验及空白规范化显示比较；不把 Markdown 标题标记当成可见文字。

### 异常与生命周期

真实HTTP专项在独立3002实例上执行，配置故意不存在的Embedding模型，26项检查全部通过：空/JSONnull400、缺模型GET可读和Hybrid/刷新503、BM25无命中200低置信、缺页/来源404；两份同标题超长材料均ContextLengthError400并保存独立pending原文，删除一份不影响另一份hash。本专项没有生成推理调用，也没有停止系统Ollama。停止自己的启动器后3002释放。异常模型响应与审批预览等其他边界以单元测试覆盖；下方生命周期另检验不可达Ollama地址和缺失模型，不冒充主动中断系统服务或真实坏模型实验。

真实 Nomic 索引生命周期脚本 `pnpm exec tsx scripts/verify-retrieval.mts` 本轮重新运行8项全部通过（初建、语义改写、重启复用、更新、删除、外部编辑、跨Wiki、离线/缺模型），不调用Qwen。其旧默认输出位于Round02目录，执行时保留并恢复了历史文件，新的结果另存 `round03/index-lifecycle.json`。

服务生命周期最终结果见结构化摘要；使用SIGTERM停止启动器，核对端口释放，再以相同Wiki重启并检查页面、来源、索引与真实Hybrid问答。启动器对signal退出沿用非零码，不影响已核验的进程组关闭与端口释放。

## 失败记录与修复

- 首次API演示导入/更新、刷新及BM25通过，随后Embedding409。原因是Ingest索引了序列化前正文，换行差异使首次读取失效；已修并补新建与更新回归；进一步复现并修复手工创建/编辑前导空行造成的同源问题，两个新回归修复前确实失败。失败原件保留为 `demo-attempt1.json`。
- 首次浏览器脚本点到手工阅读列表的target blank链接，等待当前标签页超时；改为选择Sources区的原生站内链接。第二次脚本将原文Markdown标题的`#`与渲染文本比较，误判不完整；改为对manifest完整原始文本与hash校验。第三次发现客户端路由已改变但原文 DOM 尚未完成替换，补上 Raw content 标题等待。三次实际页面均无console/网络错误，失败报告保留于 `browser-final/`、`browser-release/`、`browser-verified/`。先在已有示例验证修正的选择器与完整正文校验，再用新 Wiki 重新执行完整链路，不把失败报告算通过。
- HTTP异常harness最初继承系统代理导致就绪检查失败；关闭自己的实例后禁用loopback代理重跑，最终报告保留备注。产品服务与系统Ollama未被故障实验改动。

## 截图、限制与提交检查

展示截图：[Query](images/round03-query.png)、[Wiki](images/round03-wiki.png)、[原文](images/round03-source.png)。图片来自Chromium直接截图，只显示公开SciFact内容；未拼接或伪造UI/benchmark。完整原文校验基于DOM，图片是可视区域。数据来源、论文和许可见 [SCIFACT](SCIFACT.md)；截图不改变原始资料许可。

没有新增检索算法或改变Round02参数/数字。Hybrid Recall低于Embedding，nDCG差异极小，无显著性检验；本轮小样本不能证明答案正确率。中文/多语言、复杂长文分块、PDF/OCR、大型Wiki、多进程并发与压力未验证。进程内写入保护不构成跨文件/SQLite事务；极端磁盘故障、外部编辑器并发仍需备份。不存在MCP、GraphRAG、登录、多租户或云部署。

提交检查保留LICENSE原文与NOTICE归属，不提交模型、原始数据、数据库、配置、密钥和完整本地运行证据。`.gitignore`继续隔离 `.local/`、`data/`、环境文件和SQLite；公开JSON只保留必要摘要。实现提交 `171f4ccc49a7b4cad8afd46b6d7e978b6007e47e` 已推送 origin/main，首次交付远端HEAD核对一致。随后仅以文档提交补记此SHA，不改变实测代码或重新声称跑过测试；最终文档提交与远端HEAD由交付回复记录，可用 `git ls-remote origin refs/heads/main` 核对。
