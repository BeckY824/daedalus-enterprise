/**
 * 11-18 复盘第 5 类「多个入口写同一件事，守门只装了一部分」补的漏网（扫源码的守门见 followup-write-guard / project-create-guard /
 * customer-owner-write-guard 三个用例），这里连库走一遍：
 *   - 沟通挂潜客培育：原来要挂的项目找不到时挂哪（在推的潜客培育 → 零项目补一个 → 别的不猜）
 *   - 导入撤回后恢复：沟通原来挂的项目不在了，改挂潜客培育（原来照样建回、不挂项目）
 *   - 导入建项目写合同状态「起草中」、分配方式按 M-导入-01
 *   - 导入改客户负责人：留换人记录，名下项目和待办跟着走；撤回只带回导入那一步带走的，接手人原本就有的不动
 *   - 编辑页、就地改换负责人：换人记录和改写在同一个事务里（带活那一段出错，负责人也不换）
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 炸: false }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
// 换人记录写到一半出错：看负责人有没有跟着回滚
vi.mock("@/lib/owner-log-db", async (原) => {
  const m = await 原<typeof import("@/lib/owner-log-db")>();
  return { ...m, 记换负责人: async (...a: Parameters<typeof m.记换负责人>) => { if (mocks.炸) throw new Error("记换负责人出错"); return m.记换负责人(...a); } };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 沟通挂潜客培育 } from "@/lib/project/nurture";
import { 第一个节点 } from "@/lib/project/nodes";
import { patchCustomer } from "@/app/(app)/customers/actions";
import { 试跑, 重新试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import { 撤回一批, 恢复一批, 带走对不上话 } from "@/lib/enterprise-import/revert";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

const 我 = { id: "tester-id", name: "测试员" };
let 甲 = "";
let 乙 = "";

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.炸 = false;
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  甲 = (await prisma.user.create({ data: { email: "a@x", name: "甲", title: "销售", role: "SALES", password: "x" } })).id;
  乙 = (await prisma.user.create({ data: { email: "b@x", name: "乙", title: "销售", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 我.id, bizRole: "director" }, { userId: 甲, bizRole: "sales" }, { userId: 乙, bizRole: "sales" }] });
});
afterEach(() => void vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

let 序 = 0;
const 建客户 = async (salesOwnerId: string) => (await prisma.customer.create({ data: { name: `示例客户${++序}`, phone: "", salesOwnerId } })).id;
const 建项目 = (customerId: string, ownerId: string, 多: object = {}) =>
  prisma.project.create({ data: { name: "示例项目", customerId, ownerId, creatorId: ownerId, phase: 第一个节点.phase, node: 第一个节点.node, ...多 } });

describe("沟通挂潜客培育（原来要挂的项目找不到时）", () => {
  it("名下一个项目都没有：补一个潜客培育（负责人 = 客户负责人，分配方式按谁建给谁）再挂", async () => {
    const c = await 建客户(甲);
    const r = await 沟通挂潜客培育(prisma, c, 我.id);
    expect(r).toMatchObject({ node: 第一个节点.node });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: r!.projectId } })).toMatchObject({
      customerId: c, ownerId: 甲, creatorId: 我.id, node: 第一个节点.node, contractStatus: "起草中", assignMode: "指定分配",
    });
  });

  it("有在推的潜客培育：挂它，不再建", async () => {
    const c = await 建客户(甲);
    const p = await 建项目(c, 甲);
    expect(await 沟通挂潜客培育(prisma, c, 我.id)).toEqual({ projectId: p.id, node: 第一个节点.node });
    expect(await prisma.project.count()).toBe(1);
  });

  it("名下有项目、却没有在推的潜客培育（已结束 / 在公海 / 推到后面了）：不猜，回 null、不建", async () => {
    const c = await 建客户(甲);
    await 建项目(c, 甲, { result: "线索流失" });
    await 建项目(c, 甲, { pooledAt: new Date() });
    await 建项目(c, 甲, { node: "需求确认" });
    expect(await 沟通挂潜客培育(prisma, c, 我.id)).toBeNull();
    expect(await prisma.project.count()).toBe(3);
  });

  it("客户在客户公海里：不挂、不建", async () => {
    const c = await 建客户(甲);
    await prisma.customerPool.create({ data: { customerId: c, userId: 我.id, reason: "测试" } });
    expect(await 沟通挂潜客培育(prisma, c, 我.id)).toBeNull();
    expect(await prisma.project.count()).toBe(0);
  });
});

describe("就地改负责人：换人记录和改写同一个事务", () => {
  it("正常换：留一条换人记录，名下项目跟着走", async () => {
    const c = await 建客户(甲);
    const p = await 建项目(c, 甲);
    expect(await patchCustomer(c, "salesOwnerId", 乙)).toMatchObject({ ok: true });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(乙);
    expect(await prisma.customerOwnerLog.findMany({ where: { customerId: c } })).toEqual([expect.objectContaining({ fromOwnerId: 甲, toOwnerId: 乙, kind: "assign", userId: 我.id })]);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(乙);
  });

  it("记换人那一步出错：负责人没换、项目没动（原来负责人已经换了，记录另开事务没写上）", async () => {
    const c = await 建客户(甲);
    const p = await 建项目(c, 甲);
    mocks.炸 = true;
    await expect(patchCustomer(c, "salesOwnerId", 乙)).rejects.toThrow("记换负责人出错");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(甲);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(甲);
    expect(await prisma.customerOwnerLog.count()).toBe(0);
  });
});

describe("导入", () => {
  const 表 = (名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 => ({ 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] });
  const 客户表 = (负责人: string) => 表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人"], [["C1", "示例导入客户", "13800009001", 负责人]]);
  const 商机表 = (行: string[][]) => 表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段", "备注"], 行);
  const 跟进表 = () => 表("跟进记录.xlsx", "followup", ["跟进ID", "客户ID", "商机ID", "跟进方式", "跟进内容", "跟进时间"], [["F1", "C1", "O1", "电话", "聊了方案", "2025-06-01 10:00"]]);
  async function 导(表们: 读出的表[], 默认负责人?: string) {
    const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
    if (默认负责人) await 重新试跑(批次Id, { 默认负责人Id: 默认负责人 }, 我.id);
    await 定这批业务线(批次Id, "外贸");
    expect(await 写一批(批次Id, 我)).toMatchObject({ 完了: true, 失败: 0 });
    return 批次Id;
  }

  it("商机行建成项目：合同状态落「起草中」；分配方式按原表那一行（含展会 / 自拓 = 个人自持，别的 = 自动分配）", async () => {
    await 导([客户表("甲"), 商机表([["O1", "C1", "展会认识的单子", "需求确认", ""], ["O2", "C1", "官网询盘", "需求确认", "老客户转介绍"]])], 甲);
    expect(await prisma.project.findFirstOrThrow({ where: { name: "展会认识的单子" } })).toMatchObject({ contractStatus: "起草中", assignMode: "个人自持" });
    expect(await prisma.project.findFirstOrThrow({ where: { name: "官网询盘" } })).toMatchObject({ contractStatus: "起草中", assignMode: "自动分配" });
  });

  it("再导一遍改了客户负责人：留换人记录，名下项目、待办跟着走", async () => {
    await 导([客户表("甲"), 商机表([["O1", "C1", "示例单子", "需求确认", ""]])], 甲);
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "示例导入客户" } });
    expect(c.salesOwnerId).toBe(甲);
    const 待办 = await prisma.task.create({ data: { title: "回个电话", customerId: c.id, ownerId: 甲 } });
    await 导([客户表("乙")]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(乙);
    expect(await prisma.customerOwnerLog.findMany({ where: { customerId: c.id } })).toEqual([expect.objectContaining({ fromOwnerId: 甲, toOwnerId: 乙, kind: "assign", userId: 我.id })]);
    expect((await prisma.project.findFirstOrThrow({ where: { customerId: c.id } })).ownerId).toBe(乙);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 待办.id } })).ownerId).toBe(乙);
  });

  it("撤回改负责人的那一批：只带回导入时带走的，接手人原本就有的项目、待办仍归接手人；换人记录删掉；恢复再带一次、再撤照样精确", async () => {
    await 导([客户表("甲"), 商机表([["O1", "C1", "甲的单子", "需求确认", ""]])], 甲);
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "示例导入客户" } });
    const 甲待办 = await prisma.task.create({ data: { title: "甲的待办", customerId: c.id, ownerId: 甲 } });
    const 乙项目 = await 建项目(c.id, 乙, { name: "乙原有的单子" });
    const 乙待办 = await prisma.task.create({ data: { title: "乙的待办", customerId: c.id, ownerId: 乙 } });
    const 二 = await 导([客户表("乙")]);
    const 甲项目 = await prisma.project.findFirstOrThrow({ where: { name: "甲的单子" } });
    expect(甲项目.ownerId).toBe(乙);
    const 行 = await prisma.entImportRow.findFirstOrThrow({ where: { batchId: 二, entity: "customer", kind: "update" } });
    expect(JSON.parse(JSON.parse(行.before!)["@换人带走"])).toMatchObject({ 从: 甲, 到: 乙, 带走: { 项目: [甲项目.id], 待办: [甲待办.id] } });

    const 查 = async () => ({
      客户: (await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId,
      甲项目: (await prisma.project.findUniqueOrThrow({ where: { id: 甲项目.id } })).ownerId,
      乙项目: (await prisma.project.findUniqueOrThrow({ where: { id: 乙项目.id } })).ownerId,
      甲待办: (await prisma.task.findUniqueOrThrow({ where: { id: 甲待办.id } })).ownerId,
      乙待办: (await prisma.task.findUniqueOrThrow({ where: { id: 乙待办.id } })).ownerId,
      记录: await prisma.customerOwnerLog.count({ where: { customerId: c.id } }),
    });
    await 撤回一批(二, 我);
    expect(await 查()).toEqual({ 客户: 甲, 甲项目: 甲, 乙项目: 乙, 甲待办: 甲, 乙待办: 乙, 记录: 0 });
    await 恢复一批(二, 我);
    expect(await 查()).toEqual({ 客户: 乙, 甲项目: 乙, 乙项目: 乙, 甲待办: 乙, 乙待办: 乙, 记录: 1 });
    await 撤回一批(二, 我);
    expect(await 查()).toEqual({ 客户: 甲, 甲项目: 甲, 乙项目: 乙, 甲待办: 甲, 乙待办: 乙, 记录: 0 });
  });

  it("撤回改负责人时，导入带过去的待办已经做完了：这一位整条不撤，原因写清", async () => {
    await 导([客户表("甲"), 商机表([["O1", "C1", "甲的单子", "需求确认", ""]])], 甲);
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "示例导入客户" } });
    const 甲待办 = await prisma.task.create({ data: { title: "甲的待办", customerId: c.id, ownerId: 甲 } });
    const 二 = await 导([客户表("乙")]);
    await prisma.task.update({ where: { id: 甲待办.id }, data: { done: true } });
    const r = await 撤回一批(二, 我);
    expect(r.留下).toEqual([expect.objectContaining({ 实体: "customer", 原因: 带走对不上话 })]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(乙);
    expect((await prisma.project.findFirstOrThrow({ where: { name: "甲的单子" } })).ownerId).toBe(乙);
  });

  it("撤回后恢复，沟通原来挂的项目已经不在了：改挂这位客户的潜客培育项目，不再建成不挂项目的沟通", async () => {
    const 批 = await 导([客户表("甲"), 商机表([["O1", "C1", "示例单子", "需求确认", ""]]), 跟进表()], 甲);
    await 撤回一批(批, 我);
    expect(await prisma.followUp.count()).toBe(0);
    // 项目那一行不恢复（当它已经没了）：只恢复客户和沟通
    await prisma.entTrash.deleteMany({ where: { batchId: 批, entity: "opportunity" } });
    await 恢复一批(批, 我);
    const f = await prisma.followUp.findFirstOrThrow({ include: { projectNode: true } });
    expect(f.projectNode).not.toBeNull();
    const p = await prisma.project.findUniqueOrThrow({ where: { id: f.projectNode!.projectId } });
    expect(p).toMatchObject({ customerId: f.customerId, node: 第一个节点.node, ownerId: 甲, assignMode: "指定分配" });
    expect(f.projectNode!.node).toBe(第一个节点.node);
  });
});
