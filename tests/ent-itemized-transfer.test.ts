/**
 * 12-22 第 1 阶段：客户转让逐项选 + 必填原因留痕（判定页 二-2…6、9；终审 5、7）。
 *   - 上级直接转别人的客户：原因必填（服务端拦空）；同事在推的项目默认保留，逐项勾「随客户转」的才换负责人
 *   - 随转的同事收「随客户一起给了」，保留的收「不变，仍归你」知会
 *   - 负责人本人转（申请移交）：同事项目一律不带，收到随转 id 直接拒
 *   - 上级直接转时负责人本人等确认的申请作废，通知本人和原接手人
 *   - 换负责人记录带原因、最近跟进、重复咨询次数；取不到写「—」
 * 不写死日期、不依赖真钟：跟进时间用固定常量。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { assignSalesOwner, patchCustomer, saveCustomer, 转走项目预览of } from "@/app/(app)/customers/actions";
import { 历史负责人of } from "@/lib/owner-log-db";
import { 转让留痕一句 } from "@/lib/owner-log";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 销售: 人, 接手: 人, 同事: 人, 同事二: 人;
let 号 = 0;
const 固定跟进 = new Date("2026-01-05T08:00:00.000Z");

async function 建(email: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进", lastFollowAt: 固定跟进 } });
const 项目 = (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: `项目${++号}`, customerId, ownerId, creatorId: ownerId, phase: "线索", ...extra } });
const 负责人of = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 通知们 = (userId: string) => prisma.entNotice.findMany({ where: { userId } });

beforeEach(async () => {
  await resetDb();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales");
  接手 = await 建("taker");
  同事 = await 建("peer");
  同事二 = await 建("peer2");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      ...[销售, 接手, 同事, 同事二].map((u) => ({ userId: u.id, managerId: 组长.id, bizRole: "sales" })),
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting("enterprise.rule.handover_confirm", false);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("上级直接转：原因必填 + 逐项选同事项目", () => {
  it("原因空（或全是空格）服务端拦，什么都没动", async () => {
    当(组长);
    const a = await 客户(销售.id);
    for (const 说明 of [undefined, "", "   "]) {
      expect(await assignSalesOwner([a.id], 接手.id, null, undefined, 说明 === undefined ? undefined : { 说明 })).toMatchObject({ ok: false, error: expect.stringContaining("转让原因") });
    }
    expect(await 归谁(a.id)).toBe(销售.id);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "x".repeat(201) })).toMatchObject({ ok: false });
  });

  it("默认保留：不勾，同事项目还归同事，客户和负责人自己的项目转走；保留的同事收知会", async () => {
    当(组长);
    const a = await 客户(销售.id);
    const 自己的 = await 项目(a.id, 销售.id);
    const 同事的 = await 项目(a.id, 同事.id);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "客户说连着两周没人回" })).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(a.id)).toBe(接手.id);
    expect(await 负责人of(自己的.id)).toBe(接手.id);
    expect(await 负责人of(同事的.id)).toBe(同事.id);
    const 知 = (await 通知们(同事.id)).filter((n) => n.title.includes("仍归你"));
    expect(知).toHaveLength(1);
    expect(知[0].title).toContain(同事的.name);
  });

  it("逐项勾：随客户转的换成接手人并通知，没勾的不动；已结束 / 公海 / 负责人自己的不在可选里", async () => {
    当(老板);
    const a = await 客户(销售.id);
    const 转的 = await 项目(a.id, 同事.id);
    const 留的 = await 项目(a.id, 同事二.id);
    await 项目(a.id, 同事.id, { result: "流失" });
    const 预览 = await 转走项目预览of([a.id], 接手.id, true);
    expect(预览).toMatchObject({ 要说明: true, 要确认: false });
    expect(预览.同事在推?.map((p) => p.id).sort()).toEqual([转的.id, 留的.id].sort());
    expect(预览.同事在推?.[0]).toMatchObject({ 负责人: expect.any(String), 阶段: "线索" });
    expect(预览.项目数).toBe(0);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "老板口头定的", 随转: [转的.id] })).toMatchObject({ ok: true });
    expect(await 负责人of(转的.id)).toBe(接手.id);
    expect(await 负责人of(留的.id)).toBe(同事二.id);
    expect((await 通知们(同事.id)).filter((n) => n.title.includes("随客户一起给了"))).toHaveLength(1);
    expect((await 通知们(同事二.id)).filter((n) => n.title.includes("仍归你"))).toHaveLength(1);
  });

  it("勾了不属于这位客户同事在推的项目（已结束的）：拒，什么都没动；批量多位客户不收随转", async () => {
    当(老板);
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    const 结束的 = await 项目(a.id, 同事.id, { result: "流失" });
    const 在推 = await 项目(a.id, 同事.id);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "原因", 随转: [结束的.id] })).toMatchObject({ ok: false });
    expect(await assignSalesOwner([a.id, b.id], 接手.id, null, undefined, { 说明: "原因", 随转: [在推.id] })).toMatchObject({ ok: false });
    expect(await 归谁(a.id)).toBe(销售.id);
  });

  it("历史变更留痕：原因、最近一次跟进、重复咨询次数；没跟进过写「—」", async () => {
    当(组长);
    const a = await 客户(销售.id);
    await 项目(a.id, 销售.id, { source: "repeat-inquiry", repeatOfCustomerId: a.id, repeatSeq: 1 });
    await 项目(a.id, 销售.id, { source: "repeat-inquiry", repeatOfCustomerId: a.id, repeatSeq: 2 });
    await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "  客户原话：太久没回  " });
    const [记] = await 历史负责人of(a.id);
    expect(记).toMatchObject({ 原因: "客户原话：太久没回", 重复咨询: 2 });
    expect(转让留痕一句(记)).toBe("原因：客户原话：太久没回；最近一次跟进：2026-01-05；重复咨询：2 次");
    const b = await 客户(销售.id);
    await prisma.customer.update({ where: { id: b.id }, data: { lastFollowAt: null } });
    await assignSalesOwner([b.id], 接手.id, null, undefined, { 说明: "原因乙" });
    expect(转让留痕一句((await 历史负责人of(b.id))[0])).toBe("原因：原因乙；最近一次跟进：—；重复咨询：0 次");
    expect(转让留痕一句({})).toBe("原因：—；最近一次跟进：—；重复咨询：—");
  });
});

describe("负责人本人发起：不出逐项选，同事项目一律不带", () => {
  it("预览不带 要说明；服务端拒收随转 id；确认后同事项目仍归同事", async () => {
    当(销售);
    const a = await 客户(销售.id);
    const 同事的 = await 项目(a.id, 同事.id);
    expect((await 转走项目预览of([a.id], 接手.id, true)).要说明).toBeUndefined();
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "x", 随转: [同事的.id] })).toMatchObject({ ok: false });
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, 申请移交: true });
    expect(await 负责人of(同事的.id)).toBe(同事.id);
  });
});

describe("上级直接转时作废负责人本人等确认的申请（终审 5）", () => {
  it("申请作废，本人和原接手人各收一条；客户按上级的转让生效", async () => {
    当(销售);
    const a = await 客户(销售.id);
    expect(await assignSalesOwner([a.id], 同事.id)).toMatchObject({ ok: true, 申请移交: true });
    const 申请 = await prisma.entHandover.findFirstOrThrow();
    当(组长);
    expect(await 转走项目预览of([a.id], 接手.id, true)).toMatchObject({ 要说明: true });
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "上级直接定" })).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(a.id)).toBe(接手.id);
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: 申请.id } })).status).toBe("已作废");
    expect((await 通知们(销售.id)).filter((n) => n.title.includes("申请已作废"))).toHaveLength(1);
    expect((await 通知们(同事.id)).filter((n) => n.title.includes("申请已作废"))).toHaveLength(1);
  });
});

describe("旁路关了：编辑页保存 / 行内改负责人都不能换人，换人只走转让", () => {
  it("上级、负责人本人：patchCustomer、saveCustomer 回「请用转让」，客户不动；没换人的保存照常", async () => {
    const a = await 客户(销售.id);
    for (const 谁 of [组长, 销售]) {
      当(谁);
      expect(await patchCustomer(a.id, "salesOwnerId", 接手.id)).toMatchObject({ ok: false, error: expect.stringContaining("请用「转让」") });
      const r = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
      const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
      // 上级编辑页本来就改不了客户资料（改客户挡在前），只看负责人本人的整表保存
      if (谁 === 销售) expect(await saveCustomer({ id: a.id, updatedAt: r.updatedAt.toISOString(), base, ...base, salesOwnerId: 接手.id } as Parameters<typeof saveCustomer>[0])).toMatchObject({ ok: false, error: expect.stringContaining("请用「转让」") });
    }
    expect(await 归谁(a.id)).toBe(销售.id);
    expect(await prisma.entHandover.count()).toBe(0);
    当(销售);
    expect(await patchCustomer(a.id, "remark", "写一句")).toMatchObject({ ok: true });
    expect(await patchCustomer(a.id, "salesOwnerId", 销售.id)).toMatchObject({ ok: true });
  });
});

describe("审查修复（12-22 阶段 1 复审）", () => {
  it("市场成员的客户走转让框转给销售（市场转一位、全带）：预览数 = 实际带走数", async () => {
    const 市场 = await 建("mkt");
    await prisma.entMember.create({ data: { userId: 市场.id, managerId: 组长.id, bizRole: "channel_ops" } });
    当(老板);
    const a = await 客户(市场.id);
    await 项目(a.id, 市场.id);
    await 项目(a.id, 同事.id);
    const 预 = await 转走项目预览of([a.id], 接手.id, true);
    expect(预.项目数).toBe(2);
    expect(预.要说明).toBeUndefined();
    const r = await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "市场转一位" });
    expect(r).toMatchObject({ ok: true, 带走: { 项目: 预.项目数 } });
  });

  it("部分作废：原接手人的「发起」通知不标已读，标题写明几位已被上级转走；申请里剩下的照旧待确认", async () => {
    当(销售);
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    expect(await assignSalesOwner([a.id, b.id], 同事.id)).toMatchObject({ ok: true, 申请移交: true });
    const 申请 = await prisma.entHandover.findFirstOrThrow();
    当(组长);
    expect(await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "上级直接定" })).toMatchObject({ ok: true, updated: 1 });
    const 后 = await prisma.entHandover.findUniqueOrThrow({ where: { id: 申请.id } });
    expect(后.status).toBe("待确认");
    expect(JSON.parse(后.customerIds)).toEqual([b.id]);
    const 发起 = await prisma.entNotice.findFirstOrThrow({ where: { userId: 同事.id, dedupeKey: `handover:${申请.id}:发起` } });
    expect(发起.readAt).toBeNull();
    expect(发起.title).toContain("其中 1 位已由");
    expect(发起.title).toContain("其余仍待你确认");
    // 原接手人只收到这一条，没有再补「已作废」；发起人那边说成部分作废
    const 接手的 = await 通知们(同事.id);
    expect(接手的.filter((n) => n.title.includes("已作废"))).toHaveLength(0);
    expect(接手的.filter((n) => n.title.includes("其余仍待你确认"))).toHaveLength(1);
    const 本人的 = await 通知们(销售.id);
    expect(本人的.filter((n) => n.title.includes("已作废"))).toHaveLength(0);
    expect(本人的.filter((n) => n.title.includes("其余仍待对方确认"))).toHaveLength(1);
  });

  it("全作废：原接手人的「发起」通知标已读", async () => {
    当(销售);
    const a = await 客户(销售.id);
    await assignSalesOwner([a.id], 同事.id);
    const 申请 = await prisma.entHandover.findFirstOrThrow();
    当(组长);
    await assignSalesOwner([a.id], 接手.id, null, undefined, { 说明: "上级直接定" });
    const 发起 = await prisma.entNotice.findFirstOrThrow({ where: { userId: 同事.id, dedupeKey: `handover:${申请.id}:发起` } });
    expect(发起.readAt).not.toBeNull();
  });

  it("saveCustomer：base 伪造成和提交值一样、但和库里现值不同，当作没动负责人（落成库里现值），转不了人；真改了负责人才回「请用转让」", async () => {
    const a = await 客户(销售.id);
    当(销售);
    const r = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: 接手.id, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
    // 12-22：旧表单没动负责人（base = 提交值）= 别人刚转走客户后只改了别的；负责人落成库里现值，不转给提交值上的人
    await saveCustomer({ id: a.id, updatedAt: r.updatedAt.toISOString(), base, ...base } as Parameters<typeof saveCustomer>[0]);
    expect(await 归谁(a.id)).toBe(销售.id);
    // 提交值和 base 不同 = 真改了负责人，照旧回「请用转让」
    expect(await saveCustomer({ id: a.id, updatedAt: r.updatedAt.toISOString(), base: { ...base, salesOwnerId: 销售.id }, ...base } as Parameters<typeof saveCustomer>[0])).toMatchObject({ ok: false, error: expect.stringContaining("请用「转让」") });
    expect(await 归谁(a.id)).toBe(销售.id);
  });
});
