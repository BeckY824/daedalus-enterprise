/**
 * 换负责人记录 + 转之前先列项目（企业版 D-36，2026-10-24）：
 *   - 每条换负责人的路（改负责人、批量分配、公海领取 / 分配、成员停用、两种撤销）都留一行：谁转的、从谁到谁、什么时候
 *   - 原负责人记为历史负责人，停用的人名字照旧显示
 *   - 转之前数出来的「会一起转走的 N 个项目」和真转走的对得上
 *   - 不是企业版：记录照记，但转之前不问（预览回 0 个）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { assignSalesOwner, patchCustomer, 撤销改负责人, 转走项目预览of } from "@/app/(app)/customers/actions";
import { 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { deactivateUser } from "@/app/(app)/settings/actions";
import { 交接全部 } from "@/app/(app)/projects/handover/actions";
import { 历史负责人of } from "@/lib/owner-log-db";
import { 历史负责人们, 换负责人一句, type 换负责人记录 } from "@/lib/owner-log";
import { 转走项目说法, 预览列几个 } from "@/lib/carry-over";

let 甲: string;
let 乙: string;
let 丙: string;
let 号 = 0;

const 客户 = (name: string, salesOwnerId: string) =>
  prisma.customer.create({ data: { name, phone: `1390000${String(++号).padStart(4, "0")}`, salesOwnerId, followStatus: "跟进中" } });
const 项目 = (name: string, ownerId: string, customerId: string) =>
  prisma.project.create({ data: { name, customerId, ownerId, creatorId: ownerId, phase: "线索", node: "潜客培育" } });
const 记录of = (customerId: string) =>
  prisma.customerOwnerLog.findMany({ where: { customerId }, orderBy: [{ at: "asc" }, { id: "asc" }] });
const 放公海 = (customerId: string, userId: string) => prisma.customerPool.create({ data: { customerId, userId, reason: "手动" } });

beforeEach(async () => {
  await resetDb();
  号 = 0;
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  丙 = (await prisma.user.create({ data: { email: "bing", name: "丙", title: "", role: "SALES", password: "x" } })).id;
  // 11-01 权限只认业务角色：甲给总管理（director），乙、丙给销售（sales）
  await prisma.entMember.createMany({ data: [{ userId: 甲, bizRole: "director" }, { userId: 乙, bizRole: "sales" }, { userId: 丙, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 甲, role: "ADMIN" };
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => { vi.unstubAllEnvs(); });

afterAll(async () => { await prisma.$disconnect(); });

describe("每条换负责人的路都留记录", () => {
  it("批量分配：记谁转的、从谁到谁；本来就归他的不记", async () => {
    const c = await 客户("乙的", 乙);
    const 本来 = await 客户("丙的", 丙);
    const r = await assignSalesOwner([c.id, 本来.id], 丙);
    expect(r.ok).toBe(true);
    expect(await 记录of(c.id)).toMatchObject([{ userId: 甲, fromOwnerId: 乙, toOwnerId: 丙, kind: "assign" }]);
    expect(await 记录of(本来.id)).toEqual([]);
  });

  it("详情页改负责人：记 assign；改成同一个人不记", async () => {
    const c = await 客户("乙的", 乙);
    expect((await patchCustomer(c.id, "salesOwnerId", 乙)).ok).toBe(true);
    expect(await 记录of(c.id)).toEqual([]);
    expect((await patchCustomer(c.id, "salesOwnerId", 丙)).ok).toBe(true);
    expect(await 记录of(c.id)).toMatchObject([{ userId: 甲, fromOwnerId: 乙, toOwnerId: 丙, kind: "assign" }]);
  });

  it("撤销批量分配：负责人还回原负责人，被撤的那条记录删掉、不另记（P-撤销-01）", async () => {
    const c = await 客户("乙的", 乙);
    const r = await assignSalesOwner([c.id], 丙);
    if (!r.ok) throw new Error("没分成");
    await 撤销改负责人(r.原值!, 丙, r.带过来);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(乙);
    expect((await 记录of(c.id)).map((x) => [x.kind, x.fromOwnerId, x.toOwnerId])).toEqual([]);
  });

  it("公海领取记 claim（操作人是领的人）；撤销领取删掉这条、不另记（P-撤销-01）", async () => {
    const c = await 客户("乙放的", 乙);
    await 放公海(c.id, 乙);
    mocks.user = { ...mocks.user, id: 丙, role: "SALES" };
    const r = await 领取([c.id]);
    if (!r.ok) throw new Error(r.error);
    expect(await 记录of(c.id)).toMatchObject([{ userId: 丙, fromOwnerId: 乙, toOwnerId: 丙, kind: "claim" }]);
    await 撤销公海("领取", r.原负责人!, r.带过来);
    expect((await 记录of(c.id)).map((x) => [x.kind, x.userId, x.fromOwnerId, x.toOwnerId])).toEqual([]);
  });

  it("老板分配公海：记 pool-assign，操作人是老板", async () => {
    const c = await 客户("乙放的", 乙);
    await 放公海(c.id, 乙);
    const r = await 分配公海([c.id], 丙);
    expect(r.ok).toBe(true);
    expect(await 记录of(c.id)).toMatchObject([{ userId: 甲, fromOwnerId: 乙, toOwnerId: 丙, kind: "pool-assign" }]);
  });

  it("成员停用原地不动、不记；离职交接全部交给：他名下每位客户一行 deactivate（11-03 C4-4）", async () => {
    const a = await 客户("乙一", 乙);
    const b = await 客户("乙二", 乙);
    expect((await deactivateUser(乙, 丙)).ok).toBe(true);
    for (const c of [a, b]) expect(await 记录of(c.id)).toEqual([]);
    expect((await 交接全部(乙, 丙)).ok).toBe(true);
    for (const c of [a, b]) expect(await 记录of(c.id)).toMatchObject([{ userId: 甲, fromOwnerId: 乙, toOwnerId: 丙, kind: "deactivate" }]);
  });

  it("停用后全部交给 200 位客户：一次做完、200 行记录", async () => {
    await prisma.customer.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ name: `乙${i}`, phone: `1370000${String(i).padStart(4, "0")}`, salesOwnerId: 乙, followStatus: "跟进中" })) });
    const 起 = Date.now();
    expect((await deactivateUser(乙, 丙)).ok).toBe(true);
    expect((await 交接全部(乙, 丙)).ok).toBe(true);
    expect(Date.now() - 起).toBeLessThan(20_000);
    expect(await prisma.customerOwnerLog.count({ where: { kind: "deactivate", fromOwnerId: 乙, toOwnerId: 丙 } })).toBe(200);
  }, 30_000);
});

describe("历史负责人", () => {
  it("读库：人名换好，停用的人照旧显示名字", async () => {
    const c = await 客户("乙的", 乙);
    await assignSalesOwner([c.id], 丙);
    await prisma.user.update({ where: { id: 乙 }, data: { active: false } });
    const 记 = await 历史负责人of(c.id);
    expect(记).toMatchObject([{ 操作人: "甲", 从: "乙", 到: "丙", kind: "assign" }]);
    expect(历史负责人们(记, "丙")).toEqual(["乙"]);
  });

  it("最近换走的在前、同一个人只出现一次、现任不算", () => {
    const r = (从: string | null, 到: string): 换负责人记录 => ({ at: "2026-10-24T00:00:00.000Z", 操作人: "甲", 从, 到, kind: "assign" });
    expect(历史负责人们([r(null, "乙"), r("乙", "丙"), r("丙", "乙"), r("乙", "丁")], "丁")).toEqual(["乙", "丙"]);
    expect(历史负责人们([r("乙", "丙"), r("丙", "乙")], "乙")).toEqual(["丙"]);
  });

  it("悬停那句：人删了、原来没负责人都有说法", () => {
    expect(换负责人一句({ at: "", 操作人: "甲", 从: "乙", 到: "丙", kind: "claim" })).toBe("甲 把负责人从 乙 换成 丙（从公海领取）");
    expect(换负责人一句({ at: "", 操作人: null, 从: null, 到: "丙", kind: "怪的" })).toBe("已删除的成员 把负责人从 （没有） 换成 丙（改负责人）");
  });
});

describe("转之前先列出会一起转走的项目", () => {
  it("数出来的 = 真转走的（P-转-07）：名下全部，同事负责的、线索公海里的写明；新负责人本来负责的、本来就归他的客户不算", async () => {
    const c = await 客户("乙的", 乙);
    const 本来 = await 客户("丙的", 丙);
    await 项目("乙负责", 乙, c.id);
    const 同事 = await 项目("同事负责", 甲, c.id);
    await 项目("丙本来负责", 丙, c.id);
    await prisma.project.update({ where: { id: (await 项目("在公海", 乙, c.id)).id }, data: { pooledAt: new Date() } });
    await 项目("丙客户上的", 乙, 本来.id);

    const 预 = await 转走项目预览of([c.id, 本来.id], 丙);
    expect(预.项目数).toBe(3);
    expect(预.项目.map((p) => p.name)).toEqual(["乙负责", "同事负责", "在公海"]);
    expect(预.项目[0].客户).toBe("乙的");
    // P-转-07：同事负责的一起转走，转之前点名
    expect(预.项目[1]).toEqual({ name: "同事负责", 客户: "乙的", 负责人: "甲" });
    expect(预.项目[2]).toEqual({ name: "在公海", 客户: "乙的", 负责人: "线索公海" });

    const r = await assignSalesOwner([c.id, 本来.id], 丙);
    if (!r.ok) throw new Error("没分成");
    expect(r.带走?.项目).toBe(预.项目数);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 同事.id } })).ownerId).toBe(丙);
  });

  it("P-转-07：转客户带名下全部项目，同事负责的（含已结束的）、原负责人结束了的都跟着走", async () => {
    const c = await 客户("乙的", 乙);
    const 同事在推 = await 项目("同事在推", 甲, c.id);
    const 同事结束 = await prisma.project.update({ where: { id: (await 项目("同事赢单", 甲, c.id)).id }, data: { result: "赢单" } });
    const 自己结束 = await prisma.project.update({ where: { id: (await 项目("乙丢单", 乙, c.id)).id }, data: { result: "丢单" } });

    const 预 = await 转走项目预览of([c.id], 丙);
    expect(预.项目数).toBe(3);
    expect(预.项目.filter((x) => x.负责人 === "甲").length).toBe(2);

    const r = await assignSalesOwner([c.id], 丙);
    if (!r.ok) throw new Error("没分成");
    const 主 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;
    expect(await 主(同事在推.id)).toBe(丙);
    expect(await 主(同事结束.id)).toBe(丙);
    expect(await 主(自己结束.id)).toBe(丙);
  });

  it("P-转-07 单个改负责人（详情页）也带名下全部", async () => {
    const c = await 客户("乙的", 乙);
    const 自己 = await 项目("乙负责", 乙, c.id);
    const 同事 = await 项目("同事负责", 甲, c.id);
    expect((await patchCustomer(c.id, "salesOwnerId", 丙)).ok).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 自己.id } })).ownerId).toBe(丙);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 同事.id } })).ownerId).toBe(丙);
  });

  it("不传新负责人 = 转给自己（公海领取前问）", async () => {
    const c = await 客户("乙放的", 乙);
    await 放公海(c.id, 乙);
    await 项目("跟着走", 乙, c.id);
    mocks.user = { ...mocks.user, id: 丙, role: "SALES" };
    expect((await 转走项目预览of([c.id])).项目数).toBe(1);
  });

  it("说法：0 个不弹；多过列的个数说「等共 N 个」", () => {
    expect(转走项目说法({ 项目数: 0, 项目: [] })).toBeNull();
    expect(转走项目说法(null)).toBeNull();
    const 列 = Array.from({ length: 预览列几个 }, (_, i) => ({ name: `项目${i}`, 客户: "李总" }));
    expect(转走项目说法({ 项目数: 预览列几个, 项目: 列 })).toEqual({ 标题: `会一起转走的 ${预览列几个} 个项目`, 行: 列.map((x) => `${x.name}（李总）`), 还有: "" });
    expect(转走项目说法({ 项目数: 12, 项目: 列 })?.还有).toBe("等共 12 个");
    expect(转走项目说法({ 项目数: 1, 项目: [列[0]] })?.还有).toBe("");
  });

  it("说法：同事的、公海里的写明负责人（P-转-07）；一个都没有不弹", () => {
    const 列 = Array.from({ length: 预览列几个 }, (_, i) => ({ name: `同事${i}`, 客户: "李总", 负责人: "甲" }));
    const 说 = 转走项目说法({ 项目数: 9, 项目: 列 });
    expect(说?.行).toEqual(列.map((x) => `${x.name}（李总 · 甲）`));
    expect(说?.还有).toBe("等共 9 个");
    expect(说?.标题).toBe("会一起转走的 9 个项目");
    expect(转走项目说法({ 项目数: 0, 项目: [] })).toBeNull();
  });

  it("不是企业版：不问（0 个、不弹），转了照样记一行", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 客户("乙的", 乙);
    await 项目("乙负责", 乙, c.id);
    expect(await 转走项目预览of([c.id], 丙)).toEqual({ 项目数: 0, 项目: [] });
    expect((await assignSalesOwner([c.id], 丙)).ok).toBe(true);
    expect(await 记录of(c.id)).toMatchObject([{ fromOwnerId: 乙, toOwnerId: 丙, kind: "assign" }]);
  });

  it("名下项目多于列的个数：只取前几个，总数照实", async () => {
    const c = await 客户("乙的", 乙);
    for (let i = 0; i < 预览列几个 + 3; i++) await 项目(`p${i}`, 乙, c.id);
    const 预 = await 转走项目预览of([c.id], 丙);
    expect(预.项目数).toBe(预览列几个 + 3);
    expect(预.项目).toHaveLength(预览列几个);
  });
});
