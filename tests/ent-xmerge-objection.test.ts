/**
 * 跨负责人项目合并 · 阶段 3（台账）+ 阶段 4（异议接入）服务端（单 1）：
 *   台账：子类 / 发起方式 / 确认人 / 申请时间 / 30 天截止 / 撤回路径、类型筛选、搜确认人和原负责人、导出同条件；
 *   异议：合并成功同事务记「可提」行（kind 项目合并，mergeId 指合并单，projectId = 留下项目）、提异议、裁定人、裁定维持 / 撤回（自动 / 待手工退回）、
 *   E-484 第 3 条（撤回时待裁定 → 因撤回终止、可提 → 已撤销）、冻结只挡留下项目、通知键去重。人名、客户名都是编造的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
const 登录 = vi.hoisted(() => ({ 人: null as null | { id: string; name: string; role: string } }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), requireUser: async () => ({ email: "", title: "", ...登录.人! }) }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 撤回项目合并, 执行项目合并, 项目合并通知种类 } from "@/lib/enterprise/project-merge";
import { 发起跨负责人并, 处理跨并申请 } from "@/lib/enterprise/project-merge-request";
import { 提异议, 我的异议, 合并异议of } from "@/lib/enterprise/objection";
import { 裁定, 标记已手工退回, 待我裁定, 待手工退回们, 特殊裁定台账 } from "@/lib/enterprise/objection-judge";
import { 客户有未裁定异议, 项目有未裁定异议, 读全部待裁定行, 挡着项目的异议 } from "@/lib/enterprise/objection-guard";
import { 读合并台账, 导出合并台账 } from "@/lib/enterprise/merge-ledger";
import { 记项目合并异议入口 } from "@/lib/enterprise/objection";
import { 钟上待裁提醒, 钟上手工退回提醒 } from "@/lib/enterprise/objection-remind";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 销管: 人, 线总: 人, 乙: 人, 丙: 人, 丁: 人, 渠运: 人;
let 序 = 0;
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const 周五下午 = 京("2026-11-27 15:00");

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
const 客户 = async (ownerId: string) => (await raw.customer.create({ data: { name: `测试客户${++序}`, phone: "", salesOwnerId: ownerId } })).id;
const 项目 = async (ownerId: string, customerId: string, 补: Record<string, unknown> = {}) =>
  (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, bizLine: "内贸", ...补 } })).id;
/** 乙的项目 a（留下）、丙的项目 b（被并走），同一位客户（销售乙负责） */
async function 一对() {
  const c = await 客户(乙.id);
  return { c, a: await 项目(乙.id, c), b: await 项目(丙.id, c) };
}
const 发 = async (a: string, b: string, me: 人, 现在 = 周五下午) => {
  const r = await 发起跨负责人并(prisma, a, b, me, { 现在 });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const 请 = async (a: string, b: string, me: 人 = 乙, 现在 = 周五下午) => {
  const r = await 发(a, b, me, 现在);
  if (r.方式 !== "申请") throw new Error("应该是申请");
  return r.requestId;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  销管 = await 造人("xg", "销管甲", "SALES");
  线总 = await 造人("xz", "线总甲", "SALES");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  丁 = await 造人("ding", "丁", "SALES");
  渠运 = await 造人("qy", "渠运甲", "SALES");
  await raw.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 销管.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 线总.id, bizRole: "director", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸", managerId: 销管.id },
      { userId: 丁.id, bizRole: "sales", line: "内贸" },
      { userId: 渠运.id, bizRole: "channel_ops" },
    ],
  });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});



const 提 = async (id: string, 我: 人 = 丙, 现在 = 周五下午) => 提异议(我, id, "我的项目被并走了，不同意", 现在);
/** 直接并（销管发起 = 确认人），返回合并单和异议行 */
async function 直接并(a?: string, b?: string, 谁: 人 = 销管) {
  const 对 = a && b ? { a, b, c: (await raw.project.findUniqueOrThrow({ where: { id: a } })).customerId } : await 一对();
  const r = await 发(对.a, 对.b, 谁);
  if (r.方式 !== "直接并") throw new Error("应该直接并");
  const 行 = await raw.entTransferObjection.findFirst({ where: { mergeId: r.mergeId } });
  return { ...对, mergeId: r.mergeId, 行 };
}
async function 申请并() {
  const { a, b } = await 一对();
  const id = await 请(a, b);
  expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: true });
  const mergeId = (await raw.entProjectMergeRequest.findUniqueOrThrow({ where: { id } })).mergeId!;
  return { a, b, requestId: id, mergeId, 行: await raw.entTransferObjection.findFirst({ where: { mergeId } }) };
}
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  销管 = await 造人("xg", "销管甲", "SALES");
  线总 = await 造人("xz", "线总甲", "SALES");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  丁 = await 造人("ding", "丁", "SALES");
  渠运 = await 造人("qy", "渠运甲", "SALES");
  await raw.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 销管.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 线总.id, bizRole: "director", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸", managerId: 销管.id },
      { userId: 丁.id, bizRole: "sales", line: "内贸" },
      { userId: 渠运.id, bizRole: "channel_ops" },
    ],
  });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});



const 天 = 86_400_000;
const 单 = (id: string) => raw.entCustomerMerge.findUniqueOrThrow({ where: { id } });

describe("阶段 4 ①：合并成功同事务记「可提」行", () => {
  it("直接并：记一行，挂合并单、projectId = 留下项目、targetKey = 被并项目、裁定窗 30 天", async () => {
    const { a, b, c, mergeId, 行 } = await 直接并();
    expect(行).toMatchObject({ kind: "项目合并", status: "可提", mergeId, ownerLogId: null, customerId: c, projectId: a, targetKey: b, objectorUserId: 丙.id, operatorUserId: 销管.id, toOwnerId: 乙.id });
    expect(行!.expiresAt.getTime() - (await 单(mergeId)).at.getTime()).toBe(30 * 天);
  });
  it("申请确认：确认人 = 让合并生效的人", async () => {
    const { 行 } = await 申请并();
    expect(行).toMatchObject({ kind: "项目合并", objectorUserId: 丙.id, operatorUserId: 销管.id, toOwnerId: 乙.id });
  });
  it("同负责人合并不记行", async () => {
    const c = await 客户(乙.id);
    const [a, b] = [await 项目(乙.id, c), await 项目(乙.id, c)];
    const r = await 执行项目合并(prisma, a, b, 乙, { 已核未开票: true });
    expect(r.ok).toBe(true);
    expect(await raw.entTransferObjection.count()).toBe(0);
  });
  it("原负责人已停用不记行；原负责人就是让合并生效的人不记行", async () => {
    const 对 = await 一对();
    await raw.user.update({ where: { id: 丙.id }, data: { active: false } });
    expect((await 直接并(对.a, 对.b)).行).toBeNull();
  });
  it("入口函数：被并方就是发起人 / 确认人时不记（事务内调用）", async () => {
    const { a, b } = await 一对();
    const A = await raw.project.findUniqueOrThrow({ where: { id: a } });
    const B = await raw.project.findUniqueOrThrow({ where: { id: b } });
    expect(await 记项目合并异议入口(raw, { mergeId: "m1", A, B, 生效人: 丙.id, 发起人: 乙.id, 现在: new Date() })).toBeNull();
    expect(await 记项目合并异议入口(raw, { mergeId: "m1", A, B, 生效人: 销管.id, 发起人: 丙.id, 现在: new Date() })).toBeNull();
    expect(await 记项目合并异议入口(raw, { mergeId: "m1", A, B, 生效人: 销管.id, 发起人: 乙.id, 现在: new Date() })).toBeTruthy();
  });
  it("并后通知：被并走的原负责人收到带「提异议」入口的一条，链到 /objections?o=", async () => {
    const { 行 } = await 申请并();
    await 等通知推完();
    const 们 = await raw.entNotice.findMany({ where: { userId: 丙.id, kind: 项目合并通知种类, dedupeKey: { startsWith: "merge-project:" } } });
    expect(们).toHaveLength(1);
    expect(们[0].link).toBe(`/objections?o=${行!.id}`);
    expect(们[0].body).toContain("提异议");
  });
});

describe("阶段 4 ②③：提异议、裁定人", () => {
  it("提：待裁定、裁定人 = 线总（确认人销管的上一级）、记两行留痕（被并项目 + 留下项目）", async () => {
    const { a, b, 行 } = await 直接并();
    const r = await 提(行!.id);
    expect(r).toMatchObject({ ok: true, 角色: "条线总管理" });
    expect(JSON.parse((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).judgeIds!)).toEqual([线总.id]);
    expect(await raw.auditLog.count({ where: { action: "objection", entityId: { in: [a, b] } } })).toBe(2);
    await 等通知推完();
    expect(await raw.entNotice.count({ where: { userId: 线总.id, kind: "异议" } })).toBe(1);
  });
  it("各分支：别人的当没有 / 已提 / 过了 30 天 / 合并已撤回 / 理由必填", async () => {
    const { 行, mergeId } = await 直接并();
    expect(await 提(行!.id, 乙)).toMatchObject({ ok: false, error: "没找到这条异议入口" });
    expect(await 提异议(丙, 行!.id, "  ", 周五下午)).toMatchObject({ ok: false });
    expect(await 提(行!.id, 丙, new Date(周五下午.getTime() + 31 * 天))).toMatchObject({ ok: false, error: expect.stringContaining("30 天") });
    expect(await 提(行!.id)).toMatchObject({ ok: true });
    expect(await 提(行!.id)).toMatchObject({ ok: false, error: "这一条已经提过异议了，等裁定" });
    // 合并已撤回：另一单
    const 二 = await 直接并();
    await 撤回项目合并(prisma, 二.mergeId, 销管);
    expect(await 提(二.行!.id)).toMatchObject({ ok: false, error: "这次合并已撤回，不用再提异议" });
    expect(mergeId).toBeTruthy();
  });
  it("老板（唯一系统管理员）直接并：裁定人仍是老板，标「本人发起、无人回避」", async () => {
    const { 行 } = await 直接并(undefined, undefined, 老板);
    const r = await 提(行!.id);
    expect(r).toMatchObject({ ok: true, 角色: "系统管理员" });
    expect(await raw.auditLog.findFirst({ where: { action: "objection" } })).toMatchObject({ summary: expect.stringContaining("本人发起、无人回避") });
  });
  it("我的异议：类别「项目合并」，已撤销的不列", async () => {
    const { 行 } = await 直接并();
    const { 能提 } = await 我的异议(丙.id, 周五下午);
    expect(能提.map((x) => [x.id, x.类别, x.对象])).toEqual([[行!.id, "项目合并", expect.any(String)]]);
  });
});

describe("单 2：项目详情「已并入」行要的 合并异议of", () => {
  it("原负责人本人读到入口（可提 / 剩几天），提了变待裁定；别人和撤回后（已撤销）读不到", async () => {
    const { mergeId, 行 } = await 直接并();
    expect(await 合并异议of(丙.id, mergeId, 周五下午)).toMatchObject({ id: 行!.id, 状态: "可提", 过期: false });
    expect(await 合并异议of(乙.id, mergeId, 周五下午)).toBeNull();
    expect(await 合并异议of(丙.id, "不存在的单", 周五下午)).toBeNull();
    await 提(行!.id);
    expect(await 合并异议of(丙.id, mergeId, 周五下午)).toMatchObject({ 状态: "待裁定" });
    expect((await 合并异议of(丙.id, mergeId, new Date(周五下午.getTime() + 40 * 天)))).toMatchObject({ 状态: "待裁定", 过期: true });
  });
  it("合并被撤回后入口作废：读不到", async () => {
    const { mergeId } = await 直接并();
    await raw.entTransferObjection.updateMany({ where: { mergeId }, data: { status: "已撤销" } });
    expect(await 合并异议of(丙.id, mergeId, 周五下午)).toBeNull();
  });
});

describe("阶段 4 ④⑤⑥：裁定", () => {
  const 提好 = async () => {
    const 并 = await 直接并();
    await 提(并.行!.id);
    return 并;
  };
  it("维持：合并不动，状态维持，通知异议人和发起人，文案是「合并异议」", async () => {
    const { 行, mergeId } = await 提好();
    expect(await 裁定(线总, 行!.id, "维持", "合并没问题")).toMatchObject({ ok: true, 结果: "维持" });
    expect((await 单(mergeId)).status).toBe("已合并");
    expect((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status).toBe("维持");
    await 等通知推完();
    const n = await raw.entNotice.findFirst({ where: { userId: 丙.id, dedupeKey: `objection-done:${行!.id}:objector` } });
    expect(n?.title).toContain("合并异议已裁定：维持");
  });
  it("撤回（自动）：同事务撤回合并单，两项目还原，30 天外也能裁；台账撤回路径 = 异议裁定撤回", async () => {
    const { a, b, 行, mergeId } = await 提好();
    const 现 = new Date(周五下午.getTime() + 40 * 天);
    expect(await 裁定(线总, 行!.id, "撤回", "不该并", 现)).toMatchObject({ ok: true, 结果: "撤回" });
    expect(await 单(mergeId)).toMatchObject({ status: "已撤回", undoneById: 线总.id });
    expect((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status).toBe("撤回");
    expect((await raw.project.findUniqueOrThrow({ where: { id: b } })).result).toBeNull();
    expect(await raw.project.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ ownerId: 乙.id });
    const 台账 = await 读合并台账(prisma, 老板, null);
    expect(台账.ok && 台账.行们.find((x) => x.id === mergeId)?.撤回路径).toBe("异议裁定撤回");
    await 等通知推完();
    // 通知（必改 2）：合并类单独一组，只发异议人（丙）+ 留下负责人（乙）各一条，文案按合并；不沿用转让那组（客户负责人、发起人不另发，也不说「不再归你」）
    expect(await raw.entNotice.count({ where: { dedupeKey: { startsWith: `objection-done:${行!.id}` } } })).toBe(2);
    expect(await raw.entNotice.count({ where: { dedupeKey: `merge-project-undo:${mergeId}` } })).toBe(0);
    const 丙收 = await raw.entNotice.findFirstOrThrow({ where: { userId: 丙.id, dedupeKey: `objection-done:${行!.id}:objector` } });
    expect(丙收.title).toMatch(/合并异议已裁定：撤回，合并已撤回/);
    expect(丙收.title).not.toContain("项目合并「");
    const 乙收 = await raw.entNotice.findFirstOrThrow({ where: { userId: 乙.id, dedupeKey: `objection-done:${行!.id}:taker` } });
    expect(乙收.title).toContain("合并已撤回");
    expect(乙收.title).toContain("回到丙名下");
    expect(乙收.title).not.toContain("不再归你");
    expect(await raw.entNotice.count({ where: { userId: 销管.id, dedupeKey: { startsWith: `objection-done:${行!.id}` } } })).toBe(0);
  });
  it("撤回但不满足（留下项目进了回收站）：转待手工退回；点「已手工退回」先核，撤不了回原因、什么都不改；恢复后点一下撤回合并并结案", async () => {
    const { a, b, 行, mergeId } = await 提好();
    await raw.project.update({ where: { id: a }, data: { deletedAt: new Date() } });
    expect(await 裁定(线总, 行!.id, "撤回", "不该并")).toMatchObject({ ok: true, 结果: "待手工退回" });
    expect((await 单(mergeId)).status).toBe("已合并");
    expect((await 待手工退回们()).map((x) => x.类别)).toEqual(["项目合并"]);
    expect(await 标记已手工退回(老板, 行!.id, "已手工撤回合并")).toMatchObject({ ok: false, error: expect.stringContaining("在回收站里") });
    expect((await 单(mergeId)).status).toBe("已合并");
    expect((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status).toBe("待手工退回");
    await raw.project.update({ where: { id: a }, data: { deletedAt: null } });
    expect(await 标记已手工退回(老板, 行!.id, "已恢复，撤回合并")).toMatchObject({ ok: true });
    expect(await 单(mergeId)).toMatchObject({ status: "已撤回", undoneById: 老板.id });
    expect((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status).toBe("已退回");
    expect((await raw.project.findUniqueOrThrow({ where: { id: b } })).result).toBeNull();
    // 手工路径同一组通知：异议人、留下负责人各一条（:hand），不发客户负责人
    await 等通知推完();
    const 手工们 = await raw.entNotice.findMany({ where: { dedupeKey: { startsWith: `objection-done:${行!.id}`, endsWith: ":hand" } } });
    expect(手工们.map((n) => [n.userId, n.dedupeKey.split(":").slice(2).join(":")]).sort()).toEqual([[丙.id, "objector:hand"], [乙.id, "taker:hand"]].sort());
    expect(手工们.every((n) => !n.title.includes("不再归你"))).toBe(true);
    expect(await 读合并台账(prisma, 老板, null).then((t) => t.ok && t.行们.find((x) => x.id === mergeId)?.撤回路径)).toBe("异议裁定撤回");
  });
  it("第 31 天裁定撤回、A 在回收站 → 待手工退回 → 恢复 A → 标记已手工退回：合并单已撤、异议结案（超 30 天也不卡死）", async () => {
    const { a, 行, mergeId } = await 提好();
    const 第31天 = new Date(周五下午.getTime() + 31 * 天);
    // 异议期 30 天：提的那一刻在期内，裁定落在第 31 天（裁定不再校期限）
    await raw.project.update({ where: { id: a }, data: { deletedAt: new Date() } });
    expect(await 裁定(线总, 行!.id, "撤回", "不该并", 第31天)).toMatchObject({ ok: true, 结果: "待手工退回" });
    // 单个「撤回项目合并」已过 30 天，系统管理员也撤不了
    await raw.project.update({ where: { id: a }, data: { deletedAt: null } });
    expect(await 撤回项目合并(prisma, mergeId, 老板, 第31天)).toMatchObject({ ok: false });
    expect(await 标记已手工退回(老板, 行!.id, "撤回合并并结案", 第31天)).toMatchObject({ ok: true });
    expect(await 单(mergeId)).toMatchObject({ status: "已撤回", undoneById: 老板.id });
    expect((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status).toBe("已退回");
    expect(await 待手工退回们()).toEqual([]);
  });
  it("不满足自动撤回：A 又被并进别的项目 → 待手工退回；先撤那次再点才行", async () => {
    const { a, c, 行, mergeId } = await 提好();
    const 新 = await 项目(乙.id, c);
    const 另 = await raw.entCustomerMerge.create({ data: { kind: "项目", fromId: a, intoId: 新, status: "已合并", byUserId: 乙.id, fromName: "A", detail: JSON.stringify({ 留下名: "新项目" }), at: 周五下午 } });
    expect(await 裁定(线总, 行!.id, "撤回", "不该并", 周五下午)).toMatchObject({ ok: true, 结果: "待手工退回" });
    expect((await 单(mergeId)).status).toBe("已合并");
    expect(await 标记已手工退回(老板, 行!.id, "x", 周五下午)).toMatchObject({ ok: false, error: expect.stringContaining("已并入") });
    await raw.entCustomerMerge.update({ where: { id: 另.id }, data: { status: "已撤回" } });
    expect(await 标记已手工退回(老板, 行!.id, "x", 周五下午)).toMatchObject({ ok: true });
    expect((await 单(mergeId)).status).toBe("已撤回");
  });
  it("不满足自动撤回：客户在转让交接中 → 待手工退回；交接结束后能撤回并结案", async () => {
    const { c, 行, mergeId } = await 提好();
    const 交 = await raw.entHandover.create({ data: { kind: "转让", fromUserId: 乙.id, toUserId: 丁.id, byUserId: 乙.id, customerIds: JSON.stringify([c]), status: "待确认" } });
    expect(await 裁定(线总, 行!.id, "撤回", "不该并", 周五下午)).toMatchObject({ ok: true, 结果: "待手工退回" });
    expect((await 单(mergeId)).status).toBe("已合并");
    expect(await 标记已手工退回(老板, 行!.id, "x", 周五下午)).toMatchObject({ ok: false, error: expect.stringContaining("转让交接中") });
    await raw.entHandover.update({ where: { id: 交.id }, data: { status: "已撤回" } });
    expect(await 标记已手工退回(老板, 行!.id, "x", 周五下午)).toMatchObject({ ok: true });
    expect((await 单(mergeId)).status).toBe("已撤回");
  });
  it("先由系统管理员自己撤了合并、事后才点已手工退回：只结案，台账撤回路径仍是系统管理员撤", async () => {
    const { a, 行, mergeId } = await 提好();
    await raw.project.update({ where: { id: a }, data: { deletedAt: new Date() } });
    await 裁定(线总, 行!.id, "撤回", "不该并");
    await raw.project.update({ where: { id: a }, data: { deletedAt: null } });
    expect(await 撤回项目合并(prisma, mergeId, 老板)).toMatchObject({ ok: true });
    expect(await 标记已手工退回(老板, 行!.id, "已自己撤")).toMatchObject({ ok: true });
    expect((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status).toBe("已退回");
    expect(await 读合并台账(prisma, 老板, null).then((t) => t.ok && t.行们.find((x) => x.id === mergeId)?.撤回路径)).toBe("系统管理员撤");
  });
  it("裁定过 / 因撤回终止的行再裁：话按合并说", async () => {
    const { 行, mergeId } = await 提好();
    await 撤回项目合并(prisma, mergeId, 销管);
    expect(await 裁定(老板, 行!.id, "撤回", "x")).toMatchObject({ ok: false, error: "这次合并已撤回，这条异议已终止，不用再裁" });
  });
  it("提醒：合并类行的标题 / 正文是「合并异议」，对象叫「项目「…」」不出「项目合并「」；待手工退回汇总提醒补一句合并怎么点", async () => {
    const { 行 } = await 提好();
    await raw.entTransferObjection.update({ where: { id: 行!.id }, data: { submittedAt: 京("2026-12-01 10:00") } });
    await 钟上待裁提醒(京("2026-12-09 09:00"));
    const n = await raw.entNotice.findFirstOrThrow({ where: { userId: 线总.id, dedupeKey: { startsWith: "objection-remind:" } } });
    expect(n.title).toContain("合并异议已");
    expect(n.title).not.toContain("转让异议");
    expect(n.title + n.body).not.toContain("项目合并「");
    expect(n.body).toContain("的合并异议自提出起");
    await raw.entTransferObjection.update({ where: { id: 行!.id }, data: { status: "待手工退回", judgedAt: 京("2026-12-01 10:00"), judgedById: 线总.id, judgeNote: "撤回" } });
    await 钟上手工退回提醒(京("2026-12-09 09:00"));
    const m = await raw.entNotice.findFirstOrThrow({ where: { userId: 老板.id, dedupeKey: { startsWith: "objection-manual-return:" } } });
    expect(m.body).toContain("撤回合并并结案");
  });
  it("特殊裁定台账：项目格是被并项目名", async () => {
    const { 行, b } = await (async () => { const x = await 直接并(undefined, undefined, 老板); await 提(x.行!.id); return x; })();
    expect(await 裁定(老板, 行!.id, "维持", "没问题")).toMatchObject({ ok: true });
    const 台 = await 特殊裁定台账(老板.id);
    expect(台[0]).toMatchObject({ 类型: "本人发起", 类别: "项目合并", 项目: (await raw.project.findUniqueOrThrow({ where: { id: b } })).name });
  });
  it("待我裁定 / 全部待裁定认项目合并类行", async () => {
    const { 行 } = await 提好();
    expect((await 待我裁定(线总.id)).map((x) => [x.id, x.类别])).toEqual([[行!.id, "项目合并"]]);
  });
});

describe("阶段 4 ⑦：E-484 第 3 条，撤回时终止异议", () => {
  it("确认人自己撤：待裁定 → 因撤回终止（有说明、不再进待办 / 提醒）；通知异议人只一条（并进撤回通知）、裁定人收作废", async () => {
    const { 行, mergeId } = await 直接并();
    await 提(行!.id);
    expect(await 撤回项目合并(prisma, mergeId, 销管)).toMatchObject({ ok: true });
    const 后 = await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } });
    expect(后).toMatchObject({ status: "因撤回终止", judgeNote: "因撤回终止", judgedById: 销管.id });
    expect(後判(后.judgedAt)).toBe(true);
    expect(await 待我裁定(线总.id)).toEqual([]);
    expect(await 读全部待裁定行(raw)).toEqual([]);
    await 等通知推完();
    const 异议人收 = await raw.entNotice.findMany({ where: { userId: 丙.id, kind: { in: [项目合并通知种类, "异议"] }, dedupeKey: { not: { startsWith: "merge-project:" } } } });
    expect(异议人收.filter((n) => n.dedupeKey !== `objection:${行!.id}`)).toHaveLength(1);
    expect(异议人收.find((n) => n.dedupeKey === `merge-project-undo:${mergeId}`)?.body).toContain("因撤回终止");
    expect(await raw.entNotice.count({ where: { userId: 线总.id, dedupeKey: `objection-void:${行!.id}:judge` } })).toBe(1);
    expect(await raw.auditLog.count({ where: { action: "merge-objection-end" } })).toBe(2);
  });
  it("可提的行 → 已撤销；之后提异议报「已撤回」", async () => {
    const { 行, mergeId } = await 直接并();
    await 撤回项目合并(prisma, mergeId, 销管);
    expect((await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status).toBe("已撤销");
    expect(await 提(行!.id)).toMatchObject({ ok: false, error: "这次合并已撤回，不用再提异议" });
  });
  it("并发：裁定撤回和确认人自己撤同时来，只成一个", async () => {
    const { 行, mergeId } = await 直接并();
    await 提(行!.id);
    const [x, y] = await Promise.allSettled([裁定(线总, 行!.id, "撤回", "不该并"), 撤回项目合并(prisma, mergeId, 销管)]);
    const 成 = [x, y].filter((r) => r.status === "fulfilled" && r.value.ok);
    expect(成).toHaveLength(1);
    expect((await 单(mergeId)).status).toBe("已撤回");
    const 终 = (await raw.entTransferObjection.findUniqueOrThrow({ where: { id: 行!.id } })).status;
    expect(["撤回", "因撤回终止"]).toContain(终);
  });
});
const 後判 = (d: Date | null) => !!d;

describe("阶段 4 ⑧：冻结只挡留下项目", () => {
  it("待裁定时 A 再转 / 再合并被拦（话是「合并异议」）；同客户别的项目、被并项目 B 不受牵连；确认人仍能撤；撤后放开", async () => {
    const { a, b, c, 行, mergeId } = await 直接并();
    const 别 = await 项目(乙.id, c);
    await 提(行!.id);
    const 取 = (id: string) => raw.project.findUniqueOrThrow({ where: { id }, select: { id: true, customerId: true, ownerId: true } }).then((p) => ({ ...p, ownerId: p.ownerId! }));
    expect(await 项目有未裁定异议(raw, [await 取(a)], "再转")).toBe("这条有合并异议还没裁定，裁定后才能再转");
    expect(await 项目有未裁定异议(raw, [await 取(a)], "合并")).toContain("合并异议");
    expect(await 项目有未裁定异议(raw, [await 取(别)])).toBeNull();
    expect(await 项目有未裁定异议(raw, [await 取(b)])).toBeNull();
    const 待们 = await 读全部待裁定行(raw);
    expect(挡着项目的异议(待们, await 取(别))).toEqual([]);
    expect(挡着项目的异议(待们, await 取(a))).toHaveLength(1);
    expect(await 撤回项目合并(prisma, mergeId, 销管)).toMatchObject({ ok: true });
    expect(await 项目有未裁定异议(raw, [await 取(a)])).toBeNull();
  });
  it("导入 / 客户转让走的客户级判断：待裁定的合并异议挡整位客户（与 kind=项目 先例一致），话带「合并异议」；裁定后放开", async () => {
    const { c, 行 } = await 直接并();
    await 提(行!.id);
    expect(await 客户有未裁定异议(raw, [c])).toBe("这条有合并异议还没裁定，裁定后才能再转");
    await 裁定(线总, 行!.id, "维持", "没问题");
    expect(await 客户有未裁定异议(raw, [c])).toBeNull();
  });
  it("裁定后放开（维持）", async () => {
    const { a, 行 } = await 直接并();
    await 提(行!.id);
    await 裁定(线总, 行!.id, "维持", "没问题");
    expect(await 项目有未裁定异议(raw, [{ ...(await raw.project.findUniqueOrThrow({ where: { id: a }, select: { id: true, customerId: true } })), ownerId: 乙.id }])).toBeNull();
  });
});

describe("阶段 3：合并台账（跨负责人列、类型筛选、搜索、导出）", () => {
  it("跨负责人行：直接并 / 申请确认各一，列值齐；同负责人行这几列空", async () => {
    const 直 = await 直接并();
    const 申 = await 申请并();
    const c = await 客户(乙.id);
    const [x, y] = [await 项目(乙.id, c), await 项目(乙.id, c)];
    const 同 = await 执行项目合并(prisma, x, y, 乙, { 已核未开票: true });
    if (!同.ok) throw new Error(同.error);
    const r = await 读合并台账(prisma, 老板, null);
    if (!r.ok) throw new Error(r.error);
    const 行 = (id: string) => r.行们.find((z) => z.id === id)!;
    expect(行(直.mergeId)).toMatchObject({ 类型: "项目合并", 子类: "跨负责人", 发起方式: "本人发起", 确认人: 销管.name, 申请时间: null, 撤回路径: "" });
    expect(行(直.mergeId).确认人层级).toBeTruthy();
    expect(行(申.mergeId)).toMatchObject({ 子类: "跨负责人", 发起方式: "申请确认", 确认人: 销管.name, 被并负责人: 丙.name, 留下负责人: 乙.name });
    expect(行(申.mergeId).申请时间).toBe((await raw.entProjectMergeRequest.findUniqueOrThrow({ where: { id: 申.requestId } })).at.toISOString());
    expect(Date.parse(行(申.mergeId).三十天截止!) - Date.parse(行(申.mergeId).at)).toBe(30 * 天);
    expect(行(同.mergeId)).toMatchObject({ 子类: "同负责人", 发起方式: "", 确认人: "", 申请时间: null, 三十天截止: null, 撤回路径: "" });
  });
  it("类型筛选三类 + 全部；搜确认人名、原负责人名；非系统管理员读不到", async () => {
    const 直 = await 直接并();
    const c = await 客户(乙.id);
    const [x, y] = [await 项目(乙.id, c), await 项目(乙.id, c)];
    const 同 = await 执行项目合并(prisma, x, y, 乙, { 已核未开票: true });
    if (!同.ok) throw new Error(同.error);
    const ids = async (条件: object) => { const r = await 读合并台账(prisma, 老板, 条件); if (!r.ok) throw new Error(r.error); return r.行们.map((z) => z.id).sort(); };
    expect(await ids({})).toEqual([直.mergeId, 同.mergeId].sort());
    expect(await ids({ 类型: "跨负责人" })).toEqual([直.mergeId]);
    expect(await ids({ 类型: "同负责人" })).toEqual([同.mergeId]);
    expect(await ids({ 类型: "公海客户" })).toEqual([]);
    expect(await ids({ 词: 销管.name })).toEqual([直.mergeId]);
    expect(await ids({ 词: 丙.name })).toEqual([直.mergeId]);
    expect(await 读合并台账(prisma, 销管, null)).toMatchObject({ ok: false });
  });
  it("导出：同一组条件（含类型）、记一行导出日志、含新列", async () => {
    await 直接并();
    const r = await 导出合并台账(prisma, 老板, { 类型: "跨负责人" });
    expect(r.ok && r.行们[0]).toMatchObject({ 子类: "跨负责人", 确认人: 销管.name });
    const 日志 = await raw.auditLog.findMany({ where: { action: "export", entity: "EntCustomerMerge" } });
    expect(日志).toHaveLength(1);
    expect(日志[0].summary).toContain("只看跨负责人");
  });
  it("撤回路径：确认人撤 / 发起人撤 / 系统管理员撤；撤回路径空位对未撤回行不报错", async () => {
    const [甲, 乙乙, 丙丙] = [await 申请并(), await 申请并(), await 申请并()];
    await 撤回项目合并(prisma, 甲.mergeId, 销管);
    await 撤回项目合并(prisma, 乙乙.mergeId, 乙);
    await 撤回项目合并(prisma, 丙丙.mergeId, 老板);
    const r = await 读合并台账(prisma, 老板, null);
    if (!r.ok) throw new Error(r.error);
    const 路 = (id: string) => r.行们.find((z) => z.id === id)!.撤回路径;
    expect([路(甲.mergeId), 路(乙乙.mergeId), 路(丙丙.mergeId)]).toEqual(["确认人撤", "发起人撤", "系统管理员撤"]);
  });
});
