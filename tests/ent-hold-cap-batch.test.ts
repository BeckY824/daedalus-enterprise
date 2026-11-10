/**
 * 持有上限整批核（M-公海-18，用户 11-10 定「超了就整批不领」）：
 *   - 一次领取会让名下线索 / 商机阶段的项目超过上限 → 一个都不领（事务回滚），提示说清上限、名下现有、这次要领、最多还能领
 *   - 刚好到上限 → 领成
 *   - 客户行、项目行一起勾的一次领取同一个事务、合起来核
 *   - 两个并发领取合计超限 → 恰好一个成功、另一个整批失败，不会两个都成、不会领一半（多跑几轮）
 *   - 总管理批量分公海项目同样整批
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 持有数, 领取公海项目们 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 领取 } from "@/app/(app)/customers/pool-actions";
import { 分配公海项目 } from "@/app/(app)/pool/actions";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人;
let 甲: 人;
let 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 当 = (u: 人) => { mocks.user = { ...u }; };

let 序号 = 0;
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) => {
  序号 += 1;
  return (await prisma.project.create({ data: { name: `项目${序号}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
};
/** 客户公海里的客户，名下 n 个线索公海里的项目（领客户一起带走） */
const 公海客户 = async (n: number) => {
  const c = await 客户(甲.id);
  for (let i = 0; i < n; i++) await 项目(c, 甲.id, { pooledAt: new Date() });
  await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
  return c;
};
/** 线索公海里能单独领的项目（客户不在客户公海） */
const 公海项目 = async () => 项目(await 客户(甲.id), 甲.id, { pooledAt: new Date() });
const 丙先有 = async (n: number) => { for (let i = 0; i < n; i++) await 项目(await 客户(丙.id), 丙.id); };
const 上限 = async (n: number) => {
  await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: n } });
  invalidateSettingsCache();
};
const 在公海的项目 = () => prisma.project.count({ where: { pooledAt: { not: null } } });

async function 起步() {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true });
  总管 = await 造人("boss", "总管某", "ADMIN", "director");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales");
  丙 = await 造人("bing", "销售丙某", "SALES", "sales");
}

beforeEach(起步);
afterEach(() => { vi.unstubAllEnvs(); });

describe("一次领取超上限：整批不领", () => {
  it("批量领 3 个公海项目，名下 1 个、上限 3：一个都没领，话里说清上限、现有、要领、最多还能领", async () => {
    await 上限(3);
    await 丙先有(1);
    const ps = [await 公海项目(), await 公海项目(), await 公海项目()];
    当(丙);
    const r = await 领取([], undefined, ps);
    expect(r).toEqual({ ok: false, error: "销售丙某名下现在有 1 个线索 / 商机阶段的项目，持有上限 3 个，这次要领 3 个，最多还能领 2 个；超了上限，这一批一个都没领，先推进或放回一些，或者少选几个再领" });
    expect(await 在公海的项目()).toBe(3);
    expect(await 持有数(prisma, 丙.id)).toBe(1);
    expect(await prisma.projectNodeLog.count({ where: { kind: "pool-claim" } })).toBe(0);
  });

  it("刚好到上限：名下 1 个、上限 3，领 2 个 → 都领到", async () => {
    await 上限(3);
    await 丙先有(1);
    const ps = [await 公海项目(), await 公海项目()];
    当(丙);
    const r = await 领取([], undefined, ps);
    expect(r).toMatchObject({ ok: true, 项目: { 领到: ps, 没领到: [] } });
    expect(await 持有数(prisma, 丙.id)).toBe(3);
  });

  it("一个公海客户带 3 个项目，名下 1 个、上限 3：客户、项目都还在公海", async () => {
    await 上限(3);
    await 丙先有(1);
    const c = await 公海客户(3);
    当(丙);
    const r = await 领取([c]);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("这次要领 3 个，最多还能领 2 个");
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ salesOwnerId: 甲.id });
    expect(await 在公海的项目()).toBe(3);
  });

  it("客户行 + 项目行一起领：各自不超、合起来超 → 一个都没领；少勾一个就都领到", async () => {
    await 上限(3);
    await 丙先有(1);
    const c = await 公海客户(1);
    const ps = [await 公海项目(), await 公海项目()];
    当(丙);
    const r = await 领取([c], undefined, ps);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("这次要领 3 个，最多还能领 2 个");
    expect(await prisma.customerPool.count()).toBe(1);
    expect(await 在公海的项目()).toBe(3);
    const r2 = await 领取([c], undefined, ps.slice(0, 1));
    expect(r2).toMatchObject({ ok: true, updated: 1, 项目: { 领到: ps.slice(0, 1) } });
    expect(await 持有数(prisma, 丙.id)).toBe(3);
  });

  it("批里有领不了的（已被人领走）不拦别的；算上限只数真领到的", async () => {
    await 上限(3);
    await 丙先有(1);
    const ps = [await 公海项目(), await 公海项目(), await 公海项目()];
    await prisma.project.update({ where: { id: ps[2] }, data: { pooledAt: null, ownerId: 甲.id } });
    当(丙);
    const r = await 领取([], undefined, ps);
    expect(r).toMatchObject({ ok: true, 项目: { 领到: ps.slice(0, 2), 没领到: [{ id: ps[2] }] } });
    expect(await 持有数(prisma, 丙.id)).toBe(3);
  });

  it("没开上限（默认 999 关着）：照常整批领", async () => {
    await 丙先有(1);
    const ps = [await 公海项目(), await 公海项目(), await 公海项目()];
    当(丙);
    expect(await 领取([], undefined, ps)).toMatchObject({ ok: true, 项目: { 领到: ps } });
  });

  it("总管理批量分公海项目给他：超了一个都不分", async () => {
    await 上限(2);
    await 丙先有(1);
    const ps = [await 公海项目(), await 公海项目()];
    当(总管);
    const r = await 分配公海项目(ps, 丙.id);
    expect(r).toEqual({ ok: false, error: "销售丙某名下现在有 1 个线索 / 商机阶段的项目，持有上限 2 个，这次要接 2 个，最多还能接 1 个；超了上限，这一批一个都没接，先推进或放回一些，或者少选几个再接" });
    expect(await 在公海的项目()).toBe(2);
    expect(await 分配公海项目(ps.slice(0, 1), 丙.id)).toMatchObject({ ok: true, 分到: ps.slice(0, 1) });
  });
});

describe("并发领取：检查和写入同一个事务，后到的整批失败", () => {
  it("两次各领 2 个公海客户（各带 1 个项目），名下 1、上限 3：恰好一次成功、另一次一个都没领（跑 5 轮）", async () => {
    for (let 轮 = 0; 轮 < 5; 轮++) {
      if (轮) await 起步();
      await 上限(3);
      await 丙先有(1);
      const 一批 = [await 公海客户(1), await 公海客户(1)];
      const 二批 = [await 公海客户(1), await 公海客户(1)];
      当(丙);
      const [a, b] = await Promise.all([领取(一批), 领取(二批)]);
      const 成 = [a, b].filter((r) => r.ok);
      expect(成).toHaveLength(1);
      expect(成[0]).toMatchObject({ updated: 2 });
      const 败 = (a.ok ? b : a) as { ok: false; error: string };
      expect(败.error).toContain("名下现在有 3 个");
      expect(败.error).toContain("最多还能领 0 个");
      const 败批 = a.ok ? 二批 : 一批;
      expect(await prisma.customerPool.count({ where: { customerId: { in: 败批 } } })).toBe(2);
      expect(await 持有数(prisma, 丙.id)).toBe(3);
    }
  });

  it("两次各领 2 个公海项目（直接调 领取公海项目们），名下 0、上限 3：恰好一次成功（跑 5 轮）", async () => {
    for (let 轮 = 0; 轮 < 5; 轮++) {
      if (轮) await 起步();
      await 上限(3);
      const 一批 = [await 公海项目(), await 公海项目()];
      const 二批 = [await 公海项目(), await 公海项目()];
      当(丙);
      const [a, b] = await Promise.all([领取公海项目们(丙, 一批), 领取公海项目们(丙, 二批)]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect((a.ok ? b : a) as { ok: false; error: string }).toMatchObject({ ok: false, error: expect.stringContaining("这次要领 2 个，最多还能领 1 个") });
      expect(await 持有数(prisma, 丙.id)).toBe(2);
      expect(await 在公海的项目()).toBe(2);
    }
  });
});
