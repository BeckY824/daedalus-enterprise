/**
 * AI 建档卡从「来源」认渠道（11-05）：整名 → 包含唯一一个 → 竖线前的平台前缀唯一；对上多个不猜。
 * 卡片预选（ProposalCard）和确认时落库（dashboard/apply.ts）用同一个函数。
 */
import { describe, it, expect } from "vitest";
import { 认渠道, 候选说明 } from "@/lib/enterprise/channel-match";

const 渠 = (id: string, name: string, active = true) => ({ id, name, active });
const 清单 = [
  渠("1", "TikTok｜示例号"),
  渠("2", "Instagram|示例号"),
  渠("3", "视频号｜示例号"),
  渠("4", "Facebook｜品牌A"),
  渠("5", "Facebook｜品牌a"),
  渠("6", "LinkedIn"),
  渠("7", "示例国际站"),
  渠("8", "2026春季示例展会"),
  渠("9", "2025春季示例展会"),
  渠("10", "YouTube｜停用号", false),
];
const 认 = (来源: string) => 认渠道(来源, 清单).渠道?.id ?? null;

describe("认渠道", () => {
  it("整名相同直接认", () => {
    expect(认("TikTok｜示例号")).toBe("1");
    expect(认("Facebook｜品牌a")).toBe("5");
    expect(认("  LinkedIn  ")).toBe("6");
  });

  it("来源里只包含一个渠道名就认", () => {
    expect(认("客户说是在2026春季示例展会上认识的")).toBe("8");
  });

  it("包含多个渠道名不认，列出候选", () => {
    const r = 认渠道("2026春季示例展会 / 2025春季示例展会", 清单);
    expect(r.渠道).toBeNull();
    expect(r.候选.map((c) => c.id).sort()).toEqual(["8", "9"]);
  });

  it("只写平台前缀，前缀只对应一个渠道就认", () => {
    expect(认("TikTok")).toBe("1");
    expect(认("视频号")).toBe("3");
    expect(认("Instagram")).toBe("2"); // 半角竖线也认
    expect(认("从视频号来的")).toBe("3");
  });

  it("前缀忽略大小写和空格", () => {
    expect(认("tiktok")).toBe("1");
    expect(认("TIK TOK")).toBe("1");
    expect(认("instagram 私信")).toBe("2");
  });

  it("没前缀的渠道名也忽略大小写整名比较", () => {
    expect(认("linkedin")).toBe("6");
    expect(认("LINKEDIN")).toBe("6");
  });

  it("前缀对应多个渠道不认，候选是那几个", () => {
    const r = 认渠道("Facebook", 清单);
    expect(r.渠道).toBeNull();
    expect(r.候选.map((c) => c.id).sort()).toEqual(["4", "5"]);
    expect(认("facebook")).toBeNull();
  });

  it("空来源不认、没候选", () => {
    expect(认渠道("", 清单)).toEqual({ 渠道: null, 候选: [] });
    expect(认渠道("   ", 清单)).toEqual({ 渠道: null, 候选: [] });
  });

  it("停用渠道不参与", () => {
    expect(认("YouTube｜停用号")).toBeNull();
    expect(认("YouTube")).toBeNull();
    expect(认渠道("YouTube", 清单).候选).toEqual([]);
  });

  it("什么都对不上不猜", () => {
    expect(认渠道("朋友介绍", 清单)).toEqual({ 渠道: null, 候选: [] });
  });

  it("没带 active 的（卡片上只有启用中的渠道名）照常认", () => {
    expect(认渠道("tiktok", [{ name: "TikTok｜示例号" }, { name: "LinkedIn" }]).渠道?.name).toBe("TikTok｜示例号");
  });
});

describe("候选说明", () => {
  it("最多列 3 个，用「、」连，多了带「等」", () => {
    expect(候选说明([])).toBe("");
    expect(候选说明([{ name: "甲" }, { name: "乙" }])).toBe("甲、乙");
    expect(候选说明([{ name: "甲" }, { name: "乙" }, { name: "丙" }, { name: "丁" }])).toBe("甲、乙、丙等 4 个");
  });
});
