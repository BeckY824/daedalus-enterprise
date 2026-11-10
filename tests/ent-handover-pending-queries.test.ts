/**
 * 客户页顶上「待确认的交接」不再每笔查一轮（代码体检 5.2 N+1 第 2 条）：
 *   原来每笔转让各查一遍「还归原负责人的客户」+ 数转走的项目（每位客户再查一条进公海记录、三条项目），客户页每次加载都调。
 *   现在所有待确认的转让一次 in 查、内存里按笔分：查库次数不随笔数、客户数涨，说出来的那句和 数转走的项目 逐笔对得上。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 看全部 } from "@/lib/team-scope";
import { 数转走的项目 } from "@/lib/carry-over-db";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 待确认的交接 } from "@/app/(app)/customers/handover-actions";

type 人 = { id: string; role: string };
let 老板: 人, 销售们: 人[], 接手: 人, 同事: 人;
let 号 = 0;

async function 建(email: string, role: string, bizRole: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  await raw.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; 忘掉企业版范围(); };
const 客户 = (salesOwnerId: string) =>
  raw.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId } });
const 项目 = (customerId: string, ownerId: string, 补: Record<string, unknown> = {}) =>
  raw.project.create({ data: { name: `项目${++号}`, customerId, ownerId, creatorId: ownerId, phase: "线索", node: "线索验证", ...补 } });
const 转让 = (from: string, to: string, customerIds: string[]) =>
  raw.entHandover.create({ data: { kind: "转让", fromUserId: from, toUserId: to, byUserId: from, customerIds: JSON.stringify(customerIds), counts: JSON.stringify({ 客户: customerIds.length }) } });

/** 数这段跑了几次查库：所有客户端（限定的、事务里的）最后都走同一个引擎 */
async function 数查库<T>(fn: () => Promise<T>): Promise<{ 值: T; 次: number }> {
  const 引擎 = (raw as unknown as { _engine: { request: (...a: unknown[]) => unknown; requestBatch: (...a: unknown[]) => unknown } })._engine;
  const 一 = vi.spyOn(引擎, "request");
  const 批 = vi.spyOn(引擎, "requestBatch");
  try {
    const 值 = await fn();
    return { 值, 次: 一.mock.calls.length + 批.mock.calls.length };
  } finally {
    一.mockRestore();
    批.mockRestore();
  }
}

/** 造 笔 笔转让，每笔 每笔几位 位客户；每位客户一个负责人自己的项目、一个同事在推的、一个线索公海里的 */
async function 造(笔: number, 每笔几位: number) {
  for (let i = 0; i < 笔; i++) {
    const from = 销售们[i % 销售们.length];
    const ids: string[] = [];
    for (let j = 0; j < 每笔几位; j++) {
      const c = await 客户(from.id);
      ids.push(c.id);
      await 项目(c.id, from.id);
      await 项目(c.id, 同事.id);
      await 项目(c.id, "", { pooledAt: new Date() });
    }
    await 转让(from.id, 接手.id, ids);
  }
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  老板 = await 建("boss", "ADMIN", "director");
  接手 = await 建("taker", "SALES", "sales");
  同事 = await 建("mate", "SALES", "sales");
  销售们 = [];
  for (let i = 0; i < 3; i++) 销售们.push(await 建(`s${i}`, "SALES", "sales"));
  vi.stubEnv("CRM_ENTERPRISE", "1");
  // 只读通道另有 4 个连接、各有各的引擎：关掉，查询全走主连接才数得全
  vi.stubEnv("CRM_READ_POOL", "0");
  await setSetting("enterprise.rule.org_scope", true);
  当(老板);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("待确认的交接：查库次数不随笔数涨", () => {
  it("2 笔和 12 笔、每笔 1 位和 4 位，查库次数一样", async () => {
    await 造(2, 1);
    await 待确认的交接(); // 热一下：范围、组织、设置缓存
    const 少 = await 数查库(() => 待确认的交接());
    expect(少.值.我发起的).toHaveLength(2);
    await 造(10, 4);
    await 待确认的交接();
    const 多 = await 数查库(() => 待确认的交接());
    expect(多.值.我发起的).toHaveLength(12);
    expect(少.次).toBeGreaterThan(0);
    // 改前（b1db0af3）实测：2 笔 23 次、12 笔 113 次
    expect(多.次).toBeLessThan(23);
    expect(多.次).toBe(少.次);
  });

  it("每笔说的「全部 N 个项目（含 M 个同事在推的）」和逐笔 数转走的项目 对得上", async () => {
    await 造(3, 2);
    // 再掺几种：没项目的、交接期间进了公海的、被改给了别人的、待分配的、已结束的、转给本来的负责人、原负责人是占位账号的
    const 空 = await 客户(销售们[0].id);
    const 进公海的 = await 客户(销售们[0].id);
    await 项目(进公海的.id, 销售们[0].id);
    await raw.customerPool.create({ data: { customerId: 进公海的.id, userId: 老板.id, reason: "手动" } });
    const 改走的 = await 客户(销售们[1].id);
    await 项目(改走的.id, 销售们[1].id);
    const 杂 = await 客户(销售们[0].id);
    await 项目(杂.id, 同事.id, { awaitAssignAt: new Date() });
    await 项目(杂.id, 同事.id, { result: "丢单" });
    await 项目(杂.id, 接手.id);
    await 项目(杂.id, 销售们[0].id, { result: "流失" });
    await 转让(销售们[0].id, 接手.id, [空.id]);
    await 转让(销售们[0].id, 接手.id, [进公海的.id, 改走的.id, 杂.id]);
    await 转让(接手.id, 接手.id, [(await 客户(接手.id)).id]);
    const 占位 = await raw.user.create({ data: { email: 无负责人占位邮箱, name: "没人负责", title: "", role: "SALES", password: "x", active: false } });
    const 挂占位 = await 客户(占位.id);
    await raw.customerOwnerLog.create({ data: { customerId: 挂占位.id, fromOwnerId: 销售们[2].id, toOwnerId: 占位.id, userId: 老板.id, kind: "pool-release" } });
    await 项目(挂占位.id, 销售们[2].id);
    await 项目(挂占位.id, 同事.id);
    await 转让(占位.id, 接手.id, [挂占位.id]);

    const 列 = await 待确认的交接();
    const 行们 = [...列.等我确认, ...列.我发起的];
    const 库里 = await raw.entHandover.findMany();
    expect(行们).toHaveLength(库里.length);
    for (const h of 库里) {
      const ids = JSON.parse(h.customerIds) as string[];
      const 还归他 = (await raw.customer.findMany({ where: { id: { in: ids }, salesOwnerId: h.fromUserId, pool: null }, select: { id: true } })).map((c) => c.id);
      const 预 = await 看全部(() => 数转走的项目(还归他, h.toUserId));
      const 句 = !预.项目数 ? "全部项目" : `全部 ${预.项目数} 个项目${预.同事?.项目数 ? `（含 ${预.同事.项目数} 个同事在推的，负责人一起改成你）` : ""}`;
      expect(行们.find((r) => r.id === h.id)!.确认说明, `交接 ${ids.length} 位`).toContain(`、${句}，`);
    }
    // 至少有一笔真数出了同事在推的，免得两边都是空的也算对上
    expect(行们.some((r) => r.确认说明.includes("个同事在推的"))).toBe(true);
  });
});
