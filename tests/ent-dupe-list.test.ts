/**
 * 疑似重复清单（12-15 第三批 C，P-合并-06；lib/enterprise/dupe-groups.ts）：
 *   - 成组口径：名键（空白、全半角、大小写不算）、不足两个字不比、业务线都填了且不同不成对、两家都在公海不算（D 再列）、标了的对不列
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
  成组, 对id, 疑似重复页, 本客户疑似重复数, 标不是同一个人, 撤销不是同一个人, 已标的对, type 成员行,
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

  it("两家都在公海的不算（公海组下一单 D）；一家在公海照样成对", () => {
    expect(成组([行("c1", "星河展具", { 在公海: true }), 行("c2", "星河展具", { 在公海: true })], new Set(), 看)).toHaveLength(0);
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
