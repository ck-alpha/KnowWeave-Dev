# KnowWaeve SciFact 数据流程

本轮仅用少量 SciFact 原文演示 Source → Ingest → Wiki → 问答与引用。完整语料、查询及 qrels 留作 Round 02 检索评测输入；小型 Wiki 演示不代表完整 benchmark，也不计算或宣称检索性能提升。

## 获取与复现

需要 Python 3.9+，仅使用标准库，无需安装 `beir` 或 Python 第三方包。在项目根目录执行：

```bash
python3 scripts/scifact.py download
python3 scripts/scifact.py prepare
python3 -m unittest discover -s tests -p 'test_scifact.py' -v
```

下载使用 [BEIR 官方 SciFact ZIP](https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip)，按 [BEIR 官方数据表](https://github.com/beir-cellar/beir#available-datasets) 的 MD5 `5f7d1de60b170fc8027bb7898e2efca1` 校验，再解压。脚本拒绝 ZIP 路径穿越、符号链接、重复文件和异常大小。下载或解压失败不会发布半成品数据目录；重复运行会验证并复用缓存、核对已有原始文件，不静默覆盖修改后的数据。

默认目录：

```text
data/
  scifact.zip                  # 下载缓存，保留官方 ZIP
  scifact/
    corpus.jsonl               # 原始 corpus，保持字节不变
    queries.jsonl              # 原始查询，包含多个 split 的查询
    qrels/test.tsv             # BEIR test 相关性标注
    qrels/train.tsv            # ZIP 自带的 train 标注，原样保留
    download-manifest.json     # ZIP 与原始文件校验值、完整数据统计
  scifact-demo/
    manifest.json              # 选择参数、原始 ID、相关性、输入/输出 SHA256
    documents/01.txt           # 标题、完整摘要、原始 corpus ID
    documents/02.txt
    documents/03.txt
```

`data/` 是本地运行产物，不应提交 Git。下载出错时命令会返回非零退出码并给出原因；校验失败的缓存需删除后重试，已存在但被改动的数据请使用新的 `--data-dir`，以保留修改内容。

可选参数：

```bash
python3 scripts/scifact.py download --data-dir /tmp/knowwaeve-data/scifact
python3 scripts/scifact.py prepare --data-dir /tmp/knowwaeve-data/scifact \
  --output-dir /tmp/knowwaeve-data/demo-cancer-2 --count 2 --topic cancer
```

默认 `--count 3 --topic cancer`。只考虑 `qrels/test.tsv` 中的查询，按数值 query ID 排序，对查询原文做大小写不敏感的主题子串筛选。每个查询按相关性分数降序、corpus ID 升序选择一篇尚未选择且分数大于零的原文，直到得到指定篇数。`--topic ''` 可取消主题筛选。数量不足时明确失败，不悄悄缩小样本。输出与输入目录必须分开；相同参数可以重复执行，不同参数应使用不同 `--output-dir`。

## 导入接口与溯源

`manifest.json` 为下游导入脚本提供稳定接口，`schema_version` 为 `1`：

| 字段 | 含义 |
| --- | --- |
| `documents[].corpus_id` | `corpus.jsonl` 的原始 `_id`，字符串 |
| `documents[].title` | 原始文献标题 |
| `documents[].file` | 相对 manifest 所在目录的 UTF-8 文本路径 |
| `documents[].sha256` | 该导入文本的 SHA256 |
| `documents[].relevant_queries` | 本次所选查询中指向本文的 query ID 与相关性分数 |
| `queries[].query_id` / `text` | 原始 query ID 与原文 claim |
| `queries[].demo_question` | 对原始 claim 添加证据核查问句，便于聊天演示 |
| `queries[].qrels` | 该查询的全部原始 test qrels；`included` 标记相关文献是否在演示集合中 |
| `input_sha256` | 原始 corpus、queries、test qrels 的字节级指纹 |
| `selection` / `statistics` | 固定选择参数及完整输入规模 |

下游逐个读取 `documents[].file`，通过应用现有 Source 创建和 Ingest 路径导入；应把 `corpus_id` 与应用分配的 Source ID 一起记录。脚本本身只负责数据准备，不直接改写数据库或调用 LLM。演示问答使用 `queries[].demo_question`，检查回答中的引用能否指回 Source、原始标题与 corpus ID。

SciFact queries 是待核查的科学声明，不能自动当作已证实事实。BEIR qrels 的正分表示检索相关性，不代表原文支持该声明；可能存在反驳证据。生成 Wiki 与问答时应区分原文证据、声明和模型总结。

## 来源、许可和署名

数据源于 Wadden 等人在 EMNLP 2020 发表的 [Fact or Fiction: Verifying Scientific Claims](https://arxiv.org/abs/2004.14974)，本项目使用 [BEIR](https://github.com/beir-cellar/beir) 整理的检索格式。

根据 [SciFact 官方 LICENSE.md](https://github.com/allenai/scifact/blob/master/LICENSE.md)（2026-10-17 核对）：claims 与 evidence annotations 采用 **CC BY 4.0**，corpus abstracts 来自 Semantic Scholar S2ORC，采用 **ODC-By 1.0**；原始 SciFact 代码采用 Apache 2.0。数据许可与 KnowWaeve 的 MIT 代码许可分开记录，不能将全部数据标作 MIT 或 Apache 2.0。项目仅提供获取脚本与溯源说明，下载的原始数据和生成的演示文件不进入代码仓库。[BEIR 数据说明](https://github.com/beir-cellar/beir/wiki/Datasets-available#disclaimer) 也要求使用者遵守原数据集许可并引用数据作者。

正式发布评测时应同时引用 SciFact 论文及 [BEIR 论文](https://openreview.net/forum?id=wCu6T5xFjeJ)，保留原始 ID、版本指纹、split 和参数。Round 02 应直接索引原始 corpus 并使用同一套原始 queries/qrels 比较 BM25、Embedding、Hybrid，不把 Wiki 重写后的内容当作原始 SciFact 语料。

## 验证范围

离线测试覆盖校验失败不发布下载、可信缓存复用、原始文件保护、ZIP 路径与符号链接安全、解压大小上限、重复 ID/失效 qrels 引用、确定性选择、完整相关性溯源及重复运行。网络下载和实际 Ingest/问答分别作为集成验证，不能由这些单元测试的通过推断已完成。

2026-10-17 实测：14 项离线测试通过；使用 Python 标准库从官方地址下载成功，MD5 匹配，`download` 与 `prepare` 重复执行成功。实测完整数据为 5,183 篇 corpus、1,109 条 queries、300 条 test queries、339 条 test qrels。ZIP 大小为 2,816,079 字节，SHA256 为 `536e14446a0ba56ed1398ab1055f39fe852686ecad24a6306c80c490fa8e0165`。

默认样例按顺序选中 `query_id=51 → corpus_id=45638119`、`179 → 16322674`、`185 → 18340282`，主题均涉及乳腺癌。query 179 的另外三篇相关文献未进入演示样本，manifest 中仍保留它们的 ID、分数及 `included=false`。这些结果只证明数据准备和溯源；LLM 导入与引用问答结果见 Round 01 验收报告。
