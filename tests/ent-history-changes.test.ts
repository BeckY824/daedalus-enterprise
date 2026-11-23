/**
 * 客户详情「历史变更」弹窗取数（customers/[id]/history-actions.ts、history-data.ts），真库、真组织架构：
 *   - 看不到的项目：名字、变更都不进服务端回包（不只是界面藏），只回个数；直接点名要也回「不存在或无权查看」；看不到的客户整个不给
 *   - 客户块：同号再次录入挂在看不到的项目上的不出；状态没变（自动、同一状态、没理由）的不记，同一状态但有理由的（继续持有这类）照记
 *   - 系统批量修正同一天同一批折一行；30 条一页往下翻不重不漏，翻完的条数和入口小方框上的数对得上
 *   - 三态关着不数、不出状态那一类
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 ent-customer-follow-feed-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-history-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 登录.user, getCurrentUser: async () => 登录.user }));

import { defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { 读客户历史, 读项目历史, 读项目历史们 } from "@/app/(app)/customers/[id]/history-actions";
import { 历史变更摘要, 客户页可看项目, 状态记不记 } from "@/app/(app)/customers/[id]/history-data";
import type { 历史行, 历史游标 } from "@/app/(app)/customers/[id]/history-types";

const 销售A = "hist_a", 销售B = "hist_b", 老板 = "hist_boss";
let 甲: string, A的项目: string, B的项目: string;
const 天 = (d: number, h = 2, m = 0) => new Date(Date.UTC(2026, 10, d, h, m));
const 以 = <T,>(id: string, role: string, fn: () => Promise<T>) => { 登录.user = { ...登录.user, id, name: id, role }; return 以谁的身份(id, fn); };
const A做 = <T,>(fn: () => Promise<T>) => 以(销售A, "SALES", fn);
const 老板做 = <T,>(fn: () => Promise<T>) => 以(老板, "ADMIN", fn);
const 事件们 = (行们: 历史行[]) => 行们.flatMap((r) => (r.种 === "事件" ? [r.事件] : r.事件们));
async function 三态(开: boolean) {
  await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开 } });
  invalidateSettingsCache();
}

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntCustomerStateLog", "EntCustomerClock", "CustomerOwnerLog", "EntLeadVerifyLog", "EntBlockerLog", "EntFollowUpMeta", "EntBlocker", "FollowUpProject", "ProjectMember", "ProjectContact", "ProjectCustomer", "ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.user.create({ data: { id: 老板, email: `${老板}@x.com`, name: 老板, password: "x", role: "ADMIN" } });
  await raw.entMember.createMany({ data: [{ userId: 销售A }, { userId: 销售B }, { userId: 老板, bizRole: "director" }] });
  甲 = (await raw.customer.create({ data: { name: "QA-甲", phone: "13800002401", salesOwnerId: 销售A, createdAt: 天(1) } })).id;
  await raw.customer.create({ data: { name: "QA-乙", phone: "13800002402", salesOwnerId: 销售B } });
  A的项目 = (await raw.project.create({ data: { name: "QA-A的项目", customerId: 甲, ownerId: 销售A, creatorId: 销售A, createdAt: 天(2) } })).id;
  B的项目 = (await raw.project.create({ data: { name: "QA-B私密项目", customerId: 甲, ownerId: 销售B, creatorId: 销售B, createdAt: 天(2) } })).id;
  await raw.projectNodeLog.createMany({ data: [
    { projectId: A的项目, userId: 销售A, at: 天(3), fromPhase: "线索", fromNode: "潜客培育", toPhase: "商机", toNode: "方案报价", reason: "A推进" },
    { projectId: B的项目, userId: 销售B, at: 天(3), fromPhase: "线索", fromNode: "潜客培育", toPhase: "商机", toNode: "方案报价", reason: "B私密理由" },
  ] });
  // 客户块：换负责人 1 条
  await raw.customerOwnerLog.create({ data: { customerId: 甲, userId: 老板, at: 天(4), fromOwnerId: 销售B, toOwnerId: 销售A, kind: "assign" } });
  // 状态：真变了 1 条、同一状态没理由的自动重算（不记）1 条、同一状态有理由（继续持有）1 条
  await raw.entCustomerStateLog.createMany({ data: [
    { customerId: 甲, fromState: "活跃", toState: "沉睡", via: "自动", at: 天(5) },
    { customerId: 甲, fromState: "沉睡", toState: "沉睡", via: "自动", reason: null, at: 天(5, 3) },
    { customerId: 甲, fromState: "沉睡", toState: "沉睡", via: "手动", reason: "继续持有", userId: 销售A, at: 天(5, 4) },
  ] });
  // 系统批量修正：同一天同一批 3 条 + 另一天同一批 1 条；人改的 32 条（凑够翻页）
  await raw.auditLog.createMany({ data: [
    ...[0, 1, 2].map((i) => ({ userId: "u", userName: "管理员", action: "update", entity: "Customer", entityId: 甲, at: 天(6, 2, i), summary: `[补写客户资料 NO.${100 + i}] 补第 ${i} 项` })),
    { userId: "u", userName: "管理员", action: "update", entity: "Customer", entityId: 甲, at: 天(7), summary: "[补写客户资料 NO.200] 补另一天" },
    ...Array.from({ length: 32 }, (_, i) => ({ userId: 销售A, userName: 销售A, action: "update", entity: "Customer", entityId: 甲, at: 天(10, 1, i), summary: `修改客户「QA-甲」：备注${i}`, detail: JSON.stringify([{ 字段: "备注", 原值: `旧${i}`, 新值: `新${i}` }]) })),
  ] });
  // 同号再次录入：一条挂客户、一条挂 B 的项目（A 看不到）
  const 同号 = async (projectId: string | null, at: Date, 记: string) => {
    const f = await raw.followUp.create({ data: { type: "OTHER", title: "同号再次录入", content: 记, customerId: 甲, ownerId: 销售A, occurredAt: at, createdAt: at } });
    if (projectId) await raw.followUpProject.create({ data: { followUpId: f.id, projectId, node: "同号再次录入" } });
  };
  await 同号(null, 天(8), "挂客户的同号");
  await 同号(B的项目, 天(9), "挂B项目的同号");
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  await setSetting("business", { projectMode: true });
  await 三态(true);
  忘掉企业版范围();
});
beforeEach(() => { process.env.CRM_ENTERPRISE = "1"; 忘掉企业版范围(); });
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

/** 把客户块翻到底：每页的事件（折起来的拆开）连起来 */
async function 翻完(做: <T>(fn: () => Promise<T>) => Promise<T>, 筛 = "全部") {
  const 页们: 历史行[][] = [];
  let 游: 历史游标 | null = null;
  for (let i = 0; i < 10; i++) {
    const r = await 做(() => 读客户历史(甲, 筛, 游));
    if (!r.ok) throw new Error(r.error);
    页们.push(r.行们);
    if (!r.更早) break;
    游 = r.更早;
  }
  return 页们;
}

describe("历史变更：看不到的项目不出名字也不出变更（服务端回包里就没有）", () => {
  it("销售 A：项目块只有自己的项目，B 的项目只回个数；回包里搜不到 B 项目的名字和理由", async () => {
    const 可看 = await A做(() => 客户页可看项目({ ...登录.user, id: 销售A }, 甲));
    expect(可看.map((p) => p.id)).toEqual([A的项目]);
    const r = await A做(() => 读项目历史们(甲, A的项目));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.项目们.map((p) => p.id)).toEqual([A的项目]);
    expect(r.看不到).toBe(1);
    expect(r.展开?.id).toBe(A的项目);
    expect(事件们(r.展开!.行们).map((e) => e.因.join("|") + e.文).join()).toContain("A推进");
    const 包 = JSON.stringify(r);
    expect(包).not.toContain("QA-B私密项目");
    expect(包).not.toContain("B私密理由");
    expect(包).not.toContain(B的项目);
    // 点名要 B 的项目（展开、单取）：不给
    const 点名展开 = await A做(() => 读项目历史们(甲, B的项目));
    expect(点名展开.ok && 点名展开.展开).toBeNull();
    const 单取 = await A做(() => 读项目历史(甲, B的项目));
    expect(单取).toEqual({ ok: false, error: "这个项目不存在或当前账号无权查看，请刷新确认" });
    expect(JSON.stringify(单取)).not.toContain("B私密");
  });

  it("老板看全部：两个项目都在、看不到 0；B 不能看甲这位客户，三个动作都回「不存在或无权查看」", async () => {
    const r = await 老板做(() => 读项目历史们(甲, null));
    expect(r.ok && r.项目们.map((p) => p.名).sort()).toEqual(["QA-A的项目", "QA-B私密项目"]);
    expect(r.ok && r.看不到).toBe(0);
    const B = <T,>(fn: () => Promise<T>) => 以(销售B, "SALES", fn);
    const 不在 = { ok: false, error: "这位客户不存在或当前账号无权查看，请刷新确认" };
    expect(await B(() => 读客户历史(甲, "全部", null))).toEqual(不在);
    expect(await B(() => 读项目历史们(甲, null))).toEqual(不在);
    expect(await B(() => 读项目历史(甲, B的项目))).toEqual(不在);
  });

  it("客户块：挂在看不到项目上的同号再次录入不出，挂客户的出；老板两条都看得到", async () => {
    const A的 = 事件们((await 翻完(A做, "同号录入")).flat());
    expect(A的.length).toBe(1);
    const 老板的 = 事件们((await 翻完(老板做, "同号录入")).flat());
    expect(老板的.length).toBe(2);
  });

  it("坏的筛选、坏的游标都拒", async () => {
    expect((await A做(() => 读客户历史(甲, "随便", null))).ok).toBe(false);
    expect((await A做(() => 读客户历史(甲, "全部", { at: "不是时间", id: "x" }))).ok).toBe(false);
  });
});

describe("历史变更：状态、批量折叠、翻页", () => {
  it("状态没变不记：自动 + 同一状态 + 没理由的那条不出；同一状态但手动有理由的（继续持有）照出", async () => {
    expect(状态记不记({ fromState: "沉睡", toState: "沉睡", via: "自动", reason: null })).toBe(false);
    expect(状态记不记({ fromState: "沉睡", toState: "沉睡", via: "自动", reason: "  " })).toBe(false);
    expect(状态记不记({ fromState: "沉睡", toState: "沉睡", via: "手动", reason: "继续持有" })).toBe(true);
    expect(状态记不记({ fromState: "沉睡", toState: "沉睡", via: "自动", reason: "暂缓回收" })).toBe(true);
    expect(状态记不记({ fromState: null, toState: "活跃", via: "自动", reason: null })).toBe(true);
    expect(状态记不记({ fromState: "活跃", toState: "沉睡", via: "自动", reason: null })).toBe(true);
    const 状态 = 事件们((await 翻完(A做, "状态")).flat());
    expect(状态.length).toBe(2);
    expect(状态.every((e) => e.标 === "状态")).toBe(true);
  });

  it("系统批量修正：同一天同一批 3 条折成一行，另一天的同一批另起一行；人改的 32 条一条一行", async () => {
    const 行们 = (await 翻完(A做, "资料修改")).flat();
    const 批 = 行们.filter((r): r is Extract<历史行, { 种: "批量" }> => r.种 === "批量");
    expect(批.map((b) => b.事件们.length).sort()).toEqual([1, 3]);
    expect(批.find((b) => b.事件们.length === 3)!.说明).toContain("补第");
    expect(行们.filter((r) => r.种 === "事件").length).toBe(32);
  });

  it("翻页：第一页 30 条原始记录、往下翻不重不漏；翻完的条数 = 入口小方框上的客户条数", async () => {
    const 页们 = await 翻完(A做);
    expect(页们.length).toBeGreaterThan(1);
    expect(事件们(页们[0]).length).toBe(30);
    const 全 = 事件们(页们.flat());
    expect(new Set(全.map((e) => e.id)).size).toBe(全.length);
    // 1 换负责人 + 2 状态 + 4 批量 + 32 人改 + 1 同号（B 项目上那条不算）= 40
    expect(全.length).toBe(40);
    // 时间倒序
    const at = 全.map((e) => +new Date(e.at));
    expect([...at].sort((a, b) => b - a)).toEqual(at);
    const 摘要 = await A做(() => 历史变更摘要(甲, [A的项目]));
    expect(摘要.客户).toBe(40);
    expect(摘要.项目).toBe(1);
    expect(摘要.状态).toBe(true);
    // 第一页带建档一格
    const 首 = await A做(() => 读客户历史(甲, "全部", null));
    expect(首.ok && 首.建档?.时间).toBeTruthy();
  });

  it("三态关着：摘要不数状态、状态那一类空", async () => {
    await 三态(false);
    try {
      const 摘要 = await A做(() => 历史变更摘要(甲, [A的项目]));
      expect(摘要).toMatchObject({ 客户: 38, 状态: false });
      expect(事件们((await 翻完(A做, "状态")).flat())).toEqual([]);
    } finally { await 三态(true); }
  });
});
