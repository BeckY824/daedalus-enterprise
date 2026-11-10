/**
 * tests/helpers/beijing-date.ts：北京 0:00–8:00（= GMT 16–24 点）这段，UTC 的日子比北京早一天，
 * 帮手得跟业务钟走、给北京的日子。拨假钟到 UTC 17:30（北京次日 01:30）钉住。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { businessDayjs } from "@/lib/business-clock";
import { 北京日期, 北京日 } from "./helpers/beijing-date";

afterEach(() => { vi.useRealTimers(); });

describe("北京日期帮手", () => {
  it("UTC 17:30 = 北京次日 01:30：今天、明天、N 天前都按北京算，和业务钟同一天", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T17:30:00Z"));
    expect(new Date().getUTCDate()).toBe(10); // UTC 还在 10 号
    expect(北京日期()).toBe("2026-11-11");
    expect(北京日期()).toBe(businessDayjs().format("YYYY-MM-DD"));
    expect(北京日期(1)).toBe("2026-11-12");
    expect(北京日期(7)).toBe("2026-11-18");
    expect(北京日期(-11)).toBe("2026-10-31");
    expect(北京日(new Date("2026-11-10T15:59:59Z"))).toBe("2026-11-10");
    expect(北京日(new Date("2026-11-10T16:00:00Z"))).toBe("2026-11-11");
  });

  it("北京白天（UTC 04:00 = 北京 12:00）两边同一天", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T04:00:00Z"));
    expect(北京日期()).toBe("2026-11-10");
    expect(北京日期(-1)).toBe("2026-11-09");
  });
});
