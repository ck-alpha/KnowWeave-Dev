import { describe, expect, it } from "vitest";

import {
  prefillResearchTemplate,
  RESEARCH_TEMPLATES,
} from "../apps/web/src/lib/research-templates";

describe("research template draft safeguards", () => {
  it.each(RESEARCH_TEMPLATES)(
    "prefills $label without changing the title or the original empty draft",
    (template) => {
      const draft = { title: "我的研究问题", type: "concept", content: "" };
      const result = prefillResearchTemplate(draft, template.id);
      expect(result.title).toBe("我的研究问题");
      expect(result.content).toContain("个人研究草稿");
      expect(result.content).toContain("## 原文证据");
      expect(result.content).toContain("局限");
      expect(result.content).toContain("个人判断");
      expect(result.content).toContain("下一步");
      expect(result.content).toContain("待核对");
      expect(result.content).not.toContain("- [x]");
      expect(result.content).not.toContain("[[");
      expect(draft).toEqual({ title: "我的研究问题", type: "concept", content: "" });
    },
  );

  it("does not replace a user's existing text, even with a different template selected", () => {
    const draft = { title: "已编辑", type: "overview", content: "  我的初步观察，不要覆盖。\n" };
    expect(prefillResearchTemplate(draft, "comparison")).toBe(draft);
    const filled = prefillResearchTemplate({ ...draft, content: "" }, "literature");
    const edited = { ...filled, content: `${filled.content}\n我补充的判断。` };
    expect(prefillResearchTemplate(edited, "decision")).toBe(edited);
  });
});
