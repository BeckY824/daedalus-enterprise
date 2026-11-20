/**
 * 企业版「超时未跟进自动转」（11-17，lib/enterprise/reply-overdue.ts）：
 * 指定回复时间 + 1 小时没记有效沟通 → 超时提醒（站内 + 飞书 + 首页待办）；再 30 分钟没记 → 自动转下一位销售，接手人同样计时、不限次数；
 * 北京 22:00–08:00 不执行、顺延到 08:00，每一步按上一步实际执行的时刻往后算；一轮人人超时过就开新一轮；
 * 原负责人收「超时未跟进已自动收回并分配给其他成员」；客户随线索走，原负责人手上还有这位客户别的进行中项目就留给他、接手人页上提示。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则, 规则开着 } from "@/lib/enterprise/rules";
import { 待回复客户of } from "@/lib/enterprise/reply-notice";
import {
  超时转扫一遍, 在夜里, 顺延到白天, 超时提醒到期, 超时转出到期, 该做, 本轮排除, 读试过, 客户怎么办, 客户在谁名下, 超时基准,
  收回话, 超时转理由, 超时通知种类, 超时转重新起算, 我超时未跟进的, 自留超时话,
} from "@/lib/enterprise/reply-overdue";
import { 客户在谁名下话 } from "@/lib/project/time-fields";
import { 项目回收日, 算超时要的, 改项目, 补回收起点留痕 } from "@/lib/project/db";
import { 默认组织规则, 默认三态规则, type 组织规则 } from "@/lib/project/org-rules";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 超时回收日, 超时自动转理由 } from "@/lib/project/timeout";
import { 即将逾期的项目 } from "@/lib/project/home-cards-db";
import { 换负责人们of } from "@/lib/enterprise/tri-state-transfer";
import { 同号再次录入, 同号节点 } from "@/lib/enterprise/same-number-collab";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 北京日期 } from "./helpers/beijing-date";

/** 北京时间的一个瞬间 */
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);

type 人 = { id: string; name: string };
let 老板: 人, 甲: 人, 乙: 人, 丙: 人;
async function 造人(email: string, name: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
}
let 序 = 0;
/** 一位客户 + 一条线索阶段的项目，都在 owner 名下；replyEnd = 指定回复时间（只填结束） */
async function 建线索(owner: 人, 补: Record<string, unknown> = {}, customerId?: string) {
  序++;
  const cid = customerId ?? (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: owner.id } })).id;
  // 默认是「分出去的」线索：老板建的、分给 owner（11-18 第 1 题 B：只转分出去的）；自留 / 自持的用例另传 creatorId
  const p = await prisma.project.create({ data: { name: `线索${序}`, customerId: cid, ownerId: owner.id, creatorId: 老板.id, phase: "线索", node: "潜客培育", bizLine: "内贸", ...补 } });
  return { id: p.id, customerId: cid };
}
const 项目 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, include: { customer: true } });
// 「快轮到」（11-18，assign-eta.ts）是分配后另发的一条，这里只看分配本身的通知
const 通知 = (userId: string) => prisma.entNotice.findMany({ where: { userId, kind: { not: "快轮到" } }, orderBy: { createdAt: "asc" } });
const 超时通知 = (userId: string) => prisma.entNotice.findMany({ where: { userId, kind: 超时通知种类 }, orderBy: { createdAt: "asc" } });
const 记沟通 = async (projectId: string, content: string, at: Date) => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const f = await prisma.followUp.create({ data: { type: "PHONE", content, occurredAt: at, createdAt: at, title: "", status: "已完成", customerId: p.customerId, ownerId: p.ownerId } });
  await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: p.node } });
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板");
  甲 = await 造人("jia", "甲");
  乙 = await 造人("yi", "乙");
  丙 = await 造人("bing", "丙");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 甲.id, bizRole: "sales", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
  invalidateSettingsCache();
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); invalidateSettingsCache(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("时间线（纯函数）", () => {
  it("夜里 = 北京 22:00–08:00；落在夜里的顺延到早上 08:00（过了零点是当天 08:00）", () => {
    expect(在夜里(京("2026-11-20 21:59"))).toBe(false);
    expect(在夜里(京("2026-11-20 22:00"))).toBe(true);
    expect(在夜里(京("2026-11-21 07:59"))).toBe(true);
    expect(在夜里(京("2026-11-21 08:00"))).toBe(false);
    expect(顺延到白天(京("2026-11-20 22:50"))).toEqual(京("2026-11-21 08:00"));
    expect(顺延到白天(京("2026-11-21 03:00"))).toEqual(京("2026-11-21 08:00"));
    expect(顺延到白天(京("2026-11-20 15:00"))).toEqual(京("2026-11-20 15:00"));
    // 跨月、跨年也对
    expect(顺延到白天(京("2026-12-31 23:30"))).toEqual(京("2027-01-01 08:00"));
  });

  it("基准 + 1 小时提醒、提醒 + 30 分钟转；超时基准 = 结束，没填结束用开始", () => {
    expect(超时提醒到期(京("2026-11-20 15:00"))).toEqual(京("2026-11-20 16:00"));
    expect(超时转出到期(京("2026-11-20 16:00"))).toEqual(京("2026-11-20 16:30"));
    expect(超时基准({ replyStartAt: 京("2026-11-20 15:00"), replyEndAt: 京("2026-11-20 17:00") })).toEqual(京("2026-11-20 17:00"));
    expect(超时基准({ replyStartAt: 京("2026-11-20 15:00"), replyEndAt: null })).toEqual(京("2026-11-20 15:00"));
    expect(超时基准({ replyStartAt: null, replyEndAt: null })).toBeNull();
  });

  it("每一步按上一步实际执行的时刻算：超时提醒顺延到 08:00 → 08:30 转；21:50 接手 → 22:50 该提醒 → 08:00 → 08:30 转", () => {
    // 基准 21:30：22:30 该提醒 → 夜里，08:00 才提醒
    const 起 = 京("2026-11-20 21:30");
    expect(超时提醒到期(起)).toEqual(京("2026-11-21 08:00"));
    expect(该做({ since: 起, overdueAt: null }, 京("2026-11-20 23:00"))).toBeNull();
    expect(该做({ since: 起, overdueAt: null }, 京("2026-11-21 07:59"))).toBeNull();
    expect(该做({ since: 起, overdueAt: null }, 京("2026-11-21 08:00"))).toBe("提醒");
    expect(该做({ since: 起, overdueAt: 京("2026-11-21 08:00") }, 京("2026-11-21 08:29"))).toBeNull();
    expect(该做({ since: 起, overdueAt: 京("2026-11-21 08:00") }, 京("2026-11-21 08:30"))).toBe("转");
    // 21:50 接手
    const 接 = 京("2026-11-20 21:50");
    expect(超时提醒到期(接)).toEqual(京("2026-11-21 08:00"));
    expect(超时转出到期(京("2026-11-21 08:00"))).toEqual(京("2026-11-21 08:30"));
    // 21:45 发了超时提醒：22:15 该转 → 08:00 转
    expect(超时转出到期(京("2026-11-20 21:45"))).toEqual(京("2026-11-21 08:00"));
    expect(该做({ since: 京("2026-11-20 20:45"), overdueAt: 京("2026-11-20 21:45") }, 京("2026-11-20 22:15"))).toBeNull();
  });

  it("轮次：排除这一轮超时过的 + 现负责人；读坏了的当空", () => {
    expect(本轮排除(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(本轮排除([], "c")).toEqual(["c"]);
    expect(读试过("不是 JSON")).toEqual([]);
    expect(读试过('["a", 1, ""]')).toEqual(["a"]);
  });

  it("客户怎么办：归原负责人 → 跟着走；原负责人手上还有别的进行中项目 → 留给他；在公海 / 已归接手人 / 归别人 = 不动", () => {
    expect(客户怎么办({ salesOwnerId: "原", 在公海: false }, "原", "新", 0)).toBe("跟着走");
    expect(客户怎么办({ salesOwnerId: "原", 在公海: false }, "原", "新", 1)).toBe("留给原负责人");
    expect(客户怎么办({ salesOwnerId: "原", 在公海: true }, "原", "新", 0)).toBe("不动");
    expect(客户怎么办({ salesOwnerId: "新", 在公海: false }, "原", "新", 0)).toBe("不动");
    expect(客户怎么办({ salesOwnerId: "别人", 在公海: false }, "原", "新", 0)).toBe("不动");
  });

  it("通知原话", () => {
    expect(收回话).toBe("超时未跟进已自动收回并分配给其他成员");
    expect(客户在谁名下话("甲")).toBe("该客户在 甲 名下");
  });
});

describe("钟上走一遍（到点提醒、自动转）", () => {
  it("+1 小时超时提醒（首页待办标超时）→ +1.5 小时转给本月分得最少的乙：算一次分配、留痕记原因和系统、两边通知、客户跟着走", async () => {
    const { id, customerId } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    expect(await 超时转扫一遍(京("2026-11-20 15:59"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1, 转出: 0 });
    const 提 = await 超时通知(甲.id);
    expect(提).toHaveLength(1);
    expect(提[0].title).toContain("超时未跟进");
    expect(提[0].body).toContain("16:30 前还没记");
    expect(提[0].link).toBe(`/projects/${id}`);
    const 待办 = await 待回复客户of(甲.id, 京("2026-11-20 16:01"));
    expect(待办).toMatchObject({ 条数: 1, 超时: 1, 最早: { projectId: id, 超时: true } });
    // 再扫、重启不重发；没到 30 分钟不转
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 16:29"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 超时通知(甲.id))).toHaveLength(1);

    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    const p = await 项目(id);
    expect(p.ownerId).toBe(乙.id);
    expect(p.awaitAssignAt).toBeNull();
    // 客户跟着走（甲手上没有这位客户别的项目），记一行换负责人：超时未跟进自动转
    expect(p.customer.salesOwnerId).toBe(乙.id);
    expect(await prisma.customerOwnerLog.findMany({ where: { customerId }, select: { fromOwnerId: true, toOwnerId: true, kind: true } }))
      .toEqual([{ fromOwnerId: 甲.id, toOwnerId: 乙.id, kind: "overdue-assign" }]);
    // 算乙一次分配
    expect(await prisma.entLeadAssign.findMany({ where: { projectId: id }, select: { toUserId: true, fromUserId: true, counted: true } }))
      .toEqual([{ toUserId: 乙.id, fromUserId: 甲.id, counted: true }]);
    // 项目留痕：转让、操作人系统、原因带「超时未跟进自动转」
    const 痕 = await prisma.projectNodeLog.findMany({ where: { projectId: id, kind: "transfer" } });
    expect(痕).toHaveLength(1);
    expect(痕[0]).toMatchObject({ userId: "system", fromOwnerId: 甲.id, toOwnerId: 乙.id });
    expect(痕[0].reason).toContain(超时转理由);
    // 乙收到「自动分配给你」，带原因；甲收到收回那句
    const 乙的 = await 通知(乙.id);
    expect(乙的.map((n) => n.kind)).toEqual(["自动分配"]);
    expect(乙的[0].body).toContain(超时转理由);
    expect(乙的[0].body).not.toContain("名下");
    const 甲的 = await 超时通知(甲.id);
    expect(甲的).toHaveLength(2);
    expect(甲的[1].title).toBe(`${收回话}：${p.name}`);
    expect(甲的[1].body).toContain("分给了 乙");
    // 甲的首页待办里这条没了
    expect(await 待回复客户of(甲.id, 京("2026-11-20 16:31"))).toBeNull();
    // 客户跟着走了，不用提示
    expect(await 客户在谁名下({ id, ownerId: p.ownerId, customer: { salesOwnerId: p.customer.salesOwnerId, pool: null } })).toBeNull();
  });

  it("接手人同样计时：接手 1 小时提醒、30 分钟再转（排除超时过的）；人人都轮过一遍开新一轮，仍不给现负责人；不限次数", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await 超时转扫一遍(京("2026-11-20 16:30"));
    expect((await 项目(id)).ownerId).toBe(乙.id);
    expect(await 超时转扫一遍(京("2026-11-20 17:29"))).toMatchObject({ 提醒: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 17:30"))).toMatchObject({ 提醒: 1 });
    const 乙提 = await 超时通知(乙.id);
    expect(乙提.at(-1)!.body).toContain("接手已满 1 小时");
    await 超时转扫一遍(京("2026-11-20 18:00"));
    expect((await 项目(id)).ownerId).toBe(丙.id); // 甲、乙这一轮超时过
    await 超时转扫一遍(京("2026-11-20 19:00"));
    await 超时转扫一遍(京("2026-11-20 19:30"));
    // 甲乙丙都轮过：新一轮，只排除丙；甲本月分到 0 条、乙 1 条 → 甲
    const p = await 项目(id);
    expect(p.ownerId).toBe(甲.id);
    expect(await prisma.entReplyOverdue.findUnique({ where: { projectId: id }, select: { tried: true, transfers: true } })).toEqual({ tried: JSON.stringify([丙.id]), transfers: 3 });
    await 超时转扫一遍(京("2026-11-20 20:30"));
    await 超时转扫一遍(京("2026-11-20 21:00"));
    expect((await 项目(id)).ownerId).toBe(乙.id);
  });

  it("记了有效沟通链就停：提醒前记了不提醒不转；提醒后、转之前记了不转；空的、占位的不算", async () => {
    const a = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 记沟通(a.id, "打了电话，客户说下周来看样品", 京("2026-11-20 15:20"));
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 0, 停: 1 });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时通知(甲.id)).toHaveLength(0);

    const b = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") });
    await 记沟通(b.id, "", 京("2026-11-21 10:30")); // 空的不算
    await 超时转扫一遍(京("2026-11-21 11:00"));
    expect(await 超时通知(甲.id)).toHaveLength(1);
    await 记沟通(b.id, "微信发了报价单，约了明天电话", 京("2026-11-21 11:10"));
    await 超时转扫一遍(京("2026-11-21 11:30"));
    expect((await 项目(b.id)).ownerId).toBe(甲.id);
    expect(await 待回复客户of(甲.id, 京("2026-11-21 11:31"))).toBeNull();
  });

  it("同号再次录入（客户又来问、别人又录了这个号）写进项目的系统留痕不停链：照常超时提醒、照常自动转", async () => {
    const 日 = 北京日期(-1);
    const { id, customerId } = await 建线索(甲, { replyEndAt: 京(`${日} 15:00`) });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const 号 = 验号码("手机号", c.phone);
    if (!号.ok) throw new Error("号码样例没过格式");
    /** 按系统时钟拨到 时刻 再录：同号再次录入的写入时刻取系统时钟 */
    const 再录 = async (时刻: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(京(`${日} ${时刻}`));
        return await 同号再次录入(老板, 号, { 入口: "手工建档", 内容: "客户又打电话来催，问什么时候回电" });
      } finally {
        vi.useRealTimers();
      }
    };
    // 提醒之后、超时提醒之前录一次
    expect((await 再录("15:10")).走).toBe(true);
    expect(await prisma.followUpProject.findMany({ where: { projectId: id }, select: { node: true } })).toEqual([{ node: 同号节点 }]);
    expect(await 超时转扫一遍(京(`${日} 16:00`))).toMatchObject({ 提醒: 1, 停: 0 });
    expect(await 待回复客户of(甲.id, 京(`${日} 16:01`))).toMatchObject({ 条数: 1, 超时: 1, 最早: { projectId: id, 超时: true } });
    expect(await 我超时未跟进的(甲.id)).toHaveLength(1);
    // 超时提醒之后、转之前又录一次：照转
    expect((await 再录("16:10")).走).toBe(true);
    expect(await 超时转扫一遍(京(`${日} 16:30`))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).not.toBe(甲.id);
  });

  it("夜里不执行：21:20 超时提醒、21:50 转给乙 → 22:50 该提醒 → 次日 08:00 提醒、08:30 转", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 20:20") });
    await 超时转扫一遍(京("2026-11-20 21:20"));
    await 超时转扫一遍(京("2026-11-20 21:50"));
    expect((await 项目(id)).ownerId).toBe(乙.id);
    for (const t of ["2026-11-20 22:50", "2026-11-21 00:30", "2026-11-21 07:59"]) {
      expect(await 超时转扫一遍(京(t))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    }
    expect(await 超时转扫一遍(京("2026-11-21 08:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-21 08:29"))).toMatchObject({ 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 08:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(丙.id);
  });

  it("停机补跑：开机那遍只补超时提醒，再等 30 分钟才转，不连环转", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 10:00") });
    // 10:00–15:00 停机，开机第一遍
    expect(await 超时转扫一遍(京("2026-11-20 15:00"))).toMatchObject({ 提醒: 1, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 15:01"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 15:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    // 接手人从 15:30 起算，开机补跑不会一口气再转
    expect(await 超时转扫一遍(京("2026-11-20 15:31"))).toMatchObject({ 提醒: 0, 转出: 0 });
  });

  it("超过往回看的天数的老数据不起链", async () => {
    await 建线索(甲, { replyEndAt: 京("2026-11-10 10:00") });
    expect(await 超时转扫一遍(京("2026-11-20 10:00"))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
  });

  it("挑不到人：不转、留在现负责人手上，不发收回通知，下一遍再试", async () => {
    await setSetting(自动分配不参与key, { [老板.id]: "禁止", [乙.id]: "禁止", [丙.id]: "暂停" });
    invalidateSettingsCache();
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0, 没转成: 1 });
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect((await 超时通知(甲.id)).map((n) => n.title.startsWith(收回话))).toEqual([false]);
    // 放开乙：下一遍转出去
    await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
    invalidateSettingsCache();
    expect(await 超时转扫一遍(京("2026-11-20 16:31"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
  });

  it("只管线索阶段、不在待分配、不在公海、填了指定回复时间的；进了公海的链停下、领回来也不接着转", async () => {
    await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), phase: "商机", node: "需求确认" });
    await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), awaitAssignAt: 京("2026-11-20 09:00") });
    await 建线索(甲, {});
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });

    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 17:00") });
    await 超时转扫一遍(京("2026-11-20 18:00"));
    await prisma.project.update({ where: { id }, data: { pooledAt: 京("2026-11-20 18:10") } });
    await 超时转扫一遍(京("2026-11-20 18:30"));
    expect((await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: id } })).stoppedAt).not.toBeNull();
    await prisma.project.update({ where: { id }, data: { pooledAt: null, ownerId: 丙.id } });
    expect(await 超时转扫一遍(京("2026-11-20 20:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 项目(id)).ownerId).toBe(丙.id);
  });

  it("改了指定回复时间整条重来；别人手动换了负责人从他接手那刻重新计时", async () => {
    const a = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await prisma.project.update({ where: { id: a.id }, data: { replyEndAt: 京("2026-11-20 18:00") } });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0 });
    expect((await 项目(a.id)).ownerId).toBe(甲.id);
    expect(await 超时转扫一遍(京("2026-11-20 19:00"))).toMatchObject({ 提醒: 1 });

    // 前一条结了，不掺和下面的计数
    await prisma.project.update({ where: { id: a.id }, data: { result: "线索流失" } });
    const b = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") });
    await 超时转扫一遍(京("2026-11-21 11:00"));
    // 11:10 销售管理手动转给丙
    await prisma.project.update({ where: { id: b.id }, data: { ownerId: 丙.id } });
    const p = await prisma.project.findUniqueOrThrow({ where: { id: b.id } });
    await prisma.projectNodeLog.create({ data: { projectId: b.id, userId: 老板.id, kind: "transfer", fromOwnerId: 甲.id, toOwnerId: 丙.id, at: 京("2026-11-21 11:10"), fromPhase: p.phase, fromNode: p.node, toPhase: p.phase, toNode: p.node } });
    expect(await 超时转扫一遍(京("2026-11-21 11:30"))).toMatchObject({ 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 12:09"))).toMatchObject({ 提醒: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 12:10"))).toMatchObject({ 提醒: 1 });
    expect((await 超时通知(丙.id)).at(-1)!.body).toContain("接手已满 1 小时");
  });

  it("清了指定回复时间：链停下，不出错、不连累别的项目；记过沟通停了的链，改了指定回复时间（新的约定）整条重来", async () => {
    const a = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    const b = await 建线索(乙, { replyEndAt: 京("2026-11-20 15:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await prisma.project.update({ where: { id: a.id }, data: { replyEndAt: null } });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1, 没转成: 0 });
    expect((await 项目(a.id)).ownerId).toBe(甲.id);
    expect((await 项目(b.id)).ownerId).not.toBe(乙.id);
    expect((await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: a.id } })).stoppedAt).not.toBeNull();
    expect(await 待回复客户of(甲.id, 京("2026-11-20 16:31"))).toBeNull();
    await prisma.project.update({ where: { id: b.id }, data: { result: "线索流失" } }); // 不掺和下面的计数

    const c = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") });
    await 记沟通(c.id, "打了电话，约了下周二再聊", 京("2026-11-21 09:50"));
    expect(await 超时转扫一遍(京("2026-11-21 11:00"))).toMatchObject({ 停: 1 });
    expect(await 超时转扫一遍(京("2026-11-21 11:30"))).toMatchObject({ 提醒: 0, 转出: 0, 停: 0 });
    // 下周二约了新的指定回复时间，又没跟进
    await prisma.project.update({ where: { id: c.id }, data: { replyEndAt: 京("2026-11-24 10:00") } });
    expect(await 超时转扫一遍(京("2026-11-24 11:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-24 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(c.id)).ownerId).not.toBe(甲.id);
  });
});

describe("只转分出去的（11-18 客户定第 1 题 B）", () => {
  it("自留 / 个人自持（自己建给自己、没有分给他的记录）：到点只提醒本人、不说会收回，首页待办标超时，过了 1.5 小时也不转", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), creatorId: 甲.id });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1, 转出: 0 });
    const 提 = await 超时通知(甲.id);
    expect(提).toHaveLength(1);
    expect(提[0].body).toContain(自留超时话);
    expect(提[0].body).not.toContain("自动收回");
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 18:30"))).toMatchObject({ 转出: 0 });
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect(await prisma.entLeadAssign.count({ where: { projectId: id } })).toBe(0);
    expect(await 我超时未跟进的(甲.id)).toHaveLength(1);
  });

  it("自己建的、但有把它分给他的记录（分出去又分回来）：算分出去的，照转", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), creatorId: 甲.id });
    await prisma.entLeadAssign.create({ data: { projectId: id, toUserId: 甲.id, byUserId: 老板.id, month: "2026-11", counted: true } });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
  });

  it("超时转两人都算（维持）：原负责人那条分配记录照算，接手人再记一条", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await prisma.entLeadAssign.create({ data: { projectId: id, toUserId: 甲.id, byUserId: 老板.id, month: "2026-11", counted: true } });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect(await prisma.entLeadAssign.count({ where: { month: "2026-11", counted: true, toUserId: 甲.id } })).toBe(1);
    expect(await prisma.entLeadAssign.count({ where: { month: "2026-11", counted: true, toUserId: 乙.id } })).toBe(1);
  });
});

describe("管理员开关：组织规则「超时未跟进自动转」（默认开）", () => {
  const 拨 = async (开: boolean) => { await setSetting(规则.超时自动转.key, 开); invalidateSettingsCache(); };

  it("没拨过算开着（保持上线时的行为）；拨成关就关", async () => {
    expect(await prisma.setting.count({ where: { key: 规则.超时自动转.key } })).toBe(0);
    expect(await 规则开着("超时自动转")).toBe(true);
    await 拨(false);
    expect(await 规则开着("超时自动转")).toBe(false);
  });

  it("关着：到点不发超时提醒、不自动转，首页待办不标超时；30 分钟前那条提醒不归这个开关管", async () => {
    await 拨(false);
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    for (const t of ["2026-11-20 16:00", "2026-11-20 16:30", "2026-11-20 18:00"]) {
      expect(await 超时转扫一遍(京(t))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    }
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect(await 超时通知(甲.id)).toHaveLength(0);
    expect(await prisma.entReplyOverdue.count()).toBe(0);
    expect(await 我超时未跟进的(甲.id)).toEqual([]);
    expect((await 待回复客户of(甲.id, 京("2026-11-20 16:31")))?.超时).toBeUndefined();
  });

  it("开着照转；转出去以后关掉：已转的不回滚，接手人不再提醒、不再转", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    await 拨(false);
    for (const t of ["2026-11-20 17:30", "2026-11-20 18:00", "2026-11-20 20:00"]) {
      expect(await 超时转扫一遍(京(t))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    }
    expect((await 项目(id)).ownerId).toBe(乙.id);
    expect(await 超时通知(乙.id)).toHaveLength(0);
    // 链停在原处，没被清
    expect(await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: id }, select: { holderId: true, transfers: true, stoppedAt: true } }))
      .toEqual({ holderId: 乙.id, transfers: 1, stoppedAt: null });
  });

  it("提醒发了、没转就关掉，过一阵再打开：从打开那刻重新计时、重发提醒，不一打开就转", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    await 拨(false);
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0 });
    // 17:00 打开（设规则 从关拨到开时调 超时转重新起算）
    await 拨(true);
    expect(await 超时转重新起算(京("2026-11-20 17:00"))).toBe(1);
    expect(await 超时转扫一遍(京("2026-11-20 17:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 17:59"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 18:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时通知(甲.id)).toHaveLength(2);
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect(await 超时转扫一遍(京("2026-11-20 18:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
  });

  it("重新起算只动还在走的链：停了的（记过沟通）不动", async () => {
    const a = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 记沟通(a.id, "打了电话，客户说下周来看样品", 京("2026-11-20 15:20"));
    await 超时转扫一遍(京("2026-11-20 16:00"));
    const 前 = await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: a.id } });
    expect(前.stoppedAt).not.toBeNull();
    expect(await 超时转重新起算(京("2026-11-20 17:00"))).toBe(0);
    expect(await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: a.id } })).toEqual(前);
  });
});

describe("客户归属（规则 3，P-转-04 的例外）", () => {
  it("原负责人手上还有这位客户别的进行中项目：客户留在原负责人名下，接手人页上提示「该客户在 甲 名下」，分配通知里也写", async () => {
    const a = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 建线索(甲, {}, a.customerId); // 甲手上同一位客户的另一条进行中项目
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await 超时转扫一遍(京("2026-11-20 16:30"));
    const p = await 项目(a.id);
    expect(p.ownerId).toBe(乙.id);
    expect(p.customer.salesOwnerId).toBe(甲.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: a.customerId } })).toBe(0);
    expect(await 客户在谁名下({ id: a.id, ownerId: p.ownerId, customer: { salesOwnerId: p.customer.salesOwnerId, pool: null } })).toBe("甲");
    expect((await 通知(乙.id))[0].body).toContain("该客户在 甲 名下");
    expect((await 超时通知(甲.id)).at(-1)!.body).toContain("客户还在你名下");
  });

  it("原负责人那条别的项目已经结束了（有结局）：不算在手，客户照样跟着走", async () => {
    const a = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 建线索(甲, { result: "线索流失" }, a.customerId);
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await 超时转扫一遍(京("2026-11-20 16:30"));
    expect((await 项目(a.id)).customer.salesOwnerId).toBe(乙.id);
  });
});

describe("轮转不重置超时回收日（客户 11-19 第 14 题 B）；手动转让照旧归零", () => {
  // 潜客培育 10 天回收；项目 11-15 建 → 回收日 11-25（轮转在 11-20，要是算接手就成了 11-30）
  const 超时开: 组织规则 = { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 10 } } };
  const 回收日of = async (id: string) => 项目回收日(await 生效组织规则(), (await 补回收起点留痕([await prisma.project.findUniqueOrThrow({ where: { id }, select: 算超时要的 })]))[0]);
  beforeEach(async () => {
    await setSetting("orgRules", 超时开);
    invalidateSettingsCache();
  });

  it("超时转出后回收日不变，转两次也不变；首页「即将逾期」照数它；接手人的 1.5 小时照从轮转那刻算（留痕那行还在）", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), createdAt: 京("2026-11-15 10:00") });
    expect(await 回收日of(id)).toBe("2026-11-25");
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await 超时转扫一遍(京("2026-11-20 16:30"));
    expect((await 项目(id)).ownerId).toBe(乙.id);
    expect(await 回收日of(id)).toBe("2026-11-25");
    // 留痕原因和回收起点认的是同一串（timeout.ts 是超时自动转痕）
    expect(超时转理由).toBe(超时自动转理由);
    expect(await prisma.projectNodeLog.count({ where: { projectId: id, kind: "transfer", userId: "system", reason: { contains: 超时自动转理由 } } })).toBe(1);
    // 接手时刻照认轮转那行：乙接手满 1 小时提醒、再 30 分钟转给丙
    expect(await 超时转扫一遍(京("2026-11-20 17:30"))).toMatchObject({ 提醒: 1 });
    await 超时转扫一遍(京("2026-11-20 18:00"));
    expect((await 项目(id)).ownerId).toBe(丙.id);
    expect(await 回收日of(id)).toBe("2026-11-25");
    // 首页卡「即将逾期」的库里紧筛不因为最近有轮转留痕把它筛掉
    expect(await 即将逾期的项目(await 生效组织规则(), 京("2026-11-23 10:00"))).toEqual([id]);
  });

  it("手动转让仍归零：轮转之后老板手动转给丙，起点挪到手动转让那刻", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), createdAt: 京("2026-11-15 10:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await 超时转扫一遍(京("2026-11-20 16:30"));
    expect(await 回收日of(id)).toBe("2026-11-25");
    const r = await 改项目({ id: 老板.id, role: "SALES" }, id, { ownerId: 丙.id });
    expect(r).toMatchObject({ ok: true });
    const 手动 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: id, kind: "transfer", userId: 老板.id }, select: { at: true } });
    expect(await 回收日of(id)).toBe(超时回收日(超时开, { phase: "线索", node: "潜客培育" }, 手动.at));
    expect(await 回收日of(id)).not.toBe("2026-11-25");
  });

  it("客户跟着转：那行换负责人记录（overdue-assign）三态不认，不归零、不计次；同一天的手动转让（assign）照归零", async () => {
    const { customerId } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await 超时转扫一遍(京("2026-11-20 16:30"));
    const 行们 = await prisma.customerOwnerLog.findMany({ where: { customerId }, select: { id: true, at: true, kind: true, clockReset: true } });
    expect(行们.map((x) => x.kind)).toEqual(["overdue-assign"]);
    expect([...换负责人们of(行们, 默认三态规则)]).toEqual([]);
    expect([...换负责人们of([...行们, { at: 京("2026-11-20 17:00"), kind: "assign" }], 默认三态规则)]).toEqual([{ 日: "2026-11-20", 方式: "转让", 归零: true }]);
  });
});

describe("挂在夜扫钟上", () => {
  it("nightly 每分钟那一遍调 钟上超时自动转，排在指定回复提醒后面", () => {
    const 钟 = fs.readFileSync(path.resolve("src/lib/project/nightly.ts"), "utf8");
    expect(钟).toContain("钟上超时自动转(现在)");
    expect(钟.indexOf("钟上超时自动转(现在)")).toBeGreaterThan(钟.indexOf("钟上指定回复提醒(现在)"));
  });
});

describe("迁移 150 和 schema.prisma 建出来的表一样", () => {
  it("老库跑迁移（跑两遍不抛）和全新安装列、默认值、索引一致；删项目带走那一行", async () => {
    type 列 = { name: string; type: string; notnull: number | bigint; dflt_value: string | null; pk: number | bigint };
    const 归一 = (rows: 列[]) => rows.map((r) => ({ name: r.name, type: r.type, notnull: Number(r.notnull), dflt: r.dflt_value === null ? null : String(r.dflt_value).replace(/^["']|["']$/g, ""), pk: Number(r.pk) })).sort((a, b) => a.name.localeCompare(b.name));
    const 新装 = 归一(await prisma.$queryRawUnsafe<列[]>('PRAGMA table_info("EntReplyOverdue")'));
    const 新装索引 = (await prisma.$queryRawUnsafe<{ name: string }[]>('PRAGMA index_list("EntReplyOverdue")')).map((x) => x.name).filter((n) => !n.startsWith("sqlite_")).sort();
    const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "reply-overdue-"));
    const db = new DatabaseSync(path.join(目录, "old.db"));
    try {
      db.exec("PRAGMA foreign_keys = ON");
      db.exec('CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL)');
      db.prepare('INSERT INTO "Project" VALUES (?, ?)').run("p1", "老项目");
      const sql = fs.readFileSync(path.resolve("migrations/150-ent-reply-overdue.sql"), "utf8");
      db.exec(sql);
      db.exec(sql);
      expect(归一(db.prepare('PRAGMA table_info("EntReplyOverdue")').all() as 列[])).toEqual(新装);
      expect((db.prepare('PRAGMA index_list("EntReplyOverdue")').all() as { name: string }[]).map((x) => x.name).filter((n) => !n.startsWith("sqlite_")).sort()).toEqual(新装索引);
      db.prepare('INSERT INTO "EntReplyOverdue" ("projectId", "anchorAt", "holderId", "since", "updatedAt") VALUES (?, ?, ?, ?, ?)').run("p1", 1, "u1", 1, 1);
      db.exec('DELETE FROM "Project" WHERE "id" = \'p1\'');
      expect((db.prepare('SELECT count(*) AS n FROM "EntReplyOverdue"').get() as { n: number }).n).toBe(0);
    } finally {
      db.close();
      fs.rmSync(目录, { recursive: true, force: true });
    }
  });
});
