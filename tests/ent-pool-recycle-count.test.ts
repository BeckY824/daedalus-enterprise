/**
 * 企业版项目公海「收回次数」（10-27 批注，lib/project/recycle-count.ts + list.ts）：
 *   - 只数 kind = pool-release 的留痕（手动放回、超时回收都记这一种），改节点 / 转让 / 领取不算
 *   - 筛选：0 = 没收回过、1 / 2 = 正好、3 = 3 次及以上；乱传当不限
 *   - 只在项目公海视图生效（pool=1）；不在公海视图传了也不筛
 *   - 开关关着：列表行里没有收回次数，传 recycled 也不筛
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 收回次数筛, 合收回次数, 数收回次数, 收回次数筛们 } from "@/lib/project/recycle-count";
import { 读项目列表 } from "@/lib/project/list";

let 老板: { id: string; name: string; role: string };
const 项目们: Record<string, string> = {};

async function 痕(projectId: string, kind: string, n: number) {
  for (let i = 0; i < n; i++) {
    await prisma.projectNodeLog.create({ data: { projectId, userId: 老板.id, toPhase: "线索", toNode: "潜客培育", kind } });
  }
}

beforeEach(async () => {
  await resetDb();
  const u = await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } });
  老板 = { id: u.id, name: u.name, role: "ADMIN" };
  mocks.user = { ...mocks.user, id: u.id };
  const c = await prisma.customer.create({ data: { name: "客户甲", phone: "13900000001", salesOwnerId: u.id } });
  // 零次、一次、两次、四次，外加一个不在公海的（收回过一次又被领走）
  for (const [名, 次, 在公海] of [["零", 0, true], ["一", 1, true], ["二", 2, true], ["四", 4, true], ["领走", 1, false]] as const) {
    const p = await prisma.project.create({ data: { name: `项目${名}`, customerId: c.id, ownerId: u.id, creatorId: u.id, pooledAt: 在公海 ? new Date() : null } });
    项目们[名] = p.id;
    await 痕(p.id, "pool-release", 次);
  }
  // 别的留痕不算
  await 痕(项目们["零"], "node", 2);
  await 痕(项目们["零"], "transfer", 1);
  await 痕(项目们["一"], "pool-claim", 3);
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("收回次数", () => {
  it("筛选项和比对：0 / 1 / 2 正好，3 = 3 次及以上，乱传当不限", () => {
    expect(收回次数筛们.map((o) => o.value)).toEqual(["", "0", "1", "2", "3"]);
    expect(收回次数筛("2")).toBe("2");
    expect(收回次数筛("9")).toBe("");
    expect(收回次数筛(["1"])).toBe("");
    expect(合收回次数(5, "")).toBe(true);
    expect(合收回次数(0, "0")).toBe(true);
    expect(合收回次数(1, "0")).toBe(false);
    expect(合收回次数(2, "2")).toBe(true);
    expect(合收回次数(3, "2")).toBe(false);
    expect(合收回次数(3, "3")).toBe(true);
    expect(合收回次数(7, "3")).toBe(true);
  });

  it("只数放回公海的留痕，改节点 / 转让 / 领取不算；空列表不查库", async () => {
    const m = await 数收回次数(Object.values(项目们), prisma);
    expect(m.get(项目们["零"]) ?? 0).toBe(0);
    expect(m.get(项目们["一"])).toBe(1);
    expect(m.get(项目们["二"])).toBe(2);
    expect(m.get(项目们["四"])).toBe(4);
    const 假 = { projectNodeLog: { findMany: vi.fn() } };
    expect((await 数收回次数([], 假 as never)).size).toBe(0);
    expect(假.projectNodeLog.findMany).not.toHaveBeenCalled();
  });

  it("项目公海列表：每行带收回次数，按次数筛", async () => {
    const 列 = async (recycled?: string) => (await 读项目列表(老板, { pool: "1", recycled })).行;
    const 全 = await 列();
    expect(Object.fromEntries(全.map((r) => [r.name, r.收回次数]))).toEqual({ 项目零: 0, 项目一: 1, 项目二: 2, 项目四: 4 });
    expect((await 列("0")).map((r) => r.name)).toEqual(["项目零"]);
    expect((await 列("2")).map((r) => r.name)).toEqual(["项目二"]);
    expect((await 列("3")).map((r) => r.name)).toEqual(["项目四"]);
    expect((await 读项目列表(老板, { pool: "1", recycled: "3" })).filters.recycled).toBe("3");
    // 不在公海视图：传了也不筛
    const 非公海 = await 读项目列表(老板, { recycled: "0" });
    expect(非公海.行.length).toBe(5);
    expect(非公海.filters.recycled).toBe("");
  });

  it("开关关着：行里没有收回次数，传 recycled 也不筛", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const r = await 读项目列表(老板, { pool: "1", recycled: "0" });
    expect(r.行.length).toBe(4);
    expect(r.行.every((x) => !("收回次数" in x))).toBe(true);
    expect(r.filters.recycled).toBe("");
    expect(r.企业版).toBe(false);
  });
});
