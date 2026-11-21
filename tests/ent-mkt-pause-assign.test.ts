/**
 * 市场管理也能把销售设成「暂停 / 允许参与自动分配」（客户 11-21 选 A）：
 *   - 市场管理（marketing_mgr）能在允许 ↔ 暂停之间拨，对象是能接线索的人（销售、销售管理，同系统管理员那张表）；
 *   - 「禁止」仍只给系统管理员：市场管理不能设禁止，也不能把已经禁止的人改回允许 / 暂停；
 *   - 销售、销售管理、渠运、设了「只看某人」的市场管理都不能改；系统管理员三态照旧；
 *   - 每次改都留操作记录：谁（userName）、何时（at）、对谁（entityId + 名字）、原 → 新；
 *   - 别的后台设置照旧不给市场管理（规则开关、各条线部门、不设配额、组织架构），设置页只多「线索分配」一栏（settings-scope 只个人不变）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { setSetting, getSetting } from "@/lib/settings";
import { resetDb } from "./reset";
import { 设自动分配参与, 本月分配情况, 设不设配额, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { 设规则, 建部门 } from "@/app/(app)/settings/org-actions";
import { 自动分配不参与key, 起算时刻key, 参与改动挡, 参与可选, 不设配额key } from "@/lib/enterprise/lead-assign";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { 读组织 } from "@/lib/enterprise/org";
import { 设置范围of } from "@/lib/enterprise/settings-scope";
import { 规则 } from "@/lib/enterprise/rules";

let 老板: string, 市场: string, 市场兼渠运: string, 销管: string, 销售: string, 销售乙: string, 渠运: string, 名字: Record<string, string>;

const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: 名字[id] }; };
const 存的 = () => getSetting(自动分配不参与key);
const 记录 = (entityId: string) => prisma.auditLog.findMany({ where: { entity: "EntLeadAssign", entityId }, orderBy: { at: "asc" } });

beforeEach(async () => {
  await resetDb();
  名字 = {};
  const 人 = async (email: string, name: string, role = "SALES") => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    名字[id] = name;
    return id;
  };
  老板 = await 人("boss", "老板", "ADMIN");
  市场 = await 人("mkt", "市场甲");
  市场兼渠运 = await 人("mkt2", "市场乙");
  销管 = await 人("smgr", "销管甲");
  销售 = await 人("s1", "销售甲");
  销售乙 = await 人("s2", "销售乙");
  渠运 = await 人("ops", "渠运甲");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板, bizRole: "director" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 市场兼渠运, bizRole: "marketing_mgr,channel_ops" },
      { userId: 销管, bizRole: "sales_mgr", line: "内贸" },
      { userId: 销售, bizRole: "sales", line: "内贸", managerId: 销管 },
      { userId: 销售乙, bizRole: "sales", line: "外贸" },
      { userId: 渠运, bizRole: "channel_ops" },
    ],
  });
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true);
  当(老板);
});

describe("市场管理拨暂停 / 允许", () => {
  it("市场管理能把销售、销售管理暂停、再恢复；恢复时记起算时刻（和系统管理员同一套）", async () => {
    当(市场);
    expect(await 设自动分配参与(销售, "暂停")).toEqual({ ok: true });
    expect(await 设自动分配参与(销管, "暂停")).toEqual({ ok: true });
    expect(await 存的()).toEqual({ [销售]: "暂停", [销管]: "暂停" });
    expect(await 设自动分配参与(销售, "允许")).toEqual({ ok: true });
    expect(await 存的()).toEqual({ [销管]: "暂停" });
    // 内贸销售管理第一次进池另有补记（assign-eta），这里只看销售那一条
    expect(Object.keys((await getSetting<Record<string, string>>(起算时刻key)) ?? {})).toContain(销售);
    // 兼渠运的市场管理按并集（P-判定-01）照样能拨
    当(市场兼渠运);
    expect(await 设自动分配参与(销管, "允许")).toEqual({ ok: true });
    expect(await 存的()).toEqual({});
  });

  it("市场管理不能设禁止；不能动已经禁止的人（改允许、改暂停都拦），存着的不变、不留痕", async () => {
    当(市场);
    expect(await 设自动分配参与(销售, "禁止")).toMatchObject({ ok: false, error: expect.stringContaining("「禁止」只有系统管理员") });
    expect(await 设自动分配参与(销售, false)).toMatchObject({ ok: false, error: expect.stringContaining("「禁止」只有系统管理员") });
    expect(await 存的()).toBeNull();
    当(老板);
    expect(await 设自动分配参与(销售乙, "禁止")).toEqual({ ok: true });
    当(市场);
    for (const 新 of ["允许", "暂停", true] as const) {
      expect(await 设自动分配参与(销售乙, 新)).toMatchObject({ ok: false, error: expect.stringContaining("「禁止」只有系统管理员") });
    }
    expect(await 存的()).toEqual({ [销售乙]: "禁止" });
    expect((await 记录(销售乙)).map((a) => a.userName)).toEqual(["老板"]);
  });

  it("销售、销售管理、渠运不能改；设了「只看某人」的市场管理也不能", async () => {
    for (const who of [销售, 销管, 渠运]) {
      当(who);
      expect(await 设自动分配参与(销售乙, "暂停")).toMatchObject({ ok: false, error: expect.stringMatching(/^只有系统管理员、市场管理能改/) });
    }
    await setSetting(只看某人键, { [市场]: 销售 });
    当(市场);
    expect(await 设自动分配参与(销售乙, "暂停")).toMatchObject({ ok: false, error: expect.stringMatching(/^只有系统管理员、市场管理能改/) });
    expect(await 存的()).toBeNull();
    expect(await prisma.auditLog.count({ where: { entity: "EntLeadAssign" } })).toBe(0);
  });

  it("系统管理员不受影响：三态都能设，市场管理暂停的人他能改禁止、禁止的能解开", async () => {
    当(市场);
    await 设自动分配参与(销售, "暂停");
    当(老板);
    expect(await 设自动分配参与(销售, "禁止")).toEqual({ ok: true });
    expect(await 设自动分配参与(销售, "允许")).toEqual({ ok: true });
    expect(await 设自动分配参与(销售, "暂停")).toEqual({ ok: true });
    expect(await 存的()).toEqual({ [销售]: "暂停" });
  });

  it("每次改都留操作记录：谁、对谁、原 → 新", async () => {
    当(市场);
    await 设自动分配参与(销售, "暂停");
    await 设自动分配参与(销售, "暂停"); // 没变不重复留
    await 设自动分配参与(销售, "允许");
    const 记 = await 记录(销售);
    expect(记.map((a) => [a.userId, a.userName, a.action, a.summary])).toEqual([
      [市场, "市场甲", "update", "暂停 销售甲 参与自动分配（可随时恢复），原为允许"],
      [市场, "市场甲", "update", "恢复 销售甲 参与自动分配，原为暂停"],
    ]);
    expect(记.map((a) => JSON.parse(a.detail!))).toEqual([
      { 对象: "销售甲", 原: "允许", 参与: "暂停" },
      { 对象: "销售甲", 原: "暂停", 参与: "允许" },
    ]);
    expect(记.every((a) => a.at instanceof Date)).toBe(true);
  });

  it("只收能接线索的人：渠运、停用的不收", async () => {
    当(市场);
    expect(await 设自动分配参与(渠运, "暂停")).toMatchObject({ ok: false, error: expect.stringContaining("不是销售") });
  });
});

describe("设置页数据（本月分配情况）", () => {
  it("市场管理看全部能接的人；每行能选：允许 / 暂停，禁止的那行空；系统管理员三态；销售管理不能改", async () => {
    await 设自动分配参与(销售乙, "禁止");
    当(市场);
    const 行 = (await 本月分配情况())!;
    expect(行.map((r) => r.userId).sort()).toEqual([销管, 销售, 销售乙].sort());
    expect(行.find((r) => r.userId === 销售)).toMatchObject({ 能改参与: true, 参与可选: ["允许", "暂停"] });
    expect(行.find((r) => r.userId === 销售乙)).toMatchObject({ 参与状态: "禁止", 能改参与: false, 参与可选: [] });
    当(老板);
    expect((await 本月分配情况())!.every((r) => r.参与可选.length === 3)).toBe(true);
    当(销管);
    expect((await 本月分配情况())!.some((r) => r.能改参与)).toBe(false);
  });
});

describe("别的后台设置照旧不给市场管理", () => {
  it("规则开关、不设配额、各条线部门、组织架构都拒；设置页仍是只个人", async () => {
    当(市场);
    expect((await 设不设配额(false)).ok).toBe(false);
    expect((await 设线部门({ 内贸: [], 外贸: [] })).ok).toBe(false);
    expect((await 设规则(false, "线索分配")).ok).toBe(false);
    expect((await 建部门("新部门", null)).ok).toBe(false);
    expect(await getSetting(不设配额key)).toBe(true);
    expect(await prisma.entDept.count()).toBe(0);
    const org = await 读组织();
    expect(设置范围of({ id: 市场, role: "SALES" }, org, true)).toMatchObject({ 可看: false, 可改: false, 只个人: true });
  });
});

describe("参与改动挡 / 参与可选（纯判定）", () => {
  it("系统管理员三态随意；市场管理只允许 ↔ 暂停；别人一律不能", async () => {
    const org = await 读组织();
    const 我 = (id: string) => ({ id, role: "SALES" });
    expect(参与可选(org, 我(老板), "禁止")).toEqual(["允许", "暂停", "禁止"]);
    expect(参与可选(org, 我(市场), "允许")).toEqual(["允许", "暂停"]);
    expect(参与可选(org, 我(市场), "暂停")).toEqual(["允许", "暂停"]);
    expect(参与可选(org, 我(市场), "禁止")).toEqual([]);
    expect(参与可选(org, 我(销管), "允许")).toEqual([]);
    expect(参与改动挡(org, 我(市场), "暂停", "允许")).toBeNull();
    expect(参与改动挡(org, 我(市场), "允许", "禁止")).toContain("「禁止」只有系统管理员");
    expect(参与改动挡(org, 我(市场), "禁止", "允许")).toContain("「禁止」只有系统管理员");
  });
});
