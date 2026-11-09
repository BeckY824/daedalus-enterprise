/**
 * 市场管理开着范围限定时分别人名下的线索（11-03 完成度 A3-1 / A3-3 / A3-4）：
 *   市场只看得到市场线的东西，分配那一下的查和写原来都套着「谁在看」的范围：
 *   - 项目在销售名下 → 写的那条 updateMany 被范围挡成 0 条，假报「已被分配」（A3-4）
 *   - 接手人持有数照市场能看到的数 → 少数了，突破持有上限（A3-1）
 *   - 市场建档的线索（客户也在市场名下、只这一个项目）分出去后客户还留在市场名下，接手的销售看不到客户（A3-3）
 *   现在分配那段查和写不按谁在看限定（谁能分照旧由分配权限管），持有数按真实数，客户跟着项目走（只这一个项目时）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 分配线索 } from "@/app/(app)/leads/assign-actions";
import { 存组织规则 } from "@/lib/project/org-rules-store";
import { 合上改动, 默认组织规则 } from "@/lib/project/org-rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 市场成员key } from "@/lib/enterprise/market";

let 老板: string, 市场: string, 经理: string, 小王: string, 小张: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: id }; };
let 序 = 0;
async function 线索项目(ownerId: string, 客户归: string = ownerId, 建的人: string = ownerId) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 客户归 } })).id;
  const p = (await prisma.project.create({ data: { name: `项目${序}`, customerId: c, ownerId, creatorId: 建的人, phase: "线索" } })).id;
  return { c, p };
}
const 项目归 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;
const 客户归 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  const 人 = async (email: string, role = "SALES") => (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
  老板 = await 人("boss", "ADMIN");
  市场 = await 人("mkt");
  经理 = await 人("smgr", "MANAGER");
  小王 = await 人("s1");
  小张 = await 人("s2");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板, bizRole: "director" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 经理, bizRole: "sales_mgr" },
      { userId: 小王, bizRole: "sales", managerId: 经理 },
      { userId: 小张, bizRole: "sales", managerId: 经理 },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting(规则.线索分配.key, true);
  // 市场看得到市场成员建的、负责的（lib/enterprise/market.ts）
  await setSetting(市场成员key, [市场]);
  忘掉企业版范围();
  当(市场);
});
/** 按市场的身份分（范围限定按这个人算；测试里没有请求 cookie，不包就不限定） */
const 市场分 = (input: Parameters<typeof 分配线索>[0]) => 以谁的身份(市场, () => 分配线索(input));
afterEach(() => { vi.unstubAllEnvs(); });

describe("市场管理分配别人名下的线索（范围限定开着）", () => {
  it("市场建的、已分给销售的线索改派给另一位销售：分得过去，不再假报已被分配（A3-4）", async () => {
    // 市场看得到自己建的；现在在小王名下
    const { p } = await 线索项目(小王, 市场, 市场);
    expect(await 市场分({ projectId: p, toUserId: 小张 })).toEqual({ ok: true });
    expect(await 项目归(p)).toBe(小张);
  });

  it("持有数按接手人手上真有几个，市场看不到的也算（A3-1）", async () => {
    const 规则们 = 合上改动(默认组织规则, { 公海: { 持有上限开: true, 默认上限: 2 } });
    if ("error" in 规则们) throw new Error(规则们.error);
    await 存组织规则(规则们);
    // 小张手上已有 2 个线索阶段的项目，都在销售线，市场看不到
    await 线索项目(小张);
    await 线索项目(小张);
    const { p } = await 线索项目(市场);
    expect(await 市场分({ projectId: p, toUserId: 小张 })).toMatchObject({ ok: false, error: expect.stringContaining("持有上限") });
    expect(await 项目归(p)).toBe(市场);
  });

  it("市场建档的线索分给销售：客户整体交给销售，不管名下几个项目（11-09 落地规划第五节问题 1，取代 A3-3 的「还有别的项目就不动」）", async () => {
    const 单个 = await 线索项目(市场);
    expect(await 市场分({ projectId: 单个.p, toUserId: 小王 })).toEqual({ ok: true });
    expect(await 项目归(单个.p)).toBe(小王);
    expect(await 客户归(单个.c)).toBe(小王);
    const 换负责人 = await prisma.customerOwnerLog.findFirst({ where: { customerId: 单个.c } });
    expect(换负责人).toMatchObject({ fromOwnerId: 市场, toOwnerId: 小王 });

    const 多个 = await 线索项目(市场);
    const 另一个 = await prisma.project.create({ data: { name: "同客户另一个", customerId: 多个.c, ownerId: 市场, creatorId: 市场, phase: "线索" } });
    expect(await 市场分({ projectId: 多个.p, toUserId: 小王 })).toEqual({ ok: true });
    expect(await 项目归(多个.p)).toBe(小王);
    expect(await 客户归(多个.c)).toBe(小王);
    expect(await 项目归(另一个.id)).toBe(小王);
  });
});
