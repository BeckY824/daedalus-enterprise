/**
 * 客户三态 · 夜扫（三态落地计划 P4，lib/enterprise/tri-state-db.ts、lib/project/nightly.ts）。日子都是改出来的，不等真实时间。
 *   - 三态关着：这一段完全不跑，一行钟都不建；项目超时回收照旧
 *   - 三态开着：项目超时回收不再收项目
 *   - 活跃 → 沉睡（第 90 天当天）→ 待回收（第 180 天当天）→ 3 次提醒发过、第 210 天自动进客户公海，整条
 *   - 被同事在推的项目挡住：打被挡标记、不收；交接中的不收
 *   - 记一条有内容的沟通回活跃；空内容不拨钟
 *   - 一天扫两遍不重复写；停机几天开机一遍直接补到该有的状态
 *   - 市场成员名下不计时；成交成立日首次成立时写下
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫, 三态扫过键, 被挡理由, 换负责人们of } from "@/lib/enterprise/tri-state-db";
import { 夜里扫三态 } from "@/lib/project/nightly";
import { 公海超时收回 } from "@/lib/project/db";
import { 默认组织规则, 默认三态规则, type 组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 加天 } from "@/lib/enterprise/tri-state";

const 起 = "2026-11-01";
/** 起算日后第 n 天的北京 00:10 */
const 第 = (n: number) => new Date(`${加天(起, n)}T00:10:00+08:00`);
const 开三态 = (补: Partial<组织规则> = {}): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true }, ...补 });

let 乙: string, 丙: string, 客户: string;

const 钟 = () => prisma.entCustomerClock.findUnique({ where: { customerId: 客户 } });
const 痕 = () => prisma.entCustomerStateLog.findMany({ where: { customerId: 客户 }, orderBy: { at: "asc" }, select: { fromState: true, toState: true, via: true, reason: true } });
const 在公海 = async () => !!(await prisma.customerPool.findUnique({ where: { customerId: 客户 } }));
/** 模拟 P5 发完了待回收的 3 次提醒 */
const 发完三次 = (日: string) => prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日 } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  丙 = (await prisma.user.create({ data: { email: "bing", name: "丙", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 乙, bizRole: "sales" }, { userId: 丙, bizRole: "sales" }] });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", 开三态());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("开关", () => {
  it("三态关着：这一段完全不跑，夜扫回 null、一行钟和留痕都不建", async () => {
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: false } });
    expect(await 三态夜扫(第(100))).toBeNull();
    expect(await 夜里扫三态(第(100))).toBeNull();
    expect(await prisma.entCustomerClock.count()).toBe(0);
    expect(await prisma.entCustomerStateLog.count()).toBe(0);
  });

  it("不是企业版：也不跑（企业版业务配置锁死项目模式开着）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 三态夜扫(第(100))).toBeNull();
    expect(await 夜里扫三态(第(100))).toBeNull();
    expect(await prisma.entCustomerClock.count()).toBe(0);
  });

  it("00:04 还不跑，00:05 起跑", async () => {
    expect(await 夜里扫三态(new Date(`${加天(起, 100)}T00:04:00`))).toBeNull();
    expect(await 夜里扫三态(new Date(`${加天(起, 100)}T00:05:00`))).not.toBeNull();
  });

  it("三态开着：项目超时回收不再收项目；关了三态照旧收", async () => {
    const p = await prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: new Date("2026-11-02T10:00:00+08:00") } });
    const 超时 = { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } };
    await setSetting("orgRules", 开三态({ 超时回收: 超时 }));
    expect(await 公海超时收回({ id: "system", name: "系统" }, new Date("2026-11-20T10:00:00+08:00"))).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).pooledAt).toBeNull();
    await setSetting("orgRules", { ...默认组织规则, 超时回收: 超时 });
    expect(await 公海超时收回({ id: "system", name: "系统" }, new Date("2026-11-20T10:00:00+08:00"))).toBe(1);
  });
});

describe("整条", () => {
  it("第 89 天活跃、第 90 天当天沉睡、第 179 天沉睡、第 180 天当天待回收；提醒没发够第 210 天不收，发够了收", async () => {
    await 三态夜扫(第(0));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 起 });
    await 三态夜扫(第(89));
    expect((await 钟())!.state).toBe("活跃");
    await 三态夜扫(第(90));
    expect(await 钟()).toMatchObject({ state: "沉睡", enteredDay: 加天(起, 90), noticeCount: 0, lastNoticeDay: null });
    await 三态夜扫(第(179));
    expect((await 钟())!.state).toBe("沉睡");
    await 三态夜扫(第(180));
    expect(await 钟()).toMatchObject({ state: "待回收", enteredDay: 加天(起, 180) });
    // 3 次提醒没发（P5 没跑）：天数到了也停在待回收
    await 三态夜扫(第(210));
    expect(await 在公海()).toBe(false);
    await 发完三次(加天(起, 200));
    await 三态夜扫(第(211));
    expect(await 在公海()).toBe(true);
    const pool = await prisma.customerPool.findUniqueOrThrow({ where: { customerId: 客户 } });
    expect(pool.userId).toBeNull(); // 统一公海认成超时回收
    expect(pool.reason).toContain("自动进客户公海");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(await 无负责人占位Id(prisma));
    expect((await 痕()).map((x) => `${x.fromState ?? "-"}→${x.toState}`)).toEqual(["-→活跃", "活跃→沉睡", "沉睡→待回收", "待回收→公海"]);
    expect((await 痕()).every((x) => x.via === "自动")).toBe(true);
    // 进了公海就不计时，再扫不动钟
    await 三态夜扫(第(212));
    expect((await 痕()).length).toBe(4);
  });

  it("自动进公海带走负责人自己负责的线索项目，同手动放进公海", async () => {
    const p = await prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(第(180));
    await 发完三次(加天(起, 200));
    await 三态夜扫(第(210));
    expect(await 在公海()).toBe(true);
    const 项目 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(项目.pooledAt).not.toBeNull();
    expect(await prisma.projectNodeLog.count({ where: { projectId: p.id, kind: "pool-release", userId: "system" } })).toBe(1);
  });

  it("停机：从第 0 天直接到第 100 天，开机一遍就是沉睡，只记一行换状态", async () => {
    await 三态夜扫(第(0));
    await 三态夜扫(第(100));
    expect(await 钟()).toMatchObject({ state: "沉睡", enteredDay: 加天(起, 90) });
    expect((await 痕()).map((x) => x.toState)).toEqual(["活跃", "沉睡"]);
  });

  it("一天扫两遍不重复：第二遍记号相同直接跳过；规则改了当晚重算", async () => {
    await 三态夜扫(第(95));
    const 一 = await 痕();
    expect(await 三态夜扫(第(95))).toMatchObject({ 算了: 0 });
    expect(await 痕()).toEqual(一);
    // 把沉睡天数改成 100：当晚按新天数重算，退回活跃
    await setSetting("orgRules", 开三态({ 三态: { ...默认三态规则, 开: true, 内贸: { 沉睡: 100, 待回收: 180, 进公海: 30 } } }));
    expect(await 三态夜扫(第(95))).toMatchObject({ 算了: 1, 换状态: 1 });
    expect((await 钟())!.state).toBe("活跃");
    // 记号清掉再扫一遍：算了但什么都不写
    await setSetting(三态扫过键, "");
    await 三态夜扫(第(95));
    expect((await 痕()).length).toBe(一.length + 1);
  });
});

describe("沟通、被挡、交接", () => {
  it("沉睡里记一条有内容的沟通，当晚回活跃；空内容的不拨钟", async () => {
    await 三态夜扫(第(100));
    expect((await 钟())!.state).toBe("沉睡");
    await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "   ", customerId: 客户, ownerId: 乙, occurredAt: new Date(`${加天(起, 101)}T10:00:00+08:00`) } });
    await 三态夜扫(第(102));
    expect((await 钟())!.state).toBe("沉睡");
    await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "约了下周见", customerId: 客户, ownerId: 乙, occurredAt: new Date(`${加天(起, 102)}T10:00:00+08:00`) } });
    await 三态夜扫(第(103));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 加天(起, 102), quotaResetDay: 加天(起, 102) });
  });

  it("同事负责、没结束的项目挡住：到期不收，打被挡标记、留一行；同事项目结束后下一遍收", async () => {
    const p = await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 丙, creatorId: 丙, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(第(180));
    await 发完三次(加天(起, 200));
    await 三态夜扫(第(210));
    expect(await 在公海()).toBe(false);
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: true });
    expect((await 痕()).filter((x) => x.reason === 被挡理由)).toHaveLength(1);
    await 三态夜扫(第(211));
    expect((await 痕()).filter((x) => x.reason === 被挡理由)).toHaveLength(1);
    // 同事结束了项目（结局在第 150 天以前就记了的话也一样；这里按今天结束 → 结束日不是订单，不拨钟）
    await prisma.project.update({ where: { id: p.id }, data: { result: "丢单" } });
    await 三态夜扫(第(212));
    expect(await 在公海()).toBe(true);
  });

  it("交接中的客户到期不收，记在明细里", async () => {
    await 三态夜扫(第(180));
    await 发完三次(加天(起, 200));
    await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 乙, toUserId: 丙, byUserId: 乙, customerIds: JSON.stringify([客户]) } });
    expect(await 三态夜扫(第(210))).toMatchObject({ 交接中没收: 1, 进公海: [] });
    expect(await 在公海()).toBe(false);
  });

  it("名下订单阶段没结束：一律活跃，不往下走", async () => {
    await prisma.project.create({ data: { name: "订单", customerId: 客户, ownerId: 乙, creatorId: 乙, phase: "订单", node: "合同签订", createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(第(300));
    expect((await 钟())!.state).toBe("活跃");
  });
});

describe("计时范围、成交", () => {
  it("市场成员（只有市场角色）名下不计时，不建钟", async () => {
    await prisma.entMember.update({ where: { userId: 乙 }, data: { bizRole: "marketing_mgr" } });
    await 三态夜扫(第(100));
    expect(await 钟()).toBeNull();
  });

  it("成交过（订单结束、没有项目在推）：首次成立那天写下成交成立日，按 365 天活跃段算", async () => {
    await prisma.project.create({ data: { name: "订单", customerId: 客户, ownerId: 乙, creatorId: 乙, phase: "订单", node: "合同签订", result: "成交", createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(第(100));
    expect(await 钟()).toMatchObject({ state: "活跃", dealDay: 加天(起, 100) });
  });
});

describe("换负责人们of", () => {
  it("转让 / 离职交接按先后算归零：12 个月内第 3 次起不归零；捞取、市场首次分配总归零不计次；undo、pool-release 不算", () => {
    const 行 = (日: string, kind: string) => ({ at: new Date(`${日}T10:00:00+08:00`), kind });
    const r = 换负责人们of([行("2026-11-02", "market-assign"), 行("2026-11-03", "assign"), 行("2026-11-04", "pool-release"), 行("2026-11-05", "claim"), 行("2026-11-06", "deactivate"), 行("2026-11-07", "assign"), 行("2026-11-08", "undo")], 默认三态规则);
    expect(r).toEqual([
      { 日: "2026-11-02", 方式: "市场首次分配" },
      { 日: "2026-11-03", 方式: "转让", 归零: true },
      { 日: "2026-11-05", 方式: "公海捞取" },
      { 日: "2026-11-06", 方式: "离职交接", 归零: true },
      { 日: "2026-11-07", 方式: "转让", 归零: false },
    ]);
  });
});
