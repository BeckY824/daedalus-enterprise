/**
 * 企业版业务角色可多选（10-27 会议：一个人兼销售管理和市场管理之类）。不加字段：EntMember.bizRole 存逗号串。
 * 钉的是：
 *   拆 / 合：按固定顺序、去重、丢掉不认识的；老数据单值照读；
 *   兼几类管理员的，几类的权都有（改设置、分配、改参与、用分配方式、字段权限取最宽、接手、提成更正）；
 *   设成员：数组和逗号串都收，空的、不认识的拦，非老板加不了总管级，存规整串，留「角色 → A、B」；
 *   开关关闭：设成员一律拦，一行不写。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 拆角色, 合角色, 建组织, 管理员类别们of, 管理员类别of, type 组织 } from "@/lib/enterprise/org-core";
import { 能改设置, 能改时限的节点 } from "@/lib/enterprise/edit-perm-table";
import { 能分配, 能改参与, 接手问题 } from "@/lib/enterprise/lead-assign";
import { 能用分配方式, 分配方式id } from "@/lib/enterprise/assign-use";
import { 字段权限of, 字段权限key } from "@/lib/enterprise/field-perm";
import { 能更正提成, 能改提成比例 } from "@/lib/project/commission-db";
import { 设成员 } from "@/app/(app)/settings/org-actions";

const 组 = (rows: [string, string][]): 组织 =>
  建组织(
    rows.map(([id]) => ({ id, role: "SALES", active: true })),
    rows.map(([userId, bizRole]) => ({ userId, deptId: null, bizRole, line: null, managerId: null, dottedManagerId: null })),
    [],
  );
const 我 = (id: string) => ({ id, role: "SALES" });

describe("拆 / 合", () => {
  it("按固定顺序、去重、丢掉不认识的；空的是空", () => {
    expect(拆角色("marketing_mgr, sales,sales,xx,")).toEqual(["sales", "marketing_mgr"]);
    expect(拆角色("sales")).toEqual(["sales"]);
    expect(拆角色(null)).toEqual([]);
    expect(拆角色("")).toEqual([]);
    expect(合角色(["marketing_mgr", "sales_mgr", "marketing_mgr", "瞎填"])).toBe("sales_mgr,marketing_mgr");
  });
  it("建组织：老数据单值照读；逗号串拆开，主角色是排第一的；全不认识的按账号角色推", () => {
    const org = 建组织(
      [{ id: "a", role: "SALES", active: true }, { id: "b", role: "SALES", active: true }, { id: "c", role: "MANAGER", active: true }],
      [
        { userId: "a", deptId: null, bizRole: "sales", line: null, managerId: null, dottedManagerId: null },
        { userId: "b", deptId: null, bizRole: "marketing_mgr,sales_mgr", line: null, managerId: null, dottedManagerId: null },
        { userId: "c", deptId: null, bizRole: "乱码", line: null, managerId: null, dottedManagerId: null },
      ],
      [],
    );
    expect(org.成员.get("a")).toMatchObject({ bizRole: "sales", 角色们: ["sales"] });
    expect(org.成员.get("b")).toMatchObject({ bizRole: "sales_mgr", 角色们: ["sales_mgr", "marketing_mgr"] });
    expect(org.成员.get("c")!.角色们).toHaveLength(1);
  });
});

describe("兼几类管理员，几类的权都有", () => {
  const org = 组([["兼", "sales_mgr,marketing_mgr"], ["销管", "sales_mgr"], ["市场", "marketing_mgr"], ["总兼销", "sales,director"], ["销", "sales"], ["销兼运", "sales,project_ops"]]);

  it("类别：几类都算；最高的那类按 总管理员 > 销售管理 > 市场管理", () => {
    expect([...管理员类别们of(org, "兼")].sort()).toEqual(["市场管理", "销售管理"].sort());
    expect(管理员类别of(org, "兼")).toBe("销售管理");
    expect(管理员类别of(org, "总兼销")).toBe("总管理员");
    expect(管理员类别们of(org, "销兼运").size).toBe(0);
  });

  it("改设置：字典默认只给总管理员；持有上限默认给销售管理；兼的人两边都按并集", () => {
    const 配置 = { 字典: ["市场管理"] as const, 持有上限: ["销售管理"] as const } as unknown as Parameters<typeof 能改设置>[3];
    expect(能改设置(org, 我("兼"), "字典", 配置)).toBe(true);
    expect(能改设置(org, 我("兼"), "持有上限", 配置)).toBe(true);
    expect(能改设置(org, 我("销管"), "字典", 配置)).toBe(false);
    expect(能改设置(org, 我("市场"), "持有上限", 配置)).toBe(false);
    expect(能改设置(org, 我("总兼销"), "字段权限", {})).toBe(true);
    expect(能改设置(org, 我("销"), "字段权限", {})).toBe(false);
    // 节点时限：销售管理只能改潜客培育，市场管理能改潜客培育和线索验证；兼的取并集，兼总管的全部
    expect([...能改时限的节点(org, 我("兼"), {})].sort()).toEqual(["潜客培育", "线索验证"].sort());
    expect(能改时限的节点(org, 我("销管"), {})).toEqual(["潜客培育"]);
    expect(能改时限的节点(org, 我("总兼销"), {})).toBe("全部");
  });

  it("分配（总管理员、市场管理）和改参与（总管理员、销售管理）：兼的两样都能", () => {
    expect([能分配(org, 我("兼")), 能改参与(org, 我("兼"))]).toEqual([true, true]);
    expect([能分配(org, 我("销管")), 能改参与(org, 我("销管"))]).toEqual([false, true]);
    expect([能分配(org, 我("市场")), 能改参与(org, 我("市场"))]).toEqual([true, false]);
    expect([能分配(org, 我("销兼运")), 能改参与(org, 我("销兼运"))]).toEqual([false, false]);
  });

  it("分配方式：哪个角色能用都算（个人自拓给销售、自动给市场）", () => {
    expect(能用分配方式(org, 我("兼"), 分配方式id.个人自拓, {})).toBe(true);
    expect(能用分配方式(org, 我("兼"), 分配方式id.自动, {})).toBe(true);
    expect(能用分配方式(org, 我("销管"), 分配方式id.自动, {})).toBe(false);
    expect(能用分配方式(org, 我("市场"), 分配方式id.个人自拓, {})).toBe(false);
    expect(能用分配方式(org, 我("销兼运"), 分配方式id.个人自拓, {})).toBe(true);
  });

  it("接手线索：兼着销售的能接；只有市场管理的不能", () => {
    expect(接手问题(org, "销兼运", null)).toBeNull();
    expect(接手问题(org, "兼", null)).toBeNull();
    expect(接手问题(org, "市场", null)).toBe("线索只能分给销售或销售管理");
  });

  it("提成：兼着总管（director）的能更正、能改比例；只有销售管理的不能", () => {
    expect([能更正提成(我("总兼销"), org), 能改提成比例(我("总兼销"), org)]).toEqual([true, true]);
    expect([能更正提成(我("兼"), org), 能改提成比例(我("兼"), org)]).toEqual([false, false]);
  });
});

let 老板: string, 总管: string, 销售: string, 双: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 行 = (userId: string) => prisma.entMember.findUnique({ where: { userId } });
const 记录 = () => prisma.auditLog.findMany({ orderBy: { at: "asc" }, select: { summary: true } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.企业版 = true;
  const 建人 = async (email: string, name: string, role: string) => (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
  老板 = await 建人("boss", "老板", "ADMIN");
  总管 = await 建人("dir", "总管", "SALES");
  销售 = await 建人("s1", "小王", "SALES");
  双 = await 建人("s2", "小张", "SALES");
  await prisma.entMember.createMany({ data: [{ userId: 总管, bizRole: "director" }, { userId: 销售, bizRole: "sales" }, { userId: 双, bizRole: "sales,marketing_mgr" }] });
  当(老板, "ADMIN");
});

describe("设成员：多选", () => {
  it("数组、逗号串都收；存规整串；留一条「角色 → A、B」", async () => {
    expect(await 设成员(销售, { bizRole: ["marketing_mgr", "sales_mgr", "sales_mgr"] })).toEqual({ ok: true });
    expect((await 行(销售))!.bizRole).toBe("sales_mgr,marketing_mgr");
    expect(await 设成员(销售, { bizRole: "project_ops,sales" })).toEqual({ ok: true });
    expect((await 行(销售))!.bizRole).toBe("sales,project_ops");
    const 话 = (await 记录()).map((r) => r.summary).join("\n");
    expect(话).toContain("角色 → 销售管理、市场管理");
  });

  it("空的、不认识的都拦，库不变", async () => {
    expect(await 设成员(销售, { bizRole: [] })).toEqual({ ok: false, error: "至少要有一个角色" });
    expect(await 设成员(销售, { bizRole: "" })).toEqual({ ok: false, error: "至少要有一个角色" });
    expect(await 设成员(销售, { bizRole: ["sales", "boss"] })).toEqual({ ok: false, error: "没有这个角色" });
    expect((await 行(销售))!.bizRole).toBe("sales");
  });

  it("总管理员给别人加不了总管级；也改不了兼着总管级的人", async () => {
    当(总管);
    expect(await 设成员(销售, { bizRole: ["sales", "director"] })).toMatchObject({ ok: false });
    expect(await 设成员(销售, { bizRole: ["sales", "marketing_mgr"] })).toEqual({ ok: true });
    await prisma.entMember.update({ where: { userId: 双 }, data: { bizRole: "sales,admin" } });
    expect(await 设成员(双, { bizRole: ["sales"] })).toMatchObject({ ok: false });
    expect((await 行(双))!.bizRole).toBe("sales,admin");
    expect((await 行(销售))!.bizRole).toBe("sales,marketing_mgr");
  });

  it("只改部门不带角色：兼的角色原样留着", async () => {
    expect(await 设成员(双, { line: "外贸" })).toEqual({ ok: true });
    expect(await 行(双)).toMatchObject({ bizRole: "sales,marketing_mgr", line: "外贸" });
  });

  it("没登记过的人第一次设多选：新建一行", async () => {
    const 新 = (await prisma.user.create({ data: { email: "n", name: "新人", title: "", role: "SALES", password: "x" } })).id;
    expect(await 设成员(新, { bizRole: ["sales", "channel_ops"] })).toEqual({ ok: true });
    expect((await 行(新))!.bizRole).toBe("sales,channel_ops");
  });
});

describe("字段权限：兼几个角色取最宽", () => {
  it("销售看不到电话、市场管理能改：兼的人能改；只做销售的看不到", async () => {
    await setSetting(规则.字段权限.key, true);
    await setSetting(字段权限key, { 电话: { sales: "藏" }, 跟进状态: { sales: "看", marketing_mgr: "藏" } });
    const 兼 = await 字段权限of(双), 单 = await 字段权限of(销售);
    expect([兼("电话"), 兼("跟进状态")]).toEqual(["改", "看"]);
    expect([单("电话"), 单("跟进状态")]).toEqual(["藏", "看"]);
  });
});

describe("开关关闭", () => {
  it("设成员一律拦，一行不写", async () => {
    mocks.企业版 = false;
    expect(await 设成员(销售, { bizRole: ["sales", "marketing_mgr"] })).toMatchObject({ ok: false });
    expect((await 行(销售))!.bizRole).toBe("sales");
    expect(await 记录()).toEqual([]);
  });
});
