/**
 * 企业版「新增成员」当场给业务角色（11-19：新增时没有「销售教练」可选）。界面见 ent-coach-new-member.ui.test.ts。
 *
 * 钉的是：
 *   - 系统管理员新增教练：账号和 EntMember 一起落，审计写清角色；教练兼只读管理员能建；
 *   - 教练兼销售类、只读管理员兼销售：服务端 saveUser 拒（同 设成员 的 角色组合问题），一行不写；
 *   - 不是系统管理员（条线总管、勾了「不管设置」的总管理、只读管理员）：FORBIDDEN，一行不写；
 *   - 编辑已有成员不收业务角色（改角色只走组织架构）；
 *   - 新增出来的教练和「先建再到组织架构里改成教练」的，权限判定一样（只读、不当负责人、电话打码、设置只个人）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveUser } from "@/app/(app)/settings/actions";
import { 设成员 } from "@/app/(app)/settings/org-actions";
import { 读组织 } from "@/lib/enterprise/org";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 只读角色, 是教练, 能看全部, 能当负责人, 能新建和领取, 能进设置, 只读话of } from "@/lib/enterprise/permissions";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 字段权限of } from "@/lib/enterprise/field-perm";
import { 设置范围of } from "@/lib/enterprise/settings-scope";
import { 业务角色选项 } from "@/app/(app)/settings/BizRoleSelect";

let 系统: string, 条线总管: string, 不管设置: string, 只读: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 新 = (email: string, 业务角色?: string[]) => ({ name: email, email, title: "", role: "SALES", active: true, password: "pass12345", 业务角色 });
const 角色of = async (email: string) => {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return u ? ((await prisma.entMember.findUnique({ where: { userId: u.id } }))?.bizRole ?? "") : null;
};

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 建人 = async (email: string, bizRole: string, x: { line?: string | null; noSettings?: boolean } = {}) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line: x.line ?? null, noSettings: !!x.noSettings } });
    return id;
  };
  系统 = await 建人("sys", "director");
  条线总管 = await 建人("linedir", "director", { line: "外贸" });
  不管设置 = await 建人("nosettings", "director", { noSettings: true });
  只读 = await 建人("adm", "admin");
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

describe("系统管理员新增", () => {
  it("新增销售教练：账号和业务角色一起落，审计写清角色", async () => {
    当(系统);
    expect(await saveUser(新("coach1", ["coach"]))).toMatchObject({ ok: true });
    expect(await 角色of("coach1")).toBe("coach");
    const 审 = await prisma.auditLog.findFirst({ where: { entity: "User", action: "create" }, orderBy: { at: "desc" } });
    expect(审?.summary).toContain("业务角色：销售教练");
    // 审计记下新人是谁：entityId = 新建出来的那条 user.id
    const 新人 = await prisma.user.findUniqueOrThrow({ where: { email: "coach1" }, select: { id: true } });
    expect(审?.entityId).toBe(新人.id);
  });

  it("教练兼只读管理员、兼总管理能建；不选业务角色照旧能建（不建 EntMember 行）", async () => {
    当(系统);
    expect(await saveUser(新("coachadm", ["coach", "admin"]))).toMatchObject({ ok: true });
    expect(await 角色of("coachadm")).toBe("admin,coach");
    expect(await saveUser(新("coachdir", ["director", "coach"]))).toMatchObject({ ok: true });
    expect(await 角色of("coachdir")).toBe("director,coach");
    expect(await saveUser(新("plain", []))).toMatchObject({ ok: true });
    expect(await 角色of("plain")).toBe("");
    expect(await saveUser(新("plain2"))).toMatchObject({ ok: true });
    expect(await 角色of("plain2")).toBe("");
    // 不带业务角色的新建：审计 entityId 也记新人
    const plain2 = await prisma.user.findUniqueOrThrow({ where: { email: "plain2" }, select: { id: true } });
    expect((await prisma.auditLog.findFirst({ where: { entity: "User", action: "create", entityId: plain2.id } }))?.summary).toContain("新建成员「plain2」");
  });

  it("教练兼销售类、只读管理员兼销售、乱填的角色：拒，一行不写", async () => {
    当(系统);
    for (const r of ["sales", "sales_mgr", "channel_ops", "marketing_mgr", "project_ops"]) {
      const res = await saveUser(新(`bad-${r.replace("_", "-")}`, ["coach", r]));
      expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/销售教练不能兼.*分两个账号/) });
    }
    expect(await saveUser(新("bad-adm", ["admin", "sales"]))).toMatchObject({ ok: false, error: "只读管理员不兼其他业务角色" });
    expect(await saveUser(新("bad-x", ["boss"]))).toMatchObject({ ok: false, error: "没有这个角色" });
    expect(await prisma.user.count({ where: { email: { startsWith: "bad-" } } })).toBe(0);
  });

  it("编辑已有成员不收业务角色：改角色走组织架构", async () => {
    当(系统);
    expect(await saveUser({ ...新("adm", ["coach"]), id: 只读, password: null })).toMatchObject({ ok: false, error: expect.stringContaining("组织架构") });
    expect(await 角色of("adm")).toBe("admin");
  });
});

describe("导入来的登录名（@import.invalid）", () => {
  it("编辑时登录名原样可存、改成另一个不合法的拒、新增用不合法的拒", async () => {
    当(系统);
    const id = (await prisma.user.create({ data: { email: "xx@import.invalid", name: "导入人", title: "", role: "SALES", password: "x" } })).id;
    const 改 = { name: "导入人", email: "xx@import.invalid", title: "销售总监", role: "SALES", active: true, password: null, id };
    expect(await saveUser(改)).toMatchObject({ ok: true });
    expect(await prisma.user.findUnique({ where: { id } })).toMatchObject({ email: "xx@import.invalid", title: "销售总监" });
    expect(await saveUser({ ...改, email: "yy@import.invalid" })).toMatchObject({ ok: false, error: expect.stringContaining("2–32") });
    expect((await prisma.user.findUnique({ where: { id } }))?.email).toBe("xx@import.invalid");
    expect(await saveUser({ ...新("zz@import.invalid") })).toMatchObject({ ok: false, error: expect.stringContaining("2–32") });
    expect(await prisma.user.count({ where: { email: "zz@import.invalid" } })).toBe(0);
  });
});

describe("不是系统管理员", () => {
  it("条线总管、勾了「不管设置」的总管理、只读管理员：新增教练 FORBIDDEN，一行不写", async () => {
    for (const id of [条线总管, 不管设置, 只读]) {
      当(id);
      await expect(saveUser(新("nocoach", ["coach"]))).rejects.toThrow("FORBIDDEN");
    }
    expect(await prisma.user.count({ where: { email: "nocoach" } })).toBe(0);
  });

  it("下拉：不能给总管级的人选项里没有销售教练、总管理、管理员（同组织架构那一格）", () => {
    const 名 = 业务角色选项([], false).map((o) => o.value);
    expect(名).not.toContain("coach");
    expect(名).not.toContain("director");
    expect(名).not.toContain("admin");
    expect(业务角色选项([], true).map((o) => o.value)).toContain("coach");
  });
});

describe("下拉灰掉的规则和服务端同一份", () => {
  it("选了教练：销售类灰掉、说明换成原因；总管理、管理员不灰。选了销售：教练灰掉", () => {
    const 教 = new Map(业务角色选项(["coach"], true).map((o) => [o.value, o]));
    for (const r of ["sales", "sales_mgr", "channel_ops", "marketing_mgr", "project_ops"] as const) {
      expect(教.get(r)).toMatchObject({ disabled: true, 说明: expect.stringMatching(/销售教练不能兼/) });
    }
    expect(教.get("director")?.disabled).toBe(false);
    expect(教.get("admin")?.disabled).toBe(false);
    expect(new Map(业务角色选项(["sales"], true).map((o) => [o.value, o])).get("coach")?.disabled).toBe(true);
    expect(new Map(业务角色选项(["admin"], true).map((o) => [o.value, o])).get("coach")?.disabled).toBe(false);
  });
});

describe("新增出来的教练 = 组织架构里改出来的教练", () => {
  it("只读、看全部、不当负责人、不领不建、进不了设置、电话打码，两人一样", async () => {
    当(系统);
    expect(await saveUser(新("coach-new", ["coach"]))).toMatchObject({ ok: true });
    expect(await saveUser(新("coach-edit", ["sales"]))).toMatchObject({ ok: true });
    const 新的 = (await prisma.user.findUniqueOrThrow({ where: { email: "coach-new" } })).id;
    const 改的 = (await prisma.user.findUniqueOrThrow({ where: { email: "coach-edit" } })).id;
    expect(await 设成员(改的, { bizRole: ["coach"] })).toMatchObject({ ok: true });
    忘掉企业版范围();
    const org = await 读组织();
    expect(org.成员.get(新的)?.角色们).toEqual(["coach"]);
    const 判 = async (id: string) => {
      const me = { id, role: "SALES" };
      return {
        角色们: org.成员.get(id)?.角色们,
        只读: 只读角色(me, org), 教练: 是教练(me, org), 全部: 能看全部(me, org), 负责人: 能当负责人(org, id),
        新建: 能新建和领取(me, org), 设置: 能进设置(me, org), 话: 只读话of(me, org),
        范围: 设置范围of(me, org, true),
        电话: (await 字段权限of(id))("电话"), 号: (await 号码脱敏器(id))("13912345678"),
      };
    };
    const a = await 判(新的);
    expect(a).toMatchObject({ 只读: true, 教练: true, 全部: true, 负责人: false, 新建: false, 设置: false, 电话: "藏" });
    expect(a.号).toContain("*");
    expect(a.范围).toMatchObject({ 只个人: true, 可改: false });
    expect(a).toEqual(await 判(改的));
  });
});
