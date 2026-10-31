/**
 * 企业版只用项目时「数据」页的数（10-26 用户：「「数据」页改成按项目统计」）。
 *
 *   现在：进行中的按阶段 / 节点 / 人数，公海的不算在人头上，外币不算金额、另外数
 *   一段：新建按 createdAt；转商机 / 转订单一个项目只数一次（来回改不重复算）；结局按 closedAt，只算现在还是这个结局的
 *   按人：按项目现在的负责人；人删了写「已不在的成员」
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 项目现在, 项目一段 } from "../src/app/(app)/overview/project-stats";

let 王: { id: string }, 李: { id: string }, 客户: { id: string };

/** 上个月（已过完，按天铺不会被「只铺到今天」截短） */
const 上月 = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  const 前缀 = `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  const 末 = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { 日: (n: number) => new Date(`${前缀}-${p(n)}T10:00:00`), from: new Date(d.getFullYear(), d.getMonth(), 1), to: 末, 前缀 };
};

async function 建(o: { name: string; ownerId: string; phase: string; node: string; result?: string; amount?: number; currency?: string; createdAt?: Date; closedAt?: Date; pooledAt?: Date }) {
  return prisma.project.create({ data: { customerId: 客户.id, creatorId: o.ownerId, ...o } });
}
async function 改节点(projectId: string, userId: string, from: [string, string], to: [string, string], at: Date) {
  await prisma.projectNodeLog.create({ data: { projectId, userId, fromPhase: from[0], fromNode: from[1], toPhase: to[0], toNode: to[1], at } });
}

beforeEach(async () => {
  await resetDb();
  王 = await prisma.user.create({ data: { email: "w@t", password: "x", name: "王", role: "SALES" } });
  李 = await prisma.user.create({ data: { email: "l@t", password: "x", name: "李", role: "SALES" } });
  客户 = await prisma.customer.create({ data: { name: "云帆科技", phone: "13900000001", salesOwnerId: 王.id } });
});
afterAll(async () => void (await prisma.$disconnect()));

describe("现在", () => {
  it("进行中按阶段、节点、人数；有结局的另算；公海不算人头；外币不算金额", async () => {
    await 建({ name: "a", ownerId: 王.id, phase: "线索", node: "潜客培育" });
    await 建({ name: "b", ownerId: 王.id, phase: "商机", node: "共识方案", amount: 100000 });
    await 建({ name: "c", ownerId: 李.id, phase: "商机", node: "共识方案", amount: 50000, currency: "USD" });
    await 建({ name: "d", ownerId: 李.id, phase: "订单", node: "生产备货", amount: 80000 });
    await 建({ name: "e", ownerId: 李.id, phase: "商机", node: "明确需求", amount: 30000, pooledAt: new Date() });
    await 建({ name: "f", ownerId: 王.id, phase: "订单", node: "尾款结算", result: "成功交付", amount: 999999, closedAt: new Date() });
    await 建({ name: "g", ownerId: 王.id, phase: "订单", node: "安装实施", result: "异常状态", amount: 1 });

    const 数 = await 项目现在("CNY");
    expect(数.阶段).toEqual([
      { phase: "线索", count: 1, amount: 0 },
      { phase: "商机", count: 3, amount: 130000 },
      { phase: "订单", count: 1, amount: 80000 },
    ]);
    expect(数.节点.find((n) => n.node === "共识方案")).toMatchObject({ count: 2, amount: 100000 });
    expect(数.节点.find((n) => n.node === "安装实施")?.count).toBe(0);
    expect(数.节点).toHaveLength(14);
    expect(数.结局.find((r) => r.result === "成功交付")?.count).toBe(1);
    expect(数.结局.find((r) => r.result === "异常状态")?.count).toBe(1);
    expect(数.公海).toBe(1);
    expect(数.外币).toBe(1);
    const 人 = Object.fromEntries(数.按人.map((r) => [r.name, r]));
    expect(人["王"]).toMatchObject({ 线索: 1, 商机: 1, 订单: 0, 商机金额: 100000 });
    // 李的 USD 商机数个数、不算金额；公海那个不算李的
    expect(人["李"]).toMatchObject({ 线索: 0, 商机: 1, 订单: 1, 商机金额: 0, 订单金额: 80000 });
  });

  it("人删了：写「已不在的成员」", async () => {
    await 建({ name: "a", ownerId: "gone-user", phase: "线索", node: "潜客培育" });
    expect((await 项目现在("CNY")).按人[0].name).toBe("已不在的成员");
  });
});

describe("一段", () => {
  it("新建按 createdAt；转商机 / 转订单一个项目只数一次；结局按 closedAt；按现在的负责人拆", async () => {
    const m = 上月();
    const 段外 = new Date(m.from.getTime() - 86400000);
    const a = await 建({ name: "a", ownerId: 王.id, phase: "商机", node: "共识方案", createdAt: m.日(2) });
    // a 有两条线索→商机的日志（导入能把项目退回线索再进商机），只数一次、算在第一次那天
    await 改节点(a.id, 王.id, ["线索", "线索推进"], ["商机", "明确需求"], m.日(3));
    await 改节点(a.id, 王.id, ["线索", "潜客培育"], ["商机", "明确需求"], m.日(5));
    const b = await 建({ name: "b", ownerId: 李.id, phase: "订单", node: "生产备货", createdAt: 段外 });
    await 改节点(b.id, 王.id, ["线索", "线索推进"], ["商机", "明确需求"], 段外);
    await 改节点(b.id, 李.id, ["商机", "首款支付"], ["订单", "生产备货"], m.日(10));
    // 商机里挪节点不算转
    await 改节点(b.id, 李.id, ["商机", "明确需求"], ["商机", "共识方案"], m.日(8));
    await 建({ name: "c", ownerId: 李.id, phase: "订单", node: "尾款结算", result: "成功交付", amount: 200000, createdAt: 段外, closedAt: m.日(20) });
    await 建({ name: "d", ownerId: 李.id, phase: "订单", node: "尾款结算", result: "成功交付", amount: 50000, currency: "USD", createdAt: 段外, closedAt: m.日(21) });
    await 建({ name: "e", ownerId: 王.id, phase: "线索", node: "潜客培育", result: "线索流失", createdAt: m.日(4), closedAt: m.日(6) });
    await 建({ name: "f", ownerId: 王.id, phase: "商机", node: "明确需求", result: "丢单", createdAt: 段外, closedAt: 段外 });

    const 数 = await 项目一段(m.from, m.to, "day", "CNY");
    expect(数.合计).toEqual({ 新建: 2, 转商机: 1, 转订单: 1, 成功交付: 2, 交付金额: 200000, 线索流失: 1, 丢单: 0, 异常状态: 0 });
    expect(数.外币).toBe(1);
    // 按天铺满整个月
    expect(数.trend).toHaveLength(m.to.getDate());
    const 天 = (n: number) => 数.trend.find((t) => t.label.endsWith(`-${String(n).padStart(2, "0")}`))!;
    expect(天(3).转商机).toBe(1);
    expect(天(5).转商机).toBe(0);
    expect(天(10).转订单).toBe(1);
    expect(天(20).成功交付 + 天(21).成功交付).toBe(2);
    const 人 = Object.fromEntries(数.按人.map((r) => [r.name, r]));
    // b 的转订单按 b 现在的负责人（李）算
    expect(人["李"]).toMatchObject({ 新建: 0, 转订单: 1, 成功交付: 2, 交付金额: 200000 });
    expect(人["王"]).toMatchObject({ 新建: 2, 转商机: 1, 没成: 1 });
    expect(数.按人[0].name).toBe("李");
  });

  it("这一段什么都没有：合计全 0、刻度照样铺", async () => {
    const m = 上月();
    const 数 = await 项目一段(m.from, m.to, "day", "CNY");
    expect(数.合计.新建 + 数.合计.成功交付).toBe(0);
    expect(数.按人).toEqual([]);
    expect(数.trend.length).toBe(m.to.getDate());
    expect(数.trend.every((t) => t.label.startsWith(`${m.前缀.slice(5)}-`) && t.新建 + t.转商机 + t.转订单 + t.成功交付 === 0)).toBe(true);
  });
});

describe("企业版 10-31 改名：库里存着旧名的照新名数", () => {
  beforeEach(() => { vi.stubEnv("CRM_ENTERPRISE", "1"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("现在：旧节点名（明确需求 / 共识方案 / 验收交付）数进新节点；旧结局 成功交付 和新的 交付结清 一起数", async () => {
    await 建({ name: "a", ownerId: 王.id, phase: "商机", node: "明确需求", amount: 10 });
    await 建({ name: "b", ownerId: 王.id, phase: "商机", node: "痛点挖掘", amount: 20 });
    await 建({ name: "c", ownerId: 李.id, phase: "商机", node: "共识方案" });
    await 建({ name: "d", ownerId: 李.id, phase: "订单", node: "验收交付" });
    await 建({ name: "e", ownerId: 王.id, phase: "订单", node: "尾款结算", result: "成功交付", closedAt: new Date() });
    await 建({ name: "f", ownerId: 王.id, phase: "订单", node: "尾款结算", result: "交付结清", closedAt: new Date() });

    const 数 = await 项目现在("CNY");
    expect(数.节点.find((n) => n.node === "痛点挖掘")).toMatchObject({ count: 2, amount: 30 });
    expect(数.节点.find((n) => n.node === "方案确认")?.count).toBe(1);
    expect(数.节点.find((n) => n.node === "交付验收")?.count).toBe(1);
    expect(数.节点.map((n) => n.node)).not.toContain("明确需求");
    expect(数.节点.map((n) => n.node)).not.toContain("验收交付");
    expect(数.结局.find((r) => r.result === "交付结清")?.count).toBe(2);
    expect(数.结局.map((r) => r.result)).not.toContain("成功交付");
  });

  it("一段：旧结局 成功交付 和新的 交付结清 都算进交付", async () => {
    const m = 上月();
    const 段外 = new Date(m.from.getTime() - 86400000);
    await 建({ name: "c", ownerId: 李.id, phase: "订单", node: "尾款结算", result: "成功交付", amount: 100, createdAt: 段外, closedAt: m.日(20) });
    await 建({ name: "d", ownerId: 李.id, phase: "订单", node: "尾款结算", result: "交付结清", amount: 50, createdAt: 段外, closedAt: m.日(21) });

    const 数 = await 项目一段(m.from, m.to, "day", "CNY");
    expect(数.合计).toMatchObject({ 成功交付: 2, 交付金额: 150 });
  });
});
