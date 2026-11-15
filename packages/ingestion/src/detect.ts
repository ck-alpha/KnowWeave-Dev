import { extname } from "node:path";

import type { SourceFormat } from "@llm-wiki/core";

import { imageMediaType } from "./image";

const EXT_MAP: Record<string, SourceFormat> = {
  ".md": "md",
  ".markdown": "md",
  ".txt": "txt",
  ".text": "txt",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
};

// Image MIME validation uses the same byte signatures as the vision extractor.
function sniff(content: Buffer): SourceFormat | null {
  if (content.length === 0) return null;
  // PDF: %PDF-
  if (content.length >= 4 && content.slice(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (imageMediaType(content)) return "image";
  // ZIP signature (DOCX/PPTX/XLSX are all zip-based): PK
  if (content.length >= 2 && content[0] === 0x50 && content[1] === 0x4b) {
    // Can't tell apart without parsing the manifest; leave to filename.
    return null;
  }
  return null;
}

export function detectFormat(filename: string, content?: Buffer): SourceFormat {
  const sniffed = content ? sniff(content) : null;
  if (sniffed) return sniffed;
  const ext = extname(filename).toLowerCase();
  const fromExt = EXT_MAP[ext];
  if (fromExt) return fromExt;
  // Default to plain text. We never treat unknown files as binary here —
  // the LLM-side extractors (PDF, image) require explicit format anyway.
  return "txt";
}

export function detectFormatFromUrl(url: string): SourceFormat {
  // URLs are HTML by default; specific paths can hint at PDFs etc.
  try {
    const u = new URL(url);
    const ext = extname(u.pathname).toLowerCase();
    return EXT_MAP[ext] ?? "url";
  } catch {
    return "url";
  }
}
