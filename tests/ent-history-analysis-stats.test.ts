/**
 * 「历史沟通分析」回填的项目（Project.source = history-analysis，迁移 151）不进数据页的任何统计（system-created.ts）：
 *   现在：结局、公海、漏斗、线索瀑布、线索转商机、阶段 / 节点 / 按人
 *   一段：新建（createdAt）、结局按 closedAt 落段、转商机 / 转订单（节点变更：回填约定不写；写了按留痕人 / 项目来源排掉）
 * 同时钉住改成库里分组数之后，正常项目的数和逐个数一样（判无效拆分、外币、按人只看）。
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 项目现在, 项目一段 } from "../src/app/(app)/overview/project-stats";
import { 不算历史分析, 历史分析来源, 历史分析留痕人, 补建创建人, 来源字 } from "@/lib/project/system-created";

let 王: { id: string }, 李: { id: string }, 客户: { id: string }, 公海客户: { id: string };

/** 上个月（已过完） */
const 上月 = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  const 前缀 = `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  return { 日: (n: number) => new Date(`${前缀}-${p(n)}T10:00:00`), from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999) };
};

type 建参 = { name: string; ownerId: string; phase: string; node: string; result?: string; amount?: number; currency?: string; createdAt?: Date; closedAt?: Date; pooledAt?: Date; customerId?: string; source?: string; creatorId?: string };
async function 建(o: 建参) {
  return prisma.project.create({ data: { customerId: 客户.id, creatorId: o.ownerId, ...o } });
}
/** 回填一个历史分析项目：挂公海客户、在公海、负责人清空、创建人 system（约定第 1 条） */
async function 回填(o: Partial<建参> & { phase: string; node: string }) {
  return 建({ name: "历史", ownerId: "", customerId: 公海客户.id, pooledAt: new Date(), source: 历史分析来源, creatorId: 补建创建人, ...o });
}

beforeEach(async () => {
  await resetDb();
  王 = await prisma.user.create({ data: { email: "w@t", password: "x", name: "王", role: "SALES" } });
  李 = await prisma.user.create({ data: { email: "l@t", password: "x", name: "李", role: "SALES" } });
  客户 = await prisma.customer.create({ data: { name: "云帆科技", phone: "13900000001", salesOwnerId: 王.id } });
  公海客户 = await prisma.customer.create({ data: { name: "旧客户", phone: "13900000002", salesOwnerId: 王.id } });
});
afterAll(async () => void (await prisma.$disconnect()));

describe("常量", () => {
  it("不算历史分析：source 为空的（正常建的）照算，别的来源也照算，只排历史分析", async () => {
    await 建({ name: "a", ownerId: 王.id, phase: "线索", node: "潜客培育" });
    await 建({ name: "b", ownerId: 王.id, phase: "线索", node: "潜客培育", source: "别的来源" });
    await 回填({ phase: "线索", node: "潜客培育" });
    expect(await prisma.project.count({ where: 不算历史分析 })).toBe(2);
    expect(来源字(历史分析来源)).toBe("历史分析");
    expect(来源字(null)).toBe("—");
  });
});

describe("现在", () => {
  it("历史分析的进行中 / 流失 / 丢单都不进 结局、公海、漏斗、线索瀑布、线索转商机；被领走还在推的只进在跟", async () => {
    await 建({ name: "a", ownerId: 王.id, phase: "线索", node: "潜客培育" });
    await 建({ name: "b", ownerId: 李.id, phase: "商机", node: "共识方案", amount: 100 });
    await 建({ name: "c", ownerId: 李.id, phase: "商机", node: "明确需求", pooledAt: new Date() });
    await 建({ name: "d", ownerId: 王.id, phase: "线索", node: "潜客培育", result: "线索流失", closedAt: new Date() });
    const 改前 = await 项目现在("CNY");

    // 回填：公海里进行中的线索 / 商机，带结局的线索流失、丢单
    for (let i = 0; i < 5; i++) await 回填({ phase: "线索", node: "潜客培育" });
    for (let i = 0; i < 3; i++) await 回填({ phase: "商机", node: "明确需求" });
    for (let i = 0; i < 4; i++) await 回填({ phase: "线索", node: "潜客培育", result: "线索流失", closedAt: new Date("2023-05-01") });
    for (let i = 0; i < 2; i++) await 回填({ phase: "商机", node: "共识方案", result: "丢单", closedAt: new Date("2024-02-01") });
    // 已被王领走、还在推的一个（领客户时一起带走的）
    await 回填({ phase: "商机", node: "共识方案", pooledAt: undefined, ownerId: 王.id });
    const 改后 = await 项目现在("CNY");
    // 领走还在推的那个（王手上的商机）只进阶段 / 节点 / 按人，别的都和回填前一样
    expect(改后.阶段.find((x) => x.phase === "商机")?.count).toBe(改前.阶段.find((x) => x.phase === "商机")!.count + 1);
    expect(改后.按人.find((r) => r.name === "王")?.商机).toBe(1);
    expect({ ...改后, 阶段: 改前.阶段, 节点: 改前.节点, 按人: 改前.按人 }).toEqual(改前);
    expect(改后.公海).toBe(1);
    expect(改后.结局.find((r) => r.result === "线索流失")?.count).toBe(1);
    expect(改后.结局.find((r) => r.result === "丢单")?.count).toBe(0);
    expect(改后.漏斗[0].count).toBe(4);
    expect(改后.线索转商机).toBe(2);
  });

  it("分组数和逐个数一样：判无效拆开、外币只数金额大于 0 的、按人只看", async () => {
    // 判无效要这一次结束对得上终判的时间（P-界面-66，lost-split.ts）
    const 判时 = new Date();
    const 判 = await 建({ name: "x", ownerId: 王.id, phase: "线索", node: "潜客培育", result: "线索流失", closedAt: 判时 });
    await prisma.entLeadVerify.create({ data: { projectId: 判.id, finalResult: "无效线索", finalAt: 判时 } });
    await 建({ name: "y", ownerId: 王.id, phase: "线索", node: "潜客培育", result: "线索流失", closedAt: new Date() });
    await 建({ name: "z", ownerId: 王.id, phase: "线索", node: "潜客培育", pooledAt: new Date() });
    await 建({ name: "u1", ownerId: 李.id, phase: "商机", node: "共识方案", amount: 50, currency: "USD" });
    await 建({ name: "u2", ownerId: 李.id, phase: "商机", node: "共识方案", amount: 0, currency: "USD" });
    await 建({ name: "c1", ownerId: 李.id, phase: "商机", node: "共识方案", amount: 70 });
    await 建({ name: "c2", ownerId: 李.id, phase: "商机", node: "共识方案", amount: 30 });
    const 数 = await 项目现在("CNY");
    const 培育 = 数.线索节点.find((n) => n.node === "潜客培育")!;
    expect(培育).toMatchObject({ count: 0, 流失: 1, 判无效: 1, 退回公海: 1 });
    expect(数.外币).toBe(1);
    expect(数.节点.find((n) => n.node === "共识方案")).toMatchObject({ count: 4, amount: 100 });
    expect(数.按人.find((r) => r.name === "李")).toMatchObject({ 商机: 4, 商机金额: 100 });
    const 李的 = await 项目现在("CNY", 李.id);
    expect(李的.阶段.find((s) => s.phase === "商机")).toMatchObject({ count: 4, amount: 100 });
    expect(李的.外币).toBe(1);
    expect(李的.结局.find((r) => r.result === "线索流失")?.count).toBe(0);
  });
});

describe("一段", () => {
  it("历史分析的：createdAt、closedAt 落在这一段也不算新建、流失、丢单；节点变更不算转商机 / 转订单", async () => {
    const m = 上月();
    const 正常 = await 建({ name: "a", ownerId: 王.id, phase: "商机", node: "明确需求", createdAt: m.日(3) });
    await prisma.projectNodeLog.create({ data: { projectId: 正常.id, userId: 王.id, fromPhase: "线索", fromNode: "潜客培育", toPhase: "商机", toNode: "明确需求", at: m.日(4) } });
    await 建({ name: "b", ownerId: 王.id, phase: "商机", node: "明确需求", result: "丢单", createdAt: m.日(3), closedAt: m.日(5) });
    const 改前 = await 项目现在一段(m);

    const 流 = await 回填({ phase: "线索", node: "潜客培育", result: "线索流失", createdAt: m.日(2), closedAt: m.日(6) });
    const 丢 = await 回填({ phase: "商机", node: "共识方案", result: "丢单", createdAt: m.日(2), closedAt: m.日(7) });
    await 回填({ phase: "订单", node: "生产备货", createdAt: m.日(2) });
    // 约定外：回填万一写了节点变更（留痕人 = 历史分析留痕人，或按项目来源认）
    await prisma.projectNodeLog.create({ data: { projectId: 丢.id, userId: 历史分析留痕人, fromPhase: "线索", fromNode: "潜客培育", toPhase: "商机", toNode: "共识方案", at: m.日(6) } });
    await prisma.projectNodeLog.create({ data: { projectId: 丢.id, userId: 王.id, fromPhase: "商机", fromNode: "共识方案", toPhase: "订单", toNode: "签订合同", at: m.日(6) } });
    // 正常项目上留痕人写成了历史分析留痕人的（回填脚本补的）同样不算
    await prisma.projectNodeLog.create({ data: { projectId: 正常.id, userId: 历史分析留痕人, fromPhase: "商机", fromNode: "明确需求", toPhase: "订单", toNode: "签订合同", at: m.日(8) } });
    void 流;
    const 改后 = await 项目现在一段(m);
    expect(改后).toEqual(改前);
    expect(改后.合计).toMatchObject({ 新建: 2, 转商机: 1, 转订单: 0, 线索流失: 0, 丢单: 1 });
  });
});

function 项目现在一段(m: ReturnType<typeof 上月>) {
  return 项目一段(m.from, m.to, "day", "CNY");
}
