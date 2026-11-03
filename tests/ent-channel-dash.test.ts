/**
 * 企业版渠道总览看板（11-03，口径在 channel-dash.ts，取数在 channel-dash-db.ts）：
 *   - 周期起点：本月 / 本季按北京时间的第一天零点，和进程时区无关；全部不限
 *   - 四个数各按哪个时间：线索 = 项目创建、商机 = 头一回到商机（直接到订单也算）、订单 = 头一回进订单、成交额 = 进订单的时间；投入按投入日期
 *   - 有效率 = 有效 ÷ 已判定（初验无效、暂未判定不算已判定），没判过 = null（界面「—」）
 *   - 线索→商机（11-03 定 A，同列表）：只看从线索起步的；分母已判定不到一半按线索，够一半按有效线索；导入时就是商机的算商机数、不算转化
 *   - 低效预警：线索 ≥ 30 才看，三条占一条；线索多的在前、最多 3 个
 *   - 环形图：多种属性按属性；属性单选按负责人（只一个负责人也摆）；筛了负责人收起；超过 5 段并成「其他」
 *   - 筛渠道 和列表同一份；全部周期的数和列表的关联项目 / 商机 / 订单 / 累计成交对得上（读库）
 *   - 未录投入的个数和第一个（去补录跳它）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { invalidateSettingsCache } from "@/lib/settings";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 读看板底数 } from "@/lib/enterprise/channel-dash-db";
import {
  周期起点, 商机时间, 订单时间, 算看板底数, 算看板, 筛渠道, 环形of, 判够, 预警线索下限,
  type 看板项目, type 看板渠道, type 渠道期数,
} from "@/lib/enterprise/channel-dash";

const Z = (s: string) => new Date(s);
/** 北京时间写法：「2026-11-01 00:00」→ 那一刻 */
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const 项 = (o: Partial<看板项目> & { channelId: string }): 看板项目 => ({
  phase: "线索", result: null, amount: 0, currency: "CNY", createdAt: 京("2026-05-01 10:00"), 判定: null, 节点们: [], ...o,
});
/** 没给 起* 的当全是从线索起步的 */
const 期 = (o: Partial<渠道期数>): 渠道期数 => {
  const d = { 线索: 0, 已判定: 0, 有效: 0, 商机: 0, 订单: 0, 成交: [], 投入: [], ...o };
  return { 起线索: d.线索, 起有效: d.有效, 起转商机: d.商机, ...d };
};
const 渠 = (id: string, o: Partial<看板渠道> = {}): 看板渠道 => ({ id, name: `渠道${id}`, attr: "公域引流", channelOwnerName: "销售甲", 投入数: 1, ...o });

describe("纯函数", () => {
  it("周期起点：北京时间当月 / 当季第一天零点；跨月那一刻按北京算；全部 = null", () => {
    const 今 = 京("2026-11-03 10:00");
    expect(周期起点("本月", 今)).toEqual(京("2026-11-01 00:00"));
    expect(周期起点("本月", 今)).toEqual(Z("2026-10-31T16:00:00Z"));
    expect(周期起点("本季", 今)).toEqual(京("2026-10-01 00:00"));
    expect(周期起点("全部", 今)).toBeNull();
    // UTC 还是 10-31，北京已经 11-01 凌晨一点：算 11 月
    expect(周期起点("本月", Z("2026-10-31T17:00:00Z"))).toEqual(京("2026-11-01 00:00"));
    // 北京 10-31 23:59：还是 10 月、四季度
    expect(周期起点("本月", 京("2026-10-31 23:59"))).toEqual(京("2026-10-01 00:00"));
    expect(周期起点("本季", 京("2026-09-30 23:59"))).toEqual(京("2026-07-01 00:00"));
    // 跨年：北京 1-1 凌晨，季度从当年 1 月起
    expect(周期起点("本季", 京("2026-01-01 00:30"))).toEqual(京("2026-01-01 00:00"));
    expect(周期起点("本月", 京("2026-03-15 12:00"))).toEqual(京("2026-03-01 00:00"));
    expect(周期起点("本季", 京("2026-06-30 12:00"))).toEqual(京("2026-04-01 00:00"));
  });

  it("商机时间 / 订单时间：取头一回；直接到订单也算到过商机；没日志按创建时间和眼下的阶段", () => {
    const 建 = 京("2026-10-01 09:00");
    const 日志 = (to: string, t: string) => ({ toPhase: to, at: 京(t) });
    // 日志顺序乱也取最早
    const p = 项({ channelId: "a", createdAt: 建, 节点们: [日志("订单", "2026-11-02 10:00"), 日志("线索", "2026-10-01 09:00"), 日志("商机", "2026-10-20 10:00"), 日志("商机", "2026-10-25 10:00")] });
    expect(商机时间(p)).toEqual(京("2026-10-20 10:00"));
    expect(订单时间(p)).toEqual(京("2026-11-02 10:00"));
    const 直进订单 = 项({ channelId: "a", phase: "订单", createdAt: 建, 节点们: [日志("订单", "2026-10-30 08:00")] });
    expect(商机时间(直进订单)).toEqual(京("2026-10-30 08:00"));
    expect(订单时间(直进订单)).toEqual(京("2026-10-30 08:00"));
    // 到过商机又退回线索：到过就算
    const 退回 = 项({ channelId: "a", createdAt: 建, 节点们: [日志("线索", "2026-10-01 09:00"), 日志("商机", "2026-10-03 09:00"), 日志("线索", "2026-10-05 09:00")] });
    expect(商机时间(退回)).toEqual(京("2026-10-03 09:00"));
    expect(订单时间(退回)).toBeNull();
    // 没日志的老数据
    expect(商机时间(项({ channelId: "a", phase: "商机", createdAt: 建 }))).toEqual(建);
    expect(订单时间(项({ channelId: "a", phase: "商机", createdAt: 建 }))).toBeNull();
    expect(订单时间(项({ channelId: "a", phase: "订单", createdAt: 建 }))).toEqual(建);
    expect(商机时间(项({ channelId: "a", createdAt: 建 }))).toBeNull();
  });

  it("算看板底数：线索按创建、商机按到商机、订单和成交额按进订单、投入按日期，各落各的周期", () => {
    const 今 = 京("2026-11-03 10:00");
    const 项目们 = [
      // 7 月建、10 月到商机、11 月进订单成交
      项({ channelId: "a", phase: "订单", amount: 1000, createdAt: 京("2026-07-10 10:00"), 节点们: [{ toPhase: "线索", at: 京("2026-07-10 10:00") }, { toPhase: "商机", at: 京("2026-10-10 10:00") }, { toPhase: "订单", at: 京("2026-11-02 10:00") }] }),
      // 11-01 零点整建的算本月，前一秒的不算
      项({ channelId: "a", createdAt: 京("2026-11-01 00:00") }),
      项({ channelId: "a", createdAt: Z("2026-10-31T15:59:59Z") }),
      // 异常状态的订单：算订单数，不算成交额
      项({ channelId: "a", phase: "订单", result: "异常状态", amount: 500, createdAt: 京("2026-11-02 10:00"), 节点们: [{ toPhase: "订单", at: 京("2026-11-02 10:00") }] }),
      // 别的渠道、不在清单里的渠道、没渠道的
      项({ channelId: "b", phase: "商机", createdAt: 京("2026-04-01 10:00") }),
      项({ channelId: "zz", createdAt: 京("2026-11-02 10:00") }),
      项({ channelId: null as unknown as string, createdAt: 京("2026-11-02 10:00") }),
    ];
    const 投入们 = [
      { channelId: "a", amount: 300, currency: "CNY", date: 京("2026-11-01 00:00") },
      { channelId: "a", amount: 200, currency: "CNY", date: 京("2026-10-15 00:00") },
      { channelId: "a", amount: 50, currency: "CNY", date: 京("2026-06-15 00:00") },
    ];
    const 底 = 算看板底数(["a", "b"], 项目们, 投入们, 今);
    // 进订单那条没有建项目日志（fromPhase 空）时起步按 线索 算——项() 默认不带 起步
    expect(底.本月.a).toEqual({ 线索: 2, 已判定: 0, 有效: 0, 商机: 1, 订单: 2, 成交: [{ 币种: "CNY", 合计: 1000 }], 投入: [{ 币种: "CNY", 合计: 300 }], 起线索: 2, 起有效: 0, 起转商机: 1 });
    expect(底.本季.a).toMatchObject({ 线索: 3, 商机: 2, 订单: 2, 成交: [{ 币种: "CNY", 合计: 1000 }], 投入: [{ 币种: "CNY", 合计: 500 }] });
    expect(底.全部.a).toMatchObject({ 线索: 4, 商机: 2, 订单: 2, 投入: [{ 币种: "CNY", 合计: 550 }] });
    expect(底.本月.b).toEqual(期({}));
    expect(底.全部.b).toMatchObject({ 线索: 1, 商机: 1, 订单: 0 });
    // 导入时就落在商机的：线索、商机照算，从线索起步的三个数不算
    const 导 = 算看板底数(["c"], [项({ channelId: "c", phase: "商机", 起步: "商机", createdAt: 京("2026-11-02 10:00") }), 项({ channelId: "c", createdAt: 京("2026-11-02 10:00") })], [], 今);
    expect(导.本月.c).toMatchObject({ 线索: 2, 商机: 1, 起线索: 1, 起有效: 0, 起转商机: 0 });
    expect(Object.keys(底.全部).sort()).toEqual(["a", "b"]);
  });

  it("有效率 = 有效 ÷ 已判定；初验无效、暂未判定、没那一行都不算已判定；一条没判 = null", () => {
    const 判 = (判定: string | null) => 项({ channelId: "a", 判定 });
    const 底 = 算看板底数(["a", "b"], [判("有效线索"), 判("有效线索"), 判("无效线索"), 判("初验无效"), 判("暂未判定"), 判(null), 项({ channelId: "b" })], [], 京("2026-11-03 10:00"));
    expect(底.全部.a).toMatchObject({ 线索: 6, 已判定: 3, 有效: 2 });
    const k = 算看板([渠("a")], 底.全部, false);
    expect(k.有效率).toBeCloseTo(2 / 3);
    const 没判 = 算看板([渠("b")], 底.全部, false);
    expect(没判.已判定).toBe(0);
    expect(没判.有效率).toBeNull();
  });

  it("线索→商机：已判定不到一半按 商机 ÷ 总线索，够一半按 商机 ÷ 有效线索", () => {
    expect(判够(0, 0)).toBe(false);
    expect(判够(4, 10)).toBe(false);
    expect(判够(5, 10)).toBe(true);
    const 少 = 算看板([渠("a")], { a: 期({ 线索: 10, 已判定: 4, 有效: 2, 商机: 3 }) }, false);
    expect(少.转商机).toEqual({ 比例: 0.3, 分母: "总线索" });
    const 够 = 算看板([渠("a")], { a: 期({ 线索: 10, 已判定: 5, 有效: 4, 商机: 3 }) }, false);
    expect(够.转商机).toEqual({ 比例: 0.75, 分母: "有效线索" });
    // 导入时就是商机的：算商机数，不进转化的分子分母
    const 导入 = 算看板([渠("a")], { a: 期({ 线索: 10, 已判定: 2, 有效: 1, 商机: 6, 起线索: 4, 起有效: 1, 起转商机: 1 }) }, false);
    expect(导入).toMatchObject({ 线索: 10, 商机: 6, 转商机: { 比例: 0.25, 分母: "总线索" } });
    expect(够.转订单).toBe(0);
    expect(算看板([渠("a")], { a: 期({ 线索: 10 }) }, false)).toMatchObject({ 转商机: { 比例: 0, 分母: "总线索" }, 转订单: null });
    expect(算看板([渠("a")], {}, false)).toMatchObject({ 转商机: { 比例: null }, 转订单: null, 有效率: null });
    expect(算看板([渠("a")], { a: 期({ 商机: 4, 订单: 1 }) }, false).转订单).toBe(0.25);
  });

  it("低效预警：线索不到 30 不看；转化低 / 有效率低 / 双低 / 0%；线索多的在前，最多 3 个", () => {
    expect(预警线索下限).toBe(30);
    const 底: Record<string, 渠道期数> = {
      // 全员：线索 1000、已判定 600、有效 300（有效率 0.5）、商机 100（够一半 → 分母有效线索，0.333）
      好: 期({ 线索: 500, 已判定: 300, 有效: 200, 商机: 80 }),
      转低: 期({ 线索: 100, 已判定: 60, 有效: 40, 商机: 4 }), // 0.1 < 0.167；有效率 0.67 不低
      效低: 期({ 线索: 120, 已判定: 100, 有效: 10, 商机: 5 }), // 有效率 0.1 < 0.25；转化 0.5 不低
      双低: 期({ 线索: 150, 已判定: 100, 有效: 20, 商机: 1 }), // 有效率 0.2、转化 0.05
      零: 期({ 线索: 99, 已判定: 30, 有效: 30, 商机: 0 }), // 0%
      少: 期({ 线索: 29, 已判定: 10, 有效: 0, 商机: 0 }), // 不到 30 不看
      零二: 期({ 线索: 31, 已判定: 10, 有效: 0, 商机: 10 }),
    };
    const ids = Object.keys(底);
    const k = 算看板(ids.map((id) => 渠(id)), 底, false);
    expect(k.转商机.分母).toBe("有效线索");
    expect(k.预警.map((w) => w.id)).toEqual(["双低", "效低", "转低"]);
    expect(k.预警[0].项).toEqual([{ 指标: "有效率/转化", 值: "双低" }]);
    expect(k.预警[1].项).toEqual([{ 指标: "有效率", 值: "低" }]);
    expect(k.预警[2].项).toEqual([{ 指标: "转化", 值: "低" }]);
    // 另一批（已判定不到一半 → 分母总线索）：「零」转化 0%；「零二」有效率 0 低、转化不低；「少」不到 30 不看
    const 全 = 算看板(["零", "零二", "少"].map((id) => 渠(id)), 底, false);
    expect(全.预警.map((w) => [w.id, w.项])).toEqual([
      ["零", [{ 指标: "转化", 值: "0%" }]],
      ["零二", [{ 指标: "有效率", 值: "低" }]],
    ]);
  });

  it("环形图：多种属性按属性；属性单选按负责人（只一个负责人也摆）；筛了负责人收起；超过 5 段并成其他", () => {
    const 底 = { a: 期({ 线索: 5 }), b: 期({ 线索: 3 }), c: 期({ 线索: 2 }), d: 期({ 线索: 0 }) };
    const 渠们 = [渠("a", { attr: "公域引流" }), 渠("b", { attr: null, channelOwnerName: "张三" }), 渠("c", { attr: "公域引流", channelOwnerName: "张三" }), 渠("d", { attr: "私域" })];
    expect(环形of(渠们, 底, false)).toEqual({ 按: "属性", 段: [{ 名: "公域引流", 数: 7 }, { 名: "未填属性", 数: 3 }] });
    // 属性单选：同一个格子换成按负责人
    const 单属性 = 渠们.filter((c) => c.attr === "公域引流");
    expect(环形of(单属性, 底, false)).toEqual({ 按: "负责人", 段: [{ 名: "销售甲", 数: 5 }, { 名: "张三", 数: 2 }] });
    // 筛了负责人（单独或加属性）：收起
    expect(环形of(渠们, 底, true)).toBeNull();
    expect(环形of(单属性, 底, true)).toBeNull();
    // 属性单选、负责人也只有一个：照样按负责人摆一整圈（格子不跳）
    expect(环形of([渠("a"), 渠("c", { channelOwnerName: "销售甲" })], 底, false)).toEqual({ 按: "负责人", 段: [{ 名: "销售甲", 数: 7 }] });
    expect(算看板([渠("a")], 底, true).环).toBeNull();
    // 七个属性：前四个 + 其他
    const 七 = Array.from({ length: 7 }, (_, i) => 渠(`x${i}`, { attr: `属性${i}` }));
    const 七底 = Object.fromEntries(七.map((c, i) => [c.id, 期({ 线索: 10 - i })]));
    expect(环形of(七, 七底, false)!.段).toEqual([
      { 名: "属性0", 数: 10 }, { 名: "属性1", 数: 9 }, { 名: "属性2", 数: 8 }, { 名: "属性3", 数: 7 }, { 名: "其他", 数: 6 + 5 + 4 },
    ]);
  });

  it("筛渠道：关键词（全称、名称、属性、备注）、属性、负责人、状态，和列表一份；看板只合筛出来的", () => {
    const 行 = [
      { id: "a", name: "抖音|官方号", platform: "抖音", attr: "公域引流", remark: null, channelOwnerId: "u1", channelOwnerName: "销售甲", active: true },
      { id: "b", name: "展会|秋季", platform: "展会", attr: "线下", remark: "老客带", channelOwnerId: "u2", channelOwnerName: "张三", active: true },
      { id: "c", name: "小红书", platform: null, attr: "公域引流", remark: null, channelOwnerId: "u2", channelOwnerName: "张三", active: false },
    ];
    const 空 = { kw: "", attr: "", ownerId: "", active: "" };
    expect(筛渠道(行, 空).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(筛渠道(行, { ...空, kw: " 官方 " }).map((r) => r.id)).toEqual(["a"]);
    expect(筛渠道(行, { ...空, kw: "老客" }).map((r) => r.id)).toEqual(["b"]);
    expect(筛渠道(行, { ...空, attr: "公域引流" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(筛渠道(行, { ...空, ownerId: "u2" }).map((r) => r.id)).toEqual(["b", "c"]);
    expect(筛渠道(行, { ...空, active: "off" }).map((r) => r.id)).toEqual(["c"]);
    expect(筛渠道(行, { ...空, attr: "公域引流", active: "on" }).map((r) => r.id)).toEqual(["a"]);
    const 底 = { a: 期({ 线索: 5, 商机: 1 }), b: 期({ 线索: 3 }), c: 期({ 线索: 2, 商机: 2 }) };
    const k = 算看板(筛渠道(行, { ...空, attr: "公域引流" }), 底, false);
    expect(k).toMatchObject({ 渠道数: 2, 线索: 7, 商机: 3 });
    expect(k.榜.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("未录投入：这批渠道里一笔没录的个数和第一个（按列表顺序）；成交、投入跨渠道按币种合", () => {
    const 底 = {
      a: 期({ 成交: [{ 币种: "CNY", 合计: 100 }], 投入: [{ 币种: "CNY", 合计: 40 }] }),
      b: 期({ 成交: [{ 币种: "CNY", 合计: 60.5 }, { 币种: "USD", 合计: 5 }] }),
      c: 期({}),
    };
    const k = 算看板([渠("a"), 渠("b", { 投入数: 0 }), 渠("c", { 投入数: 0 })], 底, false);
    expect(k.未录投入).toBe(2);
    expect(k.首个未录).toBe("b");
    expect(k.成交).toEqual([{ 币种: "CNY", 合计: 160.5 }, { 币种: "USD", 合计: 5 }]);
    expect(k.投入).toEqual([{ 币种: "CNY", 合计: 40 }]);
    expect(k.产出比).toBeNull();
    expect(算看板([渠("a")], 底, false)).toMatchObject({ 产出比: 2.5, 未录投入: 0, 首个未录: null });
  });
});

describe("读库", () => {
  let 销售: string, 渠道: string, 渠道乙: string;
  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    销售 = (await prisma.user.create({ data: { email: "s1", name: "销售甲", title: "", role: "ADMIN", password: "x" } })).id;
    渠道 = (await prisma.channel.create({ data: { name: "抖音|官方号", attr: "公域引流", platform: "抖音", channelOwnerId: 销售 } })).id;
    渠道乙 = (await prisma.channel.create({ data: { name: "展会|秋季", attr: "线下", platform: "展会", channelOwnerId: 销售 } })).id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });

  it("全部周期和列表对得上：总线索 = 关联项目，商机 = 关联商机 + 关联订单，订单 = 关联订单，成交额 = 累计成交；项目来源优先、没填退回客户来源；判定读进来", async () => {
    const 客户 = (await prisma.customer.create({ data: { name: "张三", phone: "13800000051", salesOwnerId: 销售, channelId: 渠道 } })).id;
    const 建 = async (phase: string, o: { amount?: number; 渠?: string | null; 判?: string; 日志?: [string, string][]; createdAt?: Date } = {}) => {
      const p = await prisma.project.create({
        data: { name: `p-${phase}`, customerId: 客户, ownerId: 销售, creatorId: 销售, phase, amount: o.amount ?? 0, currency: "CNY", channelId: o.渠 ?? null, createdAt: o.createdAt ?? 京("2026-10-01 09:00") },
      });
      for (const [to, t] of o.日志 ?? []) await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 销售, at: 京(t), toPhase: to, toNode: "x", kind: "node" } });
      if (o.判) await prisma.entLeadVerify.create({ data: { projectId: p.id, verdict: o.判 } });
    };
    await 建("线索", { 判: "有效线索", 日志: [["线索", "2026-10-01 09:00"]] });
    await 建("线索", { 判: "无效线索" });
    await 建("线索", { 判: "初验无效" });
    await 建("商机", { 日志: [["线索", "2026-10-01 09:00"], ["商机", "2026-11-02 09:00"]] });
    await 建("订单", { amount: 800, 日志: [["订单", "2026-10-30 09:00"]] });
    await 建("订单", { amount: 200 }); // 没日志的老数据
    await 建("线索", { 渠: 渠道乙 }); // 项目来源填了别的渠道：不算到客户来源那边
    await prisma.projectNodeLog.create({ data: { projectId: (await prisma.project.findFirstOrThrow({ where: { phase: "商机" } })).id, userId: 销售, at: 京("2026-11-02 10:00"), fromPhase: "商机", toPhase: "商机", toNode: "y", kind: "transfer" } });
    await prisma.entChannelInvest.create({ data: { channelId: 渠道, amount: 250, currency: "CNY", date: 京("2026-11-01 00:00"), userId: 销售 } });

    const 今 = 京("2026-11-03 10:00");
    const 渠道们 = [渠道, 渠道乙].map((id) => ({ id, createdAt: 京("2026-09-01 00:00"), endDate: null }));
    const [列表, 底] = await Promise.all([读渠道统计(渠道们, 今), 读看板底数([渠道, 渠道乙], 今)]);
    const 全 = 底.全部[渠道];
    expect(全.线索).toBe(列表[渠道].关联项目);
    expect(全.商机).toBe(列表[渠道].关联商机 + 列表[渠道].关联订单);
    expect(全.订单).toBe(列表[渠道].关联订单);
    expect(全.成交).toEqual(列表[渠道].累计成交);
    expect(全.投入).toEqual(列表[渠道].当前投入);
    expect(全).toMatchObject({ 线索: 6, 已判定: 2, 有效: 1, 商机: 3, 订单: 2 });
    // 线索→商机和列表一个口径：带「订单」建项目日志的那条起步是订单，不进分子分母
    expect([全.起转商机, 全.起线索]).toEqual([列表[渠道].线索转商机.分子, 列表[渠道].线索转商机.分母]);
    expect([全.起转商机, 全.起线索]).toEqual([2, 5]);
    expect(算看板([{ id: 渠道, name: "x", attr: "公域引流", channelOwnerName: "销售甲", 投入数: 1 }], 底.全部, false).转商机).toEqual({ 比例: 列表[渠道].线索转商机.比例, 分母: "总线索" });
    expect(底.全部[渠道乙].线索).toBe(列表[渠道乙].关联项目);
    expect(底.全部[渠道乙].线索).toBe(1);
    // 本月：项目都是 10 月建的；商机 11-02 那条（转让日志不算）；订单都在 10 月；投入 11-01
    expect(底.本月[渠道]).toMatchObject({ 线索: 0, 商机: 1, 订单: 0, 成交: [], 投入: [{ 币种: "CNY", 合计: 250 }] });
    expect(底.本季[渠道]).toMatchObject({ 线索: 6, 商机: 3, 订单: 2, 成交: [{ 币种: "CNY", 合计: 1000 }] });
  });

  it("没有渠道：空底数，不查库", async () => {
    expect(await 读看板底数([])).toEqual({ 本月: {}, 本季: {}, 全部: {} });
  });
});
