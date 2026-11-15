import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { detectFormat } from "./detect";
import { extractSourceFile, MAX_SOURCE_FILE_BYTES, validateSourceFileSize } from "./file";
import { extractImage } from "./image";

// Synthetic PDF with an actual xref table and two pages: an empty page and a
// Helvetica text page. The fixture tests PDF.js, not a mocked extraction result.
function pdfFixture(text: string): Buffer {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 6 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

describe("local file extraction", () => {
  it("extracts a real PDF text layer without a vision provider", async () => {
    const result = await extractSourceFile(pdfFixture("KnowWeave PDF evidence"), "paper.pdf");
    expect(result).toMatchObject({ kind: "text", format: "pdf", title: "paper" });
    if (result.kind !== "text") throw new Error("expected extracted text");
    expect(result.content).toContain("KnowWeave PDF evidence");
    expect(result.metadata["warnings"]).toEqual([expect.stringContaining("扫描页")]);
  });

  it("identifies a PDF even if the filename says Markdown", async () => {
    expect(await extractSourceFile(pdfFixture("Actual PDF"), "wrong.md")).toMatchObject({
      kind: "text",
      format: "pdf",
      content: "Actual PDF",
    });
  });

  it("rejects a PDF with no text instead of compiling empty evidence", async () => {
    await expect(extractSourceFile(pdfFixture(""), "scan.pdf")).rejects.toThrow(/文字层.*OCR/);
  });

  it("reports a corrupt PDF as an extraction failure", async () => {
    await expect(
      extractSourceFile(Buffer.from("%PDF-1.4 broken content"), "broken.pdf"),
    ).rejects.toThrow("无法提取 PDF 文字");
  });

  it("extracts Chinese and English from a real DOCX archive", async () => {
    // Hand-authored OOXML containing two paragraphs; no model-generated content.
    const buffer = await readFile(new URL("./fixtures/local-evidence.docx", import.meta.url));
    const result = await extractSourceFile(buffer, "evidence.docx");
    expect(result.kind).toBe("text");
    if (result.kind !== "text") throw new Error("expected extracted text");
    expect(result.content).toContain("KnowWeave 文档解析样例");
    expect(result.content).toContain("Evidence survives local DOCX extraction.");
  });

  it("gives a conversion instruction for legacy Word documents", async () => {
    await expect(
      extractSourceFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), "legacy.DOC"),
    ).rejects.toThrow("另存为 .docx");
  });

  it("keeps DOCX text without sending embedded image data to the text model", async () => {
    const buffer = await readFile(new URL("./fixtures/embedded-image.docx", import.meta.url));
    const result = await extractSourceFile(buffer, "illustrated.docx");
    expect(result).toMatchObject({
      kind: "text",
      format: "docx",
      content: "Text next to the embedded image.",
    });
    expect(result.metadata["embeddedImages"]).toBe(1);
    expect(result.metadata["warnings"]).toEqual([expect.stringContaining("内嵌图片未识别")]);
  });

  it("rejects image-only Word files with an OCR instruction", async () => {
    const buffer = await readFile(new URL("./fixtures/image-only.docx", import.meta.url));
    await expect(extractSourceFile(buffer, "scan.docx")).rejects.toThrow(/没有可提取的文字.*OCR/);
  });

  it("rejects empty content, unsupported binary, and oversized input", async () => {
    await expect(extractSourceFile(Buffer.from("  \n"), "empty.md")).rejects.toThrow(
      "没有可提取的文字",
    );
    await expect(extractSourceFile(Buffer.from([0, 1, 2]), "archive.bin")).rejects.toThrow(
      "无法识别此文件格式",
    );
    await expect(extractSourceFile(Buffer.from([0xff, 0xfe]), "archive.bin")).rejects.toThrow(
      "无法识别此文件格式",
    );
    expect(() => validateSourceFileSize(MAX_SOURCE_FILE_BYTES)).not.toThrow();
    expect(() => validateSourceFileSize(MAX_SOURCE_FILE_BYTES + 1)).toThrow("20 MiB");
    expect(() => validateSourceFileSize(0)).toThrow("文件为空");
  });

  it("keeps saved URL Markdown as text during retry", async () => {
    const result = await extractSourceFile(
      Buffer.from("# Source\n\n**Evidence**"),
      "saved.md",
      "url",
    );
    expect(result).toMatchObject({
      kind: "text",
      format: "url",
      content: "# Source\n\n**Evidence**",
    });
  });
});

describe("vision image identity", () => {
  it.each([
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [Buffer.from("RIFF1234WEBPVP8 "), "image/webp"],
  ])("takes MIME from bytes even under a misleading filename", (buffer, mime) => {
    expect(detectFormat("incorrect.txt", buffer)).toBe("image");
    expect(extractImage(buffer, "incorrect.png")).toMatchObject({
      kind: "vision",
      mediaType: mime,
      base64: buffer.toString("base64"),
    });
  });

  it("rejects a file merely named as an image", () => {
    expect(() => extractImage(Buffer.from("not an image"), "fake.png")).toThrow("图片格式无效");
  });
});
