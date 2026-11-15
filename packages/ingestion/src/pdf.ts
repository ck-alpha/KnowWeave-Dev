import { parseOfficeAsync } from "officeparser";

import type { ExtractedTextSource } from "./types";

/** Extract the existing text layer locally. This does not OCR scanned pages. */
export async function extractPdf(buffer: Buffer, filename?: string): Promise<ExtractedTextSource> {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF 文件无效，请检查文件后重新上传。");
  }
  let content: string;
  try {
    content = (await parseOfficeAsync(buffer)).trim();
  } catch {
    throw new Error("无法提取 PDF 文字。请确认文件未损坏、未加密，或先另存为文本后导入。");
  }
  if (!content) {
    throw new Error(
      "PDF 中没有可提取的文字层。扫描件请先用 OCR 转成文本，或将页面导出为图片并使用支持图像的视觉模型导入。",
    );
  }
  return {
    kind: "text",
    title: filename ? filename.replace(/\.[^.]+$/, "") : "Untitled PDF",
    format: "pdf",
    content,
    metadata: {
      extractionMethod: "pdf-text",
      warnings: ["仅提取 PDF 文字层；扫描页、图片、图表与复杂排版需核对原件。"],
    },
  };
}
