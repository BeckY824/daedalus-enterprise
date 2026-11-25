/**
 * 合并客户 · 服务端第二单（11-25，PR #457）：B 的换负责人记录合并时挪到 A（E-277，超时链照认），
 * 但「合并本身不拨钟、留下那家自己的历史优先」（我方决定，merge-moved-logs.ts）：
 *   - 历史变更「建档」的首任负责人只认 A 自己的，B 比 A 早建档也不显示成 B 的首任
 *   - 两家都在公海、系统管理员并的：公海回避、领取带活、撤销放进公海都认 A 自己最近一次进公海时的负责人
 * （三态不拨钟的用例在 tests/ent-tri-state-save-recalc.test.ts「合并客户后按挪来的沟通重算三态」；
 *   只挂联系人的沟通撤回留 A 在 tests/ent-customer-merge-review3.test.ts）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 放进公海, 领取, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 公海客户原负责人是, 公海前负责人 } from "@/lib/owner-log-db";
import { 公海客户的原负责人 } from "@/lib/enterprise/dedupe-claim";
import { 执行合并, 撤回合并 } from "@/lib/enterprise/customer-merge";
import { 客户历史页 } from "@/app/(app)/customers/[id]/history-data";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 老板: 人, 甲: 人, 乙: 人, 丙: 人;
let 序 = 0;

const 造人 = async (key: string, name: string, bizRole = "sales", role = "SALES"): Promise<人> => {
  const email = `${key}@x`;
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  await raw.entMember.create({ data: { userId: u.id, bizRole, line: bizRole === "director" ? null : "内贸" } });
  return { id: u.id, name, email, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { ...u };
  忘掉企业版范围();
  return 以谁的身份(u.id, fn);
};
const 客户 = async (ownerId: string, 补: Record<string, unknown> = {}) => {
  序++;
  return (await raw.customer.create({
    data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId, contacts: { create: { name: `联系人${序}`, phone: `139${String(序).padStart(8, "0")}`, isPrimary: true } }, ...补 },
  })).id;
};
const 负责人of = async (c: string) => (await raw.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId;
const 占位Id = async () => (await raw.user.findUniqueOrThrow({ where: { email: 无负责人占位邮箱 } })).id;
const 并成 = async (a: string, b: string) => {
  忘掉企业版范围();
  const r = await 执行合并(prisma, a, b, 老板, { 已核对: true });
  if (!r.ok) throw new Error(r.error);
  return r.mergeId;
};
const 天前 = (n: number) => new Date(Date.now() - n * 86400_000);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "director", "ADMIN");
  甲 = await 造人("jia", "销售甲某");
  乙 = await 造人("yi", "销售乙某");
  丙 = await 造人("bing", "销售丙某");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("历史变更「建档」首任负责人只认留下那家自己的", () => {
  const 首任 = async (c: string) => {
    const 行 = await raw.customer.findUniqueOrThrow({ where: { id: c }, select: { id: true, createdAt: true, salesOwnerId: true, bizLine: true, touchpoint: true, channel: { select: { name: true } } } });
    const 页 = await 以(老板, () => 客户历史页({ ...老板 } as never, 行, "负责人", [], (p) => p));
    return 页.建档?.行们.find((r) => r.键 === "首任负责人")?.值;
  };

  it("B 比 A 早建档、早换过人：合并后 A 的首任负责人照旧是 A 的；A 没换过人的是 A 现在的负责人；撤回后 B 的首任照旧", async () => {
    const a = await 客户(乙.id, { createdAt: 天前(30) });
    const b = await 客户(乙.id, { createdAt: 天前(300) });
    await raw.customerOwnerLog.create({ data: { customerId: a, userId: 老板.id, fromOwnerId: 甲.id, toOwnerId: 乙.id, kind: "assign", at: 天前(10) } });
    const b换 = await raw.customerOwnerLog.create({ data: { customerId: b, userId: 老板.id, fromOwnerId: 丙.id, toOwnerId: 乙.id, kind: "assign", at: 天前(200) } });
    expect(await 首任(a)).toBe("销售甲某");
    const mergeId = await 并成(a, b);
    expect((await raw.customerOwnerLog.findUniqueOrThrow({ where: { id: b换.id } })).customerId).toBe(a);
    expect(await 首任(a)).toBe("销售甲某");

    // A 自己没换过人：首任 = 现在的负责人，不是 B 那条的 from
    const a2 = await 客户(乙.id, { createdAt: 天前(30) });
    const b2 = await 客户(乙.id, { createdAt: 天前(300) });
    await raw.customerOwnerLog.create({ data: { customerId: b2, userId: 老板.id, fromOwnerId: 丙.id, toOwnerId: 乙.id, kind: "assign", at: 天前(200) } });
    await 并成(a2, b2);
    expect(await 首任(a2)).toBe("销售乙某");

    忘掉企业版范围();
    expect(await 撤回合并(prisma, mergeId, 老板)).toMatchObject({ ok: true });
    expect(await 首任(b)).toBe("销售丙某");
  });
});

describe("两家都在公海、系统管理员并：公海原负责人只认 A 自己那条 pool-release", () => {
  /** 甲 先放 A、乙 后放 B 进公海（B 那条更近）；甲 名下 A 上有个没做完的计划；系统管理员把 B 并进 A */
  const 两家进公海并 = async () => {
    const a = await 客户(甲.id);
    const b = await 客户(乙.id);
    const 计划 = await raw.followPlan.create({ data: { customerId: a, ownerId: 甲.id, subject: "回访", plannedAt: new Date("2026-12-01T00:00:00Z") } });
    expect((await 以(甲, () => 放进公海([a], "客户主动终止"))).ok).toBe(true);
    // A 那条早一小时（排序稳定）；撤销时限按公海行算，A 的公海行仍是刚放的
    await raw.customerOwnerLog.updateMany({ where: { customerId: a, kind: "pool-release" }, data: { at: new Date(Date.now() - 3600_000) } });
    expect((await 以(乙, () => 放进公海([b], "客户主动终止"))).ok).toBe(true);
    await 并成(a, b);
    expect(await raw.customerOwnerLog.count({ where: { customerId: a, kind: "pool-release" } })).toBe(2);
    return { a, b, 计划: 计划.id };
  };

  it("公海回避认 A 的前负责人（甲领不回、乙不算）；领取带活按甲找活", async () => {
    const { a, 计划 } = await 两家进公海并();
    const 占位 = await 占位Id();
    expect(await 负责人of(a)).toBe(占位);
    expect([...(await 公海客户原负责人是(prisma, [甲.id, 乙.id], [a])).entries()]).toEqual([[a, 甲.id]]);
    expect(await 公海前负责人(prisma, a, 占位)).toBe(甲.id);
    expect(await 公海客户的原负责人(prisma, a)).toBe(甲.id);
    expect((await 以(甲, () => 领取([a]))).ok).toBe(false);
    expect((await 以(丙, () => 领取([a]))).ok).toBe(true);
    expect(await 负责人of(a)).toBe(丙.id);
    expect((await raw.followPlan.findUniqueOrThrow({ where: { id: 计划 } })).ownerId).toBe(丙.id);
  });

  it("甲撤销放进公海：A 还给甲（不是 B 的原负责人乙），A 自己那条 pool-release 删掉，B 挪来的那条留着", async () => {
    const { a } = await 两家进公海并();
    await 以(甲, () => 撤销公海("放进", [{ id: a, 值: 丙.id }]));
    expect(await 负责人of(a)).toBe(甲.id);
    const 留 = await raw.customerOwnerLog.findMany({ where: { customerId: a, kind: "pool-release" } });
    expect(留.map((x) => x.fromOwnerId)).toEqual([乙.id]);
  });
});
