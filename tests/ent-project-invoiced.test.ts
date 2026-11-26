/**
 * 项目「已开票」勾选（12-15 第三批 A 件，lib/project/invoiced.ts）：
 *   能勾 = 系统管理员 + 可标已开票名单；只读管理员、销售教练、只看某人的人在名单里也不给；
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
import { 勾已开票, 已开票撤回天数, 已开票拦合并, 不能标已开票话, 只能看勾不了话, 已开票格of } from "@/lib/project/invoiced";
import { 权限组织 } from "@/lib/enterprise/org";
import { 视图只读话 } from "@/lib/enterprise/view-as-words";
import { 勾项目已开票 } from "@/app/(app)/projects/actions";
import { 设可标已开票 } from "@/app/(app)/settings/org-actions";
import { 项目历史页, 历史变更摘要 } from "@/app/(app)/customers/[id]/history-data";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 管: 人, 销售: 人, 被指定: 人, 只读: 人, 教练: 人, 只看: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line: null } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
const 读 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, select: { invoiced: true, invoicedById: true, invoicedAt: true } });
const 日志 = (id: string) => prisma.auditLog.findMany({ where: { entity: "Project", entityId: id, action: { in: ["invoice", "invoice-undo"] } }, orderBy: { at: "asc" } });
const 天 = 86_400_000;

let 项目id = "", 客户id = "";
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  管 = await 造人("dir", "测试管", "ADMIN", "director");
  销售 = await 造人("s1", "测试销售甲", "SALES", "sales");
  被指定 = await 造人("s2", "测试销售乙", "SALES", "sales");
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
    expect(痕[0]).toMatchObject({ action: "invoice", userId: 管.id, summary: "项目「编造项目一」标为已开票" });
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
    expect(痕[1].summary).toContain("撤回已开票（原来 测试销售乙");
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
    expect(await 以(销售, () => 设可标已开票([被指定.id]))).toMatchObject({ ok: false });
    expect(await 以(管, () => 设可标已开票([只读.id]))).toMatchObject({ ok: false, error: expect.stringContaining("不能标已开票") });
    expect(await 以(管, () => 设可标已开票([被指定.id]))).toEqual({ ok: true });
    expect(await prisma.setting.findUnique({ where: { key: 可标已开票键 } })).toMatchObject({ value: JSON.stringify([被指定.id]) });
    expect(await prisma.auditLog.count({ where: { entity: "Setting", entityId: 可标已开票键 } })).toBe(1);
  });
});

describe("历史变更项目块", () => {
  it("勾、撤回各一行（标「开票」），摘要条数算进项目块", async () => {
    await 以(管, () => 勾项目已开票(项目id, true));
    await 以(管, () => 勾项目已开票(项目id, false));
    const 页 = await 项目历史页(项目id, (x) => x);
    const 开票 = 页.行们.flatMap((r) => (r.种 === "事件" ? [r.事件] : r.事件们)).filter((e) => e.标 === "开票");
    expect(开票.map((e) => e.文)).toEqual(["撤回已开票", "标为已开票"]);
    expect(开票[0].因[0]).toMatch(/^原来 测试管 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 勾的$/);
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

describe("能看不能写的项目、并发、切换视图（#509 审查）", () => {
  it("名单里的虚线上级：看得到虚线下属的项目但写不了——勾回只能看那句，库不动、不记日志；项目详情那一格灰着、悬停写同一句", async () => {
    const 虚线 = await 造人("dm", "测试虚线上级", "SALES", "sales_mgr");
    await prisma.entMember.update({ where: { userId: 被指定.id }, data: { dottedManagerId: 虚线.id } });
    await setSetting(可标已开票键, [虚线.id]);
    invalidateSettingsCache();
    忘掉企业版范围();
    // 读范围里有：先钉住「看得到」，免得测成「看不到」那种
    expect(await 以(虚线, () => prisma.project.count({ where: { id: 项目id } }))).toBe(1);
    expect(await 以(虚线, () => 勾项目已开票(项目id, true))).toEqual({ ok: false, error: 只能看勾不了话 });
    expect(await 读(项目id)).toEqual({ invoiced: false, invoicedById: null, invoicedAt: null });
    expect(await 日志(项目id)).toHaveLength(0);
    const 格 = await 以(虚线, async () => 已开票格of(虚线, await 权限组织(), { id: 项目id, invoiced: false, invoicedAt: null }, null));
    expect(格).toMatchObject({ 能勾: false, 不能勾因: 只能看勾不了话 });
    // 写得了的人那一格照旧能勾、不带原因
    const 自己 = await 以(管, async () => 已开票格of(管, await 权限组织(), { id: 项目id, invoiced: false, invoicedAt: null }, null));
    expect(自己).toEqual({ 勾了: false, 谁: null, 何时: null, 能勾: true, 取消不给: null });
  });

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
