/**
 * 离职交接的两处读不再每位离职成员查一轮（代码体检 5.2 N+1 第 1、3 条）：
 *   - 待交接人数（客户页每次加载都调）：原来每位最多 5 条 count；现在每样东西一句 groupBy
 *   - 读离职交接（离职交接页）：原来每位 2 条 findMany + 4 条 count + 原负责人、交接中各查一遍；现在一起查、内存里按人分
 * 查库次数不随离职人数、名下条数涨；结果和「逐位查」（下面抄的改前写法）逐条对得上。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
  项目模式: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.项目模式 }) };
});

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 看全部 } from "@/lib/team-scope";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 停用的同事 } from "@/lib/offboard-db";
import { 公海客户原负责人是 } from "@/lib/owner-log-db";
import { 离职交接中 } from "@/lib/enterprise/handover-db";
import { 读离职交接, 待交接人数, type 离职待交接 } from "@/lib/enterprise/offboard-handover";

type 人 = { id: string; role: string };
let 老板: 人, 上级: 人, 在职: 人, 占位: string;
let 号 = 0;

async function 建(email: string, bizRole: string | null, 补: { managerId?: string; active?: boolean; role?: string } = {}): Promise<人> {
  const role = 补.role ?? "SALES";
  const u = await raw.user.create({ data: { email, name: `人-${email}`, title: "", role, password: "x", active: 补.active ?? true } });
  if (bizRole) await raw.entMember.create({ data: { userId: u.id, bizRole, managerId: 补.managerId ?? null } });
  return { id: u.id, role };
}
const 客户 = (salesOwnerId: string) =>
  raw.customer.create({ data: { name: `客户${String(++号).padStart(5, "0")}`, phone: `139${String(号).padStart(8, "0")}`, salesOwnerId } });
const 项目 = (customerId: string, ownerId: string, 补: Record<string, unknown> = {}) =>
  raw.project.create({ data: { name: `项目${String(++号).padStart(5, "0")}`, customerId, ownerId, creatorId: ownerId, phase: "线索", node: "线索验证", ...补 } });
const 待办 = (customerId: string, ownerId: string, done = false) => raw.task.create({ data: { title: `待办${++号}`, customerId, ownerId, done } });
const 进公海 = (customerId: string) => raw.customerPool.create({ data: { customerId, userId: 老板.id, reason: "手动" } });
/** M-公海-03：进公海清负责人，挂到占位账号，原负责人只在历史记录里 */
async function 放走(customerId: string, 原: string) {
  await raw.customer.update({ where: { id: customerId }, data: { salesOwnerId: 占位 } });
  await raw.customerOwnerLog.create({ data: { customerId, fromOwnerId: 原, toOwnerId: 占位, userId: 老板.id, kind: "pool-release" } });
  await 进公海(customerId);
}

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

/** 一位离职成员名下摆 每样几个 份东西：自己的客户（带各种项目）、挂在别人客户上的项目和待办、线索、渠道、主渠道 */
async function 摆(谁: 人, 每样几个: number, 另一位离职?: 人) {
  for (let i = 0; i < 每样几个; i++) {
    const c = await 客户(谁.id);
    await 项目(c.id, 谁.id);
    await 项目(c.id, 谁.id, { result: "丢单" });
    await 项目(c.id, 在职.id);
    await 项目(c.id, 在职.id, { awaitAssignAt: new Date() });
    await 项目(c.id, 谁.id, { pooledAt: new Date() });
    if (另一位离职) {
      await 项目(c.id, 另一位离职.id);
      await 项目(c.id, 另一位离职.id, { result: "线索流失" });
    }
    await 待办(c.id, 谁.id);
    const 别人的 = await 客户(在职.id);
    await 项目(别人的.id, 谁.id);
    await 项目(别人的.id, 谁.id, { result: "丢单" });
    await 项目(别人的.id, 谁.id, { pooledAt: new Date() });
    await 待办(别人的.id, 谁.id);
    await 待办(别人的.id, 谁.id, true);
    await raw.lead.create({ data: { name: `线索${++号}`, ownerId: 谁.id } });
    await raw.channel.create({ data: { name: `渠道${++号}|其他`, channelOwnerId: 谁.id } });
    await raw.entChannelMain.create({ data: { name: `主渠道${++号}`, ownerId: 谁.id } });
  }
}

/** 改前的写法（ent/main dc53fcb5 的 offboard-handover.ts）原样抄来：每位离职成员各查一轮 */
async function 逐位读(ids: string[], 带项目: boolean): Promise<离职待交接[]> {
  return 看全部(async () => {
    const 人们 = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const 上级of = new Map((await prisma.entMember.findMany({ where: { userId: { in: ids } }, select: { userId: true, managerId: true } })).map((m) => [m.userId, m.managerId]));
    const 上级ids = [...new Set([...上级of.values()].filter((x): x is string => !!x))];
    const 上级名 = new Map((await prisma.user.findMany({ where: { id: { in: 上级ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 结果: 离职待交接[] = [];
    const 停用 = 带项目 ? await 停用的同事(prisma, []) : [];
    for (const u of 人们) {
      const 别的停用 = 停用.filter((x) => x !== u.id);
      const 放走的 = [...(await 公海客户原负责人是(prisma, [u.id])).keys()];
      const 客户们 = await prisma.customer.findMany({
        where: { salesOwnerId: u.id, pool: { is: null } },
        select: { id: true, name: true, ...(带项目 ? { _count: { select: { projects: { where: { pooledAt: null, OR: [{ ownerId: u.id }, { awaitAssignAt: { not: null } }, ...(别的停用.length ? [{ ownerId: { in: 别的停用 }, result: null }] : [])] } } } } } : {}) },
        orderBy: { name: "asc" },
      });
      const 项目们 = 带项目
        ? await prisma.project.findMany({
            where: { ownerId: u.id, pooledAt: null, result: null, customer: { salesOwnerId: { not: u.id } }, customerId: { notIn: 放走的 } },
            select: { id: true, name: true, customer: { select: { name: true } } },
            orderBy: { name: "asc" },
          })
        : [];
      const [线索, 渠道, 主渠道, 待办数] = await Promise.all([
        prisma.lead.count({ where: { ownerId: u.id } }),
        prisma.channel.count({ where: { channelOwnerId: u.id } }),
        prisma.entChannelMain.count({ where: { ownerId: u.id } }),
        prisma.task.count({ where: { ownerId: u.id, done: false, customer: { salesOwnerId: { not: u.id } }, customerId: { notIn: 放走的 } } }),
      ]);
      if (!客户们.length && !项目们.length && !线索 && !渠道 && !主渠道 && !待办数) continue;
      结果.push({
        id: u.id,
        name: u.name,
        上级: 上级of.get(u.id) ? 上级名.get(上级of.get(u.id)!) ?? null : null,
        交接中: !!(await 离职交接中(u.id)),
        客户: 客户们.map((c) => ({ id: c.id, name: c.name, 项目数: "_count" in c ? (c._count as { projects: number }).projects : 0 })),
        项目: 项目们.map((p) => ({ id: p.id, name: p.name, 客户: p.customer.name })),
        其余: { 线索, 渠道, 主渠道, 待办: 待办数 },
      });
    }
    return 结果;
  });
}
async function 逐位数(ids: string[], 带项目: boolean): Promise<number> {
  return 看全部(async () => {
    let n = 0;
    for (const id of ids) {
      const 有 = (await prisma.customer.count({ where: { salesOwnerId: id, pool: { is: null } } }))
        || (带项目 && (await prisma.project.count({ where: { ownerId: id, pooledAt: null, result: null, customer: { salesOwnerId: { not: id } } } })))
        || (await prisma.lead.count({ where: { ownerId: id } }))
        || (await prisma.channel.count({ where: { channelOwnerId: id } }))
        || (await prisma.entChannelMain.count({ where: { ownerId: id } }));
      if (有) n++;
    }
    return n;
  });
}
const 离职的 = async () => (await raw.user.findMany({ where: { active: false, email: { not: 无负责人占位邮箱 } }, select: { id: true } })).map((u) => u.id);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  mocks.项目模式 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  // 只读通道另有 4 个连接、各有各的引擎：关掉，查询全走主连接才数得全
  vi.stubEnv("CRM_READ_POOL", "0");
  老板 = await 建("boss", "director", { role: "ADMIN" });
  上级 = await 建("mgr", "sales_mgr");
  在职 = await 建("mate", "sales");
  占位 = (await raw.user.create({ data: { email: 无负责人占位邮箱, name: "没人负责", title: "", role: "SALES", password: "x", active: false } })).id;
  mocks.user = { ...mocks.user, id: 老板.id, role: 老板.role, name: 老板.id };
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("离职交接：查库次数不随离职人数、名下条数涨", () => {
  it("3 位和 15 位、每位 1 份和 3 份，待交接人数、读离职交接的查库次数都一样", async () => {
    const 头批: 人[] = [];
    for (let i = 0; i < 3; i++) 头批.push(await 建(`gone${i}`, "sales", { active: false, managerId: 上级.id }));
    for (const u of 头批) await 摆(u, 1);
    await 待交接人数(老板); // 热一下：组织、设置缓存
    await 读离职交接(老板);
    const 少数 = await 数查库(() => 待交接人数(老板));
    const 少读 = await 数查库(() => 读离职交接(老板));
    expect(少数.值).toBe(3);
    expect(少读.值).toHaveLength(3);

    for (let i = 3; i < 15; i++) await 摆(await 建(`gone${i}`, "sales", { active: false, managerId: 上级.id }), 3, 头批[0]);
    await 待交接人数(老板);
    await 读离职交接(老板);
    const 多数 = await 数查库(() => 待交接人数(老板));
    const 多读 = await 数查库(() => 读离职交接(老板));
    expect(多数.值).toBe(15);
    expect(多读.值).toHaveLength(15);

    expect(少数.次).toBeGreaterThan(0);
    expect(多数.次).toBe(少数.次);
    expect(多读.次).toBe(少读.次);
    // 改前（dc53fcb5）逐位查：15 位时待交接人数 15 次起（每位第一条 count 就中）、最多 75 次；读离职交接每位 8 次起
    const 旧数 = await 数查库(async () => 逐位数(await 离职的(), true));
    const 旧读 = await 数查库(async () => 逐位读(await 离职的(), true));
    expect(多数.次).toBeLessThan(旧数.次);
    expect(多读.次).toBeLessThan(旧读.次 / 4);
  });
});

describe("离职交接：和逐位查的结果逐条一致", () => {
  /** 各种情况各来一位：什么都没有的、只有一样的、客户在公海的、放走的（挂占位）、已删的、交接中的、互相挂着的 */
  async function 造各种() {
    const 甲 = await 建("a", "sales", { active: false, managerId: 上级.id });
    const 乙 = await 建("b", "sales", { active: false, managerId: 上级.id });
    await 摆(甲, 2, 乙);
    await 摆(乙, 1, 甲);
    // 甲的项目挂在乙的客户上、乙的待办挂在甲的客户上（两位都离职）
    const 乙客户 = await 客户(乙.id);
    await 项目(乙客户.id, 甲.id);
    const 甲客户 = await 客户(甲.id);
    await 待办(甲客户.id, 乙.id);
    // 甲还有一笔离职交接在等确认
    await raw.entHandover.create({ data: { kind: "离职", fromUserId: 甲.id, toUserId: 在职.id, byUserId: 老板.id } });
    // 乙有一笔已经撤回的、一笔转让待确认的：都不算交接中
    await raw.entHandover.create({ data: { kind: "离职", fromUserId: 乙.id, toUserId: 在职.id, byUserId: 老板.id, status: "已撤回" } });
    await raw.entHandover.create({ data: { kind: "转让", fromUserId: 乙.id, toUserId: 在职.id, byUserId: 老板.id } });

    const 空 = await 建("empty", "sales", { active: false });
    const 只线索 = await 建("lead-only", "sales", { active: false });
    await raw.lead.create({ data: { name: "孤线索", ownerId: 只线索.id } });
    const 只渠道 = await 建("channel-only", "sales", { active: false });
    await raw.channel.create({ data: { name: "孤渠道|其他", channelOwnerId: 只渠道.id } });
    const 只主渠道 = await 建("main-only", "channel_ops", { active: false });
    await raw.entChannelMain.create({ data: { name: "孤主渠道", ownerId: 只主渠道.id } });
    // 只有待办：看板上列，页头的数不算（原来就不数待办）
    const 只待办 = await 建("task-only", "sales", { active: false });
    await 待办((await 客户(在职.id)).id, 只待办.id);
    const 只项目 = await 建("proj-only", "sales", { active: false, managerId: 老板.id });
    await 项目((await 客户(在职.id)).id, 只项目.id);
    // 客户全在公海（负责人还是他的老数据）：不算他的
    const 全公海 = await 建("pooled", "sales", { active: false });
    await 进公海((await 客户(全公海.id)).id);
    // 放走的：客户挂占位、最近一次进公海前是他；上面他的项目、待办不单列（谁领谁带）
    const 放走的人 = await 建("released", "sales", { active: false });
    const 走 = await 客户(放走的人.id);
    await 项目(走.id, 放走的人.id);
    await 待办(走.id, 放走的人.id);
    await 放走(走.id, 放走的人.id);
    // 放走过、后来又被别人领走再放回：最近一次不是他，上面他的项目照样单列
    const 早放 = await 客户(放走的人.id);
    await 项目(早放.id, 放走的人.id);
    await raw.customerOwnerLog.create({ data: { customerId: 早放.id, fromOwnerId: 放走的人.id, toOwnerId: 占位, userId: 老板.id, kind: "pool-release", at: new Date(Date.now() - 60_000) } });
    await raw.customer.update({ where: { id: 早放.id }, data: { salesOwnerId: 占位 } });
    await raw.customerOwnerLog.create({ data: { customerId: 早放.id, fromOwnerId: 在职.id, toOwnerId: 占位, userId: 老板.id, kind: "pool-release" } });
    await 进公海(早放.id);
    // 进了回收站的客户、项目：不列
    const 删客户的 = await 建("deleted", "sales", { active: false });
    await raw.customer.update({ where: { id: (await 客户(删客户的.id)).id }, data: { deletedAt: new Date() } });
    const 留 = await 客户(删客户的.id);
    await raw.project.update({ where: { id: (await 项目(留.id, 删客户的.id)).id }, data: { deletedAt: new Date() } });
    await 项目(留.id, 删客户的.id);
    // 占位账号名下的不算离职成员
    await 客户(占位);
    return { 甲, 乙, 空, 只待办 };
  }

  for (const 带项目 of [true, false]) {
    it(`系统管理员看全部离职成员（项目模式${带项目 ? "开" : "关"}）`, async () => {
      mocks.项目模式 = 带项目;
      const d = await 造各种();
      const ids = await 离职的();
      const 新 = await 读离职交接(老板);
      const 旧 = await 逐位读(ids, 带项目);
      expect(新).toEqual(旧);
      expect(await 待交接人数(老板)).toBe(await 逐位数(ids, 带项目));
      // 不是两边都空着对上的
      expect(新.length).toBeGreaterThanOrEqual(带项目 ? 9 : 7);
      expect(新.find((x) => x.id === d.甲.id)!.交接中).toBe(true);
      expect(新.find((x) => x.id === d.乙.id)!.交接中).toBe(false);
      expect(新.some((x) => x.id === d.空.id)).toBe(false);
      expect(新.some((x) => x.id === d.只待办.id)).toBe(true);
      if (带项目) {
        expect(新.some((x) => x.客户.some((c) => c.项目数 > 2))).toBe(true);
        expect(新.some((x) => x.项目.length > 0)).toBe(true);
      }
    });
  }

  it("直属上级只看手填上级是自己的那几位", async () => {
    await 造各种();
    const ids = (await raw.entMember.findMany({ where: { managerId: 上级.id }, select: { userId: true } })).map((m) => m.userId);
    const 离职下属 = (await raw.user.findMany({ where: { id: { in: ids }, active: false }, select: { id: true } })).map((u) => u.id);
    mocks.user = { ...mocks.user, id: 上级.id, role: 上级.role, name: 上级.id };
    const 新 = await 读离职交接(上级);
    expect(新).toEqual(await 逐位读(离职下属, true));
    expect(新).toHaveLength(2);
    expect(await 待交接人数(上级)).toBe(await 逐位数(离职下属, true));
  });
});
