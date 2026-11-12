/**
 * 客户三态 · 列表 / 看板「N 天后进公海」和客户详情状态条对齐（钟上存最早进公海日，迁移 133 EntCustomerClock.poolDueDay），
 * 以及设置 →「客户回收」打开三态的提示照实写（打开后马上计时，不是「当晚」；提醒时点同 三态提醒时刻）。日子都是改出来的。
 *   - 暂缓回收解除后那 10 天（解除当天提醒还没发）、推后当天重起一轮：以前列表按钟上的提醒次数排，和详情差几天；现在两边同一个数
 *   - 普通待回收照旧；钟上这列空的老钟退回旧算法
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫 } from "@/lib/enterprise/tri-state-db";
import { 钟上三态提醒, 三态提醒时刻 } from "@/lib/enterprise/tri-state-notice";
import { 继续持有 } from "@/lib/enterprise/tri-state-hold";
import { 三态标们 } from "@/lib/enterprise/tri-state-list";
import { 读三态条 } from "@/lib/enterprise/tri-state-detail";
import { 加天, 差天, 待回收最早进公海日 } from "@/lib/enterprise/tri-state";
import { 默认组织规则, 默认三态规则, type 组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完 } from "@/lib/enterprise/notify";

const 起 = "2026-11-01";
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 八点 = (n: number) => new Date(`${日(n)}T08:10:00+08:00`);
const 白天 = (n: number) => new Date(`${日(n)}T10:00:00+08:00`);
let 规则: 组织规则;
const 默认开 = (): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true } });

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内", { id: string; name: string }>;
let 客户: string;
const 钟 = () => prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } });

/** 列表 / 看板那一格的天数 */
async function 列表天(n: number): Promise<number | undefined> {
  const 标 = (await 三态标们([{ id: 客户, salesOwnerId: 人.乙.id, 在公海: false }], 规则.三态, 日(n)))[客户];
  expect(标?.态).toBe("待回收");
  return 标!.几天后进公海;
}
/** 客户详情状态条上的天数（「N 天后自动进公海」；今晚进 = 0） */
async function 详情天(现在: Date): Promise<number> {
  const 条 = await 读三态条(人.乙, 客户, 现在);
  expect(条?.状态).toBe("待回收");
  const m = /(\d+) 天后自动进公海/.exec(条!.文字);
  return m ? Number(m[1]) : 0;
}
/** 改前列表的算法（只看钟上的进入日、提醒次数、最近提醒日） */
async function 旧算法天(n: number): Promise<number> {
  const k = await 钟();
  const 间隔 = 默认三态规则.内贸.进公海 - 默认三态规则.内贸.待回收;
  return 差天(日(n), 待回收最早进公海日({ 待回收: k.enteredDay, 进公海: 加天(k.enteredDay, 间隔) }, 默认三态规则.内贸.进公海, 日(n), k.noticeCount, k.lastNoticeDay));
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "丙", "甲", "总内"] as const) {
    const u = await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } });
    人[k] = { id: u.id, name: u.name };
  }
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.丙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.甲.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内.id, bizRole: "director", line: "内贸" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  规则 = 默认开();
  await setSetting("orgRules", 规则);
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("列表「N 天后进公海」和客户详情同一个数（钟上存最早进公海日）", () => {
  it("普通待回收：照旧，钟上存的和旧算法、详情三边一样", async () => {
    await 三态夜扫(早(185));
    expect((await 钟()).poolDueDay).not.toBeNull();
    const 列 = await 列表天(185);
    expect(列).toBe(await 详情天(白天(185)));
    expect(列).toBe(await 旧算法天(185));
  });

  it("钟上这列空（老钟、还没重扫）：退回旧算法，不报错", async () => {
    await 三态夜扫(早(185));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { poolDueDay: null } });
    expect(await 列表天(185)).toBe(await 旧算法天(185));
  });

  it("暂缓回收解除当天（解除提醒还没发）和之后那 10 天：列表和详情一样，不再按旧的 3 次提醒说「即将进公海」", async () => {
    await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: true });
    await prisma.project.updateMany({ where: { customerId: 客户, ownerId: 人.丙.id }, data: { result: "丢单" } });
    await 三态夜扫(早(250));
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: false, poolDueDay: 日(260) });
    // 改前：列表只看 3 次提醒（最近第 200 天），说已到期；详情按解除后 10 天算
    expect(await 旧算法天(250)).toBeLessThanOrEqual(0);
    expect(await 列表天(250)).toBe(10);
    expect(await 详情天(早(250))).toBe(10);
    await 钟上三态提醒(八点(250));
    expect(await 列表天(250)).toBe(await 详情天(白天(250)));
    await 三态夜扫(早(255));
    expect(await 列表天(255)).toBe(5);
    expect(await 详情天(白天(255))).toBe(5);
  });

  it("推后当天重起一轮：继续持有写钟时一起更新，列表和详情一样（改前差 1 天）", async () => {
    await 三态夜扫(早(180));
    // 提醒漏了两次（停机），第 215 天还在待回收
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 1, lastNoticeDay: 日(180) } });
    await 三态夜扫(早(215));
    expect(await 钟()).toMatchObject({ state: "待回收" });
    expect(await 继续持有(人.乙, 客户, "客户下月回来再谈", 白天(215))).toMatchObject({ ok: true });
    expect(await 钟()).toMatchObject({ state: "待回收", enteredDay: 日(210) });
    const 详 = await 详情天(白天(215));
    expect(await 旧算法天(215)).not.toBe(详);
    expect(await 列表天(215)).toBe(详);
    await 三态夜扫(早(216));
    await 钟上三态提醒(八点(216));
    expect(await 列表天(216)).toBe(await 详情天(白天(216)));
  });

  it("管理员白天改了三态天数（夜扫记号还是旧规则）：列表不读钟上按旧规则存的，退回按现在规则算，和详情一致；次日夜扫后又读存的", async () => {
    await 三态夜扫(早(185));
    const 旧存 = (await 钟()).poolDueDay;
    const 新 = { ...默认三态规则.内贸, 进公海: 60 };
    规则 = { ...默认组织规则, 三态: { ...默认三态规则, 开: true, 内贸: 新, 外贸: 新 } };
    await setSetting("orgRules", 规则);
    invalidateSettingsCache();
    const 详 = await 详情天(白天(185));
    expect(差天(日(185), 旧存!)).not.toBe(详);
    expect(await 列表天(185)).toBe(详);
    await 三态夜扫(早(186));
    expect((await 钟()).poolDueDay).not.toBe(旧存);
    expect(await 列表天(186)).toBe(await 详情天(白天(186)));
  });

  it("暂缓回收中（被挡）：钟上不存最早进公海日", async () => {
    await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(早(180));
    expect((await 钟()).poolDueDay).not.toBeNull();
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    expect(await 钟()).toMatchObject({ state: "待回收", blocked: true, poolDueDay: null });
    const 前 = (await 钟()).updatedAt;
    await 三态夜扫(早(211));
    expect((await 钟()).updatedAt).toEqual(前);
  });

  it("进了客户公海：钟上这列清空", async () => {
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    expect(await prisma.customerPool.findUnique({ where: { customerId: 客户 } })).not.toBeNull();
    expect(await 钟()).toMatchObject({ state: "公海", poolDueDay: null });
  });
});

describe("设置 →「客户回收」打开三态的提示照实写", () => {
  const 源 = readFileSync(path.join(__dirname, "../src/app/(app)/settings/RecycleTab.tsx"), "utf8");
  it("不说「当晚起」：打开后马上计时、几分钟内建好状态", () => {
    expect(源).not.toMatch(/当晚起/);
    expect(源).toContain("打开后立即开始按客户计时，几分钟内给每位客户建好状态");
    expect(源).toContain("已打开客户回收，已开始计时");
  });
  it("提醒时点和 三态提醒时刻 一致（改了时点这里会红）", () => {
    const 点 = `${String(三态提醒时刻.时).padStart(2, "0")}:${String(三态提醒时刻.分).padStart(2, "0")}`;
    expect(点).toBe("08:00");
    expect(源).toContain(`每天 ${点}（北京时间）起`);
    expect(源).toContain(`过了 ${点} 才打开的当天就发第一遍`);
  });
});
