/**
 * 企业版「申请移交」（P-转-01 ①、X-20，客户 11-09 回执 X4：负责人转客户走申请移交，接手人确认后生效；不确认不生效）：
 *   - 负责人本人转自己的客户：不当场换，记一行交接（byUserId = fromUserId = 本人），接手人收到「申请移交」通知；
 *     「交接要确认」开着关着都一样（这条是规则本身，不是开关）
 *   - 接手人确认 → 才换负责人，名下自己的项目跟着走（P-转-07，沿用确认交接那一步）；拒收、本人撤回 → 什么都不转，本人收到通知
 *   - 实线直属上级、系统管理员、条线总管理（转条线里别人的）直接转（P-转-01 ②③④）；条线总管理转自己的也走申请（同 ①）；市场成员的客户给销售照旧当场转（P-转-17 / X-46 ⑤）
 *   - 申请中（X-38 → P-转-05）：能编辑；不能再转（上级直转也拦）、不能领取、不能分配公海、不能删（P-删-10）
 *   - 挂起 7 天（X-46 ⑥）：提醒接手人和发起人各一次，不自动生效、不自动作废，之后接着等；发起人可撤回，也可改接手人
 *   - 不是企业版：照旧当场换
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  /** 企业版业务配置锁 poolDays = 0；测按天扫要临时放开 */
  poolDays: 0,
}));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), ...(mocks.poolDays ? { poolDays: mocks.poolDays } : {}) }) };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { assignSalesOwner, patchCustomer, deleteCustomers } from "@/app/(app)/customers/actions";
import { 待确认的交接, 确认交接, 撤回交接, 拒收交接, 改接手人 } from "@/app/(app)/customers/handover-actions";
import { 挂起移交提醒, 挂起提醒键 } from "@/lib/enterprise/handover-remind";
import { 领取, 分配公海 } from "@/app/(app)/customers/pool-actions";
import { 自动掉公海 } from "@/lib/pool-db";
import { 公海超时收回 } from "@/lib/project/db";
import { 单项目客户跟进公海 } from "@/lib/enterprise/pool-link";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 默认组织规则 } from "@/lib/project/org-rules";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 销售: 人, 接手: 人, 同事: 人;
let 号 = 0;

async function 建(email: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进" } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 一笔 = () => prisma.entHandover.findFirstOrThrow();
const 通知 = (userId: string, 事件: string, hid: string) => prisma.entNotice.findFirst({ where: { userId, dedupeKey: `handover:${hid}:${事件}` } });

beforeEach(async () => {
  await resetDb();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales");
  接手 = await 建("taker");
  同事 = await 建("peer");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 销售.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 接手.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 同事.id, managerId: 组长.id, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  // 生产上「交接要确认」关着：申请移交不靠这个开关
  await setSetting("enterprise.rule.handover_confirm", false);
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); mocks.poolDays = 0; });
afterAll(async () => { await prisma.$disconnect(); });

describe("负责人本人转客户 = 申请移交", () => {
  it("不当场换；记一笔本人发起的交接；接手人收到「申请移交」、列表里能确认；本人能撤回", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    expect(await assignSalesOwner([a.id, b.id], 接手.id)).toMatchObject({ ok: true, updated: 0, 交接中: 2, 申请移交: true });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([销售.id, 销售.id]);
    const h = await 一笔();
    expect(h).toMatchObject({ kind: "转让", fromUserId: 销售.id, toUserId: 接手.id, byUserId: 销售.id, status: "待确认" });
    expect((await 通知(接手.id, "发起", h.id))?.title).toContain("申请");

    expect((await 待确认的交接()).我发起的[0]).toMatchObject({ id: h.id, 自己的: true, 我能撤回: true });
    当(接手);
    expect((await 待确认的交接()).等我确认[0]).toMatchObject({ id: h.id, 自己的: true, 我能确认: true, 客户总数: 2 });
  });

  it("接手人确认后才生效：客户换人，本人负责的项目一起走；本人收到已确认", async () => {
    const a = await 客户(销售.id);
    const p = await prisma.project.create({ data: { name: "项目a", customerId: a.id, ownerId: 销售.id, creatorId: 销售.id, phase: "线索" } });
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();

    当(接手);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
    expect(await 归谁(a.id)).toBe(接手.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(接手.id);
    expect(await 通知(销售.id, "已确认", h.id)).not.toBeNull();
  });

  it("拒收：不生效，本人收到「拒绝了移交申请」", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    当(接手);
    expect(await 拒收交接(h.id)).toMatchObject({ ok: true });
    expect(await 归谁(a.id)).toBe(销售.id);
    const t = (await 通知(销售.id, "已拒收", h.id))?.title ?? "";
    expect(t).toContain("拒绝");
    expect(t).toContain("仍在你名下");
  });

  it("本人撤回：不生效，接手人收到「撤回了移交申请」；别的业务员撤不了", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    当(同事);
    expect(await 撤回交接(h.id)).toMatchObject({ ok: false });
    当(销售);
    expect(await 撤回交接(h.id)).toMatchObject({ ok: true });
    expect(await 归谁(a.id)).toBe(销售.id);
    expect((await 通知(接手.id, "已撤回", h.id))?.title).toContain("移交申请");
  });

  it("就地改负责人（详情页）也走申请", async () => {
    const a = await 客户(销售.id);
    expect(await patchCustomer(a.id, "salesOwnerId", 接手.id)).toMatchObject({ ok: true, 交接中: 1, 申请移交: true });
    expect(await 归谁(a.id)).toBe(销售.id);
  });

  it("「交接要确认」开着：本人发起的同样是申请；上级发起的是普通交接", async () => {
    await setSetting("enterprise.rule.handover_confirm", true);
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, 交接中: 1, 申请移交: true });
    当(组长);
    const r = await assignSalesOwner([b.id], 接手.id);
    expect(r).toMatchObject({ ok: true, 交接中: 1 });
    expect(r.ok && r.申请移交).toBeFalsy();
  });
});

describe("白名单 ②③④ 直接转（不走申请）", () => {
  it("实线直属上级、系统管理员直接转，不写交接", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    当(组长);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
    当(老板);
    expect(await assignSalesOwner([b.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([接手.id, 接手.id]);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("系统管理员转自己名下的：直接转", async () => {
    const a = await 客户(老板.id);
    当(老板);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("纯总管理（条线总管理）是负责人：能转自己的客户，走申请移交，和销售本人一样（P-转-01 ①）", async () => {
    const 条总 = await 建("linehead", "ADMIN");
    await prisma.entMember.create({ data: { userId: 条总.id, bizRole: "director", line: "外贸" } });
    await prisma.entMember.update({ where: { userId: 接手.id }, data: { line: "外贸" } });
    const b = await 客户(条总.id);
    当(条总);
    expect(await assignSalesOwner([b.id], 接手.id)).toMatchObject({ ok: true, updated: 0, 交接中: 1, 申请移交: true });
    expect(await 归谁(b.id)).toBe(条总.id);
    expect(await 一笔()).toMatchObject({ kind: "转让", fromUserId: 条总.id, toUserId: 接手.id, byUserId: 条总.id, status: "待确认" });
    当(接手);
    await 确认交接((await 一笔()).id);
    expect(await 归谁(b.id)).toBe(接手.id);
  });

  it("转给自己：当场换", async () => {
    const a = await 客户(组长.id);
    当(组长);
    expect(await assignSalesOwner([a.id], 组长.id)).toMatchObject({ ok: true, unchanged: 1 });
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("市场成员把自己的客户给销售（P-转-17）：当场转，不走申请", async () => {
    const 市场 = await 建("mkt");
    await prisma.entMember.create({ data: { userId: 市场.id, bizRole: "channel_ops" } });
    const a = await 客户(市场.id);
    当(市场);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(a.id)).toBe(接手.id);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("一批里混着自己的和下属的（销售管理）：整批走申请", async () => {
    const 我的 = await 客户(组长.id);
    const 下属的 = await 客户(销售.id);
    当(组长);
    expect(await assignSalesOwner([我的.id, 下属的.id], 接手.id)).toMatchObject({ ok: true, updated: 0, 交接中: 2, 申请移交: true });
    expect([await 归谁(我的.id), await 归谁(下属的.id)]).toEqual([组长.id, 销售.id]);
  });
});

describe("申请中（X-38 / P-转-05）：能编辑，不能再转、领、分、删", () => {
  it("上级直转回错；本人重复申请不重复记；删不掉；能改别的字段", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    expect(await assignSalesOwner([a.id], 同事.id)).toMatchObject({ ok: true, 交接中: 0, 交接已在路上: 1 });
    expect(await prisma.entHandover.count()).toBe(1);
    expect(await patchCustomer(a.id, "followStatus", "跟进中")).toMatchObject({ ok: true });

    当(组长);
    expect(await assignSalesOwner([a.id], 同事.id)).toMatchObject({ ok: false, error: expect.stringContaining("移交") });
    expect(await patchCustomer(a.id, "salesOwnerId", 同事.id)).toMatchObject({ ok: false, error: expect.stringContaining("移交") });
    当(老板);
    expect(await deleteCustomers([a.id])).toMatchObject({ ok: false, error: expect.stringContaining("交接") });
    expect(await 归谁(a.id)).toBe(销售.id);
  });

  it("万一进了公海（自动回收）：领不走、分不出去；撤回后能领", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    await prisma.customerPool.create({ data: { customerId: a.id, userId: 销售.id, reason: "自动" } });

    当(同事);
    expect(await 领取([a.id])).toMatchObject({ ok: false, error: expect.stringContaining("移交") });
    当(组长);
    expect(await 分配公海([a.id], 同事.id)).toMatchObject({ ok: false, error: expect.stringContaining("移交") });
    expect(await prisma.customerPool.count()).toBe(1);

    当(销售);
    expect(await 撤回交接(h.id)).toMatchObject({ ok: true });
    当(同事);
    expect(await 领取([a.id])).toMatchObject({ ok: true, updated: 1 });
  });
});

describe("不是企业版", () => {
  it("负责人转自己的：照旧当场换，一行交接都不写", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const a = await 客户(销售.id);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(a.id)).toBe(接手.id);
    expect(await prisma.entHandover.count()).toBe(0);
  });
});

describe("申请中不自动掉公海（X-38 → P-转-05：挂到对方确认为止）", () => {
  const 今 = new Date();
  const 天前 = (n: number) => new Date(今.getTime() - n * 86400_000);

  it("按天扫、项目超时回收、单项目客户跟着进公海都跳过申请中的客户和它名下的项目；别的照收", async () => {
    mocks.poolDays = 30;
    const 申 = await 客户(销售.id);
    const 别 = await 客户(销售.id);
    await prisma.customer.updateMany({ data: { lastFollowAt: 天前(40), createdAt: 天前(40) } });
    const 申项 = await prisma.project.create({ data: { name: "项目甲", customerId: 申.id, ownerId: 销售.id, creatorId: 销售.id, createdAt: 天前(10) } });
    const 别项 = await prisma.project.create({ data: { name: "项目乙", customerId: 别.id, ownerId: 销售.id, creatorId: 销售.id, createdAt: 天前(10) } });
    expect(await assignSalesOwner([申.id], 接手.id)).toMatchObject({ 申请移交: true });

    expect(await 自动掉公海({ ...销售, name: "销售" }, 今)).toBe(1);
    expect(await prisma.customerPool.findUnique({ where: { customerId: 申.id } })).toBeNull();
    expect(await prisma.customerPool.findUnique({ where: { customerId: 别.id } })).not.toBeNull();

    // 别的客户已在公海，它名下的项目本来就不收；再放一个不在公海的对照
    const 对 = await 客户(销售.id);
    const 对项 = await prisma.project.create({ data: { name: "项目丙", customerId: 对.id, ownerId: 销售.id, creatorId: 销售.id, createdAt: 天前(10) } });
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    expect(await 公海超时收回({ ...销售, name: "销售" }, 今)).toBe(1);
    const 在公海 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).pooledAt !== null;
    expect([await 在公海(申项.id), await 在公海(对项.id), await 在公海(别项.id)]).toEqual([false, true, false]);
    expect(await 归谁(申.id)).toBe(销售.id);

    const 原 = 公海规则.单项目客户跟着进公海;
    公海规则.单项目客户跟着进公海 = true;
    try {
      expect(await prisma.$transaction((tx) => 单项目客户跟进公海(tx, { customerId: 申.id, ownerId: 销售.id }, null, 今))).toBe(false);
    } finally {
      公海规则.单项目客户跟着进公海 = 原;
    }
    expect(await prisma.customerPool.findUnique({ where: { customerId: 申.id } })).toBeNull();
  });
});

describe("挂起 7 天（X-46 ⑥）：提醒一次，不生效不作废；发起人可改接手人", () => {
  const 天 = 24 * 60 * 60_000;
  const 提醒 = (userId: string, hid: string) => prisma.entNotice.findMany({ where: { userId, dedupeKey: 挂起提醒键(hid) } });

  it("不满 7 天不提醒；满 7 天接手人、发起人各一条；再扫不重发；仍待确认，之后照样能确认", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    expect(await 挂起移交提醒(new Date(h.createdAt.getTime() + 6 * 天))).toBe(0);
    const 到 = new Date(h.createdAt.getTime() + 7 * 天 + 60_000);
    expect(await 挂起移交提醒(到)).toBe(2);
    expect((await 提醒(接手.id, h.id))[0]?.title).toContain("7 天");
    expect((await 提醒(销售.id, h.id))[0]?.title).toContain("还没确认");
    expect(await 挂起移交提醒(new Date(到.getTime() + 3 * 天))).toBe(0);
    expect((await 一笔()).status).toBe("待确认");
    expect(await 归谁(a.id)).toBe(销售.id);
    // 上级发起的普通交接不在这条提醒里
    expect(await prisma.entNotice.count({ where: { dedupeKey: { contains: "挂起" }, userId: { notIn: [接手.id, 销售.id] } } })).toBe(0);
    当(接手);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
  });

  it("发起人改接手人：新接手人收到、能确认；原接手人不用管了、确认不了；别人改不了", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    expect((await 待确认的交接()).我发起的[0]).toMatchObject({ id: h.id, 我能改接手人: true, 接手人id: 接手.id });
    当(组长);
    expect(await 改接手人(h.id, 同事.id)).toMatchObject({ ok: false });
    当(销售);
    expect(await 改接手人(h.id, 接手.id)).toMatchObject({ ok: false });
    expect(await 改接手人(h.id, 销售.id)).toMatchObject({ ok: false });
    expect(await 改接手人(h.id, 同事.id)).toEqual({ ok: true, 客户: 0 });
    expect(await 一笔()).toMatchObject({ toUserId: 同事.id, status: "待确认", byUserId: 销售.id });
    expect((await 通知(接手.id, "发起", h.id))?.readAt).not.toBeNull();
    expect((await 通知(同事.id, "发起", h.id))?.title).toContain("申请");
    expect(await prisma.entNotice.count({ where: { userId: 接手.id, dedupeKey: { startsWith: `handover:${h.id}:改走:` } } })).toBe(1);

    当(接手);
    expect(await 确认交接(h.id)).toMatchObject({ ok: false });
    当(同事);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
    expect(await 归谁(a.id)).toBe(同事.id);
  });
});
