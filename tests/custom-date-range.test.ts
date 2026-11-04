/**
 * 时间预设的「自定义」（V3.5.1 P-界面-10）：地址栏两头怎么读、边界在哪、走势按天还是按月。
 *   - 读日期段：两头都合法才用，倒过来换个个儿；缺一头、写错（2 月 30 日、不是日期、年份离谱）= 本月 1 号到今天
 *   - 日期段界：开始日零点到结束日 23:59:59.999，企业版按北京日界线，服务器 TZ 是伦敦 / 纽约也一样
 *   - 日期段粒度：两头都算 ≤ 62 天按天，63 天起按月
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayjs } from "@/lib/utils";
import { 读日期段, 日期段界, 日期段天数, 日期段粒度, 日期段叫法, 是日期 } from "@/lib/custom-date-range";

const originalTZ = process.env.TZ;
afterEach(() => { vi.unstubAllEnvs(); process.env.TZ = originalTZ; });

describe("读日期段", () => {
  const now = dayjs("2026-11-04T15:00:00");
  const 默认 = { from: "2026-11-01", to: "2026-11-04" };

  it("两头都合法照用；倒过来换个个儿；同一天也行", () => {
    expect(读日期段("2026-10-01", "2026-11-04", now)).toEqual({ from: "2026-10-01", to: "2026-11-04" });
    expect(读日期段("2026-11-04", "2026-10-01", now)).toEqual({ from: "2026-10-01", to: "2026-11-04" });
    expect(读日期段("2026-10-08", "2026-10-08", now)).toEqual({ from: "2026-10-08", to: "2026-10-08" });
  });

  it("缺一头、两头都缺 = 本月 1 号到今天", () => {
    expect(读日期段(undefined, undefined, now)).toEqual(默认);
    expect(读日期段("2026-10-01", undefined, now)).toEqual(默认);
    expect(读日期段(undefined, "2026-10-01", now)).toEqual(默认);
    expect(读日期段("", "", now)).toEqual(默认);
  });

  it("写错的 = 本月 1 号到今天：不存在的日子、不是日期、带时刻、年份离谱", () => {
    for (const 坏 of ["2026-02-30", "2026-13-01", "2026-1-5", "abc", "2026-10-01T00:00", "1900-01-01", "2100-01-01", "0001-01-01"]) {
      expect(读日期段(坏, "2026-10-31", now), 坏).toEqual(默认);
      expect(是日期(坏), 坏).toBe(false);
    }
    expect(是日期("2028-02-29")).toBe(true);
  });

  it("没给 now 用业务钟的今天", () => {
    const d = 读日期段();
    expect(d.to).toBe(dayjs().format("YYYY-MM-DD"));
    expect(d.from).toBe(dayjs().startOf("month").format("YYYY-MM-DD"));
  });
});

describe("日期段界：两头都算，按业务钟的日界线", () => {
  for (const tz of ["Asia/Shanghai", "Europe/London", "America/New_York"]) {
    it(`企业版 TZ=${tz}：北京零点到北京 23:59:59.999`, () => {
      vi.stubEnv("CRM_ENTERPRISE", "1");
      vi.stubEnv("TZ", tz);
      const 界 = 日期段界({ from: "2026-10-01", to: "2026-11-04" });
      expect(界.from.toISOString()).toBe("2026-09-30T16:00:00.000Z");
      expect(界.to.toISOString()).toBe("2026-11-04T15:59:59.999Z");
    });
  }

  it("和「本月」同一个算法：本月 1 号到月底 = 本月的 startOf / endOf", () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    const now = dayjs();
    const 界 = 日期段界({ from: now.startOf("month").format("YYYY-MM-DD"), to: now.endOf("month").format("YYYY-MM-DD") });
    expect(界.from.getTime()).toBe(now.startOf("month").toDate().getTime());
    expect(界.to.getTime()).toBe(now.endOf("month").toDate().getTime());
  });
});

describe("日期段粒度 / 天数 / 叫法", () => {
  it("两头都算：同一天 1 天；62 天以内按天，63 天起按月；跨夏令时、跨年不差一天", () => {
    expect(日期段天数({ from: "2026-10-08", to: "2026-10-08" })).toBe(1);
    expect(日期段天数({ from: "2026-10-01", to: "2026-11-04" })).toBe(35);
    // 10-01 到 12-01 = 62 天
    expect(日期段天数({ from: "2026-10-01", to: "2026-12-01" })).toBe(62);
    expect(日期段粒度({ from: "2026-10-01", to: "2026-12-01" })).toBe("day");
    expect(日期段粒度({ from: "2026-10-01", to: "2026-12-02" })).toBe("month");
    expect(日期段天数({ from: "2026-03-01", to: "2026-03-31" })).toBe(31);
    expect(日期段天数({ from: "2026-12-31", to: "2027-01-01" })).toBe(2);
    expect(日期段粒度({ from: "2026-01-01", to: "2026-12-31" })).toBe("month");
  });

  it("叫法：「开始 至 结束」", () => {
    expect(日期段叫法({ from: "2026-10-01", to: "2026-11-04" })).toBe("2026-10-01 至 2026-11-04");
  });
});
