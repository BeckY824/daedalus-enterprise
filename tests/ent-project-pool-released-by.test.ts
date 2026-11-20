/**
 * 项目页公海提示条「是你放回去的」只对最近一次真放回的那位说（审查 29A，load.ts 放回的是我）：
 *   - 认不限条数的放回留痕（p.logs 只取最近 200 条；进出公海多、留痕多时最近那次放回会掉出 200 条外，原来退回按「原负责人」认就认错了）
 *   - 多次进出公海：看最近那一次是谁放的
 *   - 系统超时收回：操作人是「系统」，谁看都不是「我放回的」
 *   - 没留痕的老数据：企业版负责人已清空，不算我
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 超时理由 } from "@/lib/project/timeout";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";

describe("项目在公海：放回的是我", () => {
  let 甲: string, 乙: string, 丙: string, 客户: string, 项目: string;
  const 放回 = (userId: string, fromOwnerId: string, at: Date, reason: string | null = "手动") =>
    prisma.projectNodeLog.create({ data: { projectId: 项目, userId, at, kind: "pool-release", fromOwnerId, toPhase: "线索", toNode: "初次接触", reason } });
  const 领回 = (userId: string, at: Date) =>
    prisma.projectNodeLog.create({ data: { projectId: 项目, userId, at, kind: "pool-claim", toOwnerId: userId, toPhase: "线索", toNode: "初次接触" } });
  const 详 = async (谁: string) => {
    mocks.user = { ...mocks.user, id: 谁 };
    const r = await 读项目详情(mocks.user as never, 项目);
    if (r.种 !== "有") throw new Error(`没读到项目：${r.种}`);
    return r.props.p;
  };
  const 看 = async (谁: string) => (await 详(谁)).放回的是我;
  const 天前 = (n: number) => new Date(Date.now() - n * 86400_000);

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("business", { projectMode: true });
    甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "SALES", password: "x" } })).id;
    乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
    丙 = (await prisma.user.create({ data: { email: "bing", name: "丙", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.createMany({ data: [{ userId: 甲, bizRole: "sales" }, { userId: 乙, bizRole: "sales" }, { userId: 丙, bizRole: "sales" }] });
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 丙 } })).id;
    项目 = (await prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: "", creatorId: 丙, phase: "线索", node: "初次接触", pooledAt: 天前(1) } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("最近那次放回之后又有 200 多条留痕：照样认出是我放回的（原负责人是丙，不是我）", async () => {
    await 放回(乙, 丙 /* 原负责人；乙是替他放回的上级 */, 天前(30));
    const 后 = 天前(29).getTime();
    await prisma.projectNodeLog.createMany({ data: Array.from({ length: 210 }, (_, i) => ({ projectId: 项目, userId: 甲, at: new Date(后 + i * 1000), kind: "member", toPhase: "线索", toNode: "初次接触" })) });
    expect(await 看(乙)).toBe(true);
    expect(await 看(甲)).toBe(false);
    // 页头「Y 放回的」也认这一条（复审 29A：原来从只取 200 条的 p.logs 找，找不到就整段不写）
    expect((await 详(甲)).进公海).toEqual({ 方式: "手动", 谁: "乙" });
  });

  // 原负责人自己看不到公海里自己放的项目（回避），这里放回的都是替丙放的上级 / 管理
  it("多次进出公海：看最近那一次是谁放的", async () => {
    await 放回(乙, 丙, 天前(10));
    await 领回(丙, 天前(9));
    await 放回(甲, 丙, 天前(5));
    // 最近是甲放的：乙早先放过一次也不算
    expect(await 看(乙)).toBe(false);
    expect(await 看(甲)).toBe(true);
    await 领回(丙, 天前(4));
    await 放回(乙, 丙, 天前(2));
    expect(await 看(乙)).toBe(true);
    expect(await 看(甲)).toBe(false);
  });

  it("系统超时收回：谁看都不是「我放回的」", async () => {
    await 放回("system", 丙, 天前(3), 超时理由);
    expect(await 看(甲)).toBe(false);
    expect((await 详(甲)).进公海?.方式).toBe("超时");
    expect(await 看(乙)).toBe(false);
  });

  it("没留痕的老数据（企业版负责人已清空）：不算我", async () => {
    expect(await 看(乙)).toBe(false);
    expect((await 详(乙)).进公海).toBeNull();
  });
});
