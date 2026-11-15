import mammoth from "mammoth";
import TurndownService from "turndown";

import type { ExtractedTextSource } from "./types";

export async function extractDocx(buffer: Buffer, filename?: string): Promise<ExtractedTextSource> {
  // Extract text and structure only. Mammoth's default embeds images as base64
  // data URLs, which are not OCR evidence and can exhaust the text model context.
  let embeddedImages = 0;
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async () => {
        embeddedImages += 1;
        return { src: "" };
      }),
    },
  );
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    bulletListMarker: "-",
  });
  turndown.remove("img");
  const content = turndown.turndown(result.value).trim();
  const title = deriveTitle(content, filename);

  const messages = result.messages
    .filter((m) => m.type === "warning" || m.type === "error")
    .map((m) => m.message);

  return {
    kind: "text",
    title,
    content,
    format: "docx",
    metadata: {
      ...(messages.length > 0 ? { mammothMessages: messages } : {}),
      ...(embeddedImages > 0
        ? {
            embeddedImages,
            warnings: ["已提取 Word 文字；内嵌图片未识别，请单独上传图片并使用视觉模型。"],
          }
        : {}),
    },
  };
}

function deriveTitle(content: string, filename: string | undefined): string {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
    return trimmed.slice(0, 120);
  }
  if (filename) return filename.replace(/\.[^.]+$/, "");
  return "Untitled document";
}
