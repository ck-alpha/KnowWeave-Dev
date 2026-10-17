# KnowWeave 最终 Demo

这个演示使用 BEIR SciFact 公开原文，展示可维护 Wiki 和证据追溯。它不是检索 benchmark，不能用于计算答案准确率。历史全量检索指标见 [Round 02](ROUND_02_ACCEPTANCE.md)，本轮真实结果见 [Round 03](ROUND_03_ACCEPTANCE.md)。

## 准备与隔离

按 [README](../README.md) 安装 Node 22、pnpm 10.12.1、Python 3.10+ 和 Ollama，下载 Qwen 与 Nomic 模型，执行冻结依赖安装。不要把个人 Wiki 用作演示目录。

```bash
python3 scripts/scifact.py download
python3 scripts/scifact.py prepare
# 终端一；已有目录含页面或来源时，请换一个新目录。
KNOWWAEVE_WIKI_PATH="$PWD/.local/demo-wiki" \
KNOWWAEVE_CONFIG_DIR="$PWD/.local/demo-config" pnpm dev --port 3001
```

生产版可先 `NEXT_TELEMETRY_DISABLED=1 pnpm build`，把上述 `pnpm dev` 换成 `pnpm start`。不要在同一 checkout 一边运行 dev 一边 build，它们共享 Next.js 构建目录。远程机器需转发端口 3001。

```bash
# 终端二
python3 scripts/demo_round03.py --base-url http://127.0.0.1:3001 \
  --wiki-path "$PWD/.local/demo-wiki"
```

脚本核对服务器 Wiki 路径、空库、Ollama 模型槽、官方原始文件和样本 SHA256；任何失败非零退出，已有报告不会覆盖。失败后先读 `.local/evidence/round03/demo-*.json`，修复原因，使用新目录重跑；脚本不自动删除资料。

## 约三分钟演示顺序

| 步骤 | 观察与讲解 |
| --- | --- |
| 1. 来源和 Wiki | API 脚本导入 corpus 45638119 与 16322674，Sources 中查看两篇原文，Wiki 查看生成页面。模型可能更新已有页，也可能新建页；报告分别记录实际结果。 |
| 2. 增量更新 | 第一次导入后建索引，第二次后仅刷新变化页。脚本再通过编辑 API 添加一份明确标为手工的跨文档阅读列表；旧向量立刻失效，Hybrid 返回 409，刷新仅生成 1 页向量，再刷新生成 0 页。 |
| 3. 三模式提问 | Query 中选择 BM25 / Embedding / Hybrid。提问 ALDH1 与预后关系，检查模式、索引状态、回答、取证页；不承诺三路排名必然不同。 |
| 4. 核对原文 | 点击回答里的 Wiki 引用，再点 Sources，核对标题、正文和 `corpus_id=45638119`。来源相关不等于支持问题中的声明；这个例子的原文报告 poor prognosis。 |
| 5. 解释边界 | Wiki 为模型整理层；可追溯不等于正确性保证。索引失效或模型不可用会报错，用户可显式切 BM25。离线检索指标与回答质量分开。 |

默认 API 演示用原始 query 51 的证据核查问句，三个模式都真实调用 Qwen。`--questions 2` 增加第二个样本问题（耗时增加）；模型输出和页名可能变化。

浏览器可用的主要问题：

> Does elevated aldehyde dehydrogenase in breast tumours predict a favorable patient outcome?

可选语义措辞：`Unfavourable survival?`。它在 Round 02 小 Wiki 上出现 BM25 无命中、语义模式有引用的现象；本轮不保证每次重建 Wiki 都复制该差异。不要把演示选例描述成全量质量提升。

## 真实浏览器与截图

需要可运行的 Chromium 可执行文件，无新增 npm 浏览器依赖。默认使用 `chromium`；不在 PATH 时通过 `CHROMIUM_PATH` 或 `--chromium` 指定路径。以已经完成 API 演示的同一个 Wiki 运行：

```bash
node scripts/demo-browser.mjs --base-url http://127.0.0.1:3001 \
  --wiki-path "$PWD/.local/demo-wiki"
```

首次运行真实填写 Sources 表单并导入第 3 篇 corpus 18340282，浏览生成 Wiki，在 Query 点击刷新、逐一提交三个模式，再点击回答内引用到 Wiki 和原文。重复运行若第三篇已成功导入则复用，并在报告中明确标记；这时不算新导入验收。脚本验证实际请求模式、实际正文指纹、来源完整性，直接保存 Chromium 截图，不修改页面内容、模拟请求或合成结果。

默认产物在唯一目录 `.local/evidence/round03/browser-<time>/`，含 `browser.json` 与 `round03-query.png`、`round03-wiki.png`、`round03-source.png`。可用 `--output-dir` 指定目录，但已有 `browser.json` 时拒绝覆盖；本地完整证据可能含路径和来源 UUID，不应整体上传。提交截图之前应人工查看，确认只有公开样本、没有机器路径或密钥。仓库展示图见 [Query](images/round03-query.png)、[Wiki](images/round03-wiki.png)、[原文](images/round03-source.png)。截图是可视区域，完整原文校验基于浏览器 DOM 与 API。

## 常见失败

| 现象 | 处理 |
| --- | --- |
| Wiki 非空或路径不匹配 | 确认两个终端目录一致；完整重跑换新目录，保留已有 Wiki |
| 模型未安装/离线 | 启动 Ollama，核对准确 tag，先 `pnpm doctor`；Nomic 缺失时仍可选择 BM25 |
| 索引 pending / Hybrid 409 | 在 Query 刷新；API 为 `POST /api/retrieval`，空 body 或 `{}` |
| Ingest 失败后出现 pending 来源 | 先看错误，修复后点击来源的 Retry，复用原文；再次 Ingest 会创建另一份来源 |
| 上下文超限 | 减少材料长度或按硬件调整上下文；没有静默截断，也未实现复杂长文分块 |
| LLM 提案将已有页当作新页 | 应用明确拒绝以保护正文和来源，等待其他写入完成后 Retry |
| 浏览器脚本失败 | 保留失败报告；检查 Chromium 可执行路径、端口、页面错误和控件等待，不把脚本超时直接当成产品成功 |

完成后用 Ctrl-C 正常停止应用；仍需演示时用同一配置重启，Markdown、来源与向量存于 Wiki 目录。备份应包含 `.llm-wiki/meta.sqlite`，仅备份 Markdown 不能恢复全部来源关系和用量记录。
