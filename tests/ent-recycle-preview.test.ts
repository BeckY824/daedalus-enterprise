/**
 * PR10a ②：设置 →「客户回收」改天数前的预览（projects/actions.ts 预览客户回收 → tri-state-db.ts 三态改天数预览）。
 *   - 开着：按现在库里的事实，旧天数、新天数各算一遍，数状态会变的客户；只读，不建钟、不改规则
 *   - 关着：null（关着改天数不重算任何人，界面直接存、不弹框）
 *   - 谁能看同 改组织规则 的三态那一块（只有系统管理员）；没带三态那块的改动不收
 * 「今天」钉死在北京 2026-11-15（只假 Date，不假计时器）：客户 10-01 建、钟从 11-01 起算，今天第 14 天
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 预览客户回收 } from "@/app/(app)/projects/actions";
import { 读组织规则 } from "@/lib/project/org-rules-store";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";

let 老板: string, 销售: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 内贸改 = (沉睡: number) => ({ 三态: { 内贸: { ...默认三态规则.内贸, 沉睡 }, 外贸: { ...默认三态规则.外贸 } } });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T10:00:00+08:00"));
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (email: string, name: string, role: string, bizRole: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 建人("boss", "老板", "ADMIN", "director");
  销售 = await 建人("s1", "小王", "SALES", "sales");
  await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 销售, createdAt: new Date("2026-10-01T10:00:00+08:00") } });
  await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 销售, createdAt: new Date("2026-10-01T10:00:00+08:00") } });
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: true } });
  当(老板, "ADMIN");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("预览客户回收", () => {
  it("开着：沉睡待定 90 → 10 天，今天第 14 天的两位都会从正常跟进变沉睡待定；只读，不建钟、不改规则", async () => {
    expect(await 预览客户回收(内贸改(10))).toEqual({ ok: true, 预览: { 变: 2, 进公海: 0 } });
    expect(await prisma.entCustomerClock.count()).toBe(0);
    expect(await prisma.entCustomerStateLog.count()).toBe(0);
    invalidateSettingsCache();
    expect((await 读组织规则()).三态.内贸.沉睡).toBe(90);
  });

  it("开着、新天数下状态不变（90 → 60，今天才第 14 天）：0 位", async () => {
    expect(await 预览客户回收(内贸改(60))).toEqual({ ok: true, 预览: { 变: 0, 进公海: 0 } });
  });

  it("关着：预览 null（关着改天数不重算任何人）", async () => {
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: false } });
    invalidateSettingsCache();
    expect(await 预览客户回收(内贸改(10))).toEqual({ ok: true, 预览: null });
  });

  it("销售看不了（同 改组织规则 三态那块的门）；没带三态那块的改动不收", async () => {
    当(销售);
    const r = await 预览客户回收(内贸改(10));
    expect(r.ok).toBe(false);
    当(老板, "ADMIN");
    expect(await 预览客户回收({ 公海: { 持有上限开: true } } as never)).toEqual({ ok: false, error: "没有要改的客户回收设置" });
  });
});
