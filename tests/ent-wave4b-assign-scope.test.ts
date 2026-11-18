/**
 * 11-18 审核第四波追加（权限 P1-6，口径 P-转-01）：分配线索 / 自动分配线索 / 批量自动分配 的范围上限。
 * 项目不在公海、不是待分配、负责人又不是我 = 改派别人名下的，要再过 能转让项目：
 *   - 拒：隔级下属、虚线下属、别线
 *   - 放：实线直属一级同线、条线总管理本线、系统管理员；市场管理分直属市场成员名下的（能转让名下）
 *   - 不加判：公海里的（走 线索公海挡）、待分配的、自己名下的
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/settings";
import { resetDb } from "./reset";
import { 分配线索, 自动分配线索, 批量自动分配, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { 不设配额key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";

const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };

let 老板: string, 外线总: string, 外贸管: string, 组长: string, 外一: string, 外二: string, 外三: string, 外四: string, 内贸管: string, 市场管: string, 市场员: string;
let 号 = 0;

const 建项目 = async (ownerId: string, 补: { awaitAssignAt?: Date } = {}) => {
  const c = (await prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId: ownerId } })).id;
  return (await prisma.project.create({ data: { name: `线索${号}`, customerId: c, ownerId, creatorId: ownerId, bizLine: "外贸", ...补 } })).id;
};
const 负责人 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;

beforeEach(async () => {
  await resetDb();
  const 部 = async (name: string, parentId: string | null = null) => (await prisma.entDept.create({ data: { name, parentId } })).id;
  const 外贸部 = await 部("外贸事业部");
  const 甲队 = await 部("甲队", 外贸部);
  const 乙队 = await 部("乙队", 外贸部);
  let 第几 = 0;
  const 人 = async (name: string, bizRole: string, 补: { deptId?: string | null; line?: string | null; managerId?: string | null; dottedManagerId?: string | null } = {}) => {
    第几++;
    const id = (await prisma.user.create({ data: { email: `${name}@x`, name, title: "", role: "SALES", password: "x", active: true, createdAt: new Date(2026, 0, 第几) } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, deptId: 补.deptId ?? null, line: 补.line ?? null, managerId: 补.managerId ?? null, dottedManagerId: 补.dottedManagerId ?? null } });
    return id;
  };
  老板 = await 人("老板", "director");
  外线总 = await 人("外线总", "director", { line: "外贸" });
  外贸管 = await 人("外贸管", "sales_mgr", { deptId: 外贸部, line: "外贸" });
  组长 = await 人("组长", "sales_mgr", { deptId: 甲队, line: "外贸", managerId: 外贸管 });
  外一 = await 人("外一", "sales", { deptId: 甲队, line: "外贸", managerId: 外贸管 });
  外二 = await 人("外二", "sales", { deptId: 乙队, line: "外贸", managerId: 组长 });
  外三 = await 人("外三", "sales", { deptId: 甲队, line: "外贸", dottedManagerId: 外贸管 });
  内贸管 = await 人("内贸管", "sales_mgr", { line: "内贸" });
  外四 = await 人("外四", "sales", { deptId: 乙队, line: "外贸", managerId: 内贸管 });
  市场管 = await 人("市场管", "marketing_mgr");
  市场员 = await 人("市场员", "channel_ops", { managerId: 市场管 });
  for (const k of [规则.按组织看客户.key, 规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  当(老板);
  expect(await 设线部门({ 内贸: [], 外贸: [甲队, 乙队] })).toEqual({ ok: true });
});

describe("别人名下的线索：改派要能转让这个项目（P-转-01）", () => {
  it("隔级下属名下的：销管指定 / 自动 / 批量都拒，负责人不变", async () => {
    const P = await 建项目(外二);
    当(外贸管);
    expect(await 分配线索({ projectId: P, toUserId: 外一, 原负责人: 外二 })).toMatchObject({ ok: false, error: expect.stringContaining("直属上级") });
    expect(await 自动分配线索(P, { 项目: true, 原负责人: 外二 })).toMatchObject({ ok: false });
    const r = await 批量自动分配([P], { 项目: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.结果[0]).toMatchObject({ ok: false });
    expect(await 负责人(P)).toBe(外二);
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("虚线下属名下的：拒（虚线只能看）", async () => {
    const P = await 建项目(外三);
    当(外贸管);
    expect(await 分配线索({ projectId: P, toUserId: 外一, 原负责人: 外三 })).toMatchObject({ ok: false });
    expect(await 负责人(P)).toBe(外三);
  });

  it("别线的直属下属名下的外贸线索：内贸销管拒", async () => {
    const P = await 建项目(外四);
    当(内贸管);
    expect(await 分配线索({ projectId: P, toUserId: 外一, 原负责人: 外四 })).toMatchObject({ ok: false });
    expect(await 负责人(P)).toBe(外四);
  });

  it("对照：直属一级同线照放", async () => {
    const P = await 建项目(外一);
    当(外贸管);
    expect(await 分配线索({ projectId: P, toUserId: 外三, 原负责人: 外一 })).toEqual({ ok: true });
    expect(await 负责人(P)).toBe(外三);
  });

  it("对照：条线总管理本线、系统管理员照放", async () => {
    const P = await 建项目(外二), Q = await 建项目(外三);
    当(外线总);
    expect(await 分配线索({ projectId: P, toUserId: 外一, 原负责人: 外二 })).toEqual({ ok: true });
    当(老板);
    expect(await 自动分配线索(Q, { 项目: true, 原负责人: 外三 })).toMatchObject({ ok: true });
  });

  it("对照：市场管理分直属市场成员名下的照放", async () => {
    const P = await 建项目(市场员);
    当(市场管);
    expect(await 分配线索({ projectId: P, toUserId: 外一, 原负责人: 市场员 })).toEqual({ ok: true });
    expect(await 负责人(P)).toBe(外一);
  });

  it("对照：待分配的（负责人只是建的人占着）不加判", async () => {
    const P = await 建项目(外三, { awaitAssignAt: new Date() });
    当(外贸管);
    expect(await 分配线索({ projectId: P, toUserId: 外一, 原负责人: 外三 })).toEqual({ ok: true });
    expect(await 负责人(P)).toBe(外一);
  });
});
