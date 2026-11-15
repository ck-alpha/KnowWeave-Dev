import type { ExtractedVisionSource } from "./types";

/** Use bytes, not the uploaded filename, for the multimodal MIME type. */
export function imageMediaType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

export function extractImage(buffer: Buffer, filename?: string): ExtractedVisionSource {
  const mediaType = imageMediaType(buffer);
  if (!mediaType) throw new Error("图片格式无效或不受支持，请使用 PNG、JPEG 或 WebP 文件。");
  return {
    kind: "vision",
    title: filename ? filename.replace(/\.[^.]+$/, "") : "Untitled image",
    format: "image",
    base64: buffer.toString("base64"),
    mediaType,
    sizeBytes: buffer.length,
    metadata: {},
  };
}
