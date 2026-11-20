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
import { 待回复客户of, 已回复的 } from "@/lib/enterprise/reply-notice";
import {
  超时转扫一遍, 在夜里, 顺延到白天, 超时提醒到期, 超时转出到期, 该做, 本轮排除, 读试过, 客户怎么办, 客户在谁名下, 超时基准,
  收回话, 超时转理由, 超时通知种类, 超时转重新起算, 我超时未跟进的, 自留超时话,
  分配基准, 分配起链往回看天, 起链往回看天, 建档随手记秒, 盘点超时链, type 换人痕,
  超时转生效key, 超时转生效时刻, 历史起算key, 历史基准, 本人记话,
} from "@/lib/enterprise/reply-overdue";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";
import { 客户在谁名下话, 分配后未跟进话, 短时刻 } from "@/lib/project/time-fields";
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
/**
 * 一位客户 + 一条线索阶段的项目，都在 owner 名下；replyEnd = 指定回复时间（只填结束）。
 * 默认是「分出去的」线索：老板建的、分给 owner（11-18 第 1 题 B：只转分出去的）；自留 / 自持的用例另传 creatorId。
 * 别人建给 owner 的按真实入口（新建时直接指定，direct-assign.ts）记一条分配记录、时刻 = 建档那一刻（不计数，不影响轮转）：
 * 11-20 起按时的也要分配基准不早于生效时刻（B1）。不分配 = 只有项目、没有分配记录（导入改负责人、老数据那种）；分于 = 分配记录的时刻（默认建档那一刻）
 */
async function 建线索(owner: 人, 补: Record<string, unknown> = {}, customerId?: string, o: { 不分配?: boolean; 分于?: Date } = {}) {
  序++;
  const cid = customerId ?? (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: owner.id } })).id;
  const p = await prisma.project.create({ data: { name: `线索${序}`, customerId: cid, ownerId: owner.id, creatorId: 老板.id, phase: "线索", node: "潜客培育", bizLine: "内贸", ...补 } });
  if (!o.不分配 && p.creatorId !== owner.id) {
    await prisma.entLeadAssign.create({ data: { projectId: p.id, toUserId: owner.id, fromUserId: p.creatorId, byUserId: p.creatorId, month: "2026-11", counted: false, createdAt: o.分于 ?? p.createdAt } });
  }
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
  // 生效时刻（11-20 事故后）：下面老用例都按「早就生效了」算；生效范围的用例自己改
  await setSetting(超时转生效key, 京("2026-01-01 00:00").toISOString());
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
    expect(await prisma.entLeadAssign.findMany({ where: { projectId: id, byUserId: "system" }, select: { toUserId: true, fromUserId: true, counted: true } }))
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

  it("[11-20 只认负责人本人] 按时：指定回复时间以后同事、管理记的沟通不停链（30 分钟前那条提醒照旧算回复），照常超时提醒、转；接手人本人记了才停", async () => {
    const 记 = async (projectId: string, ownerId: string, content: string, at: Date) => {
      const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      const f = await prisma.followUp.create({ data: { type: "PHONE", content, occurredAt: at, createdAt: at, title: "", status: "已完成", customerId: p.customerId, ownerId } });
      await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: p.node } });
    };
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") });
    await 记(id, 丙.id, "帮甲接了电话，客户要报价单", 京("2026-11-20 15:10"));
    await 记(id, 老板.id, "回访了一次，客户确认要样品", 京("2026-11-20 15:20"));
    // 指定回复前 30 分钟那条提醒（reply-notice.ts）自己的已回复判定不变：谁记的都算
    expect(await 已回复的([{ id, replyStartAt: null, replyEndAt: 京("2026-11-20 15:00") }])).toEqual(new Set([id]));
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1, 停: 0 });
    expect(await 我超时未跟进的(甲.id)).toMatchObject([{ id, 按分配: false }]);
    expect(await 待回复客户of(甲.id, 京("2026-11-20 16:01"))).toMatchObject({ 条数: 1, 超时: 1, 最早: { projectId: id, 超时: true } });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    // 轮到乙：前负责人甲记的不算
    await 记(id, 甲.id, "我之前联系过，客户要报价", 京("2026-11-20 16:40"));
    expect(await 超时转扫一遍(京("2026-11-20 17:30"))).toMatchObject({ 提醒: 1, 停: 0 });
    await 记(id, 乙.id, "电话联系上了，约了明天看样品", 京("2026-11-20 17:40"));
    expect(await 我超时未跟进的(乙.id)).toEqual([]);
    expect(await 待回复客户of(乙.id, 京("2026-11-20 17:41"))).toBeNull();
    expect(await 超时转扫一遍(京("2026-11-20 18:00"))).toMatchObject({ 停: 1, 转出: 0 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
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

  it("清了指定回复时间：分配在往回 7 天外 = 链不再走，不出错、不连累别的项目；[B1] 负责人本人记过沟通停了的链，改了指定回复时间（新的约定）也不重开", async () => {
    const a = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-10 09:00") });
    const b = await 建线索(乙, { replyEndAt: 京("2026-11-20 15:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await prisma.project.update({ where: { id: a.id }, data: { replyEndAt: null } });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1, 没转成: 0 });
    expect((await 项目(a.id)).ownerId).toBe(甲.id);
    expect((await 项目(b.id)).ownerId).not.toBe(乙.id);
    expect(await prisma.entReplyOverdue.count({ where: { projectId: a.id, stoppedAt: null } })).toBe(0);
    expect(await 待回复客户of(甲.id, 京("2026-11-20 16:31"))).toBeNull();
    await prisma.project.update({ where: { id: b.id }, data: { result: "线索流失" } }); // 不掺和下面的计数

    const c = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") });
    await 记沟通(c.id, "打了电话，约了下周二再聊", 京("2026-11-21 09:50"));
    expect(await 超时转扫一遍(京("2026-11-21 11:00"))).toMatchObject({ 停: 1 });
    expect(await 超时转扫一遍(京("2026-11-21 11:30"))).toMatchObject({ 提醒: 0, 转出: 0, 停: 0 });
    // 下周二约了新的指定回复时间，又没跟进：甲本人已经和客户沟通过（不是首次沟通），新约的时间不再计时（11-20 口径，只管首次沟通）
    await prisma.project.update({ where: { id: c.id }, data: { replyEndAt: 京("2026-11-24 10:00") } });
    expect(await 超时转扫一遍(京("2026-11-24 11:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-24 11:30"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 项目(c.id)).ownerId).toBe(甲.id);
    expect(await prisma.entReplyOverdue.count({ where: { projectId: c.id, stoppedAt: null } })).toBe(0);
    expect(await 超时通知(甲.id)).toHaveLength(1); // 只有 a 那条（11-20 16:00）
  });
});

describe("计时范围（11-18 第 1 题 B；用户 11-20「包括」：销售自建、自领的也转，只剩市场成员自留的不转）", () => {
  it("[32G] 销售个人自持（自己建给自己、没有分给他的记录）：到点提醒、30 分钟后照转", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), creatorId: 甲.id });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1, 转出: 0 });
    expect((await 超时通知(甲.id))[0].body).toContain("自动收回");
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).not.toBe(甲.id);
  });

  it("[S4] 市场成员自留（市场建给自己、没有分给他的记录）：11-20 起填了指定回复时间也不计时（自建只对销售），不提醒、不转、首页待办不标", async () => {
    const 市 = await 造人("mkt-self", "市场自留");
    await prisma.entMember.create({ data: { userId: 市.id, bizRole: "channel_ops", line: "内贸" } });
    忘掉企业版范围();
    const 甲 = 市;
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), creatorId: 甲.id });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时通知(甲.id)).toHaveLength(0);
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 18:30"))).toMatchObject({ 转出: 0 });
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect(await prisma.entLeadAssign.count({ where: { projectId: id } })).toBe(0);
    expect(await 我超时未跟进的(甲.id)).toHaveLength(0);
    expect(自留超时话).toContain("不会自动转走");
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

  it("提醒发了、没转就关掉，过一阵再打开：重新生效——在计时的链停下、不再提醒不再转；打开以后新分的照常计时、老分配新约时间的不计时（11-20 B1）", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00"), createdAt: 京("2026-11-20 10:00") }); // 分配时刻钉死（不取真实当前时间），打开以后不算新分配
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    await 拨(false);
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0 });
    // 17:00 打开（设规则 从关拨到开时调 超时转重新起算）
    await 拨(true);
    expect(await 超时转重新起算(京("2026-11-20 17:00"))).toBe(1);
    expect(await 超时转生效时刻(京("2026-11-20 18:00"))).toEqual(京("2026-11-20 17:00"));
    expect(await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: id } })).toMatchObject({ stoppedAt: 京("2026-11-20 17:00") });
    expect(await 我超时未跟进的(甲.id)).toEqual([]);
    for (const t of ["2026-11-20 17:00", "2026-11-20 18:00", "2026-11-20 18:30", "2026-11-21 10:00"]) {
      expect(await 超时转扫一遍(京(t))).toMatchObject({ 提醒: 0, 转出: 0 });
    }
    expect(await 超时通知(甲.id)).toHaveLength(1);
    expect((await 项目(id)).ownerId).toBe(甲.id);
    // [B1] 打开以后约的指定回复时间：只看分配在不在打开以后——老分配（打开以前分的）+ 新约的时间 = 不计时；打开以后新分的 + 约的时间 = 照常
    const 老分 = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") }, undefined, { 分于: 京("2026-11-20 10:00") });
    const 新 = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") }, undefined, { 分于: 京("2026-11-20 17:30") });
    expect(await 超时转扫一遍(京("2026-11-21 11:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-21 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(新.id)).ownerId).toBe(乙.id);
    expect((await 项目(老分.id)).ownerId).toBe(甲.id);
    expect(await prisma.entReplyOverdue.findUnique({ where: { projectId: 老分.id } })).toBeNull();
  });

  it("重新生效只停还在走的链：停了的（记过沟通）原样不动", async () => {
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

/** 北京时间的一个瞬间，带秒 / 毫秒偏移 */
const 京加 = (s: string, 毫秒: number) => new Date(京(s).getTime() + 毫秒);
const 天ms = 86_400_000;

describe("没填指定回复时间：从分配给销售那一刻起算（11-20 用户定「选1」）", () => {
  /** 一条换人留痕（转让 / 公海领取），时刻可控 */
  async function 记换人(projectId: string, 操作人: string, 从: string | null, 到: string, at: Date, kind: "transfer" | "pool-claim" = "transfer", reason: string | null = "分配方式：自动分配") {
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await prisma.projectNodeLog.create({ data: { projectId, userId: 操作人, kind, fromOwnerId: 从, toOwnerId: 到, reason, at, fromPhase: p.phase, fromNode: p.node, toPhase: p.phase, toNode: p.node } });
  }
  /**
   * 市场（老板）建档、分给 owner；建的人建档时随手记一条沟通（比分配晚 30 秒也不算）。
   * 方式 自动 = 自动 / 指定分配（转让留痕 + 分配记录）；新建 = 市场新建时直接给销售（只有分配记录，比建档晚几十毫秒）
   */
  async function 分来线索(owner: 人, 分于: Date, o: { 方式?: "自动" | "新建"; 建档记一条?: boolean; 补?: Record<string, unknown> } = {}) {
    const 建于 = o.方式 === "新建" ? new Date(分于.getTime() - 300) : 分于;
    const r = await 建线索(owner, { createdAt: 建于, ...o.补 });
    if (o.方式 !== "新建") await 记换人(r.id, 老板.id, 老板.id, owner.id, 分于);
    await prisma.entLeadAssign.create({ data: { projectId: r.id, toUserId: owner.id, fromUserId: 老板.id, byUserId: 老板.id, month: "2026-11", counted: true, createdAt: 分于 } });
    if (o.建档记一条 !== false) await 谁记沟通(r.id, 老板.id, "客户在展会留了电话，想要一套报价", new Date(建于.getTime() + 30_000));
    return r;
  }
  const 谁记沟通 = async (projectId: string, ownerId: string, content: string, at: Date, node?: string) => {
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const f = await prisma.followUp.create({ data: { type: "PHONE", content, occurredAt: at, createdAt: at, title: "", status: "已完成", customerId: p.customerId, ownerId } });
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: node ?? p.node } });
  };
  const 链 = (projectId: string) => prisma.entReplyOverdue.findUnique({ where: { projectId } });

  it("自动分配：建的人建档时记的那条不算；分配 + 1 小时超时提醒（不写「指定回复时间」）→ +1.5 小时转；首页待办写「分配后 1 小时未跟进」", async () => {
    const 分于 = 京("2026-11-20 15:00");
    const { id } = await 分来线索(甲, 分于);
    expect(await 超时转扫一遍(京("2026-11-20 15:59"))).toMatchObject({ 提醒: 0, 停: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1, 停: 0 });
    const 提 = await 超时通知(甲.id);
    expect(提).toHaveLength(1);
    expect(提[0].title).toBe(`超时未跟进：${(await 项目(id)).name}`);
    expect(提[0].body).toContain(分配后未跟进话(60));
    expect(提[0].body).toContain("15:00 分给你");
    expect(提[0].body).toContain("16:30 前还没记");
    expect(提[0].body).not.toContain("指定回复");
    expect(await 链(id)).toMatchObject({ anchorAt: 分于, since: 分于, holderId: 甲.id });
    const 待办 = await 待回复客户of(甲.id, 京("2026-11-20 16:01"));
    expect(待办).toMatchObject({ 条数: 1, 超时: 1, 最早: { projectId: id, 超时: true, 分配话: "分配后 1 小时未跟进", 时: 短时刻(分于, 京("2026-11-20 16:01")) } });

    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    const 收回 = (await 超时通知(甲.id)).at(-1)!;
    expect(收回.title).toContain(收回话);
    expect(收回.body).toContain("分到你手上以后一直没记有效沟通");
    expect(收回.body).not.toContain("指定回复");
    // 轮转不挪基准：链上第一位的分配时刻；接手人从轮转那刻算
    expect(await 链(id)).toMatchObject({ anchorAt: 分于, holderId: 乙.id, since: 京("2026-11-20 16:30"), transfers: 1, tried: JSON.stringify([甲.id]) });
    expect(await 超时转扫一遍(京("2026-11-20 17:30"))).toMatchObject({ 提醒: 1 });
    expect((await 超时通知(乙.id)).at(-1)!.body).toContain("接手已满 1 小时");
    expect(await 超时转扫一遍(京("2026-11-20 18:00"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(丙.id);
  });

  it("市场新建时直接给销售（只有分配记录、没有转让留痕）：按分配记录那一刻起算；建档那条比分配记录晚也不算", async () => {
    const 分于 = 京("2026-11-20 10:00");
    const { id } = await 分来线索(甲, 分于, { 方式: "新建" });
    expect(await prisma.projectNodeLog.count({ where: { projectId: id, kind: "transfer" } })).toBe(0);
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
  });

  it("分配后记了有效沟通（只认负责人本人记的，11-20 用户定）链就停；别人记的（同事、建的人过了建档那一分钟再记的）、空的、占位的、同号留痕不算", async () => {
    const a = await 分来线索(甲, 京("2026-11-20 10:00"));
    await 记沟通(a.id, "打了电话，客户说下周来看样品", 京("2026-11-20 10:40"));
    const b = await 分来线索(甲, 京("2026-11-20 10:00"));
    await 谁记沟通(b.id, 丙.id, "帮甲接了电话，客户要报价单", 京("2026-11-20 10:50"));
    const c = await 分来线索(甲, 京("2026-11-20 10:00"));
    await 谁记沟通(c.id, 老板.id, "回访了一次，客户确认要样品", 京加("2026-11-20 10:00", 建档随手记秒 * 1000 + 1000));
    const d = await 分来线索(甲, 京("2026-11-20 10:00"));
    await 谁记沟通(d.id, 甲.id, "", 京("2026-11-20 10:20"));
    await 谁记沟通(d.id, 甲.id, "客户又来问了", 京("2026-11-20 10:30"), 同号节点);
    // 别人记在分配那一刻之前的（建档前、分配前）不算；负责人本人之前记的算（之前的跟进也算，11-20，另见「生效范围」）
    const e = await 分来线索(甲, 京("2026-11-20 10:00"), { 建档记一条: false });
    await 谁记沟通(e.id, 丙.id, "之前在别的渠道聊过一次", 京("2026-11-20 09:00"));
    const g = await 分来线索(甲, 京("2026-11-20 10:00"), { 建档记一条: false });
    await 谁记沟通(g.id, 甲.id, "之前在别的渠道聊过一次", 京("2026-11-20 09:00"));
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 提醒: 4, 停: 2 });
    for (const x of [a, g]) expect((await 链(x.id))?.stoppedAt).not.toBeNull();
    for (const x of [b, c, d, e]) expect(await 链(x.id)).toMatchObject({ overdueAt: 京("2026-11-20 11:00"), stoppedAt: null });
  });

  it("[11-20 只认负责人本人] 按分配：同事、管理、市场（建的人）、前负责人在分配后记的沟通都不停链，照常提醒、转；负责人本人记了才停；首页待办跟着", async () => {
    const 分于 = 京("2026-11-20 10:00");
    const r = await 分来线索(甲, 分于);
    await 谁记沟通(r.id, 丙.id, "帮甲接了电话，客户要报价单", 京("2026-11-20 10:20"));
    await 谁记沟通(r.id, 老板.id, "回访了一次，客户确认要样品", 京("2026-11-20 10:30"));
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 提醒: 1, 停: 0 });
    expect(await 我超时未跟进的(甲.id)).toMatchObject([{ id: r.id, 按分配: true }]);
    expect(await 待回复客户of(甲.id, 京("2026-11-20 11:01"))).toMatchObject({ 超时: 1, 最早: { projectId: r.id, 超时: true } });
    expect((await 盘点超时链(京("2026-11-20 11:01"))).find((x) => x.id === r.id)).toMatchObject({ 回了: false, 下一步: null });
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(r.id)).ownerId).toBe(乙.id);
    // 轮到乙：前负责人甲、同事丙接着记的都不算，乙到点照样提醒
    await 谁记沟通(r.id, 甲.id, "我之前联系过，客户要报价", 京("2026-11-20 11:40"));
    await 谁记沟通(r.id, 丙.id, "又帮忙接了一次电话", 京("2026-11-20 11:50"));
    expect(await 超时转扫一遍(京("2026-11-20 12:30"))).toMatchObject({ 提醒: 1, 停: 0 });
    // 乙本人记了：链停下，乙首页待办不再标超时，不再转
    await 谁记沟通(r.id, 乙.id, "电话联系上了，约了明天看样品", 京("2026-11-20 12:40"));
    expect(await 我超时未跟进的(乙.id)).toEqual([]);
    expect(await 超时转扫一遍(京("2026-11-20 13:00"))).toMatchObject({ 停: 1, 转出: 0 });
    expect((await 项目(r.id)).ownerId).toBe(乙.id);
  });

  it("往回看 7 天：分配在 7 天内的进链，早于 7 天的不进；填了指定回复时间的照旧 3 天、照旧按指定回复时间（不改按分配）", async () => {
    expect(分配起链往回看天).toBe(7);
    expect(起链往回看天).toBe(3);
    const 现在 = 京("2026-11-20 10:00");
    const 内 = await 分来线索(甲, new Date(现在.getTime() - 7 * 天ms + 60_000));
    const 外 = await 分来线索(甲, new Date(现在.getTime() - 7 * 天ms - 60_000));
    // 填了指定回复时间：4 天前的不进（不因为 1 天前分配过就改按分配）；2 天前的照进
    const 回4 = await 分来线索(甲, 京("2026-11-19 10:00"), { 补: { replyEndAt: 京("2026-11-16 10:00") } });
    const 回2 = await 分来线索(甲, 京("2026-11-19 10:00"), { 补: { replyEndAt: 京("2026-11-18 10:00") }, 建档记一条: false });
    // 填了指定回复时间的：建的人（市场）建档时那条在提醒时刻之后，但不是负责人本人记的，不算回了（11-20 用户定只认负责人本人记的）
    const 回2记 = await 分来线索(甲, 京("2026-11-19 10:00"), { 补: { replyEndAt: 京("2026-11-18 10:00") } });
    expect(await 超时转扫一遍(现在)).toMatchObject({ 提醒: 3, 停: 0 });
    expect(await 链(回2记.id)).toMatchObject({ anchorAt: 京("2026-11-18 10:00"), overdueAt: 现在, stoppedAt: null });
    expect(await 链(内.id)).toMatchObject({ overdueAt: 现在 });
    expect(await 链(外.id)).toBeNull();
    expect(await 链(回4.id)).toBeNull();
    expect(await 链(回2.id)).toMatchObject({ anchorAt: 京("2026-11-18 10:00"), overdueAt: 现在 });
    // 文案：按分配的写「分配后 1 小时未跟进」；按时、分配晚于指定回复时间的照旧（从接手那刻算，「接手已满 1 小时」）
    const 文 = (await 超时通知(甲.id)).map((n) => n.body);
    expect(文.filter((x) => x.includes(分配后未跟进话(60)))).toHaveLength(1);
    expect(文.filter((x) => x.includes("接手已满 1 小时"))).toHaveLength(2);
  });

  it("管理从线索公海分给销售（pool-claim、操作人不是接手人）进链：按分的那一刻起算，到点提醒、再 30 分钟转", async () => {
    const { id } = await 建线索(甲, { createdAt: 京("2026-11-01 10:00") });
    await 记换人(id, 老板.id, null, 甲.id, 京("2026-11-20 10:00"), "pool-claim", "原负责人没做完的待办带过来 0 条");
    // 分之前记的（老沟通、上一位负责人记的）不算
    await 谁记沟通(id, 乙.id, "上次联系过，客户说再考虑", 京("2026-11-05 10:00"));
    expect(await 超时转扫一遍(京("2026-11-20 10:59"))).toMatchObject({ 提醒: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 提醒: 1 });
    expect(await 链(id)).toMatchObject({ anchorAt: 京("2026-11-20 10:00"), since: 京("2026-11-20 10:00") });
    expect((await 超时通知(甲.id))[0].body).toContain(分配后未跟进话(60));
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).not.toBe(甲.id);

    await prisma.project.update({ where: { id }, data: { result: "线索流失" } }); // 不掺和下面的计数
    // 甲自己建的线索进了公海，管理从公海分回给甲（没有分配记录）：同样是别人分给他的，照转（填了指定回复时间的也一样）
    const 回 = await 建线索(甲, { createdAt: 京("2026-11-01 10:00"), creatorId: 甲.id });
    await 记换人(回.id, 老板.id, null, 甲.id, 京("2026-11-20 12:00"), "pool-claim", null);
    const 回时 = await 建线索(甲, { createdAt: 京("2026-11-01 10:00"), creatorId: 甲.id, replyEndAt: 京("2026-11-20 12:00") });
    await 记换人(回时.id, 老板.id, null, 甲.id, 京("2026-11-20 11:00"), "pool-claim", null);
    expect(await 超时转扫一遍(京("2026-11-20 13:00"))).toMatchObject({ 提醒: 2 });
    expect(await 超时转扫一遍(京("2026-11-20 13:30"))).toMatchObject({ 转出: 2 });
    expect((await 项目(回.id)).ownerId).not.toBe(甲.id);
    expect((await 项目(回时.id)).ownerId).not.toBe(甲.id);
  });

  it("[32G] 销售自己去公海领（pool-claim、操作人 = 接手人）、销售自己建的从那一刻起算、到点照转；导入出公海那行、没留痕就换了人的、导入建的、市场成员自留的不起算", async () => {
    const t = 京("2026-11-20 10:00");
    // 真实领取（project/db.ts 领一个公海项目）那行：从 = 历史负责人、操作人 = 接手人
    const 领 = await 建线索(甲, { createdAt: 京("2026-11-10 10:00") });
    await 记换人(领.id, 甲.id, 乙.id, 甲.id, t, "pool-claim", "原负责人没做完的待办带过来 0 条");
    // 先被管理从公海分给乙、乙放回去以后甲自己领：最近那次是自己领，不起算
    const 再领 = await 建线索(甲, { createdAt: 京("2026-11-10 10:00") });
    await 记换人(再领.id, 老板.id, null, 乙.id, 京("2026-11-19 10:00"), "pool-claim", null);
    await 记换人(再领.id, 甲.id, 乙.id, 甲.id, t, "pool-claim", "原负责人没做完的待办没带");
    const 导入 = await 建线索(甲, { createdAt: 京("2026-11-10 10:00") });
    await 记换人(导入.id, 甲.id, null, 甲.id, t, "transfer", null);
    const 改人 = await 分来线索(乙, t);
    await prisma.project.update({ where: { id: 改人.id }, data: { ownerId: 甲.id } }); // 导入改负责人：不留痕
    const 自建 = await 建线索(甲, { createdAt: t, creatorId: 甲.id, assignMode: "个人自持" });
    // [B2] 导入建的：真实导入（project-target.ts 建项目 / apply.ts 线索落项目）把创建人记成负责人，留一行导入对照（EntExternalRef opportunity）；
    // 不是销售自建，不从建档起算（P-转-41「导入不起算」）。整批真导入的见下「[B2] 真实导入」
    const 导入建 = await 建线索(甲, { createdAt: t, creatorId: 甲.id });
    await prisma.entExternalRef.create({ data: { source: "excel", entity: "opportunity", externalId: "O-导入建", targetId: 导入建.id, fingerprint: "x", written: "{}", raw: "{}" } });
    const 市 = await 造人("mkt-pool", "市场");
    await prisma.entMember.create({ data: { userId: 市.id, bizRole: "marketing_mgr", line: "内贸" } });
    忘掉企业版范围();
    const 市场自留 = await 建线索(市, { createdAt: t, creatorId: 市.id, assignMode: "潜客培育" });
    expect(await 超时转扫一遍(京("2026-11-20 12:00"))).toMatchObject({ 提醒: 3, 转出: 0 });
    for (const x of [领, 再领, 自建]) expect(await 链(x.id)).toMatchObject({ anchorAt: t, overdueAt: 京("2026-11-20 12:00") });
    for (const x of [导入, 改人, 导入建, 市场自留]) expect(await 链(x.id)).toBeNull();
    expect(await 超时转扫一遍(京("2026-11-20 12:30"))).toMatchObject({ 转出: 3 });
    for (const x of [领, 再领, 自建]) expect((await 项目(x.id)).ownerId).not.toBe(甲.id);
    expect(await 超时通知(市.id)).toHaveLength(0);
  });

  it("分配基准（纯函数）：轮转那几行跳过、最近一次分配为准；管理从公海分按那一刻；自己领 / 导入出公海 / 最近换人不是给现负责人 = null；只有分配记录按最早那条", () => {
    const 痕 = (at: string, 到: string, 补: Partial<换人痕> = {}): 换人痕 => ({ kind: "transfer", userId: "boss", reason: "分配方式：自动分配", fromOwnerId: "boss", toOwnerId: 到, at: 京(at), ...补 });
    const 轮转 = (at: string, 从: string, 到: string) => 痕(at, 到, { userId: "system", fromOwnerId: 从, reason: `分配方式：自动分配；${超时自动转理由}（原负责人 x 超时没记有效沟通）` });
    const p = { ownerId: "b", creatorId: "boss" };
    expect(分配基准(p, [痕("2026-11-20 10:00", "a"), 轮转("2026-11-20 11:30", "a", "b")], [])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [轮转("2026-11-20 11:30", "a", "b")], [{ toUserId: "a", byUserId: "boss", createdAt: 京("2026-11-20 10:00") }, { toUserId: "b", byUserId: "boss", createdAt: 京("2026-11-20 11:30") }])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [痕("2026-11-20 10:00", "a"), 痕("2026-11-20 12:00", "b")], [])).toEqual(京("2026-11-20 12:00"));
    // 公海：别人分给他的按那一刻；自己领的 = null
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", fromOwnerId: null })], [])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", userId: "system", fromOwnerId: null })], [])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", userId: "b", fromOwnerId: null })], [])).toBeNull();
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", userId: "b", fromOwnerId: "a" })], [])).toBeNull();
    // 操作人 = 接手人的一律不起算：自己分给自己（分配入口）、导入出公海、自己建的分配记录
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { userId: "b", fromOwnerId: "a" })], [])).toBeNull();
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { userId: "b", fromOwnerId: null, reason: null })], [])).toBeNull();
    expect(分配基准(p, [], [{ toUserId: "b", byUserId: "b", createdAt: 京("2026-11-20 09:00") }])).toBeNull();
    // [32G] 负责人不是市场成员（自己的也算）：自己领的按领的那一刻、自己建的（一行换人都没有）按建的那一刻
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", userId: "b", fromOwnerId: "a" })], [], [], true)).toEqual(京("2026-11-20 10:00"));
    expect(分配基准({ ownerId: "b", creatorId: "b", createdAt: 京("2026-11-20 09:00") }, [], [], [], true)).toEqual(京("2026-11-20 09:00"));
    expect(分配基准({ ownerId: "b", creatorId: "b", createdAt: 京("2026-11-20 09:00") }, [], [], [], false)).toBeNull();
    // 自己分给自己（转让留痕，不是领）照旧不起算
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { userId: "b", fromOwnerId: "a" })], [], [], true)).toBeNull();
    // 手动转让（改项目）：原因是待办痕 = 起算；原因空的转让留痕一律不起算（老的离职交接只交项目、没带开头的转项目调用；客户换没换人都一样）
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { reason: "原负责人没做完的待办没带" })], [])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { reason: null })], [])).toBeNull();
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { reason: null })], [], [{ toOwnerId: "b", at: 京("2026-11-19 10:00"), kind: "assign", userId: "boss" }])).toBeNull();
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { reason: null })], [], [{ toOwnerId: "b", at: 京加("2026-11-20 10:00", 30), kind: "assign", userId: "boss" }])).toBeNull();
    // 跟着客户带过去的（跟着客户转过来、离职交接、随客户转走，转让和 pool-claim 都是）、回收站恢复、数据脚本 = 不起算
    for (const 因 of ["跟着客户转过来", "跟着客户转过来；原负责人没做完的待办带过来 0 条", "离职交接", "随客户转走", "从回收站恢复，跟客户现负责人", "客户合并：随「某客户」并入 b 名下同一客户"]) {
      expect(分配基准(p, [痕("2026-11-20 10:00", "b", { reason: 因 })], [])).toBeNull();
      expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", fromOwnerId: null, reason: 因 })], [])).toBeNull();
    }
    // 管理分客户公海带出的线索公海项目（从客户公海分配）= 起算，同一刻客户换了人也算
    const 分客户 = { toOwnerId: "b", at: 京("2026-11-20 10:00"), kind: "pool-assign", userId: "boss" };
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", fromOwnerId: null, reason: "从客户公海分配；原负责人没做完的待办带过来 0 条" })], [], [分客户])).toEqual(京("2026-11-20 10:00"));
    // 老 pool-claim（没有开头）：同一刻客户换人是管理分客户公海 = 起算（11-14 那批）；是转让 / 市场转 / 离职 / 自己领 = 不起算；客户没换人 = 分线索公海项目、起算
    const 老 = (原因: string | null) => 痕("2026-11-20 10:00", "b", { kind: "pool-claim", fromOwnerId: null, reason: 原因 });
    for (const 原因 of [null, "原负责人没做完的待办带过来 0 条"]) {
      expect(分配基准(p, [老(原因)], [], [{ ...分客户, at: 京加("2026-11-20 10:00", 2) }])).toEqual(京("2026-11-20 10:00"));
      for (const kind of ["assign", "market-assign", "deactivate"]) expect(分配基准(p, [老(原因)], [], [{ ...分客户, kind }])).toBeNull();
      expect(分配基准(p, [老(原因)], [], [{ ...分客户, kind: "claim", userId: "b" }])).toBeNull();
      expect(分配基准(p, [老(原因)], [], [{ ...分客户, userId: "b" }])).toBeNull();
      expect(分配基准(p, [老(原因)], [], [{ ...分客户, kind: "assign", at: 京加("2026-11-20 10:00", 60_000) }])).toEqual(京("2026-11-20 10:00"));
      expect(分配基准(p, [老(原因)], [])).toEqual(京("2026-11-20 10:00"));
    }
    // 管理分线索公海项目（从线索公海分配）、手动转让没碰待办（手动转让）= 起算，同一刻客户跟着市场转（market-assign）也算
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", fromOwnerId: null, reason: "从线索公海分配" })], [], [{ ...分客户, kind: "market-assign" }])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", fromOwnerId: null, reason: "从线索公海分配；原负责人没做完的待办带过来 1 条" })], [])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { reason: "手动转让" })], [])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { reason: "从线索公海分配", userId: "b" })], [])).toBeNull();
    // 分配入口的那行同一刻客户也跟着转（市场首次分给销售）照样起算
    expect(分配基准(p, [痕("2026-11-20 10:00", "b")], [], [{ ...分客户, kind: "market-assign" }])).toEqual(京("2026-11-20 10:00"));
    // 建的人就是负责人：管理从公海分回给他也算分来的（没有分配记录）；自己领的不算
    expect(分配基准({ ownerId: "b", creatorId: "b" }, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", fromOwnerId: null })], [])).toEqual(京("2026-11-20 10:00"));
    expect(分配基准({ ownerId: "b", creatorId: "b" }, [痕("2026-11-20 10:00", "b", { kind: "pool-claim", userId: "b", fromOwnerId: null })], [])).toBeNull();
    expect(分配基准(p, [痕("2026-11-20 10:00", "b", { userId: "b", fromOwnerId: null })], [])).toBeNull();
    expect(分配基准(p, [痕("2026-11-20 10:00", "a")], [])).toBeNull();
    expect(分配基准(p, [], [{ toUserId: "b", byUserId: "boss", createdAt: 京("2026-11-20 09:00") }])).toEqual(京("2026-11-20 09:00"));
    expect(分配基准(p, [], [])).toBeNull();
    // 自己建给自己、没有分给他的记录 = 不是分来的
    expect(分配基准({ ownerId: "b", creatorId: "b" }, [痕("2026-11-20 10:00", "b")], [])).toBeNull();
    expect(分配基准({ ownerId: "b", creatorId: "b" }, [痕("2026-11-20 10:00", "b")], [{ toUserId: "b", byUserId: "boss", createdAt: 京("2026-11-20 10:00") }])).toEqual(京("2026-11-20 10:00"));
  });

  it("夜里不执行：21:30 分配 → 22:30 该提醒 → 次日 08:00 提醒、08:30 转", async () => {
    const { id } = await 分来线索(甲, 京("2026-11-20 21:30"));
    for (const t of ["2026-11-20 22:30", "2026-11-21 03:00", "2026-11-21 07:59"]) expect(await 超时转扫一遍(京(t))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 08:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-21 08:29"))).toMatchObject({ 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 08:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
  });

  it("停机补跑只走一步：2 天前分配（生效以后）、一直没记的，第一遍只发超时提醒，30 分钟后才转，接手人从转出那刻起算、不连环转", async () => {
    const { id } = await 分来线索(甲, 京("2026-11-18 14:00"));
    expect(await 盘点超时链(京("2026-11-20 14:00"))).toEqual([expect.objectContaining({ id, ownerId: 甲.id, 按分配: true, 回了: false, 起链: true, 下一步: "提醒" })]);
    expect(await 链(id)).toBeNull(); // 盘点只读
    expect(await 超时转扫一遍(京("2026-11-20 14:00"))).toMatchObject({ 提醒: 1, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 14:01"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 14:29"))).toMatchObject({ 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 14:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    expect(await 超时转扫一遍(京("2026-11-20 14:31"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 15:30"))).toMatchObject({ 提醒: 1, 转出: 0 });
  });

  it("改指定回复时间：从空填上 = 整行重来按新时间（没到不动）；清空 = 改按分配（分配在 7 天内、分配后没记的照进链，先提醒再转）", async () => {
    const a = await 分来线索(甲, 京("2026-11-20 10:00"));
    await 超时转扫一遍(京("2026-11-20 11:00"));
    expect(await 链(a.id)).toMatchObject({ anchorAt: 京("2026-11-20 10:00"), overdueAt: 京("2026-11-20 11:00") });
    // 11:10 销售和客户约了 15:00 回电：填上指定回复时间
    await prisma.project.update({ where: { id: a.id }, data: { replyStartAt: 京("2026-11-20 15:00") } });
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 项目(a.id)).ownerId).toBe(甲.id);
    expect(await 链(a.id)).toBeNull();
    expect(await 我超时未跟进的(甲.id)).toEqual([]);
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    expect((await 超时通知(甲.id)).at(-1)!.body).toContain("指定回复时间");
    expect(await 链(a.id)).toMatchObject({ anchorAt: 京("2026-11-20 15:00") });
    // 又清空：改按分配（10:00 分配、之后没记）→ 整行重来，这一遍先提醒，30 分钟后才转
    await prisma.project.update({ where: { id: a.id }, data: { replyStartAt: null } });
    expect(await 超时转扫一遍(京("2026-11-20 16:10"))).toMatchObject({ 提醒: 1, 转出: 0 });
    expect(await 链(a.id)).toMatchObject({ anchorAt: 京("2026-11-20 10:00"), overdueAt: 京("2026-11-20 16:10") });
    expect((await 我超时未跟进的(甲.id)).map((x) => [x.id, x.按分配, x.分配于])).toEqual([[a.id, true, 京("2026-11-20 10:00")]]);
    expect(await 超时转扫一遍(京("2026-11-20 16:40"))).toMatchObject({ 转出: 1 });
    expect((await 项目(a.id)).ownerId).toBe(乙.id);
  });

  it("按分配的链还在走时手动转让：基准不变、接手人从转让那刻起算、超时过的人照记；链停了以后再转让 = 新的一次分配，整条重来", async () => {
    const a = await 分来线索(甲, 京("2026-11-20 10:00"));
    await 超时转扫一遍(京("2026-11-20 11:00"));
    await prisma.project.update({ where: { id: a.id }, data: { ownerId: 丙.id } });
    await 记换人(a.id, 老板.id, 甲.id, 丙.id, 京("2026-11-20 11:10"), "transfer", "原负责人没做完的待办没带"); // 改项目 手动转让那行的原因（待办痕）
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 链(a.id)).toMatchObject({ anchorAt: 京("2026-11-20 10:00"), holderId: 丙.id, since: 京("2026-11-20 11:10"), overdueAt: null });
    expect(await 超时转扫一遍(京("2026-11-20 12:10"))).toMatchObject({ 提醒: 1 });
    expect((await 超时通知(丙.id)).at(-1)!.body).toContain("接手已满 1 小时");
    // 丙记了 → 链停
    await 记沟通(a.id, "联系上了，客户约了下周看厂", 京("2026-11-20 12:20"));
    expect(await 超时转扫一遍(京("2026-11-20 12:21"))).toMatchObject({ 停: 1 });
    // 13:00 又转给乙：新的一次分配，乙得在 1.5 小时里记；丙之前那条在 13:00 之前，不算
    await prisma.project.update({ where: { id: a.id }, data: { ownerId: 乙.id } });
    await 记换人(a.id, 老板.id, 丙.id, 乙.id, 京("2026-11-20 13:00"), "transfer", "原负责人没做完的待办没带"); // 改项目 手动转让那行的原因（待办痕）
    expect(await 超时转扫一遍(京("2026-11-20 13:59"))).toMatchObject({ 提醒: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 14:00"))).toMatchObject({ 提醒: 1 });
    expect(await 链(a.id)).toMatchObject({ anchorAt: 京("2026-11-20 13:00"), holderId: 乙.id, tried: "[]", transfers: 0, stoppedAt: null });
  });

  it("清空了指定回复时间、分配基准在往回 7 天外：链不再走，不出错（同上「清了指定回复时间」）", async () => {
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-10 09:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    await prisma.project.update({ where: { id }, data: { replyEndAt: null } });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0, 没转成: 0 });
    expect(await prisma.entReplyOverdue.count({ where: { projectId: id, stoppedAt: null } })).toBe(0);
    expect((await 项目(id)).ownerId).toBe(甲.id);
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

describe("生效范围（11-20 事故：只对生效以后新分配的计时、之前的跟进也算）", () => {
  const 设生效 = async (t: Date) => { await setSetting(超时转生效key, t.toISOString()); invalidateSettingsCache(); };
  const 链 = (projectId: string) => prisma.entReplyOverdue.findUnique({ where: { projectId } });
  /** 一行换人留痕 */
  async function 记换人(projectId: string, 操作人: string, 到: string, at: Date, kind: "transfer" | "pool-claim" = "transfer", reason = "分配方式：自动分配") {
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await prisma.projectNodeLog.create({ data: { projectId, userId: 操作人, kind, fromOwnerId: null, toOwnerId: 到, reason, at, fromPhase: p.phase, fromNode: p.node, toPhase: p.phase, toNode: p.node } });
  }
  /** 老板建档、在 分于 自动分给 owner（转让留痕 + 分配记录），建档那一刻老板随手记一条 */
  async function 分来(owner: 人, 分于: Date, 建于: Date = 分于, customerId?: string) {
    const r = await 建线索(owner, { createdAt: 建于 }, customerId);
    await 记换人(r.id, 老板.id, owner.id, 分于);
    await prisma.entLeadAssign.create({ data: { projectId: r.id, toUserId: owner.id, fromUserId: 老板.id, byUserId: 老板.id, month: "2026-11", counted: true, createdAt: 分于 } });
    await 记(r.customerId, 老板.id, "客户在展会留了电话，想要一套报价", new Date(建于.getTime() + 30_000), r.id);
    return r;
  }
  /** 记一条沟通：挂项目（projectId）或只挂客户；type、标题、节点可改 */
  async function 记(customerId: string, ownerId: string, content: string, at: Date, projectId?: string, o: { type?: string; title?: string; node?: string; occurredAt?: Date } = {}) {
    const f = await prisma.followUp.create({ data: { type: o.type ?? "WECHAT", content, occurredAt: o.occurredAt ?? at, createdAt: at, title: o.title ?? "", status: "已完成", customerId, ownerId } });
    if (projectId) await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: o.node ?? "潜客培育" } });
  }

  it("复现 11-20 事故：11-14 管理从客户公海分给甲（老留痕）、甲 11-03 导入过历史跟进；生效时刻 11-20 20:35 → 21:06 起一直不提醒、不转", async () => {
    await 设生效(京("2026-11-20 20:35"));
    // A：11-14 管理从客户公海分（pool-claim 带待办痕 + 同一刻客户换人 pool-assign），甲一条沟通都没记
    const A = await 建线索(甲, { createdAt: 京("2026-09-12 00:00") });
    await 记换人(A.id, 老板.id, 甲.id, 京("2026-11-14 22:29"), "pool-claim", "原负责人没做完的待办带过来 0 条");
    await prisma.customerOwnerLog.create({ data: { customerId: A.customerId, userId: 老板.id, toOwnerId: 甲.id, kind: "pool-assign", at: 京("2026-11-14 22:29") } });
    // B：同一批，甲 11-03 导入过 7 月的跟进（挂在这条项目上）
    const B = await 建线索(甲, { createdAt: 京("2026-04-01 00:00") });
    await 记换人(B.id, 老板.id, 甲.id, 京("2026-11-14 22:29"), "pool-claim", "原负责人没做完的待办带过来 0 条");
    await prisma.customerOwnerLog.create({ data: { customerId: B.customerId, userId: 老板.id, toOwnerId: 甲.id, kind: "pool-assign", at: 京("2026-11-14 22:29") } });
    await 记(B.customerId, 甲.id, "加了微信，客户要了产品目录和报价", 京("2026-11-03 15:32"), B.id, { occurredAt: 京("2026-07-17 14:47") });
    // C：当天中午自动分给甲（生效以前）
    const C = await 分来(甲, 京("2026-11-20 13:39"));
    // 旧代码会把这三条全提醒、再转走（生效时刻当成很早）
    for (const t of ["2026-11-20 20:35", "2026-11-20 21:06", "2026-11-20 21:36", "2026-11-21 08:00", "2026-11-21 08:30"]) {
      expect(await 超时转扫一遍(京(t))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    }
    for (const x of [A, B, C]) {
      expect((await 项目(x.id)).ownerId).toBe(甲.id);
      expect(await 链(x.id)).toBeNull();
    }
    expect(await 超时通知(甲.id)).toHaveLength(0);
    expect(await 盘点超时链(京("2026-11-20 21:06"))).toEqual([]);
    // 生效以后新分的照常：20:40 分给甲，21:40 提醒，次日 08:00 转（夜里顺延：21:40 提醒 → 22:10 该转 → 08:00）
    const D = await 分来(甲, 京("2026-11-20 20:40"));
    expect(await 超时转扫一遍(京("2026-11-20 21:40"))).toMatchObject({ 提醒: 1, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 08:00"))).toMatchObject({ 转出: 1 });
    expect((await 项目(D.id)).ownerId).toBe(乙.id);
  });

  it("之前的跟进也算：就算生效时刻很早，负责人以前在这位客户上记过有效沟通（导入的旧跟进、没挂项目的、挂在同客户别的项目上的）不起链", async () => {
    const 分于 = 京("2026-11-20 10:00");
    const 挂本条 = await 分来(甲, 分于);
    await 记(挂本条.customerId, 甲.id, "加了微信，客户要了产品目录和报价", 京("2026-11-03 15:32"), 挂本条.id, { occurredAt: 京("2026-07-17 14:47") });
    const 只挂客户 = await 分来(甲, 分于);
    await 记(只挂客户.customerId, 甲.id, "电话里报了价，客户说月底定", 京("2026-11-12 15:41"));
    const 别的项目 = await 分来(甲, 分于);
    const 旧项目 = await 建线索(甲, { createdAt: 京("2026-10-01 00:00") }, 别的项目.customerId);
    await 记(别的项目.customerId, 甲.id, "上次这位客户订过一批样品，回访过", 京("2026-10-02 10:00"), 旧项目.id);
    // 不算：只有跟进任务 / 提醒、同号留痕、空的占位的、别人（市场、前任）记的
    const 任务 = await 分来(甲, 分于);
    await 记(任务.customerId, 甲.id, "明天给客户打电话问报价", 京("2026-11-19 10:00"), 任务.id, { type: "TASK" });
    const 同号 = await 分来(甲, 分于);
    await 记(同号.customerId, 甲.id, "客户又来问了一次报价单", 京("2026-11-19 10:00"), 同号.id, { title: "同号再次录入", node: 同号节点 });
    const 占位 = await 分来(甲, 分于);
    await 记(占位.customerId, 甲.id, "已联系", 京("2026-11-19 10:00"), 占位.id);
    const 别人 = await 分来(甲, 分于);
    await 记(别人.customerId, 丙.id, "前任跟过：客户要了报价单", 京("2026-11-03 15:32"), 别人.id);
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 提醒: 4, 停: 3 });
    for (const x of [挂本条, 只挂客户, 别的项目]) expect((await 链(x.id))?.stoppedAt).toEqual(京("2026-11-20 11:00"));
    for (const x of [任务, 同号, 占位, 别人]) expect(await 链(x.id)).toMatchObject({ overdueAt: 京("2026-11-20 11:00"), stoppedAt: null });
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 转出: 4 });
    for (const x of [挂本条, 只挂客户, 别的项目]) expect((await 项目(x.id)).ownerId).toBe(甲.id);
  });

  it("轮转到的接手人以前跟过这位客户：链停下，不再转", async () => {
    const r = await 分来(甲, 京("2026-11-20 10:00"));
    await 记(r.customerId, 乙.id, "去年见过面，聊过一次合作", 京("2026-11-01 10:00"));
    await 超时转扫一遍(京("2026-11-20 11:00"));
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(r.id)).ownerId).toBe(乙.id);
    expect(await 超时转扫一遍(京("2026-11-20 11:31"))).toMatchObject({ 停: 1 });
    expect(await 超时转扫一遍(京("2026-11-20 13:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 项目(r.id)).ownerId).toBe(乙.id);
  });

  it("还在走、基准早于生效时刻的链（事故那批留下的）：下一遍停掉，不提醒、不转，首页待办不标", async () => {
    const r = await 分来(甲, 京("2026-11-14 22:29"));
    await prisma.entReplyOverdue.create({ data: { projectId: r.id, anchorAt: 京("2026-11-14 22:29"), holderId: 甲.id, since: 京("2026-11-20 20:35"), overdueAt: 京("2026-11-20 20:36") } });
    await 设生效(京("2026-11-20 22:00"));
    expect(await 我超时未跟进的(甲.id)).toEqual([]);
    expect(await 超时转扫一遍(京("2026-11-21 08:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 链(r.id))?.stoppedAt).toEqual(京("2026-11-21 08:00"));
    expect((await 项目(r.id)).ownerId).toBe(甲.id);
  });

  it("从没记过生效时刻：开着时第一遍扫记成那一刻（= 上线时刻），以前分的不起链；盘点、首页只读不记，当现在", async () => {
    await prisma.setting.delete({ where: { key: 超时转生效key } });
    invalidateSettingsCache();
    const 老 = await 分来(甲, 京("2026-11-20 10:00"));
    expect(await 盘点超时链(京("2026-11-20 12:00"))).toEqual([]);
    expect(await prisma.setting.count({ where: { key: 超时转生效key } })).toBe(0);
    expect(await 超时转扫一遍(京("2026-11-20 12:00"))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    expect(await 超时转生效时刻(京("2026-11-20 13:00"))).toEqual(京("2026-11-20 12:00"));
    expect(await 链(老.id)).toBeNull();
    // 关着时扫不记（打开时由 超时转重新起算 记）
    await prisma.setting.delete({ where: { key: 超时转生效key } });
    await setSetting(规则.超时自动转.key, false);
    invalidateSettingsCache();
    await 超时转扫一遍(京("2026-11-20 12:30"));
    expect(await prisma.setting.count({ where: { key: 超时转生效key } })).toBe(0);
    // [S3] 有这一行但存坏了：按现在算（以前的都不算），扫的时候不覆盖（不把写坏的将来时刻悄悄改成现在、提前生效），只记一次日志
    await setSetting(规则.超时自动转.key, true);
    await setSetting(超时转生效key, "不是时刻");
    invalidateSettingsCache();
    expect(await 超时转生效时刻(京("2026-11-20 13:00"))).toEqual(京("2026-11-20 13:00"));
    const 新 = await 分来(甲, 京("2026-11-20 13:10"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await 超时转扫一遍(京("2026-11-20 13:05"));
    expect(await 超时转生效时刻(京("2026-11-20 13:06"), true)).toEqual(京("2026-11-20 13:06"));
    expect(await prisma.setting.findUnique({ where: { key: 超时转生效key } })).toMatchObject({ value: JSON.stringify("不是时刻") });
    expect(await 超时转扫一遍(京("2026-11-20 14:10"))).toMatchObject({ 提醒: 0 });
    expect(await 链(新.id)).toBeNull();
    expect(warn.mock.calls.flat().join("")).toContain("解析不出时刻");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("解析不出时刻"))).toHaveLength(1);
    warn.mockRestore();
    // 改好了照常
    await 设生效(京("2026-11-20 13:00"));
    expect(await 超时转扫一遍(京("2026-11-20 14:11"))).toMatchObject({ 提醒: 1 });
    expect(await 链(新.id)).toMatchObject({ anchorAt: 京("2026-11-20 13:10") });
  });

  it("[32G 两步走第一步] 生效时刻设成将来（北京 11-21 09:30）：开关开着，到点之前分的一律不计时，到点以后新分的照常提醒、转", async () => {
    await 设生效(京("2026-11-21 09:30"));
    const 早 = await 分来(甲, 京("2026-11-20 20:00"));
    const 当天早上 = await 分来(乙, 京("2026-11-21 09:00"));
    for (const t of ["2026-11-20 21:00", "2026-11-21 08:00", "2026-11-21 09:31", "2026-11-21 10:30", "2026-11-21 11:00"]) {
      expect(await 超时转扫一遍(京(t))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    }
    expect(await 链(早.id)).toBeNull();
    expect(await 链(当天早上.id)).toBeNull();
    expect(await 超时通知(甲.id)).toHaveLength(0);
    // 生效时刻没被扫一遍改掉
    expect(await 超时转生效时刻(京("2026-11-21 11:00"))).toEqual(京("2026-11-21 09:30"));
    const 新 = await 分来(甲, 京("2026-11-21 09:40"));
    expect(await 超时转扫一遍(京("2026-11-21 10:40"))).toMatchObject({ 提醒: 1, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 11:10"))).toMatchObject({ 转出: 1 });
    expect((await 项目(新.id)).ownerId).not.toBe(甲.id);
    expect((await 项目(早.id)).ownerId).toBe(甲.id);
  });

  it("[32G 两步走第一步] 开关从关拨到开：已经设了将来的生效时刻就留着；设的是过去的照旧改成打开那一刻", async () => {
    await 设生效(京("2026-11-21 09:30"));
    await 超时转重新起算(京("2026-11-20 22:10"));
    invalidateSettingsCache();
    expect(await 超时转生效时刻(京("2026-11-20 22:11"))).toEqual(京("2026-11-21 09:30"));
    await 设生效(京("2026-11-19 09:30"));
    await 超时转重新起算(京("2026-11-20 22:10"));
    invalidateSettingsCache();
    expect(await 超时转生效时刻(京("2026-11-20 22:11"))).toEqual(京("2026-11-20 22:10"));
  });

  it("[32G 两步走第二步] 历史数据起算（北京 12-01 00:00）：负责人在这位客户上没有任何跟进记录的老线索（生效前分的、导入的、销售自建的、指定回复时间早过了的）到点进链，夜里顺延 08:00 提醒、08:30 转", async () => {
    await 设生效(京("2026-11-21 09:30"));
    const 设历史 = async (t: Date) => { await setSetting(历史起算key, t.toISOString()); invalidateSettingsCache(); };
    // 生效前分的、甲一条沟通都没记（老板建档随手记的那条不算）
    const 老分 = await 分来(甲, 京("2026-11-10 10:00"));
    // 导入的：没有任何换人留痕和分配记录，负责人乙、建的人是老板
    const 导入 = await 建线索(乙, { createdAt: 京("2026-10-01 00:00") }, undefined, { 不分配: true });
    // 指定回复时间早就过了
    const 早过 = await 建线索(丙, { createdAt: 京("2026-11-01 00:00"), replyEndAt: 京("2026-11-02 15:00") });
    // 负责人以前跟过（任何时候）：不进
    const 跟过 = await 分来(甲, 京("2026-11-10 10:00"));
    await 记(跟过.customerId, 甲.id, "电话里报了价，客户说月底定", 京("2026-11-12 15:41"));
    // 销售自建（个人自持，用户 11-20「包括」）：进
    const 自持 = await 建线索(甲, { createdAt: 京("2026-11-01 00:00"), creatorId: 甲.id });
    // 市场成员自留：不进
    const 市 = await 造人("mkt-his", "市场");
    await prisma.entMember.create({ data: { userId: 市.id, bizRole: "channel_ops", line: "内贸" } });
    忘掉企业版范围();
    const 市场自留 = await 建线索(市, { createdAt: 京("2026-11-01 00:00"), creatorId: 市.id });
    // 没设历史起算：老线索都不动
    for (const t of ["2026-12-01 08:00", "2026-12-01 08:30"]) expect(await 超时转扫一遍(京(t))).toMatchObject({ 提醒: 0, 转出: 0 });
    // 设了、还没到点：不动
    await 设历史(京("2026-12-01 00:00"));
    expect(await 超时转扫一遍(京("2026-11-30 20:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    for (const x of [老分, 导入, 早过, 跟过, 自持, 市场自留]) expect(await 链(x.id)).toBeNull();
    // 00:00 起计时；夜里不执行，08:00 第一遍：跟过的停、四条提醒；08:30 转
    expect(await 超时转扫一遍(京("2026-12-01 01:00"))).toEqual({ 提醒: 0, 转出: 0, 没转成: 0, 停: 0 });
    expect(await 超时转扫一遍(京("2026-12-01 08:00"))).toMatchObject({ 提醒: 4, 转出: 0, 停: 1 });
    for (const x of [老分, 导入, 早过, 自持]) expect(await 链(x.id)).toMatchObject({ anchorAt: 京("2026-12-01 00:00"), overdueAt: 京("2026-12-01 08:00"), stoppedAt: null });
    expect((await 超时通知(乙.id))[0].body).toContain("起按规则计时");
    expect(await 我超时未跟进的(丙.id)).toMatchObject([{ id: 早过.id, 按分配: true }]);
    expect(await 超时转扫一遍(京("2026-12-01 08:30"))).toMatchObject({ 转出: 4 });
    expect((await 项目(老分.id)).ownerId).not.toBe(甲.id);
    expect((await 项目(导入.id)).ownerId).not.toBe(乙.id);
    expect((await 项目(早过.id)).ownerId).not.toBe(丙.id);
    expect((await 项目(自持.id)).ownerId).not.toBe(甲.id);
    expect((await 项目(跟过.id)).ownerId).toBe(甲.id);
    expect((await 项目(市场自留.id)).ownerId).toBe(市.id);
    expect(await 链(市场自留.id)).toBeNull();
    // 接手的照常计时：08:30 接手，09:30 提醒
    expect(await 超时转扫一遍(京("2026-12-01 09:30"))).toMatchObject({ 提醒: 4 });
  });

  it("[11-20 只认负责人本人] 历史数据起算：历史起算以后别人（市场、管理、同事）在这条线索上记的沟通不停链，照常提醒、转；负责人本人记了才停", async () => {
    await 设生效(京("2026-11-21 09:30"));
    await setSetting(历史起算key, 京("2026-12-01 00:00").toISOString());
    invalidateSettingsCache();
    const 别人记 = await 建线索(甲, { createdAt: 京("2026-10-01 00:00") });
    await 记(别人记.customerId, 老板.id, "管理回访：客户还在比价", 京("2026-12-01 07:00"), 别人记.id);
    await 记(别人记.customerId, 丙.id, "帮甲接了电话，客户要报价单", 京("2026-12-01 07:10"), 别人记.id);
    const 本人记 = await 建线索(甲, { createdAt: 京("2026-10-01 00:00") });
    await 记(本人记.customerId, 甲.id, "电话联系上了，客户要报价", 京("2026-12-01 07:20"), 本人记.id);
    expect(await 超时转扫一遍(京("2026-12-01 08:00"))).toMatchObject({ 提醒: 1, 停: 1 });
    expect(await 链(别人记.id)).toMatchObject({ overdueAt: 京("2026-12-01 08:00"), stoppedAt: null });
    expect((await 链(本人记.id))?.stoppedAt).toEqual(京("2026-12-01 08:00"));
    expect(await 我超时未跟进的(甲.id)).toMatchObject([{ id: 别人记.id, 按分配: true }]);
    expect(await 超时转扫一遍(京("2026-12-01 08:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(别人记.id)).ownerId).not.toBe(甲.id);
    expect((await 项目(本人记.id)).ownerId).toBe(甲.id);
  });

  it("[32G] 只管首次沟通：接手后记了第一条有效沟通，链停下，之后再久不记也不提醒、不转", async () => {
    const r = await 分来(甲, 京("2026-11-20 10:00"));
    await 记(r.customerId, 甲.id, "电话联系上了，客户要报价", 京("2026-11-20 10:20"), r.id);
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 停: 1, 提醒: 0 });
    for (const t of ["2026-11-21 11:00", "2026-11-25 11:00"]) expect(await 超时转扫一遍(京(t))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 项目(r.id)).ownerId).toBe(甲.id);
  });

  it("[32G 两步走第二步] 历史基准：不早于生效时刻、比历史起算晚建的按建的那一刻", () => {
    expect(历史基准(京("2026-12-01 09:30"), 京("2026-11-21 09:30"), 京("2026-10-01 00:00"))).toEqual(京("2026-12-01 09:30"));
    expect(历史基准(京("2026-12-01 09:30"), 京("2026-12-05 09:30"), 京("2026-10-01 00:00"))).toEqual(京("2026-12-05 09:30"));
    expect(历史基准(京("2026-12-01 09:30"), 京("2026-11-21 09:30"), 京("2026-12-03 14:00"))).toEqual(京("2026-12-03 14:00"));
  });
});

describe("[32G] 超时自动转按线索的流转线流转：有流转线按它（不看现负责人）、没有按当时负责人所在事业部兜底，不看项目 / 客户业务线、区域、电话", () => {
  let 丁: 人, 戊: 人, 市场: 人, 己: 人;
  beforeEach(async () => {
    丁 = await 造人("ding", "丁");
    戊 = await 造人("wu", "戊");
    市场 = await 造人("mkt", "市场");
    己 = await 造人("ji", "己");
    await prisma.entMember.createMany({
      data: [
        { userId: 丁.id, bizRole: "sales", line: "外贸" },
        { userId: 戊.id, bizRole: "sales", line: "外贸" },
        { userId: 市场.id, bizRole: "channel_ops" },
        // 己：销售，没有事业部（没设业务线、没部门）
        { userId: 己.id, bizRole: "sales" },
      ],
    });
    // 没部门的组织按成员业务线挑候选，没标线的成员（己）两条线都算（现有自动分配候选口径，不归这里管）：禁止掉，只看事业部这一条
    await setSetting(自动分配不参与key, { [老板.id]: "禁止", [己.id]: "禁止" });
    invalidateSettingsCache();
    忘掉企业版范围();
  });
  /** 一位客户（地址、电话、客户业务线可给）+ 一条线索：owner 负责、creator 建，项目业务线 bizLine，指定回复时间 15:00 */
  async function 线索(owner: 人, creator: 人, bizLine: string, 客户: { addrCountry?: string; phone?: string | null; bizLine?: string } = {}, flowLine: string | null = null) {
    序++;
    const c = await prisma.customer.create({ data: { name: `事业部客户${序}`, phone: 客户.phone === undefined ? `1390001${String(序).padStart(4, "0")}` : (客户.phone ?? ""), addrCountry: 客户.addrCountry ?? null, salesOwnerId: owner.id, bizLine: 客户.bizLine ?? bizLine } });
    const p = await prisma.project.create({ data: { name: `事业部线索${序}`, customerId: c.id, ownerId: owner.id, creatorId: creator.id, phase: "线索", node: "潜客培育", bizLine, flowLine, replyEndAt: 京("2026-11-20 15:00") } });
    // 新建时直接指定给 owner（direct-assign.ts 记一条分配记录，B1：按时的也要分配基准）
    await prisma.entLeadAssign.create({ data: { projectId: p.id, toUserId: owner.id, fromUserId: creator.id, byUserId: creator.id, month: "2026-11", counted: false, createdAt: 京("2026-11-20 09:00") } });
    return p.id;
  }
  const 内贸的 = () => [乙.id, 丙.id];

  it("流转线外贸、现负责人是内贸的甲（管理跨线指定过又被人转回来）：在外贸里转给丁 / 戊，流转线不变；再超时还在外贸里转", async () => {
    const id = await 线索(甲, 老板, "内贸", { bizLine: "内贸" }, "外贸");
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    const 第一位 = (await 项目(id)).ownerId;
    expect([丁.id, 戊.id]).toContain(第一位);
    expect((await 项目(id)).flowLine).toBe("外贸");
    for (const u of [乙, 丙]) expect(await 通知(u.id)).toHaveLength(0);
    await 超时转扫一遍(京("2026-11-20 17:30"));
    expect(await 超时转扫一遍(京("2026-11-20 18:00"))).toMatchObject({ 转出: 1 });
    expect([丁.id, 戊.id]).toContain((await 项目(id)).ownerId);
    expect((await 项目(id)).ownerId).not.toBe(第一位);
  });

  it("流转线内贸、现负责人是外贸的丁：在内贸里转", async () => {
    const id = await 线索(丁, 老板, "外贸", { bizLine: "外贸" }, "内贸");
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect([甲.id, 乙.id, 丙.id]).toContain((await 项目(id)).ownerId);
    expect(await 通知(戊.id)).toHaveLength(0);
  });

  it("负责人没有事业部（己），但线索有流转线内贸：照流转线在内贸里转", async () => {
    const id = await 线索(己, 老板, "内贸", {}, "内贸");
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect([甲.id, 乙.id, 丙.id]).toContain((await 项目(id)).ownerId);
  });

  it("兜底：没有流转线、内贸的甲手上、项目记外贸、客户记外贸（管理跨线分的）：按甲的事业部在内贸里转，外贸的丁、戊收不到", async () => {
    const id = await 线索(甲, 老板, "外贸", { bizLine: "外贸" });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect(内贸的()).toContain((await 项目(id)).ownerId);
    for (const u of [丁, 戊, 己]) expect(await 通知(u.id)).toHaveLength(0);
  });

  it("兜底：没有流转线、外贸的丁手上、项目记内贸、客户记内贸（误转里那种）：在外贸里转给戊，内贸的人收不到", async () => {
    const id = await 线索(丁, 老板, "内贸", { bizLine: "内贸" });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(id)).ownerId).toBe(戊.id);
    for (const u of [甲, 乙, 丙, 己]) expect(await 通知(u.id)).toHaveLength(0);
  });

  it("市场建的也不看客户区域 / 电话：区域在国外、负责人内贸的甲 → 转内贸；区域记中国、负责人外贸的丁 → 转戊；区域电话都判不出、负责人丁 → 转戊", async () => {
    const 国外 = await 线索(甲, 市场, "外贸", { addrCountry: "越南" });
    const 国内 = await 线索(丁, 市场, "内贸", { addrCountry: "中国" });
    const 判不出 = await 线索(丁, 市场, "内贸", { phone: null });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 3 });
    expect(内贸的()).toContain((await 项目(国外)).ownerId);
    expect((await 项目(国内)).ownerId).toBe(戊.id);
    expect((await 项目(判不出)).ownerId).toBe(戊.id);
  });

  it("没有流转线、负责人也没有事业部（己）：判不出线，不转、留在己手上，只记日志，不发收回通知", async () => {
    const id = await 线索(己, 老板, "内贸");
    await 超时转扫一遍(京("2026-11-20 16:00"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0, 没转成: 1 });
    expect(warn.mock.calls.flat().join("")).toContain("没有所在事业部");
    warn.mockRestore();
    expect((await 项目(id)).ownerId).toBe(己.id);
    expect((await 超时通知(己.id)).filter((n) => n.title.includes(收回话))).toHaveLength(0);
    for (const u of [甲, 乙, 丙, 丁, 戊]) expect(await 通知(u.id)).toHaveLength(0);
  });

  it("内贸里没人能接（乙、丙禁止自动分配）：甲手上项目记外贸的也不跨到外贸，留在甲手上", async () => {
    await setSetting(自动分配不参与key, { [老板.id]: "禁止", [己.id]: "禁止", [乙.id]: "禁止", [丙.id]: "禁止" });
    invalidateSettingsCache();
    const id = await 线索(甲, 老板, "外贸", { bizLine: "外贸" });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 转出: 0, 没转成: 1 });
    expect(warn.mock.calls.flat().join("")).toContain("内贸");
    warn.mockRestore();
    expect((await 项目(id)).ownerId).toBe(甲.id);
    for (const u of [乙, 丙, 丁, 戊]) expect(await 通知(u.id)).toHaveLength(0);
  });
});

describe("11-20 审查修正（B1 按时也只计新分配、B2 导入不算自建、S3 系统分配记录 / 坏生效值、S4 自建只对销售、有效沟通统一、文案）", () => {
  const 设生效 = async (t: Date) => { await setSetting(超时转生效key, t.toISOString()); invalidateSettingsCache(); };
  const 链 = (projectId: string) => prisma.entReplyOverdue.findUnique({ where: { projectId } });
  /** 记一条沟通：挂项目（projectId）或只挂客户；type、标题可改 */
  async function 记(customerId: string, ownerId: string, content: string, at: Date, projectId?: string, o: { type?: string; title?: string } = {}) {
    const f = await prisma.followUp.create({ data: { type: o.type ?? "PHONE", content, occurredAt: at, createdAt: at, title: o.title ?? "", status: "已完成", customerId, ownerId } });
    if (projectId) await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: "潜客培育" } });
  }

  it("[B1] 按时也只计生效以后被分配 / 销售自建的：老分配 + 生效以后的指定回复时间 = 不计时；生效以后分的、销售生效以后自建的 + 指定回复时间 = 照常", async () => {
    await 设生效(京("2026-11-21 09:30"));
    const 老分 = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") }, undefined, { 分于: 京("2026-11-20 20:00") });
    const 新分 = await 建线索(乙, { replyEndAt: 京("2026-11-21 10:00") }, undefined, { 分于: 京("2026-11-21 09:40") });
    const 自建 = await 建线索(丙, { replyEndAt: 京("2026-11-21 10:00"), createdAt: 京("2026-11-21 09:35"), creatorId: 丙.id });
    // 没有分配记录也没有换人留痕（导入改负责人、老数据）：分配基准算不出，不计时
    const 不知 = await 建线索(甲, { replyEndAt: 京("2026-11-21 10:00") }, undefined, { 不分配: true });
    expect(await 超时转扫一遍(京("2026-11-21 11:00"))).toMatchObject({ 提醒: 2, 转出: 0 });
    for (const x of [老分, 不知]) expect(await 链(x.id)).toBeNull();
    for (const x of [新分, 自建]) expect(await 链(x.id)).toMatchObject({ anchorAt: 京("2026-11-21 10:00"), overdueAt: 京("2026-11-21 11:00") });
    expect(await 超时通知(甲.id)).toHaveLength(0);
    expect(await 我超时未跟进的(甲.id)).toEqual([]);
  });

  it("[B1] 按时也认之前的跟进：负责人本人以前在这位客户上记过有效沟通（没挂项目、挂同客户别的项目）= 不是首次沟通，新分的 + 指定回复时间也不计时；别人记的不算", async () => {
    const 没挂 = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    await 记(没挂.customerId, 甲.id, "电话里报了价，客户说月底定", 京("2026-11-10 10:00"));
    const 别的项目 = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    const 旧 = await 建线索(甲, { createdAt: 京("2026-10-01 00:00"), result: "线索流失" }, 别的项目.customerId);
    await 记(别的项目.customerId, 甲.id, "上次这位客户订过一批样品，回访过", 京("2026-10-02 10:00"), 旧.id);
    const 别人 = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    await 记(别人.customerId, 丙.id, "前任跟过：客户要了报价单", 京("2026-11-10 10:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1, 停: 2 });
    for (const x of [没挂, 别的项目]) expect((await 链(x.id))?.stoppedAt).toEqual(京("2026-11-20 16:00"));
    expect(await 链(别人.id)).toMatchObject({ overdueAt: 京("2026-11-20 16:00"), stoppedAt: null });
  });

  it("[B1] 因首次沟通停了的按分配链：填上指定回复时间（整行重来）也不重开——负责人本人记过就永久停", async () => {
    const t = 京("2026-11-20 10:00");
    const r = await 建线索(甲, { createdAt: t }, undefined, { 分于: t });
    await 记(r.customerId, 甲.id, "电话联系上了，客户要报价", 京("2026-11-20 10:20"), r.id);
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 停: 1, 提醒: 0 });
    await prisma.project.update({ where: { id: r.id }, data: { replyEndAt: 京("2026-11-20 15:00") } });
    for (const x of ["2026-11-20 16:00", "2026-11-20 16:30", "2026-11-20 18:00"]) expect(await 超时转扫一遍(京(x))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect((await 项目(r.id)).ownerId).toBe(甲.id);
    expect(await prisma.entReplyOverdue.count({ where: { projectId: r.id, stoppedAt: null } })).toBe(0);
    expect(await 超时通知(甲.id)).toHaveLength(0);
  });

  it("[B2] 真实导入（线索表、客户 + 商机表，项目模式）建的线索：创建人记成负责人（销售甲），不算销售自建、不从建档起算；同一刻甲自己新建的照常计时", async () => {
    const t = 京("2026-11-20 10:00");
    const 表 = (名: string, 实: 实体, 表头: string[], 行: string[][]): 读出的表 => ({ 名, 实体: 实, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] });
    const { 批次Id } = await 试跑({
      来源: "excel", 用户Id: 老板.id, 建议器: null,
      表: [
        表("线索.xlsx", "lead", ["线索ID", "线索名称", "联系人", "电话", "负责人"], [["L1", "导入小厂", "陈总", "13600000001", "甲"]]),
        表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人"], [["C1", "导入客户", "13800000097", "甲"]]),
        表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段", "商机负责人"], [["O1", "C1", "导入商机", "潜客培育", "甲"]]),
      ],
    });
    await 定这批业务线(批次Id, "内贸");
    expect((await 写一批(批次Id, { id: 老板.id, name: 老板.name })).完了).toBe(true);
    const 导入的 = await prisma.project.findMany({ where: { name: { in: ["导入小厂", "导入商机"] } }, select: { id: true, ownerId: true, creatorId: true, phase: true } });
    expect(导入的).toHaveLength(2);
    for (const p of 导入的) expect(p).toMatchObject({ ownerId: 甲.id, creatorId: 甲.id, phase: "线索" });
    // 建档时刻用库的默认值（真实时钟），拨到 t 当作 10:00 导入（只改时刻，别的照导入写的）
    await prisma.project.updateMany({ where: { id: { in: 导入的.map((p) => p.id) } }, data: { createdAt: t } });
    const 自建 = await 建线索(甲, { createdAt: t, creatorId: 甲.id });
    expect((await 盘点超时链(京("2026-11-20 11:00"))).map((x) => x.id)).toEqual([自建.id]);
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 提醒: 1 });
    for (const p of 导入的) expect(await 链(p.id)).toBeNull();
  });

  it("[S3] 销售自建的链转出后：下一分钟链行还在、轮转次数和超时过的人保留，基准不挪；接手人再超时转给下一位，不转回原建档人", async () => {
    const t = 京("2026-11-20 10:00");
    const r = await 建线索(甲, { createdAt: t, creatorId: 甲.id });
    expect(await 超时转扫一遍(京("2026-11-20 11:00"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(r.id)).ownerId).toBe(乙.id);
    // 超时转出写了一条分配记录（操作人 系统）：不能当成「最早一次分配」把整行删了重来
    expect(await prisma.entLeadAssign.count({ where: { projectId: r.id, byUserId: "system" } })).toBe(1);
    expect(await 超时转扫一遍(京("2026-11-20 11:31"))).toMatchObject({ 提醒: 0, 转出: 0, 停: 0 });
    expect(await 链(r.id)).toMatchObject({ anchorAt: t, holderId: 乙.id, since: 京("2026-11-20 11:30"), transfers: 1, tried: JSON.stringify([甲.id]), stoppedAt: null });
    expect(await 超时转扫一遍(京("2026-11-20 12:30"))).toMatchObject({ 提醒: 1 });
    expect(await 超时转扫一遍(京("2026-11-20 13:00"))).toMatchObject({ 转出: 1 });
    expect((await 项目(r.id)).ownerId).toBe(丙.id);
    expect(await 链(r.id)).toMatchObject({ anchorAt: t, transfers: 2, tried: JSON.stringify([甲.id, 乙.id]) });
  });

  it("[S3] 分配基准（纯函数）：超时自动转写的分配记录（操作人 系统）不算分配", () => {
    const p = { ownerId: "b", creatorId: "a", createdAt: 京("2026-11-20 09:00") };
    expect(分配基准(p, [], [{ toUserId: "b", byUserId: "system", createdAt: 京("2026-11-20 11:30") }], [], true)).toBeNull();
    expect(分配基准(p, [], [{ toUserId: "b", byUserId: "system", createdAt: 京("2026-11-20 11:30") }, { toUserId: "b", byUserId: "boss", createdAt: 京("2026-11-20 12:00") }])).toEqual(京("2026-11-20 12:00"));
    // [B2] 导入的：自建那一支不起算
    expect(分配基准({ ownerId: "b", creatorId: "b", createdAt: 京("2026-11-20 09:00") }, [], [], [], true, true)).toBeNull();
  });

  it("[S4] 自建、自领只对业务角色是销售的负责人计时：总管理、系统管理员、销售管理自建自留（填没填指定回复时间）都不计时；兼着销售的照算；别人分给销售管理的照常按分配算", async () => {
    const 销管 = await 造人("smgr", "销管");
    const 管理员 = await 造人("adm", "管理员");
    const 兼 = await 造人("both", "兼销售");
    await prisma.entMember.createMany({
      data: [
        { userId: 销管.id, bizRole: "sales_mgr", line: "内贸" },
        { userId: 管理员.id, bizRole: "admin" },
        { userId: 兼.id, bizRole: "sales_mgr,sales", line: "内贸" },
      ],
    });
    忘掉企业版范围();
    const t = 京("2026-11-20 10:00");
    const 自留们 = [];
    for (const u of [老板, 销管, 管理员]) {
      自留们.push(await 建线索(u, { createdAt: t, creatorId: u.id }));
      自留们.push(await 建线索(u, { createdAt: t, creatorId: u.id, replyEndAt: 京("2026-11-20 10:30") }));
    }
    // 管理员自己去公海领（pool-claim、操作人 = 接手人）：不计时
    const 领 = await 建线索(管理员, { createdAt: 京("2026-11-10 10:00") }, undefined, { 不分配: true });
    await prisma.projectNodeLog.create({ data: { projectId: 领.id, userId: 管理员.id, kind: "pool-claim", fromOwnerId: 乙.id, toOwnerId: 管理员.id, reason: "原负责人没做完的待办带过来 0 条", at: t, fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "潜客培育" } });
    const 兼的 = await 建线索(兼, { createdAt: t, creatorId: 兼.id });
    const 分给销管 = await 建线索(销管, { createdAt: t }, undefined, { 分于: t });
    expect(await 超时转扫一遍(京("2026-11-20 11:30"))).toMatchObject({ 提醒: 2 });
    for (const x of [...自留们, 领]) expect(await 链(x.id)).toBeNull();
    for (const x of [兼的, 分给销管]) expect(await 链(x.id)).toMatchObject({ anchorAt: t, overdueAt: 京("2026-11-20 11:30") });
    for (const u of [老板, 管理员]) expect(await 超时通知(u.id)).toHaveLength(0);
  });

  it("[有效沟通统一] 按时、按分配、之前跟过三处同一套：负责人本人记的跟进任务 / 跟进提醒（TASK / REMIND）、同号标题的留痕都不算；30 分钟前那条提醒自己的已回复判定（不传只认负责人）不变", async () => {
    const 按时任务 = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    await 记(按时任务.customerId, 甲.id, "明天给客户打电话问报价", 京("2026-11-20 15:10"), 按时任务.id, { type: "TASK" });
    const 按时提醒 = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    await 记(按时提醒.customerId, 甲.id, "下午三点提醒自己回电话", 京("2026-11-20 15:10"), 按时提醒.id, { type: "REMIND" });
    const 按时同号 = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    await 记(按时同号.customerId, 甲.id, "客户又打电话来催，问什么时候回电", 京("2026-11-20 15:10"), 按时同号.id, { title: "同号再次录入（手工建档）" });
    const 按分配任务 = await 建线索(甲, { createdAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 15:00") });
    await 记(按分配任务.customerId, 甲.id, "明天给客户打电话问报价", 京("2026-11-20 15:10"), 按分配任务.id, { type: "TASK" });
    const 按分配同号 = await 建线索(甲, { createdAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 15:00") });
    await 记(按分配同号.customerId, 甲.id, "客户又打电话来催，问什么时候回电", 京("2026-11-20 15:10"), 按分配同号.id, { title: "同号再次录入（手工建档）" });
    // 本人记了正经沟通：停
    const 正经 = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    await 记(正经.customerId, 甲.id, "电话联系上了，客户要报价单", 京("2026-11-20 15:10"), 正经.id);
    // reply-notice.ts 自己的已回复判定（不传）照旧：有内容就算
    expect(await 已回复的([{ id: 按时任务.id, replyStartAt: null, replyEndAt: 京("2026-11-20 15:00") }])).toEqual(new Set([按时任务.id]));
    expect(await 已回复的([{ id: 按时任务.id, ownerId: 甲.id, replyStartAt: null, replyEndAt: 京("2026-11-20 15:00") }], true)).toEqual(new Set());
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 5, 停: 1 });
    for (const x of [按时任务, 按时提醒, 按时同号, 按分配任务, 按分配同号]) expect(await 链(x.id)).toMatchObject({ overdueAt: 京("2026-11-20 16:00"), stoppedAt: null });
    expect((await 链(正经.id))?.stoppedAt).toEqual(京("2026-11-20 16:00"));
  });

  it("[文案] 超时提醒正文写明「需负责人本人记录有效沟通」（站内 + 飞书同一条正文）", async () => {
    expect(本人记话).toBe("需负责人本人记录有效沟通");
    const { id } = await 建线索(甲, { replyEndAt: 京("2026-11-20 15:00") }, undefined, { 分于: 京("2026-11-20 09:00") });
    await 超时转扫一遍(京("2026-11-20 16:00"));
    const 提 = await 超时通知(甲.id);
    expect(提).toHaveLength(1);
    expect(提[0].link).toBe(`/projects/${id}`);
    expect(提[0].body).toContain(`${本人记话}，`);
    expect(提[0].body).toContain("16:30 前还没记");
  });

  it("[性能 11-20 复审] 每分钟认「导入建的」：EntImportRow 有 (entity, targetId) 索引（迁移 159），那句查询走索引、不扫整表", async () => {
    const 有 = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'EntImportRow_entity_targetId_idx'`);
    expect(有).toHaveLength(1);
    const 计划 = await prisma.$queryRawUnsafe<{ detail: string }[]>(
      `EXPLAIN QUERY PLAN SELECT "targetId" FROM "EntImportRow" WHERE "entity" = ? AND "kind" = ? AND "targetId" IN (?, ?)`, "opportunity", "create", "a", "b");
    expect(计划.map((r) => r.detail).join("\n")).toContain("EntImportRow_entity_targetId_idx");
  });

  it("[漏计 11-20 复审] 生效后新分配、带着生效前的旧指定回复时间：改按分配算（分配后 1 小时提醒、1.5 小时转）；老分配 + 老回复时间照旧不计时", async () => {
    await 设生效(京("2026-11-21 09:30"));
    const 老 = { replyEndAt: 京("2026-11-20 15:00"), createdAt: 京("2026-11-10 10:00") };
    const 新分 = await 建线索(甲, 老, undefined, { 分于: 京("2026-11-10 10:00") });
    const 照旧 = await 建线索(甲, 老, undefined, { 分于: 京("2026-11-10 10:00") });
    // 生效后 11-21 10:00 由系统自动分配给乙（换人留痕 + 分配记录）
    const 分于 = 京("2026-11-21 10:00");
    await prisma.project.update({ where: { id: 新分.id }, data: { ownerId: 乙.id } });
    await prisma.projectNodeLog.create({ data: { projectId: 新分.id, userId: 老板.id, kind: "transfer", fromOwnerId: 甲.id, toOwnerId: 乙.id, reason: "分配方式：自动分配", at: 分于, fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "潜客培育" } });
    await prisma.entLeadAssign.create({ data: { projectId: 新分.id, toUserId: 乙.id, fromUserId: 甲.id, byUserId: 老板.id, month: "2026-11", counted: false, createdAt: 分于 } });

    expect(await 超时转扫一遍(京("2026-11-21 10:59"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-21 11:00"))).toMatchObject({ 提醒: 1, 转出: 0 });
    expect(await 链(新分.id)).toMatchObject({ anchorAt: 分于, overdueAt: 京("2026-11-21 11:00") });
    const 提 = await 超时通知(乙.id);
    expect(提).toHaveLength(1);
    expect(提[0].body).toContain(分配后未跟进话(60));
    expect(await 超时转扫一遍(京("2026-11-21 11:30"))).toMatchObject({ 转出: 1 });
    expect((await 项目(新分.id)).ownerId).not.toBe(乙.id);
    // 老分配 + 老回复时间：上线安全照旧，从头到尾不起链
    expect(await 链(照旧.id)).toBeNull();
    expect((await 项目(照旧.id)).ownerId).toBe(甲.id);
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
