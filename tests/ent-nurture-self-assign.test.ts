/**
 * 系统建项目「建给谁」的分配方式（11-18 总控追加，P-转-15 / X-93）：
 *   - 市场成员（业务角色市场管理 / 渠道运营，或按部门 / 逐人认定的）建给自己 → 暂不分配（叫法按字典当前的），
 *     客户转让框能选自动分配（页面可自动分配 = true）；原来记成个人自持，框里那组选项出不来
 *   - 销售建给自己 → 个人自持（照旧）
 *   - 建给别人 → 指定分配（照旧）
 * 入口：新建客户页（saveCustomer 补潜客培育）、线索转化 / 老线索转项目（self-assign-mode.ts 系统建项目分配方式）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 市场成员key } from "@/lib/enterprise/market";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { 页面可自动分配 } from "@/lib/enterprise/cust-auto-assign";
import { 系统建项目分配方式, 建给自己的分配方式 } from "@/lib/project/self-assign-mode";

type 人 = { id: string; name: string };
let 老板: 人, 市场: 人, 渠运: 人, 部门市场: 人, 销售: 人;
async function 造人(email: string, name: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name };
}
const 当 = (u: 人, role = "SALES") => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role }; };
let 序 = 0;
async function 新建客户(负责人: string): Promise<string> {
  const r = await saveCustomer({
    name: `自建客户${++序}`, phone: `1370000${String(2000 + 序).slice(-4)}`, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: 负责人, channelId: null, referrerCustomerId: null, 企业资料: { bizLine: "内贸" },
  } as Parameters<typeof saveCustomer>[0]);
  if (!r.ok) throw new Error(r.error);
  return r.id!;
}
const 培育of = (customerId: string) => prisma.project.findFirstOrThrow({ where: { customerId } });
const 看客户 = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id }, select: { id: true, salesOwnerId: true, bizLine: true, pool: { select: { customerId: true } } } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  市场 = await 造人("mkt", "市场");
  渠运 = await 造人("ops", "渠运");
  部门市场 = await 造人("deptmkt", "部门市场");
  销售 = await 造人("sales", "销售");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 市场.id, bizRole: "marketing_mgr" },
      { userId: 渠运.id, bizRole: "channel_ops" },
      // 业务角色只是项目运营，逐人设成市场成员（读市场成员们 认）
      { userId: 部门市场.id, bizRole: "project_ops" },
      { userId: 销售.id, bizRole: "sales", line: "内贸" },
    ],
  });
  await setSetting(市场成员key, [部门市场.id]);
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("新建客户页：补的潜客培育项目记哪种分配方式", () => {
  it("市场管理建给自己 → 暂不分配，客户转让框能选自动分配", async () => {
    当(市场);
    const id = await 新建客户(市场.id);
    expect((await 培育of(id)).assignMode).toBe("暂不分配");
    expect(await 页面可自动分配({ id: 市场.id, role: "SALES" }, await 看客户(id))).toBe(true);
  });

  it("渠道运营建给自己 → 暂不分配", async () => {
    当(渠运);
    expect((await 培育of(await 新建客户(渠运.id))).assignMode).toBe("暂不分配");
  });

  it("销售建给自己 → 个人自持（照旧）", async () => {
    当(销售);
    expect((await 培育of(await 新建客户(销售.id))).assignMode).toBe("个人自持");
  });

  it("建给别人 → 指定分配（照旧）", async () => {
    当(老板, "ADMIN");
    expect((await 培育of(await 新建客户(销售.id))).assignMode).toBe("指定分配");
  });
});

describe("系统建项目分配方式（线索转化、老线索转项目同一个）", () => {
  it("按部门 / 逐人认定的市场成员建给自己 → 暂不分配；叫法跟字典改名走", async () => {
    expect(await 系统建项目分配方式(prisma, 部门市场.id, 部门市场.id)).toBe("暂不分配");
    await prisma.entDictItem.updateMany({ where: { kind: "assign", name: "暂不分配" }, data: { name: "先不分" } });
    expect(await 建给自己的分配方式(prisma, 市场.id)).toBe("先不分");
  });
  it("销售 / 总管理建给自己 → 个人自持；建给别人 → 指定分配；记 复用判定", async () => {
    const 记 = new Map<string, string>();
    expect(await 系统建项目分配方式(prisma, 销售.id, 销售.id, 记)).toBe("个人自持");
    expect(await 系统建项目分配方式(prisma, 老板.id, 老板.id, 记)).toBe("个人自持");
    expect(await 系统建项目分配方式(prisma, 销售.id, 市场.id, 记)).toBe("指定分配");
    expect([...记.keys()].sort()).toEqual([销售.id, 老板.id].sort());
  });
  it("不是企业版 → 个人自持（不读组织）", async () => {
    vi.unstubAllEnvs();
    expect(await 系统建项目分配方式(prisma, 市场.id, 市场.id)).toBe("个人自持");
  });
});
