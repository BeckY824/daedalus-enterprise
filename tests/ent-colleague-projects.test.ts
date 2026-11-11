/**
 * 一位客户多个项目分属不同人（企业版 V3.5.1 X-05，11-05，lib/enterprise/colleague-projects.ts）：
 *   - P-删-05：名下有同事负责、还没结束的项目，删客户先挡（系统管理员除外）；同事结束了的项目跟着客户进回收站
 *   - P-公海-06：手动放进公海，客户负责人自己的项目一起进项目公海；名下有同事在跑的项目，整位拦住；撤销还回去
 *   - M-公海-02 例外二：项目放回公海带客户进客户公海时，名下有同事在跑的项目，客户不跟着进
 * 转客户只带原负责人的项目（P-转-07）在 owner-log.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 公海规则, 客户整体进公海理由 } from "@/lib/enterprise/pool-rules";
import { 放回公海, 公海超时收回 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 放进公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { deleteCustomers, 客户删除预检 } from "@/app/(app)/customers/actions";
import { 有同事在推的客户 } from "@/lib/enterprise/colleague-projects";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 丙: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string) {
  序++;
  return (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: ownerId } })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId || 老板.id, ...补 } })).id;
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 在客户公海 = async (id: string) => !!(await raw.customerPool.findUnique({ where: { customerId: id } }));
const 项目of = (id: string) => raw.project.findUniqueOrThrow({ where: { id } });
const 客户of = (id: string) => raw.customer.findUniqueOrThrow({ where: { id } });

const 原规则 = { ...公海规则 };
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  Object.assign(公海规则, 原规则);
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  // 老板 = 系统管理员（director、不带条线），乙、丙 = 销售
  await prisma.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }] });
  await setSetting("business", { projectMode: true });
  当(老板);
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
  Object.assign(公海规则, 原规则);
});

describe("有同事在推的客户：还没结束 = 没结局、不在项目公海", () => {
  it("同事在跑的算；客户负责人自己的、同事结束了的、项目公海里的都不算", async () => {
    const 有 = await 客户(乙.id);
    await 项目(丙.id, 有);
    const 自己的 = await 客户(乙.id);
    await 项目(乙.id, 自己的);
    const 结束了 = await 客户(乙.id);
    await 项目(丙.id, 结束了, { result: "赢单" });
    await 项目(丙.id, 结束了, { result: "丢单" });
    const 公海里 = await 客户(乙.id);
    await 项目("", 公海里, { pooledAt: new Date() });
    await 项目(丙.id, 公海里, { pooledAt: new Date() });
    const 们 = await raw.customer.findMany({ select: { id: true, salesOwnerId: true } });
    expect([...(await 有同事在推的客户(raw, 们))]).toEqual([有]);
  });
});

describe("P-删-05 删客户：名下有同事在跑的项目先挡", () => {
  it("乙删自己的客户：丙负责、还没结束的项目挡住，预检和真删都说清，客户、项目都还在", async () => {
    const c = await 客户(乙.id);
    await 项目(乙.id, c);
    const 丙的 = await 项目(丙.id, c);
    当(乙);
    const 话 = `「${(await 客户of(c)).name}」名下有同事负责、还没结束的项目，先转走或让负责人删`;
    expect(await 客户删除预检([c])).toEqual({ ok: false, error: 话 });
    expect(await deleteCustomers([c])).toEqual({ ok: false, error: 话 });
    expect((await 客户of(c)).deletedAt).toBeNull();
    expect((await 项目of(丙的)).deletedAt).toBeNull();
  });

  it("批量删：挡住一位整批都不删，话里说几位", async () => {
    const a = await 客户(乙.id);
    await 项目(丙.id, a);
    const b = await 客户(乙.id);
    await 项目(丙.id, b);
    const 干净 = await 客户(乙.id);
    当(乙);
    expect(await deleteCustomers([a, b, 干净])).toEqual({ ok: false, error: "2 位客户名下有同事负责、还没结束的项目，整批已阻止。先转走或让负责人删" });
    expect((await 客户of(干净)).deletedAt).toBeNull();
  });

  it("同事的项目结束了（赢单 / 丢单）：照删，跟着客户进回收站", async () => {
    const c = await 客户(乙.id);
    const 赢 = await 项目(丙.id, c, { result: "赢单" });
    const 自己 = await 项目(乙.id, c);
    当(乙);
    expect(await 客户删除预检([c])).toEqual({ ok: true });
    expect(await deleteCustomers([c])).toMatchObject({ ok: true, deleted: 1 });
    expect((await 客户of(c)).deletedAt).not.toBeNull();
    expect((await 项目of(赢)).deletedAt).not.toBeNull();
    expect((await 项目of(自己)).deletedAt).not.toBeNull();
  });

  it("系统管理员（P-判定-03）：同事在跑的项目也一起删，进回收站", async () => {
    const c = await 客户(乙.id);
    const 丙的 = await 项目(丙.id, c);
    当(老板);
    expect(await 客户删除预检([c])).toEqual({ ok: true });
    expect(await deleteCustomers([c])).toMatchObject({ ok: true, deleted: 1 });
    expect((await 项目of(丙的)).deletedAt).not.toBeNull();
  });
});

describe("P-公海-06 手动放进公海：客户负责人自己的项目一起进项目公海", () => {
  it("乙放进公海：乙在跑的线索 / 商机项目进项目公海（清负责人、记 pool-release、关待办）；结束了的、同事结束了的不动；撤销全还回去", async () => {
    const c = await 客户(乙.id);
    const 在跑 = await 项目(乙.id, c, { phase: "商机", node: "需求确认" });
    const 赢了 = await 项目(乙.id, c, { result: "赢单" });
    const 同事赢了 = await 项目(丙.id, c, { result: "赢单" });
    const 名 = (await 项目of(在跑)).name;
    await prisma.task.create({ data: { title: `跟进「${名}」`, customerId: c, ownerId: 乙.id } });
    当(乙);
    const r = await 放进公海([c], "客户主动终止");
    expect(r).toMatchObject({ ok: true, updated: 1, 公海项目: [在跑] });
    expect(await 在客户公海(c)).toBe(true);
    const p = await 项目of(在跑);
    expect(p.pooledAt).not.toBeNull();
    expect(p.ownerId).toBe("");
    expect(await raw.projectNodeLog.findFirstOrThrow({ where: { projectId: 在跑, kind: "pool-release" } })).toMatchObject({ userId: 乙.id, fromOwnerId: 乙.id, reason: "回收原因：客户主动终止" });
    expect(await raw.task.count({ where: { customerId: c, ownerId: 乙.id, done: false } })).toBe(0);
    expect(await 项目of(赢了)).toMatchObject({ ownerId: 乙.id, pooledAt: null });
    expect(await 项目of(同事赢了)).toMatchObject({ ownerId: 丙.id, pooledAt: null });

    if (!r.ok) throw new Error("没放成");
    expect(await 撤销公海("放进", [{ id: c, 值: "" }], undefined, undefined, r.公海项目)).toMatchObject({ ok: true, updated: 1 });
    expect(await 在客户公海(c)).toBe(false);
    expect(await 项目of(在跑)).toMatchObject({ ownerId: 乙.id, pooledAt: null });
    expect(await raw.projectNodeLog.count({ where: { projectId: 在跑, kind: "pool-release" } })).toBe(0);
    expect(await raw.task.findFirstOrThrow({ where: { customerId: c } })).toMatchObject({ ownerId: 乙.id, done: false, title: `跟进「${名}」` });
  });

  it("名下有同事在跑的项目：整位拦住，说清是哪位、几个同事在推的项目，不写项目名和负责人（P-看-12 例外、Even C4）；客户、项目都不动", async () => {
    const c = await 客户(乙.id);
    const 自己 = await 项目(乙.id, c);
    const 丙的 = await 项目(丙.id, c);
    await 项目(丙.id, c);
    当(乙);
    const r = await 放进公海([c], "客户主动终止");
    expect(r).toEqual({
      ok: false,
      error: `「${(await 客户of(c)).name}」名下有 2 个同事在推的项目，先转走或结束再放进公海`,
    });
    if (r.ok) throw new Error("应该被拦");
    expect(r.error).not.toContain((await 项目of(丙的)).name);
    expect(r.error).not.toContain("丙");
    expect(await 在客户公海(c)).toBe(false);
    expect(await 项目of(自己)).toMatchObject({ ownerId: 乙.id, pooledAt: null });
    expect(await 项目of(丙的)).toMatchObject({ ownerId: 丙.id, pooledAt: null });
  });

  it("批量：被挡的那位跳过、数进 同事在推，别的照放", async () => {
    const 挡 = await 客户(乙.id);
    await 项目(丙.id, 挡);
    const 放 = await 客户(乙.id);
    当(乙);
    expect(await 放进公海([挡, 放], "客户主动终止")).toMatchObject({ ok: true, updated: 1, 同事在推: 1, 同事项目: `「${(await 客户of(挡)).name}」有 1 个同事在推的项目` });
    expect(await 在客户公海(挡)).toBe(false);
    expect(await 在客户公海(放)).toBe(true);
  });

  it("几位都被拦：逐位写各有几个同事在推的项目，不写项目名", async () => {
    const 甲客 = await 客户(乙.id);
    const 丙的 = await 项目(丙.id, 甲客);
    const 丁客 = await 客户(乙.id);
    const 丙的2 = [];
    for (let i = 0; i < 5; i++) 丙的2.push(await 项目(丙.id, 丁客));
    await 项目(乙.id, 丁客); // 自己的不列
    当(乙);
    const r = await 放进公海([甲客, 丁客], "客户主动终止");
    if (r.ok) throw new Error("应该被拦");
    expect(r.error).toBe(
      `2 位客户名下有同事负责、还没结束的项目：「${(await 客户of(甲客)).name}」有 1 个同事在推的项目；` +
        `「${(await 客户of(丁客)).name}」有 5 个同事在推的项目，先转走或结束再放进公海`,
    );
    for (const id of [丙的, ...丙的2]) expect(r.error).not.toContain((await 项目of(id)).name);
  });
});

describe("M-公海-02 例外二：项目放回公海带客户时，名下有同事在跑的项目客户不跟着进", () => {
  // 11-09 起项目退回默认不带客户（M-公海-02）；这组钉老开关打开时的路径，默认行为见 ent-pool-customer-owner
  beforeEach(() => { 公海规则.单项目客户跟着进公海 = true; });

  it("乙放回自己的项目：丙还有在跑的，客户留在乙名下不进客户公海", async () => {
    const c = await 客户(乙.id);
    const 乙的 = await 项目(乙.id, c);
    await 项目(丙.id, c);
    expect(await 放回公海(乙, 乙的, "客户主动终止")).toEqual({ ok: true });
    expect((await 项目of(乙的)).pooledAt).not.toBeNull();
    expect(await 在客户公海(c)).toBe(false);
  });

  it("丙的项目已经结束：客户照旧整体跟着进", async () => {
    const c = await 客户(乙.id);
    const 乙的 = await 项目(乙.id, c);
    await 项目(丙.id, c, { result: "丢单" });
    expect(await 放回公海(乙, 乙的)).toEqual({ ok: true });
    expect(await raw.customerPool.findUniqueOrThrow({ where: { customerId: c } })).toMatchObject({ reason: 客户整体进公海理由 });
  });

  it("超时回收也一样：乙的项目超时进项目公海，丙还有在跑的，客户不进客户公海", async () => {
    const 今 = new Date("2026-11-05T10:00:00+08:00");
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(乙.id);
    const 乙的 = await 项目(乙.id, c, { createdAt: new Date(今.getTime() - 10 * 86400_000) });
    await 项目(丙.id, c, { createdAt: 今 });
    expect(await 以谁的身份(乙.id, () => 公海超时收回(乙, 今))).toBe(1);
    expect((await 项目of(乙的)).pooledAt).not.toBeNull();
    expect(await 在客户公海(c)).toBe(false);
  });
});
