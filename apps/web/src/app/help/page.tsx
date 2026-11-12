import Link from "next/link";

import { Card, PageContainer, PageHeader } from "@/components/page-shell";

export default function HelpPage() {
  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="KnowWeave"
        title="Quick start"
        description="从一份资料开始，整理知识、提出问题，再沿引用核对原文。"
      />
      <div className="space-y-6 text-body leading-relaxed">
        <Card>
          <h2 className="font-display text-h2 font-semibold">01 · 设置知识库</h2>
          <p className="mt-3 text-muted-foreground">
            为 Wiki 设置一个明确的主题。在 Settings → Models 中选择
            Ollama，并填写本机已安装的模型名称。 使用本地模型无需 OpenRouter 密钥。你可以查看{" "}
            <Link href="/local-models" className="text-primary underline underline-offset-2">
              本地模型配置指南
            </Link>{" "}
            检查连接；在 Settings → Wikis 中创建或切换独立知识库。若启动配置固定了 Wiki 目录，请按
            Wikis 页提示调整。
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">02 · 添加资料，整理为 Wiki</h2>
          <p className="mt-3 text-muted-foreground">
            打开{" "}
            <Link href="/sources" className="text-primary underline underline-offset-2">
              Sources
            </Link>{" "}
            ，粘贴文本、上传支持的文件或输入网址，再点击「导入并整理」。原始资料会保留，模型会据此创建或更新关联的
            Wiki 页面。 如果在 Settings → General 中开启了导入审批，请先检查提案，再点击「确认并写入
            Wiki」。
          </p>
          <p className="mt-3 text-muted-foreground">
            建议先用一篇简短文本体验完整流程。仓库 README 提供了可复现的 SciFact 小样本演示步骤。
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">03 · 提问，并核对依据</h2>
          <p className="mt-3 text-muted-foreground">
            <Link href="/query" className="text-primary underline underline-offset-2">
              Query
            </Link>{" "}
            用于单次问答，Chats 用于多轮对话。Query 默认使用 BM25；首次使用 Embedding 或 Hybrid 前，
            先点击「构建 / 刷新向量索引」。收到回答后，点击 Wiki 引用，再沿 Sources
            返回原文，检查证据是否支持结论。 有价值的回答也可以保存为 Wiki 页面。
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">04 · 浏览关系，持续维护</h2>
          <p className="mt-3 text-muted-foreground">
            在 Wiki 中浏览、编辑页面或查看历史；Graph 将页面之间已有的链接呈现为知识图谱，支持切换
            2D 与 3D。 Lint 检查链接、索引和语义问题；Schema 用于调整知识库的整理规则；Log
            记录变更。
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Local files</h2>
          <pre className="mt-3 overflow-x-auto text-caption">{`<wiki folder>/
├── CLAUDE.md       知识库结构与模型指引
├── index.md        页面目录
├── log.md          变更记录
├── raw/            原始资料
├── wiki/           知识页面
├── chats/          对话记录
└── .llm-wiki/      元数据、设置与历史`}</pre>
          <p className="mt-3 text-muted-foreground">
            知识库保存在本地文件夹中。升级前请备份整个 Wiki 文件夹；安装、更新及启动命令见仓库
            README。
          </p>
        </Card>
        <div className="flex gap-6 text-ui">
          <Link href="/about" className="text-primary underline underline-offset-2">
            关于 KnowWeave
          </Link>
          <Link href="/developers" className="text-primary underline underline-offset-2">
            开发者说明
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
