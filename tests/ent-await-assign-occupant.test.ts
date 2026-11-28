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
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 销售初判, 读线索验证 } from "@/lib/project/lead-verify";
import { 改节点, 改项目, 终止进程, 删项目, 记项目沟通 } from "@/lib/project/db";
import dayjs from "dayjs";
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

describe("待分配期间占位的建的人：不能记沟通、不能转让 / 改负责人（29M、P-转-21）", () => {
  const 向导 = () => ({ type: "PHONE", content: "聊了", occurredAt: dayjs().subtract(1, "hour").toISOString(), 下一步: "发报价", 阶段: "线索" });

  it("记项目沟通被拒，没写任何沟通", async () => {
    const id = await 待分配线索();
    expect(await 记项目沟通(销售, id, 向导())).toMatchObject(拦);
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("改负责人（转让）被拒，负责人和待分配标记不动；改字段照常能存", async () => {
    const id = await 待分配线索();
    expect(await 改项目(销售, id, { name: "项目0", amount: 0, ownerId: 接手.id })).toEqual({ ok: false, error: 待分配不能动 });
    expect(await 项(id)).toMatchObject({ ownerId: 销售.id });
    expect((await 项(id)).awaitAssignAt).not.toBeNull();
    expect((await 改项目(销售, id, { name: "改了名", amount: 0 })).ok).toBe(true);
    expect(await 项(id)).toMatchObject({ name: "改了名", ownerId: 销售.id });
  });

  it("客户页记沟通：选了待分配项目被拒；没选项目（只剩这一个）也说待分配；库里不新增沟通行", async () => {
    const { 核沟通项目, 定沟通挂哪个项目, 可记沟通项目们 } = await import("@/lib/project/follow-needs-project");
    const id = await 待分配线索();
    const 客户id = (await 项(id)).customerId;
    expect((await 可记沟通项目们(销售, 客户id)).可记).toEqual([]);
    expect(await 核沟通项目(销售, 客户id, id)).toBe(待分配不能动);
    expect(await 定沟通挂哪个项目(销售, 客户id, id)).toEqual({ ok: false, error: 待分配不能动 });
    expect(await 定沟通挂哪个项目(销售, 客户id, null)).toEqual({ ok: false, error: 待分配不能动 });
    expect(await prisma.followUp.count()).toBe(0);
    // 标记清掉后客户页照常能记
    await prisma.project.update({ where: { id }, data: { awaitAssignAt: null } });
    expect(await 核沟通项目(销售, 客户id, id)).toBeNull();
  });

  it("能转让项目 / 能往项目记沟通 对占位的人为假，对不占位的人照旧", async () => {
    const { 能转让项目 } = await import("@/lib/enterprise/permissions");
    const { 能往项目记沟通 } = await import("@/lib/project/follow-needs-project");
    const { 权限组织 } = await import("@/lib/enterprise/org");
    const org = await 权限组织();
    const 待 = { ownerId: 销售.id, awaitAssignAt: new Date(), pooledAt: null };
    const 正常 = { ownerId: 销售.id, awaitAssignAt: null, pooledAt: null };
    expect(能转让项目(销售, 待, org)).toBe(false);
    expect(能往项目记沟通(销售, 待, org, null)).toBe(false);
    expect(能转让项目(销售, 正常, org)).toBe(true);
    expect(能往项目记沟通(销售, 正常, org, null)).toBe(true);
    // 上级（销售管理）不是占位的人：照常能转
    expect(能转让项目(组长, 待, org)).toBe(true);
  });

  it("能分配的人（销售管理）照常分；分完负责人变成接手人，接手人能记沟通", async () => {
    const id = await 待分配线索();
    当(组长);
    expect(await 分配线索({ projectId: id, toUserId: 接手.id, line: "内贸" })).toEqual({ ok: true });
    当(接手);
    expect((await 记项目沟通(接手, id, 向导())).ok).toBe(true);
  });

  it("分配以后（标记清掉）原建档人若再成为负责人：沟通、转让照常", async () => {
    const id = await 待分配线索({ awaitAssignAt: null });
    expect((await 记项目沟通(销售, id, 向导())).ok).toBe(true);
    expect((await 改项目(销售, id, { name: "项目0", amount: 0, ownerId: 接手.id })).ok).toBe(true);
  });
});
