/**
 * M-权限-09 原口径（11-09）：管理（销售管理 / 市场管理 / 总管理）以下的人，负责人本人也算，单条沟通不给改、删入口。
 * 钉的是页面交给界面的开关：客户详情的 能改沟通 / 能删沟通、项目详情的 可改沟通 / 可删沟通（「…」菜单里的修改、删除就看这两个）。
 *   - 销售负责人：两页都不给改、删（还能记沟通）
 *   - 身为负责人的销售管理：两页都给改、删
 *   - 系统管理员（总管理）：不是负责人，不给改，给删
 * 服务端拒绝见 ent-followup-p3.test.ts。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/[id]/RecordView", () => ({ default: () => null }));

import type { ReactElement } from "react";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import CustomerPage from "@/app/(app)/customers/[id]/page";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, role: string, bizRole: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, name: key, email, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };

/** 在返回的元素树里找带某个属性的 props */
const 找 = <T,>(x: unknown, 有: string): T | null => {
  if (Array.isArray(x)) { for (const y of x) { const r = 找<T>(y, 有); if (r) return r; } return null; }
  const el = x as ReactElement<Record<string, unknown>> | null;
  if (!el || typeof el !== "object" || !("props" in el)) return null;
  if (有 in el.props) return el.props as T;
  if (el.props.p && typeof el.props.p === "object" && 有 in (el.props.p as object)) return el.props.p as T;
  return 找<T>(el.props.children, 有);
};

type 项目开关 = { 能记沟通?: boolean; 可改沟通?: boolean; 可删沟通?: boolean };
type 客户开关 = { 能改沟通?: boolean; 能删沟通?: boolean };
const 项目页 = async (u: 人, id: string) => {
  const r = 找<项目开关>(await 以(u, () => ProjectPage({ params: Promise.resolve({ id }) } as never)), "可改沟通");
  if (!r) throw new Error("页面没给 ProjectDetail");
  return { 能记沟通: !!r.能记沟通, 可改沟通: !!r.可改沟通, 可删沟通: !!r.可删沟通 };
};
const 客户页 = async (u: 人, id: string) => {
  const r = 找<客户开关>(await 以(u, () => CustomerPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never)), "能删沟通");
  if (!r) throw new Error("页面没给 RecordView");
  return { 能改沟通: !!r.能改沟通, 能删沟通: !!r.能删沟通 };
};

let 总管: 人;
const 搭 = async (owner: 人) => {
  const c = (await prisma.customer.create({ data: { name: "沟通权限客户", phone: "13900000001", salesOwnerId: owner.id } })).id;
  const p = (await prisma.project.create({ data: { name: "沟通权限项目", customerId: c, ownerId: owner.id, creatorId: owner.id, phase: "线索", node: "潜客培育" } })).id;
  忘掉企业版范围();
  return { c, p };
};

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  总管 = await 造人("director", "ADMIN", "director");
});
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

describe("M-权限-09 原口径：沟通的改、删入口", () => {
  it("销售负责人：客户页、项目页都不给改、删（还能记沟通）", async () => {
    const 销售 = await 造人("sales", "SALES", "sales");
    const { c, p } = await 搭(销售);
    expect(await 客户页(销售, c)).toEqual({ 能改沟通: false, 能删沟通: false });
    expect(await 项目页(销售, p)).toEqual({ 能记沟通: true, 可改沟通: false, 可删沟通: false });
  });

  it("渠运负责人：也不给", async () => {
    const 渠 = await 造人("chan", "SALES", "channel_ops");
    const { c, p } = await 搭(渠);
    expect(await 客户页(渠, c)).toEqual({ 能改沟通: false, 能删沟通: false });
    expect(await 项目页(渠, p)).toMatchObject({ 可改沟通: false, 可删沟通: false });
  });

  it("身为负责人的销售管理：两页都给改、删", async () => {
    const 销管 = await 造人("smgr", "SALES", "sales_mgr");
    const { c, p } = await 搭(销管);
    expect(await 客户页(销管, c)).toEqual({ 能改沟通: true, 能删沟通: true });
    expect(await 项目页(销管, p)).toEqual({ 能记沟通: true, 可改沟通: true, 可删沟通: true });
  });

  it("系统管理员（不是负责人）：不给改，给删", async () => {
    const 销售 = await 造人("sales", "SALES", "sales");
    const { c, p } = await 搭(销售);
    expect(await 客户页(总管, c)).toEqual({ 能改沟通: false, 能删沟通: true });
    expect(await 项目页(总管, p)).toMatchObject({ 可改沟通: false, 可删沟通: true });
  });
});
