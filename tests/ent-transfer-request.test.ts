/**
 * 企业版「申请移交」（P-转-01 ①、X-20，客户 11-09 回执 X4：负责人转客户走申请移交，接手人确认后生效；不确认不生效）：
 *   - 负责人本人转自己的客户：不当场换，记一行交接（byUserId = fromUserId = 本人），接手人收到「申请移交」通知；
 *     「交接要确认」开着关着都一样（这条是规则本身，不是开关）
 *   - 接手人确认 → 才换负责人，名下自己的项目跟着走（P-转-07，沿用确认交接那一步）；拒收、本人撤回 → 什么都不转，本人收到通知
 *   - 实线直属上级、系统管理员、条线总管理（转条线里别人的）直接转（P-转-01 ②③④）；条线总管理转自己的也走申请（同 ①）；市场成员的客户给销售照旧当场转（P-转-17 / X-46 ⑤）
 *   - 申请中（X-38 → P-转-05）：能编辑；不能再转（上级直转也拦）、不能领取、不能分配公海、不能删（P-删-10）
 *   - 挂满 7 天没人处理（11-10 新口径，覆盖 X-46 ⑥）：自动作废、通知申请人，归属不变；作废前发起人可撤回，也可改接手人
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
/** 撞车用：布好以后，下一次 看全部 那一读回来之后先跑它（只跑一次），模拟「扫到之后、写之前被人处理了」 */
const 撞车 = vi.hoisted(() => ({ 读完后: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/team-scope", async (原) => {
  const m = await 原<typeof import("@/lib/team-scope")>();
  return {
    ...m,
    看全部: async <T,>(f: () => Promise<T>): Promise<T> => {
      const r = await m.看全部(f);
      const 跑 = 撞车.读完后;
      if (跑) { 撞车.读完后 = null; await 跑(); }
      return r;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { assignSalesOwner, patchCustomer, saveCustomer, deleteCustomers, 撤销改负责人 } from "@/app/(app)/customers/actions";
import { 待确认的交接, 确认交接, 撤回交接, 拒收交接, 改接手人 } from "@/app/(app)/customers/handover-actions";
import { 挂起移交作废, 移交作废键, 移交预告键 } from "@/lib/enterprise/handover-expire";
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

  /*
   * 申请移交确认这条路转客户，和另外四个入口（批量转让、详情页转让、编辑页、就地改）一套（P-转-07 Even 口径、P-转-19、X-49）：
   * 全部项目一起走（本人的、同事在推的；同事已结束的不动），同事收到通知，确认框只写个数，撤销时还给原负责人
   */
  it("接手人确认：同事在推的项目一起走、同事收到通知；确认框只写个数；撤销时各还各的", async () => {
    const 项 = (name: string, ownerId: string, extra: Record<string, unknown> = {}) =>
      prisma.project.create({ data: { name, customerId: a.id, ownerId, creatorId: ownerId, phase: "线索", ...extra } });
    const a = await 客户(销售.id);
    const 本人的 = await 项("本人的", 销售.id);
    const 在推 = await 项("同事在推的", 同事.id);
    const 结束 = await 项("同事结束的", 同事.id, { result: "丢单" });
    const 负责 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, 交接中: 1, 申请移交: true });
    const h = await 一笔();

    当(接手);
    const 说明 = (await 待确认的交接()).等我确认[0].确认说明;
    expect(说明).toContain("全部 2 个项目（含 1 个同事在推的");
    expect(说明).not.toContain("同事在推的」");
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
    expect([await 负责(本人的.id), await 负责(在推.id), await 负责(结束.id)]).toEqual([接手.id, 接手.id, 同事.id]);
    const 知 = await prisma.entNotice.findFirst({ where: { userId: 同事.id, title: { contains: "随客户一起给了" } } });
    expect(知?.title).toContain("「同事在推的」");

    // 撤销（发起人本人，按确认那一步记下的带过来）：同事的还给同事，本人的还给本人
    当(销售);
    const 记 = await prisma.auditLog.findFirstOrThrow({ where: { summary: { contains: "确认接手" } }, orderBy: { at: "desc" } });
    const d = JSON.parse(记.detail ?? "{}");
    expect(await 撤销改负责人([{ id: a.id, 值: 销售.id }], 接手.id, d.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(a.id)).toBe(销售.id);
    expect([await 负责(本人的.id), await 负责(在推.id), await 负责(结束.id)]).toEqual([销售.id, 同事.id, 同事.id]);
  });

  it("接手人确认时持有上限把同事在推的也算上（M-公海-18）：超了拦、交接还挂着；放宽后能确认", async () => {
    const 上限 = async (n: number) => { await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: n } }); invalidateSettingsCache(); };
    const 已有 = await 客户(接手.id);
    await prisma.project.create({ data: { name: "接手已有", customerId: 已有.id, ownerId: 接手.id, creatorId: 接手.id, phase: "线索" } });
    const a = await 客户(销售.id);
    await prisma.project.create({ data: { name: "本人的", customerId: a.id, ownerId: 销售.id, creatorId: 销售.id, phase: "线索" } });
    await prisma.project.create({ data: { name: "同事在推的", customerId: a.id, ownerId: 同事.id, creatorId: 同事.id, phase: "线索" } });
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    await 上限(2);
    当(接手);
    const r = await 确认交接(h.id);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("再接这 2 个");
    expect(await 归谁(a.id)).toBe(销售.id);
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("待确认");
    await 上限(3);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
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

  it("编辑页整表保存换负责人也走申请（P-转-16）；开关开着关着一样", async () => {
    for (const 开 of [false, true]) {
      await setSetting("enterprise.rule.handover_confirm", 开);
      const a = await 客户(销售.id);
      const r = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
      const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
      const res = await saveCustomer({ id: a.id, updatedAt: r.updatedAt.toISOString(), base, ...base, salesOwnerId: 接手.id } as Parameters<typeof saveCustomer>[0]);
      expect(res).toMatchObject({ ok: true, 交接中: 1, 申请移交: true });
      expect(await 归谁(a.id)).toBe(销售.id);
    }
  });

  it("「交接要确认」开着：上级单条换负责人直接转（P-转-16）", async () => {
    await setSetting("enterprise.rule.handover_confirm", true);
    const c = await 客户(销售.id);
    当(组长);
    expect(await patchCustomer(c.id, "salesOwnerId", 接手.id)).not.toHaveProperty("交接中");
    expect(await 归谁(c.id)).toBe(接手.id);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("「交接要确认」开着：批量转让同单条（P-转-16，11-10）——本人发起的是申请；上级发起的直接转，不写交接", async () => {
    await setSetting("enterprise.rule.handover_confirm", true);
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, 交接中: 1, 申请移交: true });
    当(组长);
    const r = await assignSalesOwner([b.id], 接手.id);
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(r).not.toHaveProperty("交接中");
    expect(await 归谁(b.id)).toBe(接手.id);
    expect(await prisma.entHandover.count()).toBe(1);
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

describe("挂满 7 天没人处理：第 6 天预告、预告满 24 小时后自动作废（11-10 新口径，覆盖 X-46 ⑥ 的「一直挂着」）；发起人可改接手人", () => {
  const 天 = 24 * 60 * 60_000;
  const 作废通知 = (userId: string, hid: string) => prisma.entNotice.findMany({ where: { userId, dedupeKey: 移交作废键(hid) } });
  const 预告 = (userId: string, hid: string) => prisma.entNotice.findMany({ where: { userId, dedupeKey: 移交预告键(hid) } });
  /** 钟拨到发起后这么久（只假 Date，库照常走），按「现在」扫一遍 */
  const 过了 = async (h: { createdAt: Date }, 毫秒: number) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(h.createdAt.getTime() + 毫秒));
    return 挂起移交作废();
  };
  afterEach(() => { vi.useRealTimers(); 撞车.读完后 = null; });

  it("不满 6 天不预告；第 6 天给申请人、接手人各预告一次、不重复、不作废；满 7 天作废、只通知申请人一次、留痕；归属不变；重复跑不重复通知", async () => {
    const a = await 客户(销售.id);
    const p = await prisma.project.create({ data: { name: "项目甲", customerId: a.id, ownerId: 销售.id, creatorId: 销售.id } });
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    expect(await 过了(h, 5 * 天 + 23 * 3_600_000)).toBe(0);
    expect(await prisma.entNotice.count({ where: { dedupeKey: 移交预告键(h.id) } })).toBe(0);
    // 第 6 天：预告两人各一条，说清明天作废；再扫不重发；还是待确认
    expect(await 过了(h, 6 * 天 + 60_000)).toBe(0);
    expect(await 过了(h, 6 * 天 + 120_000)).toBe(0);
    expect(await 过了(h, 6 * 天 + 23 * 3_600_000)).toBe(0);
    for (const u of [销售, 接手]) {
      const 告 = await 预告(u.id, h.id);
      expect(告).toHaveLength(1);
      expect(告[0].title).toContain("明天（满 7 天）自动作废");
      expect(告[0].title).toContain("请尽快处理");
    }
    expect((await 一笔()).status).toBe("待确认");
    expect(await 作废通知(销售.id, h.id)).toHaveLength(0);

    expect(await 过了(h, 7 * 天 + 60_000)).toBe(1);
    const 后 = await 一笔();
    expect(后).toMatchObject({ status: "已作废", doneById: "system" });
    expect(后.doneAt?.getTime()).toBe(h.createdAt.getTime() + 7 * 天 + 60_000);
    // 客户、项目归属不变
    expect(await 归谁(a.id)).toBe(销售.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(销售.id);
    // 只通知申请人，说清为什么、还能重新申请
    const 发 = await 作废通知(销售.id, h.id);
    expect(发).toHaveLength(1);
    expect(发[0].title).toContain("已作废");
    expect(`${发[0].title}${发[0].body}`).toContain("超过 7 天");
    expect(发[0].body).toContain("重新申请");
    expect(await 作废通知(接手.id, h.id)).toHaveLength(0);
    // 接手人那条「等你确认」不再挂着未读
    expect((await 通知(接手.id, "发起", h.id))?.readAt).not.toBeNull();
    // 留痕：记在「系统」名下
    const 痕 = await prisma.auditLog.findMany({ where: { userId: "system", entity: "Customer" } });
    expect(痕).toHaveLength(1);
    expect(痕[0].summary).toContain("作废");
    expect(JSON.parse(痕[0].detail ?? "{}")).toMatchObject({ 交接: h.id, 状态: "已作废", 客户: [a.id] });

    // 重复跑：不再作废、不再通知、不再留痕
    expect(await 过了(h, 7 * 天 + 120_000)).toBe(0);
    expect(await 过了(h, 10 * 天)).toBe(0);
    expect(await 作废通知(销售.id, h.id)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { userId: "system" } })).toBe(1);

    // 作废后接手人确认不了；客户不再算「申请中」，可以重新申请
    vi.useRealTimers();
    当(接手);
    expect(await 确认交接(h.id)).toMatchObject({ ok: false });
    expect(await 归谁(a.id)).toBe(销售.id);
    当(销售);
    expect(await assignSalesOwner([a.id], 同事.id)).toMatchObject({ ok: true });
    expect(await prisma.entHandover.count({ where: { status: "待确认", toUserId: 同事.id } })).toBe(1);
  });

  it("作废的申请：申请人的客户页上显示「已作废（超 7 天未处理）」，不再是待确认；接手人那边没有了", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    expect(await 过了(h, 6 * 天)).toBe(0);
    expect(await 过了(h, 7 * 天 + 60_000)).toBe(1);
    const 列 = await 待确认的交接();
    expect(列.我发起的).toHaveLength(1);
    expect(列.我发起的[0]).toMatchObject({ id: h.id, 状态: "已作废（超 7 天未处理）", 我能撤回: false, 我能改接手人: false, 我能确认: false });
    当(接手);
    expect(await 待确认的交接()).toEqual({ 等我确认: [], 我发起的: [] });
    // 总管理看全部待确认的，也不看别人作废了的
    当(老板);
    expect(await 待确认的交接()).toEqual({ 等我确认: [], 我发起的: [] });
    // 作废满 7 天后不再显示
    当(销售);
    vi.setSystemTime(new Date(h.createdAt.getTime() + 14 * 天 + 120_000));
    expect((await 待确认的交接()).我发起的).toEqual([]);
  });

  it("人工先处理了就不动：接手人已确认、已拒绝、发起人已撤回的，满 7 天也不作废、不通知", async () => {
    const [a, b, c] = [await 客户(销售.id), await 客户(销售.id), await 客户(销售.id)];
    await assignSalesOwner([a.id], 接手.id);
    const ha = await 一笔();
    当(接手);
    expect(await 确认交接(ha.id)).toEqual({ ok: true, 客户: 1 });
    当(销售);
    await assignSalesOwner([b.id], 接手.id);
    const hb = await prisma.entHandover.findFirstOrThrow({ where: { status: "待确认" } });
    当(接手);
    expect(await 拒收交接(hb.id)).toMatchObject({ ok: true });
    当(销售);
    await assignSalesOwner([c.id], 接手.id);
    const hc = await prisma.entHandover.findFirstOrThrow({ where: { status: "待确认" } });
    expect(await 撤回交接(hc.id)).toMatchObject({ ok: true });

    expect(await 过了(hc, 8 * 天)).toBe(0);
    expect((await prisma.entHandover.findMany({ orderBy: { createdAt: "asc" } })).map((x) => x.status).sort()).toEqual(["已拒收", "已撤回", "已确认"].sort());
    expect(await prisma.entNotice.count({ where: { dedupeKey: { endsWith: ":作废" } } })).toBe(0);
    expect(await 归谁(a.id)).toBe(接手.id);
  });

  it("扫到之后、写之前被人确认了（撞车）：按「还待确认」条件写，命中 0 行就跳过，不通知、不留痕", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    expect(await 过了(h, 6 * 天)).toBe(0);
    // 扫的那一读回来还是待确认，写之前接手人确认了
    let 撞了 = false;
    撞车.读完后 = async () => {
      撞了 = true;
      await prisma.entHandover.update({ where: { id: h.id }, data: { status: "已确认", doneById: 接手.id, doneAt: new Date() } });
    };
    expect(await 过了(h, 7 * 天 + 60_000)).toBe(0);
    expect(撞了).toBe(true);
    expect(await 一笔()).toMatchObject({ status: "已确认", doneById: 接手.id });
    expect(await 作废通知(销售.id, h.id)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { userId: "system" } })).toBe(0);
  });

  it("存量已经挂了 10 天（上线前没预告过）：第一遍只预告不作废；不满 24 小时不作废；预告满 24 小时才作废", async () => {
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    expect(await 过了(h, 10 * 天)).toBe(0);
    expect((await 一笔()).status).toBe("待确认");
    for (const u of [销售, 接手]) {
      const 告 = await 预告(u.id, h.id);
      expect(告).toHaveLength(1);
      expect(告[0].title).toContain("24 小时后自动作废");
    }
    expect(await 作废通知(销售.id, h.id)).toHaveLength(0);
    // 紧接着再扫、23 小时后再扫：都不作废，预告不重发
    expect(await 过了(h, 10 * 天 + 60_000)).toBe(0);
    expect(await 过了(h, 10 * 天 + 23 * 3_600_000)).toBe(0);
    expect((await 一笔()).status).toBe("待确认");
    expect(await prisma.entNotice.count({ where: { dedupeKey: 移交预告键(h.id) } })).toBe(2);
    expect(await 过了(h, 11 * 天)).toBe(1);
    expect((await 一笔()).status).toBe("已作废");
    expect(await 作废通知(销售.id, h.id)).toHaveLength(1);
    expect(await 归谁(a.id)).toBe(销售.id);
  });

  it("预告之后人工处理了就不作废：接手人确认 / 发起人撤回的，预告满 24 小时也不动、不发作废通知", async () => {
    const [a, b] = [await 客户(销售.id), await 客户(销售.id)];
    await assignSalesOwner([a.id], 接手.id);
    const ha = await 一笔();
    await assignSalesOwner([b.id], 同事.id);
    const hb = await prisma.entHandover.findFirstOrThrow({ where: { toUserId: 同事.id } });
    expect(await 过了(hb, 6 * 天 + 60_000)).toBe(0);
    expect(await 预告(接手.id, ha.id)).toHaveLength(1);
    expect(await 预告(同事.id, hb.id)).toHaveLength(1);
    vi.useRealTimers();
    当(接手);
    expect(await 确认交接(ha.id)).toEqual({ ok: true, 客户: 1 });
    当(销售);
    expect(await 撤回交接(hb.id)).toMatchObject({ ok: true });
    expect(await 过了(hb, 8 * 天)).toBe(0);
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: ha.id } })).status).toBe("已确认");
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: hb.id } })).status).toBe("已撤回");
    expect(await prisma.entNotice.count({ where: { dedupeKey: { endsWith: ":作废" } } })).toBe(0);
    expect(await 归谁(a.id)).toBe(接手.id);
    expect(await 归谁(b.id)).toBe(销售.id);
  });

  it("改过接手人：新接手人没收过预告的补一条；作废仍按最早那条预告满 24 小时算；两位都停用的不等预告", async () => {
    const [a, b] = [await 客户(销售.id), await 客户(同事.id)];
    await assignSalesOwner([a.id], 接手.id);
    const h = await 一笔();
    expect(await 过了(h, 6 * 天 + 60_000)).toBe(0);
    vi.useRealTimers();
    expect(await 改接手人(h.id, 同事.id)).toEqual({ ok: true, 客户: 0 });
    expect(await 过了(h, 6 * 天 + 12 * 3_600_000)).toBe(0);
    expect(await 预告(同事.id, h.id)).toHaveLength(1);
    expect(await 预告(销售.id, h.id)).toHaveLength(1);
    expect(await 过了(h, 7 * 天 + 60_000)).toBe(1);
    // 两位都停用：没人可预告，满 7 天直接作废
    vi.useRealTimers();
    const 没人 = await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 同事.id, toUserId: 接手.id, byUserId: 同事.id, customerIds: JSON.stringify([b.id]) } });
    await prisma.user.updateMany({ where: { id: { in: [同事.id, 接手.id] } }, data: { active: false } });
    expect(await 过了(没人, 7 * 天 + 60_000)).toBe(1);
    expect(await prisma.entNotice.count({ where: { dedupeKey: 移交预告键(没人.id) } })).toBe(0);
  });

  it("只管负责人本人的申请移交：离职交接、上级发起要确认的交接不作废；发起人已停用的照样作废、不发通知", async () => {
    const [a, b, c] = [await 客户(同事.id), await 客户(销售.id), await 客户(同事.id)];
    // 上级发起、要接手人确认的转让；离职交接：都不是「申请移交」
    const 上级发的 = await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 同事.id, toUserId: 接手.id, byUserId: 组长.id, customerIds: JSON.stringify([a.id]) } });
    const 离职的 = await prisma.entHandover.create({ data: { kind: "离职", fromUserId: 同事.id, toUserId: 接手.id, byUserId: 同事.id, way: "转交", customerIds: JSON.stringify([c.id]) } });
    await assignSalesOwner([b.id], 接手.id);
    const 申 = await prisma.entHandover.findFirstOrThrow({ where: { byUserId: 销售.id } });
    await prisma.user.update({ where: { id: 销售.id }, data: { active: false } });
    expect(await 过了(申, 7 * 天)).toBe(0);
    expect(await 预告(销售.id, 申.id)).toHaveLength(0);
    expect(await 预告(接手.id, 申.id)).toHaveLength(1);
    expect(await prisma.entNotice.count({ where: { dedupeKey: { contains: "作废预告" } } })).toBe(1);
    expect(await 过了(申, 8 * 天)).toBe(1);
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: 上级发的.id } })).status).toBe("待确认");
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: 离职的.id } })).status).toBe("待确认");
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: 申.id } })).status).toBe("已作废");
    expect(await 作废通知(销售.id, 申.id)).toHaveLength(0);
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
