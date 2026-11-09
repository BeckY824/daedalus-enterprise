/**
 * 企业版两级公海的规则（2026-10-26，lib/enterprise/pool-rules.ts + pool-link.ts）：
 *   - 企业版不按天数自动掉公海（10-28 业务配置锁 poolDays = 0）：客户进公海只走项目超时 / 放回；团队模式「今天扫过了」只记在自己号上
 *   - 单项目客户（D6）：名下只有这一个项目，项目进项目公海（放回 / 超时），客户也进客户公海；领项目把客户一起领过来
 *   - 领客户即领项目：领 / 分配客户公海里的客户，名下项目公海里的项目一起过来
 *   - 原负责人不能领回（10-26 定稿「非原负责人均可领取」）：开关在 公海规则，默认拦，报「原负责人不能领回」
 *   - 项目公海从属客户公海：客户进公海名下项目全跟着、谁领谁带走；名下有没结束的订单时一个项目超期只收这一个
 *   - 多项目客户（10-27 会议定固定客户可转让，存着旧的项目可转让也不认）：放回 / 超时客户也进、领项目连客户和别的项目一起领，有没结束的订单项目不进
 *   - 超时回收记在「系统」名下（QA #16），不记成打开页面的那位
 *   - 直接指定给某人（批量分配）：新负责人看得到联系人、项目、沟通记录，原负责人看不到了
 *   - 开关关着照旧：上面这些企业版的一条都不做
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
  团队: null as null | { teamId: string; key: string; device: string },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => mocks.团队 }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 公海规则, 单项目客户进公海理由, 客户整体进公海理由, 原负责人不能领回提示, 项目不能单独领提示, 客户在公海项目不单领提示, 进公海关待办尾 } from "@/lib/enterprise/pool-rules";
import { 系统, 超时理由 } from "@/lib/project/timeout";
import { 自动掉公海 } from "@/lib/pool-db";
import { 放回公海, 领取公海项目, 公海超时收回 } from "@/lib/project/db";
import { 可选项 } from "@/lib/enterprise/dict";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 放进公海, 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 无负责人占位邮箱, 无负责人占位名 } from "@/lib/pool";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 分配公海项目 } from "@/app/(app)/pool/actions";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 经理: 人;
let 乙: 人;
let 丙: 人;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
let 序 = 0;
async function 客户(ownerId: string, 补: Record<string, unknown> = {}) {
  序++;
  return (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: ownerId, ...补 } })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, ...补 } })).id;
}
const 占位Id = async () => (await prisma.user.findUniqueOrThrow({ where: { email: 无负责人占位邮箱 } })).id;
const 在客户公海 = async (id: string) => !!(await prisma.customerPool.findUnique({ where: { customerId: id } }));
const 负责人 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 项目在公海 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).pooledAt !== null;
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 天前 = (n: number, 今: Date) => new Date(今.getTime() - n * 86400_000);
const 今 = new Date("2026-10-26T10:00:00+08:00");

/** 按组织看客户开着：经理管乙、丙；乙、丙互相看不到 */
async function 开按组织看() {
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
}

const 原规则 = { ...公海规则 };
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  Object.assign(公海规则, 原规则);
  // 11-09 起默认项目层动作不碰客户（M-公海-02、M-公海-06，默认行为见 ent-pool-customer-owner、ent-owner-matrix 和本文件末尾一组）。
  // 下面多数用例测这两个开关打开时的连带（放回带客户进公海、领项目带走客户……），代码还留着这条路，显式打开测
  公海规则.单项目客户跟着进公海 = true;
  公海规则.领项目带走单项目客户 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.团队 = null;
  老板 = await 造人("boss", "老板", "ADMIN");
  经理 = await 造人("mkt", "经理", "MANAGER");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  // 权限只认业务角色（11-01）：老板=总管理，经理=销售管理，乙、丙=销售、上级经理
  await prisma.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 经理.id, bizRole: "sales_mgr" }, { userId: 乙.id, managerId: 经理.id }, { userId: 丙.id, managerId: 经理.id }] });
  当(老板);
  await setSetting("business", { projectMode: true, poolDays: 30 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
  Object.assign(公海规则, 原规则);
});

describe("自动掉公海（按天数）", () => {
  it("企业版：存着 30 天也不按天数扫，谁先打开都一样（客户进公海只走项目超时 / 放回）", async () => {
    await 开按组织看();
    const 乙的 = await 客户(乙.id, { lastFollowAt: 天前(40, 今) });
    const 丙的 = await 客户(丙.id, { lastFollowAt: 天前(40, 今) });
    expect(await 以谁的身份(乙.id, () => 自动掉公海(乙, 今))).toBe(0);
    expect(await 自动掉公海(老板, 今)).toBe(0);
    expect(await 在客户公海(乙的)).toBe(false);
    expect(await 在客户公海(丙的)).toBe(false);
  });

  it("团队模式每台只扫自己名下的：乙扫过了不挡丙同一天扫自己的", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    mocks.团队 = { teamId: "t", key: "k", device: "d" };
    const 乙的 = await 客户(乙.id, { lastFollowAt: 天前(40, 今) });
    const 丙的 = await 客户(丙.id, { lastFollowAt: 天前(40, 今) });
    expect(await 自动掉公海(乙, 今)).toBe(1);
    expect(await 在客户公海(丙的)).toBe(false);
    expect(await 自动掉公海(丙, 今)).toBe(1);
    expect(await 在客户公海(乙的)).toBe(true);
    expect(await 在客户公海(丙的)).toBe(true);
    expect(await 自动掉公海(丙, 今)).toBe(0);
  });
});

describe("单项目客户（D6）", () => {
  it("名下只有一个项目，负责人放回项目公海：客户一起进客户公海，理由写清", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p)).toEqual({ ok: true });
    expect(await 项目在公海(p)).toBe(true);
    const 行 = await prisma.customerPool.findUniqueOrThrow({ where: { customerId: c } });
    expect(行).toMatchObject({ userId: 乙.id, reason: 单项目客户进公海理由 });
    // 进公海负责人清空（M-公海-03），谁领了谁接（同客户公海）
    expect(await 负责人(c)).toBe(await 占位Id());
  });

  it("客户归别人的：客户不进公海（客户留原负责人，只换项目负责人）；名下几个项目的见「项目随客户整体转让」", async () => {
    const 别人的 = await 客户(丙.id);
    const p2 = await 项目(乙.id, 别人的);
    expect(await 放回公海(乙, p2)).toEqual({ ok: true });
    expect(await 在客户公海(别人的)).toBe(false);
  });

  it("超时回收进项目公海也一样：单项目客户一起进客户公海（操作人空着，同自动掉公海）", async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, { createdAt: 天前(10, 今) });
    expect(await 以谁的身份(乙.id, () => 公海超时收回(乙, 今))).toBe(1);
    expect(await 项目在公海(p)).toBe(true);
    expect(await prisma.customerPool.findUniqueOrThrow({ where: { customerId: c } })).toMatchObject({ userId: null, reason: 单项目客户进公海理由 });
    // QA #16：乙打开页面触发的，留痕和操作日志都记「系统」，不记乙
    expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p, kind: "pool-release" } })).toMatchObject({ userId: 系统.id, fromOwnerId: 乙.id, reason: 超时理由 });
    expect(await prisma.auditLog.count({ where: { userId: 乙.id } })).toBe(0);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "pool", entity: "Project" } })).toMatchObject({ userId: 系统.id, userName: "系统" });
    // 丙领走：客户一起过来，但给乙的收回提醒还留在乙名下
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await prisma.task.count({ where: { customerId: c, ownerId: 乙.id, title: { contains: "已回到线索公海" } } })).toBe(1);
  });

  it("丙领这个项目：客户一起归丙，客户公海那一行删掉、记领取时间；乙在这位客户上没做完的待办进公海时已关掉（11-01 C-01），留在乙名下不跟过来", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    const 待办 = await prisma.task.create({ data: { title: "回个电话", customerId: c, ownerId: 乙.id } });
    await 放回公海(乙, p);
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
    expect(await 负责人(c)).toBe(丙.id);
    expect(await 在客户公海(c)).toBe(false);
    expect((await prisma.customerClaim.findUniqueOrThrow({ where: { customerId: c } })).userId).toBe(丙.id);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: 待办.id } })).toMatchObject({ ownerId: 乙.id, done: true, title: `回个电话${进公海关待办尾}` });
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c, kind: "claim", toOwnerId: 丙.id } })).toBe(1);
  });

  it("开关（单项目客户跟着进公海 / 领项目带走单项目客户）关了：只动项目", async () => {
    公海规则.单项目客户跟着进公海 = false;
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 在客户公海(c)).toBe(false);

    公海规则.单项目客户跟着进公海 = true;
    公海规则.领项目带走单项目客户 = false;
    const c2 = await 客户(乙.id);
    const p2 = await 项目(乙.id, c2);
    await 放回公海(乙, p2);
    // 客户在客户公海、又不随项目带走：项目不单领，要连客户一起领（M-公海-06）
    expect(await 领取公海项目(丙, p2)).toEqual({ ok: false, error: 客户在公海项目不单领提示 });
    expect(await 项目在公海(p2)).toBe(true);
    expect(await 负责人(c2)).toBe(await 占位Id());
    expect(await 在客户公海(c2)).toBe(true);
  });
});

describe("放回公海选回收原因（10-27 字典接下拉）", () => {
  it("带原因：记在放回那一行；不在字典里（停用了）回错、项目不动；不选照放", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 项目(乙.id, c);
    const [第一个] = await 可选项("recycle");
    expect(await 放回公海(乙, p, "随便写的")).toMatchObject({ ok: false, error: expect.stringContaining("不在") });
    expect(await 项目在公海(p)).toBe(false);
    expect(await 放回公海(乙, p, 第一个)).toEqual({ ok: true });
    expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p, kind: "pool-release" } })).toMatchObject({ reason: `回收原因：${第一个}` });
    const p2 = await 项目(乙.id, c);
    expect(await 放回公海(乙, p2)).toEqual({ ok: true });
    expect((await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p2, kind: "pool-release" } })).reason).toBeNull();
  });
});

describe("领客户即领项目", () => {
  it("丙从客户公海领客户：名下放在项目公海里的项目一起归丙，记一行 pool-claim；带走数里算上", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 在客户公海(c)).toBe(true);
    当(丙);
    const r = await 领取([c]);
    expect(r).toMatchObject({ ok: true, updated: 1 });
    if (r.ok) expect(r.带走?.项目).toBe(1);
    const 现 = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    expect(现).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect(await prisma.projectNodeLog.count({ where: { projectId: p, kind: "pool-claim", toOwnerId: 丙.id } })).toBe(1);
  });

  it("老板把公海里的客户分给丙：项目也一起归丙", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    当(老板);
    expect(await 分配公海([c], 丙.id)).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
    expect(await 项目在公海(p)).toBe(false);
  });

  it("主动退回（业务员把自己的客户放进公海）：他在跑的项目一起进项目公海（P-公海-06，11-05），谁领客户谁整体带走", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    当(乙);
    expect(await 放进公海([c], "客户主动终止")).toMatchObject({ ok: true, updated: 1, 公海项目: [p] });
    expect(await 项目在公海(p)).toBe(true);
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
    expect(await 项目在公海(p)).toBe(false);
  });
});

describe("没人负责的公海客户：领错、分错都能撤（11-02）", () => {
  let 占位: 人;
  const 没人负责的 = async () => {
    const c = await 客户(占位.id);
    await prisma.customerPool.create({ data: { customerId: c, userId: 占位.id, reason: "导入：原系统公海" } });
    const p = await 项目("", c, { creatorId: 老板.id, pooledAt: 天前(30, 今) });
    return { c, p };
  };
  const 回到原样 = async (c: string, p: string) => {
    expect(await 负责人(c)).toBe(占位.id);
    expect(await 在客户公海(c)).toBe(true);
    const 项 = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    expect(项.ownerId).toBe("");
    expect(项.pooledAt).not.toBeNull();
  };
  beforeEach(async () => {
    const u = await prisma.user.create({ data: { email: 无负责人占位邮箱, name: 无负责人占位名, title: "", role: "SALES", password: "x", active: false } });
    占位 = { id: u.id, name: u.name, role: "SALES" };
  });

  it("领了能撤，撤完客户和项目都回公海，还能再领", async () => {
    const { c, p } = await 没人负责的();
    当(乙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(1);
    expect(await 负责人(c)).toBe(乙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(乙.id);
    expect(await 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目)).toMatchObject({ ok: true, updated: 1 });
    await 回到原样(c, p);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(c)).toBe(乙.id);
  });

  it("分错了能撤", async () => {
    const { c, p } = await 没人负责的();
    当(老板);
    const r = await 分配公海([c], 丙.id);
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(1);
    expect(await 负责人(c)).toBe(丙.id);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, r.给谁?.id, r.公海项目)).toMatchObject({ ok: true, updated: 1 });
    await 回到原样(c, p);
  });

  it("原负责人是别的停用同事的，照旧不还", async () => {
    const 离职 = await prisma.user.create({ data: { email: "left@local", name: "离职", title: "", role: "SALES", password: "x", active: false } });
    const c = await 客户(离职.id);
    await prisma.customerPool.create({ data: { customerId: c, userId: 离职.id, reason: "手动" } });
    当(乙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    expect(await 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目)).toMatchObject({ ok: true, updated: 0, unchanged: 1 });
    expect(await 负责人(c)).toBe(乙.id);
  });
});

describe("领项目把客户带出客户公海：名下别的公海项目一起过来（10-31）", () => {
  /** 乙的客户 c 下三个项目：p1、p2 在项目公海（放回 p1，客户整体进客户公海、p2 跟着进），p3 不在公海、归经理；另一位客户 d 的 q 也在项目公海 */
  async function 摆() {
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c);
    const p2 = await 项目(乙.id, c);
    const p3 = await 项目(乙.id, c);
    // 放回 p1：客户整体进客户公海，p2、p3 一起进项目公海（X-12，11-05）；p3 再挪出公海归经理
    expect(await 放回公海(乙, p1)).toEqual({ ok: true });
    await prisma.project.update({ where: { id: p3 }, data: { ownerId: 经理.id, pooledAt: null } });
    const d = await 客户(乙.id);
    const q = await 项目(乙.id, d);
    await 项目(乙.id, d);
    expect(await 放回公海(乙, q)).toEqual({ ok: true });
    expect(await 在客户公海(c)).toBe(true);
    expect(await 项目在公海(p2)).toBe(true);
    return { c, p1, p2, p3, d, q };
  }

  it("丙领 p1：客户归丙出客户公海；p2 也归丙、出项目公海、记一行 pool-claim（操作人丙）；别的客户的 q 不动", async () => {
    const { c, p1, p2, q } = await 摆();
    expect(await 领取公海项目(丙, p1)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await 在客户公海(c)).toBe(false);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).toMatchObject({ ownerId: 丙.id, pooledAt: null, nextStepAt: null });
    const 痕 = await prisma.projectNodeLog.findMany({ where: { projectId: p2, kind: "pool-claim" } });
    expect(痕).toHaveLength(1);
    expect(痕[0]).toMatchObject({ userId: 丙.id, fromOwnerId: 乙.id, toOwnerId: 丙.id });
    // 手上领的 p1 只记一行（先移出项目公海再带，不会被当成别的公海项目再记）
    expect(await prisma.projectNodeLog.count({ where: { projectId: p1, kind: "pool-claim" } })).toBe(1);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: q } })).toMatchObject({ ownerId: "" }); // 公海里没负责人（11-01 C-01）
    expect(await 项目在公海(q)).toBe(true);
  });

  it("不在公海里的 p3：照 10-26 定稿整体转（带走一位 / 跟着客户转的项目），不记 pool-claim", async () => {
    const { p1, p3 } = await 摆();
    expect(await 领取公海项目(丙, p1)).toEqual({ ok: true });
    expect(await prisma.projectNodeLog.count({ where: { projectId: p3, kind: "pool-claim" } })).toBe(0);
    expect(await 项目在公海(p3)).toBe(false);
  });

  it("老板在统一公海把 p1 分给丙：p2 一起归丙，留痕操作人记老板", async () => {
    const { c, p1, p2 } = await 摆();
    当(老板);
    expect(await 分配公海项目([p1], 丙.id)).toMatchObject({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p2, kind: "pool-claim" } })).toMatchObject({ userId: 老板.id, toOwnerId: 丙.id });
  });

  it("p2 仍能在项目公海单独被领（领 p1 之前），领 p1 之后不会再重复带", async () => {
    const { c, p1, p2 } = await 摆();
    expect(await 领取公海项目(经理, p2)).toEqual({ ok: true });
    // 经理领 p2 已把客户带出客户公海（客户连同在公海里的 p1 一起归经理）
    expect(await 负责人(c)).toBe(经理.id);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p1 } })).toMatchObject({ ownerId: 经理.id, pooledAt: null });
    expect(await prisma.projectNodeLog.count({ where: { projectId: p2, kind: "pool-claim" } })).toBe(1);
    expect(await prisma.projectNodeLog.count({ where: { projectId: p1, kind: "pool-claim" } })).toBe(1);
  });

  it("开关关掉（领客户带走公海里的项目 = false）：客户照领，p2 留在项目公海", async () => {
    公海规则.领客户带走公海里的项目 = false;
    const { c, p1, p2 } = await 摆();
    expect(await 领取公海项目(丙, p1)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await 项目在公海(p2)).toBe(true);
    expect(await prisma.projectNodeLog.count({ where: { projectId: p2, kind: "pool-claim" } })).toBe(0);
  });
});

describe("原负责人不能领回（10-26 定稿）", () => {
  it("默认拦：乙放进公海的客户、放回的项目，乙领都报「原负责人不能领回」，丙照领", async () => {
    expect(公海规则.原负责人能领回).toBe(false);
    const c = await 客户(乙.id);
    const c2 = await 客户(乙.id);
    const p = await 项目(乙.id, c2);
    await prisma.project.create({ data: { name: "另一个", customerId: c2, ownerId: 乙.id, creatorId: 乙.id } });
    当(乙);
    await 放进公海([c], "客户主动终止");
    expect(await 领取([c])).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect(await 在客户公海(c)).toBe(true);
    expect(await 负责人(c)).toBe(await 占位Id());
    await 放回公海(乙, p);
    expect(await 领取公海项目(乙, p)).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect(await 项目在公海(p)).toBe(true);
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
  });

  it("超时系统收回的也一样：原负责人乙领不回，丙领得到", async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, { createdAt: 天前(10, 今) });
    expect(await 公海超时收回(老板, 今)).toBe(1);
    expect(await 领取公海项目(乙, p)).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
  });

  it("一次勾了几位，有乙自己的也有别人的：只领别人的，乙自己当原负责人的留在公海", async () => {
    const 自己的 = await 客户(乙.id);
    const 丙的 = await 客户(丙.id);
    当(乙);
    await 放进公海([自己的], "客户主动终止");
    当(丙);
    await 放进公海([丙的], "客户主动终止");
    当(乙);
    expect(await 领取([自己的, 丙的])).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(丙的)).toBe(乙.id);
    expect(await 在客户公海(自己的)).toBe(true);
  });

  it("开关改回能（会上若再改）：原负责人能领回", async () => {
    公海规则.原负责人能领回 = true;
    const c = await 客户(乙.id);
    当(乙);
    await 放进公海([c], "客户主动终止");
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
  });
});

describe("项目公海从属客户公海（10-26 定稿）", () => {
  it("客户进客户公海（主动退回）：名下两个项目都跟着，丙领了客户两个项目都归丙", async () => {
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c);
    const p2 = await 项目(乙.id, c, { phase: "商机", node: "明确需求" });
    当(乙);
    expect(await 放进公海([c], "客户主动终止")).toMatchObject({ ok: true, updated: 1 });
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    for (const p of [p1, p2]) expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
    expect(await 负责人(c)).toBe(丙.id);
  });

  it("客户进了公海，其中一个项目先前已进项目公海：领客户时两个都归丙，项目公海里那个也出来", async () => {
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c);
    const p2 = await 项目(乙.id, c);
    await 放回公海(乙, p1);
    expect(await 在客户公海(c)).toBe(true);
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p1 } })).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).ownerId).toBe(丙.id);
  });

  it("单项目客户的项目超期：客户也进客户公海，丙领项目连客户一起领", async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, { createdAt: 天前(10, 今) });
    expect(await 公海超时收回(老板, 今)).toBe(1);
    expect(await 在客户公海(c)).toBe(true);
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await 在客户公海(c)).toBe(false);
  });

  it("多项目客户一个项目超期、名下还有没结束的订单：只收这一个项目，客户和订单留在乙名下", async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(乙.id);
    const 超期 = await 项目(乙.id, c, { createdAt: 天前(10, 今) });
    const 新的 = await 项目(乙.id, c, { createdAt: 天前(1, 今), phase: "订单", node: "生产备货" });
    expect(await 公海超时收回(老板, 今)).toBe(1);
    expect(await 项目在公海(超期)).toBe(true);
    expect(await 项目在公海(新的)).toBe(false);
    expect(await 在客户公海(c)).toBe(false);
    expect(await 负责人(c)).toBe(乙.id);
    expect(await 领取公海项目(丙, 超期)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(乙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 新的 } })).ownerId).toBe(乙.id);
  });

  it("订单阶段的项目超期也不收", async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3, 生产备货: 3 } } });
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, { createdAt: 天前(60, 今), phase: "订单", node: "生产备货" });
    expect(await 公海超时收回(老板, 今)).toBe(0);
    expect(await 项目在公海(p)).toBe(false);
  });
});

describe("多项目客户：项目随客户整体转让（10-27 会议定固定路线 2）", () => {
  const 选 = (走法: "项目可转让" | "客户可转让", 补: Record<string, unknown> = {}) =>
    setSetting("orgRules", { ...默认组织规则, ...补, 公海: { ...默认组织规则.公海, 多项目客户: 走法 } });

  it("没设过（默认）：放回一个项目，客户连同另一个项目一起进；领项目连客户带走", async () => {
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c);
    const p2 = await 项目(乙.id, c);
    await 放回公海(乙, p1);
    expect(await 在客户公海(c)).toBe(true);
    expect(await 领取公海项目(丙, p1)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).ownerId).toBe(丙.id);
  });

  it("库里存着旧的项目可转让：也按客户整体走，不再只转一个项目", async () => {
    await 选("项目可转让");
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c);
    const p2 = await 项目(乙.id, c);
    await 放回公海(乙, p1);
    expect(await 在客户公海(c)).toBe(true);
    expect(await 领取公海项目(丙, p1)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).ownerId).toBe(丙.id);
  });

  it("客户可转让：放回一个项目，客户也进客户公海（理由写清）；丙领这个项目，客户和另一个项目一起归丙", async () => {
    await 选("客户可转让");
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c);
    const p2 = await 项目(乙.id, c);
    expect(await 放回公海(乙, p1)).toEqual({ ok: true });
    expect(await prisma.customerPool.findUniqueOrThrow({ where: { customerId: c } })).toMatchObject({ userId: 乙.id, reason: 客户整体进公海理由 });
    // X-12（11-05）：同手动放进公海，乙名下别的线索 / 商机项目一起进项目公海
    expect(await 项目在公海(p2)).toBe(true);
    expect(await 领取公海项目(丙, p1)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await 在客户公海(c)).toBe(false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p1 } })).ownerId).toBe(丙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).ownerId).toBe(丙.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c, kind: "claim", toOwnerId: 丙.id } })).toBe(1);
  });

  it("超时回收也一样：多项目客户一个项目超期，客户跟着进客户公海", async () => {
    await 选("客户可转让", { 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(乙.id);
    const 超期 = await 项目(乙.id, c, { createdAt: 天前(10, 今) });
    await 项目(乙.id, c, { createdAt: 天前(1, 今) });
    expect(await 公海超时收回(老板, 今)).toBe(1);
    expect(await 项目在公海(超期)).toBe(true);
    expect(await prisma.customerPool.findUniqueOrThrow({ where: { customerId: c } })).toMatchObject({ userId: null, reason: 客户整体进公海理由 });
  });

  it("X-12 放回：乙名下别的线索、商机项目一起进项目公海，留痕记放回的人和原因、关乙在客户上的待办；结束了的、已在公海的、订单结束了的不动", async () => {
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c);
    const 商机 = await 项目(乙.id, c, { phase: "商机", node: "明确需求" });
    const 输了 = await 项目(乙.id, c, { result: "输单" });
    const 交付了 = await 项目(乙.id, c, { phase: "订单", node: "生产备货", result: "成功交付" });
    const 早进的 = await 项目(乙.id, c, { pooledAt: 天前(2, 今) });
    const 待办 = await prisma.task.create({ data: { title: "回访", customerId: c, ownerId: 乙.id } });
    expect(await 放回公海(乙, p1)).toEqual({ ok: true });
    const 商 = await prisma.project.findUniqueOrThrow({ where: { id: 商机 } });
    expect(商.pooledAt?.getTime()).toBe((await prisma.project.findUniqueOrThrow({ where: { id: p1 } })).pooledAt?.getTime());
    expect(商.ownerId).not.toBe(乙.id);
    expect(await prisma.projectNodeLog.findFirst({ where: { projectId: 商机, kind: "pool-release" } })).toMatchObject({ userId: 乙.id, fromOwnerId: 乙.id, toOwnerId: null, reason: 客户整体进公海理由 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 输了 } })).pooledAt).toBeNull();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 交付了 } })).pooledAt).toBeNull();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 早进的 } })).pooledAt?.getTime()).toBe(天前(2, 今).getTime());
    expect(await prisma.projectNodeLog.count({ where: { projectId: 早进的 } })).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 待办.id } })).doneAt).not.toBeNull();
    // 丙领客户：两个公海项目一起归丙
    当(丙);
    expect((await 领取([c])).ok).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 商机 } })).ownerId).toBe(丙.id);
  });

  it("X-12 超时回收：一个项目超期把客户带进公海，乙名下另一个没超期的项目一起进项目公海，留痕记系统；不给它另发收回提醒", async () => {
    await 选("客户可转让", { 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(乙.id);
    const 超期 = await 项目(乙.id, c, { createdAt: 天前(10, 今) });
    const 没超 = await 项目(乙.id, c, { createdAt: 天前(1, 今) });
    expect(await 公海超时收回(老板, 今)).toBe(1);
    expect(await 项目在公海(超期)).toBe(true);
    expect(await 项目在公海(没超)).toBe(true);
    expect(await prisma.projectNodeLog.findFirst({ where: { projectId: 没超, kind: "pool-release" } })).toMatchObject({ userId: 系统.id, fromOwnerId: 乙.id, reason: 客户整体进公海理由 });
    expect(await prisma.projectNodeLog.findFirst({ where: { projectId: 超期, kind: "pool-release" } })).toMatchObject({ reason: 超时理由 });
    expect(await prisma.task.count({ where: { customerId: c, ownerId: 乙.id, doneAt: null } })).toBe(1);
  });

  it("名下有没结束的订单阶段项目：客户不跟着进（订单不进公海），领项目也不带客户；订单结束了的不挡", async () => {
    await 选("客户可转让");
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    const 订单 = await 项目(乙.id, c, { phase: "订单", node: "生产备货" });
    await 放回公海(乙, p);
    expect(await 在客户公海(c)).toBe(false);
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
    expect(await 负责人(c)).toBe(乙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 订单 } })).ownerId).toBe(乙.id);

    const c2 = await 客户(乙.id);
    const q = await 项目(乙.id, c2);
    await 项目(乙.id, c2, { phase: "订单", node: "生产备货", result: "成功交付" });
    await 放回公海(乙, q);
    expect(await 在客户公海(c2)).toBe(true);
  });

  it("客户归别人、只是项目归乙：客户照样不进", async () => {
    await 选("客户可转让");
    const c = await 客户(丙.id);
    const p = await 项目(乙.id, c);
    await 项目(丙.id, c);
    await 放回公海(乙, p);
    expect(await 在客户公海(c)).toBe(false);
  });
});

describe("直接指定给某人：联系人、项目、沟通记录跟着客户换人", () => {
  it("老板把乙的客户批量分配给丙：丙带着自己的身份看得到联系人、项目、沟通记录，乙看不到了；沟通记录的记录人不改", async () => {
    await 开按组织看();
    const c = await 客户(乙.id);
    await prisma.contact.create({ data: { name: "张经理", customerId: c } });
    const 跟进 = await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "聊了报价", customerId: c, ownerId: 乙.id, occurredAt: 今 } });
    const p = await 项目(乙.id, c);
    当(老板);
    expect(await assignSalesOwner([c], 丙.id)).toMatchObject({ ok: true, updated: 1 });
    const 看 = (u: 人) => 以谁的身份(u.id, async () => [
      await prisma.customer.count({ where: { id: c } }),
      await prisma.contact.count({ where: { customerId: c } }),
      await prisma.followUp.count({ where: { customerId: c } }),
      await prisma.project.count({ where: { id: p } }),
    ]);
    expect(await 看(丙)).toEqual([1, 1, 1, 1]);
    expect(await 看(乙)).toEqual([0, 0, 0, 0]);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: 跟进.id } })).ownerId).toBe(乙.id);
    // 直接指定给某人不进公海（交接中、确认前看不到由交接那个 PR 管，规则「交接要确认」开着才走）
    expect(await 在客户公海(c)).toBe(false);
  });
});

describe("开关关着照旧", () => {
  beforeEach(() => { vi.stubEnv("CRM_ENTERPRISE", ""); });

  it("放回公海带的原因不看、不记（没有字典）", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p, "随便写的")).toEqual({ ok: true });
    expect((await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p, kind: "pool-release" } })).reason).toBeNull();
    expect(await prisma.entDictItem.count()).toBe(0);
  });

  it("单项目客户放回项目公海：客户不跟着进；领项目不带客户；领客户不带项目公海里的项目；放回的人不能自己领回", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p)).toEqual({ ok: true });
    expect(await 在客户公海(c)).toBe(false);
    expect(await 领取公海项目(乙, p)).toMatchObject({ ok: false, error: expect.stringContaining("不能自己领回") });

    当(乙);
    await 放进公海([c]);
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    // 项目公海里的项目还在项目公海
    expect(await 项目在公海(p)).toBe(true);
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });

    const c2 = await 客户(乙.id);
    const p2 = await 项目(乙.id, c2);
    当(乙);
    await 放进公海([c2]);
    await 放回公海(乙, p2);
    expect(await 领取公海项目(丙, p2)).toEqual({ ok: true });
    expect(await 负责人(c2)).toBe(乙.id);
    expect(await 在客户公海(c2)).toBe(true);
  });

  it("后台存着客户可转让也不起作用：多项目客户放回一个项目，客户不进公海", async () => {
    await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 多项目客户: "客户可转让" } });
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 项目(乙.id, c);
    expect(await 放回公海(乙, p)).toEqual({ ok: true });
    expect(await 在客户公海(c)).toBe(false);
  });

  it("原负责人领回客户公海里的客户：照旧能领（团队版本来没拦）", async () => {
    公海规则.原负责人能领回 = false;
    const c = await 客户(乙.id);
    当(乙);
    await 放进公海([c]);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
  });

  it("自动掉公海照旧扫全部（一个库多人）：只是包了一层看全部", async () => {
    const 乙的 = await 客户(乙.id, { lastFollowAt: 天前(40, 今) });
    const 丙的 = await 客户(丙.id, { lastFollowAt: 天前(40, 今) });
    expect(await 自动掉公海(乙, 今)).toBe(2);
    expect(await 在客户公海(乙的)).toBe(true);
    expect(await 在客户公海(丙的)).toBe(true);
    expect(await 自动掉公海(乙, 今)).toBe(0);
  });
});

describe("默认：线索公海的项目能单独领，客户不动（11-09，M-公海-02、M-公海-06）", () => {
  beforeEach(() => { Object.assign(公海规则, 原规则); });

  it("三个开关的默认值；放回项目客户留在原负责人名下；丙单独领走项目，客户负责人不变", async () => {
    expect(公海规则).toMatchObject({ 单项目客户跟着进公海: false, 领项目带走单项目客户: false, 项目能单独领: true });
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 项目在公海(p)).toBe(true);
    expect(await 在客户公海(c)).toBe(false);
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
    expect(await 负责人(c)).toBe(乙.id);
  });

  it("客户在客户公海里：项目不能单独领，也不能单独分（随整包，M-公海-06）；领客户项目一起过来", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    当(乙);
    expect(await 放进公海([c], "客户主动终止")).toMatchObject({ ok: true, 公海项目: [p] });
    expect(await 领取公海项目(丙, p)).toEqual({ ok: false, error: 客户在公海项目不单领提示 });
    当(老板);
    expect(await 分配公海项目([p], 丙.id)).toMatchObject({ ok: true, 分到: [], 没分到: [{ id: p, 原因: 客户在公海项目不单领提示 }] });
    expect(await 项目在公海(p)).toBe(true);
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(c)).toBe(丙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
  });
});

describe("开关：项目能单独领 = false（10-31 晚那条，11-09 起默认不再这样）", () => {
  beforeEach(() => { 公海规则.项目能单独领 = false; });

  it("丙从项目公海单独领被拒、项目留在公海；丙领客户，项目跟着一起过来", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 在客户公海(c)).toBe(true);
    expect(await 领取公海项目(丙, p)).toEqual({ ok: false, error: 项目不能单独领提示 });
    expect(await 项目在公海(p)).toBe(true);
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await 项目在公海(p)).toBe(false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
  });

  it("主管分配照样能把项目单独分出去（分配不算领）", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    当(经理);
    expect(await 分配公海项目([p], 丙.id)).toMatchObject({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
  });

  it("原负责人先看到「原负责人不能领回」（更具体的原因先说）", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 领取公海项目(乙, p)).toEqual({ ok: false, error: 原负责人不能领回提示 });
  });
});

describe("客户级放公海、占位负责人的原负责人（11-03 完成度 B1-4 / B4-3）", () => {
  it("名下有没结束的订单阶段项目：放不进客户公海；订单有了结局的照放（B1-4）", async () => {
    const 有单 = await 客户(乙.id);
    await 项目(乙.id, 有单, { phase: "订单" });
    const 结了 = await 客户(乙.id);
    await 项目(乙.id, 结了, { phase: "订单", result: "赢单" });
    当(乙);
    expect(await 放进公海([有单], "客户主动终止")).toEqual({ ok: false, error: expect.stringContaining("订单阶段") });
    expect(await 在客户公海(有单)).toBe(false);
    expect(await 放进公海([有单, 结了], "客户主动终止")).toMatchObject({ ok: true, updated: 1, 有订单: 1, 没权限: 0 });
    expect(await 在客户公海(结了)).toBe(true);
    expect(await 在客户公海(有单)).toBe(false);
  });

  it("客户挂在占位账号下、项目是乙放回的：乙领客户、领项目都报「原负责人不能领回」，丙照领（B4-3）", async () => {
    const u = await prisma.user.create({ data: { email: 无负责人占位邮箱, name: 无负责人占位名, title: "", role: "SALES", password: "x", active: false } });
    const c = await 客户(u.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    await prisma.customerPool.upsert({ where: { customerId: c }, update: {}, create: { customerId: c, userId: u.id, reason: "导入：原系统公海" } });
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: u.id } });
    忘掉企业版范围();
    当(乙);
    expect(await 以谁的身份(乙.id, () => 领取([c]))).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect(await 以谁的身份(乙.id, () => 领取公海项目(乙, p))).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect(await 在客户公海(c)).toBe(true);
    当(丙);
    expect(await 以谁的身份(丙.id, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(c)).toBe(丙.id);
  });
});
