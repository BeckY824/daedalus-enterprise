/**
 * X-68 / P-转-21：新线索待分配（awaitAssignAt）期间，建的人只先占着负责人一格——能看、能改字段，
 * 初判、推进（手动改节点、终止进程、填齐必填的自动推进）、删除都不行；分给负责人以后照常。
 * 换负责人清待分配（分配、改负责人、放回公海、领取、超时回收）在 ent-owner-carry.test.ts（#218）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 销售初判, 读线索验证 } from "@/lib/project/lead-verify";
import { 改节点, 改项目, 终止进程, 删项目 } from "@/lib/project/db";
import { 分配线索 } from "@/app/(app)/leads/assign-actions";
import { 待分配不能动 } from "@/lib/enterprise/await-assign";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 不设配额key } from "@/lib/enterprise/lead-assign";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 销售: 人, 接手: 人;
const 电话们 = ["13800000001", "13800000002", "13800000003", "13800000004"];
let 号 = 0;

async function 建(email: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = async (salesOwnerId: string) =>
  (await prisma.customer.create({ data: { name: `客户${号}`, phone: 电话们[号++], salesOwnerId } })).id;
/** 销售自己建的新线索、还在等分配：建的人占着负责人一格 */
const 待分配线索 = async (补: Record<string, unknown> = {}) =>
  (await prisma.project.create({
    data: { name: `项目${号}`, customerId: await 客户(销售.id), ownerId: 销售.id, creatorId: 销售.id, phase: "线索", node: "线索验证", awaitAssignAt: new Date(), ...补 },
  })).id;
/** 客户只剩一个项目不能单删：删除的几条先给同一客户再挂一个 */
const 同客户另一个 = async (id: string) => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id } });
  await prisma.project.create({ data: { name: "另一个", customerId: p.customerId, ownerId: 销售.id, creatorId: 销售.id } });
};
const 项 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
const 拦 = { ok: false, error: 待分配不能动 };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales");
  接手 = await 建("taker");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 销售.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 接手.id, managerId: 组长.id, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true, poolDays: 30 });
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true);
  invalidateSettingsCache();
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("待分配期间占位的建的人（X-68、P-转-21）", () => {
  it("初判、改节点、终止进程、删除都拦，项目不动；详情的「我能」是空的", async () => {
    const id = await 待分配线索();
    await 同客户另一个(id);
    expect(await 销售初判(销售, id, "无效", { invalidReason: "联系方式无效" })).toEqual(拦);
    expect(await 改节点(销售, id, { phase: "线索", node: "潜客培育" })).toMatchObject(拦);
    expect(await 终止进程(销售, id, { 备注: "不做了" })).toMatchObject(拦);
    expect(await 删项目(销售, id)).toMatchObject(拦);
    const 后 = await 项(id);
    expect(后).toMatchObject({ phase: "线索", node: "线索验证", result: null, deletedAt: null, ownerId: 销售.id });
    expect(await prisma.entLeadVerify.count()).toBe(0);
    expect((await 读线索验证(销售, 后))?.我能).toBeNull();
  });

  it("能改字段，但填齐必填不跟着自动推进；不在待分配的同样改法照常推", async () => {
    await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { 潜客培育: ["预计成交日期"] } } });
    invalidateSettingsCache();
    const 待 = await 待分配线索({ phase: "线索", node: "潜客培育" });
    const r = await 改项目(销售, 待, { name: "项目0", amount: 0, expectedDealAt: "2026-11-20" });
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty("自动推到");
    expect(await 项(待)).toMatchObject({ node: "潜客培育", expectedDealAt: new Date("2026-11-20T00:00:00") });

    const 普通 = await 待分配线索({ phase: "线索", node: "潜客培育", awaitAssignAt: null });
    expect(await 改项目(销售, 普通, { name: "项目1", amount: 0, expectedDealAt: "2026-11-20" })).toMatchObject({ ok: true, 自动推到: ["线索验证"] });
  });

  it("系统管理员不是占位的人：照常能删", async () => {
    const id = await 待分配线索();
    await 同客户另一个(id);
    当(老板);
    expect((await 删项目(老板, id)).ok).toBe(true);
  });

  it("分给负责人以后：待分配清掉，新负责人能初判；建的人不再是负责人", async () => {
    const id = await 待分配线索();
    当(组长);
    expect(await 分配线索({ projectId: id, toUserId: 接手.id, line: "内贸" })).toEqual({ ok: true });
    const 后 = await 项(id);
    expect(后).toMatchObject({ ownerId: 接手.id, awaitAssignAt: null });
    expect((await 读线索验证(接手, 后))?.我能).toBe("初判");
    当(接手);
    expect(await 销售初判(接手, id, "无效", { invalidReason: "联系方式无效" })).toEqual({ ok: true });
  });
});
