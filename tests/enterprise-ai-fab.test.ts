/**
 * 企业版项目模式右下角的 AI 浮标在哪些页出现（定稿 #13：首页以外的根目录）。
 *   - 根目录线上的页（看板、渠道、公海、客户、项目）和它们底下的页（档案、新线索、跟进、联系人）出现
 *   - 首页不出现（首页本身就是对话）；设置、反馈不在根目录上，不出现
 *   - 不是企业版项目模式、没登 AI、面板已经开着：都不出现（面板开着时它让开，不压面板的输入框）
 */
import { describe, expect, it } from "vitest";
import { 浮标显示 } from "@/lib/enterprise/ai-fab";

const 开 = { 企业版项目: true, 有AI: true, 面板开着: false };

describe("浮标显示", () => {
  it("首页以外的根目录和它们底下的页：出现", () => {
    for (const p of ["/overview", "/channels", "/customers", "/projects", "/projects/abc", "/customers/c1", "/leads", "/follow-ups", "/follow-ups/plans", "/contacts"])
      expect(浮标显示(p, null, 开), p).toBe(true);
    expect(浮标显示("/customers", "1", 开), "公海").toBe(true);
  });

  it("首页、设置、反馈、认不出的页：不出现", () => {
    for (const p of ["/dashboard", "/settings", "/settings/team", "/feedback", "/billing", "/"]) expect(浮标显示(p, null, 开), p).toBe(false);
  });

  it("不是企业版项目模式、没登 AI、面板开着：都不出现", () => {
    expect(浮标显示("/projects", null, { ...开, 企业版项目: false })).toBe(false);
    expect(浮标显示("/projects", null, { ...开, 有AI: false })).toBe(false);
    expect(浮标显示("/projects", null, { ...开, 面板开着: true })).toBe(false);
  });
});
