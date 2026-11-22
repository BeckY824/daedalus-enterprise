/**
 * 首页顶部待办的时间（设计语言 H-A，11-21，H-新13）：服务端按北京墙钟写好的短串（time-fields.ts 短时刻 / 指定回复文字）认回那一刻、走 smartTime。
 * 单测时区是 Asia/Shanghai（vitest.config），和生产一致
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 墙钟串转时刻, 墙钟smart, 时段smart } from "@/app/(app)/dashboard/todo-time";
import { 短时刻, 指定回复文字 } from "@/lib/project/time-fields";

const 今 = new Date("2026-11-21T12:00:00+08:00");
beforeEach(() => { vi.useFakeTimers({ now: 今, toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("墙钟串转时刻", () => {
  it("和 短时刻 互逆：今年不带年、别的年带年", () => {
    for (const t of ["2026-11-21T01:30:00Z", "2026-01-01T00:00:00+08:00", "2025-12-31T23:59:00+08:00"]) {
      const d = new Date(t);
      expect(墙钟串转时刻(短时刻(d, 今)!, 今)?.getTime()).toBe(Math.floor(d.getTime() / 60_000) * 60_000);
    }
  });
  it("认不出的 = null", () => {
    expect(墙钟串转时刻("—", 今)).toBeNull();
    expect(墙钟串转时刻("11/21 09:00", 今)).toBeNull();
  });
});

describe("smartTime 写法", () => {
  it("单个时刻：今天带钟点、昨天、N 天前、几月几日、跨年带年；认不出原样", () => {
    expect(墙钟smart("11-21 09:30", 今)).toBe("今天 09:30");
    expect(墙钟smart("11-22 09:00", 今)).toBe("明天 09:00");
    expect(墙钟smart("11-20 16:00", 今)).toBe("昨天");
    expect(墙钟smart("11-18 16:00", 今)).toBe("3 天前");
    expect(墙钟smart("10-26 16:00", 今)).toBe("10 月 26 日");
    expect(墙钟smart("2025-10-26 16:00", 今)).toBe("2025 年 10 月 26 日");
    expect(墙钟smart("—", 今)).toBe("—");
  });
  it("指定回复时段：同一天只写结束钟点；跨天两头都写；只填一头写「前后」「前」", () => {
    const 时 = (a: string | null, b: string | null) => 时段smart(指定回复文字(a ? new Date(a) : null, b ? new Date(b) : null, 今), 今);
    expect(时("2026-11-21T21:00:00+08:00", "2026-11-21T22:00:00+08:00")).toBe("今天 21:00 – 22:00");
    expect(时("2026-11-21T21:00:00+08:00", "2026-11-22T09:00:00+08:00")).toBe("今天 21:00 – 明天 09:00");
    expect(时("2026-11-20T21:00:00+08:00", "2026-11-20T22:00:00+08:00")).toBe("昨天");
    expect(时("2026-11-21T21:00:00+08:00", null)).toBe("今天 21:00 前后");
    expect(时(null, "2026-11-22T09:00:00+08:00")).toBe("明天 09:00 前");
    expect(时(null, null)).toBe("—");
  });
});
