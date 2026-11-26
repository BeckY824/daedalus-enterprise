/**
 * 疑似重复清单 · 公海同名（12-15 第三批 D，P-合并-07；lib/enterprise/dupe-groups.ts、customers/dupe-actions.ts）：
 *   - 两家都在公海：只有系统管理员看得到（单独一栏「公海组」），其他角色看不到；管理员并后仍留公海、负责人空，自动掉公海 / 定时分配扫描后不变，留痕齐
 *   - 一家在公海、一家有负责人：列给有负责人那家的负责人，带「先领」名单、默认那一对不给直接并；服务端核对回「先领出来再并」，管理员也一样
 *   - 非系统管理员对公海组调「核对清单合并」被拒；公海对也在合并框那层（customer-merge）拒
 * 测试数据全是编的
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 权限组织 } from "@/lib/enterprise/org";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 成组, 疑似重复页, 忘掉疑似重复缓存, type 成员行 } from "@/lib/enterprise/dupe-groups";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 自动掉公海 } from "@/lib/pool-db";
import { 定时分配扫一遍 } from "@/lib/enterprise/scheduled-assign";
import { 疑似重复清单, 核对清单合并 } from "@/app/(app)/customers/dupe-actions";
import { 合并客户 } from "@/app/(app)/customers/merge-actions";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总: 人, 经理: 人, 甲: 人, 乙: 人;
let 序 = 0;

async function 造人(key: string, name: string, bizRole: string, role = "SALES"): Promise<人> {
  const email = `${key}@x`;
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  await raw.entMember.create({ data: { userId: u.id, bizRole, line: bizRole === "director" ? null : "内贸" } });
  return { id: u.id, name, email, role, title: "", avatar: null };
}
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { ...u };
  忘掉企业版范围();
  return 以谁的身份(u.id, fn);
};
async function 客户(name: string, ownerId: string) {
  序++;
  return (await raw.customer.create({ data: { name, phone: "", salesOwnerId: ownerId, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 序)) } })).id;
}
async function 进公海(id: string) {
  await raw.customer.update({ where: { id }, data: { salesOwnerId: await 无负责人占位Id(raw) } });
  await raw.customerPool.create({ data: { customerId: id, userId: 总.id } });
}
const 页 = async (me: 人, 栏: "普通" | "公海" = "普通") => 疑似重复页(prisma, me, await 权限组织(), 1, 栏);

beforeEach(async () => {
  await resetDb();
  忘掉疑似重复缓存();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总 = await 造人("boss", "总", "director", "ADMIN");
  经理 = await 造人("mgr", "经理", "sales_mgr");
  甲 = await 造人("jia", "甲", "sales");
  乙 = await 造人("yi", "乙", "sales");
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("成组：公海组（纯函数）", () => {
  const 行 = (id: string, name: string, 补: Partial<成员行> = {}): 成员行 => ({ id, name, bizLine: null, salesOwnerId: "u1", 在公海: false, 建档: Number(id.replace(/\D/g, "")) || 0, ...补 });
  const 池 = { 在公海: true, salesOwnerId: null };

  it("系统管理员：两家都在公海成一个公海组；别的角色看不到", () => {
    const 们 = [行("c1", "星河展具", 池), 行("c2", "星河展具", 池)];
    const g = 成组(们, new Set(), { 管: true, 我: "u9" });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ 公海组: true });
    expect(g[0].对们).toHaveLength(1);
    expect(成组(们, new Set(), { 管: false, 我: "u1" })).toHaveLength(0);
  });
  it("两家公海 + 一家有主：管理员两栏各一组（普通组里公海那家配有主那家），负责人只看到普通组", () => {
    const 们 = [行("c1", "星河展具", 池), 行("c2", "星河展具", 池), 行("c3", "星河展具")];
    const 管 = 成组(们, new Set(), { 管: true, 我: "u9" });
    expect(管.filter((g) => g.公海组)).toHaveLength(1);
    expect(管.filter((g) => !g.公海组)).toHaveLength(1);
    expect(管.find((g) => g.公海组)!.们.map((r) => r.id)).toEqual(["c1", "c2"]);
    const 我 = 成组(们, new Set(), { 管: false, 我: "u1" });
    expect(我.every((g) => !g.公海组)).toBe(true);
    expect(我).toHaveLength(1);
  });
  it("标了不是同一个人的公海对不列", () => {
    const 们 = [行("c1", "星河展具", 池), 行("c2", "星河展具", 池)];
    expect(成组(们, new Set(["c1__c2"]), { 管: true, 我: "u9" })).toHaveLength(0);
  });
});

describe("清单取数：公海组只对系统管理员", () => {
  it("管理员的「公海」栏列出两家都在公海的同名组，普通栏没有；其他角色两栏都没有、公海共 0", async () => {
    const a = await 客户("星河展具", 甲.id), b = await 客户("星河展具", 乙.id);
    await 进公海(a); await 进公海(b);
    const 公 = await 以(总, () => 页(总, "公海"));
    expect(公.共).toBe(1);
    expect(公.公海共).toBe(1);
    expect(公.组们[0]).toMatchObject({ 公海组: true, 能并: true, 先领: [] });
    expect(公.组们[0].们.map((m) => m.id).sort()).toEqual([a, b].sort());
    expect((await 以(总, () => 页(总, "普通"))).共).toBe(0);
    for (const u of [甲, 乙, 经理]) {
      for (const 栏 of ["普通", "公海"] as const) {
        const r = await 以(u, () => 页(u, 栏));
        expect(r.共).toBe(0);
        expect(r.公海共).toBe(0);
      }
    }
  });

  it("一家公海一家有主：列给有主那家的负责人，先领 = 公海那家，默认一对不给直接并；管理员看到同样的提示", async () => {
    const a = await 客户("星河展具", 甲.id), b = await 客户("星河展具", 乙.id);
    await 进公海(b);
    const g = (await 以(甲, () => 页(甲))).组们[0];
    expect(g).toMatchObject({ 公海组: false, 先领: [b], 能并: false, 留下: a, 并掉: b });
    // 乙已经不是负责人（公海里的是他原来的那家），他看不到
    expect((await 以(乙, () => 页(乙))).共).toBe(0);
    const 管 = (await 以(总, () => 页(总))).组们[0];
    expect(管).toMatchObject({ 先领: [b], 能并: false });
    expect((await 以(总, () => 页(总, "公海"))).共).toBe(0);
  });

  it("三家：两家有主 + 一家公海，默认并的是两家有主的（能并），公海那家仍列在先领里", async () => {
    const a = await 客户("星河展具", 甲.id), b = await 客户("星河展具", 甲.id), c = await 客户("星河展具", 乙.id);
    await 进公海(c);
    const g = (await 以(甲, () => 页(甲))).组们[0];
    expect([g.留下, g.并掉].sort()).toEqual([a, b].sort());
    expect(g).toMatchObject({ 能并: true, 先领: [c] });
  });

  it("动作层：普通栏 / 公海栏参数乱传被拒", async () => {
    expect((await 以(总, () => 疑似重复清单(1, "公海"))).ok).toBe(true);
    expect(await 以(总, () => 疑似重复清单(1, "乱写" as never))).toMatchObject({ ok: false });
  });
});

describe("清单上点合并：服务端再核（核对清单合并）", () => {
  it("非系统管理员对公海对调用被拒；管理员放行", async () => {
    const a = await 客户("星河展具", 甲.id), b = await 客户("星河展具", 乙.id);
    await 进公海(a); await 进公海(b);
    for (const u of [甲, 乙, 经理]) {
      expect(await 以(u, () => 核对清单合并(a, b))).toEqual({ ok: false, error: "两家都在公海里，只有系统管理员能合并" });
    }
    expect(await 以(总, () => 核对清单合并(a, b))).toEqual({ ok: true });
  });
  it("公海对标过不是同一个人 / 改了名之后，管理员也被拒（不在清单上了）", async () => {
    const a = await 客户("星河展具", 甲.id), b = await 客户("星河展具", 乙.id);
    await 进公海(a); await 进公海(b);
    await raw.customer.update({ where: { id: b }, data: { name: "别的名字" } });
    expect(await 以(总, () => 核对清单合并(a, b))).toMatchObject({ ok: false });
  });
  it("一家公海一家有主：负责人和管理员都回「先领出来再并」，合并框那层也拦", async () => {
    const a = await 客户("星河展具", 甲.id), b = await 客户("星河展具", 乙.id);
    await 进公海(b);
    for (const u of [甲, 总]) {
      const r = await 以(u, () => 核对清单合并(a, b));
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toContain("先领出来再并");
    }
    const 并 = await 以(总, () => 合并客户(a, b, { 已核对: true }));
    expect(并.ok).toBe(false);
    expect((并 as { error: string }).error).toContain("先领出来再并");
    expect(await raw.customer.findUniqueOrThrow({ where: { id: b } }).then((c) => c.deletedAt)).toBeNull();
  });
  it("参数不对 / 自己并自己被拒", async () => {
    const a = await 客户("星河展具", 甲.id);
    expect(await 以(总, () => 核对清单合并(a, a))).toMatchObject({ ok: false });
    expect(await 以(总, () => 核对清单合并("", a))).toMatchObject({ ok: false });
  });
});

describe("两家都在公海，管理员并", () => {
  it("并后留下那家仍在公海、负责人空；并掉那家软删；跑自动掉公海 + 定时分配扫描后无变化；留痕齐；非管理员调合并被拒", async () => {
    const a = await 客户("星河展具", 甲.id), b = await 客户("星河展具", 乙.id);
    await 进公海(a); await 进公海(b);
    // 非管理员直接调合并：服务端拦
    const 被拒 = await 以(甲, () => 合并客户(a, b, { 已核对: true }));
    expect(被拒).toMatchObject({ ok: false });
    expect((被拒 as { error: string }).error).toContain("只有系统管理员能合并");
    expect(await raw.entCustomerMerge.count()).toBe(0);

    const r = await 以(总, () => 合并客户(a, b, { 已核对: true }));
    expect(r.ok).toBe(true);
    const A = await raw.customer.findUniqueOrThrow({ where: { id: a }, include: { pool: true } });
    expect(A.pool).not.toBeNull();
    expect(A.salesOwnerId).toBe(await 无负责人占位Id(raw));
    const B = await raw.customer.findUniqueOrThrow({ where: { id: b }, include: { pool: true } });
    expect(B.deletedAt).not.toBeNull();

    // 不自动掉公海 / 不被定时分配挑走
    const 前 = JSON.stringify(await raw.customer.findUniqueOrThrow({ where: { id: a } }));
    const 池前 = JSON.stringify(await raw.customerPool.findMany({ orderBy: { customerId: "asc" } }));
    await 以(总, () => 自动掉公海({ id: 总.id, name: 总.name }, new Date(Date.now() + 400 * 86400_000)));
    await 以(总, () => 定时分配扫一遍(new Date(Date.now() + 400 * 86400_000)));
    expect(JSON.stringify(await raw.customer.findUniqueOrThrow({ where: { id: a } }))).toBe(前);
    expect(JSON.stringify(await raw.customerPool.findMany({ orderBy: { customerId: "asc" } }))).toBe(池前);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: a }, include: { pool: true } })).pool).not.toBeNull();

    // 留痕：合并单（客户单）+ 操作日志（两家各一条 merge）
    const 单 = await raw.entCustomerMerge.findMany();
    expect(单).toHaveLength(1);
    expect(单[0]).toMatchObject({ fromId: b, intoId: a, status: "已合并", byUserId: 总.id });
    const 日志 = await raw.auditLog.findMany({ where: { action: "merge", entity: "Customer" } });
    expect(日志.map((l) => l.entityId).sort()).toEqual([a, b].sort());
    expect(日志.every((l) => l.userId === 总.id)).toBe(true);
  });
});
