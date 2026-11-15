/** Textareas normalize CRLF and CR. Keep their offsets separate from saved raw UTF-16 offsets. */
export function excerptDisplayText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

export function excerptRawOffset(raw: string, displayOffset: number): number {
  if (!Number.isSafeInteger(displayOffset) || displayOffset < 0)
    throw new Error("Invalid selection offset");
  let shown = 0;
  let original = 0;
  while (original < raw.length && shown < displayOffset) {
    original += raw[original] === "\r" && raw[original + 1] === "\n" ? 2 : 1;
    shown += 1;
  }
  if (shown !== displayOffset) throw new Error("Selection exceeds source");
  return original;
}

export function excerptDisplayOffset(raw: string, rawOffset: number): number {
  return excerptDisplayText(raw.slice(0, rawOffset)).length;
}

export type ExcerptSelection = {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
};
export type ExcerptNavigationKey = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
};

function previousCharacter(text: string, offset: number): number {
  let next = Math.max(0, offset - 1);
  const code = text.charCodeAt(next);
  const before = text.charCodeAt(next - 1);
  if (code >= 0xdc00 && code <= 0xdfff && before >= 0xd800 && before <= 0xdbff) next -= 1;
  return next;
}

function nextCharacter(text: string, offset: number): number {
  return Math.min(text.length, offset + ((text.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1));
}

/** Chromium readonly textareas may scroll instead of moving a keyboard caret. */
export function navigateExcerptSelection(
  text: string,
  selection: ExcerptSelection,
  event: ExcerptNavigationKey,
): ExcerptSelection | null {
  if (event.isComposing || event.altKey) return null;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return null;
  const documentKey = Boolean(event.ctrlKey || event.metaKey);
  // Leave platform word-navigation shortcuts and input-method commands untouched.
  if (documentKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return null;
  const start = Math.max(0, Math.min(text.length, selection.start));
  const end = Math.max(start, Math.min(text.length, selection.end));
  const focus = selection.direction === "backward" ? start : end;
  const anchor = selection.direction === "backward" ? end : start;
  let next: number;
  if (event.key === "ArrowLeft") {
    next = !event.shiftKey && start !== end ? start : previousCharacter(text, focus);
  } else if (event.key === "ArrowRight") {
    next = !event.shiftKey && start !== end ? end : nextCharacter(text, focus);
  } else if (event.key === "Home") {
    next = documentKey || focus === 0 ? 0 : text.lastIndexOf("\n", focus - 1) + 1;
  } else {
    const newline = text.indexOf("\n", focus);
    next = documentKey || newline === -1 ? text.length : newline;
  }
  if (!event.shiftKey) return { start: next, end: next, direction: "none" };
  return {
    start: Math.min(anchor, next),
    end: Math.max(anchor, next),
    direction: next < anchor ? "backward" : "forward",
  };
}
