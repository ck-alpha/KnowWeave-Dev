import { extname } from "node:path";

import { detectFormat } from "./detect";
import { extractDocx } from "./docx";
import { extractHtml } from "./html";
import { extractImage } from "./image";
import { extractMarkdown } from "./markdown";
import { extractPdf } from "./pdf";
import { extractPlain } from "./plain";
import { extractPptx } from "./pptx";
import type { ExtractedSource, SourceFormat } from "./types";
import { extractXlsx } from "./xlsx";

export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;

export function validateSourceFileSize(size: number): void {
  if (size === 0) throw new Error("文件为空，请选择包含内容的文件。");
  if (size > MAX_SOURCE_FILE_BYTES) throw new Error("文件不能超过 20 MiB，请拆分文件后再导入。");
}

/** Upload and Retry must use the same extraction rules and limits. */
export async function extractSourceFile(
  buffer: Buffer,
  filename: string,
  format: SourceFormat = detectFormat(filename, buffer),
): Promise<ExtractedSource> {
  validateSourceFileSize(buffer.length);
  if (extname(filename).toLowerCase() === ".doc") {
    throw new Error("暂不支持旧版 .doc 文件，请在 Word 或 LibreOffice 中另存为 .docx 后导入。");
  }
  let result: ExtractedSource;
  switch (format) {
    case "md":
      result = extractMarkdown(buffer, filename);
      break;
    case "txt": {
      // Unknown formats may be text (e.g. README); reject binary data instead
      // of feeding replacement characters or NUL bytes to a text model.
      const text = new TextDecoder("utf-8", { fatal: true });
      try {
        if (text.decode(buffer).includes("\0")) throw new Error("binary");
      } catch {
        throw new Error(
          "无法识别此文件格式。请使用 UTF-8 文本、Markdown、PDF、DOCX、PPTX、XLSX 或受支持的图片。",
        );
      }
      result = extractPlain(buffer, filename);
      break;
    }
    case "html":
      result = extractHtml(buffer);
      break;
    // URL originals are already extracted Markdown, not raw HTML.
    case "url":
      result = { ...extractMarkdown(buffer, filename), format: "url" };
      break;
    case "docx":
      result = await extractDocx(buffer, filename);
      break;
    case "pptx":
      result = await extractPptx(buffer, filename);
      break;
    case "xlsx":
      result = await extractXlsx(buffer, filename);
      break;
    case "pdf":
      result = await extractPdf(buffer, filename);
      break;
    case "image":
      result = extractImage(buffer, filename);
      break;
    default: {
      const exhaustive: never = format;
      throw new Error(`不支持的文件格式：${String(exhaustive)}`);
    }
  }
  if (result.kind === "text" && !result.content.trim()) {
    throw new Error(
      "文件中没有可提取的文字。若内容是扫描图片，请先 OCR，或单独上传图片并配置视觉模型。",
    );
  }
  return result;
}
