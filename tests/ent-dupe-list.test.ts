/**
 * 疑似重复清单（12-15 第三批 C，P-合并-06；lib/enterprise/dupe-groups.ts）：
 *   - 成组口径：名键（空白、全半角、大小写不算）、不足两个字不比、业务线都填了且不同不成对、两家都在公海的另成公海组（D，只系统管理员）、标了的对不列
 *   - 谁看哪些：负责人只看自己名下有份的组（销售管理不看下属的），系统管理员看全部
 *   - 标 / 撤「不是同一个人」：两家各一条操作日志；撤不删行、打上谁何时撤；再标清空；只读三类、只看某人、不是自己名下的拦
 *   - 客户详情那一行提示的数、「合并」默认留下 / 并进来哪家、同事那家标要申请
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 权限组织 } from "@/lib/enterprise/org";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import {
  成组, 对id, 疑似重复页, 本客户疑似重复数, 标不是同一个人, 撤销不是同一个人, 已标的对, 两家在我清单成对, 清单空页, 忘掉疑似重复缓存, 缓存计数, 增量最多, type 成员行,
} from "@/lib/enterprise/dupe-groups";

type 人 = { id: string; name: string; role: string };
let 总: 人, 经理: 人, 甲: 人, 乙: 人, 管理员: 人, 教练: 人;

async function 造人(email: string, name: string, role = "SALES"): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
let 序 = 0;
async function 客户(name: string, ownerId: string, 补: Record<string, unknown> = {}) {
  序++;
  return (await raw.customer.create({ data: { name, phone: "", salesOwnerId: ownerId, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 序)), ...补 } })).id;
}
async function 进公海(id: string) {
  await raw.customer.update({ where: { id }, data: { salesOwnerId: "" } }).catch(() => {});
  await raw.customerPool.create({ data: { customerId: id, userId: 总.id } });
}
const 页 = async (me: 人) => 疑似重复页(prisma, me, await 权限组织(), 1);
const 名们 = async (me: 人) => (await 页(me)).组们.map((g) => g.们.map((m) => m.id).sort());

beforeEach(async () => {
  await resetDb();
  忘掉疑似重复缓存();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总 = await 造人("boss", "总", "ADMIN");
  经理 = await 造人("mgr", "经理");
  甲 = await 造人("jia", "甲");
  乙 = await 造人("yi", "乙");
  管理员 = await 造人("ro", "只读管理员");
  教练 = await 造人("coach", "教练");
  await raw.entMember.createMany({ data: [
    { userId: 总.id, bizRole: "director" }, { userId: 经理.id, bizRole: "sales_mgr" },
    { userId: 甲.id, bizRole: "sales", managerId: 经理.id }, { userId: 乙.id, bizRole: "sales", managerId: 经理.id },
    { userId: 管理员.id, bizRole: "admin" }, { userId: 教练.id, bizRole: "coach" },
  ] });
  await setSetting("business", { projectMode: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("成组口径（纯函数）", () => {
  const 行 = (id: string, name: string, 补: Partial<成员行> = {}): 成员行 => ({ id, name, bizLine: null, salesOwnerId: "u1", 在公海: false, 建档: Number(id.replace(/\D/g, "")) || 0, ...补 });
  const 看 = { 管: true, 我: "u1" };

  it("空白、全半角、大小写不算；不足两个字的不比", () => {
    const g = 成组([行("c1", "Acme 贸易"), 行("c2", "ａｃｍｅ贸易"), 行("c3", " ACME　贸易 "), 行("c4", "A"), 行("c5", "a")], new Set(), 看);
    expect(g).toHaveLength(1);
    expect(g[0].们.map((r) => r.id)).toEqual(["c1", "c2", "c3"]);
    expect(g[0].对们).toHaveLength(3);
  });

  it("业务线都填了且不同不成对；一家没填照样成对", () => {
    expect(成组([行("c1", "星河展具", { bizLine: "内贸" }), 行("c2", "星河展具", { bizLine: "外贸" })], new Set(), 看)).toHaveLength(0);
    expect(成组([行("c1", "星河展具", { bizLine: "内贸" }), 行("c2", "星河展具")], new Set(), 看)).toHaveLength(1);
  });

  it("两家都在公海的不进普通组（系统管理员另成公海组，见 ent-dupe-pool.test.ts）；一家在公海照样成对", () => {
    expect(成组([行("c1", "星河展具", { 在公海: true }), 行("c2", "星河展具", { 在公海: true })], new Set(), 看).filter((g) => !g.公海组)).toHaveLength(0);
    expect(成组([行("c1", "星河展具", { 在公海: true }), 行("c2", "星河展具")], new Set(), 看)).toHaveLength(1);
  });

  it("标了的对不列；三家里只标了一对，剩下的两对照列", () => {
    const 们 = [行("c1", "星河展具"), 行("c2", "星河展具"), 行("c3", "星河展具")];
    expect(成组(们.slice(0, 2), new Set([对id("c2", "c1")]), 看)).toHaveLength(0);
    const g = 成组(们, new Set([对id("c1", "c2")]), 看);
    expect(g[0].对们.sort()).toEqual([对id("c1", "c3"), 对id("c2", "c3")].sort());
    expect(g[0].们).toHaveLength(3);
  });

  it("不是系统管理员只算有一家是我负责、不在公海的那几对", () => {
    const 们 = [行("c1", "星河展具", { salesOwnerId: "u2" }), 行("c2", "星河展具", { salesOwnerId: "u3" })];
    expect(成组(们, new Set(), { 管: false, 我: "u1" })).toHaveLength(0);
    expect(成组([...们, 行("c3", "星河展具", { salesOwnerId: "u1" })], new Set(), { 管: false, 我: "u1" })[0].对们).toHaveLength(2);
    expect(成组([行("c1", "星河展具", { salesOwnerId: "u1", 在公海: true }), 们[0]], new Set(), { 管: false, 我: "u1" })).toHaveLength(0);
  });
});

describe("谁看哪些组", () => {
  it("负责人只看自己名下有份的组；销售管理不看下属的；系统管理员看全部", async () => {
    const a1 = await 客户("星河展具有限公司", 甲.id);
    const a2 = await 客户("星河展具有限公司", 乙.id);
    const b1 = await 客户("远山贸易", 乙.id);
    const b2 = await 客户("远山 贸易", 乙.id);
    await 客户("独一家", 甲.id);
    expect(await 名们(甲)).toEqual([[a1, a2].sort()]);
    expect((await 名们(乙)).length).toBe(2);
    expect(await 名们(经理)).toEqual([]);
    expect((await 名们(总)).map((x) => x.join()).sort()).toEqual([[a1, a2].sort().join(), [b1, b2].sort().join()].sort());
  });

  it("组里列负责人、建档、项目数；「合并」默认留下我负责、项目多的，同事那家标要申请", async () => {
    const a1 = await 客户("星河展具", 乙.id);
    const a2 = await 客户("星河展具", 甲.id);
    await raw.project.create({ data: { name: "P1", customerId: a2, ownerId: 甲.id, creatorId: 甲.id } });
    const g = (await 页(甲)).组们[0];
    expect(g.留下).toBe(a2);
    expect(g.并掉).toBe(a1);
    const 同事那家 = g.们.find((m) => m.id === a1)!;
    expect(同事那家).toMatchObject({ 负责人: "乙", 我的: false, 要申请: true, 项目数: 0 });
    expect(g.们.find((m) => m.id === a2)).toMatchObject({ 我的: true, 要申请: false, 项目数: 1 });
    expect((await 页(总)).组们[0].们.every((m) => !m.要申请)).toBe(true);
  });

  it("「合并」并进来那家只在和留下成对的里挑：不成对的那家项目再多也不挑（C 审查建议 7）", async () => {
    const m = await 客户("星河展具", 甲.id, { bizLine: "内贸" });
    const y = await 客户("星河展具", 乙.id, { bizLine: "外贸" });
    const z = await 客户("星河展具", 乙.id);
    for (const [i, c] of [[1, m], [2, m], [3, y]] as const) await raw.project.create({ data: { name: `P${i}`, customerId: c, ownerId: 乙.id, creatorId: 乙.id } });
    const g = (await 页(总)).组们[0];
    expect(g.们.length).toBe(3);
    expect(g.留下).toBe(m);
    expect(g.对们.sort()).toEqual([对id(m, z), 对id(y, z)].sort());
    // y 项目比 z 多，但和 m 业务线冲突、不成对：并进来的是 z
    expect(g.并掉).toBe(z);
  });

  it("含公海那家（一家在公海、一家有负责人）：列给负责人，公海那家负责人写空", async () => {
    const a1 = await 客户("星河展具", 甲.id);
    const a2 = await 客户("星河展具", 乙.id);
    await 进公海(a2);
    const g = (await 页(甲)).组们[0];
    expect(g.们.map((m) => m.id).sort()).toEqual([a1, a2].sort());
    expect(g.们.find((m) => m.id === a2)).toMatchObject({ 在公海: true, 负责人: null });
    expect(g.留下).toBe(a1);
  });

  it("删了的（回收站）不列；客户详情那一行提示的数", async () => {
    const a1 = await 客户("星河展具", 甲.id);
    const a2 = await 客户("星河展具", 甲.id);
    const a3 = await 客户("星河展具", 乙.id, { deletedAt: new Date() });
    const org = await 权限组织();
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(1);
    expect(await 本客户疑似重复数(prisma, 乙, org, a1)).toBe(0);
    expect(await 本客户疑似重复数(prisma, 甲, org, a3)).toBe(0);
    await 标不是同一个人(prisma, 甲, org, [a1, a2]);
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(0);
  });
});

describe("标 / 撤「不是同一个人」", () => {
  it("标了不再列，两家各一条日志；撤了重新列、行留着打上谁何时撤；再标清空", async () => {
    const a1 = await 客户("星河展具", 甲.id);
    const a2 = await 客户("星河展具", 乙.id);
    const org = await 权限组织();
    const r = await 标不是同一个人(prisma, 甲, org, [a1, a2]);
    expect(r).toEqual({ ok: true, 对们: [对id(a1, a2)] });
    expect(await 名们(甲)).toEqual([]);
    expect(await 名们(总)).toEqual([]);
    const 日志 = await raw.auditLog.findMany({ where: { action: "not-dupe" }, select: { entityId: true, userId: true } });
    expect(日志.map((x) => x.entityId).sort()).toEqual([a1, a2].sort());
    expect(日志.every((x) => x.userId === 甲.id)).toBe(true);
    expect((await 已标的对(prisma, 甲, org)).map((p) => p.id)).toEqual([对id(a1, a2)]);
    expect(await 已标的对(prisma, 经理, org)).toEqual([]);
    // 已标一对里自己负责的那家带「我的」（页签里才点得进）
    expect((await 已标的对(prisma, 甲, org))[0].两家.map((m) => [m.id, m.我的]).sort()).toEqual([[a1, true], [a2, false]].sort());

    expect(await 撤销不是同一个人(prisma, 乙, org, [对id(a1, a2)])).toEqual({ ok: true, 撤了: 1 });
    const 行 = await raw.customerNotDupe.findUnique({ where: { id: 对id(a1, a2) } });
    expect(行).toMatchObject({ userId: 甲.id, undoneById: 乙.id });
    expect(行!.undoneAt).toBeInstanceOf(Date);
    expect(await raw.auditLog.count({ where: { action: "not-dupe-undo" } })).toBe(2);
    expect((await 名们(甲)).length).toBe(1);
    expect(await 撤销不是同一个人(prisma, 甲, org, [对id(a1, a2)])).toMatchObject({ ok: false });

    await 标不是同一个人(prisma, 乙, org, [a1, a2]);
    expect(await raw.customerNotDupe.findUnique({ where: { id: 对id(a1, a2) } })).toMatchObject({ userId: 乙.id, undoneAt: null, undoneById: null });
  });

  it("只读管理员、销售教练、只看某人：只看不改；不是自己名下的组标不了、撤不了", async () => {
    const a1 = await 客户("星河展具", 甲.id);
    const a2 = await 客户("星河展具", 乙.id);
    await setSetting(只看某人键, { [经理.id]: 甲.id });
    invalidateSettingsCache();
    忘掉企业版范围();
    const org = await 权限组织();
    for (const me of [管理员, 教练, 经理]) {
      expect(await 标不是同一个人(prisma, me, org, [a1, a2])).toMatchObject({ ok: false });
    }
    const 丁 = await 造人("ding", "丁");
    await raw.entMember.create({ data: { userId: 丁.id, bizRole: "sales" } });
    忘掉企业版范围();
    const org2 = await 权限组织();
    expect(await 标不是同一个人(prisma, 丁, org2, [a1, a2])).toMatchObject({ ok: false });
    expect(await 标不是同一个人(prisma, 总, org2, [a1, a2])).toMatchObject({ ok: true });
    expect(await 撤销不是同一个人(prisma, 丁, org2, [对id(a1, a2)])).toMatchObject({ ok: false });
    for (const me of [管理员, 教练]) expect(await 撤销不是同一个人(prisma, me, org2, [对id(a1, a2)])).toMatchObject({ ok: false });
    expect(await raw.customerNotDupe.count({ where: { undoneAt: null } })).toBe(1);
  });

  it("同名超过 30 家：服务端不标、回「太多请逐家处理」；清单上这组带「太多」", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 31; i++) ids.push(await 客户("星河展具", 甲.id));
    const org = await 权限组织();
    const r = await 标不是同一个人(prisma, 甲, org, ids);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("太多请逐家处理");
    expect(await raw.customerNotDupe.count()).toBe(0);
    expect((await 页(甲)).组们[0]).toMatchObject({ 太多: true });
    expect((await 标不是同一个人(prisma, 甲, org, ids.slice(0, 30))).ok).toBe(true);
  });

  it("撤销只撤还标着的：updateMany 带 undoneAt: null，别人刚撤过的 0 行、不再记日志、不改撤的人（C 审查建议 8）", async () => {
    const a1 = await 客户("星河展具", 甲.id);
    const a2 = await 客户("星河展具", 乙.id);
    const org = await 权限组织();
    await 标不是同一个人(prisma, 甲, org, [a1, a2]);
    expect(await 撤销不是同一个人(prisma, 乙, org, [对id(a1, a2)])).toMatchObject({ ok: true, 撤了: 1 });
    // 模拟先读后写的间隙：读到的还是「标着」的旧行（代理把 findMany 换成旧结果），写这一步仍按 undoneAt: null 过滤
    const 旧 = [{ id: 对id(a1, a2), customerId: [a1, a2].sort()[0], otherId: [a1, a2].sort()[1] }];
    const 代理 = new Proxy(prisma, { get: (t, k, r) => k === "customerNotDupe"
      ? new Proxy(t.customerNotDupe, { get: (n, kk) => kk === "findMany" ? async () => 旧 : (n as never)[kk] })
      : Reflect.get(t, k, r) }) as typeof prisma;
    expect(await 撤销不是同一个人(代理, 甲, org, [对id(a1, a2)])).toMatchObject({ ok: false });
    expect(await raw.auditLog.count({ where: { action: "not-dupe-undo" } })).toBe(2);
    expect(await raw.customerNotDupe.findUnique({ where: { id: 对id(a1, a2) } })).toMatchObject({ undoneById: 乙.id });
  });

  it("标记在事务里重判成组：两人同时标同一组，只有一份标记和日志", async () => {
    const a1 = await 客户("星河展具", 甲.id);
    const a2 = await 客户("星河展具", 甲.id);
    const org = await 权限组织();
    const 结 = await Promise.all([标不是同一个人(prisma, 甲, org, [a1, a2]), 标不是同一个人(prisma, 总, org, [a1, a2])]);
    expect(结.filter((x) => x.ok).length).toBeGreaterThanOrEqual(1);
    expect(await raw.customerNotDupe.count({ where: { undoneAt: null } })).toBe(1);
    const 日志 = await raw.auditLog.count({ where: { action: "not-dupe" } });
    expect(日志).toBe(结.filter((x) => x.ok).length * 2);
    expect(await 名们(甲)).toEqual([]);
  });

  it("名字已经不一样了、有一家不在了：拦", async () => {
    const a1 = await 客户("星河展具", 甲.id);
    const a2 = await 客户("星河展具", 甲.id);
    const org = await 权限组织();
    await raw.customer.update({ where: { id: a2 }, data: { name: "别的名字" } });
    expect(await 标不是同一个人(prisma, 甲, org, [a1, a2])).toMatchObject({ ok: false });
    await raw.customer.update({ where: { id: a2 }, data: { name: "星河展具", deletedAt: new Date() } });
    expect(await 标不是同一个人(prisma, 甲, org, [a1, a2])).toMatchObject({ ok: false });
  });
});

describe("名键底数据缓存（C 审查建议 2、3、9）", () => {
  const 隔一毫秒 = () => new Promise((r) => setTimeout(r, 3));

  it("清单页、详情提示、两家成对共用一份：指纹没变就不重读（库里悄悄改名不动 updatedAt，缓存里还是老名）", async () => {
    const a1 = await 客户("缓存星河", 甲.id);
    const a2 = await 客户("缓存星河", 甲.id);
    const org = await 权限组织();
    expect((await 疑似重复页(prisma, 甲, org, 1)).组们).toHaveLength(1);
    await raw.$executeRawUnsafe(`UPDATE "Customer" SET "name" = '悄悄改了' WHERE id = ?`, a2);
    expect((await 疑似重复页(prisma, 甲, org, 1)).组们).toHaveLength(1);
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(1);
    expect(await 两家在我清单成对(prisma, 甲, org, a1, a2)).toBe(true);
    忘掉疑似重复缓存();
    expect((await 疑似重复页(prisma, 甲, org, 1)).组们).toHaveLength(0);
  });

  it("改名、新增、删除、进公海后缓存失效，结果更新", async () => {
    const a1 = await 客户("失效星河", 甲.id);
    const a2 = await 客户("别的名字", 甲.id);
    const org = await 权限组织();
    expect(await 名们(甲)).toEqual([]);
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(0);
    // 改名：别的名字 → 同名
    await 隔一毫秒();
    await raw.customer.update({ where: { id: a2 }, data: { name: "失效星河" } });
    expect(await 名们(甲)).toEqual([[a1, a2].sort()]);
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(1);
    expect(await 两家在我清单成对(prisma, 甲, org, a1, a2)).toBe(true);
    // 新增第三家（条数变）
    const a3 = await 客户("失效星河", 甲.id);
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(2);
    expect((await 名们(甲))[0]).toEqual([a1, a2, a3].sort());
    // 删了一家（软删）
    await 隔一毫秒();
    await raw.customer.update({ where: { id: a3 }, data: { deletedAt: new Date() } });
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(1);
    // 两家都进公海：这对不再列给负责人（管理员的公海组见 ent-dupe-pool.test.ts）
    await 进公海(a1);
    await 进公海(a2);
    expect(await 名们(甲)).toEqual([]);
    expect(await 两家在我清单成对(prisma, 甲, org, a1, a2)).toBe(false);
  });

  it("换负责人后放行判定跟着变；标着的对不进缓存、标完马上不列", async () => {
    const a1 = await 客户("换人星河", 甲.id);
    const a2 = await 客户("换人星河", 乙.id);
    const org = await 权限组织();
    expect(await 两家在我清单成对(prisma, 甲, org, a1, a2)).toBe(true);
    await 隔一毫秒();
    await raw.customer.update({ where: { id: a1 }, data: { salesOwnerId: 乙.id } });
    expect(await 两家在我清单成对(prisma, 甲, org, a1, a2)).toBe(false);
    await 隔一毫秒();
    await raw.customer.update({ where: { id: a1 }, data: { salesOwnerId: 甲.id } });
    expect(await 两家在我清单成对(prisma, 甲, org, a1, a2)).toBe(true);
    await 标不是同一个人(prisma, 甲, org, [a1, a2]);
    expect(await 名们(甲)).toEqual([]);
  });

  it("增量补（C3 必改 A）：记跟进这类只动 updatedAt 的写不整表重装；改名 / 软删 / 新增 / 进公海经增量后结果对", async () => {
    const a1 = await 客户("增量星河", 甲.id);
    const a2 = await 客户("增量别名", 甲.id);
    const 路人 = await 客户("路人客户", 乙.id);
    const org = await 权限组织();
    expect(await 名们(甲)).toEqual([]);
    const 整表0 = 缓存计数.整表, 增量0 = 缓存计数.增量;
    // 路人被记了跟进：只动 updatedAt
    await 隔一毫秒();
    await raw.customer.update({ where: { id: 路人 }, data: { remark: "记了一条跟进" } });
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(0);
    expect(缓存计数.整表).toBe(整表0);
    expect(缓存计数.增量).toBe(增量0 + 1);
    // 改名成同名
    await 隔一毫秒();
    await raw.customer.update({ where: { id: a2 }, data: { name: "增量星河" } });
    expect(await 名们(甲)).toEqual([[a1, a2].sort()]);
    // 新增第三家
    const a3 = await 客户("增量星河", 甲.id);
    expect(await 本客户疑似重复数(prisma, 甲, org, a1)).toBe(2);
    // 软删一家
    await 隔一毫秒();
    await raw.customer.update({ where: { id: a3 }, data: { deletedAt: new Date() } });
    expect(await 名们(甲)).toEqual([[a1, a2].sort()]);
    // 改成一个字（不够长）：移出
    await 隔一毫秒();
    await raw.customer.update({ where: { id: a2 }, data: { name: "星" } });
    expect(await 名们(甲)).toEqual([]);
    // 进公海只重读公海表
    await raw.customer.update({ where: { id: a2 }, data: { name: "增量星河" } });
    expect(await 名们(甲)).toEqual([[a1, a2].sort()]);
    await 进公海(a2);
    expect(await 两家在我清单成对(prisma, 甲, org, a1, a2)).toBe(true);
    await 进公海(a1);
    expect(await 名们(甲)).toEqual([]);
    expect(缓存计数.整表).toBe(整表0);
  });

  it("增量取到的行超过上限才整表重装", async () => {
    const a1 = await 客户("上限星河", 甲.id);
    await 客户("上限星河", 甲.id);
    await 名们(甲);
    const 整表0 = 缓存计数.整表;
    await raw.customer.createMany({ data: Array.from({ length: 增量最多 + 1 }, (_, i) => ({ name: `批量${i}号客户`, phone: "", salesOwnerId: 乙.id })) });
    expect(await 名们(甲)).toHaveLength(1);
    expect(缓存计数.整表).toBe(整表0 + 1);
    expect(await 本客户疑似重复数(prisma, 甲, await 权限组织(), a1)).toBe(1);
  });

  it("缓存按 db 实例分开：换一个 db 对象不共用", async () => {
    await 客户("分库星河", 甲.id);
    await 客户("分库星河", 甲.id);
    const org = await 权限组织();
    await 疑似重复页(prisma, 甲, org, 1);
    const 整表0 = 缓存计数.整表;
    await 疑似重复页(prisma, 甲, org, 1);
    expect(缓存计数.整表).toBe(整表0);
    await 疑似重复页(Object.create(prisma), 甲, org, 1);
    expect(缓存计数.整表).toBe(整表0 + 1);
  });

  it("一个名键 200 家：清单回「太多」不报错、不两两比（C3 建议 C）；不相干的负责人看不到", async () => {
    await raw.customer.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ name: "太多星河", phone: "", salesOwnerId: i === 0 ? 甲.id : 乙.id, createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, i)) })) });
    const r = await 页(甲);
    expect(r.组们).toHaveLength(1);
    expect(r.组们[0]).toMatchObject({ 太多: true, 对们: [] });
    expect(r.组们[0]).toMatchObject({ 组名: "太多星河", 家数: 200, 们: [], 留下: "", 并掉: "" });
    expect((await 页(总)).组们[0]).toMatchObject({ 太多: true, 家数: 200 });
    const 丙 = await 造人("bing", "丙");
    expect((await 页(丙)).组们).toHaveLength(0);
  });

  it("C5：我名下 1 家外贸 + 别人 35 家内贸同名：粗筛后只剩我一家，清单为空、详情提示 0、看不到同事的资料", async () => {
    const 我家 = await 客户("粗筛星河", 甲.id, { bizLine: "外贸" });
    await raw.customer.createMany({ data: Array.from({ length: 35 }, (_, i) => ({ name: "粗筛星河", phone: "", bizLine: "内贸", salesOwnerId: 乙.id, createdAt: new Date(Date.UTC(2026, 0, 3, 0, i)) })) });
    expect((await 页(甲)).组们).toHaveLength(0);
    expect(await 本客户疑似重复数(prisma, 甲, await 权限组织(), 我家)).toBe(0);
    expect((await 页(总)).组们[0]).toMatchObject({ 太多: true, 家数: 36 });
  });

  it("C5：同名原始 35 家、对我能成对的只有 5 家：给普通组，可合并可标；业务线冲突的那 29 家不露面", async () => {
    const 我家 = await 客户("粗筛北辰", 甲.id, { bizLine: "内贸" });
    const 能 = [];
    for (let i = 0; i < 5; i++) 能.push(await 客户("粗筛北辰", 乙.id, { bizLine: "内贸" }));
    await raw.customer.createMany({ data: Array.from({ length: 29 }, (_, i) => ({ name: "粗筛北辰", phone: "", bizLine: "外贸", salesOwnerId: 乙.id, createdAt: new Date(Date.UTC(2026, 0, 3, 0, i)) })) });
    const r = await 页(甲);
    expect(r.组们).toHaveLength(1);
    expect(r.组们[0].太多).toBe(false);
    expect(r.组们[0].们.map((m) => m.id).sort()).toEqual([我家, ...能].sort());
    expect(r.组们[0].对们).toHaveLength(5);
    expect(await 本客户疑似重复数(prisma, 甲, await 权限组织(), 我家)).toBe(5);
    expect(await 标不是同一个人(prisma, 甲, await 权限组织(), r.组们[0].们.map((m) => m.id))).toMatchObject({ ok: true });
    expect((await 页(甲)).组们).toHaveLength(0);
  });

  it("C5：「太多」组页面数据里只有组名和家数，没有成员编号、负责人、项目数、建档", async () => {
    await raw.customer.createMany({ data: Array.from({ length: 40 }, (_, i) => ({ name: "粗筛银河", phone: "", salesOwnerId: i < 2 ? 甲.id : 乙.id, createdAt: new Date(Date.UTC(2026, 0, 2, 0, i)) })) });
    const g = (await 页(甲)).组们[0];
    expect(g).toMatchObject({ 太多: true, 组名: "粗筛银河", 家数: 40, 们: [], 留下: "", 并掉: "", 对们: [] });
    expect(Object.keys(g).sort()).toEqual(["家数", "们", "对们", "并掉", "留下", "组名", "键", "太多", "公海组", "先领", "能并"].sort());
    expect(JSON.stringify(g)).not.toMatch(/customerNo|NO\.|项目数|建档|负责人/);
  });

  it("按 id 取的几家（标、放行）不带 NOT INDEXED，只有整表读带；「已标」页签不成组", async () => {
    const { readFileSync } = await import("node:fs");
    const 源 = readFileSync("src/lib/enterprise/dupe-groups.ts", "utf8");
    const 选列 = 源.match(/const 选列SQL = `([^`]*)`/)![1];
    expect(选列).not.toMatch(/NOT INDEXED/);
    expect(源.match(/const 整表SQL = `([^`]*)`/)![1]).toMatch(/NOT INDEXED/);
    const org = await 权限组织();
    expect(清单空页(甲, org)).toMatchObject({ 组们: [], 共: 0, 管: false });
    expect(清单空页(总, org).管).toBe(true);
  });
});
