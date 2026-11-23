/**
 * 企业版必填拦截记录（2026-11-23，lib/project/required-block.ts，迁移 164）：
 *   - 改节点 被节点必填 / 线索验证 / 本节点沟通拦下各记一行（时间、人、项目、客户、节点、缺哪几项、入口、代推）；回给界面的话不变
 *   - 节点推进开关关着：线索验证那道照拦，照记
 *   - 没权限、往后退、推成了不记；同一人同一项目同一节点同一种拦法 10 分钟内只记一行
 *   - 项目页补填框弹出（记完成节点被拦）、看板拖动预检缺必填：服务端自己算还差，记一行
 *   - 导出：卡了多久按之后第一次离开这个节点的节点变更算；卡超 24 小时的项目数；按节点分布
 *   - 不是企业版不记
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 改节点 } from "@/lib/project/db";
import { 缺有效沟通还差, 缺本节点沟通 } from "@/lib/project/stage-gates";
import { 记必填拦截, 读拦截导出, 认入口 } from "@/lib/project/required-block";
import { 记完成节点被拦, 看板推进预检, 改项目节点 } from "@/app/(app)/projects/actions";

let 乙: { id: string; name: string; role: string };
let 丙: { id: string; name: string; role: string };
let 客户: string;
const 规则 = (补: { 节点推进?: object; 阶段?: object } = {}) =>
  setSetting("orgRules", { ...默认组织规则, ...补, 阶段: { ...默认组织规则.阶段, ...(补.阶段 ?? {}) } });
const 项目 = (补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育", ...补 } });
const 记录 = () => prisma.entRequiredBlock.findMany({ orderBy: { at: "asc" } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true });
  const u = await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } });
  乙 = { id: u.id, name: u.name, role: "SALES" };
  const v = await prisma.user.create({ data: { email: "bing", name: "丙", title: "", role: "SALES", password: "x" } });
  丙 = { id: v.id, name: v.name, role: "SALES" };
  await prisma.entMember.create({ data: { userId: 乙.id, bizRole: "sales" } });
  await prisma.entMember.create({ data: { userId: 丙.id, bizRole: "sales" } });
  mocks.user = { ...mocks.user, id: 乙.id };
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙.id, customerNo: 123 } })).id;
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("改节点 被拦下记一行", () => {
  it("节点必填：缺哪几项、入口、客户、想推到哪都记上；回的话不变；10 分钟内同一件事不重复记", async () => {
    await 规则({ 节点推进: { 开: true, 必填: { 潜客培育: ["项目级别"] } } });
    const p = await 项目();
    const r = await 改节点(乙, p.id, { phase: "线索", node: "线索验证" }, undefined, { 入口: "完成节点" });
    expect(r).toEqual({ ok: false, error: "「潜客培育」还差必填：项目级别；补齐再推" });
    const 行 = await 记录();
    expect(行).toHaveLength(1);
    expect(行[0]).toMatchObject({
      userId: 乙.id, projectId: p.id, customerId: 客户, phase: "线索", node: "潜客培育", toPhase: "线索", toNode: "线索验证",
      kind: "节点必填", entry: "完成节点", onBehalf: false,
    });
    expect(JSON.parse(行[0].missing)).toEqual(["项目级别"]);
    // 再点一次：10 分钟内不再记
    await 改节点(乙, p.id, { phase: "线索", node: "线索验证" }, undefined, { 入口: "完成节点" });
    expect(await 记录()).toHaveLength(1);
    // 补齐了推过去：不记
    await prisma.project.update({ where: { id: p.id }, data: { level: "A" } });
    expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
    expect(await 记录()).toHaveLength(1);
  });

  it("节点推进开关关着：推过线索验证缺需求状态照拦、照记（线索验证，缺项照列）", async () => {
    await 规则();
    const p = await 项目({ node: "线索验证" });
    expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 缺有效沟通还差(["需求（需求状态）"]) });
    const 行 = await 记录();
    expect(行).toHaveLength(1);
    expect(行[0]).toMatchObject({ kind: "线索验证", node: "线索验证", entry: "其他" });
    expect(JSON.parse(行[0].missing)).toEqual(["需求（需求状态）"]);
  });

  it("前两节点要沟通开着、本节点没沟通：记「本节点沟通」", async () => {
    await 规则({ 阶段: { 前两节点要沟通: true } });
    const p = await 项目({ node: "线索验证" });
    expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 缺本节点沟通("线索验证") });
    const 行 = await 记录();
    expect(行.map((x) => [x.kind, JSON.parse(x.missing)])).toEqual([["本节点沟通", ["线索验证的沟通"]]]);
  });

  it("没权限、往后退不记", async () => {
    await 规则({ 节点推进: { 开: true, 必填: { 潜客培育: ["项目级别"], 线索验证: ["项目级别"] } } });
    const p = await 项目();
    // 丙不是负责人：没权限，不是缺必填
    const r = await 改节点(丙, p.id, { phase: "线索", node: "线索验证" });
    expect(r.ok).toBe(false);
    const q = await 项目({ node: "线索验证", name: "二号" });
    expect(await 改节点(乙, q.id, { phase: "线索", node: "潜客培育" })).toMatchObject({ ok: true });
    expect(await 记录()).toEqual([]);
  });

  it("界面交的入口不在白名单里一律记「其他」；改项目节点 把入口带下去", async () => {
    expect(认入口("看板拖动")).toBe("看板拖动");
    expect(认入口("随便写")).toBe("其他");
    expect(认入口(undefined)).toBe("其他");
    await 规则({ 节点推进: { 开: true, 必填: { 潜客培育: ["项目级别"] } } });
    const p = await 项目();
    expect((await 改项目节点(p.id, { phase: "线索", node: "线索验证", result: null }, null, null, "首页AI")).ok).toBe(false);
    expect((await 记录()).map((x) => x.entry)).toEqual(["首页AI"]);
  });

  it("不是企业版：不记", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const p = await 项目();
    expect(await 记必填拦截(prisma, { userId: 乙.id, p, 种: "节点必填", 缺: ["项目级别"], 入口: "其他" })).toBe(false);
    expect(await 记录()).toEqual([]);
  });
});

describe("界面上拦下（不经服务端推进）也记", () => {
  it("项目页补填框弹出：服务端自己算还差；齐了、不是负责人、不管的项目都不记", async () => {
    await 规则({ 节点推进: { 开: true, 必填: { 潜客培育: ["项目级别"] } } });
    const p = await 项目();
    await 记完成节点被拦(p.id);
    const 行 = await 记录();
    expect(行).toHaveLength(1);
    expect(行[0]).toMatchObject({ kind: "节点必填", entry: "完成节点", toNode: "线索验证" });
    // 丙看得到也不记（推不了）
    mocks.user = { ...mocks.user, id: 丙.id };
    const q = await 项目({ name: "二号" });
    await 记完成节点被拦(q.id);
    mocks.user = { ...mocks.user, id: 乙.id };
    // 齐了的不记
    const s = await 项目({ name: "三号", level: "A" });
    await 记完成节点被拦(s.id);
    expect((await 记录()).map((x) => x.projectId)).toEqual([p.id]);
  });

  it("项目页灰按钮（推过线索验证缺需求状态、开关关着）：记「线索验证」；不是负责人不记", async () => {
    await 规则();
    const p = await 项目({ node: "线索验证" });
    mocks.user = { ...mocks.user, id: 丙.id };
    await 记完成节点被拦(p.id);
    expect(await 记录()).toEqual([]);
    mocks.user = { ...mocks.user, id: 乙.id };
    await 记完成节点被拦(p.id);
    const 行 = await 记录();
    expect(行.map((x) => [x.kind, x.entry, x.toNode, JSON.parse(x.missing)])).toEqual([["线索验证", "完成节点", "线索推进", ["需求（需求状态）"]]]);
  });

  it("看板拖动预检缺必填：记一行、入口看板拖动；随后真推被拦 10 分钟内不重复记", async () => {
    await 规则({ 节点推进: { 开: true, 必填: { 潜客培育: ["项目级别"] } } });
    const p = await 项目();
    expect(await 看板推进预检(p.id, { phase: "线索", node: "线索验证", result: null })).toEqual({ ok: true, 还差: ["项目级别"] });
    await 改节点(乙, p.id, { phase: "线索", node: "线索验证" }, undefined, { 入口: "看板拖动" });
    const 行 = await 记录();
    expect(行.map((x) => x.entry)).toEqual(["看板拖动"]);
  });
});

describe("导出：卡了多久、卡超 24 小时、按节点", () => {
  it("离开节点按之后第一次节点变更算；还没离开算到导出那一刻；按节点分布", async () => {
    const 今 = new Date("2026-11-23T12:00:00Z");
    const 时 = (h: number) => new Date(今.getTime() - h * 3_600_000);
    const a = await 项目({ name: "甲项目" });
    const b = await 项目({ name: "乙项目", node: "线索验证" });
    const c = await 项目({ name: "丙项目" });
    const 行 = (p: { id: string; node: string }, at: Date, kind = "节点必填") =>
      prisma.entRequiredBlock.create({ data: { at, userId: 乙.id, projectId: p.id, customerId: 客户, phase: "线索", node: p.node, kind, missing: JSON.stringify(["项目级别"]), entry: "完成节点" } });
    // 甲：48 小时前被拦两次，30 小时前推过去 → 卡 18 小时（不超 24）
    await 行(a, 时(48));
    await 行(a, 时(47.9));
    await prisma.projectNodeLog.create({ data: { projectId: a.id, userId: 乙.id, at: 时(30), fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "线索验证" } });
    // 乙：30 小时前被拦，一直没推 → 卡 30 小时（超 24）
    await 行(b, 时(30), "线索验证");
    // 丙：50 小时前被拦，2 小时前推过去 → 卡 48 小时（超 24）
    await 行(c, 时(50));
    await prisma.projectNodeLog.create({ data: { projectId: c.id, userId: 乙.id, at: 时(2), fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "线索验证" } });
    const d = await 读拦截导出(时(24 * 7), 今);
    expect(d.汇总).toMatchObject({ 次数: 4, 项目数: 3, 卡超24小时项目数: 2 });
    expect(d.按节点.行).toEqual([["线索·潜客培育", 3, 2, 1, 0], ["线索·线索验证", 1, 1, 1, 1]]);
    const 列 = (名: string) => d.明细.表头.indexOf(名);
    // 明细按时间排：最早的是丙（50 小时前）
    expect(d.明细.行[0][列("项目")]).toBe("丙项目");
    const 甲行 = d.明细.行[1];
    expect(甲行[列("客户编号")]).toBe("NO.00123");
    expect(甲行[列("项目")]).toBe("甲项目");
    expect(甲行[列("缺哪几项")]).toBe("项目级别");
    expect(甲行[列("卡了多久（小时）")]).toBe("18");
    const 乙行 = d.明细.行.find((r) => r[列("项目")] === "乙项目")!;
    expect(乙行[列("之后离开这个节点")]).toBe("还没推过去");
    expect(乙行[列("卡了多久（小时）")]).toBe("30");
  });
});
