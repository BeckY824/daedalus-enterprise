/**
 * 客户三态 · 建项目带出的首条沟通补录早日期也回满额度（M-公海-54「建项目 + 首条沟通合计 1 次」，2026-11-23 修）。
 *
 * 原来：额度沟通日of 把同一个事务里早几毫秒写下的「建项目」（和首个节点那行）也算成挡它的动静——建项目那天 ≥ 沟通日期，
 * 所以新建项目 / 建档向导 / 线索转项目 / 号码查重新建线索项目带出的首条沟通，日期填昨天或更早时额度不回满（当天的不受影响）。
 * 现在：挂项目时标上 FollowUpProject.withProjectCreate（建项目同一次操作带出的首条沟通），算挡它的动静时跳过这条沟通所挂项目
 * 在它写下之前的动静（那个项目写这条沟通之前还不存在，所以只可能是同一次操作写的）；别的项目、换负责人照样挡。不用时间余量近似。
 * 钉的是：
 *   - 补录（昨天、上周）：每个能测的入口（客户页新建项目、建档向导、只建客户、线索转项目、号码查重新建线索项目）都回满，重置日 = 沟通日期那天
 *   - 没标的照旧挡：项目先建好、过几天在项目里补录的首条沟通；先存占位、后改有效的；别的项目当天换节点、换负责人
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "乙", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { 收三态客户 } from "@/lib/enterprise/tri-state-db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 读组织 } from "@/lib/enterprise/org";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 额度沟通日of } from "@/lib/enterprise/tri-state-quota";
import { 读一位三态 } from "@/lib/enterprise/tri-state-hold";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { beijingDay } from "@/lib/business-clock";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { 建档向导, 建档只建客户 } from "@/app/(app)/projects/actions";
import { 线索建项目 } from "@/lib/project/from-lead";
import { 规整沟通 } from "@/lib/project/wizard";
import { 查重领取建线索项目, 查重领取记沟通 } from "@/lib/enterprise/dedupe-claim";

/** 动作用真实的现在：系统起算日设成 200 天前，今天 = 第 200 天 */
const 今天 = beijingDay(new Date());
const 前 = (n: number) => 加天(今天, -n);
const 那天 = (n: number) => new Date(`${前(n)}T00:00:00+08:00`);
const 起算 = 前(200);
const 第 = (n: number, 时 = "10:00") => new Date(`${加天(起算, n)}T${时}:00+08:00`);

let 乙: string, 客户: string, 渠道: string;
const 开三态 = () => setSetting("orgRules", { ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 开: false, 起算日: 起算 }, 三态: { ...默认三态规则, 开: true } });
/** 第 n 天用过一次继续持有、第 n+1 天裁决过一次暂缓回收：回满了这两样都清零 */
const 用过额度 = async (cid: string, n: number) => {
  await prisma.entCustomerStateLog.create({ data: { customerId: cid, fromState: "沉睡", toState: "沉睡", via: "本人", userId: 乙, reason: "我还在跟", holdDays: 30, at: 第(n) } });
  await prisma.entCustomerStateLog.create({ data: { customerId: cid, fromState: "待回收", toState: "待回收", via: "总管理裁决", userId: 乙, reason: "暂缓回收", at: 第(n + 1) } });
};
const 看 = async (cid = 客户) => {
  const c = (await 收三态客户(prisma, [cid], await 生效组织规则(), await 读组织(), new Date())).get(cid)!;
  const 读 = (await 读一位三态(cid))!;
  return { 额度用了: 读.继续持有.已用次数, 暂缓: c.事实.暂缓回收次数, 重置日: c.事实.额度重置日, 归零日: 读.归零日 };
};
const 跟进 = (几天前: number, content = "电话聊了预算和交付时间") => ({ type: "PHONE", content, occurredAt: `${前(几天前)} 10:00`, 节点: "潜客培育", 明确回复: false });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  乙 = (await prisma.user.create({ data: { email: "乙", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 乙, bizRole: "sales", line: "内贸" } });
  mocks.user = { ...mocks.user, id: 乙 };
  渠道 = (await prisma.channel.create({ data: { name: "小红", channelOwnerId: 乙 } })).id;
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙, createdAt: 那天(400) } })).id;
  await 开三态();
  invalidateSettingsCache();
  await 用过额度(客户, 150);
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
});
afterAll(async () => { await prisma.$disconnect(); });

describe("额度沟通日of：跳过这条沟通所挂项目在它写下之前的动静（纯函数）", () => {
  const 写 = 第(199, "10:00");
  const 建项目 = { 日: 加天(起算, 199), 时: 第(199, "09:59"), 项目: "P" };
  it("随建项目 = 那个项目：建项目、首个节点不挡；别的项目、换负责人照挡", () => {
    expect(额度沟通日of([{ 日: 加天(起算, 198), 写, 随建项目: "P" }], [建项目, { ...建项目 }], 起算)).toBe(加天(起算, 198));
    expect(额度沟通日of([{ 日: 加天(起算, 198), 写, 随建项目: "P" }], [建项目, { ...建项目, 项目: "Q" }], 起算)).toBeNull();
    expect(额度沟通日of([{ 日: 加天(起算, 198), 写, 随建项目: "P" }], [建项目, { 日: 加天(起算, 199), 时: 第(199, "09:00") }], 起算)).toBeNull();
  });
  it("没标随建项目（项目里补录、改成有效的）：同项目的建项目照旧挡", () => {
    expect(额度沟通日of([{ 日: 加天(起算, 198), 写 }], [建项目], 起算)).toBeNull();
    expect(额度沟通日of([{ 日: 加天(起算, 198), 写, 随建项目: null }], [建项目], 起算)).toBeNull();
  });
});

describe("建项目带出的首条沟通补录早日期：每个入口都回满额度（M-公海-54）", () => {
  for (const [叫法, 几天前] of [["昨天", 1], ["上周", 7]] as const) {
    it(`客户页新建项目，首条沟通日期填${叫法}：回满，重置日 = 那天`, async () => {
      const r = await 给客户建项目({ customerId: 客户, 项目: { name: "新项目", amount: 0, currency: "CNY", ownerId: 乙, 分配方式: 4, 业务线: "内贸" }, 跟进: 跟进(几天前) });
      expect(r).toMatchObject({ ok: true });
      expect(await prisma.followUpProject.findFirstOrThrow({ where: { followUp: { customerId: 客户 } } })).toMatchObject({ withProjectCreate: true });
      // 钟照常被建项目推到今天；额度回满到沟通日期那天
      expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 前(几天前), 归零日: 今天 });
    });

    it(`建档向导，首条沟通日期填${叫法}：新客户回满，重置日 = 那天`, async () => {
      const r = await 建档向导({
        客户: { name: `向导客户${几天前}`, phone: `1391111000${几天前}`, school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, salesOwnerId: 乙, channelId: 渠道, referrerCustomerId: null },
        联系人: { name: "王经理", position: "采购", phone: "" },
        项目: { name: "向导项目", amount: 0, currency: "CNY", ownerId: 乙, 分配方式: 4, 业务线: "内贸" },
        跟进: 跟进(几天前),
      });
      expect(r).toMatchObject({ ok: true });
      const p = await prisma.project.findFirstOrThrow({ where: { name: "向导项目" } });
      expect(await 看(p.customerId)).toMatchObject({ 额度用了: 0, 重置日: 前(几天前), 归零日: 今天 });
    });

    it(`只建客户（企业版带潜客培育），首条沟通日期填${叫法}：回满（沟通先写、项目后建，本来就不挡；标上一致）`, async () => {
      const r = await 建档只建客户({
        客户: { name: `只建客户${几天前}`, phone: `1392222000${几天前}`, school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, salesOwnerId: 乙, channelId: 渠道, referrerCustomerId: null, 企业资料: { bizLine: "内贸" } },
        联系人: { name: "李经理", position: "采购", phone: "" },
        跟进: 跟进(几天前),
      } as never);
      expect(r.ok, r.ok ? "" : "error" in r ? String(r.error) : "").toBe(true);
      const c = await prisma.customer.findFirstOrThrow({ where: { name: `只建客户${几天前}` } });
      expect(await prisma.followUpProject.findFirstOrThrow({ where: { followUp: { customerId: c.id } } })).toMatchObject({ withProjectCreate: true });
      expect(await 看(c.id)).toMatchObject({ 额度用了: 0, 重置日: 前(几天前) });
    });

    it(`线索转项目（线索建项目带首条跟进），日期填${叫法}：回满`, async () => {
      const lead = await prisma.lead.create({ data: { name: "线索甲", ownerId: 乙 } });
      const 好 = 规整沟通({ ...跟进(几天前), 下一步时间: null }, { 要下一步: false, 叫法: "首条" });
      if ("error" in 好) throw new Error(好.error);
      await prisma.$transaction((tx) => 线索建项目(tx, { 线索名: "线索甲", leadId: lead.id, customerId: 客户, ownerId: 乙, creatorId: 乙, 跟进: 好, 分配方式: null }));
      expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 前(几天前), 归零日: 今天 });
    });

    it(`号码查重 / 出口 C 的新建线索项目（同一事务建项目再记沟通，建项目带出 = true），日期填${叫法}：回满；false（挂原有项目）照旧挡`, async () => {
      const 好 = 规整沟通({ ...跟进(几天前), 下一步时间: null }, { 要下一步: false, 叫法: "这条" });
      if ("error" in 好) throw new Error(好.error);
      // 两种各用一位客户（同一位客户上先建的那条项目是「别的项目」，会挡后一条）
      const 建 = (cid: string, 带出: boolean) => prisma.$transaction(async (tx) => {
        const id = await 查重领取建线索项目(tx, { customerId: cid, 客户名: "客户", 接手人: 乙, 创建人: 乙, 渠道, 对接人: null, 线: "内贸", 分配方式: "自动分配" });
        await 查重领取记沟通(tx, 乙, id, 好, new Date(), 带出);
      });
      const 客户乙 = (await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 乙, createdAt: 那天(400) } })).id;
      await 用过额度(客户乙, 150);
      await 建(客户乙, false);
      expect(await 看(客户乙)).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
      await 建(客户, true);
      expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 前(几天前) });
    });
  }
});

describe("没标的照旧挡（原有行为不变）", () => {
  /** 第 写 天 写时 建项目（带首个节点那行），同一刻之后记一条沟通日期第 日 天的有效沟通挂上去 */
  const 建带沟通 = async (日: number, 写: number, 标: boolean, content = "电话聊了预算和交付时间") => {
    const p = await prisma.project.create({ data: { name: "新项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: 第(写, "09:00") } });
    await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 乙, toPhase: "线索", toNode: "潜客培育", at: 第(写, "09:00") } });
    const f = await prisma.followUp.create({ data: { customerId: 客户, ownerId: 乙, type: "PHONE", title: "", content, occurredAt: 第(日), createdAt: 第(写, "09:01") } });
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: p.id, node: "潜客培育", withProjectCreate: 标 } });
    return { p: p.id, f: f.id };
  };

  it("同样的数据只差标记：标了回满到沟通日期，没标（项目先建好、过后在项目里补录）照旧被建项目挡", async () => {
    const { f } = await 建带沟通(193, 199, false);
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
    await prisma.followUpProject.update({ where: { followUpId: f }, data: { withProjectCreate: true } });
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 193) });
  });

  it("项目第 190 天就建好、第 199 天才补录第 185 天的首条沟通（没标）：建项目挡住，不回满", async () => {
    const p = await prisma.project.create({ data: { name: "早建的项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: 第(190) } });
    const f = await prisma.followUp.create({ data: { customerId: 客户, ownerId: 乙, type: "PHONE", title: "", content: "电话聊了预算和交付时间", occurredAt: 第(185), createdAt: 第(199) } });
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: p.id, node: "潜客培育" } });
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
  });

  it("建项目时带的是占位文案、第 199 天才改成有效（首次有效时刻另记）：按改的那一刻算补录，建项目照样挡", async () => {
    const { f } = await 建带沟通(193, 195, true, "跟进");
    await prisma.followUp.update({ where: { id: f }, data: { content: "电话聊了预算和交付时间" } });
    await prisma.entFollowUpFirstValid.create({ data: { followUpId: f, at: 第(199) } });
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
  });

  it("标了，但别的项目在沟通日期之后换过节点、或这位客户换过（算数的）负责人：照样挡", async () => {
    const 别的 = await prisma.project.create({ data: { name: "别的项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: 第(10) } });
    await prisma.projectNodeLog.create({ data: { projectId: 别的.id, userId: 乙, toPhase: "线索", toNode: "初步接触", at: 第(195) } });
    await 建带沟通(193, 199, true);
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
  });

  it("标了、沟通日期就是今天：当天实时记的照旧重置（和改前一样）", async () => {
    await 建带沟通(200, 200, true);
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 今天 });
  });
});
