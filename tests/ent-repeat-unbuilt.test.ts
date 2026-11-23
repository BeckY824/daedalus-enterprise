/**
 * 「挂靠申请」页「重复咨询待补建」+ 补建 / 不补建（lib/enterprise/repeat-unbuilt.ts，P-公海-15 后半，客户 E-227 三处默认）：
 *   - 补建三种落点（按点的那一刻）：客户负责人能接 → 他名下（指定分配）；还不能 → 按区域自动分配；还挑不到 → 回「要手选」+ 这条线能接的销售，选一位再点
 *   - 建法同出口 C：项目名「重复咨询-编号」、来源 / 原始客户 / 序号、创建人 = 交的市场同事；渠道、对接人、沟通用记录里的，沟通记录人 = 市场同事、时间照当时、标建项目带出
 *   - 补建后：记录「已补建」+ 谁 / 几点 / 补成哪条线索；接手销售收分配通知、市场同事收「已补建」；操作日志
 *   - 不补建必须写原因，标已关闭、通知市场同事
 *   - 客户进公海：进公海那一刻自动关；点的时候才发现在公海也就地关
 *   - 并发：两个人同时点补建同一条只成一次，后到的回「已被处理」
 *   - 谁看得到：这条线的销售管理、系统管理员看全部；交的市场同事只看自己的、只有客户编号；销售这一栏不出现、点不了
 *   - 出口 C 没建的那条通知点进来就是这一栏（link）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 自动分配不参与key, 不设配额key, 月份 } from "@/lib/enterprise/lead-assign";
import { 超时转生效key } from "@/lib/enterprise/reply-overdue";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 出口C建线索 } from "@/app/(app)/customers/repeat-inquiry-actions";
import { 出口C项目名, 规则关着为什么 } from "@/lib/enterprise/repeat-inquiry";
import { 补建待补建, 不补建待补建 } from "@/app/(app)/projects/attach/unbuilt-actions";
import {
  读待补建栏, 待补建栏链接, 不能处理待补建话, 不补建要原因话, 已被处理话, 要手选话, 补建成了话, 手选的人接不了话,
} from "@/lib/enterprise/repeat-unbuilt";
import { 读未建线索, 未建键, 进公海关原因 } from "@/lib/enterprise/unbuilt-record";
import { 记换负责人 } from "@/lib/owner-log-db";
import { 重复咨询来源 } from "@/lib/project/system-created";

type 人 = { id: string; name: string };
let 总管: 人, 市场: 人, 市场管: 人, 外贸甲: 人, 乙: 人, 内销管: 人, 外销管: 人;
let 老渠道: string, 新渠道: string;
let 进池 = 0;
async function 造人(key: string, name: string, bizRole: string, line?: string): Promise<人> {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role: "SALES", password: "x", createdAt: new Date(Date.UTC(2026, 0, 1 + ++进池)) } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(line ? { line } : {}) } });
  return { id: u.id, name };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };

let 序 = 0;
async function 同事客户(owner: string): Promise<{ id: string; 号: string; 王: string }> {
  序 += 1;
  const 号 = `1390000${String(序).padStart(4, "0")}`;
  const c = await prisma.customer.create({ data: { name: `老客户${序}`, phone: 号, salesOwnerId: owner, channelId: 老渠道, attributionChannelId: 老渠道, customerNo: 序 } });
  const 王 = await prisma.contact.create({ data: { name: "王经理", position: "采购", phone: 号, isPrimary: true, customerId: c.id } });
  await prisma.project.create({ data: { name: `旧项目${序}`, customerId: c.id, ownerId: owner, creatorId: owner, phase: "商机", node: "明确需求", channelId: 老渠道 } });
  return { id: c.id, 号, 王: 王.id };
}
const 沟通 = { type: "PHONE", content: "老客户来电问新一期报价", occurredAt: "2026-11-20 10:00" };
const 记一条 = (u: 人) => prisma.entLeadAssign.create({ data: { toUserId: u.id, fromUserId: 总管.id, byUserId: 总管.id, line: "内贸", kind: "营销", counted: true, month: 月份(), way: "自动分配" } });
const 设配额 = (u: 人, quota: number) => prisma.entLeadQuota.upsert({ where: { userId: u.id }, create: { userId: u.id, quota, setById: 总管.id }, update: { quota } });
const 上限 = async (每人: Record<string, number>) => {
  await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: 10, 每人上限: 每人 } });
  invalidateSettingsCache();
};
/** 这位客户台账上的待补建：键 + 记录 */
async function 待补建of(customerId: string) {
  const 行 = await prisma.entDupeHit.findFirstOrThrow({ where: { customerId, unbuilt: { not: null } } });
  return { 键: 未建键(行.id, 0), 记: 读未建线索(行.unbuilt)[0], 行 };
}

/** 落点 1 的样子：负责人外贸甲到持有上限，市场同事交 → 留待补建（到上限） */
async function 到上限留一条(对接人: object = { 名字: "李采购", 职务: "采购" }) {
  const c = await 同事客户(外贸甲.id);
  await 上限({ [外贸甲.id]: 1 });
  当(市场);
  expect(await 出口C建线索("手机号", c.号, 沟通, { 渠道: 新渠道, 对接人 })).toMatchObject({ ok: true, 没建: true });
  return c;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("boss", "总管某", "director");
  市场 = await 造人("mkt", "渠运某", "channel_ops");
  市场管 = await 造人("mktm", "市管某", "marketing_mgr");
  外贸甲 = await 造人("jia", "外贸甲某", "sales", "外贸");
  乙 = await 造人("yi", "销售乙某", "sales", "内贸");
  内销管 = await 造人("smgr1", "内销管某", "sales_mgr", "内贸");
  外销管 = await 造人("smgr2", "外销管某", "sales_mgr", "外贸");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [总管.id]: "禁止", [内销管.id]: "禁止", [外销管.id]: "禁止" });
  await setSetting(超时转生效key, "2020-01-01T00:00:00.000Z");
  invalidateSettingsCache();
  老渠道 = (await prisma.channel.create({ data: { name: "展会|首次", channelOwnerId: 总管.id } })).id;
  新渠道 = (await prisma.channel.create({ data: { name: "小红书|笔记", channelOwnerId: 总管.id } })).id;
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("补建三种落点", () => {
  it("落点 1：负责人这时能接了 → 建在他名下（指定分配）；建法同出口 C，沟通记录人是市场同事、时间照当时；记录已补建、两边收通知、留日志", async () => {
    const c = await 到上限留一条();
    const { 键, 记 } = await 待补建of(c.id);
    expect(记.状态).toBe("待补建");
    // 没人接那条通知点进来就是这一栏
    const 没人接通知 = await prisma.entNotice.findMany({ where: { kind: "待分配" } });
    expect(没人接通知.length).toBeGreaterThan(0);
    for (const n of 没人接通知) expect(n.link).toBe(待补建栏链接);
    // 放宽上限，外贸的销售管理点补建
    await 上限({});
    当(外销管);
    expect(await 补建待补建(键)).toEqual({ ok: true, 提示: 补建成了话(外贸甲.name, "负责人") });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    expect(p).toMatchObject({ name: 出口C项目名(序), ownerId: 外贸甲.id, creatorId: 市场.id, channelId: 新渠道, repeatOfCustomerId: c.id, repeatSeq: 1 });
    // 对接人：新的人这时才建
    const 对接 = await prisma.contact.findUniqueOrThrow({ where: { id: p.contactId! } });
    expect(对接).toMatchObject({ name: "李采购", position: "采购", isPrimary: false, customerId: c.id });
    // 沟通：记录人 = 市场同事、时间照当时填的、标建项目带出
    const f = await prisma.followUp.findFirstOrThrow({ where: { customerId: c.id } });
    expect(f).toMatchObject({ ownerId: 市场.id, content: "老客户来电问新一期报价", type: "PHONE" });
    expect(f.occurredAt.getTime()).toBe(new Date("2026-11-20T10:00:00+08:00").getTime());
    expect(await prisma.followUpProject.findFirstOrThrow({ where: { followUpId: f.id } })).toMatchObject({ projectId: p.id, withProjectCreate: true });
    // 分配记录：指定分配、计数；from = 市场同事、by = 点的人
    const 分 = await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: p.id } });
    expect(分).toMatchObject({ toUserId: 外贸甲.id, fromUserId: 市场.id, byUserId: 外销管.id, way: "指定分配", line: "外贸", counted: true });
    // 记录：已补建 + 谁 / 几点 / 补成哪条
    const 后 = (await 待补建of(c.id)).记;
    expect(后).toMatchObject({ 状态: "已补建", 处理: { 谁: { id: 外销管.id, 名: 外销管.name }, 线索: { id: p.id, 名: p.name, 接手人: { id: 外贸甲.id }, 落法: "负责人" } } });
    expect(Date.now() - new Date(后.处理!.时间).getTime()).toBeLessThan(60_000);
    // 通知：接手销售收分配通知、市场同事收「已补建」（链到这一栏，不带客户名）
    expect(await prisma.entNotice.count({ where: { userId: 外贸甲.id, link: { startsWith: `/projects/${p.id}` } } })).toBe(1);
    const 给市场 = await prisma.entNotice.findFirstOrThrow({ where: { userId: 市场.id, kind: "重复咨询待补建" } });
    expect(给市场.title).toContain("已补建");
    expect(给市场.link).toBe(待补建栏链接);
    expect(`${给市场.title}${给市场.body}`).not.toContain(`老客户${序}`);
    // 操作日志
    expect(await prisma.auditLog.count({ where: { entity: "Project", entityId: p.id, action: "create" } })).toBe(1);
  });

  it("落点 2：负责人还接不了 → 按区域自动分配（交销售那一套），记自动分配", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [内销管.id]: "禁止", [外销管.id]: "禁止", [外贸甲.id]: "暂停" });
    await setSetting(不设配额key, false);
    invalidateSettingsCache();
    await 设配额(乙, 1);
    await 记一条(乙);
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 出口C建线索("手机号", c.号, 沟通, { 渠道: 新渠道, 对接人: { 撞上的: true } })).toMatchObject({ ok: true, 没建: true });
    const { 键, 记 } = await 待补建of(c.id);
    expect(记).toMatchObject({ 类: "没人接", 线: "内贸" });
    // 乙的配额放开：内贸的销售管理补建 → 自动分给乙
    await 设配额(乙, 5);
    当(内销管);
    expect(await 补建待补建(键)).toEqual({ ok: true, 提示: 补建成了话(乙.name, "自动分配") });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    expect(p).toMatchObject({ ownerId: 乙.id, creatorId: 市场.id, contactId: c.王 });
    expect(await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: p.id } })).toMatchObject({ toUserId: 乙.id, way: "自动分配", counted: true });
    // 客户不动
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(外贸甲.id);
    expect((await 待补建of(c.id)).记.处理?.线索?.落法).toBe("自动分配");
  });

  it("落点 3：还挑不到 → 回要手选 + 这条线能接的销售；夹带不能接的人不认；选一位再点 → 指定分配给他", async () => {
    // 客户负责人是市场管理（不是销售，接不了）；规则「线索分配」关着 = 没有自动分配
    await setSetting(规则.线索分配.key, false);
    invalidateSettingsCache();
    const c = await 同事客户(市场管.id);
    当(市场);
    expect(await 出口C建线索("手机号", c.号, 沟通, { 渠道: 新渠道, 对接人: { 撞上的: true } })).toMatchObject({ ok: true, 没建: true });
    const { 键 } = await 待补建of(c.id);
    // 规则关着只通知系统管理员：系统管理员点
    当(总管);
    const r = await 补建待补建(键);
    expect(r).toMatchObject({ ok: false, 要手选: { 为什么: 规则关着为什么 } });
    const 候选 = "要手选" in r ? r.要手选.候选.map((x) => x.id) : [];
    expect(候选).toEqual(expect.arrayContaining([乙.id, 外贸甲.id]));
    expect(候选).not.toContain(市场.id);
    expect(候选).not.toContain(市场管.id);
    expect(要手选话(规则关着为什么)).toContain("选一位");
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(1);
    expect(await 补建待补建(键, 市场.id)).toEqual({ ok: false, error: 手选的人接不了话 });
    expect(await 补建待补建(键, 乙.id)).toEqual({ ok: true, 提示: 补建成了话(乙.name, "手选") });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    expect(p.ownerId).toBe(乙.id);
    expect(await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: p.id } })).toMatchObject({ toUserId: 乙.id, way: "指定分配", byUserId: 总管.id });
    expect((await 待补建of(c.id)).记.处理?.线索?.落法).toBe("手选");
  });
});

describe("不补建、进公海、并发", () => {
  it("不补建必须写原因；写了标已关闭、通知市场同事、留日志；之后再点补建 = 已被处理", async () => {
    const c = await 到上限留一条();
    const { 键 } = await 待补建of(c.id);
    当(外销管);
    expect(await 不补建待补建(键, "   ")).toEqual({ ok: false, error: 不补建要原因话 });
    expect((await 待补建of(c.id)).记.状态).toBe("待补建");
    expect(await 不补建待补建(键, "客户说只是问问价")).toMatchObject({ ok: true });
    const 记 = (await 待补建of(c.id)).记;
    expect(记).toMatchObject({ 状态: "已关闭", 处理: { 谁: { id: 外销管.id }, 原因: "客户说只是问问价" } });
    const n = await prisma.entNotice.findFirstOrThrow({ where: { userId: 市场.id, kind: "重复咨询待补建" } });
    expect(n.body).toContain("客户说只是问问价");
    expect(await prisma.auditLog.count({ where: { action: "close", entity: "EntDupeHit" } })).toBe(1);
    expect(await 补建待补建(键)).toEqual({ ok: false, error: 已被处理话(记), 刷新: true });
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(1);
  });

  it("客户中途进了公海：进公海那一刻（换负责人 pool-release）自动关；点的时候才发现在公海也就地关", async () => {
    const c = await 到上限留一条();
    await prisma.$transaction((tx) => 记换负责人(tx, [{ customerId: c.id, from: 外贸甲.id, to: 总管.id }], 总管.id, "pool-release"));
    expect((await 待补建of(c.id)).记).toMatchObject({ 状态: "已关闭", 处理: { 谁: null, 原因: 进公海关原因, 自动: "进公海" } });
    // 另一位：直接进公海（没走换负责人），点补建时就地关
    const d = await 到上限留一条({ 撞上的: true });
    await prisma.customerPool.create({ data: { customerId: d.id } });
    const { 键 } = await 待补建of(d.id);
    当(外销管);
    expect(await 补建待补建(键)).toEqual({ ok: false, error: 进公海关原因, 刷新: true });
    expect((await 待补建of(d.id)).记.状态).toBe("已关闭");
    expect(await prisma.project.count({ where: { customerId: d.id } })).toBe(1);
  });

  it("两个销售管理同时点补建同一条：只成一次，后到的回已被处理", async () => {
    const c = await 到上限留一条();
    await 上限({});
    const { 键 } = await 待补建of(c.id);
    当(外销管);
    const [一, 二] = await Promise.all([补建待补建(键), 补建待补建(键)]);
    const 成 = [一, 二].filter((x) => x.ok);
    expect(成).toHaveLength(1);
    expect([一, 二].find((x) => !x.ok)).toMatchObject({ ok: false, error: expect.stringContaining("已经补建了"), 刷新: true });
    expect(await prisma.project.count({ where: { customerId: c.id, source: 重复咨询来源 } })).toBe(1);
    expect(await prisma.entLeadAssign.count()).toBe(1);
    expect(await prisma.followUp.count({ where: { customerId: c.id } })).toBe(1);
  });
});

describe("谁看得到、谁点得了", () => {
  it("这条线的销售管理、系统管理员看全部内容；别的线的销售管理看不到这条；市场同事只看自己的、只有客户编号；销售这一栏没有、点不了", async () => {
    const c = await 到上限留一条();
    const { 键 } = await 待补建of(c.id);
    const 外 = await 读待补建栏(外销管);
    expect(外.管).toHaveLength(1);
    expect(外.管![0]).toMatchObject({
      键, 状态: "待补建", 客户编号: 出口C项目名(序).replace("重复咨询-", ""), 渠道: "小红书|笔记", 沟通内容: "老客户来电问新一期报价",
      交的人: 市场.name, 对接人: expect.stringContaining("李采购"),
    });
    expect(外.管![0].通知了).toContain(外销管.name);
    expect(JSON.stringify(外)).not.toContain(`老客户${序}`);
    expect((await 读待补建栏(总管)).管).toHaveLength(1);
    expect((await 读待补建栏(内销管)).管).toEqual([]);
    // 市场同事：只有自己交的，只有编号 / 时间 / 状态 / 结果
    const 我 = await 读待补建栏(市场);
    expect(我.管).toBeNull();
    expect(我.我交的).toHaveLength(1);
    expect(Object.keys(我.我交的[0]).sort()).toEqual(["交的时间", "客户编号", "状态", "结果", "键"].sort());
    expect(JSON.stringify(我)).not.toContain("小红书");
    expect(JSON.stringify(我)).not.toContain("报价");
    expect(await 读待补建栏(市场管)).toEqual({ 管: null, 我交的: [] });
    // 销售：没有这一栏，点也不行
    expect(await 读待补建栏(乙)).toEqual({ 管: null, 我交的: [] });
    当(乙);
    expect(await 补建待补建(键)).toEqual({ ok: false, error: 不能处理待补建话 });
    expect(await 不补建待补建(键, "x")).toEqual({ ok: false, error: 不能处理待补建话 });
    当(内销管);
    expect(await 补建待补建(键)).toEqual({ ok: false, error: 不能处理待补建话 });
    当(市场);
    expect(await 补建待补建(键)).toEqual({ ok: false, error: 不能处理待补建话 });
    expect((await 待补建of(c.id)).记.状态).toBe("待补建");
    // 处理后：市场同事看到结果（补成哪条线索、交给谁），仍没有客户名
    await 上限({});
    当(外销管);
    expect((await 补建待补建(键)).ok).toBe(true);
    const 我后 = await 读待补建栏(市场);
    expect(我后.我交的[0]).toMatchObject({ 状态: "已补建", 结果: { 话: expect.stringContaining(外贸甲.name), 谁: 外销管.name } });
    expect(JSON.stringify(我后)).not.toContain(`老客户${序}`);
  });

  it("键乱写、找不到：回找不到，不抛", async () => {
    当(外销管);
    expect(await 补建待补建("乱写")).toMatchObject({ ok: false, 刷新: true });
    expect(await 不补建待补建("x:9", "原因")).toMatchObject({ ok: false, 刷新: true });
  });
});
