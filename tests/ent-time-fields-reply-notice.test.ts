/**
 * 企业版「要求回复时间」到点提醒（11-17，两字段方案 PR2，lib/enterprise/reply-notice.ts）。
 * 待客户方确认：问题 1 —— 按建议答案只提醒、不标超时：开始前 30 分钟提醒当时的负责人（站内 + 飞书 + 首页待办），
 * 记了有内容的沟通算回复；截止后不补；停机补跑按状态判；待分配的提醒能分配的人；公海、回收站、有结局的不提醒；改了时间重新提醒。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 要求回复提醒扫一遍, 待回复客户of, 回复提醒时刻, 回复截止 } from "@/lib/enterprise/reply-notice";

/** 北京时间的一个瞬间 */
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);

let 销售: string, 市场管: string, 总管: string, 停用: string;
const 建人 = async (email: string, active = true) => (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x", active } })).id;
const 项目 = async (ownerId: string, 补: Record<string, unknown> = {}) => {
  const c = await prisma.customer.create({ data: { name: `客户${Math.random()}`, phone: `139${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, salesOwnerId: ownerId } });
  return (await prisma.project.create({ data: { name: `项目${Math.random().toString(36).slice(2, 6)}`, customerId: c.id, ownerId, creatorId: ownerId, phase: "线索", node: "潜客培育", ...补 } })).id;
};
const 通知们 = (userId?: string) => prisma.entNotice.findMany({ where: { kind: "要求回复", ...(userId ? { userId } : {}) } });
const 记沟通 = async (projectId: string, content: string, at: Date) => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const f = await prisma.followUp.create({ data: { type: "PHONE", content, occurredAt: at, createdAt: at, title: "", status: "已完成", customerId: p.customerId, ownerId: p.ownerId } });
  await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: p.node } });
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  销售 = await 建人("sales");
  市场管 = await 建人("mkt");
  总管 = await 建人("boss");
  停用 = await 建人("gone", false);
  await prisma.entMember.createMany({ data: [{ userId: 销售, bizRole: "sales" }, { userId: 市场管, bizRole: "marketing_mgr" }, { userId: 总管, bizRole: "director" }, { userId: 停用, bizRole: "sales" }] });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true, poolDays: 30 });
  invalidateSettingsCache();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("提醒时刻和截止", () => {
  it("开始前 30 分钟；只填结束 = 结束前 30 分钟；截止 = 结束，只填开始 = 那天（北京）过完", () => {
    expect(回复提醒时刻({ replyStartAt: 京("2026-11-20 15:00"), replyEndAt: 京("2026-11-20 17:00") })).toEqual(京("2026-11-20 14:30"));
    expect(回复提醒时刻({ replyStartAt: null, replyEndAt: 京("2026-11-20 17:00") })).toEqual(京("2026-11-20 16:30"));
    expect(回复截止({ replyStartAt: 京("2026-11-20 15:00"), replyEndAt: 京("2026-11-20 17:00") })).toEqual(京("2026-11-20 17:00"));
    expect(回复截止({ replyStartAt: 京("2026-11-20 15:00"), replyEndAt: null })).toEqual(京("2026-11-21 00:00"));
    expect(回复提醒时刻({ replyStartAt: null, replyEndAt: null })).toBeNull();
  });
});

describe("到点提醒（钟上每分钟一遍）", () => {
  it("没到点不提醒；到点提醒负责人一次，再扫、重启不重发；首页待办「待回复客户 1」", async () => {
    const id = await 项目(销售, { replyStartAt: 京("2026-11-20 15:00"), replyEndAt: 京("2026-11-20 17:00") });
    expect(await 要求回复提醒扫一遍(京("2026-11-20 14:29"))).toBe(0);
    expect(await 待回复客户of(销售, 京("2026-11-20 14:29"))).toBeNull();
    expect(await 要求回复提醒扫一遍(京("2026-11-20 14:30"))).toBe(1);
    const [n] = await 通知们(销售);
    expect(n).toMatchObject({ link: `/projects/${id}` });
    expect(n.title).toContain("11-20 15:00 – 17:00");
    expect(await 要求回复提醒扫一遍(京("2026-11-20 14:31"))).toBe(0);
    expect(await 通知们()).toHaveLength(1);
    expect(await 待回复客户of(销售, 京("2026-11-20 15:10"))).toMatchObject({ 条数: 1, 最早: { projectId: id } });
  });

  it("记了有内容的沟通 = 回复了：待办消失、还没发的不发；占位式沟通（「已联系」）不算", async () => {
    const id = await 项目(销售, { replyStartAt: 京("2026-11-20 15:00"), replyEndAt: 京("2026-11-20 17:00") });
    await 要求回复提醒扫一遍(京("2026-11-20 14:30"));
    await 记沟通(id, "已联系", 京("2026-11-20 14:40"));
    expect(await 待回复客户of(销售, 京("2026-11-20 14:45"))).toMatchObject({ 条数: 1 });
    await 记沟通(id, "电话确认了报价和交期，下周寄样品", 京("2026-11-20 14:50"));
    expect(await 待回复客户of(销售, 京("2026-11-20 14:55"))).toBeNull();
    // 提醒之前就记的那条不算这次的回复
    const id2 = await 项目(销售, { replyEndAt: 京("2026-11-21 10:00") });
    await 记沟通(id2, "昨天聊过一次，客户说明早再约", 京("2026-11-20 18:00"));
    expect(await 要求回复提醒扫一遍(京("2026-11-21 09:30"))).toBe(1);
  });

  it("到截止首页待办消失；停机补跑：开机时还没到截止的照常提醒，已过截止的不补", async () => {
    const 没过 = await 项目(销售, { replyStartAt: 京("2026-11-20 15:00"), replyEndAt: 京("2026-11-20 17:00") });
    const 过了 = await 项目(销售, { replyStartAt: 京("2026-11-20 09:00"), replyEndAt: 京("2026-11-20 10:00") });
    const 只始 = await 项目(销售, { replyStartAt: 京("2026-11-20 11:00") });
    // 服务 08:00 停、16:00 起来
    expect(await 要求回复提醒扫一遍(京("2026-11-20 16:00"))).toBe(2);
    const 发了 = (await 通知们()).map((n) => n.link);
    expect(发了).toEqual(expect.arrayContaining([`/projects/${没过}`, `/projects/${只始}`]));
    expect(发了).not.toContain(`/projects/${过了}`);
    expect(await 待回复客户of(销售, 京("2026-11-20 16:59"))).toMatchObject({ 条数: 2, 最早: { projectId: 没过 } });
    expect(await 待回复客户of(销售, 京("2026-11-20 17:00"))).toMatchObject({ 条数: 1, 最早: { projectId: 只始 } });
    expect(await 待回复客户of(销售, 京("2026-11-21 00:00"))).toBeNull();
  });

  it("还在待分配：提醒能分配的人（市场管理、总管理员），不进占位人的首页待办；停用的人不收", async () => {
    await 项目(市场管, { awaitAssignAt: new Date(), replyStartAt: 京("2026-11-20 15:00") });
    await 项目(停用, { replyStartAt: 京("2026-11-20 15:00") });
    await 要求回复提醒扫一遍(京("2026-11-20 14:30"));
    const 收件 = (await 通知们()).map((n) => n.userId).sort();
    expect(收件).toEqual([市场管, 总管].sort());
    expect((await 通知们(总管))[0].body).toContain("还在待分配");
    expect(await 待回复客户of(市场管, 京("2026-11-20 14:40"))).toBeNull();
  });

  it("公海、回收站、有结局的不提醒；被分走后新负责人照常收", async () => {
    const 在 = { replyStartAt: 京("2026-11-20 15:00") };
    await 项目(销售, { ...在, pooledAt: new Date() });
    await 项目(销售, { ...在, deletedAt: new Date() });
    await 项目(销售, { ...在, result: "线索流失" });
    const 换人 = await 项目(市场管, 在);
    await prisma.project.update({ where: { id: 换人 }, data: { ownerId: 销售 } });
    expect(await 要求回复提醒扫一遍(京("2026-11-20 14:30"))).toBe(1);
    expect((await 通知们(销售)).map((n) => n.link)).toEqual([`/projects/${换人}`]);
  });

  it("改了时间重新算：新的提醒时刻再提醒一次", async () => {
    const id = await 项目(销售, { replyStartAt: 京("2026-11-20 15:00") });
    await 要求回复提醒扫一遍(京("2026-11-20 14:30"));
    await prisma.project.update({ where: { id }, data: { replyStartAt: 京("2026-11-20 18:00") } });
    expect(await 要求回复提醒扫一遍(京("2026-11-20 14:40"))).toBe(0);
    expect(await 要求回复提醒扫一遍(京("2026-11-20 17:30"))).toBe(1);
    expect(await 通知们(销售)).toHaveLength(2);
  });

  it("不是企业版不发", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    await 项目(销售, { replyStartAt: 京("2026-11-20 15:00") });
    expect(await 要求回复提醒扫一遍(京("2026-11-20 14:30"))).toBe(0);
  });

  it("挂在夜扫每分钟那个钟上（多进程只一个进程跑），首页待办接进首页", () => {
    const 钟 = fs.readFileSync(path.resolve(__dirname, "../src/lib/project/nightly.ts"), "utf8");
    expect(钟).toContain("钟上要求回复提醒(现在)");
    const 首页 = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/dashboard/page.tsx"), "utf8");
    expect(首页).toContain("待回复客户of(user.id)");
  });
});
