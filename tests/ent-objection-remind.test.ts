import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 提异议 as 提异议核 } from "@/lib/enterprise/objection";
import { 裁定 } from "@/lib/enterprise/objection-judge";
import { 钟上待裁提醒, 钟上手工退回提醒 } from "@/lib/enterprise/objection-remind";

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



/** 转让异议两类提醒（E-436 二 / E-444 ⑦）。人名、客户名、项目名都是编造的。 */
const 北京 = (s: string) => new Date(`${s}+08:00`);
const 提醒们 = (userId: string) => prisma.entNotice.findMany({ where: { userId, dedupeKey: { startsWith: "objection-remind:" } }, orderBy: { createdAt: "asc" } });
const 退回提醒们 = (userId: string) => prisma.entNotice.findMany({ where: { userId, dedupeKey: { startsWith: "objection-manual-return:" } } });

/** 组长把销售的客户转给接手人，销售提异议，得到一条待裁定的客户异议；提于改成给定时刻 */
async function 一条待裁(提于: string) {
  const a = await 客户(销售.id, { bizLine: "内贸" });
  当(组长);
  const r = await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回" });
  expect(r).toMatchObject({ ok: true, updated: 1 });
  const 行 = (await prisma.entTransferObjection.findMany({ where: { kind: "客户" } }))[0];
  当(销售);
  expect((await 提异议核(销售, 行.id, "这单我在跟")).ok).toBe(true);
  return prisma.entTransferObjection.update({ where: { id: 行.id }, data: { submittedAt: 北京(提于) } });
}
/** 直接造一条待手工退回（不走裁定流程，只验提醒），裁定于给定时刻 */
async function 一条待手工退回(裁定于: string, 对象 = "客户") {
  const a = await 客户(销售.id, { bizLine: "内贸" });
  return prisma.entTransferObjection.create({
    data: {
      ownerLogId: `log${++号}`, customerId: a.id, kind: "客户", targetKey: `customer${号}`, targetName: `${对象}${号}`,
      objectorUserId: 销售.id, operatorUserId: 组长.id, toOwnerId: 接手.id, status: "待手工退回", expiresAt: 北京("2027-01-30T00:00:00"),
      reason: "我在跟", submittedAt: 北京(裁定于), judgedAt: 北京(裁定于), judgedById: 线总管.id, judgeNote: "撤回",
    },
  });
}

describe("待裁定满 5 个工作日提醒（每满 5 个再提醒，带第 N 次）", () => {
  it("满 5 / 10 / 15 个工作日各发一次，标题带第 1 / 2 / 3 次提醒", async () => {
    // 2026-12-01 周二提；之后工作日：2,3,4,7(周一)… 第 5 个 = 12-07 周一？12-02 周三=1,3=2,4=3,7=4,8=5 → 12-08
    const 行 = await 一条待裁("2026-12-01T10:00:00");
    await 钟上待裁提醒(北京("2026-12-07T09:00:00"));
    expect(await 提醒们(老板.id)).toHaveLength(0);
    await 钟上待裁提醒(北京("2026-12-08T09:00:00"));
    let n = await 提醒们(老板.id);
    expect(n).toHaveLength(1);
    expect(n[0].title).toContain("第 1 次提醒");
    expect(n[0].title).toContain("5 个工作日");
    expect(n[0].link).toBe(`/objections?o=${行.id}`);
    await 钟上待裁提醒(北京("2026-12-15T09:00:00")); // 12-09,10,11,14,15 = 10
    await 钟上待裁提醒(北京("2026-12-22T09:00:00")); // 16,17,18,21,22 = 15
    n = await 提醒们(老板.id);
    expect(n.map((x) => x.title.match(/第 (\d) 次提醒/)?.[1])).toEqual(["1", "2", "3"]);
    expect(n[2].title).toContain("15 个工作日");
  });

  it("08:00 前不发；同一天重复跑不重发；周末不算工作日", async () => {
    await 一条待裁("2026-12-01T10:00:00");
    await 钟上待裁提醒(北京("2026-12-08T07:59:00"));
    expect(await 提醒们(老板.id)).toHaveLength(0);
    await 钟上待裁提醒(北京("2026-12-08T08:00:00"));
    await 钟上待裁提醒(北京("2026-12-08T09:00:00"));
    await setSetting("entObjRemindJudgeDay", "");
    await 钟上待裁提醒(北京("2026-12-08T10:00:00"));
    expect(await 提醒们(老板.id)).toHaveLength(1);
  });

  it("跨法定节假日顺延：国庆放假不算，调休上班的周六算", async () => {
    // 2026-09-28 周一提；9-29=1，9-30=2，10-1~7 放假，10-8=3，10-9=4，10-10（周六调休上班）=5
    await 一条待裁("2026-09-28T10:00:00");
    await 钟上待裁提醒(北京("2026-10-05T09:00:00"));
    await 钟上待裁提醒(北京("2026-10-09T09:00:00"));
    expect(await 提醒们(老板.id)).toHaveLength(0);
    await 钟上待裁提醒(北京("2026-10-10T09:00:00"));
    expect(await 提醒们(老板.id)).toHaveLength(1);
  });

  it("裁定后不再发（维持 / 撤回都一样）", async () => {
    const 行 = await 一条待裁("2026-12-01T10:00:00");
    当(老板);
    const r = await 裁定(老板, 行.id, "维持", "说明");
    expect(r.ok).toBe(true);
    await 钟上待裁提醒(北京("2026-12-08T09:00:00"));
    expect(await 提醒们(老板.id)).toHaveLength(0);
  });

  it("发给当前裁定人和全部在职系统管理员；停用的、销售、异议人、接手人不收", async () => {
    await prisma.user.update({ where: { id: 副管.id }, data: { role: "ADMIN" } });
    const 停 = await 建("stopped", "ADMIN");
    await prisma.user.update({ where: { id: 停.id }, data: { active: false } });
    await prisma.entMember.create({ data: { userId: 停.id, bizRole: "director" } });
    await 一条待裁("2026-12-01T10:00:00");
    await 钟上待裁提醒(北京("2026-12-08T09:00:00"));
    for (const p of [线总管, 老板, 副管]) expect(await 提醒们(p.id)).toHaveLength(1);
    for (const p of [停, 销售, 接手, 组长, 同事]) expect(await 提醒们(p.id)).toHaveLength(0);
  });

  it("钟停了几天再起：只补当下该发的那一次，不一口气补 1..N", async () => {
    await 一条待裁("2026-12-01T10:00:00");
    await 钟上待裁提醒(北京("2026-12-22T09:00:00"));
    const n = await 提醒们(老板.id);
    expect(n).toHaveLength(1);
    expect(n[0].title).toContain("第 3 次提醒");
  });
});

describe("待手工退回超过 3 个工作日没处理：提醒系统管理员（每条一次、同天合成一条）", () => {
  it("裁定后第 3 个工作日到点发；前一天不发；只发在职系统管理员", async () => {
    await prisma.user.update({ where: { id: 副管.id }, data: { role: "ADMIN" } });
    await 一条待手工退回("2026-12-01T10:00:00"); // 12-02,03,04 = 3 → 12-04 周五到点
    await 钟上手工退回提醒(北京("2026-12-03T09:00:00"));
    expect(await 退回提醒们(老板.id)).toHaveLength(0);
    await 钟上手工退回提醒(北京("2026-12-04T09:00:00"));
    for (const p of [老板, 副管]) expect(await 退回提醒们(p.id)).toHaveLength(1);
    for (const p of [线总管, 组长, 销售, 接手]) expect(await 退回提醒们(p.id)).toHaveLength(0);
  });

  it("同一天到点的两条合成一条；第二天不重发同一条", async () => {
    await 一条待手工退回("2026-12-01T10:00:00");
    await 一条待手工退回("2026-12-01T15:00:00");
    await 钟上手工退回提醒(北京("2026-12-04T09:00:00"));
    const n = await 退回提醒们(老板.id);
    expect(n).toHaveLength(1);
    expect(n[0].title).toContain("2 条");
    await 钟上手工退回提醒(北京("2026-12-07T09:00:00"));
    await 钟上手工退回提醒(北京("2026-12-08T09:00:00"));
    expect(await 退回提醒们(老板.id)).toHaveLength(1);
  });

  it("不同天到点的各发一条，一天最多一条", async () => {
    await 一条待手工退回("2026-12-01T10:00:00");
    await 一条待手工退回("2026-12-02T10:00:00"); // 到点 12-07
    await 钟上手工退回提醒(北京("2026-12-04T09:00:00"));
    await 钟上手工退回提醒(北京("2026-12-04T10:00:00"));
    await 钟上手工退回提醒(北京("2026-12-07T09:00:00"));
    expect(await 退回提醒们(老板.id)).toHaveLength(2);
  });

  it("到点前已处理掉（不再是待手工退回）不发；08:00 前不发", async () => {
    const 行 = await 一条待手工退回("2026-12-01T10:00:00");
    await 钟上手工退回提醒(北京("2026-12-04T07:59:00"));
    expect(await 退回提醒们(老板.id)).toHaveLength(0);
    await prisma.entTransferObjection.update({ where: { id: 行.id }, data: { status: "已退回" } });
    await 钟上手工退回提醒(北京("2026-12-04T09:00:00"));
    expect(await 退回提醒们(老板.id)).toHaveLength(0);
  });

  it("跨节假日顺延", async () => {
    await 一条待手工退回("2026-09-30T10:00:00"); // 10-1~7 放假，10-8=1，10-9=2，10-10（调休上班）=3
    await 钟上手工退回提醒(北京("2026-10-09T09:00:00"));
    expect(await 退回提醒们(老板.id)).toHaveLength(0);
    await 钟上手工退回提醒(北京("2026-10-10T09:00:00"));
    expect(await 退回提醒们(老板.id)).toHaveLength(1);
  });
});
