/**
 * 企业版的时间一律北京（11-03）：导入解析之后取年月日、页面 title、系统写的文案，不管进程在哪个时区都一样。
 * 同一份数据放进几个进程时区跑，结果必须相同；没开企业版（桌面端）照旧按本机。
 *
 * vitest.config.ts 用 test.env 把 TZ 钉成了 Asia/Shanghai，所以在用例里改 process.env.TZ（Node 当场换时区），跑完换回去。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 认时间, 清洗 } from "@/lib/enterprise-import/clean";
import { 认日期 } from "@/lib/import/plan";
import { 运营天数 } from "@/lib/enterprise/channel-stats";
import { 排导入, type 导入用员工 } from "@/lib/enterprise/channel-import";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";
import { 对方当地 } from "@/lib/country-time";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { 北京日期 } from "@/lib/team-pricing";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";

vi.mock("@/app/(app)/notice-actions", () => ({}));

const 原TZ = process.env.TZ;
const 时区们 = ["Europe/London", "Asia/Shanghai", "America/New_York"];
afterEach(() => { process.env.TZ = 原TZ; vi.unstubAllEnvs(); });
afterAll(() => { process.env.TZ = 原TZ; });

const 员工们: 导入用员工[] = [{ id: "u1", name: "王一", active: true }];
const 排渠道 = (行们: string[][]) => 排导入(
  [["渠道属性", "渠道名称", "来源名称", "渠道状态", "结束日期", "负责人"], ...行们],
  { 员工们, 已有全称: [], 字典属性: 字典定义.channelAttr.默认, 兜底负责人: { id: "u1", name: "王一" } },
);

describe("企业版：不管进程在哪个时区", () => {
  beforeEach(() => vi.stubEnv("CRM_ENTERPRISE", "1"));

  it.each(时区们)("%s：不带时区的文字一律按北京墙钟", (tz) => {
    process.env.TZ = tz;
    expect(认时间("2026-08-18T10:10:15")?.toISOString()).toBe("2026-08-18T02:10:15.000Z");
    expect(认时间("2026-08-18 10:10:15")?.toISOString()).toBe("2026-08-18T02:10:15.000Z");
    expect(认日期("2026-08-18")?.toISOString()).toBe("2026-08-17T16:00:00.000Z");
  });

  it.each(时区们)("%s：写明时区的是确定的时刻，+0800 不带冒号也认", (tz) => {
    process.env.TZ = tz;
    expect(认时间("2026-08-18T10:10:15+0800")?.toISOString()).toBe("2026-08-18T02:10:15.000Z");
    expect(认时间("2026-08-18T10:10:15+0530")?.toISOString()).toBe("2026-08-18T04:40:15.000Z");
    // 只要日期的格：算这个时刻落在北京哪一天（UTC 16:00 已是北京第二天零点）
    expect(fmtDate(认日期("2026-08-17T16:00:00.000Z"))).toBe("2026-08-18");
    expect(fmtDate(认日期("2026-08-18T10:10:15+08:00"))).toBe("2026-08-18");
  });

  it.each(时区们)("%s：导入的生日不早一天", (tz) => {
    process.env.TZ = tz;
    const 列 = { 外部: "id", 名称: "name", 电话: "phone", 负责人: "owner" };
    const m = {
      列: {
        customer: 列,
        contact: { 外部: "id", 客户ID: "customerRef", 姓名: "name", 手机: "phone", 生日: "birthday" },
      },
      负责人: { 张伟: "u1" },
      值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
      默认负责人Id: "u1",
    } as unknown as 映射;
    const 记录: 原始记录[] = [
      { 实体: "customer", 外部ID: "c1", 字段: { 外部: "c1", 名称: "虚构甲公司", 电话: "13800000001", 负责人: "张伟" } },
      { 实体: "contact", 外部ID: "p1", 字段: { 外部: "p1", 客户ID: "c1", 姓名: "虚构王", 手机: "13800000002", 生日: "1990年5月6日" } },
    ];
    const 联系人 = 清洗(记录, m).待写.find((x) => x.实体 === "contact");
    expect(联系人?.值.birthday).toBe("1990-05-06");
  });

  it.each(时区们)("%s：渠道结束日期 1 月 1 日还算当年，同名按月分开不错月", (tz) => {
    process.env.TZ = tz;
    const 计划 = 排渠道([["公域引流", "展会", "某展2026", "停用", "2026-01-01", "王一"]]);
    expect(计划.要建.map((c) => c.name)).toEqual(["展会|某展2026"]);
    expect(计划.要建[0].endDate && fmtDate(计划.要建[0].endDate)).toBe("2026-01-01");
    const 同名 = 排渠道([
      ["公域引流", "展会", "春季", "停用", "2026-03-01", "王一"],
      ["公域引流", "展会", "春季", "停用", "2026-04-01", "王一"],
    ]);
    expect(同名.要建.map((c) => c.name)).toEqual(["展会|春季（3月）", "展会|春季（4月）"]);
  });

  it.each(时区们)("%s：运营天数按北京日历天", (tz) => {
    process.env.TZ = tz;
    const 创建 = new Date("2026-07-21T16:30:00.000Z"); // 北京 7-22 00:30
    expect(运营天数(创建, null, new Date("2026-07-22T15:30:00.000Z"))).toBe(0); // 北京 7-22 23:30
    expect(运营天数(创建, null, new Date("2026-07-22T16:30:00.000Z"))).toBe(1); // 北京 7-23 00:30
  });

  it.each(时区们)("%s：页面和文案的时间都是北京", async (tz) => {
    process.env.TZ = tz;
    const 瞬间 = "2026-07-21T17:05:00.000Z"; // 北京 7-22 01:05
    expect(fmtDateTime(瞬间)).toBe("2026-07-22 01:05");
    expect(fmtDate(瞬间)).toBe("2026-07-22");
    expect(北京日期(new Date(瞬间))).toBe("2026-07-22");
    const { 多久以前 } = await import("@/components/NoticeBell");
    expect(多久以前(瞬间, Date.parse("2026-10-14T08:00:00.000Z"))).toBe("7月22日");
    const { 留痕行 } = await import("@/lib/tenant/test-accounts");
    expect(留痕行(true, "运营", new Date(瞬间))).toBe("2026-07-22 01:05 标为测试账号 · 运营");
  });

  it.each(时区们)("%s：对方当地跟北京比，不跟电脑比", (tz) => {
    process.env.TZ = tz;
    const 现在 = new Date("2026-07-22T02:23:00.000Z"); // 北京 10:23、伦敦 03:23
    expect(对方当地("英国", 现在)?.说法).toBe("对方当地 03:23");
    expect(对方当地("中国", 现在)).toBeNull();
  });
});

describe("没开企业版（桌面端）：照旧按本机", () => {
  beforeEach(() => { vi.stubEnv("CRM_ENTERPRISE", ""); vi.stubEnv("MULTI_TENANT", ""); });

  it.each(时区们)("%s：墙钟、日历天、当地时间都看本机", (tz) => {
    process.env.TZ = tz;
    const d = 认时间("2026-08-18T10:10:15")!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 8, 18, 10, 10]);
    // 写明时区的只要日期：桌面端还是照字面那天
    const 日 = 认日期("2026-08-17T16:00:00.000Z")!;
    expect([日.getMonth() + 1, 日.getDate(), 日.getHours()]).toEqual([8, 17, 0]);
    expect(运营天数(new Date(2026, 6, 22, 0, 30), null, new Date(2026, 6, 22, 23, 30))).toBe(0);
    expect(运营天数(new Date(2026, 6, 22, 23, 30), null, new Date(2026, 6, 23, 0, 30))).toBe(1);
  });

  it("伦敦：英国和本机同一钟点，不显示对方当地", () => {
    process.env.TZ = "Europe/London";
    expect(对方当地("英国", new Date("2026-07-22T02:23:00.000Z"))).toBeNull();
  });
});
