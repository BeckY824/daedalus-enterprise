import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { assignSalesOwner, 撤销改负责人 } from "@/app/(app)/customers/actions";
import { 提异议 as 提异议动作 } from "@/app/(app)/objections/actions";
import { 提异议 as 提异议核, 我的异议 } from "@/lib/enterprise/objection";
import { 裁定, 待我裁定, 全部待裁定, 待手工退回们, 评估退回, 标记已手工退回 } from "@/lib/enterprise/objection-judge";
import { 客户有未裁定异议, 项目有未裁定异议 } from "@/lib/enterprise/objection-guard";
import { 裁定异议 } from "@/app/(app)/objections/actions";
import { 裁定说明上限 } from "@/lib/enterprise/objection-core";

type 人 = { id: string; role: string; name: string };
let 老板: 人, 副管: 人, 线总管: 人, 组长: 人, 销售: 人, 接手: 人, 同事: 人, 同事二: 人;
let 号 = 0;
const 日 = 86_400_000;

async function 建(email: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: `名${email}`, title: "", role, password: "x" } });
  return { id: u.id, role, name: u.name };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.name }; };
const 客户 = (salesOwnerId: string, extra: Record<string, unknown> = {}) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进", ...extra } });
const 项目 = (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: `项目${++号}`, customerId, ownerId, creatorId: ownerId, phase: "线索", ...extra } });
const 通知们 = (userId: string) => prisma.entNotice.findMany({ where: { userId } });
const 行们 = () => prisma.entTransferObjection.findMany({ orderBy: { createdAt: "asc" } });

async function beforeEachSetup() {
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  副管 = await 建("boss2", "ADMIN");
  线总管 = await 建("linedir", "MANAGER");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales");
  接手 = await 建("taker");
  同事 = await 建("peer");
  同事二 = await 建("peer2");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 副管.id, bizRole: "director" },
      { userId: 线总管.id, bizRole: "director", line: "内贸" },
      { userId: 组长.id, bizRole: "sales_mgr", line: "内贸" },
      ...[销售, 接手, 同事, 同事二].map((u) => ({ userId: u.id, managerId: 组长.id, bizRole: "sales", line: "内贸" })),
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting("enterprise.rule.handover_confirm", false);
}
beforeEach(async () => { await resetDb(); await beforeEachSetup(); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });


/**
 * 12-22 第 2 阶段 B 段：裁定、撤回、撤回边界、通知、未裁定拦再转并（判定页 #19 #20，E-414）。
 * 人名、客户名、项目名都是编造的。
 */

/** 组长把销售的客户转给接手人：销售自己有一个项目随客户走，同事在推两个，勾转其中一个（同事） */
async function 转一单() {
  const a = await 客户(销售.id, { bizLine: "内贸" });
  const 自己的 = await 项目(a.id, 销售.id);
  const 转的 = await 项目(a.id, 同事.id);
  当(组长);
  const r = await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回", 随转: [转的.id] });
  expect(r).toMatchObject({ ok: true, updated: 1 });
  const 行们 = await prisma.entTransferObjection.findMany();
  return { a, 自己的, 转的, 项目行: 行们.find((x) => x.kind === "项目")!, 客户行: 行们.find((x) => x.kind === "客户")! };
}
const 提 = async (行: { id: string }, 谁: 人) => { 当(谁); const r = await 提异议核(谁, 行.id, "这单我在跟"); expect(r.ok).toBe(true); };
const 项目现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

describe("待我裁定 + 裁定的规矩", () => {
  it("只有裁定人看得到、裁得了；说明必填 ≤200；决定无默认；裁完不能再裁", async () => {
    const { 项目行 } = await 转一单();
    await 提(项目行, 同事);
    expect((await 待我裁定(线总管.id)).map((x) => x.id)).toEqual([项目行.id]);
    expect(await 待我裁定(老板.id)).toHaveLength(0);
    expect(await 待我裁定(同事.id)).toHaveLength(0);
    const 行 = (await 待我裁定(线总管.id))[0];
    expect(行).toMatchObject({ 类别: "项目", 异议人: 同事.name, 理由: "这单我在跟", 转让原因: "客户说连着两周没人回", 发起人: 组长.name, 接手人: 接手.name, 能自动退: true });
    // 不是裁定人：当没有
    expect(await 裁定(组长, 项目行.id, "维持", "x")).toMatchObject({ ok: false, error: expect.stringContaining("没找到") });
    expect(await 裁定(同事, 项目行.id, "撤回", "x")).toMatchObject({ ok: false });
    // 说明必填 / 超长 / 决定无默认
    expect(await 裁定(线总管, 项目行.id, "维持", "   ")).toMatchObject({ ok: false, error: expect.stringContaining("说明") });
    expect(await 裁定(线总管, 项目行.id, "维持", "字".repeat(裁定说明上限 + 1))).toMatchObject({ ok: false });
    expect(await 裁定(线总管, 项目行.id, "", "有说明")).toMatchObject({ ok: false, error: expect.stringContaining("维持或撤回") });
    expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 项目行.id } })).status).toBe("待裁定");
    // 经 server action 裁（requireUser 是替身）
    当(线总管);
    expect(await 裁定异议(项目行.id, "维持", "原转让合理")).toMatchObject({ ok: true });
    expect(await 裁定(线总管, 项目行.id, "撤回", "再来一次")).toMatchObject({ ok: false, error: expect.stringContaining("已经裁定") });
  });

  it("维持：什么都不动，写 judgeNote / judgedAt / judgedById 和客户变更历史，通知异议人、发起人", async () => {
    const { a, 转的, 项目行 } = await 转一单();
    await 提(项目行, 同事);
    expect(await 裁定(线总管, 项目行.id, "维持", "客户指定新负责人")).toMatchObject({ ok: true, 结果: "维持" });
    const 新 = await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 项目行.id } });
    expect(新).toMatchObject({ status: "维持", judgeNote: "客户指定新负责人", judgedById: 线总管.id });
    expect(新.judgedAt).not.toBeNull();
    expect((await 项目现(转的.id)).ownerId).toBe(接手.id);
    const 审 = await prisma.auditLog.findMany({ where: { entity: "Customer", entityId: a.id, action: "update" } });
    expect(审).toHaveLength(1);
    expect(审[0].summary).toContain("客户指定新负责人");
    expect((await 通知们(同事.id)).filter((n) => n.title.includes("已裁定：维持"))).toHaveLength(1);
    expect((await 通知们(组长.id)).filter((n) => n.title.includes("已裁定：维持"))).toHaveLength(1);
    expect((await 通知们(接手.id)).filter((n) => n.title.includes("已裁定"))).toHaveLength(0);
    expect((await 我的异议(同事.id)).已提[0]).toMatchObject({ 状态: "维持", 裁定说明: "客户指定新负责人" });
  });
});

describe("撤回 = 退回原负责人", () => {
  it("项目异议：项目回同事，待办跟着回，转让痕以「手动转让 / 待办」开头（新线索验证钟从头）；通知四方；接手人期间的跟进留在项目上", async () => {
    const { a, 转的, 项目行 } = await 转一单();
    const 跟进 = await prisma.followUp.create({ data: { customerId: a.id, ownerId: 接手.id, title: "接手人期间的跟进", content: "接手人期间的跟进", type: "电话" } as never }).catch(() => null);
    if (跟进) await prisma.followUpProject.create({ data: { followUpId: 跟进.id, projectId: 转的.id, node: "潜客培育" } });
    const 待办 = await prisma.task.create({ data: { customerId: a.id, ownerId: 接手.id, title: `回访「${(await 项目现(转的.id)).name}」`, dueAt: new Date(Date.now() + 日) } as never }).catch(() => null);
    await 提(项目行, 同事);
    expect(await 裁定(线总管, 项目行.id, "撤回", "确实是同事在跟")).toMatchObject({ ok: true, 结果: "撤回" });
    expect((await 项目现(转的.id)).ownerId).toBe(同事.id);
    const 痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: 转的.id, kind: "transfer", toOwnerId: 同事.id } });
    expect(痕).toMatchObject({ fromOwnerId: 接手.id, userId: 线总管.id });
    expect(/^(手动转让|原负责人没做完的待办)/.test(痕.reason ?? "")).toBe(true);
    expect(痕.reason).toContain("确实是同事在跟");
    if (跟进) expect(await prisma.followUpProject.count({ where: { followUpId: 跟进.id, projectId: 转的.id } })).toBe(1);
    if (待办) expect((await prisma.task.findUniqueOrThrow({ where: { id: 待办.id } })).ownerId).toBe(同事.id);
    expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 项目行.id } })).status).toBe("撤回");
    expect((await 通知们(同事.id)).filter((n) => n.title.includes("已退回给你") || n.title.includes("退回给你"))).toHaveLength(1);
    expect((await 通知们(组长.id)).filter((n) => n.title.includes("已撤回"))).toHaveLength(1);
    expect((await 通知们(接手.id)).filter((n) => n.title.includes("不再归你"))).toHaveLength(1);
    // 客户现负责人（接手人）同一人只收一次不重复报；这里客户负责人就是接手人，已在上一行
  });

  it("客户异议：客户连同当次随转的项目一起退；同事的在推项目不在这一条里；换负责人记录写「撤销」+ 原因", async () => {
    const { a, 自己的, 转的, 客户行 } = await 转一单();
    expect((await 项目现(自己的.id)).ownerId).toBe(接手.id);
    await 提(客户行, 销售);
    const 评 = await 评估退回(prisma, 客户行);
    expect(评).toMatchObject({ 自动: true, 还给: 销售.id });
    if (评.自动) expect(评.项目.map((p) => p.id)).toEqual([自己的.id]);
    expect(await 裁定(线总管, 客户行.id, "撤回", "客户一直是我的")).toMatchObject({ ok: true, 结果: "撤回" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).salesOwnerId).toBe(销售.id);
    expect((await 项目现(自己的.id)).ownerId).toBe(销售.id);
    expect((await 项目现(转的.id)).ownerId).toBe(接手.id);
    const 记 = await prisma.customerOwnerLog.findFirstOrThrow({ where: { customerId: a.id, kind: "undo" } });
    expect(记).toMatchObject({ fromOwnerId: 接手.id, toOwnerId: 销售.id, userId: 线总管.id });
    expect(记.reason).toContain("客户一直是我的");
    expect((await 通知们(接手.id)).filter((n) => n.title.includes("不再归你"))).toHaveLength(1);
    expect((await 通知们(销售.id)).filter((n) => n.title.includes("退回给你"))).toHaveLength(1);
  });

  it("客户异议（审查 M4）：转让带走的客户级未完成计划、待办一并退回原负责人；已完成的不动；接手人转让后自己新建的不动", async () => {
    const a = await 客户(销售.id, { bizLine: "内贸" });
    await 项目(a.id, 销售.id);
    const 计划 = (ownerId: string, done = false) => prisma.followPlan.create({ data: { customerId: a.id, ownerId, subject: "回访", plannedAt: new Date(Date.now() + 日), done } });
    const 待办 = (ownerId: string, done = false) => prisma.task.create({ data: { customerId: a.id, ownerId, title: "寄样", dueAt: new Date(Date.now() + 日), done } });
    const 带计划 = await 计划(销售.id), 带待办 = await 待办(销售.id);
    const 完计划 = await 计划(销售.id, true), 完待办 = await 待办(销售.id, true);
    当(组长);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回", 随转: [] })).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: 带计划.id } })).ownerId).toBe(接手.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 带待办.id } })).ownerId).toBe(接手.id);
    await new Promise((r) => setTimeout(r, 20));
    const 新计划 = await 计划(接手.id), 新待办 = await 待办(接手.id);
    const 客户行 = (await prisma.entTransferObjection.findMany()).find((x) => x.kind === "客户")!;
    await 提(客户行, 销售);
    expect(await 裁定(线总管, 客户行.id, "撤回", "客户一直是我的")).toMatchObject({ ok: true, 结果: "撤回", 说: expect.stringContaining("1 条计划、1 条待办") });
    const 主 = async (id: string, t: "followPlan" | "task") => ((await (prisma[t] as never as { findUniqueOrThrow: (x: unknown) => Promise<{ ownerId: string }> }).findUniqueOrThrow({ where: { id } })).ownerId);
    expect(await 主(带计划.id, "followPlan")).toBe(销售.id);
    expect(await 主(带待办.id, "task")).toBe(销售.id);
    expect(await 主(完计划.id, "followPlan")).toBe(销售.id);
    expect(await 主(完待办.id, "task")).toBe(销售.id);
    expect(await 主(新计划.id, "followPlan")).toBe(接手.id);
    expect(await 主(新待办.id, "task")).toBe(接手.id);
  });

  it("客户异议（审查 M4）：多次转让只退当次——第二次转让的异议只把第二次带走的退回上一位，不动更早的", async () => {
    const a = await 客户(销售.id, { bizLine: "内贸" });
    当(组长);
    const 早计划 = await prisma.followPlan.create({ data: { customerId: a.id, ownerId: 销售.id, subject: "早", plannedAt: new Date(Date.now() + 日) } });
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "第一次转", 随转: [] })).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 20));
    const 中待办 = await prisma.task.create({ data: { customerId: a.id, ownerId: 接手.id, title: "接手人排的", dueAt: new Date(Date.now() + 日) } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await assignSalesOwner([a.id], 同事二.id, null, undefined, { 说明: "第二次转", 随转: [] })).toMatchObject({ ok: true });
    const 第二行 = (await prisma.entTransferObjection.findMany({ where: { kind: "客户", objectorUserId: 接手.id } }))[0]!;
    await 提(第二行, 接手);
    expect(await 裁定(线总管, 第二行.id, "撤回", "第二次不对")).toMatchObject({ ok: true, 结果: "撤回" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).salesOwnerId).toBe(接手.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 中待办.id } })).ownerId).toBe(接手.id);
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: 早计划.id } })).ownerId).toBe(接手.id);
    expect(await prisma.followPlan.count({ where: { customerId: a.id, ownerId: 销售.id } })).toBe(0);
  });

  it("撤回边界：已并 / 已结束 / 进公海 / 已再转 都不自动退，状态「待手工退回」，什么都没动，通知系统管理员，系统管理员手工退回后记「已退回」并通知各方", async () => {
    const 情形: [string, (id: string, a: string) => Promise<void>][] = [
      ["已并", async (id, a) => {
        const 留 = await 项目(a, 同事.id);
        await prisma.entCustomerMerge.create({ data: { kind: "项目", fromId: id, intoId: 留.id, status: "已合并", byUserId: 同事.id, fromName: "被并项目", detail: "{}" } });
      }],
      ["已结束", async (id) => { await prisma.project.update({ where: { id }, data: { result: "丢单", closedAt: new Date() } }); }],
      ["进公海", async (id) => { await prisma.project.update({ where: { id }, data: { pooledAt: new Date(), ownerId: "" } }); }],
      ["已再转", async (id) => { await prisma.project.update({ where: { id }, data: { ownerId: 同事二.id } }); }],
    ];
    for (const [名, 动] of 情形) {
      await resetDb();
      号 = 0;
      老板 = await 建(`b${名}`, "ADMIN");
      副管 = await 建(`c${名}`, "ADMIN");
      线总管 = await 建(`l${名}`, "MANAGER");
      组长 = await 建(`m${名}`, "MANAGER");
      销售 = await 建(`s${名}`); 接手 = await 建(`t${名}`); 同事 = await 建(`p${名}`); 同事二 = await 建(`q${名}`);
      await prisma.entMember.createMany({ data: [
        { userId: 老板.id, bizRole: "director" }, { userId: 副管.id, bizRole: "director" }, { userId: 线总管.id, bizRole: "director", line: "内贸" },
        { userId: 组长.id, bizRole: "sales_mgr", line: "内贸" },
        ...[销售, 接手, 同事, 同事二].map((u) => ({ userId: u.id, managerId: 组长.id, bizRole: "sales", line: "内贸" })),
      ] });
      const { a, 转的, 项目行 } = await 转一单();
      await 提(项目行, 同事);
      await 动(转的.id, a.id);
      const 前 = await 项目现(转的.id);
      const r = await 裁定(线总管, 项目行.id, "撤回", `撤回-${名}`);
      expect(r, 名).toMatchObject({ ok: true, 结果: "待手工退回" });
      expect(await 项目现(转的.id), 名).toMatchObject({ ownerId: 前.ownerId, pooledAt: 前.pooledAt, result: 前.result });
      expect(await prisma.projectNodeLog.count({ where: { projectId: 转的.id, reason: { contains: "异议撤回" } } }), 名).toBe(0);
      expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 项目行.id } })).status, 名).toBe("待手工退回");
      for (const 管 of [老板, 副管]) expect((await 通知们(管.id)).filter((n) => n.title.includes("待手工退回")), 名).toHaveLength(1);
      expect((await 通知们(同事.id)).filter((n) => n.title.includes("等系统管理员手工退回")), 名).toHaveLength(1);
      expect((await 通知们(组长.id)).filter((n) => n.title.includes("等系统管理员手工退回")), 名).toHaveLength(1);
      expect((await 待手工退回们()).map((x) => x.id), 名).toEqual([项目行.id]);
      // 非系统管理员不能记手工退回；说明必填；系统管理员记了才变已退回，并通知各方
      expect(await 标记已手工退回(线总管, 项目行.id, "x"), 名).toMatchObject({ ok: false });
      expect(await 标记已手工退回(老板, 项目行.id, " "), 名).toMatchObject({ ok: false });
      expect(await 标记已手工退回(老板, 项目行.id, "已在项目页改回同事"), 名).toMatchObject({ ok: true });
      expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 项目行.id } })).status, 名).toBe("已退回");
      expect((await 通知们(接手.id)).filter((n) => n.title.includes("不再归你")), 名).toHaveLength(1);
    }
  });
});

describe("未裁定的异议拦再转和合并", () => {
  it("提了异议没裁定：客户再转、项目再转、合并都拦，提示「这条有异议还没裁定」；裁定（维持）后放开；没提异议（可提）不拦", async () => {
    const { a, 转的, 项目行 } = await 转一单();
    // 还只是「可提」：不拦
    expect(await 客户有未裁定异议(prisma, [a.id])).toBeNull();
    await 提(项目行, 同事);
    expect(await 客户有未裁定异议(prisma, [a.id])).toContain("这条有异议还没裁定");
    expect(await 客户有未裁定异议(prisma, [a.id], "合并")).toContain("合并");
    expect(await 项目有未裁定异议(prisma, [{ id: 转的.id, customerId: a.id, ownerId: 接手.id }])).toContain("这条有异议还没裁定");
    // 同客户别的项目（不在这条异议里）不拦
    const 别的 = await 项目(a.id, 销售.id);
    expect(await 项目有未裁定异议(prisma, [{ id: 别的.id, customerId: a.id, ownerId: 销售.id }])).toBeNull();
    // 真入口：客户批量转让被拦，客户没动
    当(组长);
    const r = await assignSalesOwner([a.id], 同事二.id, null, undefined, { 说明: "再转一次" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("这条有异议还没裁定") });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).salesOwnerId).toBe(接手.id);
    // 裁定维持后放开
    expect(await 裁定(线总管, 项目行.id, "维持", "合理")).toMatchObject({ ok: true });
    expect(await 客户有未裁定异议(prisma, [a.id])).toBeNull();
    当(组长);
    expect(await assignSalesOwner([a.id], 同事二.id, null, undefined, { 说明: "再转一次" })).toMatchObject({ ok: true, updated: 1 });
  });
});

describe("待手工退回不死锁（审查 M1）", () => {
  it("撤回→已再转→待手工退回后：系统管理员能把客户改回异议人，异议记成已退回；待裁定仍拦", async () => {
    const { a, 客户行 } = await 转一单();
    // 可提期间客户被再转给同事二
    当(组长);
    expect(await assignSalesOwner([a.id], 同事二.id, null, undefined, { 说明: "再转一次" })).toMatchObject({ ok: true, updated: 1 });
    await 提(客户行, 销售);
    // 待裁定：改负责人仍被拦
    当(老板);
    expect(await assignSalesOwner([a.id], 销售.id, null, undefined, { 说明: "退回" })).toMatchObject({ ok: false, error: expect.stringContaining("这条有异议还没裁定") });
    const r = await 裁定(线总管, 客户行.id, "撤回", "撤回");
    expect(r).toMatchObject({ ok: true, 结果: "待手工退回" });
    expect(await 客户有未裁定异议(prisma, [a.id])).toBeNull();
    // 系统管理员改回异议人：不再被拦，异议顺带记成已退回
    当(老板);
    expect(await assignSalesOwner([a.id], 销售.id, null, undefined, { 说明: "手工退回" })).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).salesOwnerId).toBe(销售.id);
    const 后 = await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 客户行.id } });
    expect(后.status).toBe("已退回");
    expect(后.judgeNote).toContain("手工退回");
    // 审查 必改 1：自动记已退回也补通知（异议人、发起人、接手人、现负责人）和留痕，同「已手工退回」按钮
    expect((await 通知们(销售.id)).some((n) => n.dedupeKey === `objection-done:${客户行.id}:objector:hand`), "异议人").toBe(true);
    expect((await 通知们(组长.id)).some((n) => n.dedupeKey === `objection-done:${客户行.id}:operator:hand`), "发起人").toBe(true);
    expect((await 通知们(接手.id)).some((n) => n.dedupeKey === `objection-done:${客户行.id}:taker:hand`), "接手人").toBe(true);
    expect((await prisma.auditLog.findMany({ where: { entityId: a.id, summary: { contains: "手工退回" } } })).length).toBeGreaterThan(0);
    // 审查 必改 3：手工退回走转让，被换掉的同事二不生成新的异议入口
    expect((await 行们()).filter((x) => x.objectorUserId === 同事二.id)).toHaveLength(0);
    expect((await 通知们(同事二.id)).some((n) => n.link === "/objections" && n.title.includes("提异议"))).toBe(false);
  });
});

describe("撤销改负责人带走异议行（审查 M2）", () => {
  it("可提的异议撤销后变已撤销、不再挡再转；已提（待裁定）的撤销照常放行并标已撤销", async () => {
    for (const 先提 of [false, true]) {
      await resetDb();
      await beforeEachSetup();
      const a = await 客户(销售.id, { bizLine: "内贸" });
      当(组长);
      const r = await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回" });
      expect(r).toMatchObject({ ok: true, updated: 1 });
      const 行 = (await 行们()).find((x) => x.kind === "客户")!;
      if (先提) { await 提(行, 销售); 当(组长); }
      const u = await 撤销改负责人(r.ok ? (r.原值 ?? []) : [], 接手.id, r.ok ? r.带过来 : undefined);
      expect(u, String(先提)).toMatchObject({ ok: true, updated: 1 });
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).salesOwnerId).toBe(销售.id);
      expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } })).status, String(先提)).toBe("已撤销");
      expect(await 客户有未裁定异议(prisma, [a.id]), String(先提)).toBeNull();
      expect(await assignSalesOwner([a.id], 同事二.id, null, undefined, { 说明: "再转" }), String(先提)).toMatchObject({ ok: true, updated: 1 });
      expect((await 我的异议(销售.id)).已提.map((x) => x.id), String(先提)).not.toContain(行.id);
      // 审查 必改 2（口径 A8）：待裁定的撤销作废要通知异议人和裁定人；可提的不用
      const 作废通知 = async (id: string) => (await 通知们(id)).filter((n) => n.dedupeKey.startsWith(`objection-void:${行.id}`));
      if (先提) {
        const 异议人收 = await 作废通知(销售.id);
        expect(异议人收).toHaveLength(1);
        expect(异议人收[0].title).toContain("转让已撤销");
        expect(异议人收[0].body).toContain("客户已回到你名下，无需裁定");
        const 裁定人们 = JSON.parse((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } })).judgeIds!) as string[];
        expect(裁定人们.length).toBeGreaterThan(0);
        for (const id of 裁定人们) expect((await 作废通知(id)).length, "裁定人").toBe(1);
      } else {
        expect(await 作废通知(销售.id)).toHaveLength(0);
      }
    }
  });

  it("项目异议被撤销作废：通知标题写「转让已撤销」、正文按类别写「项目已回到…名下」，不写成客户", async () => {
    const a = await 客户(销售.id, { bizLine: "内贸" });
    const 转的 = await 项目(a.id, 同事.id);
    当(组长);
    const r = await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回", 随转: [转的.id] });
    const 行 = (await 行们()).find((x) => x.kind === "项目")!;
    await 提(行, 同事);
    当(组长);
    expect(await 撤销改负责人(r.ok ? (r.原值 ?? []) : [], 接手.id, r.ok ? r.带过来 : undefined)).toMatchObject({ ok: true });
    expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } })).status).toBe("已撤销");
    const 作废 = async (id: string) => (await 通知们(id)).filter((n) => n.dedupeKey.startsWith(`objection-void:${行.id}`));
    const 异议人收 = await 作废(同事.id);
    expect(异议人收).toHaveLength(1);
    expect(异议人收[0].title).toContain("转让已撤销");
    expect(异议人收[0].body).toBe("项目已回到你名下，无需裁定");
    const 裁人 = JSON.parse((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } })).judgeIds!) as string[];
    const 裁收 = await 作废(裁人[0]);
    expect(裁收).toHaveLength(1);
    expect(裁收[0].body).toContain(`项目已回到${同事.name}名下`);
    expect(裁收[0].body).not.toContain("客户已回到");
  });

  it("已撤销的异议再提 / 再裁定：提示这次转让已被撤销（审查 必改 4）", async () => {
    const a = await 客户(销售.id, { bizLine: "内贸" });
    当(组长);
    const r = await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回" });
    const 行 = (await 行们()).find((x) => x.kind === "客户")!;
    await 提(行, 销售);
    当(组长);
    await 撤销改负责人(r.ok ? (r.原值 ?? []) : [], 接手.id, r.ok ? r.带过来 : undefined);
    const 裁人 = JSON.parse((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } })).judgeIds!) as string[];
    当(销售);
    expect(await 提异议核(销售, 行.id, "再提")).toMatchObject({ ok: false, error: "这次转让已被撤销，不用再提异议" });
    const 裁 = [老板, 副管, 线总管, 组长].find((p) => 裁人.includes(p.id))!;
    expect(await 裁定(裁, 行.id, "维持", "x")).toMatchObject({ ok: false, error: "这次转让已被撤销，异议已作废" });
  });
});



describe("裁定人按当前组织重算（审查 M3，口径 A2 / B1）", () => {
  it("提交时的裁定人停用了：不再算他，改由别的人裁（系统管理员），通知也发给重算后的人", async () => {
    const { 项目行 } = await 转一单();
    await 提(项目行, 同事);
    expect((await 待我裁定(线总管.id)).map((r) => r.id)).toEqual([项目行.id]);
    await prisma.user.update({ where: { id: 线总管.id }, data: { active: false } });
    expect(await 待我裁定(线总管.id)).toEqual([]);
    const 老板的 = await 待我裁定(老板.id);
    expect(老板的.map((r) => r.id)).toEqual([项目行.id]);
    expect(老板的[0].现裁定人).toContain(副管.name);
    当(线总管);
    expect(await 裁定(线总管, 项目行.id, "维持", "我已停用")).toMatchObject({ ok: false });
    当(老板);
    expect(await 裁定(老板, 项目行.id, "维持", "按现状")).toMatchObject({ ok: true });
  });

  it("系统管理员任何时候都能裁（兜底），不在裁定人里的普通人不行；全部待裁定只有系统管理员看得到", async () => {
    const { 项目行 } = await 转一单();
    await 提(项目行, 同事);
    expect((await 待我裁定(老板.id))).toEqual([]);
    expect((await 全部待裁定(老板.id)).map((r) => r.id)).toEqual([项目行.id]);
    expect((await 全部待裁定(副管.id)).map((r) => r.id)).toEqual([项目行.id]);
    for (const 非管 of [线总管, 组长, 销售, 接手, 同事]) expect(await 全部待裁定(非管.id)).toEqual([]);
    当(组长);
    expect(await 裁定(组长, 项目行.id, "维持", "我不是裁定人")).toMatchObject({ ok: false });
    当(老板);
    expect(await 裁定(老板, 项目行.id, "维持", "兜底裁定")).toMatchObject({ ok: true, 结果: "维持" });
    expect((await 全部待裁定(老板.id))).toEqual([]);
  });

  it("发起人、接手人不当裁定人：系统管理员亲自转的，由其他系统管理员裁，发起人自己不能插手", async () => {
    const a = await 客户(销售.id, { bizLine: "内贸" });
    当(老板);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "老板直接转" })).toMatchObject({ ok: true });
    const 行 = (await 行们()).find((r) => r.kind === "客户")!;
    await 提(行, 销售);
    expect(await 待我裁定(老板.id)).toEqual([]);
    expect((await 待我裁定(副管.id)).map((r) => r.id)).toEqual([行.id]);
    当(老板);
    expect(await 裁定(老板, 行.id, "维持", "我是发起人")).toMatchObject({ ok: false });
    当(副管);
    expect(await 裁定(副管, 行.id, "维持", "其他系统管理员裁")).toMatchObject({ ok: true });
  });

  it("只剩发起人自己一位系统管理员：仍由他裁，页面标「本人发起」并在留痕里写明", async () => {
    await prisma.entMember.delete({ where: { userId: 副管.id } });
    await prisma.user.update({ where: { id: 副管.id }, data: { role: "SALES" } });
    const a = await 客户(销售.id, { bizLine: "内贸" });
    当(老板);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "只有我一个管理员" })).toMatchObject({ ok: true });
    const 行 = (await 行们()).find((r) => r.kind === "客户")!;
    await 提(行, 销售);
    const 待 = await 待我裁定(老板.id);
    expect(待).toHaveLength(1);
    expect(待[0].本人发起).toBe(true);
    当(老板);
    expect(await 裁定(老板, 行.id, "维持", "本人发起的")).toMatchObject({ ok: true });
    const 审 = await prisma.auditLog.findMany({ where: { entityId: a.id } });
    expect(审.some((x) => x.summary.includes("本人发起"))).toBe(true);
  });

  it("接手人是唯一系统管理员、发起人不是：接手人自己裁，页面和留痕写「本人接手、无人回避」", async () => {
    await prisma.entMember.delete({ where: { userId: 副管.id } });
    await prisma.user.update({ where: { id: 副管.id }, data: { role: "SALES" } });
    await prisma.entMember.update({ where: { userId: 线总管.id }, data: { line: "外贸" } });
    const a = await 客户(销售.id, { bizLine: "内贸" });
    当(组长);
    expect(await assignSalesOwner([a.id], 老板.id, null, undefined, { 说明: "转给唯一的管理员" })).toMatchObject({ ok: true });
    const 行 = (await 行们()).find((r) => r.kind === "客户")!;
    await 提(行, 销售);
    const 待 = await 待我裁定(老板.id);
    expect(待).toHaveLength(1);
    expect(待[0]).toMatchObject({ 本人接手: true, 能裁: true });
    expect(待[0].本人发起).toBeUndefined();
    当(老板);
    expect(await 裁定(老板, 行.id, "维持", "本人接手的")).toMatchObject({ ok: true });
    const 审 = await prisma.auditLog.findMany({ where: { entityId: a.id } });
    expect(审.some((x) => x.summary.includes("本人接手、无人回避"))).toBe(true);
  });

  it("全部待裁定每行带「能裁」：发起人是系统管理员、还有别的系统管理员可裁时，发起人那行不能裁（页上不出维持 / 撤回），别的系统管理员能裁", async () => {
    const a = await 客户(销售.id, { bizLine: "内贸" });
    当(老板);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "老板直接转" })).toMatchObject({ ok: true });
    const 行 = (await 行们()).find((r) => r.kind === "客户")!;
    await 提(行, 销售);
    const 老板看 = await 全部待裁定(老板.id);
    expect(老板看.map((r) => r.id)).toEqual([行.id]);
    expect(老板看[0]).toMatchObject({ 能裁: false, 现裁定人: 副管.name });
    expect(await 裁定(老板, 行.id, "维持", "我是发起人")).toMatchObject({ ok: false });
    expect((await 全部待裁定(副管.id))[0]).toMatchObject({ 能裁: true });
    expect((await 待我裁定(副管.id))[0]).toMatchObject({ 能裁: true });
  });
});
