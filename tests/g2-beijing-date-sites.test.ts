/**
 * G2（代码质量体检 2026-11-10 R2）：业务代码里手写的「瞬间 + 8 小时」北京日期串收到 lib/business-clock 一处。
 * 这份对照测试先在旧写法上全绿、再换实现：每一处都从对外的函数进，钉北京零点前后一分钟
 *（UTC 15:59 / 16:00 / 16:01）、月末、闰年 2 月末、年末。
 * 这几处都是固定 UTC+8，不看 CRM_ENTERPRISE / 宿主 TZ（和 businessDayjs 不同：那个没开企业版时按本机钟）。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { 北京日期, 剩几天 } from "@/lib/team-pricing";
import { 北京时间串 } from "@/lib/enterprise-import/net";

/** [UTC 瞬间, 北京日期, 北京钟点] */
const 边界: [string, string, string][] = [
  ["2026-03-10T15:59:00.000Z", "2026-03-10", "23:59"],
  ["2026-03-10T15:59:59.999Z", "2026-03-10", "23:59"],
  ["2026-03-10T16:00:00.000Z", "2026-03-11", "00:00"],
  ["2026-03-10T16:01:00.000Z", "2026-03-11", "00:01"],
  ["2026-06-15T00:00:00.000Z", "2026-06-15", "08:00"],
  // 月末
  ["2026-01-31T15:59:00.000Z", "2026-01-31", "23:59"],
  ["2026-01-31T16:00:00.000Z", "2026-02-01", "00:00"],
  ["2026-04-30T16:01:00.000Z", "2026-05-01", "00:01"],
  // 2 月末：平年、闰年
  ["2027-02-28T16:00:00.000Z", "2027-03-01", "00:00"],
  ["2028-02-28T16:00:00.000Z", "2028-02-29", "00:00"],
  ["2028-02-29T15:59:00.000Z", "2028-02-29", "23:59"],
  // 年末
  ["2026-12-31T15:59:00.000Z", "2026-12-31", "23:59"],
  ["2026-12-31T16:00:00.000Z", "2027-01-01", "00:00"],
  ["2026-12-31T16:01:00.000Z", "2027-01-01", "00:01"],
];

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("G2 北京日期串：各处现有行为", () => {
  it.each(边界)("team-pricing 北京日期 %s → %s", (瞬间, 日) => {
    expect(北京日期(new Date(瞬间))).toBe(日);
  });

  it("team-pricing 剩几天按北京日期差：零点一过就少一天", () => {
    const 到期 = new Date("2026-12-31T15:59:59.999Z"); // 北京 12-31 最后一刻
    expect(剩几天(到期, new Date("2026-12-30T15:59:00.000Z"))).toBe(1);
    expect(剩几天(到期, new Date("2026-12-30T16:00:00.000Z"))).toBe(0);
    expect(剩几天(到期, new Date("2026-12-31T16:00:00.000Z"))).toBe(-1);
  });

  it.each(边界)("enterprise-import 北京时间串 %s → %s %s", (瞬间, 日, 钟点) => {
    expect(北京时间串(Date.parse(瞬间))).toBe(钟点 === "00:00" ? 日 : `${日} ${钟点}`);
  });

  it("enterprise-import 北京时间串：零点带秒仍只给日期；坏时间戳不抛", () => {
    expect(北京时间串(Date.parse("2026-12-31T16:00:59.999Z"))).toBe("2027-01-01");
    expect(北京时间串(Number.NaN)).toBe("NaN-NaN-NaN NaN:NaN");
    // 五位数年份：按 UTC 字段拼，不是 toISOString 的 +010000 写法
    expect(北京时间串(Date.UTC(10000, 0, 1, 1, 30))).toBe("10000-01-01 09:30");
  });

  it("不看企业版开关、不看宿主钟：关了 CRM_ENTERPRISE / MULTI_TENANT 也是北京日期", () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    vi.stubEnv("MULTI_TENANT", "");
    const t = new Date("2026-12-31T16:00:00.000Z");
    expect(北京日期(t)).toBe("2027-01-01");
    expect(北京时间串(t.getTime())).toBe("2027-01-01");
  });
});

describe("G2 北京日期串：sync-attach 删除清单的文件名", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crm-g2-attach-"));
  let 删云端附件: typeof import("@/lib/tenant/sync-attach").删云端附件;
  beforeAll(async () => {
    process.env.ATTACH_DIR = root;
    ({ 删云端附件 } = await import("@/lib/tenant/sync-attach"));
  });
  afterAll(() => { delete process.env.ATTACH_DIR; fs.rmSync(root, { recursive: true, force: true }); });

  const 放一张 = (团队: string, id: string) => {
    fs.mkdirSync(path.join(root, 团队), { recursive: true });
    fs.writeFileSync(path.join(root, 团队, id), "x");
  };

  it.each(边界)("显式给时间 %s → .deleted/%s.txt", (瞬间, 日) => {
    const 团队 = `g2-${瞬间.replace(/\W/g, "")}`;
    放一张(团队, "g2deleted1");
    expect(删云端附件(团队, ["g2deleted1"], new Date(瞬间))).toBe(1);
    expect(fs.readdirSync(path.join(root, 团队, ".deleted"))).toEqual([`${日}.txt`]);
  });

  it("不给时间用系统钟：北京零点前后一分钟落两个文件", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    放一张("g2-now", "g2deleted1");
    放一张("g2-now", "g2deleted2");
    vi.setSystemTime(new Date("2026-12-31T15:59:00.000Z"));
    expect(删云端附件("g2-now", ["g2deleted1"])).toBe(1);
    vi.setSystemTime(new Date("2026-12-31T16:00:00.000Z"));
    expect(删云端附件("g2-now", ["g2deleted2"])).toBe(1);
    expect(fs.readdirSync(path.join(root, "g2-now", ".deleted")).sort()).toEqual(["2026-12-31.txt", "2027-01-01.txt"]);
  });
});
