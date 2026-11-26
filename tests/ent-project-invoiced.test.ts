/**
 * 项目「已开票」勾选（12-15 第三批 A 件，lib/project/invoiced.ts）：
 *   能勾 = 系统管理员 + 可标已开票名单（名单只限系统管理员和财务的人：职位含「财务」或部门链含「财务」，E-373 ② / E-375）；只读管理员、销售教练、只看某人的人在名单里也不给；
 *   看得到的项目都能勾（E-373 ①：别人名下、别的团队的也行），看不到的回「不在了」；日志写清谁勾的、负责人是谁，负责人打开项目看得到（E-373 ③）；
 *   取消 = 勾后 30 天内只有系统管理员，过了 30 天谁都不能改；勾 / 取消各一条操作日志（和改项目同一事务），进客户详情「历史变更」项目块。
 * 测试数据都是编的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null }, 视图中: false }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// 切换视图期间：写库那一道（team-scope 视图拦 → 视图写拦）照真实的抛 视图只读错误（code CRM_READONLY）；不在视图里照原样
vi.mock("@/lib/enterprise/view-as", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/view-as")>();
  return { ...m, 视图写拦: async (动作?: string) => { if (mocks.视图中) throw new m.视图只读错误(); return m.视图写拦(动作); } };
});
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 可标已开票键, 只看某人键 } from "@/lib/enterprise/org";
import { 勾已开票, 已开票撤回天数, 已开票拦合并, 不能标已开票话, 不再是财务话, 名单只限财务话, 已开票格of } from "@/lib/project/invoiced";
import { 能进开票名单, 财务的 } from "@/lib/enterprise/permissions";
import { 权限组织 } from "@/lib/enterprise/org";
import { 视图只读话 } from "@/lib/enterprise/view-as-words";
import feishuContacts from "./fixtures/ent-feishu-contacts.json";
import { 换联网, 连接键 } from "@/lib/enterprise-import/adapter";
import { 同步通讯录 } from "@/lib/enterprise/org-sync";
import { 假网, type 录制 } from "./helpers/ent-fake-net";
import { 勾项目已开票 } from "@/app/(app)/projects/actions";
import { 设可标已开票 } from "@/app/(app)/settings/org-actions";
import { 项目历史页, 历史变更摘要 } from "@/app/(app)/customers/[id]/history-data";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 管: 人, 销售: 人, 被指定: 人, 只读: 人, 教练: 人, 只看: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string, deptId: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line: null, deptId } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
const 读 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, select: { invoiced: true, invoicedById: true, invoicedAt: true } });
const 日志 = (id: string) => prisma.auditLog.findMany({ where: { entity: "Project", entityId: id, action: { in: ["invoice", "invoice-undo"] } }, orderBy: { at: "asc" } });
const 天 = 86_400_000;

let 项目id = "", 客户id = "", 应收组id = "";
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  // 财务的人 = 部门（或上级部门）名含「财务」：被指定 在「财务中心 → 应收组」下面，业务角色照旧是 sales（没有财务这个业务角色）
  const 财务中心 = await prisma.entDept.create({ data: { name: "编造财务中心" } });
  应收组id = (await prisma.entDept.create({ data: { name: "应收组", parentId: 财务中心.id } })).id;
  管 = await 造人("dir", "测试管", "ADMIN", "director");
  销售 = await 造人("s1", "测试销售甲", "SALES", "sales");
  被指定 = await 造人("s2", "测试财务乙", "SALES", "sales", 应收组id);
  只读 = await 造人("ad", "测试只读", "SALES", "admin");
  教练 = await 造人("co", "测试教练", "SALES", "coach");
  只看 = await 造人("w1", "测试只看", "SALES", "marketing_mgr");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(可标已开票键, [被指定.id, 只读.id, 教练.id, 只看.id]);
  await setSetting(只看某人键, { [只看.id]: 销售.id });
  const c = await prisma.customer.create({ data: { name: "编造客户一", phone: "13900000001", salesOwnerId: 被指定.id } });
  const p = await prisma.project.create({ data: { name: "编造项目一", customerId: c.id, ownerId: 被指定.id, creatorId: 被指定.id } });
  项目id = p.id; 客户id = c.id;
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { mocks.视图中 = false; vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("谁能勾", () => {
  it("系统管理员能勾：记谁、何时，同一事务写一条操作日志；再勾一次不变、不重记", async () => {
    expect(await 以(管, () => 勾项目已开票(项目id, true))).toEqual({ ok: true, 变了: true });
    const p = await 读(项目id);
    expect(p).toMatchObject({ invoiced: true, invoicedById: 管.id });
    expect(p.invoicedAt).toBeInstanceOf(Date);
    const 痕 = await 日志(项目id);
    expect(痕).toHaveLength(1);
    expect(痕[0]).toMatchObject({ action: "invoice", userId: 管.id, summary: "项目「编造项目一」标为已开票（负责人 测试财务乙）" });
    expect(JSON.parse(痕[0].detail!)).toMatchObject({ 已开票: true, 负责人: 被指定.id });
    expect(await 以(管, () => 勾项目已开票(项目id, true))).toEqual({ ok: true, 变了: false });
    expect(await 日志(项目id)).toHaveLength(1);
  });

  it("可标已开票名单里的人能勾；不在名单的销售（哪怕是负责人）勾不了，库里一格不动", async () => {
    // 负责人不在名单：先把名单换成只有别人
    await setSetting(可标已开票键, [销售.id]);
    invalidateSettingsCache();
    expect(await 以(被指定, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 不能标已开票话 });
    expect((await 读(项目id)).invoiced).toBe(false);
    expect(await 日志(项目id)).toHaveLength(0);
    await setSetting(可标已开票键, [被指定.id]);
    invalidateSettingsCache();
    expect(await 以(被指定, () => 勾项目已开票(项目id, true))).toEqual({ ok: true, 变了: true });
    expect((await 读(项目id)).invoicedById).toBe(被指定.id);
  });

  it("只读管理员、销售教练、设了只看某人的人：在名单里也勾不了", async () => {
    for (const u of [只读, 教练, 只看]) {
      const r = await 以(u, () => 勾项目已开票(项目id, true));
      expect(r.ok).toBe(false);
    }
    expect((await 读(项目id)).invoiced).toBe(false);
    expect(await 日志(项目id)).toHaveLength(0);
  });

  it("名单里的财务被设只看某人、改成只读角色：回原来那句「不能标」，不说「你已不是财务」", async () => {
    for (const u of [只读, 只看]) await prisma.user.update({ where: { id: u.id }, data: { title: "财务专员" } });
    忘掉企业版范围();
    const org = await 权限组织();
    for (const u of [只读, 只看]) {
      expect(财务的(org, u.id)).toBe(true);
      expect(await 以(u, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 不能标已开票话 });
    }
    expect((await 读(项目id)).invoiced).toBe(false);
  });

  it("飞书同步：上游职务「财务专员」改「销售」，职位跟着变，再勾就拦（E-375）", async () => {
    // 名单里的人在飞书是 ou-s1（zs@example.com），部门不在财务：只靠职位认
    const zs = await 造人("zs", "测试财务丙", "SALES", "sales");
    await prisma.user.update({ where: { id: zs.id }, data: { email: "zs@example.com" } });
    await setSetting(可标已开票键, [zs.id]);
    // 项目挂到他名下：看得到才勾得上
    await prisma.customer.update({ where: { id: 客户id }, data: { salesOwnerId: zs.id } });
    await prisma.project.update({ where: { id: 项目id }, data: { ownerId: zs.id } });
    await setSetting(连接键("feishu"), { appId: "cli_fake", appSecret: "fake-secret" });
    const 录 = (职务: string): 录制 => {
      const r = JSON.parse(JSON.stringify(feishuContacts)) as 录制;
      for (const 响应们 of Object.values(r.路由))
        for (const x of 响应们 as { body?: { data?: { items?: { open_id?: string; job_title?: string }[] } } }[])
          for (const it of x.body?.data?.items ?? []) if (it.open_id === "ou-s1") it.job_title = 职务;
      return r;
    };
    try {
      换联网(假网(录("财务专员")).网);
      expect((await 同步通讯录("feishu")).结果).toBe("成功");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: zs.id } })).title).toBe("财务专员");
      invalidateSettingsCache();
      忘掉企业版范围();
      expect(await 以(zs, () => 勾项目已开票(项目id, true))).toEqual({ ok: true, 变了: true });
      expect(await 以(管, () => 勾项目已开票(项目id, false))).toEqual({ ok: true, 变了: true });
      换联网(假网(录("销售")).网);
      await 同步通讯录("feishu");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: zs.id } })).title).toBe("销售");
      invalidateSettingsCache();
      忘掉企业版范围();
      expect(await 以(zs, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 不再是财务话 });
      expect((await 读(项目id)).invoiced).toBe(false);
    } finally {
      换联网(null);
    }
  });
});

describe("谁能取消（E-363 四②）", () => {
  it("勾后 30 天内：勾的人自己（被指定）撤不了，只有系统管理员能撤；撤回记 invoice-undo，带原来谁何时勾的", async () => {
    await 以(被指定, () => 勾项目已开票(项目id, true));
    expect(await 以(被指定, () => 勾项目已开票(项目id, false))).toMatchObject({ ok: false, error: `勾上 ${已开票撤回天数} 天内只有系统管理员能撤回` });
    expect((await 读(项目id)).invoiced).toBe(true);
    expect(await 以(管, () => 勾项目已开票(项目id, false))).toEqual({ ok: true, 变了: true });
    expect(await 读(项目id)).toEqual({ invoiced: false, invoicedById: null, invoicedAt: null });
    const 痕 = await 日志(项目id);
    expect(痕.map((x) => x.action)).toEqual(["invoice", "invoice-undo"]);
    expect(痕[1].summary).toContain("撤回已开票（负责人 测试财务乙；原来 测试财务乙");
    expect(JSON.parse(痕[1].detail!)).toMatchObject({ 已开票: false, 原勾的人: 被指定.id });
    // 撤了能再勾，重新起算
    expect(await 以(被指定, () => 勾项目已开票(项目id, true))).toEqual({ ok: true, 变了: true });
  });

  it("过了 30 天谁都不能改，系统管理员也不行；没记勾的时刻的按过期算", async () => {
    const 勾时 = new Date(Date.now() - (已开票撤回天数 + 1) * 天);
    await prisma.project.update({ where: { id: 项目id }, data: { invoiced: true, invoicedById: 被指定.id, invoicedAt: 勾时 } });
    expect(await 以(管, () => 勾项目已开票(项目id, false))).toMatchObject({ ok: false, error: `勾上已超过 ${已开票撤回天数} 天，谁都不能取消` });
    await prisma.project.update({ where: { id: 项目id }, data: { invoicedAt: null } });
    expect((await 以(管, () => 勾项目已开票(项目id, false))).ok).toBe(false);
    expect((await 读(项目id)).invoiced).toBe(true);
  });

  it("第 30 天整还在期限内（按传入的现在算）", async () => {
    const 勾时 = new Date("2026-12-01T10:00:00+08:00");
    await prisma.project.update({ where: { id: 项目id }, data: { invoiced: true, invoicedById: 被指定.id, invoicedAt: 勾时 } });
    const 刚好 = new Date(勾时.getTime() + 已开票撤回天数 * 天);
    expect(await 以(管, () => 勾已开票(管, 项目id, false, 刚好))).toEqual({ ok: true, 变了: true });
  });

  it("只读管理员取消也拦", async () => {
    await 以(管, () => 勾项目已开票(项目id, true));
    expect((await 以(只读, () => 勾项目已开票(项目id, false))).ok).toBe(false);
    expect((await 读(项目id)).invoiced).toBe(true);
  });
});

describe("名单设置", () => {
  it("只有系统管理员能改名单；只读管理员、教练、只看某人的人进不了名单", async () => {
    await setSetting(可标已开票键, null);
    invalidateSettingsCache();
    expect(await 以(销售, () => 设可标已开票([被指定.id]))).toMatchObject({ ok: false });
    expect(await 以(管, () => 设可标已开票([只读.id]))).toMatchObject({ ok: false, error: expect.stringContaining("不能标已开票") });
    expect(await 以(管, () => 设可标已开票([被指定.id]))).toEqual({ ok: true });
    expect(await prisma.setting.findUnique({ where: { key: 可标已开票键 } })).toMatchObject({ value: JSON.stringify([被指定.id]) });
    expect(await prisma.auditLog.count({ where: { entity: "Setting", entityId: 可标已开票键 } })).toBe(1);
  });

  it("名单里有已停用的人：照留不拦保存（不自动剔人）；新加已停用的人报错点名", async () => {
    await setSetting(可标已开票键, [被指定.id]);
    invalidateSettingsCache();
    await prisma.user.update({ where: { id: 被指定.id }, data: { active: false } });
    忘掉企业版范围();
    // 停用的人本来就在名单里：保存同一份名单、或再加别人，都不报错，他照留
    expect(await 以(管, () => 设可标已开票([被指定.id]))).toEqual({ ok: true });
    expect(await prisma.setting.findUnique({ where: { key: 可标已开票键 } })).toMatchObject({ value: JSON.stringify([被指定.id]) });
    // 不在名单里的停用的人加不进：点名
    expect(await 以(管, () => 设可标已开票([被指定.id, 只读.id]))).toMatchObject({ ok: false });
    const 名 = (await prisma.user.findUniqueOrThrow({ where: { id: 被指定.id }, select: { name: true } })).name;
    await setSetting(可标已开票键, null);
    invalidateSettingsCache();
    expect(await 以(管, () => 设可标已开票([被指定.id]))).toEqual({ ok: false, error: `${名} 已停用，不能加进名单，请先去掉再保存` });
    await prisma.user.update({ where: { id: 被指定.id }, data: { active: true } });
    忘掉企业版范围();
  });
});

describe("历史变更项目块", () => {
  it("勾、撤回各一行（标「开票」），摘要条数算进项目块", async () => {
    await 以(管, () => 勾项目已开票(项目id, true));
    await 以(管, () => 勾项目已开票(项目id, false));
    const 页 = await 项目历史页(项目id, (x) => x);
    const 开票 = 页.行们.flatMap((r) => (r.种 === "事件" ? [r.事件] : r.事件们)).filter((e) => e.标 === "开票");
    expect(开票.map((e) => e.文)).toEqual(["撤回已开票", "标为已开票"]);
    expect(开票[0].因[0]).toBe("负责人 测试财务乙");
    expect(开票[0].因[1]).toMatch(/^原来 测试管 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 勾的$/);
    expect(开票[1].因).toEqual(["负责人 测试财务乙"]);
    expect(开票[1].谁).toBe("测试管");
    const 摘 = await 历史变更摘要(客户id, [项目id]);
    expect(摘.项目).toBe(2);
  });
});

describe("项目合并拦话", () => {
  it("勾了回「已开票，不能合并」，没勾不拦", () => {
    expect(已开票拦合并({ name: "编造项目一", invoiced: true })).toEqual(["「编造项目一」已开票，不能合并"]);
    expect(已开票拦合并({ name: "编造项目一", invoiced: false })).toEqual([]);
  });
});

describe("并发、切换视图（#509 审查）", () => {
  it("两人同时勾：只有一下真改了，后一下回 变了:false，日志只一条", async () => {
    const rs = await Promise.all([
      以谁的身份(管.id, () => 勾已开票(管, 项目id, true)),
      以谁的身份(被指定.id, () => 勾已开票(被指定, 项目id, true)),
    ]);
    expect(rs.map((r) => (r.ok ? r.变了 : r.error)).sort()).toEqual([false, true]);
    expect((await 读(项目id)).invoiced).toBe(true);
    expect(await 日志(项目id)).toHaveLength(1);
  });

  it("切换视图期间点勾：回只读那句（底下是 CRM_READONLY），不抛 500，库不动、不记日志", async () => {
    mocks.视图中 = true;
    await expect(以(管, () => 勾已开票(管, 项目id, true))).rejects.toMatchObject({ code: "CRM_READONLY" });
    expect(await 以(管, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 视图只读话 });
    expect((await 读(项目id)).invoiced).toBe(false);
    expect(await 日志(项目id)).toHaveLength(0);
  });
});

describe("看得到就能勾（E-373 ①）、负责人看得到记录（E-373 ③）", () => {
  let 销售项目 = "";
  beforeEach(async () => {
    const c = await prisma.customer.create({ data: { name: "编造客户二", phone: "13900000002", salesOwnerId: 销售.id } });
    销售项目 = (await prisma.project.create({ data: { name: "编造项目二", customerId: c.id, ownerId: 销售.id, creatorId: 销售.id } })).id;
    忘掉企业版范围();
  });

  it("名单里的财务勾别的团队、看得到的项目（虚线下属的，只能看）：成功，日志写谁勾的、负责人是谁", async () => {
    await prisma.entMember.update({ where: { userId: 销售.id }, data: { dottedManagerId: 被指定.id } });
    忘掉企业版范围();
    // 读范围里有、写范围里没有：先钉住，免得测成别的
    expect(await 以(被指定, () => prisma.project.count({ where: { id: 销售项目 } }))).toBe(1);
    expect(await 以(被指定, () => prisma.project.updateMany({ where: { id: 销售项目 }, data: { invoiced: true } })).catch(() => ({ count: 0 }))).toEqual({ count: 0 });
    expect(await 以(被指定, () => 勾项目已开票(销售项目, true))).toEqual({ ok: true, 变了: true });
    expect(await 读(销售项目)).toMatchObject({ invoiced: true, invoicedById: 被指定.id });
    const 痕 = await 日志(销售项目);
    expect(痕).toHaveLength(1);
    expect(痕[0]).toMatchObject({ userId: 被指定.id, userName: "测试财务乙", summary: "项目「编造项目二」标为已开票（负责人 测试销售甲）" });
    expect(JSON.parse(痕[0].detail!)).toMatchObject({ 负责人: 销售.id });
    // 项目详情那一格：名单里的人看得到就能勾（不再按写范围灰）
    const 格 = await 以(被指定, async () => 已开票格of(被指定, await 权限组织(), { id: 销售项目, invoiced: false, invoicedAt: null }, null));
    expect(格.能勾).toBe(true);
  });

  it("看不到的项目：回「不在了」，库不动、不记日志（不露出有这个项目）", async () => {
    expect(await 以(被指定, () => prisma.project.count({ where: { id: 销售项目 } }))).toBe(0);
    expect(await 以(被指定, () => 勾项目已开票(销售项目, true))).toEqual({ ok: false, error: "这个项目已经不在了，刷新看看" });
    expect((await 读(销售项目)).invoiced).toBe(false);
    expect(await 日志(销售项目)).toHaveLength(0);
  });

  it("负责人打开自己的项目：「变更记录」里看得到别人勾的那条，写着谁勾的、负责人是谁；撤回也在", async () => {
    await prisma.entMember.update({ where: { userId: 销售.id }, data: { dottedManagerId: 被指定.id } });
    忘掉企业版范围();
    await 以(被指定, () => 勾项目已开票(销售项目, true));
    await 以(管, () => 勾项目已开票(销售项目, false));
    const 格 = await 以(销售, async () => 已开票格of(销售, await 权限组织(), { id: 销售项目, invoiced: false, invoicedAt: null }, null));
    expect(格.能勾).toBe(false);
    expect(格.记录?.map((r) => [r.谁, r.文, r.因[0]])).toEqual([["测试管", "撤回已开票", "负责人 测试销售甲"], ["测试财务乙", "标为已开票", "负责人 测试销售甲"]]);
    expect(格.记录![0].因[1]).toMatch(/^原来 测试财务乙 /);
    // 没勾过的项目不带记录
    const 空 = await 以(被指定, async () => 已开票格of(被指定, await 权限组织(), { id: 项目id, invoiced: false, invoicedAt: null }, null));
    expect(空.记录).toBeUndefined();
  });

  it("系统管理员同样看得到就能勾（别人名下的）", async () => {
    expect(await 以(管, () => 勾项目已开票(销售项目, true))).toEqual({ ok: true, 变了: true });
    expect((await 日志(销售项目))[0].summary).toBe("项目「编造项目二」标为已开票（负责人 测试销售甲）");
  });
});

describe("名单只限系统管理员和财务（E-373 ②）、能随时收回", () => {
  it("财务的 = 职位含「财务」或部门 / 上级部门名含「财务」；能进名单 = 系统管理员或财务的，只读三类不行", async () => {
    const org = await 权限组织();
    expect(财务的(org, 被指定.id)).toBe(true);
    expect(财务的(org, 销售.id)).toBe(false);
    expect(能进开票名单(被指定.id, org)).toBe(true);
    expect(能进开票名单(管.id, org)).toBe(true);
    expect(能进开票名单(销售.id, org)).toBe(false);
    // 财务部门的教练也不行（只读）
    await prisma.entMember.update({ where: { userId: 教练.id }, data: { deptId: 应收组id } });
    忘掉企业版范围();
    expect(能进开票名单(教练.id, await 权限组织())).toBe(false);
  });

  it("职位是财务、部门不在财务（E-375）：能进名单、能勾；职位改掉且不在财务部门 → 再勾拦", async () => {
    // 被指定调出财务部门，职位写「财务」：占一样就算
    await prisma.entMember.update({ where: { userId: 被指定.id }, data: { deptId: null } });
    await prisma.user.update({ where: { id: 被指定.id }, data: { title: " 财务 " } });
    // 销售写「财务主管」（含「财务」二字）也算；职位空着的以部门为准
    await prisma.user.update({ where: { id: 销售.id }, data: { title: "  财务主管" } });
    await setSetting(可标已开票键, null);
    invalidateSettingsCache();
    忘掉企业版范围();
    const org = await 权限组织();
    expect(财务的(org, 被指定.id)).toBe(true);
    expect(财务的(org, 销售.id)).toBe(true);
    expect(财务的(org, 教练.id)).toBe(false);
    expect(能进开票名单(被指定.id, org)).toBe(true);
    expect(await 以(管, () => 设可标已开票([被指定.id]))).toEqual({ ok: true });
    invalidateSettingsCache();
    忘掉企业版范围();
    expect(await 以(被指定, () => 勾项目已开票(项目id, true))).toEqual({ ok: true, 变了: true });
    expect(await 以(管, () => 勾项目已开票(项目id, false))).toEqual({ ok: true, 变了: true });
    // 职位改掉、部门也不在财务：再勾拦
    await prisma.user.update({ where: { id: 被指定.id }, data: { title: "销售" } });
    忘掉企业版范围();
    expect(能进开票名单(被指定.id, await 权限组织())).toBe(false);
    expect(await 以(被指定, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 不再是财务话 });
    expect((await 读(项目id)).invoiced).toBe(false);
  });

  it("名单里非财务、非系统管理员的人：设置时拒（明确的错），勾时拒（库里手塞进去的、后来调出财务的）", async () => {
    await setSetting(可标已开票键, null);
    invalidateSettingsCache();
    expect(await 以(管, () => 设可标已开票([销售.id]))).toEqual({ ok: false, error: `${名单只限财务话}，换一位` });
    // 绕过设置页直接进了名单：勾的时候按当下判，拦
    await setSetting(可标已开票键, [销售.id, 被指定.id]);
    invalidateSettingsCache();
    忘掉企业版范围();
    expect(await 以(销售, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 不再是财务话 });
    // 被指定调出财务部门：照样拦
    await prisma.entMember.update({ where: { userId: 被指定.id }, data: { deptId: null } });
    忘掉企业版范围();
    expect(await 以(被指定, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 不再是财务话 });
    expect((await 读(项目id)).invoiced).toBe(false);
    expect(await 日志(项目id)).toHaveLength(0);
    // 已在名单里的照留：系统管理员再存同一份名单不报错（设置页标「不能标，请去掉」）
    expect(await 以(管, () => 设可标已开票([销售.id]))).toEqual({ ok: true });
  });

  it("收回名单：他之前勾的照旧在项目和历史里，新勾被拒；收回本身记一条操作日志写清收回了谁", async () => {
    await setSetting(可标已开票键, [被指定.id]);
    invalidateSettingsCache();
    expect(await 以(被指定, () => 勾项目已开票(项目id, true))).toEqual({ ok: true, 变了: true });
    expect(await 以(管, () => 设可标已开票([]))).toEqual({ ok: true });
    const 名单痕 = () => prisma.auditLog.findMany({ where: { entity: "Setting", entityId: 可标已开票键 } });
    const 收 = (await 名单痕()).find((x) => x.summary === "改可标已开票名单：收回 测试财务乙（之前勾的不动）");
    expect(收).toBeTruthy();
    expect(JSON.parse(收!.detail!)).toMatchObject({ 名单: null, 收回: [被指定.id] });
    invalidateSettingsCache();
    忘掉企业版范围();
    expect(await 读(项目id)).toMatchObject({ invoiced: true, invoicedById: 被指定.id });
    expect(await 日志(项目id)).toHaveLength(1);
    const c = await prisma.customer.create({ data: { name: "编造客户三", phone: "13900000003", salesOwnerId: 被指定.id } });
    const 新 = await prisma.project.create({ data: { name: "编造项目三", customerId: c.id, ownerId: 被指定.id, creatorId: 被指定.id } });
    expect(await 以(被指定, () => 勾项目已开票(新.id, true))).toEqual({ ok: false, error: 不能标已开票话 });
    expect((await 读(新.id)).invoiced).toBe(false);
    // 加回来：日志写「加上」
    expect(await 以(管, () => 设可标已开票([被指定.id]))).toEqual({ ok: true });
    expect((await 名单痕()).map((x) => x.summary)).toContain("改可标已开票名单：加上 测试财务乙");
  });
});
