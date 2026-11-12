/** Presentation only: keep original findings intact for repair-target parsing. */
export function presentLocalIssue(issue: {
  type: string;
  source: string;
  description: string;
  suggestedFix: string | null;
  affectedPages: string[];
}): { description: string; suggestedFix: string | null } {
  const original = { description: issue.description, suggestedFix: issue.suggestedFix };
  if (issue.source !== "local") return original;

  if (issue.type === "broken-link") {
    const match = issue.description.match(
      /^(.+) links to \[\[([a-z0-9-]+)\]\], which doesn't exist$/,
    );
    if (match) {
      return {
        description: `“${match[1]}”链接到了不存在的页面 [[${match[2]}]]。`,
        suggestedFix: issue.suggestedFix
          ? "移除这条失效链接并保留普通文字，或创建对应的知识页面。"
          : null,
      };
    }
  }
  if (issue.type === "orphan") {
    const match = issue.description.match(/^(.+) has no inbound references from other pages$/);
    if (match) {
      return {
        description: `目前没有其他页面引用“${match[1]}”。`,
        suggestedFix: issue.suggestedFix
          ? "在相关页面中补充指向它的链接；如果内容已不再需要，也可以手动删除该页面。"
          : null,
      };
    }
  }
  // Future or unrecognised findings remain readable rather than being guessed at.
  return original;
}

/** Log timestamps are stored as UTC without a zone suffix. */
export function logStampDate(stamp: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp)) return null;
  const iso = stamp.replace(" ", "T");
  const date = new Date(`${iso}:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 16) !== iso) return null;
  return date;
}

export function beijingLogStamp(stamp: string): string {
  const date = logStampDate(stamp);
  if (!date) return stamp;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function relativeFromLogStamp(stamp: string): string {
  const date = logStampDate(stamp);
  if (!date) return stamp;
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return beijingLogStamp(stamp);
}
