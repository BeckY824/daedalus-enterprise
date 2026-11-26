/**
 * 合并客户第二批 2b · 跨负责人合并申请数据层（lib/enterprise/merge-request.ts；客户 E-280 / E-331 一.1）：
 *   - 要谁同意按人去重：一人多个项目只出一次，列出他涉及的项目；发起人自己不算
 *   - 发起人：留下那家的负责人是销售才由他发；不是销售（渠运）时由直属上级或能接分配的销售发
 *   - 5 个工作日到期失效（跨周末）；到期那一刻点同意也失效；扫过期
 *   - 执行前只比四项：负责人、阶段、回款或提成、被判无效各自触发；节点、客户状态、名字变了不重判
 *   - 全同意后照第一批执行合并，申请经过和合并前快照进合并单、两家操作日志
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 撤回合并 } from "@/lib/enterprise/customer-merge";
import {
  算同意人, 发起人问题, 到期时刻, 比四项, 发起合并申请, 处理合并申请, 撤回合并申请, 扫过期合并申请, 到期话, 申请状态,
  type 快照,
} from "@/lib/enterprise/merge-request";
import type { 组织 } from "@/lib/enterprise/org";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 乙: 人, 丙: 人, 丁: 人, 渠运: 人, 销管: 人, 外贸销售: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string, 补: Record<string, unknown> = {}) {
  序++;
  return (await raw.customer.create({
    data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId, contacts: { create: { name: `联系人${序}`, phone: `1390001${String(序).padStart(4, "0")}`, isPrimary: true } }, ...补 },
  })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId || 老板.id, ...补 } })).id;
}
const 申请 = (id: string) => raw.entMergeRequest.findUniqueOrThrow({ where: { id }, include: { approvers: true } });
/** 2026-11-27 是周五；北京 15:00 = UTC 07:00 */
const 周五下午 = new Date("2026-11-27T07:00:00Z");

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  丁 = await 造人("ding", "丁", "SALES");
  渠运 = await 造人("qy", "渠运甲", "SALES");
  销管 = await 造人("xg", "销管甲", "SALES");
  外贸销售 = await 造人("wm", "外贸甲", "SALES");
  await raw.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }, { userId: 丁.id, bizRole: "sales" },
      { userId: 渠运.id, bizRole: "channel_ops", managerId: null }, { userId: 销管.id, bizRole: "sales_mgr" }, { userId: 外贸销售.id, bizRole: "sales", line: "外贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("要谁同意：按人去重", () => {
  it("纯函数：同一人是被并负责人又负责三个项目，只出一行、列三个项目；发起人和负责人空的不算", () => {
    const A = { id: "A", salesOwnerId: "我" }, B = { id: "B", salesOwnerId: "丙" };
    const 们 = 算同意人("我", A, B, [
      { id: "p1", name: "一", customerId: "B", ownerId: "丙" },
      { id: "p2", name: "二", customerId: "B", ownerId: "丙" },
      { id: "p3", name: "三", customerId: "A", ownerId: "丙" },
      { id: "p4", name: "四", customerId: "A", ownerId: "我" },
      { id: "p5", name: "五", customerId: "A", ownerId: "" },
      { id: "p6", name: "六", customerId: "B", ownerId: "丁" },
    ]);
    expect(们).toEqual([
      { userId: "丙", 凭: ["被并客户负责人", "项目负责人"], 项目: [{ id: "p1", name: "一", customerId: "B" }, { id: "p2", name: "二", customerId: "B" }, { id: "p3", name: "三", customerId: "A" }] },
      { userId: "丁", 凭: ["项目负责人"], 项目: [{ id: "p6", name: "六", customerId: "B" }] },
    ]);
  });

  it("发起后库里一人一行：结束了的、项目公海里的项目不算", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    await 项目(丙.id, b);
    await 项目(丙.id, b);
    await 项目(丙.id, a);
    await 项目(丁.id, b, { result: "丢单" });
    await 项目(丁.id, a, { pooledAt: new Date() });
    const r = await 发起合并申请(prisma, a, b, 乙, { 现在: 周五下午 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const 单 = await 申请(r.requestId);
    expect(单.approvers.map((x) => x.userId)).toEqual([丙.id]);
    expect(JSON.parse(单.approvers[0].projects)).toHaveLength(3);
    expect(JSON.parse(单.approvers[0].why)).toEqual(["被并客户负责人", "项目负责人"]);
  });

  it("两家和名下项目都是自己的：不用申请；同一家已有一张待同意的：再发拦住", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    expect(await 发起合并申请(prisma, a, b, 乙)).toMatchObject({ ok: false, error: expect.stringMatching(/直接合并即可/) });
    const c = await 客户(丙.id);
    expect((await 发起合并申请(prisma, a, c, 乙)).ok).toBe(true);
    expect(await 发起合并申请(prisma, b, c, 乙)).toMatchObject({ ok: false, error: expect.stringMatching(/已有一张合并申请在等同意/) });
  });
});

describe("谁发起", () => {
  it("纯函数：渠运负责人的直属上级不是销售（市场管理）也能发；别的市场管理不能", () => {
    const 员 = (userId: string, 角色: string, managerId: string | null = null) =>
      [userId, { userId, deptId: null, bizRole: 角色, 角色们: [角色], line: null, managerId, dottedManagerId: null, 不管设置: false }] as const;
    const org = { 成员: new Map([员("渠", "channel_ops", "市上"), 员("市上", "marketing_mgr"), 员("市别", "marketing_mgr"), 员("售", "sales")]), 部门: new Map() } as unknown as 组织;
    expect(发起人问题(org, { id: "市上" }, "渠", null)).toBeNull();
    expect(发起人问题(org, { id: "售" }, "渠", null)).toBeNull();
    expect(发起人问题(org, { id: "市别" }, "渠", null)).toMatch(/直属上级或能接分配的销售/);
    expect(发起人问题(org, { id: "渠" }, "渠", null)).toMatch(/不是销售/);
  });

  it("留下那家负责人是销售：只有他本人能发，别的销售不能", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    expect(await 发起合并申请(prisma, a, b, 丁)).toMatchObject({ ok: false, error: expect.stringMatching(/只有留下那家的客户负责人/) });
    expect((await 发起合并申请(prisma, a, b, 乙)).ok).toBe(true);
  });

  it("留下那家负责人是渠运：他本人不能发；他的直属上级、能接分配的销售能发，他本人要同意", async () => {
    await raw.entMember.update({ where: { userId: 渠运.id }, data: { managerId: 销管.id } });
    const a = await 客户(渠运.id, { bizLine: "内贸" });
    const b = await 客户(丙.id, { bizLine: "内贸" });
    expect(await 发起合并申请(prisma, a, b, 渠运)).toMatchObject({ ok: false, error: expect.stringMatching(/不是销售/) });
    // 业务线对不上的销售不算能接分配
    expect(await 发起合并申请(prisma, a, b, 外贸销售)).toMatchObject({ ok: false, error: expect.stringMatching(/直属上级或能接分配的销售/) });
    const r = await 发起合并申请(prisma, a, b, 销管);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.同意人.map((x) => [x.userId, x.凭])).toEqual([[渠运.id, ["留下客户负责人"]], [丙.id, ["被并客户负责人"]]]);
    await 撤回合并申请(prisma, r.requestId, 销管);
    expect((await 发起合并申请(prisma, a, b, 丁)).ok).toBe(true);
  });

  it("系统管理员不用申请；只有发起人能撤回申请", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    expect(await 发起合并申请(prisma, a, b, 老板)).toMatchObject({ ok: false, error: expect.stringMatching(/系统管理员不用发申请/) });
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 撤回合并申请(prisma, r.requestId, 丙)).toMatchObject({ ok: false });
    expect(await 撤回合并申请(prisma, r.requestId, 乙)).toEqual({ ok: true });
    expect((await 申请(r.requestId)).status).toBe(申请状态.已撤回);
  });
});

describe("5 个工作日到期", () => {
  it("纯函数：周五下午 → 下周五同一时刻；周六 → 下周五；北京周六凌晨（UTC 还是周五）按周六算", () => {
    expect(到期时刻(周五下午).toISOString()).toBe("2026-12-04T07:00:00.000Z");
    expect(到期时刻(new Date("2026-11-28T02:00:00Z")).toISOString()).toBe("2026-12-04T02:00:00.000Z");
    expect(到期时刻(new Date("2026-11-26T02:00:00Z")).toISOString()).toBe("2026-12-03T02:00:00.000Z");
    expect(到期时刻(new Date("2026-11-27T17:00:00Z")).toISOString()).toBe("2026-12-03T17:00:00.000Z");
  });

  it("跨周末：到期前一分钟能同意，到期那一刻同意就失效；扫过期也记失效", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    await 项目(丁.id, b);
    const r = await 发起合并申请(prisma, a, b, 乙, { 现在: 周五下午 });
    if (!r.ok) throw new Error(r.error);
    expect(r.expiresAt.toISOString()).toBe("2026-12-04T07:00:00.000Z");
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意", { 现在: new Date("2026-12-04T06:59:00Z") })).toMatchObject({ ok: true, 状态: 申请状态.待同意 });
    expect(await 处理合并申请(prisma, r.requestId, 丁, "同意", { 现在: new Date("2026-12-04T07:00:00Z") })).toEqual({ ok: false, error: 到期话 });
    expect(await 申请(r.requestId)).toMatchObject({ status: 申请状态.已失效, reason: 到期话 });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();

    const c = await 客户(丙.id);
    const r2 = await 发起合并申请(prisma, a, c, 乙, { 现在: 周五下午 });
    if (!r2.ok) throw new Error(r2.error);
    expect(await 扫过期合并申请(prisma, new Date("2026-12-04T06:00:00Z"))).toBe(0);
    expect(await 扫过期合并申请(prisma, new Date("2026-12-04T07:00:00Z"))).toBe(1);
    expect((await 申请(r2.requestId)).status).toBe(申请状态.已失效);
  });
});

describe("执行前只比四项", () => {
  const 底: 快照 = {
    客户: { A: { 名: "甲", 负责人: "我", 无效: false, 状态: "活跃" }, B: { 名: "乙", 负责人: "丙", 无效: false, 状态: "活跃" } },
    项目: { p: { 客户: "B", 名: "一", 负责人: "丙", 阶段: "线索", 节点: "潜客培育", 结局: null, 回款: "无", 回款键: "", 提成: "无", 提成键: "", 无效: false } },
  };
  const 改 = (f: (s: 快照) => void): 快照 => { const s = structuredClone(底); f(s); return s; };

  it("纯函数：四项各自触发", () => {
    expect(比四项(底, 改((s) => { s.客户.B.负责人 = "丁"; }))).toEqual(["负责人"]);
    expect(比四项(底, 改((s) => { s.项目.p.负责人 = "丁"; }))).toEqual(["负责人"]);
    expect(比四项(底, 底, true)).toEqual(["负责人"]);
    expect(比四项(底, 改((s) => { s.项目.p.阶段 = "商机"; }))).toEqual(["阶段"]);
    expect(比四项(底, 改((s) => { s.项目.p.结局 = "丢单"; }))).toEqual(["阶段"]);
    expect(比四项(底, 改((s) => { s.项目.p.回款键 = "x"; }))).toEqual(["回款或提成"]);
    expect(比四项(底, 改((s) => { s.项目.p.提成键 = "x"; }))).toEqual(["回款或提成"]);
    expect(比四项(底, 改((s) => { s.客户.A.无效 = true; }))).toEqual(["被判无效"]);
    expect(比四项(底, 改((s) => { s.项目.p.无效 = true; }))).toEqual(["被判无效"]);
  });

  it("纯函数：节点、客户状态、名字变了，新建了项目，都不重判", () => {
    expect(比四项(底, 改((s) => {
      s.项目.p.节点 = "需求确认"; s.项目.p.名 = "改名"; s.客户.A.状态 = "沉睡"; s.客户.B.名 = "改名";
      s.项目.q = { ...s.项目.p, 负责人: "我" };
    }))).toEqual([]);
  });

  async function 开一张() {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const p = await 项目(丙.id, b);
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    return { a, b, p, id: r.requestId };
  }

  it("记了一笔回款：同意时失效，写明是回款或提成变了", async () => {
    const { p, id } = await 开一张();
    await raw.entProjectPayment.create({ data: { projectId: p, paidAt: new Date(), currency: "CNY", amount: 100 } });
    expect(await 处理合并申请(prisma, id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/回款或提成有变/) });
    expect((await 申请(id)).status).toBe(申请状态.已失效);
  });

  it("项目判了无效 / 转了商机 / 换了负责人：各自失效", async () => {
    const 一 = await 开一张();
    await raw.entLeadVerify.create({ data: { projectId: 一.p, verdict: "无效线索", finalResult: "无效线索" } });
    expect(await 处理合并申请(prisma, 一.id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/被判无效有变/) });
    const 二 = await 开一张();
    await raw.project.update({ where: { id: 二.p }, data: { phase: "商机" } });
    expect(await 处理合并申请(prisma, 二.id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/阶段有变/) });
    const 三 = await 开一张();
    await raw.project.update({ where: { id: 三.p }, data: { ownerId: 丁.id } });
    expect(await 处理合并申请(prisma, 三.id, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/负责人有变/) });
  });

  it("只改了节点和备注：照常同意并执行", async () => {
    const { a, b, p, id } = await 开一张();
    await raw.project.update({ where: { id: p }, data: { node: "需求确认", remark: "改了备注" } });
    await raw.customer.update({ where: { id: a }, data: { remark: "改了备注" } });
    expect(await 处理合并申请(prisma, id, 丙, "同意")).toMatchObject({ ok: true, 状态: 申请状态.已合并 });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).not.toBeNull();
  });
});

describe("全同意后执行、留痕", () => {
  it("两位都同意才执行：项目负责人不变；合并单、两家操作日志写明发起人、同意人、时间和合并前回款 / 提成；照第一批能撤回", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const 丙的 = await 项目(丙.id, b);
    const 丁的 = await 项目(丁.id, a);
    await raw.entProjectPayment.create({ data: { projectId: 丙的, paidAt: new Date("2026-11-20T00:00:00Z"), currency: "CNY", amount: 500 } });
    await raw.entCommission.create({ data: { projectId: 丙的, basePrice: 300 } });
    const r = await 发起合并申请(prisma, a, b, 乙, { 现在: new Date("2026-11-26T02:00:00Z") });
    if (!r.ok) throw new Error(r.error);
    expect(await 处理合并申请(prisma, r.requestId, 乙, "同意")).toMatchObject({ ok: false, error: /不是这张合并申请要同意的人/ });
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意", { 现在: new Date("2026-11-26T03:00:00Z") })).toMatchObject({ ok: true, 状态: 申请状态.待同意 });
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意")).toMatchObject({ ok: false, error: /已经同意过了/ });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
    const 完 = await 处理合并申请(prisma, r.requestId, 丁, "同意", { 现在: new Date("2026-11-27T01:30:00Z") });
    expect(完).toMatchObject({ ok: true, 状态: 申请状态.已合并 });
    if (!完.ok) return;

    const 单 = await 申请(r.requestId);
    expect(单).toMatchObject({ status: 申请状态.已合并, mergeId: 完.mergeId });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 丙的 } })).toMatchObject({ customerId: a, ownerId: 丙.id });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 丁的 } })).toMatchObject({ customerId: a, ownerId: 丁.id });
    const 合并单 = await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 完.mergeId! } });
    expect(合并单.byUserId).toBe(乙.id);
    const 经过 = JSON.parse(合并单.approvals!);
    expect(经过).toMatchObject({ requestId: r.requestId, 发起: { userId: 乙.id } });
    expect(经过.同意人.map((x: { userId: string; at: string }) => [x.userId, x.at])).toEqual([[丙.id, "2026-11-26T03:00:00.000Z"], [丁.id, "2026-11-27T01:30:00.000Z"]]);
    expect(经过.合并前.项目[丙的]).toMatchObject({ 回款: "1 笔 CNY 500", 提成: "底价 300，未固定", 阶段: "线索" });

    for (const id of [a, b]) {
      const 记 = await raw.auditLog.findMany({ where: { entity: "Customer", entityId: id, action: { startsWith: "merge-" } }, orderBy: { at: "asc" } });
      expect(记.map((x) => x.action)).toEqual(["merge-request", "merge-approve", "merge-approve", "merge-request-done"]);
      expect(记[3].summary).toMatch(/乙 2026-11-26 10:00 发起；丙 2026-11-26 11:00 同意，丁 2026-11-27 09:30 同意/);
      expect(记[3].summary).toMatch(/回款 1 笔 CNY 500，提成 底价 300，未固定/);
    }
    // 撤回照第一批：合并人（发起人）能撤
    expect((await 撤回合并(prisma, 完.mergeId!, 乙)).ok).toBe(true);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
  });

  it("一位拒绝：整张已拒绝，不执行，写明谁拒绝、为什么", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 处理合并申请(prisma, r.requestId, 丙, "拒绝", { 原因: "不是同一家" })).toMatchObject({ ok: true, 状态: 申请状态.已拒绝 });
    expect(await 申请(r.requestId)).toMatchObject({ status: 申请状态.已拒绝, reason: "丙拒绝：不是同一家" });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
  });

  it("等同意期间被并那家标了无效客户：最后一位同意时判出来，申请失效、不执行", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    await raw.customer.update({ where: { id: b }, data: { poolInvalidAt: new Date() } });
    expect(await 处理合并申请(prisma, r.requestId, 丙, "同意")).toMatchObject({ ok: false, error: expect.stringMatching(/标了无效客户.*申请已失效/) });
    expect((await 申请(r.requestId)).status).toBe(申请状态.已失效);
  });
});
