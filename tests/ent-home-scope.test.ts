/**
 * 企业版首页数据范围按角色自查（U-首页-01 / A-19，10-31）：首页四张卡数谁的、点卡进项目页列谁的，两边同一圈。
 *   - 业务员：只自己负责的
 *   - 销售管理：本部门和下级部门的人（没指定直属上级的按部门往上找到他）+ 自己；别的部门不算
 *   - 管理员、总管理：全部（只认业务角色，账号 ADMIN 不算数）
 *   - 市场成员 / 市场管理：和别人一样按负责人数（自己 + 下属）；市场建给别人的项目在项目列表里只读能看，不进首页卡
 *   - 没设业务角色：0
 * 「按组织看客户」开没开，首页这一圈都一样。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 数首页卡 } from "@/lib/project/home-cards-db";
import { 读项目列表 } from "@/lib/project/list";
import { setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";

const 人: Record<string, { id: string; role: string; name: string }> = {};
const 项: Record<string, string> = {};

async function 建人(名: string, role: string, 组织?: { deptId?: string; bizRole?: string }) {
  const u = await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role, password: "x" } });
  人[名] = { id: u.id, role, name: 名 };
  if (组织) await prisma.entMember.create({ data: { userId: u.id, deptId: 组织.deptId, bizRole: 组织.bizRole ?? "sales" } });
}

async function 建项目(名: string, 负责: string, 建的 = 负责) {
  const c = await prisma.customer.create({ data: { name: `${名}客户`, phone: `139${String(Object.keys(项).length).padStart(8, "0")}`, salesOwnerId: 人[负责].id } });
  项[名] = (await prisma.project.create({ data: { name: 名, customerId: c.id, ownerId: 人[负责].id, creatorId: 人[建的].id } })).id;
}

const 看 = async (名: string) => {
  const u = 人[名];
  mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role };
  return 以谁的身份(u.id, async () => {
    const 数 = (await 数首页卡(u, new Date(), ["month-new"]))["month-new"];
    const 行 = (await 读项目列表(u, { f: "month-new" })).行.map((r) => r.name).sort();
    return { 数, 行 };
  });
};

describe("首页数据范围按角色", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    const 销售一部 = (await prisma.entDept.create({ data: { name: "销售一部" } })).id;
    const 销售一组 = (await prisma.entDept.create({ data: { name: "销售一组", parentId: 销售一部 } })).id;
    const 销售二部 = (await prisma.entDept.create({ data: { name: "销售二部" } })).id;
    const 市场部 = (await prisma.entDept.create({ data: { name: "市场运营部" } })).id;
    await 建人("老板", "ADMIN", { bizRole: "admin" });
    await 建人("没角色", "SALES");
    await 建人("总管", "SALES", { bizRole: "director" });
    await 建人("销售经理", "SALES", { deptId: 销售一部, bizRole: "sales_mgr" });
    await 建人("业务员甲", "SALES", { deptId: 销售一部 });
    await 建人("业务员乙", "SALES", { deptId: 销售一组 });
    await 建人("外部门", "SALES", { deptId: 销售二部 });
    await 建人("市场经理", "SALES", { deptId: 市场部, bizRole: "marketing_mgr" });
    await 建人("市场员", "SALES", { deptId: 市场部 });
    // 部门往上只自动找销售管理；市场这边的上级要显式指定
    await prisma.entMember.update({ where: { userId: 人["市场员"].id }, data: { managerId: 人["市场经理"].id } });
    await 建项目("老板的", "老板");
    await 建项目("经理的", "销售经理");
    await 建项目("甲的", "业务员甲");
    await 建项目("乙的", "业务员乙");
    await 建项目("外部门的", "外部门");
    await 建项目("市场建给甲", "业务员甲", "市场员");
    await 建项目("市场自己的", "市场员");
    await 建项目("市场经理的", "市场经理");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });
  afterAll(() => prisma.$disconnect());

  const 全部 = ["乙的", "外部门的", "市场建给甲", "市场经理的", "市场自己的", "甲的", "经理的", "老板的"].sort();
  const 期望: Record<string, string[]> = {
    老板: 全部,
    总管: 全部,
    销售经理: ["经理的", "甲的", "乙的", "市场建给甲"].sort(),
    业务员甲: ["甲的", "市场建给甲"].sort(),
    业务员乙: ["乙的"],
    外部门: ["外部门的"],
    // 首页卡只按负责人数（和复盘同一圈）：市场自己建、负责人是别人的项目不算进卡，项目列表照旧能只读看到
    市场员: ["市场自己的"],
    市场经理: ["市场经理的", "市场自己的"].sort(),
    // 没设业务角色 = 没权限：卡上 0
    没角色: [],
  };

  for (const 开 of [false, true]) {
    it(`每个角色卡上的数 = 点进去的行，范围对（按组织看客户${开 ? "开" : "关"}）`, async () => {
      await setSetting("enterprise.rule.org_scope", 开);
      for (const [名, 行] of Object.entries(期望)) {
        const r = await 看(名);
        expect({ 名, 行: r.行 }).toEqual({ 名, 行 });
        expect({ 名, 数: r.数 }).toEqual({ 名, 数: 行.length });
      }
    });
  }

  it("市场部门另设了：按设的认，名字带「市场」的那个部门不再算", async () => {
    const 别的部门 = (await prisma.entDept.create({ data: { name: "渠道部" } })).id;
    await setSetting("enterprise.market_depts", [别的部门]);
    // 首页卡只按负责人数：市场部门设成哪个都不影响
    expect((await 看("市场员")).行).toEqual(["市场自己的"]);
    // 市场经理按组织架构是市场员的上级：自己 + 下属负责的
    expect((await 看("市场经理")).行).toEqual(["市场经理的", "市场自己的"].sort());
  });
});
