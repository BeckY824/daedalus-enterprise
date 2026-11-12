/**
 * 客户三态 · 第二轮审查修复 + 客户 11-12 答复 T1–T12 落地的用例。日子都是改出来的。
 *   - A：转让事务里算归零只用 tx 读规则；夜扫一批写之前在事务里重收事实
 *   - T1–T12 各一组，见各 describe
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const 坏人 = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
// 模拟发到一半断掉：坏人里的人那条没记上
vi.mock("@/lib/enterprise/notify", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/notify")>();
  return { ...m, notify: (ids: readonly (string | null | undefined)[], n: Parameters<typeof m.notify>[1]) => m.notify(ids.filter((u) => !u || !坏人.has(u)), n) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫, 三态扫过键, 收三态客户, 写一批, 公海状态 } from "@/lib/enterprise/tri-state-db";
import { 钟上三态提醒, 三态提醒水位键 } from "@/lib/enterprise/tri-state-notice";
import { 继续持有, 暂缓回收动作 } from "@/lib/enterprise/tri-state-hold";
import { 读组织 } from "@/lib/enterprise/org";
import { 默认组织规则, 默认三态规则, type 组织规则, type 三态规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 删被撤的换负责人记录, 记换负责人 } from "@/lib/owner-log-db";
import { 查完再写 } from "@/lib/check-then-write";
import { 等通知推完 } from "@/lib/enterprise/notify";

const 起 = "2026-11-01";
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 八点 = (n: number) => new Date(`${日(n)}T08:10:00+08:00`);
const 白天 = (n: number) => new Date(`${日(n)}T10:00:00+08:00`);
const 开三态 = (改: Partial<三态规则> = {}): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true, ...改 } });
async function 过(n: number) {
  await 三态夜扫(早(n));
  await 钟上三态提醒(八点(n));
}

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内" | "总外" | "系", { id: string; name: string }>;
let 客户: string;
const 钟 = () => prisma.entCustomerClock.findUnique({ where: { customerId: 客户 } });
const 痕 = () => prisma.entCustomerStateLog.findMany({ where: { customerId: 客户 }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { fromState: true, toState: true, via: true, reason: true } });
const 三态通知 = async (u: string) => prisma.entNotice.findMany({ where: { userId: u, dedupeKey: { startsWith: "tri-daily:" } }, select: { title: true, body: true } });
async function 转给(到: string, n: number) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } });
  await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 人.系.id, fromOwnerId: c.salesOwnerId, toOwnerId: 到, kind: "assign", at: 白天(n) } });
  await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 到 } });
}
/** 被同事项目挡住：第 210 天该进公海进不去 */
async function 到期被挡() {
  await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
  await 三态夜扫(早(180));
  await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
  await 三态夜扫(早(210));
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  坏人.clear();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "丙", "甲", "总内", "总外", "系"] as const) {
    const u = await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } });
    人[k] = { id: u.id, name: u.name };
  }
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.丙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.甲.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内.id, bizRole: "director", line: "内贸" },
      { userId: 人.总外.id, bizRole: "director", line: "外贸" },
      { userId: 人.系.id, bizRole: "director" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", 开三态());
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("A · 转让事务里算归零", () => {
  it("在事务里调 记换负责人：设置缓存刚失效也不走外面的连接读规则，归零照存", async () => {
    invalidateSettingsCache();
    const 外面读设置 = vi.spyOn(prisma.setting, "findMany");
    await 查完再写(async (tx) => {
      await tx.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.丙.id } });
      await 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.系.id, "assign");
    });
    expect(外面读设置).not.toHaveBeenCalled();
    expect((await prisma.customerOwnerLog.findMany({ select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([true]);
  });

  it("三态关着 / 不是企业版：转让照写、归零留空", async () => {
    await setSetting("orgRules", { ...默认组织规则 });
    await 查完再写((tx) => 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.系.id, "assign"));
    vi.stubEnv("CRM_ENTERPRISE", "");
    await setSetting("orgRules", 开三态());
    await 查完再写((tx) => 记换负责人(tx, [{ customerId: 客户, from: 人.丙.id, to: 人.乙.id }], 人.系.id, "assign"));
    expect((await prisma.customerOwnerLog.findMany({ select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([null, null]);
  });
});

describe("A · 夜扫一批写之前在事务里重收事实", () => {
  it("事务外读完以后有人转让了（钟没动）：按转让后的事实写，不写过时的状态留痕", async () => {
    await 三态夜扫(早(95));
    expect((await 钟())!.state).toBe("沉睡");
    const 规则 = 开三态();
    const org = await 读组织();
    const 旧的 = await 收三态客户(prisma, [客户], 规则, org, 早(96));
    await 转给(人.丙.id, 95);
    await 写一批(规则, org, 旧的, 早(96), 日(96));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(95) });
    expect((await 痕()).at(-1)).toMatchObject({ fromState: "沉睡", toState: "活跃" });
  });

  it("事务外读完以后记了一条有内容的沟通：按新沟通归零", async () => {
    await 三态夜扫(早(95));
    const 规则 = 开三态();
    const org = await 读组织();
    const 旧的 = await 收三态客户(prisma, [客户], 规则, org, 早(96));
    await prisma.followUp.create({ data: { type: "PHONE", title: "电话", content: "聊了下季度采购计划", customerId: 客户, ownerId: 人.乙.id, occurredAt: 白天(95) } });
    await 写一批(规则, org, 旧的, 早(96), 日(96));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(95) });
  });
});
