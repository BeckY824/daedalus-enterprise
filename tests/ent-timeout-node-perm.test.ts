/**
 * 节点时限按节点拆（10-27 批注，lib/enterprise/edit-perm-table.ts 时限可改节点 / 挡时限改动）。
 * 钉的是：销售管理只改潜客培育，市场管理改潜客培育 + 线索验证，总管理员和老板全部、开关也只有他们能动；
 * 交来的是整张天数表，没变的节点不算改；拦下一行不写；不是企业版照旧整块拦。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 改组织规则, 预览超时回收 } from "@/app/(app)/projects/actions";
import { 读组织规则 } from "@/lib/project/org-rules-store";
import { 读组织 } from "@/lib/enterprise/org";
import { 能改时限的节点, 挡时限改动 } from "@/lib/enterprise/edit-perm";

let 老板: string, 总管: string, 销售经理: string, 市场经理: string, 销售: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (email: string, name: string, role: string, bizRole?: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 建人("boss", "老板", "ADMIN");
  总管 = await 建人("dir", "总管", "SALES", "director");
  销售经理 = await 建人("sm", "销售经理", "SALES", "sales_mgr");
  市场经理 = await 建人("mm", "市场经理", "SALES", "marketing_mgr");
  销售 = await 建人("s1", "小王", "SALES", "sales");
  当(老板, "ADMIN");
  expect(await 改组织规则({ 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 7, 线索验证: 5, 明确需求: 10 } } })).toMatchObject({ ok: true });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("能改哪几个节点", () => {
  it("老板、总管理员全部；销售管理潜客培育；市场管理潜客培育 + 线索验证；不在表里的一个都没有", async () => {
    const org = await 读组织();
    const 人 = (id: string, role = "SALES") => ({ id, role });
    expect(能改时限的节点(org, 人(老板, "ADMIN"), { 节点时限: [] })).toBe("全部");
    expect(能改时限的节点(org, 人(总管), {})).toBe("全部");
    expect(能改时限的节点(org, 人(销售经理), {})).toEqual(["潜客培育"]);
    expect(能改时限的节点(org, 人(市场经理), {})).toEqual(["潜客培育", "线索验证"]);
    expect(能改时限的节点(org, 人(销售), {})).toEqual([]);
    // 「谁能改」表里把市场管理去掉，按节点拆也就没有了
    expect(能改时限的节点(org, 人(市场经理), { 节点时限: ["总管理员"] })).toEqual([]);
  });

  it("只比真变了的：整张表交来、别的节点原样不算；删掉别人的节点算改", () => {
    const 现在 = { 开: true, 节点天数: { 潜客培育: 7, 明确需求: 10 } };
    expect(挡时限改动(["潜客培育"], 现在, { 节点天数: { 潜客培育: 3, 明确需求: 10, 线索验证: null } })).toBeNull();
    expect(挡时限改动(["潜客培育"], 现在, { 节点天数: { 潜客培育: 3 } })).toMatch("「明确需求」");
    expect(挡时限改动(["潜客培育"], 现在, { 节点天数: { 潜客培育: 7, 明确需求: "11" } })).toMatch("「明确需求」由老板、总管理员改");
    expect(挡时限改动(["潜客培育"], 现在, { 开: true })).toBeNull();
    expect(挡时限改动(["潜客培育"], 现在, { 开: false })).toBe("超时回收的开关只有老板、总管理员能动");
    expect(挡时限改动("全部", 现在, { 开: false, 节点天数: {} })).toBeNull();
  });

  it("起算日（10-31）：真改了只给全权的人；没变（含 null 和空串）不拦", () => {
    const 现在 = { 开: true, 节点天数: { 潜客培育: 7 }, 起算日: "2026-11-01" };
    expect(挡时限改动(["潜客培育"], 现在, { 起算日: "2026-12-01" })).toBe("超时回收的起算日只有老板、总管理员能动");
    expect(挡时限改动(["潜客培育"], 现在, { 起算日: null })).toBe("超时回收的起算日只有老板、总管理员能动");
    expect(挡时限改动(["潜客培育"], 现在, { 起算日: "2026-11-01" })).toBeNull();
    expect(挡时限改动(["潜客培育"], { ...现在, 起算日: null }, { 起算日: "" })).toBeNull();
    expect(挡时限改动("全部", 现在, { 起算日: null })).toBeNull();
  });
});

describe("改组织规则按节点拦", () => {
  const 整张 = (改: Record<string, number | null>) => ({ 超时回收: { 节点天数: { 潜客培育: 7, 线索验证: 5, 明确需求: 10, ...改 } } });

  it("销售管理能改潜客培育，改线索验证、商机节点、开关都拦，拦下不写", async () => {
    当(销售经理);
    expect(await 改组织规则(整张({ 潜客培育: 3 }))).toEqual({ ok: true, 收回: 0 });
    expect((await 读组织规则()).超时回收.节点天数.潜客培育).toBe(3);
    expect(await 改组织规则(整张({ 潜客培育: 3, 线索验证: 2 }))).toMatchObject({ ok: false, error: "你只能改「潜客培育」的时限，「线索验证」由老板、总管理员改" });
    expect(await 预览超时回收(整张({ 明确需求: 2 }))).toMatchObject({ ok: false });
    expect(await 改组织规则({ 超时回收: { 开: false } })).toMatchObject({ ok: false, error: "超时回收的开关只有老板、总管理员能动" });
    const 规则 = (await 读组织规则()).超时回收;
    expect(规则).toEqual({ 开: true, 起算日: null, 节点天数: { 潜客培育: 3, 线索验证: 5, 明确需求: 10 } });
    // 起算日（10-31）和开关一样只给老板、总管理员
    expect(await 改组织规则({ 超时回收: { 起算日: "2026-12-01" } })).toMatchObject({ ok: false, error: "超时回收的起算日只有老板、总管理员能动" });
    expect((await 读组织规则()).超时回收.起算日).toBeNull();
  });

  it("市场管理能改潜客培育、线索验证，商机节点拦；总管理员全能改、能关", async () => {
    当(市场经理);
    expect(await 改组织规则(整张({ 潜客培育: 4, 线索验证: null }))).toEqual({ ok: true, 收回: 0 });
    expect(await 改组织规则(整张({ 潜客培育: 4, 线索验证: null, 明确需求: 9 }))).toMatchObject({ ok: false, error: expect.stringContaining("「明确需求」") });
    当(总管);
    expect(await 改组织规则(整张({ 潜客培育: 4, 线索验证: null, 明确需求: 9 }))).toEqual({ ok: true, 收回: 0 });
    expect(await 改组织规则({ 超时回收: { 开: false } })).toEqual({ ok: true, 收回: 0 });
    expect((await 读组织规则()).超时回收).toEqual({ 开: false, 起算日: null, 节点天数: { 潜客培育: 4, 明确需求: 9 } });
    expect(await 改组织规则({ 超时回收: { 起算日: "2026-12-01" } })).toEqual({ ok: true, 收回: 0 });
    expect((await 读组织规则()).超时回收.起算日).toBe("2026-12-01");
  });

  it("不是企业版：组织规则整块不能改（照旧）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    当(老板, "ADMIN");
    expect(await 改组织规则(整张({ 潜客培育: 1 }))).toMatchObject({ ok: false, error: "组织规则是企业版的功能" });
  });
});
