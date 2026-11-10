/**
 * 企业版「原负责人退到公海后就看不到」（11-03 用户定）和「没设业务角色不能领公海」：
 *   - 原负责人：客户列表、客户详情、项目列表、项目详情、公海页、关键词分页、页签数都没有这位客户和项目；客户下面的沟通也跟着
 *   - 客户放进公海：客户和他的项目都回避；项目退回：只有项目回避，客户还归他（M-公海-02，11-09）
 *   - 认法：认最后一条 pool-release 的 fromOwnerId；旧数据客户 salesOwnerId 还留着他的也认（部署空档）
 *   - 同事照常看得到才能领；上级、总管理不受影响；上级自己是原负责人也回避
 *   - 新负责人领走：原负责人还是看不到（仍是组员看得到项目）；只认最后一次放回
 *   - 规则「按组织看客户」关着（别人都不限定）：照样回避
 *   - 没设业务角色：公海客户、公海项目、记跟进自动领都拦，账号 ADMIN 不算；别人分给 ta 也拦（11-03 完成度 C3-1：没业务角色不能当负责人）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 没业务角色不能领话, 只读角色话 } from "@/lib/enterprise/permissions";
import { 放回公海, 领取公海项目 } from "@/lib/project/db";
import { 读项目列表 } from "@/lib/project/list";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 客户页签数 } from "@/lib/pool-db";
import { 关键词分页 } from "@/app/(app)/customers/query";
import { 放进公海, 领取, 分配公海, 撤销公海, 退回原因选项 } from "@/app/(app)/customers/pool-actions";
import { 放回项目公海 } from "@/app/(app)/projects/actions";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { saveBusiness, getBusiness } from "@/lib/business";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 经理: 人;
let 乙: 人; // 经理的实线下属
let 丙: 人;
let 丁: 人; // 丙的上级看得到丙领走的
let 占位: string;

async function 造人(email: string, name: string, role: string, bizRole: string | null, managerId?: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  if (bizRole) await raw.entMember.create({ data: { userId: u.id, bizRole, managerId: managerId ?? null } });
  return { id: u.id, name, role };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 号 = () => `139${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
const 客户 = async (ownerId: string, name = "测试客户") => (await raw.customer.create({ data: { name, phone: 号(), salesOwnerId: ownerId } })).id;
const 项目 = async (ownerId: string, customerId: string, name = "一号项目") => (await raw.project.create({ data: { name, customerId, ownerId, creatorId: ownerId } })).id;
/** 导入来的：客户负责人是占位账号、项目 ownerId 空、原负责人只在 pool-release 留痕里 */
async function 导入的(原负责人: string, name = "导入客户") {
  const c = await 客户(占位, name);
  await raw.customerPool.create({ data: { customerId: c, userId: null, reason: "导入" } });
  const p = (await raw.project.create({ data: { name: `${name}项目`, customerId: c, ownerId: "", creatorId: 原负责人, pooledAt: new Date() } })).id;
  await raw.projectNodeLog.create({ data: { projectId: p, userId: 原负责人, kind: "pool-release", fromOwnerId: 原负责人, toPhase: "线索", toNode: "线索" } });
  忘掉企业版范围();
  return { c, p };
}

/** 这个人走所有读的入口看一遍 */
async function 看(u: 人, c: string, p: string) {
  当(u);
  return 以谁的身份(u.id, async () => {
    const 全部 = await prisma.customer.findMany({ select: { id: true } });
    const 公海页 = (await 读公海页(u, {}, 1, 100)).行;
    const 搜 = await prisma.customer.findUnique({ where: { id: c }, select: { name: true } });
    return {
      客户列表: 全部.some((x) => x.id === c),
      客户详情: !!(await prisma.customer.findUnique({ where: { id: c }, select: { id: true } })),
      项目列表: (await 读项目列表(u, {})).行.some((r) => r.id === p),
      项目公海: (await 读项目列表(u, { pool: "1" })).行.some((r) => r.id === p),
      项目详情: !!(await prisma.project.findUnique({ where: { id: p }, select: { id: true } })),
      公海页客户: 公海页.some((r) => r.种 === "客户" && r.customerId === c),
      // 客户跟着进了公海时合成一行（种 = 客户，projectId = 这个项目）；客户还归别人时单独一行
      公海页项目: 公海页.some((r) => r.projectId === p),
      搜索: 搜 ? (await 关键词分页({ keyword: 搜.name, pool: "1" }, 1, 50))?.ids.includes(c) ?? false : false,
    };
  });
}
const 都看不到 = { 客户列表: false, 客户详情: false, 项目列表: false, 项目公海: false, 项目详情: false, 公海页客户: false, 公海页项目: false, 搜索: false };

/** 列表条数 = 页签数：客户页两个页签，走 Prisma 老路数一遍对拍 */
async function 页签对得上(u: 人) {
  当(u);
  await 以谁的身份(u.id, async () => {
    const 签 = await 客户页签数();
    const 公海 = await prisma.customer.count({ where: { pool: { isNot: null } } });
    const 非公海 = await prisma.customer.count({ where: { pool: null } });
    expect({ 人: u.name, ...签 }).toEqual({ 人: u.name, 公海, 非公海 });
  });
}

/** 客户级放进公海（客户和他自己的项目一起进）。项目退回不带客户了（M-公海-02），要看「整位客户回避」走这个 */
async function 退客户(u: 人, c: string) {
  当(u);
  const r = await 以谁的身份(u.id, async () => 放进公海([c], (await 退回原因选项())[0]));
  expect(r).toMatchObject({ ok: true, updated: 1 });
  忘掉企业版范围();
}

const 开规则 = async () => {
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: JSON.stringify(true) }, create: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
  invalidateSettingsCache();
  忘掉企业版范围();
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  公海规则.项目能单独领 = true;
  老板 = await 造人("boss@x", "老板", "ADMIN", "director");
  经理 = await 造人("mgr@x", "经理", "MANAGER", "sales_mgr");
  乙 = await 造人("yi@x", "乙", "SALES", "sales", 经理.id);
  丁 = await 造人("ding@x", "丁", "MANAGER", "sales_mgr");
  丙 = await 造人("bing@x", "丙", "SALES", "sales", 丁.id);
  占位 = (await raw.user.create({ data: { email: "no-owner@placeholder.local", name: "无负责人", role: "SALES", password: "x", active: false } })).id;
  当(老板);
  await saveBusiness({ ...(await getBusiness()), projectMode: true });
  await 开规则();
});
afterEach(() => {
  vi.unstubAllEnvs();
  公海规则.项目能单独领 = false;
  忘掉企业版范围();
});

describe("原负责人退到公海后看不到", () => {
  it("退项目：客户不动（M-公海-02），原负责人看不到这个项目，客户和沟通还看得到；同事、上级、总管理能看到公海里的项目", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    const 沟通 = await raw.followUp.create({ data: { customerId: c, ownerId: 乙.id, type: "PHONE", title: "电话", content: "聊过", status: "已完成", occurredAt: new Date() } as never });
    当(乙);
    expect(await 以谁的身份(乙.id, () => 放回公海(乙, p))).toEqual({ ok: true });
    忘掉企业版范围();

    expect(await 看(乙, c, p)).toEqual({ 客户列表: true, 客户详情: true, 项目列表: false, 项目公海: false, 项目详情: false, 公海页客户: false, 公海页项目: false, 搜索: false });
    expect(await 以谁的身份(乙.id, () => prisma.followUp.findUnique({ where: { id: 沟通.id } }))).not.toBeNull();
    for (const u of [丙, 经理, 老板]) {
      expect(await 看(u, c, p), u.name).toMatchObject({ 项目公海: true, 项目详情: true, 公海页项目: true });
    }
  });

  it("退客户（项目一起进公海）：原负责人哪都看不到；同事、上级、总管理照常", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    const 沟通 = await raw.followUp.create({ data: { customerId: c, ownerId: 乙.id, type: "PHONE", title: "电话", content: "聊过", status: "已完成", occurredAt: new Date() } as never });
    await 退客户(乙, c);

    expect(await 看(乙, c, p)).toEqual(都看不到);
    expect(await 以谁的身份(乙.id, () => prisma.followUp.findUnique({ where: { id: 沟通.id } }))).toBeNull();

    for (const u of [丙, 经理, 老板]) {
      expect(await 看(u, c, p), u.name).toMatchObject({ 客户列表: true, 客户详情: true, 项目公海: true, 项目详情: true, 公海页客户: true, 公海页项目: true, 搜索: true });
    }
  });

  it("放回项目公海的 action 成功后不报错（放完自己就看不到了，留痕还要读项目名）", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, "能读到名字的项目");
    当(乙);
    // 客户不跟着进（M-公海-02）：action 不带 客户跟着
    expect(await 以谁的身份(乙.id, () => 放回项目公海(p))).toEqual({ ok: true });
    const 记 = await raw.auditLog.findFirst({ where: { entityId: p, action: "update" }, orderBy: { at: "desc" } });
    expect(记?.summary).toContain("能读到名字的项目");
    // action 里忘掉过范围：不用等 10 秒缓存
    expect(await 看(乙, c, p)).toMatchObject({ 客户详情: true, 项目列表: false, 项目公海: false, 项目详情: false, 公海页项目: false });
  });

  it("放回项目公海：客户归别人、没跟着进公海时不带 客户跟着（11-03 B4-2）", async () => {
    const c = await 客户(丙.id);
    const p = await 项目(乙.id, c, "客户归丙的项目");
    当(乙);
    expect(await 以谁的身份(乙.id, () => 放回项目公海(p))).toEqual({ ok: true });
    expect(await raw.customerPool.findUnique({ where: { customerId: c } })).toBeNull();
  });

  it("放进公海（客户级）：他还负责的项目也一起看不到；撤销（时限内）回来", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    当(乙);
    const r = await 以谁的身份(乙.id, async () => 放进公海([c], (await 退回原因选项())[0]));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(await 看(乙, c, p)).toEqual(都看不到);
    expect(await 看(丙, c, p)).toMatchObject({ 客户列表: true, 公海页客户: true });

    当(乙);
    // 他在跑的项目一起进了项目公海（P-公海-06），撤销照界面带上 公海项目 一起还回来
    const 撤 = await 以谁的身份(乙.id, () => 撤销公海("放进", [{ id: c, 值: 乙.id }], undefined, undefined, r.ok ? r.公海项目 : undefined));
    expect(撤).toMatchObject({ ok: true, updated: 1 });
    expect(await 看(乙, c, p)).toMatchObject({ 客户列表: true, 客户详情: true, 项目列表: true, 项目详情: true });
  });

  it("导入的（占位负责人、项目 ownerId 空）：按 pool-release 认原负责人", async () => {
    const { c, p } = await 导入的(乙.id);
    expect(await 看(乙, c, p)).toEqual(都看不到);
    for (const u of [丙, 经理, 老板]) {
      expect(await 看(u, c, p), u.name).toMatchObject({ 客户列表: true, 项目公海: true, 公海页客户: true, 公海页项目: true, 搜索: true });
    }
  });

  it("上级看下属退的照旧；上级自己退的自己也回避，他的上级不受影响", async () => {
    const c = await 客户(经理.id);
    const p = await 项目(经理.id, c);
    await 退客户(经理, c);
    expect(await 看(经理, c, p)).toEqual(都看不到);
    expect(await 看(老板, c, p)).toMatchObject({ 客户详情: true, 项目详情: true });
  });

  it("退项目、丙单独领走：丙和丙的上级看得到项目；客户还归乙，乙看得到客户、看不到项目", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    当(乙);
    await 以谁的身份(乙.id, () => 放回公海(乙, p));
    当(丙);
    expect(await 以谁的身份(丙.id, () => 领取公海项目(丙, p))).toEqual({ ok: true });
    忘掉企业版范围();
    expect(await 看(丙, c, p)).toMatchObject({ 项目详情: true });
    expect(await 看(丁, c, p)).toMatchObject({ 项目详情: true });
    expect(await 看(乙, c, p)).toMatchObject({ 客户详情: true, 项目详情: false });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(乙.id);
  });

  it("退客户、新负责人领走：丙和丙的上级看得到；乙看不到，乙的上级也按组织看不到", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 退客户(乙, c);
    当(丙);
    expect(await 以谁的身份(丙.id, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
    忘掉企业版范围();
    expect(await 看(丙, c, p)).toMatchObject({ 客户详情: true, 项目详情: true });
    expect(await 看(丁, c, p)).toMatchObject({ 客户详情: true, 项目详情: true });
    expect(await 看(乙, c, p)).toEqual(都看不到);
    expect(await 看(经理, c, p)).toMatchObject({ 客户详情: false, 项目详情: false });
  });

  it("仍是点了同意的组员：在公海时回避，领走后看得到项目和级联的客户（V3.5.1）", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await raw.projectMember.create({ data: { projectId: p, userId: 乙.id, inviteStatus: "JOINED" } as never });
    当(乙);
    await 以谁的身份(乙.id, () => 放回公海(乙, p));
    忘掉企业版范围();
    expect(await 看(乙, c, p)).toMatchObject({ 项目详情: false, 项目列表: false });
    当(丙);
    await 以谁的身份(丙.id, () => 领取公海项目(丙, p));
    忘掉企业版范围();
    expect(await 看(乙, c, p)).toMatchObject({ 项目详情: true, 客户详情: true });
  });

  it("只认最后一次放回：乙放、丙领、丙放，回避的是丙，乙又看得到能领", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    当(乙);
    await 以谁的身份(乙.id, () => 放回公海(乙, p));
    当(丙);
    await 以谁的身份(丙.id, () => 领取公海项目(丙, p));
    await 以谁的身份(丙.id, () => 放回公海(丙, p));
    忘掉企业版范围();
    expect(await 看(丙, c, p)).toEqual(都看不到);
    expect(await 看(乙, c, p)).toMatchObject({ 客户详情: true, 项目详情: true, 公海页项目: true });
  });

  it("写也挡：原负责人改不到退掉的客户和项目", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 退客户(乙, c);
    await 以谁的身份(乙.id, async () => {
      expect((await prisma.customer.updateMany({ where: { id: c }, data: { name: "改一下" } })).count).toBe(0);
      expect((await prisma.project.updateMany({ where: { id: p }, data: { name: "改一下" } })).count).toBe(0);
    });
  });

  it("原负责人直调领自己退的项目：说「原负责人不能领回」，不说被人领走了（11-03 B4-1）", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    当(乙);
    await 以谁的身份(乙.id, () => 放回公海(乙, p));
    const 导 = await 导入的(乙.id);
    忘掉企业版范围();
    for (const id of [p, 导.p]) {
      expect(await 以谁的身份(乙.id, () => 领取公海项目(乙, id))).toEqual({ ok: false, error: "原负责人不能领回" });
      expect((await raw.project.findUnique({ where: { id }, select: { pooledAt: true } }))?.pooledAt).not.toBeNull();
    }
  });

  it("没动过公海的客户、别人退的：不受影响；渠道负责人不算原负责人", async () => {
    const 自己的 = await 客户(乙.id, "自己的客户");
    const 自己的项目 = await 项目(乙.id, 自己的, "自己的项目");
    const 别人的 = await 客户(丙.id, "别人退的");
    const 别人的项目 = await 项目(丙.id, 别人的, "别人退的项目");
    await raw.customer.update({ where: { id: 别人的 }, data: { channelOwnerId: 乙.id } });
    await 退客户(丙, 别人的);
    expect(await 看(乙, 自己的, 自己的项目)).toMatchObject({ 客户详情: true, 项目详情: true });
    expect(await 看(乙, 别人的, 别人的项目)).toMatchObject({ 客户详情: true, 项目详情: true, 公海页客户: true });
  });

  it("页签数 = 列表条数：原负责人、同事、上级、总管理、没业务角色，软删的也对得上", async () => {
    const 无角色 = await 造人("none@x", "无角色", "SALES", null);
    const a = await 客户(乙.id, "乙退的");
    await 项目(乙.id, a);
    await 退客户(乙, a);
    await 导入的(乙.id, "导入甲");
    await 导入的(丙.id, "导入乙");
    await 客户(乙.id, "乙自己的");
    await 客户(丙.id, "丙自己的");
    const 删了 = await 导入的(乙.id, "进了回收站");
    await raw.customer.update({ where: { id: 删了.c }, data: { deletedAt: new Date() } });
    忘掉企业版范围();
    for (const u of [乙, 丙, 经理, 老板, 无角色]) await 页签对得上(u);
    当(乙);
    expect(await 以谁的身份(乙.id, () => 客户页签数())).toMatchObject({ 公海: 1, 非公海: 1 });
  });

  it("退得多（名单过上限）：不报参数超限，照样回避", async () => {
    const 们: { c: string; p: string }[] = [];
    for (let i = 0; i < 130; i++) 们.push(await 导入的(乙.id, `批量${i}`));
    忘掉企业版范围();
    当(乙);
    await 以谁的身份(乙.id, async () => {
      expect(await prisma.customer.count()).toBe(0);
      expect(await prisma.project.count()).toBe(0);
    });
    expect(await 看(乙, 们[0].c, 们[0].p)).toEqual(都看不到);
    await 页签对得上(乙);
    expect(await 看(丙, 们[0].c, 们[0].p)).toMatchObject({ 客户详情: true, 项目详情: true });
  });

  it("退得多（名单过上限）也只认最近一次：乙早先退过、后来丙领走又退的，乙看得到，丙回避（X-76，P-公海-04）", async () => {
    for (let i = 0; i < 130; i++) await 导入的(乙.id, `批量${i}`);
    // 项目级：乙退过，后来丙那一条更晚（领走再退）
    const 转手 = await 导入的(乙.id, "转手项目");
    await raw.projectNodeLog.create({ data: { projectId: 转手.p, userId: 丙.id, kind: "pool-release", fromOwnerId: 丙.id, toPhase: "线索", toNode: "线索", at: new Date(Date.now() + 60_000) } });
    // 客户级：乙放进公海、丙领走、丙再放进公海
    const c = await 客户(乙.id, "转手客户");
    const p = await 项目(乙.id, c);
    await 退客户(乙, c);
    当(丙);
    expect(await 以谁的身份(丙.id, () => 领取([c]))).toMatchObject({ ok: true, updated: 1 });
    await 退客户(丙, c);
    当(乙);
    const 避 = await 以谁的身份(乙.id, async () => (await import("@/lib/team-scope")).现在的公海回避(raw));
    expect(避).toMatchObject({ 客户: null, 项目: null });
    expect(await 看(乙, 转手.c, 转手.p)).toMatchObject({ 客户列表: true, 客户详情: true, 项目详情: true, 项目公海: true });
    expect(await 看(乙, c, p)).toMatchObject({ 客户列表: true, 客户详情: true, 项目详情: true, 项目公海: true });
    expect(await 看(丙, 转手.c, 转手.p)).toEqual(都看不到);
    expect(await 看(丙, c, p)).toEqual(都看不到);
    const 还避 = await 导入的(乙.id, "还是乙最后退的");
    expect(await 看(乙, 还避.c, 还避.p)).toEqual(都看不到);
    await 页签对得上(乙);
  });

  it("负责人是他的线索挂在回避客户上也不出；没挂客户的、别的客户上的照常", async () => {
    const c = await 客户(乙.id);
    await 项目(乙.id, c);
    const 别的 = await 客户(乙.id, "别的客户");
    const 挂回避 = await raw.lead.create({ data: { name: "挂回避", ownerId: 乙.id, customerId: c } });
    const 挂别的 = await raw.lead.create({ data: { name: "挂别的", ownerId: 乙.id, customerId: 别的 } });
    const 没挂 = await raw.lead.create({ data: { name: "没挂", ownerId: 乙.id } });
    const 乙看 = () => 以谁的身份(乙.id, () => prisma.lead.findMany({ select: { id: true } })).then((r) => r.map((x) => x.id));
    await 退客户(乙, c);
    当(乙);
    expect((await 乙看()).sort()).toEqual([挂别的.id, 没挂.id].sort());
    await raw.setting.deleteMany({ where: { key: 规则.按组织看客户.key } });
    invalidateSettingsCache();
    忘掉企业版范围();
    当(乙);
    expect(await 乙看()).not.toContain(挂回避.id);
  });

  it("没设业务角色的人也回避（他只看公海）", async () => {
    const 无角色 = await 造人("none2@x", "无角色二", "SALES", null);
    const { c, p } = await 导入的(无角色.id);
    const 别的 = await 导入的(乙.id, "别的导入");
    expect(await 看(无角色, c, p)).toMatchObject({ 客户详情: false, 项目详情: false, 公海页客户: false, 公海页项目: false });
    expect(await 看(无角色, 别的.c, 别的.p)).toMatchObject({ 客户详情: true, 项目详情: true });
  });
});

describe("规则「按组织看客户」关着", () => {
  beforeEach(async () => {
    await raw.setting.deleteMany({ where: { key: 规则.按组织看客户.key } });
    invalidateSettingsCache();
    忘掉企业版范围();
  });

  it("别人不限定、原负责人照样回避；页签数对得上；没退的客户不受影响", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    const 导 = await 导入的(乙.id);
    const 丙的 = await 客户(丙.id, "丙的客户");
    await 退客户(乙, c);
    expect(await 看(乙, c, p)).toEqual(都看不到);
    expect(await 看(乙, 导.c, 导.p)).toEqual(都看不到);
    当(乙);
    expect(await 以谁的身份(乙.id, () => prisma.customer.findUnique({ where: { id: 丙的 }, select: { id: true } }))).not.toBeNull();
    expect(await 看(丙, c, p)).toMatchObject({ 客户详情: true, 项目详情: true, 公海页客户: true });
    for (const u of [乙, 丙, 老板]) await 页签对得上(u);
  });
});

describe("没设业务角色不能领", () => {
  const 记 = (customerId: string) => saveFollowUp({ customerId, type: "PHONE", content: "聊了聊", status: "已完成", occurredAt: new Date().toISOString() } as never);

  it("领客户、领项目都拦，给一句清楚的话；账号 ADMIN / MANAGER 不算", async () => {
    const 账号管理 = await 造人("adm@x", "账号管理", "ADMIN", null);
    const 账号经理 = await 造人("mgr2@x", "账号经理", "MANAGER", null);
    for (const u of [账号管理, 账号经理]) {
      const { c, p } = await 导入的(乙.id, `给${u.name}`);
      当(u);
      expect(await 以谁的身份(u.id, () => 领取([c]))).toEqual({ ok: false, error: 没业务角色不能领话 });
      expect(await 以谁的身份(u.id, () => 领取公海项目(u, p))).toEqual({ ok: false, error: 没业务角色不能领话 });
      expect(await raw.customerPool.count({ where: { customerId: c } })).toBe(1);
      expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    }
  });

  it("只读管理员领客户、领项目：都回「管理员只能看」那句（11-03 B2-1）", async () => {
    公海规则.项目能单独领 = false;
    const 管理员 = await 造人("ro@x", "管理员", "SALES", "admin");
    const { c, p } = await 导入的(乙.id, "给管理员");
    当(管理员);
    expect(await 以谁的身份(管理员.id, () => 领取([c]))).toEqual({ ok: false, error: 只读角色话 });
    expect(await 以谁的身份(管理员.id, () => 领取公海项目(管理员, p))).toEqual({ ok: false, error: 只读角色话 });
    expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
  });

  it("记跟进顺手领：不领也不记，同一句话", async () => {
    const 无角色 = await 造人("none3@x", "无角色三", "SALES", null);
    const { c } = await 导入的(乙.id);
    当(无角色);
    expect(await 以谁的身份(无角色.id, () => 记(c))).toEqual({ ok: false, error: 没业务角色不能领话 });
    expect(await raw.followUp.count({ where: { customerId: c } })).toBe(0);
    expect(await raw.customerPool.count({ where: { customerId: c } })).toBe(1);
  });

  it("设了业务角色的给公海客户记跟进：顺手领过来，回包说领取了，跟进记上，公海行没了", async () => {
    const { c } = await 导入的(乙.id, "丙记跟进领");
    当(丙);
    expect(await 以谁的身份(丙.id, () => 记(c))).toMatchObject({ ok: true, 领取了: true });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(丙.id);
    expect(await raw.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect(await raw.followUp.count({ where: { customerId: c } })).toBe(1);
  });

  it("设了业务角色的正常领；别人分给没业务角色的也拦", async () => {
    const 无角色 = await 造人("none4@x", "无角色四", "SALES", null);
    const 甲 = await 导入的(乙.id, "丙来领");
    当(丙);
    expect(await 以谁的身份(丙.id, () => 领取([甲.c]))).toMatchObject({ ok: true, updated: 1 });
    const 乙的 = await 导入的(乙.id, "分给人");
    当(老板);
    expect(await 以谁的身份(老板.id, () => 分配公海([乙的.c], 无角色.id))).toMatchObject({ ok: false, error: expect.stringContaining("业务角色") });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: 乙的.c } })).salesOwnerId).not.toBe(无角色.id);
  });
});
