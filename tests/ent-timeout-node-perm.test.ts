/**
 * 节点时限按节点拆（10-27 批注，lib/enterprise/edit-perm-table.ts 时限可改节点 / 挡时限改动）。
 * 11-03 D3-7 ①：项目模式设置只给系统管理员——销售管理、市场管理、条线总管理一个节点都改不了（按节点拆的那张表留着不用）；
 * 交来的是整张天数表，没变的节点不算改；拦下一行不写；不是企业版照旧整块拦。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 改组织规则, 预览超时回收 } from "@/app/(app)/projects/actions";
import { 读组织规则 } from "@/lib/project/org-rules-store";
import { 默认三态规则 } from "@/lib/project/org-rules";
import { 读组织 } from "@/lib/enterprise/org";
import { 能改时限的节点, 挡时限改动 } from "@/lib/enterprise/edit-perm";

let 老板: string, 总管: string, 条线总管: string, 销售经理: string, 市场经理: string, 销售: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (email: string, name: string, role: string, bizRole?: string, line?: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole, line } });
    return id;
  };
  老板 = await 建人("boss", "老板", "ADMIN", "director");
  总管 = await 建人("dir", "总管", "SALES", "director");
  条线总管 = await 建人("ldir", "条线总管", "SALES", "director", "外贸");
  销售经理 = await 建人("sm", "销售经理", "SALES", "sales_mgr");
  市场经理 = await 建人("mm", "市场经理", "SALES", "marketing_mgr");
  销售 = await 建人("s1", "小王", "SALES", "sales");
  当(老板, "ADMIN");
  expect(await 改组织规则({ 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 7, 线索验证: 5, 明确需求: 10 } } })).toMatchObject({ ok: true });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("能改哪几个节点", () => {
  it("系统管理员全部；条线总管理、销售管理、市场管理、销售一个都没有，表里勾了也不算（11-03 D3-7 ①）", async () => {
    const org = await 读组织();
    const 人 = (id: string, role = "SALES") => ({ id, role });
    expect(能改时限的节点(org, 人(老板, "ADMIN"), { 节点时限: [] })).toBe("全部");
    expect(能改时限的节点(org, 人(总管), {})).toBe("全部");
    expect(能改时限的节点(org, 人(条线总管), {})).toEqual([]);
    expect(能改时限的节点(org, 人(销售经理), {})).toEqual([]);
    expect(能改时限的节点(org, 人(市场经理), { 节点时限: ["市场管理"] } as never)).toEqual([]);
    expect(能改时限的节点(org, 人(销售), {})).toEqual([]);
  });

  it("只比真变了的：整张表交来、别的节点原样不算；删掉别人的节点算改", () => {
    // 10-31 改名：交来 / 存着的旧节点名（明确需求）都按新名 痛点挖掘 比，报错写新名
    const 现在 = { 开: true, 节点天数: { 潜客培育: 7, 明确需求: 10 } };
    expect(挡时限改动(["潜客培育"], 现在, { 节点天数: { 潜客培育: 3, 明确需求: 10, 线索验证: null } })).toBeNull();
    expect(挡时限改动(["潜客培育"], 现在, { 节点天数: { 潜客培育: 3 } })).toMatch("「痛点挖掘」");
    expect(挡时限改动(["潜客培育"], 现在, { 节点天数: { 潜客培育: 7, 明确需求: "11" } })).toMatch("「痛点挖掘」由总管理员改");
    expect(挡时限改动(["潜客培育"], 现在, { 开: true })).toBeNull();
    expect(挡时限改动(["潜客培育"], 现在, { 开: false })).toBe("超时回收的开关只有总管理员能动");
    expect(挡时限改动("全部", 现在, { 开: false, 节点天数: {} })).toBeNull();
  });

  it("外贸那套（C7）同样按节点拦：能改的节点两套都能改，别的节点外贸也改不了；话里带「外贸」", () => {
    const 现在 = { 开: true, 节点天数: { 潜客培育: 7 }, 外贸节点天数: { 潜客培育: 14, 线索验证: 9 } };
    expect(挡时限改动(["潜客培育"], 现在, { 外贸节点天数: { 潜客培育: 20, 线索验证: 9 } })).toBeNull();
    expect(挡时限改动(["潜客培育"], 现在, { 外贸节点天数: { 潜客培育: 14, 线索验证: 3 } })).toBe("你只能改「潜客培育」的时限，外贸「线索验证」由总管理员改");
    expect(挡时限改动(["潜客培育"], 现在, { 外贸节点天数: { 潜客培育: 14 } })).toMatch("外贸「线索验证」"); // 删掉也算改
    expect(挡时限改动(["潜客培育"], { 开: true, 节点天数: {} }, { 外贸节点天数: { 痛点挖掘: 5 } })).toMatch("外贸「痛点挖掘」");
    expect(挡时限改动([], 现在, { 外贸节点天数: { 潜客培育: 1 } })).toBe("外贸「潜客培育」的时限你改不了");
    expect(挡时限改动("全部", 现在, { 外贸节点天数: {} })).toBeNull();
  });

  it("起算日（10-31）：真改了只给全权的人；没变（含 null 和空串）不拦", () => {
    const 现在 = { 开: true, 节点天数: { 潜客培育: 7 }, 起算日: "2026-11-01" };
    expect(挡时限改动(["潜客培育"], 现在, { 起算日: "2026-12-01" })).toBe("超时回收的起算日只有总管理员能动");
    expect(挡时限改动(["潜客培育"], 现在, { 起算日: null })).toBe("超时回收的起算日只有总管理员能动");
    expect(挡时限改动(["潜客培育"], 现在, { 起算日: "2026-11-01" })).toBeNull();
    expect(挡时限改动(["潜客培育"], { ...现在, 起算日: null }, { 起算日: "" })).toBeNull();
    expect(挡时限改动("全部", 现在, { 起算日: null })).toBeNull();
  });
});

describe("改组织规则按节点拦", () => {
  const 整张 = (改: Record<string, number | null>) => ({ 超时回收: { 节点天数: { 潜客培育: 7, 线索验证: 5, 明确需求: 10, ...改 } } });

  it("销售管理、市场管理、条线总管理改哪个节点都拦，拦下不写（11-03 D3-7 ①）", async () => {
    for (const 谁 of [销售经理, 市场经理, 条线总管]) {
      当(谁);
      expect(await 改组织规则(整张({ 潜客培育: 3 }))).toMatchObject({ ok: false });
      expect(await 改组织规则({ 超时回收: { 外贸节点天数: { 潜客培育: 12 } } })).toMatchObject({ ok: false });
      expect(await 预览超时回收(整张({ 潜客培育: 2 }))).toMatchObject({ ok: false });
      expect(await 改组织规则({ 超时回收: { 开: false } })).toMatchObject({ ok: false });
    }
    expect((await 读组织规则()).超时回收).toEqual({ 开: true, 起算日: null, 节点天数: { 潜客培育: 7, 线索验证: 5, 痛点挖掘: 10 }, 外贸节点天数: {} });
  });

  it("系统管理员全能改、能关、能改起算日和外贸那套", async () => {
    当(总管);
    expect(await 改组织规则(整张({ 潜客培育: 4, 线索验证: null, 明确需求: 9 }))).toEqual({ ok: true, 收回: 0 });
    expect(await 改组织规则({ 超时回收: { 外贸节点天数: { 潜客培育: 12, 线索验证: 6, 明确需求: 20 } } })).toEqual({ ok: true, 收回: 0 });
    expect(await 改组织规则({ 超时回收: { 开: false } })).toEqual({ ok: true, 收回: 0 });
    expect(await 改组织规则({ 超时回收: { 起算日: "2026-12-01" } })).toEqual({ ok: true, 收回: 0 });
    expect((await 读组织规则()).超时回收).toEqual({ 开: false, 起算日: "2026-12-01", 节点天数: { 潜客培育: 4, 痛点挖掘: 9 }, 外贸节点天数: { 潜客培育: 12, 线索验证: 6, 痛点挖掘: 20 } });
  });

  it("不是企业版：组织规则整块不能改（照旧）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    当(老板, "ADMIN");
    expect(await 改组织规则(整张({ 潜客培育: 1 }))).toMatchObject({ ok: false, error: "组织规则是企业版的功能" });
  });
});

describe("改客户三态规则（M-公海-20：只有系统管理员；M-公海-31：改前改后值留在操作日志）", () => {
  it("条线总管理、销售管理、市场管理、销售都改不了，拦下不写、不留日志", async () => {
    for (const 谁 of [条线总管, 销售经理, 市场经理, 销售]) {
      当(谁);
      expect(await 改组织规则({ 三态: { 开: true } })).toEqual({ ok: false, error: "客户三态规则只有系统管理员能改" });
      expect(await 改组织规则({ 三态: { 转让归零: { 次数: 5 } } })).toMatchObject({ ok: false });
    }
    expect((await 读组织规则()).三态).toEqual(默认三态规则);
    expect(await prisma.auditLog.count({ where: { summary: { contains: "客户三态" } } })).toBe(0);
  });

  it("系统管理员能改：存上、别的规则不动；日志摘要带改前 → 改后，再改一次带的是上一次的值", async () => {
    当(总管);
    expect(await 改组织规则({ 三态: { 开: true, 成交: { 沉睡: 400, 待回收: 500 } } })).toEqual({ ok: true, 收回: 0 });
    expect(await 改组织规则({ 三态: { 成交: { 沉睡: 365 }, 继续持有: { 累计次数: 4, 累计天数: 120 } } })).toEqual({ ok: true, 收回: 0 });
    const 规则 = await 读组织规则();
    expect(规则.三态).toEqual({ ...默认三态规则, 开: true, 成交: { 沉睡: 365, 待回收: 500, 进公海: 30 }, 继续持有: { 每次天数: 30, 累计次数: 4, 累计天数: 120 } });
    expect(规则.超时回收).toMatchObject({ 开: true, 节点天数: { 潜客培育: 7, 线索验证: 5, 痛点挖掘: 10 } });
    const 日志 = await prisma.auditLog.findMany({ where: { entity: "Setting", entityId: "orgRules", summary: { contains: "客户三态" } }, orderBy: { at: "asc" }, select: { summary: true, userId: true } });
    expect(日志.map((x) => x.summary)).toEqual([
      "组织规则：客户三态开，开关 关 → 开，成交客户进沉睡的天数 365 → 400，成交客户进待回收的天数 455 → 500",
      "组织规则：客户三态开，成交客户进沉睡的天数 400 → 365，继续持有累计次数 3 → 4，继续持有累计天数 90 → 120",
    ]);
    expect(日志.every((x) => x.userId === 总管)).toBe(true);
  });

  it("填错的报出来、不写、不留日志", async () => {
    当(总管);
    expect(await 改组织规则({ 三态: { 内贸: { 沉睡: 180 } } })).toEqual({ ok: false, error: "内贸客户进待回收的天数要大于进沉睡的天数" });
    expect((await 读组织规则()).三态).toEqual(默认三态规则);
    expect(await prisma.auditLog.count({ where: { summary: { contains: "客户三态" } } })).toBe(0);
  });
});

