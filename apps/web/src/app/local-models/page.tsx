import Link from "next/link";

import { Card, PageContainer, PageHeader } from "@/components/page-shell";

export default function LocalModelsPage() {
  return (
    <PageContainer width="lg">
      <PageHeader
        eyebrow="KnowWeave setup"
        title="Ollama and local Qwen"
        description="连接本地 Ollama，让 Qwen 完成资料整理、问答、对话和知识库检查。"
      />
      <div className="space-y-6 text-body leading-relaxed">
        <Card>
          <h2 className="font-display text-h2 font-semibold">01 · 检查 Ollama 服务</h2>
          <p className="mt-3 text-muted-foreground">
            确认 Ollama 已启动，再查看已安装模型。本项目默认使用 <code>qwen3.8:27b</code>；
            填写模型名称时，请与 <code>ollama list</code> 中的完整 tag 保持一致。
          </p>
          <pre className="mt-3 overflow-x-auto text-caption">{`ollama --version
ollama list
curl http://127.0.0.1:11434/api/tags
# 仅在 Ollama 尚未运行时执行：
ollama serve`}</pre>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">02 · 选择模型并保存</h2>
          <p className="mt-3 text-muted-foreground">
            进入{" "}
            <Link href="/settings?tab=models" className="text-primary underline underline-offset-2">
              Settings → Models
            </Link>
            ，为所需操作选择 Ollama，并填写已安装的模型 tag，然后保存。本地 Ollama 无需 API key。
          </p>
          <p className="mt-3 text-muted-foreground">
            PDF 文字层和 Word .docx 会先在本地提取正文，再交给 ingest 模型。 图片需要支持图像输入的
            vision 模型；扫描 PDF 请先 OCR 转为文本或逐页导出图片。
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">03 · 用一份短资料试一试</h2>
          <p className="mt-3 text-muted-foreground">
            在 Sources 中添加一份短文档并点击「导入并整理」，查看生成的 Wiki 页面，再到 Query 提问。
            点击回答中的页面引用，然后打开原始来源，核对模型的依据。仓库 README
            提供了可复现的小样本流程。
          </p>
        </Card>
        <Card>
          <h2 className="font-display text-h2 font-semibold">Troubleshooting</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>连接被拒绝：确认运行本应用的服务器能够访问 Ollama。</li>
            <li>
              找不到模型：对照 <code>ollama list</code>，检查 Settings 中的名称及完整 tag。
            </li>
            <li>
              自定义地址：启动前设置 <code>OLLAMA_BASE_URL</code> 并重启应用，默认地址为{" "}
              <code>http://127.0.0.1:11434</code>。
            </li>
            <li>响应较慢：首次调用需要加载模型，耗时也受硬件影响；可以先使用较短文本。</li>
            <li>模型输出格式有误：查看错误详情，尝试缩短资料后重试。</li>
          </ul>
        </Card>
        <Link href="/help" className="inline-block text-primary underline underline-offset-2">
          返回使用指南 →
        </Link>
      </div>
    </PageContainer>
  );
}
