/**
 * 企业版复盘范围 = 项目列表的负责人范围（11-01 定：「上级可以看下级，最下级只能看自己」）。
 *   - 每个业务角色（总管理、管理员、销售管理、销售成员、项目运营）：复盘这一圈（看板的人 的 谁）数出来的项目
 *     = 项目列表按「按组织看客户」开着时看得到、不在公海的项目（两边同一个 组织范围of）
 *   - 复盘的卡点页签端到端也是这一圈
 *   - 最下级的复盘只有自己的项目（公海里有项目也不算进来）
 *   - 上级看得到间接下属（实线整条链）和虚线下属
 *   - 管理员能看全部，但在复盘里写（改任务、改卡点）被拒
 *   - 没设业务角色 = 复盘一个都不数
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 只读角色话 } from "@/lib/enterprise/permissions";
import { 清首页缓存 } from "@/lib/home-cache";
import { setSetting } from "@/lib/settings";
import { 看全部 } from "@/lib/team-scope";
import { dayjs } from "@/lib/utils";
import { 看板的人 } from "@/lib/project/board-member";
import { 复盘卡点of } from "@/lib/project/review-tabs-db";

const 人 = {
  老板: { id: "rs_boss", role: "ADMIN", bizRole: "director" },
  管员: { id: "rs_admin", role: "ADMIN", bizRole: "admin" },
  主管: { id: "rs_head", role: "SALES", bizRole: "sales_mgr" },
  经理: { id: "rs_mgr", role: "SALES", bizRole: "sales_mgr", managerId: "rs_head" },
  小王: { id: "rs_wang", role: "SALES", bizRole: "sales", managerId: "rs_mgr" },
  小张: { id: "rs_zhang", role: "SALES", bizRole: "sales", dottedManagerId: "rs_mgr" },
  外人: { id: "rs_out", role: "SALES", bizRole: "sales" },
  运营: { id: "rs_ops", role: "SALES", bizRole: "project_ops" },
  没角色: { id: "rs_none", role: "SALES", bizRole: null },
} as const;
type 名字 = keyof typeof 人;
const 名of = new Map<string, string>(Object.entries(人).map(([k, v]) => [v.id, k]));

const 项目: Record<string, string> = {};
let 序 = 0;

async function 建项目(名: string, 负责: 名字, 公海 = false) {
  const 他 = 人[负责].id;
  const c = await prisma.customer.create({ data: { name: `${名}客户`, phone: `1370000${String(++序).padStart(4, "0")}`, salesOwnerId: 他 } });
  项目[名] = (await prisma.project.create({ data: { name: 名, customerId: c.id, ownerId: 他, creatorId: 他, pooledAt: 公海 ? new Date() : null } })).id;
  const f = await prisma.followUp.create({ data: { customerId: c.id, ownerId: 他, type: "CALL", title: "", content: "发卡点", status: "已完成" } });
  await prisma.entBlocker.create({
    data: {
      code: `RS${String(序).padStart(4, "0")}`, projectId: 项目[名], followUpId: f.id, customerId: c.id, phase: "线索",
      type: "需求不清", impact: "一般", obstacle: "客户", description: `${名}的卡点`, dueDays: 3, dueAt: dayjs().add(3, "day").toDate(), creatorId: 他,
    },
  });
}

/** 复盘这一圈数到的项目：看板的人 的 谁 圈负责人（undefined = 不限），公海的不算 */
async function 复盘项目(名: 名字): Promise<string[]> {
  const u = 人[名];
  const { 谁 } = await 看板的人({ id: u.id, role: u.role });
  const ps = await 看全部(() =>
    prisma.project.findMany({ where: { deletedAt: null, pooledAt: null, ...(谁 ? { ownerId: { in: [...谁] } } : {}) }, select: { name: true } }),
  );
  return ps.map((p) => p.name).sort();
}

/** 项目列表这一圈：带限定的 prisma（同项目列表那一层），不在公海的 */
async function 列表项目(名: 名字): Promise<string[]> {
  const ps = await 以谁的身份(人[名].id, () => prisma.project.findMany({ where: { deletedAt: null, pooledAt: null }, select: { name: true } }));
  return ps.map((p) => p.name).sort();
}

describe("复盘范围 = 项目列表负责人范围", () => {
  beforeEach(async () => {
    await resetDb();
    清首页缓存();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    for (const [名, u] of Object.entries(人)) await prisma.user.create({ data: { id: u.id, name: 名, email: `${u.id}@t`, role: u.role, password: "x", title: "" } });
    for (const u of Object.values(人)) {
      if (!u.bizRole) continue;
      await prisma.entMember.create({
        data: {
          userId: u.id, bizRole: u.bizRole,
          managerId: "managerId" in u ? u.managerId : null,
          dottedManagerId: "dottedManagerId" in u ? u.dottedManagerId : null,
        },
      });
    }
    for (const 名 of Object.keys(人) as 名字[]) await 建项目(`${名}的`, 名);
    // 公海里的项目：小王放回去的（ownerId 还留着他）、外人放回去的
    await 建项目("小王放回公海的", "小王", true);
    await 建项目("外人放回公海的", "外人", true);
    await setSetting("enterprise.rule.org_scope", true);
    忘掉企业版范围();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });
  afterAll(() => prisma.$disconnect());

  const 全部 = (Object.keys(人) as 名字[]).map((n) => `${n}的`).sort();

  for (const 名 of ["老板", "管员", "主管", "经理", "小王", "运营"] as 名字[]) {
    it(`${名}（${人[名].bizRole}）：复盘数的项目 = 项目列表看得到的（不在公海的）；卡点页签同一圈`, async () => {
      const 复盘 = await 复盘项目(名);
      expect(复盘).toEqual(await 列表项目(名));
      const { 谁 } = await 看板的人({ id: 人[名].id, role: 人[名].role });
      const 卡点 = await 以谁的身份(人[名].id, () => 复盘卡点of(谁, 人[名].id, { 筛: "open" }));
      const 卡点项目 = [...new Set(卡点.行.map((r) => r.项目))].filter((n) => !n.includes("公海")).sort();
      expect(卡点项目).toEqual(复盘);
    });
  }

  it("各角色这一圈的具体人：总管理、管理员全部；销售管理自己 + 下属；项目运营、销售成员只有自己", async () => {
    expect(await 复盘项目("老板")).toEqual(全部);
    expect(await 复盘项目("管员")).toEqual(全部);
    expect(await 复盘项目("运营")).toEqual(["运营的"]);
    expect(await 复盘项目("外人")).toEqual(["外人的"]);
    // 下拉 = 同一圈的人
    const 选项 = (await 看板的人({ id: 人.经理.id, role: "SALES" })).选项?.map((o) => 名of.get(o.value)).sort();
    expect(选项).toEqual(["经理", "小王", "小张"].sort());
  });

  it("最下级的复盘只有自己的项目（公海里有项目也不算进来）", async () => {
    const r = await 看板的人({ id: 人.小王.id, role: "SALES" });
    expect(r).toMatchObject({ 只看: 人.小王.id, 谁: [人.小王.id], 选项: null });
    expect(await 复盘项目("小王")).toEqual(["小王的"]);
    // 卡点页签：公海里他放回去的那个项目的卡点也不算
    const 卡点 = await 以谁的身份(人.小王.id, () => 复盘卡点of(r.谁, 人.小王.id, { 筛: "open" }));
    expect(卡点.行.map((x) => x.description)).toEqual(["小王的的卡点"]);
  });

  it("上级看得到间接下属：主管 → 经理 → 小王整条实线链；经理另看虚线下属小张；同级的外人不算", async () => {
    // 虚线下属只给他的虚线上级看，不顺着实线往上传（同项目列表）
    expect(await 复盘项目("主管")).toEqual(["主管的", "经理的", "小王的"].sort());
    expect(await 复盘项目("经理")).toEqual(["经理的", "小王的", "小张的"].sort());
  });

  it("没设业务角色：复盘一个都不数", async () => {
    expect(await 看板的人({ id: 人.没角色.id, role: "SALES" })).toEqual({ 谁: [], 选项: null });
    expect(await 复盘项目("没角色")).toEqual([]);
  });

  it("管理员在复盘里能看全部，但写被拒（改卡点、改项目下一步）", async () => {
    const 管员 = 人.管员.id;
    const { 谁 } = await 看板的人({ id: 管员, role: "ADMIN" });
    expect(谁).toBeUndefined();
    const 卡点 = await 以谁的身份(管员, () => 复盘卡点of(谁, 管员, { 筛: "open" }));
    expect(卡点.总数).toBe(Object.keys(人).length + 2);
    const 一条 = 卡点.行[0].id;
    await expect(以谁的身份(管员, () => prisma.entBlocker.update({ where: { id: 一条 }, data: { status: "已解决" } }))).rejects.toThrow(只读角色话);
    await expect(
      以谁的身份(管员, () => prisma.project.update({ where: { id: 项目["小王的"] }, data: { nextStepAt: new Date() } })),
    ).rejects.toThrow(只读角色话);
    // 库里没变
    expect((await prisma.entBlocker.findUniqueOrThrow({ where: { id: 一条 } })).status).not.toBe("已解决");
  });
});
