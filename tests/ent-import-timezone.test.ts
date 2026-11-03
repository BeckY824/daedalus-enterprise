/**
 * 导入的时间按业务时区算（11-02）：认时间 原来日期按业务时区（北京零点）、时分却 d.setHours 按进程时区，
 * 本机伦敦跑导入时所有沟通时间早 16–17 小时。同目录 到点了 的「每晚几点」同一个毛病。
 * 同一份数据放进几个进程时区跑，结果必须一样；没开企业版（桌面端）照旧按本机。
 *
 * vitest.config.ts 用 test.env 把 TZ 钉成了 Asia/Shanghai，所以在用例里改 process.env.TZ（Node 当场换时区），跑完换回去。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 认时间 } from "@/lib/enterprise-import/clean";
import { 到点了, type 同步设置 } from "@/lib/enterprise-import/sync";

const 原TZ = process.env.TZ;
const 时区们 = ["Europe/London", "Asia/Shanghai", "America/New_York"];
afterEach(() => { process.env.TZ = 原TZ; vi.unstubAllEnvs(); });
afterAll(() => { process.env.TZ = 原TZ; });

// 46225 = 2026-07-22；10:23 = 37380 秒 / 86400
const 序列号 = "46225.43263888889";

describe("企业版：不管进程在哪个时区", () => {
  beforeEach(() => vi.stubEnv("CRM_ENTERPRISE", "1"));

  it.each(时区们)("%s：认时间 的序列号、文本都是北京墙钟", (tz) => {
    process.env.TZ = tz;
    const 瞬间 = (v: string) => 认时间(v)?.toISOString();
    expect(瞬间(序列号)).toBe("2026-07-22T02:23:00.000Z");
    expect(瞬间("2026-07-22 10:23")).toBe("2026-07-22T02:23:00.000Z");
    expect(瞬间("2026-07-22T10:23")).toBe("2026-07-22T02:23:00.000Z");
    expect(瞬间("2026年7月22日 9:05:07")).toBe("2026-07-22T01:05:07.000Z");
    expect(瞬间("2026/7/22 18：30")).toBe("2026-07-22T10:30:00.000Z");
    // 只有日期：北京零点
    expect(瞬间("2026/07/22")).toBe("2026-07-21T16:00:00.000Z");
    // 北京凌晨，UTC 还在前一天；冬令时那边也不偏
    expect(瞬间("2026-01-15 01:30")).toBe("2026-01-14T17:30:00.000Z");
    // 进一天的取整：小数几乎是 1，落到第二天北京零点
    expect(瞬间("46225.999999999")).toBe("2026-07-22T16:00:00.000Z");
    // 写明了时区的是确定的时刻，不当墙钟
    expect(瞬间("2026-07-22T02:23:00.000Z")).toBe("2026-07-22T02:23:00.000Z");
    expect(瞬间("2026-07-22T10:23:00+08:00")).toBe("2026-07-22T02:23:00.000Z");
    expect(认时间("上周")).toBeNull();
  });

  const 设 = (改: Partial<同步设置>): 同步设置 => ({ 开: true, 频率: "每晚", 几点: 2, 开的人Id: "u", 拉到: null, 上次: null, 切换: null, ...改 });

  it.each(时区们)("%s：到点了 的每晚几点是北京的钟点", (tz) => {
    process.env.TZ = tz;
    // 北京 01:59 没到、02:00 到了
    expect(到点了(设({}), new Date("2026-07-21T17:59:00.000Z"))).toBe(false);
    expect(到点了(设({}), new Date("2026-07-21T18:00:00.000Z"))).toBe(true);
    // 北京今天 02:00 之后拉过了：不再拉；之前拉的：补一次
    const 现在 = new Date("2026-07-22T02:00:00.000Z");
    const 上次 = (时间: string) => ({ 时间 } as 同步设置["上次"]);
    expect(到点了(设({ 上次: 上次("2026-07-21T18:30:00.000Z") }), 现在)).toBe(false);
    expect(到点了(设({ 上次: 上次("2026-07-21T17:30:00.000Z") }), 现在)).toBe(true);
  });
});

describe("没开企业版（桌面端）：照旧按本机", () => {
  beforeEach(() => { vi.stubEnv("CRM_ENTERPRISE", ""); vi.stubEnv("MULTI_TENANT", ""); });

  it.each(时区们)("%s：墙钟就是本机墙钟", (tz) => {
    process.env.TZ = tz;
    for (const v of [序列号, "2026-07-22 10:23"]) {
      const d = 认时间(v)!;
      expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 7, 22, 10, 23]);
    }
    const 今天两点 = new Date(2026, 6, 22, 2, 0, 0, 0);
    const s: 同步设置 = { 开: true, 频率: "每晚", 几点: 2, 开的人Id: "u", 拉到: null, 上次: null, 切换: null };
    expect(到点了(s, new Date(今天两点.getTime() - 60_000))).toBe(false);
    expect(到点了(s, 今天两点)).toBe(true);
  });
});
