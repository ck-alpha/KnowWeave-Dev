# KnowWeave 开发日志

## 2026-11-12（Asia/Shanghai）— 知识工作台阶段 3 与整体验收

首页由功能卡片目录调整为真实近期更新、待整理来源、阅读统计和继续阅读；使用已有数据读取，不虚构活动或调用模型。统一双层导航、可点击搜索、暖纸与深红主题、键盘焦点、减少动效和窄屏布局，保留已有Onboarding/Graph/Chat/Settings能力。新增16页人工样例生成与严格限定fixture的CDP浏览器脚本；README三张截图来自另一份干净人工样例，PNG未编辑，不算模型生成成果。求职材料补充用户任务、流程取舍、可靠性设计及来源边界。

完整代码检查通过：343项JS/TS、47项Python，1项云端smoke跳过；typecheck、lint、隔离生产构建成功，Next lint无警告，Browserslist缓存提示保留。生产构建副本192个app/package源文件逐一匹配当前工作区。真实Chromium工作流57项、复用/下载18项、跨Wiki10项全部通过，无Runtime/console/HTTP错误；另13项HTTP/实际Qwen/ZIP与7项跨WikiAPI通过。真实文件下载核对回答原问题与引用，软删撤销恢复笔记，跨Wiki同slug切换不残留或覆盖另一库状态。详细事实、首次失败与修正、证据位置、未跑项统一记录于 [PRODUCT_UPGRADE](PRODUCT_UPGRADE.md)。

部署前读取3000/3001旧配置并备份SQLite，保存旧构建后按原环境重启。两实例8路由各自通过、无setup跳转，Wiki/raw逐文件内容hash保持不变，原向量索引分别3/3和4/4 ready。没有对个人Wiki执行导入/模型整理/检查修复。临时验收Wiki、配置、数据库、日志和下载文件均留在忽略目录。阶段0/1/2分别已推送 `a8fb73c`、`1c2ffff`、`9bf9ab4`，本阶段继续独立提交交付当前私有 `origin/main`，不修改公开快照发布边界。

实际实例后续各16项只读Chromium检查通过，包含1440/390宽度、Workspace计数、阅读状态控件和搜索开关，无写请求/截图/浏览器错误。3001既有配置未完成Onboarding，首次按工作台首页断言超时；调整为保留引导和检查新版导航后通过，未改配置或点击跳过。3000新版首页正常。演示脚本3项拒绝边界（非空目录/外部URL/错Wiki路径）通过，文件hash未变；临时验证服务最终停止，保留两实际实例运行。

## 2026-11-12（Asia/Shanghai）— 知识工作台阶段 2

馆藏由类型分组升级为 GET URL 可复现的搜索、标签/类型组合筛选与排序，新增直接写笔记入口，继续复用原有手工创建 API。搜索明确限定标题、slug、标签与目录摘要，未引入新检索策略。阅读页增加实际 Markdown 标题目录、中英文分别估算阅读时间、正文与元数据 Markdown 下载和个人阅读记录。通过 Wiki 身份 key 修复同名 slug 切库状态残留，侧栏同步重挂。

Sources 新增标题/文件/网址搜索、状态/格式筛选及 12 项分批展示；首页待处理链接可进入 `?status=pending`。Query 增加研究比较、工作简报和决策问题模板，不自动调用模型；回答导出保留实际提交的问题、引用及局限，避免输入下一题后把旧答案误标为新问题。导出链接指向当前实例，笔记和回答不自动落入浏览器存储。命令面板新增工作台入口与点击搜索事件，修复显示分组后键盘索引不同步和原 Hooks 警告。

实际验证：馆藏 5 项与回答导出 2 项新增测试通过；当前全套343项JS/TS通过、1项云端smoke跳过，47项Python通过。全工作区与脚本类型检查、Next lint（无warning/error）、隔离生产构建通过。构建未触碰在线 `.next`。首轮真实 Chromium 已覆盖馆藏筛选、目录定位、命令面板、阅读状态/笔记重载与深浅色窄屏；更严格的状态切换、真实下载和最终证据放在阶段3统一记录。

## 2026-11-12（Asia/Shanghai）— 知识工作台阶段 1

新增每 Wiki SQLite 专题、页面状态和多对多归类；保存操作先校验后事务写入。`/workspace` 提供课题/项目管理、收藏、阅读状态和笔记搜索，阅读页个人记录组件复用同一 HTTP。笔记不写正文，不作为检索/模型证据；状态默认未读，表示个人进度。切库按 Wiki 身份重挂载，保存后刷新路由数据。

交叉审查发现原先仅使用外键级联会让「删除→撤销」丢失笔记，改为软删除前保存有版本的回收站 sidecar，撤销恢复个人记录与仍存在的专题，旧回收站兼容。顺带修复回收保留期使用旧正文 mtime 导致刚删就可能过期：删除时重设文件时间。外部直接删除不经过该流程，文件/数据库仍非跨介质原子事务。

原 ZIP 导出排除 `.llm-wiki`，会遗漏不能从 Markdown 重建的个人记录和来源关系；新增 `db.backup` 一致快照进 ZIP，临时目录 finally 清理，设置说明同步范围。实际测试首次发现已安装 archiver v8 无旧 default 工厂方法，改为 `ZipArchive` 并补类型声明后通过。中文文件名使用 RFC 5987，原 ASCII fallback 保留。ZIP 不包含设置/密钥/历史/回收站，且数据库和文档拷贝不是统一时点，内存缓冲仍限制超大库。

阶段实际验证：52 项测试通过（工作台24、Editor23、HTTP3、导出2），涵盖迁移幂等、真实关闭重开、Wiki隔离、正常同步保留状态、事务失败无部分写入、未知字段、同名专题、软删除撤销、已删除专题不复活与损坏sidecar拒绝。导出测试用 Python zipfile/sqlite3 实际读取 ZIP、核对笔记/专题/来源关系和 integrity_check，以及成功/失败清理。全工作区与脚本 typecheck通过。生产构建和浏览器留待整体验收，不把单元测试称为真实浏览器结论。

## 2026-11-12（Asia/Shanghai）— 知识工作台升级：审查与设计

用户要求从科研和知识型办公用户视角审查当前产品、实现重大功能与视觉升级、逐次记录并分阶段推送。基线为 `06b911d`，工作区干净，远程 `origin/main` 与本地一致。审查发现已具备导入、Wiki、检索回答和原文追溯，但课题归类、个人阅读进度、组合查找、内容复用与继续工作的入口不足。决定在现有本地架构上增加专题与阅读工作台，并完善馆藏、问答导出和视觉外壳。详细范围、取舍与分阶段验收见 [PRODUCT_UPGRADE](PRODUCT_UPGRADE.md)。

本节记录设计决策，尚不代表实现完成。专题和笔记独立于 Wiki 正文与模型证据，继续使用每 Wiki SQLite；不新增云服务或登录，不扩大已有检索评测结论。交付目标为现有私有开发仓库，公开快照保持独立发布边界。每阶段代码与架构、进度和实际验证同批提交。

## 2026-10-17（Asia/Shanghai）— Round 01

输入是用户提供的三轮计划与 Round 01 需求；当轮任务明确为 Round 01，LLM 按用户要求使用 **Qwen3.8**。本次后续整理将当前展示名统一为 **KnowWeave**；名称兼容说明见 README，以下保留历史过程及实测事实。

### 审阅与初始化

初始目录仅含任务文档，并无源码或 Git。获取用户指定的开源基线，导入独立 Git 仓库，不设置原作者远端。具体代码来源、基线提交和版权声明集中记录于 [NOTICE](../NOTICE.md)。
审阅 README、设计文档、Ingest/Query/FTS5/来源/模型配置与测试。UI/API、原始解析与 Wiki 工作流属于继承能力，详见 NOTICE。

### 环境

本机原 PATH 无 Node/npm/pnpm，安装官方 Node 22.23.3（SHA256 校验）到 `/opt/knowwaeve-node`，pnpm 10.12.1；原生依赖需要的 libsecret 开发包已补齐，不修改用户 shell profile。
Ollama 0.34.4 可访问，实际安装 tag 为 `qwen3.8:27b` 与 `qwen2.5:14b`；按用户要求仅使用 Qwen3.8。

首次标准兼容 API 调用按模型默认 262K 上下文加载。GPU 驱动/库错配使 Ollama 回退 CPU，分配16GiB KV 缓存后被 OOM killer 终止，服务自动重启。为保持原模型 tag 和避免修改全局服务，增加原生 `/api/chat` 适配，支持请求级上下文8192、生成上限4096、temperature0和关闭thinking；CPU探针曾成功。

用户随后明确要求修复 GPU。检查到内存中模块580.173.02，磁盘DKMS与NVML/CUDA库均580.178.04；没有GPU占用进程或显示服务。停止Ollama，卸载无占用旧模块并加载磁盘新模块，重启Ollama。未重装驱动、未更改服务配置、未重启机器。`nvidia-smi`恢复，Ollama报告66/66层GPU；独立GPU探针成功输出JSON，预热后的第二次调用耗时0.63秒（29个输出token）。最终应用默认上下文设为32768，并按UTF-8字节上界+完整生成预算拒绝过长文本请求，解决固定窗口下静默丢失引用上下文的风险。

### 实现与决策

- 本地入口隔离配置和Wiki，默认绑定127.0.0.1；模型tag先读取`/api/tags`核验。
- 保留内部兼容包名和磁盘格式，收敛产品品牌/说明/云营销内容；当时归档了参考文档和截图，不当成本项目证据；本次整理将这些历史归档移出当前文档树；移除字体构建网络依赖。
- FTS5原来将完整问题按AND连接，可能零命中；改为转义词项OR+原有BM25排序，限制64词。没有实现Hybrid。
- 问答无命中直接返回证据不足；拒绝未实际提供页面的引用；非低置信回答不得无引用。
- 默认启动采用activeWiki，修复UI已切换而实际仍访问旧Wiki的问题；显式路径模式返回明确409。
- Python只负责数据/验收，不作为后端服务。下载/安全解压/校验可重复，保留官方原始文件；小样本按固定qrels规则选取。
- 验收脚本使用真实API，校验输入hash、页面落盘、双向来源和当前问题的相关文献；识别raw保存时的Markdown标题包装，未放宽完整性要求。

### 检查与后续

所有实测结论、限制和运行命令统一见 `ROUND_01_ACCEPTANCE.md`，避免在多份文档复制不同测试计数。生产启动时移除继承的standalone发布模式冲突，直接使用源码checkout的next build/start；修复启动器只停止pnpm却留下Next进程的问题。实际API演示首次被系统HTTP代理转发返回502，已限定loopback直连并补离线回归；最终GPU导入/更新/问答/来源校验通过。
Chromium真实提交问题、点击答案引用并打开原文，完整文本与corpus ID核对通过；页面检查未发现浏览器错误。真实SIGTERM停止启动器后3000端口释放，重新启动后首页与主要API均返回200，服务继续在本地运行。实现已提交为`395747308fb0f888702f224c6be5e3eeefa491ca`，随后在 `4620b8c34040be64404541ffd8160f95310fec6f` 补充最终验收记录；当时未配置远端、未推送。
下一轮仅在本轮验收后实现混合检索与公平评测；本轮不填未测指标，不将上游功能称为从零原创。

## 2026-10-17（Asia/Shanghai）— 个人仓库与审阅文档整理

用户要求以 **KnowWeave** 创建个人 GitHub 仓库，并提交相关文档供 GPT 阅读和验收。当前展示名统一为 KnowWeave；兼容环境变量 `KNOWWAEVE_*`、本机安装路径 `/opt/knowwaeve-node` 及内部包名/磁盘格式保持不变。

更新 README、架构、进度和验收说明，新增 `GPT_REVIEW_GUIDE.md`，按验收条件映射真实源码、测试和复现命令。保留历史实现与验收提交 SHA、210 + 30 项通过、1 项云端跳过、2 条 lint 警告，以及 GPU、小样本和浏览器结果；明确历史实测、文档中可执行的复现方式、尚未运行的新检查之间的区别。

README 增加 VS Code Remote SSH 的 `code --openExternal` 与本机 13000 端口 SSH 转发方式，移除历史归档路径引用。源码归属与继承/改造范围集中在 NOTICE，未宣称全部从零原创。

个人仓库 [ck-alpha/KnowWeave-Dev](https://github.com/ck-alpha/KnowWeave-Dev) 已创建为 private 独立仓库，配置 `origin` 指向该仓库，`main` 用于交付代码与文档；没有 Fork 关系或 upstream 远端。需求文档整理为 `THREE_ROUND_PLAN.md` 和 `ROUND_01_REQUIREMENTS.md`；保留要求实质，名称与来源说明引用统一到当前文档。本次文档整理不产生新的检索指标或 GPU 性能结论；Round 02 的 Embedding / Hybrid / RRF / 全量评测仍未实现。

### 2026-10-17 15:42（Asia/Shanghai）— 交付前再次验证

命名与文档整理后重新运行：`pnpm test` 210 项通过、1 项云端 smoke 跳过，Python 30 项通过；typecheck、lint、build 均退出 0，lint 仍为 2 条 React Hooks 警告。此处记录本次实际重跑，不覆盖前述历史验收。

新生产服务的 `/`、`/about`、`/query`、`/sources`、`/wiki` 均 HTTP 200，HTML 标题为 KnowWeave。真实 Query 使用已有 Wiki，返回 `qwen3.8:27b` 的回答并引用 `aldh1`；驱动 580.178.04，Ollama 显示 `100% GPU`、上下文 32768。Chromium 页面复测 5 项通过、浏览器错误 0，产物为 `.local/evidence/remote-delivery-browser/browser-smoke.json`。原始业务复测产物为 `.local/evidence/remote-delivery-gpu.json`，检查时间 `2026-10-17T15:42:45.787667+08:00`；测试日志使用 `remote-delivery-*` 文件名前缀，必要摘要汇入 `docs/evidence/ROUND_01_RESULTS.json` 的 `remote_delivery_recheck`。

本次业务复测范围为已有 Wiki 的问答与 HTTP 页面检查；首次 SciFact 导入/更新及完整浏览器点击链仍由前述历史验收记录支撑。实际交付版本以远端 `main` 提交为准。

## 2026-10-17（Asia/Shanghai）— 架构文档维护入口

将原 `PROJECT_OVERVIEW.md` 架构正文整理为根目录 `architecture.md`，旧文件保留跳转入口。补充模块职责、服务器访问边界与同提交更新的维护约定；README、GPT 审阅指南、贡献说明和开发指引统一引用该文件，并新增 `AGENTS.md` 供后续开发代理读取维护要求。本次只调整文档，未改变应用代码或运行配置。

源码核对发现原文将 SQLite 元数据笼统描述为“可重建”不够准确：同步仅重建页面元数据、FTS5 和同步状态，不能恢复全部来源关联、用量等记录。架构文档已明确数据库应随 Wiki 备份。

## 2026-10-17（Asia/Shanghai）— Round 02 开发

基线 `92ba903bfb230caabc2ac0458827a1257ca5fbcd`，用户明确要求实现并推送私有仓库 main。启动前读取当前架构及历史验收，确认现有 Wiki 3 页、2 个来源与 Ollama `qwen3.8:27b` 可用。基线回归实跑 210 项通过、1 项云端 smoke 跳过，Python 30 项通过；SciFact download/prepare 再校验为 5,183 篇、300 条 test queries、339 条 qrels。

纠正 README 和历史报告复现命令：`prepare` 只读取已下载数据，干净环境必须先执行 `download`，不修改已经清晰分工的脚本语义。

技术选择：保留 SQLite FTS5/BM25，使用同一个 Wiki 数据库保存文档指纹和向量；先精确余弦扫描，再按固定 k=60、每路 100 候选做等权 RRF。此规模不引入独立向量数据库。索引使用模型 digest、前缀与内容 hash 判定有效性；文档变更即时失效，显式增量刷新，查询只生成问题向量。默认 BM25 保持无需 Embedding 模型的原流程，用户可在 Query 中切换三种模式。原始 SciFact benchmark 直接调用同一检索核心，完全独立于 Qwen Wiki 编译。

模型选择 `nomic-embed-text:v1.5`，通过 Ollama `/api/embed`，按[官方模型卡](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)区分 `search_document:` 与 `search_query:`。按 [Ollama API](https://docs.ollama.com/api/embed) 显式禁用静默截断。执行环境为 Ollama 0.34.4、Node 22.23.3、pnpm 10.12.1，GPU 驱动仍为 580.178.04。本节记录设计与过程；最终实现细节、真实运行结果及未验证范围在 Round 02 验收报告。

审阅修复：原 `buildQueryPrompt` 会隐藏截断正文到 1,000 词，而新增取证字段记录完整正文，二者不能同时宣称“实际上下文”。本轮移除这处截断，沿用 Qwen 上下文预算显式拒绝机制；新增尾部证据回归。向量索引提供 `{force:true}` 全量重建入口与 UI 按钮，修复损坏缓存时仅增量刷新无法恢复的问题；同 Wiki 构建锁按数据库路径隔离，避免每个 HTTP 请求独立数据库连接绕开锁。

实机 Embedding 探针返回 768 维；Ollama `/api/ps` 仍报告有效上下文 2,048，即使请求 `num_ctx=8192`。因此文档与评测保留请求参数和实际 runner 值，不宣称请求参数已生效。完整 5,183 篇摘要用 `truncate:false` 构建成功，无需分块、截断或丢弃长文。

最终全量评测 16:22:35–16:27:02 完成：5183/300/339，900 条排名由 Python 独立重算一致。Hybrid Recall/nDCG/MRR 为 0.822722/0.703476/0.670402；纯向量为 0.843556/0.703265/0.666762。Hybrid 召回更低、nDCG 差异很小，无显著性检验，不宣传全面优胜。首次完整建库后因源码审阅修复中断了部分查询，保留记录，正式重跑使用模型/内容指纹复用全部向量；没有采纳部分指标。

工程验证为 266 项 JS/TS + 36 项 Python 通过、1 项云端 smoke 跳过，typecheck/lint/build 成功；2 条历史 React Hooks 警告仍在。真实 3 模式 Qwen 问答引用 ALDH1 并回到 corpus45638119，语义无词面查询和无关问题路径均通过；8 项真实 Ollama 生命周期通过，可用 `scripts/verify-retrieval.mts` 复跑。Chromium Hybrid 问答到完整原文点击链通过、0 浏览器错误。首次浏览器脚本选中隐藏导航 details 导致等待超时，修正脚本后完整重跑通过；未将脚本故障当成应用缺陷。详见 Round 02 验收和公开 JSON 摘要。

Round 02 实现与首版验收提交 `94464cce3859203a574527df5e7bac560be7b040`。提交后逐文件核对评测 source manifest 与 Git blob，全部一致；后续文档提交仅补记此实现 SHA，不冒充新的实验运行。所有新增文件均经过提交范围检查，未包含数据集、模型、数据库或本地证据原件。


## 2026-10-17（Asia/Shanghai）— Round 03 最终演示与交付

基线 `7b5eb844c8cd0afc0b3bfac2f0dcd9630ae60205`。用户要求完成第三轮、同步文档并推送个人 main；先读取当前架构/进度、Round 02 报告与任务文件。保持既有检索参数和 test 结果，不重新调参、不增加服务或数据集。并行审阅 UI/API、演示脚本和求职文档，再做真实本地集成。

关键可靠性修复：原来同日同标题来源会共用原文文件，重复导入可覆盖旧证据；改为来源 UUID 后缀和排他创建，旧 Wiki 不迁移。提案写入前拒绝重复 slug/现存页被误称 newPage，同 Wiki 应用进程写入互斥。交叉审阅用两个并发 apply 真实复现旧代码的两个成功但后写覆盖前写，补回归验证仅一个成功。此锁不是跨进程事务，不宣称并发压力已验证。

第一次完整生产 API 演示成功导入两篇，Qwen 真实更新 mammary-stem-cells，手工单页更新与刷新通过；随后 BM25 读取使另两页向量失效，Embedding 返回 409。定位到 Ingest 写页规范换行，而索引用未序列化正文且同步状态提前使后续同步跳过。改为读取实际落盘正文建索引并等待同步状态；增加新导入→构建→BM25→Hybrid及更新后查询回归。保留首次失败证据，不把它写成成功运行。进一步用前导空行材料复现手工创建/编辑的同源问题，修复前两项 Hybrid 回归均 INDEX_NOT_READY，改为写后读取真实正文用于索引和响应后通过。此修复不改变原始 SciFact benchmark 输入、检索算法或历史结果。

UI/API 补齐空/异常输入400、重复 Retry/Apply409、Retry审批预览、Office重新提取、PDF/图片提示；来源删除错误不丢元数据并兼容历史共享原文。失败导入及时显示 pending，明确使用 Retry；同页来源操作与新导入互斥，索引失败重读实际状态，缺失来源可见，原文详情使用相对路径。

API Demo 拒绝非空或路径不匹配 Wiki，逐步保留证据。模型是否自动跨文档更新单独记录；稳定的增量验证由明确标注的手工阅读列表执行。Chromium 脚本使用真实 UI 与直接截图，不替换 DOM、不模拟模型响应；截图仅使用公开 SciFact 内容。README/面试材料分别归属继承和二次开发，强调 Hybrid Recall 低于 Embedding、nDCG差异极小及离线指标不是答案正确率。

最终验证、截图位置、残余限制、提交与推送事实见 [ROUND_03_ACCEPTANCE](ROUND_03_ACCEPTANCE.md)；公开摘要仅保留必要结果，完整原文、缓存、数据库、日志及失败运行证据留在 `.local/`。

Round 03 实现与首版验收提交 `171f4ccc49a7b4cad8afd46b6d7e978b6007e47e` 已推送 origin/main，并核对首次远端HEAD一致、仓库仍private。25个变更源码文件逐一核对Git blob与实测SHA256一致；后续文档提交仅补记版本信息，最终远端HEAD见交付回复。

## 2026-10-17（Asia/Shanghai）— 公开前最小检查

起始本地与远端 main 均为 `45a59e941306caf91db581989a4a600edee5668f`，仓库 private。依用户要求只做公开前检查，无 Round 04 或功能扩展。扫描全部已跟踪文件与可达历史，修正 Round 01 复现中的个人绝对路径；保留 LICENSE/NOTICE 和 Git 历史。历史提交邮箱、旧路径及上游材料仍存在，作为所有者公开前确认项。本轮提交改用所有者 GitHub noreply 邮箱，避免新增私人邮箱披露，不修改全局配置。

发现 `pnpm doctor` 在 pnpm 10.12.1 中调用内置命令，不能证明项目模型检查通过；正确入口 `pnpm run doctor` 已实跑成功。当前操作文档同步修正，Round 03 历史命令保留并勘误，不篡改历史验收。按 benchmark 调用链澄清延迟含 Ollama 问题向量 HTTP，不含产品 Query API/Next.js 同步/Qwen 回答；历史数值不变，简历补明独立 Query 范围。

本次重新运行测试、类型检查、lint，并在相同源码的隔离副本构建，避免影响已运行服务。独立 3003 Wiki 真实 API Demo、浏览器新导入第三篇与三模式原文追溯、停止/重启均通过；新增运行产物仅留在忽略目录。实际计数、时间、残余隐私项和未跑专项统一记录于 [PRE_PUBLIC_CHECK](PRE_PUBLIC_CHECK.md)。本轮没有改应用代码、锁文件、检索参数或模型协议，不复跑/调优 Round 02 全量 benchmark，也不更改仓库可见性。

## 2026-10-17（Asia/Shanghai）— 私有仓库改名与独立公开快照发布

依本次要求，原私有仓库已改名为 [ck-alpha/KnowWeave-Dev](https://github.com/ck-alpha/KnowWeave-Dev)，仓库 ID `1423077083`、private 可见性、`main` 分支与原有提交历史保留；本地 `origin` 更新为 `https://github.com/ck-alpha/KnowWeave-Dev.git`。改名前后本地与远端基线均为 `29a34ff6bc76a68ba727f628727d5493d7102bfe`。

当前 README 与已跟踪文档中的私有仓库地址同步为新地址，包括历史提交链接和结构化证据中的地址；历史提交 SHA、实测指标和验收结论不变。产品展示名继续为 KnowWeave。独立公开快照位于相邻 `KnowWeave-Public` 工作区，已发布为非 Fork 的 Public KnowWeave，初始提交 `0db60428e3a65eab79c222fb46e5c68f690202da`，共 226 文件且只有一个无父提交。此次私有工作区仅维护文档，运行架构与源码不变；公开副本只整理展示文案、演示命名和非功能元数据。公开副本实际重跑安装、299 项 JS/TS、47 项 Python、typecheck/lint/build；匿名独立克隆也完成安装/生产构建，公开 HTTP 200、私有匿名 HTTP 404，原 10 个私有历史提交对象均不在公开克隆；完整范围、隐私/历史隔离与匿名复现见 [发布记录](PUBLIC_RELEASE.md)。

## 2026-11-12（Asia/Shanghai）— Remote SSH 自动转发

用户选择继续在服务器运行产品和模型，要求每次打开远程项目即可从本机浏览器访问。增加 [.vscode/settings.json](../.vscode/settings.json)，启用进程检测与转发恢复，明确配置已有服务 `3000` 为 `openBrowser`、`3001` 为 `silent`，其他端口默认忽略。已按当前 VS Code 1.113.0 对应源码核对：显式端口动作允许发现打开工作区前就已监听的端口。本机端口冲突时允许 VS Code 分配可用端口；以 Ports 面板实际地址为准。恢复已有转发不保证再次弹出浏览器。

该配置复用服务器现有应用进程，依赖 Remote SSH 连接和应用处于运行状态；应用启动仍由 `scripts/local.mjs` 负责。同步 README、架构核对日期与进度，并更正进度首页遗漏的公开发布状态。未修改业务代码、模型、数据和服务器监听地址。

实际验证：工作区 JSON 与两端口配置校验通过，修改文档的本地链接目标存在，`git diff --check` 通过；`3000` / `3001` 的 Query 页面均 HTTP 200，索引分别为 3/3、4/4 且 ready，既有服务 PID 保持不变。执行 `code --openExternal http://127.0.0.1:3000` 返回 0，已通过当前 Remote SSH 客户端发出浏览器打开请求；无法在服务器端确认用户 Windows 浏览器画面或关闭/重开项目后的行为。本次为工作区配置与文档变更，未重复执行应用测试或构建。

## 2026-11-12（Asia/Shanghai）— Chat 生产入口静态跳转修复

用户反馈本机浏览器 Chat 找不到输入框或新建入口无反应。排查时两个实例的 Chat 配置均为 Ollama `qwen3.8:27b`，真实 API 新建、中文发送、读取均成功，模型在约 8.3 秒回复。进一步用 Chromium 发现 `/chats` 虽然 HTTP 200，却通过 HTML meta refresh 与 `NEXT_REDIRECT;replace;/;307;` 回到首页；仅检查状态码不能验证页面可用。

根因为 Chat 索引页未声明动态渲染：生产构建清单将 `/chats` 标为 `initialRevalidateSeconds:false`，并在 `chats.html` / `chats.rsc` 中保存了构建时的未配置跳转。运行时 Wiki 已配置，仍持续返回旧跳转。`/chats/[id]` 和 API 原本为动态路由，因此模型调用本身不受影响。

最小修复在 `apps/web/src/app/chats/layout.tsx` 声明 `force-dynamic`，让整段 Chat 页面按请求读取当前 Wiki 设置。没有放宽 setup 条件，也没有修改检索、模型或会话协议。README 补充新建会话与窄屏侧栏入口，架构同步调用链和渲染约定。

隔离副本生产构建成功（含类型检查与 lint，仍有两条既有 Hooks 警告及 Browserslist 数据提示），确认 `/chats` 不再出现在预渲染清单或生成静态 HTML。临时 3002 服务首次手动启动遗漏 pnpm 的模块搜索路径，返回 `Cannot find module 'better-sqlite3'`；复用既有服务环境后通过。此失败发生在隔离验证实例，未替换在线构建。随后保存旧 `.next`，替换新构建并按原有 Wiki/config 环境重启 3000/3001；首页、Chat、Query、Wiki 均 HTTP 200 且无 `NEXT_REDIRECT`，两库索引仍为 3/3、4/4 ready，临时 3002 已停止。

修复后真实 Chromium 验证：3000 桌面 1440 宽进入 `/chats` 不再跳转，点击 `+ New chat` 后底部输入框可见且可编辑；14:20:38–39（Asia/Shanghai）发送中文测试问题，约 1.0 秒显示 Qwen 回复“聊天服务正常”，API 读取确认两条消息持久化。390 窄屏打开 `chats list` 后同样能新建并看到可用输入框。两个测试会话均通过 DELETE 移入回收站，未操作既有会话；3001 桌面/窄屏入口亦通过，无异常跳转。浏览器检查没有 HTTP 4xx/5xx、Runtime 异常或 console error。结果为 `browser-exercise.json`、`browser-demo.json`，截图为 `chats-1440.png`、`chats-390.png`；用户 Windows 浏览器的最终显示仍需用户刷新确认。

本次运行证据和旧构建留在忽略目录 `.local/evidence/chat-diagnostic/`。本次未运行全量单元测试、检索 benchmark 或导入 Demo；针对渲染配置使用真实生产构建和浏览器路径验证。先前 Remote SSH 配置和文档修改保持在工作区，本次未提交或推送。

## 2026-11-12（Asia/Shanghai）— 中英混合界面与 Graph 双视图

用户希望保留部分英文营造简洁的学术感，同时用中文解释操作；随后明确要求网页长期保留 2D / 3D，让用户自行选择。沿用暖纸色、深红强调色和现有字体体系，英文保留在品牌、栏目、短标题与检索术语，中文用于步骤、按钮、表单、状态、错误后备提示和帮助。覆盖首页、Sources、Query、Wiki、Chats、首次引导、帮助与主要设置；资料正文与模型生成内容不翻译。README 和真实浏览器演示脚本同步操作名称，脚本保留旧英文兼容。

Graph 继续使用服务端 `buildGraph` 的原有页面/引用数据，客户端拆出确定性布局和 3D 呈现组件。Map 使用 SVG，Space 按需载入已有 3D 库；共用标题/标签搜索、类型筛选、选择与详情，有向连线、邻接高亮、Wiki 跳转和 `?node=` 深链接。浏览器保存视图偏好，禁用存储不影响切换；WebGL2 不可用时可返回 Map。未增加依赖、API、模型调用或数据库字段。

截图复核发现首版 3D 默认力模拟把节点聚成小团、2D 缩放使文字过小，已改为固定空间坐标与按节点边界/相机视角计算取景；2D 使用固定屏幕字号与标签避让。窄屏压缩标题和统计、类型条横向滚动，详情放到图下方。另修复 Settings 长本地路径造成的窄屏溢出。文案复核顺带纠正 Chat「整理到 Wiki」在审批预览时仍宣称已写入的旧问题：按现有 `kind` 区分待确认/已应用，待确认时提示到 Sources 重试并确认，隐藏尚未写入的页面链接；API 与审批协议不变。

实际验证：

- 最终 `pnpm typecheck` 通过；针对当前源码执行 graph core 7 项与新增布局/筛选 4 项，共 11 项通过（使用 `--exclude '**/.local/**'` 排除历史隔离副本）。此前未排除时命中了历史副本，32 项结果不作为本次测试计数。
- 隔离目录生产构建通过，包含类型与 Next lint 检查；保留 command-palette 的 1 条既有 Hooks 依赖警告和 Browserslist 数据提示。逐文件核对构建副本与当前 apps/packages 源码一致。`node --check scripts/demo-browser.mjs`、文档本地链接和 `git diff --check` 通过。
- 真实 Chromium 使用隔离的 18 页中英文 UI 样例，25 项操作/布局检查通过：双视图、选择/深链接、偏好重载、搜索/类型筛选、无结果/清除、重置、390 窄屏与主要路由无横向溢出；采集 1440 桌面深浅色、390 窄屏截图。浏览器 Runtime/console error 与 HTTP 错误均为 0。WebGL 禁用时切回 2D 单独通过，空 Wiki 返回中文空状态与 Sources 入口；另外 4 项真实键盘、拖动画布、滚轮缩放及重置检查通过（比较操作前后的实际变换，并核对拖动不清除选择）。这里的样例用于界面检查，不计作模型生成或检索评测。
- 保留旧 `.next` 后更新本地 3000 / 3001；两实例首页、Graph、Chats、Query、Sources、Wiki 共 12 个 HTTP 入口均为 200 且无 setup 重定向。原索引分别保持 3/3、4/4 ready。两实例真实 Chromium 各 6 项检查通过，包含实际 Wiki 的 2D/3D、选择保留、窄屏宽度和图谱跳转到正文，无浏览器错误。
- Chat 的 preview/applied 显示分支以模拟响应检查通过，没有为此次文案工作重新调用模型；全量测试、导入 Demo、SciFact benchmark、真实手机触控、大规模 WebGL 性能和用户 Windows 浏览器画面未重新验证。

首次 UI QA 如实发现窄屏路径溢出并修复；后续鼠标检查曾点到 SVG 节点包围盒的空白处、页面跳转检查早于正文完成渲染，调整为实际圆点点击并等待正文后通过。一次 Python loopback 请求受代理影响返回 502，禁用该请求的代理后空图检查成功。完整 QA 主进程曾在输出成功报告后的清理阶段收到 SIGTERM，25 项 JSON 结果完整保留；后续独立交互与两在线实例的短流程均正常退出。没有将这些脚本/环境情况计作产品通过或失败的业务结论。

截图、JSON、日志、隔离样例及旧构建保存在忽略目录 `.local/evidence/ui-refinement/`，未添加到产品数据或 Git。保留任务开始前的 Remote SSH 与 Chat 修复改动，本次未提交或推送。

## 2026-11-12（Asia/Shanghai）— Lint 中文交互

用户在了解 Lint 的用途后要求采用中文交互。本次保留英文栏目与 `Wiki health check` 短标题，主标题改为「Lint · 知识体检」，中文覆盖开始/重新检查、分类、优先级、来源、历史、批量确认、修复状态及后续问题说明。明确检查不会自动改正文，点击修复才写页；「重建页面目录」明确维护 `index.md`，向量索引仍由 Query 刷新。模型给出的整体状态标注为「模型评估」，避免与确定性问题数量混淆。

新增 `lint-presentation.ts`，仅对已知本地断链/缺少引用的英文模板做中文展示映射，未知模板原样保留；原始问题仍用于 slug 提取与修复请求，机器字段和枚举不翻译。历史日志存储格式不变，严格解析 UTC stamp 后在 UI 显示北京时间和中文相对时间。原有「最相关页面」提示改为实际的部分页面覆盖说明，不修改 core 按 slug 取前 60 页的逻辑。

Lint 模型提示词要求 `description`、`suggestedFix`、`suggestedQuestions` 使用简体中文，保留准确 slug、标题、原文引用与 JSON 协议；缺页描述以 `slug + 空格` 开头，兼容现有目标提取。修复摘要 `changeSummary` 使用中文，修复后的正文明确保留原页面语言。没有增加翻译服务、接口字段、数据库字段或额外确认流程。

验证结果：

- 现有 Lint 15 项与 Editor 19 项共 34 项测试通过，排除 `.local` 历史副本；展示 helper 的纯函数断言通过，覆盖原对象不变、未知/模型结果原样、北京时间与无效 stamp。全工作区 `pnpm typecheck` 通过。
- 隔离生产构建通过，保留 command-palette 的 1 条既有 Hooks 依赖警告和 Browserslist 数据提示；构建副本逐文件核对与当前 apps/packages 源码相同。文档相对链接与 `git diff --check` 通过。
- 独立 4 页英文 Wiki 在真实 Chromium 点击「开始检查」，实际调用本地 `qwen3.8:27b`：返回 2 项本地问题、2 项模型问题和 3 个中文后续问题。模型说明/建议为中文，缺页描述准确保留 `backup-guide ` 前缀；本地 API 文案保持旧协议，页面展示为中文。扫描前后 4 个 Wiki Markdown 文件内容逐一相同。
- 浏览器 11 项检查通过，包括中文说明/来源/优先级/时间、修复按钮可用、390 窄屏宽度、实际移除 `workspace-guide` 中的失效链接（保留普通文字）、实际重建页面目录及中文反馈；Runtime/console error 与 HTTP 错误均为 0。截图核对 1440 桌面与 390 窄屏。
- 另在同一隔离 Wiki 调用真实修复 API，将测试句中的 `30 days` 改为 `7 days`，返回 `fix-applied` 与中文摘要；正文仍为英文，原 `[[cache-policy]]` 链接保留。这是界面/语言验证样例，不是实际知识事实或模型质量评测。
- 保留旧构建后更新本地 3000 / 3001。两实例 Lint 桌面/窄屏各 4 项浏览器检查通过，无浏览器错误；Lint、Graph、Query、Chats 共 8 个入口 HTTP 200 且无重定向，既有索引仍为 3/3、4/4 ready。没有在用户实际 Wiki 上运行 Lint 或点击修复。

临时验证服务已停止，证据与旧构建保存在忽略目录 `.local/evidence/lint-chinese/`。未重跑完整测试、导入 Demo、检索 benchmark、大 Wiki 语义覆盖或不同模型的中文遵循度；单次真实输出不代表所有模型都严格遵循语言要求。保留前轮工作区改动，本次未提交或推送。

## 2026-11-12（Asia/Shanghai）— 变更整理与 Git 交付

按用户要求，将上述 Remote SSH 配置、Chat 生产入口修复、中英界面、Graph 2D/3D 和 Lint 中文交互整理为一次代码与文档同步提交，交付目标为私有仓库 `ck-alpha/KnowWeave-Dev` 的 `main`。前面各节的「未提交或推送」描述实现当时的状态；独立公开源码仓库仍保留原发布快照。

提交前已 fetch 并确认本地基线与 `origin/main` 一致；逐文件比较当前 198 个应用/包源码和构建配置，与本轮 Lint 验证成功的隔离构建输入完全一致，沿用上文已记录的类型、构建、相关回归和真实浏览器验证结果，没有把历史全量测试计作本次重跑。交付共 56 个文件，包含 README、架构、开发日志和进度；Wiki 数据、模型、数据库、截图、运行日志、隔离样例与旧构建继续留在忽略目录。
