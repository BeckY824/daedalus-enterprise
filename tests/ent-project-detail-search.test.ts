import { describe, expect, it } from "vitest";
import { 词们, 对得上, 沟通字段, 卡点字段, 沟通来源 } from "@/lib/project/detail-search";

/* 10-31 会议 1.0（U-项目-04、F-项目-18）：项目详情顶部搜索、附件块里的「来自沟通」 */
describe("项目详情搜索", () => {
  it("词们：去头尾空白、按空白拆、转小写，空串没有词", () => {
    expect(词们("  报价  ABC\t样品 ")).toEqual(["报价", "abc", "样品"]);
    expect(词们("   ")).toEqual([]);
  });

  it("对得上：每个词都得在某个字段里出现；没有词都算对上；空字段跳过", () => {
    expect(对得上([], ["随便"])).toBe(true);
    expect(对得上(["报价", "组长"], ["对方要重新报价", null, "组长甲"])).toBe(true);
    expect(对得上(["报价", "组员"], ["对方要重新报价", undefined, "组长甲"])).toBe(false);
    expect(对得上(["abc"], ["ABC 样品"])).toBe(true);
  });

  it("沟通字段：内容、谁记的、进程、类型、方式、附件名都搜得到，编号不搜", () => {
    const 字段 = 沟通字段({ content: "约了现场", who: "组长甲", node: "生产备货", type: "PHONE", method: "微信", 附件: [{ name: "现场照片.png" }], ...{ code: "FUL0001" } } as Parameters<typeof 沟通字段>[0]);
    expect(对得上(词们("现场照片 微信 生产备货 组长甲"), 字段)).toBe(true);
    expect(对得上(词们("FUL0001"), 字段)).toBe(false);
  });

  it("卡点字段：编号、经手人、方案也算", () => {
    const 字段 = 卡点字段({ code: "BLK0003", type: "资源", impact: "高", obstacle: "缺货", description: "等原料", status: "OPEN", 经手人: "组员丙", 发布人: "组长甲", resourceRequest: null, progress: null, solution: "换供应商", result: null });
    expect(对得上(词们("blk0003 组员丙 换供应商"), 字段)).toBe(true);
  });

  it("沟通来源：谁 · 时间 · 头 20 个字，长了加省略号，空白压成一个空格", () => {
    const 来源 = 沟通来源({ who: "组长甲", occurredAt: "2026-10-03T00:00:00.000Z", content: "一二三四五六七八九十\n\n一二三四五六七八九十多出来的" });
    const 段 = 来源.split(" · ");
    expect(段[0]).toBe("组长甲");
    expect(段).toHaveLength(3);
    expect(段[2]).toBe("一二三四五六七八九十 一二三四五六七八九…");
    expect(沟通来源({ who: "组长甲", occurredAt: "2026-10-03T00:00:00.000Z", content: "短的" }).endsWith(" · 短的")).toBe(true);
  });
});
