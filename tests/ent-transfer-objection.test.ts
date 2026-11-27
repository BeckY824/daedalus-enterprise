/**
 * 12-22 第 2 阶段 A 段：转让通知 + 提异议（判定页 #7 #8 #18，终审 1）。
 *   - 直接转（上级 / 条线总管理 / 系统管理员）时：随客户转的在推项目的同事、被换掉的客户负责人，各记一行异议入口（30 天）+ 通知带「提异议」链接；
 *     保留的同事项目只收知会（不带异议、不记行）
 *   - 提异议：理由必填、≤200 字；30 天外不能提；同一条只能提一次（并发也只成一次）
 *   - 裁定人 = 让这次变动生效的人的上一级：实线上级办 → 条线总管理；条线总管理 / 系统管理员办 → 系统管理员；提交后通知裁定人
 * 人名、客户名都是编造的；时间用转让那一刻往后推，不依赖真钟。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 提异议 as 提异议动作 } from "@/app/(app)/objections/actions";
import { 提异议, 我的异议 } from "@/lib/enterprise/objection";
import { 算裁定人, 异议期天数, 异议理由上限 } from "@/lib/enterprise/objection-core";
import { 读组织 } from "@/lib/enterprise/org";

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

beforeEach(async () => {
  await resetDb();
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
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

/** 组长把销售的客户转给接手人：同事在推两个项目，勾转其中一个（同事），留一个（同事二） */
async function 转一单(操作: 人 = 组长) {
  const a = await 客户(销售.id, { bizLine: "内贸" });
  const 转的 = await 项目(a.id, 同事.id);
  const 留的 = await 项目(a.id, 同事二.id);
  当(操作);
  const r = await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回", 随转: [转的.id] });
  expect(r).toMatchObject({ ok: true, updated: 1 });
  return { a, 转的, 留的 };
}

describe("通知发给谁", () => {
  it("随客户转的同事：通知带提异议链接 + 一行可提；被换掉的客户负责人：同样；保留的同事只有知会、不带异议、没有行", async () => {
    const { a, 转的 } = await 转一单();
    const 行 = await 行们();
    expect(行).toHaveLength(2);
    const 项目行 = 行.find((r) => r.kind === "项目")!;
    const 客户行 = 行.find((r) => r.kind === "客户")!;
    expect(项目行).toMatchObject({ objectorUserId: 同事.id, projectId: 转的.id, customerId: a.id, operatorUserId: 组长.id, toOwnerId: 接手.id, status: "可提" });
    expect(客户行).toMatchObject({ objectorUserId: 销售.id, projectId: null, status: "可提" });
    expect(项目行.expiresAt.getTime() - 项目行.createdAt.getTime()).toBeGreaterThan((异议期天数 - 1) * 日);
    const 同事知 = (await 通知们(同事.id)).filter((n) => n.title.includes("随客户一起给了"));
    expect(同事知).toHaveLength(1);
    expect(同事知[0].link).toBe(`/objections?o=${项目行.id}`);
    expect(同事知[0].body).toContain("提异议");
    const 销售知 = (await 通知们(销售.id)).filter((n) => n.title.includes("改给了"));
    expect(销售知).toHaveLength(1);
    expect(销售知[0].link).toBe(`/objections?o=${客户行.id}`);
    expect(销售知[0].body).toContain("提异议");
    // 保留的同事：只有「不变，仍归你」知会，没有异议字样、没有行
    const 留知 = (await 通知们(同事二.id)).filter((n) => n.title.includes("仍归你"));
    expect(留知).toHaveLength(1);
    expect(`${留知[0].title}${留知[0].body}${留知[0].link ?? ""}`).not.toContain("异议");
    expect(行.some((r) => r.objectorUserId === 同事二.id)).toBe(false);
    // 点转让的人、接手人没有异议入口
    expect(行.some((r) => r.objectorUserId === 组长.id || r.objectorUserId === 接手.id)).toBe(false);
  });

  it("负责人本人转（申请移交）、没有随转项目：不记行；同事项目全保留时只有被换掉的客户负责人那一行", async () => {
    const a = await 客户(销售.id);
    await 项目(a.id, 同事.id);
    当(销售);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "x" })).toMatchObject({ ok: true });
    expect(await 行们()).toHaveLength(0);
    const b = await 客户(销售.id);
    await 项目(b.id, 同事.id);
    当(组长);
    expect(await assignSalesOwner([b.id], 接手.id, null, undefined, { 说明: "转走" })).toMatchObject({ ok: true });
    const 行 = await 行们();
    expect(行.map((r) => [r.kind, r.objectorUserId])).toEqual([["客户", 销售.id]]);
  });
});

describe("提异议：必填、长度、30 天、只提一次", () => {
  it("理由空 / 全空格 / 超 200 字都拦，行还是可提；别人的入口当没有", async () => {
    await 转一单();
    const 行 = (await 行们()).find((r) => r.objectorUserId === 同事.id)!;
    for (const 话 of ["", "   ", undefined, 123]) {
      expect(await 提异议(同事, 行.id, 话)).toMatchObject({ ok: false, error: expect.stringContaining("理由") });
    }
    expect(await 提异议(同事, 行.id, "x".repeat(异议理由上限 + 1))).toMatchObject({ ok: false, error: expect.stringContaining(String(异议理由上限)) });
    expect(await 提异议(同事二, 行.id, "我也要提")).toMatchObject({ ok: false, error: expect.stringContaining("没找到") });
    expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } })).status).toBe("可提");
    // 刚好 200 字过
    expect(await 提异议(同事, 行.id, "字".repeat(异议理由上限))).toMatchObject({ ok: true });
  });

  it("第 30 天内能提，超过 30 天不能提，行仍是可提", async () => {
    await 转一单();
    const [甲, 乙] = (await 行们()).filter((r) => r.kind === "客户" || r.kind === "项目");
    const 起 = 甲.expiresAt.getTime() - 异议期天数 * 日;
    const 甲人 = 甲.objectorUserId === 同事.id ? 同事 : 销售;
    const 乙人 = 乙.objectorUserId === 同事.id ? 同事 : 销售;
    expect(await 提异议(甲人, 甲.id, "理由", new Date(起 + 29 * 日))).toMatchObject({ ok: true });
    expect(await 提异议(乙人, 乙.id, "理由", new Date(甲.expiresAt.getTime() + 1000))).toMatchObject({ ok: false, error: expect.stringContaining("30 天") });
    expect((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 乙.id } })).status).toBe("可提");
    // 过期没提的不再出现在「能提」里
    const 列 = await 我的异议(乙人.id, new Date(乙.expiresAt.getTime() + 1000));
    expect(列.能提).toHaveLength(0);
  });

  it("重复提同一条拦住：第二次报已提过；并发双击只成一次，裁定人只收一条通知", async () => {
    await 转一单();
    const 行 = (await 行们()).find((r) => r.objectorUserId === 同事.id)!;
    当(同事);
    const 同时 = await Promise.all([提异议动作(行.id, "第一次"), 提异议动作(行.id, "第二次")]);
    expect(同时.filter((r) => r.ok)).toHaveLength(1);
    expect(同时.filter((r) => !r.ok)[0]).toMatchObject({ error: expect.stringContaining("已经提过") });
    expect(await 提异议(同事, 行.id, "再来")).toMatchObject({ ok: false, error: expect.stringContaining("已经提过") });
    const 新 = await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } });
    expect(新).toMatchObject({ status: "待裁定", judgeRole: "条线总管理" });
    expect(新.reason === "第一次" || 新.reason === "第二次").toBe(true);
    expect((await 通知们(线总管.id)).filter((n) => n.kind === "异议")).toHaveLength(1);
  });

  it("提交后：记理由、时间、裁定人，通知裁定人（带理由），「我提的异议」里出现", async () => {
    await 转一单();
    const 行 = (await 行们()).find((r) => r.objectorUserId === 同事.id)!;
    当(同事);
    const r = await 提异议动作(行.id, "这单下周签，客户只认我");
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("条线总管理") });
    const 新 = await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } });
    expect(新.reason).toBe("这单下周签，客户只认我");
    expect(新.submittedAt).not.toBeNull();
    expect(JSON.parse(新.judgeIds!)).toEqual([线总管.id]);
    const 知 = (await 通知们(线总管.id)).filter((n) => n.kind === "异议");
    expect(知).toHaveLength(1);
    expect(知[0].title).toContain(同事.name);
    expect(知[0].body).toContain("客户只认我");
    const 列 = await 我的异议(同事.id);
    expect(列.能提).toHaveLength(0);
    expect(列.已提).toMatchObject([{ 状态: "待裁定", 裁定角色: "条线总管理" }]);
  });
});

describe("裁定人 = 让这次变动生效的人的上一级", () => {
  it("实线上级办 → 条线总管理；条线总管理办 → 系统管理员；系统管理员办 → 其他系统管理员", async () => {
    const org = await 读组织();
    expect(算裁定人(org, 组长.id, "内贸", 销售.id, 同事.id)).toEqual({ ids: [线总管.id], 角色: "条线总管理" });
    const 条线办 = 算裁定人(org, 线总管.id, "内贸", 销售.id, 同事.id);
    expect(条线办.角色).toBe("系统管理员");
    expect([...条线办.ids].sort()).toEqual([老板.id, 副管.id].sort());
    const 管理员办 = 算裁定人(org, 老板.id, "内贸", 销售.id, 同事.id);
    expect(管理员办).toEqual({ ids: [副管.id], 角色: "系统管理员" });
    // 异议人本人不当裁定人（销售被换，客户负责人自己提异议，裁定人是线总管）
    expect(算裁定人(org, 组长.id, "内贸", 销售.id, 线总管.id).角色).toBe("系统管理员");
  });

  it("那条线没有条线总管理：实线上级办的退到系统管理员；只有一位系统管理员办的只能是他自己", async () => {
    await prisma.entMember.update({ where: { userId: 线总管.id }, data: { line: "外贸" } });
    const org = await 读组织();
    const 无线 = 算裁定人(org, 组长.id, "内贸", 销售.id, 同事.id);
    expect(无线.角色).toBe("系统管理员");
    expect([...无线.ids].sort()).toEqual([老板.id, 副管.id].sort());
    await prisma.entMember.delete({ where: { userId: 副管.id } });
    const org2 = await 读组织();
    expect(算裁定人(org2, 老板.id, "内贸", 销售.id, 同事.id)).toEqual({ ids: [老板.id], 角色: "系统管理员" });
  });

  it("端到端：条线总管理转的，裁定人是系统管理员，都收到通知", async () => {
    await 转一单(线总管);
    const 行 = (await 行们()).find((r) => r.objectorUserId === 同事.id)!;
    expect(行.operatorUserId).toBe(线总管.id);
    当(同事);
    expect(await 提异议动作(行.id, "我不同意")).toMatchObject({ ok: true, message: expect.stringContaining("系统管理员") });
    for (const 管 of [老板, 副管]) expect((await 通知们(管.id)).filter((n) => n.kind === "异议")).toHaveLength(1);
    expect((await 通知们(线总管.id)).filter((n) => n.kind === "异议")).toHaveLength(0);
  });

  it("端到端：系统管理员转的，裁定人是另一位系统管理员", async () => {
    await 转一单(老板);
    const 行 = (await 行们()).find((r) => r.objectorUserId === 销售.id)!;
    当(销售);
    expect(await 提异议动作(行.id, "客户是我拉来的")).toMatchObject({ ok: true });
    expect(JSON.parse((await prisma.entTransferObjection.findUniqueOrThrow({ where: { id: 行.id } })).judgeIds!)).toEqual([副管.id]);
  });
});
