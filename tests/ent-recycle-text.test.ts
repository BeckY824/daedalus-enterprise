/** 项目列表「回公海日」那格、看板卡上的回收标签：按天写成「今天回公海」「明天回公海（11-06）」「11-06 回公海」（术语表） */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/customers/[id]/pick", () => ({ 搜客户: async () => [], 取客户选项: async () => null, 取客户近况: async () => null }));
vi.mock("@/app/(app)/customers/[id]/project-actions", () => ({ 给客户建项目: async () => ({ ok: true }) }));

const { 回收日文案 } = await import("@/app/(app)/projects/ProjectsView");

describe("回收日文案", () => {
  const 今 = "2026-11-05T10:00:00";
  it("当天和已过的都写「今天回公海」", () => {
    expect(回收日文案("2026-11-05", 今)).toBe("今天回公海");
    expect(回收日文案("2026-11-03", 今)).toBe("今天回公海");
  });
  it("明天带上日期", () => expect(回收日文案("2026-11-06", 今)).toBe("明天回公海（11-06）"));
  it("再往后只写日期", () => {
    expect(回收日文案("2026-11-07", 今)).toBe("11-07 回公海");
    expect(回收日文案("2027-01-02", 今)).toBe("01-02 回公海");
  });
});
