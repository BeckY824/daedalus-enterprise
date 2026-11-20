/**
 * 市场成员新建时直接指定给销售也计数（11-18 加急，lib/enterprise/direct-assign.ts）：
 *   - 市场管理 / 渠道运营新建（建档向导、只建客户、新建客户页、客户页新增项目）把负责人选成销售 = 记 1 条指定分配，算数
 *   - 销售自己新建、负责人是自己：不记；销售管理指定给销售：不记（客户原话只针对市场成员、市场管理）
 *   - 走自动分配的（分配线索写过记录）：只有 1 条，不重复
 *   - 「前面几条」跟着变，记完推一次「快轮到」
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 建档向导, 建档只建客户, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { 记新建指定分配, 新建算指定分配, 新建指定方向 } from "@/lib/enterprise/direct-assign";
import { 本月已分, 月份, 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 估算轮到, 快轮到kind } from "@/lib/enterprise/assign-eta";
import { 读组织 } from "@/lib/enterprise/org";
import { 新建分配方式数据 } from "@/lib/project/after-create-assign";
import { 指定选项, 方向可指定 } from "@/lib/enterprise/designate-options";

afterAll(() => prisma.$disconnect());

let 市场: string, 渠运: string, 销管: string, 销售: string, 另一销售: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };
let 号 = 0;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  let 第几 = 0;
  const 人 = async (email: string, bizRole: string, line: string | null = null) => {
    第几++;
    // 开号先后 = 进池先后（估算并列时按它）
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x", createdAt: new Date(2026, 0, 第几) } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line } });
    return id;
  };
  市场 = await 人("mkt", "marketing_mgr");
  渠运 = await 人("ops", "channel_ops");
  销管 = await 人("smgr", "sales_mgr", "内贸");
  销售 = await 人("s1", "sales", "内贸");
  另一销售 = await 人("s2", "sales", "内贸");
  await setSetting(规则.线索分配.key, true);
  当(市场);
});
afterEach(() => { vi.unstubAllEnvs(); });

function 向导输入(ownerId: string, 补: Partial<建档向导输入["项目"]> = {}): 建档向导输入 {
  号++;
  return {
    客户: {
      name: `向导客户${号}`, phone: `1390000${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: ownerId, channelId: null, referrerCustomerId: null, touchpoint: "公司资源",
    },
    联系人: { name: "王经理", position: "采购", phone: "" },
    项目: { name: `一期${号}`, amount: 0, currency: "CNY", ownerId, 业务线: "内贸", ...补 },
    跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
  } as 建档向导输入;
}
const 记录们 = () => prisma.entLeadAssign.findMany({ orderBy: { createdAt: "asc" } });

describe("纯函数", () => {
  it("只认业务角色市场管理 / 渠道运营；负责人是自己、没负责人不算", async () => {
    const org = await 读组织();
    expect(新建算指定分配(org, 市场, 销售)).toBe(true);
    expect(新建算指定分配(org, 渠运, 销售)).toBe(true);
    expect(新建算指定分配(org, 市场, 市场)).toBe(false);
    expect(新建算指定分配(org, 市场, null)).toBe(false);
    expect(新建算指定分配(org, 销管, 销售)).toBe(false);
    expect(新建算指定分配(org, 销售, 另一销售)).toBe(false);
  });
  it("方向：项目业务线 → 区域 → 电话 → 接手人事业部 → null", () => {
    expect(新建指定方向({ 业务线: "外贸", 客户: { addrCountry: "中国" } })).toBe("外贸");
    expect(新建指定方向({ 业务线: "暂不分配", 客户: { addrCountry: "美国" }, 接手人线: "内贸" })).toBe("外贸");
    expect(新建指定方向({ 业务线: null, 项目: { addrCity: "杭州" } })).toBe("内贸");
    expect(新建指定方向({ 业务线: null, 号们: ["+14155550123"], 接手人线: "内贸" })).toBe("外贸");
    expect(新建指定方向({ 业务线: null, 号们: [], 接手人线: "内贸" })).toBe("内贸");
    expect(新建指定方向({ 业务线: null })).toBeNull();
  });
});

describe("市场成员新建、负责人选成销售：记 1 条指定分配、算数", () => {
  it("建档向导（新线索 / 首页 AI 新线索卡走这里）", async () => {
    const r = await 建档向导(向导输入(销售, { 分配方式: 0 }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    const 们 = await 记录们();
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({
      projectId: r.projectId, toUserId: 销售, byUserId: 市场, fromUserId: 市场, way: "指定分配", kind: "营销", counted: true, month: 月份(), line: "内贸", leadId: "",
    });
    expect(await 本月已分(销售)).toBe(1);
  });

  it("渠道运营走建档向导指定给销售：同样记", async () => {
    当(渠运);
    const r = await 建档向导(向导输入(另一销售, { 分配方式: 0 }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(await 记录们()).toMatchObject([{ projectId: r.projectId, toUserId: 另一销售, byUserId: 渠运, counted: true }]);
  });

  it("只建客户（新建弹窗没开项目）：记在潜客培育项目上（渠道运营新建客户只能记在自己名下，这里是市场管理）", async () => {
    const 入 = 向导输入(销售);
    const r = await 建档只建客户({ 客户: { ...入.客户, 企业资料: { bizLine: "外贸" } }, 联系人: 入.联系人, 跟进: 入.跟进 } as never);
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: r.customerId } });
    expect(p.ownerId).toBe(销售);
    // 潜客培育项目没有业务线：客户也没地址，号是大陆手机 → 内贸
    expect(await 记录们()).toMatchObject([{ projectId: p.id, toUserId: 销售, byUserId: 市场, counted: true, line: "内贸" }]);
  });

  it("新建客户页（saveCustomer 新建）：记在客户自带的潜客培育项目上", async () => {
    const r = await saveCustomer({
      name: "表单客户", phone: "13800000001", school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 另一销售, channelId: null, referrerCustomerId: null, touchpoint: "公司资源", 企业资料: { bizLine: "内贸" },
    } as Parameters<typeof saveCustomer>[0]);
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: r.id } });
    expect(await 记录们()).toMatchObject([{ projectId: p.id, toUserId: 另一销售, byUserId: 市场, counted: true }]);
  });

  it("客户页新增项目直接指定给参与状态不正常的销售：拒（和建档向导、新线索列表同一条，审核追加）", async () => {
    await setSetting(自动分配不参与key, { [销售]: "暂停" });
    invalidateSettingsCache();
    const c = await prisma.customer.create({ data: { name: "老客户乙", phone: "13900000012", salesOwnerId: 市场, addrCountry: "美国" } });
    const r = await 给客户建项目({
      customerId: c.id,
      项目: { name: "三期", amount: 0, currency: "CNY", ownerId: 销售, 分配方式: 0, 业务线: "内贸" } as never,
      跟进: { type: "PHONE", content: "电话聊了三期", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false } as never,
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("暂停");
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(0);
  });

  it("客户页新增项目", async () => {
    const c = await prisma.customer.create({ data: { name: "老客户", phone: "13900000011", salesOwnerId: 市场, addrCountry: "美国" } });
    const r = await 给客户建项目({
      customerId: c.id,
      项目: { name: "二期", amount: 0, currency: "CNY", ownerId: 销售, 分配方式: 0, 业务线: "暂不分配" } as never,
      跟进: { type: "PHONE", content: "电话聊了二期", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false } as never,
    });
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    // 业务线暂不分配：按客户区域（美国）= 外贸
    expect(await 记录们()).toMatchObject([{ projectId: r.projectId, toUserId: 销售, byUserId: 市场, counted: true, line: "外贸" }]);
  });
});

describe("不记的", () => {
  it("销售自己新建、负责人是自己：不记", async () => {
    当(销售);
    const r = await 建档向导(向导输入(销售, { 分配方式: 4 }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(await 记录们()).toHaveLength(0);
  });

  it("销售管理新建指定给销售：不记（只针对市场成员）", async () => {
    当(销管);
    const r = await 建档向导(向导输入(销售, { 分配方式: 0 }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(await 记录们()).toHaveLength(0);
  });

  it("市场建给自己（暂不分配）：不记", async () => {
    const r = await 建档向导(向导输入(销售, { 分配方式: 3 }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(await 记录们()).toHaveLength(0);
  });

  it("走自动分配的：分配线索记 1 条（自动分配），不重复记；同一项目再调一次也不重复", async () => {
    const r = await 建档向导(向导输入(市场, { 分配方式: 1 }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    const 们 = await 记录们();
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ projectId: r.projectId, way: "自动分配", byUserId: 市场 });
    expect(await 记新建指定分配({ id: 市场 }, r.projectId)).toBe(false);
    expect(await 记录们()).toHaveLength(1);
  });

  it("不是企业版：不记", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const p = await prisma.project.create({ data: { name: "x", customer: { create: { name: "c", phone: "13800000099", salesOwnerId: 销售 } }, ownerId: 销售, creatorId: 市场 } });
    expect(await 记新建指定分配({ id: 市场 }, p.id)).toBe(false);
    expect(await 记录们()).toHaveLength(0);
  });
});

describe("估算跟着变、推「快轮到」", () => {
  it("两位内贸销售：没记录时暂无法估算；市场指定给销售一条后他排后、另一位下一条；再指定给另一位又换回来", async () => {
    // 11-18 第 9 题 B 起内贸销售管理也进池；这条只钉两位销售之间，先把销管禁掉
    await setSetting(自动分配不参与key, { [销管]: "禁止" });
    const 估 = async () => Object.fromEntries([...(await 估算轮到(await 读组织()))].filter(([id]) => id === 销售 || id === 另一销售).map(([id, x]) => [id === 销售 ? "一" : "二", x]));
    expect(await 估()).toEqual({ 一: "暂无法估算", 二: "暂无法估算" });
    const a = await 建档向导(向导输入(销售, { 分配方式: 0 }));
    expect(a.ok, a.ok ? "" : a.error).toBe(true);
    expect(await 估()).toEqual({ 一: { 数: 1 }, 二: { 数: 0 } });
    // 记完推了一次快轮到：另一位进了 3 条以内（销售本人也在 3 条以内，被分到一条 = 新一轮，也推）
    expect((await prisma.entNotice.findMany({ where: { kind: 快轮到kind } })).map((n) => n.userId).sort()).toEqual([销售, 另一销售].sort());
    const b = await 建档向导(向导输入(另一销售, { 分配方式: 0 }));
    expect(b.ok, b.ok ? "" : b.error).toBe(true);
    // 一样多（各 1 条），按开号先后：销售先
    expect(await 估()).toEqual({ 一: { 数: 0 }, 二: { 数: 1 } });
  });
});

describe("[P-转-26] 新线索向导「指定分配」也先定方向（11-20 3703 实操）：负责人要在所选方向（业务线内贸 / 外贸）能挑的人里", () => {
  let 外贸销售: string;
  beforeEach(async () => {
    外贸销售 = (await prisma.user.create({ data: { email: "w1", name: "w1", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 外贸销售, bizRole: "sales", line: "外贸" } });
  });

  it("市场选内贸销售当负责人、方向选外贸：拒，提示改方向或换人，客户、项目都没建；内贸销售管理选外贸也拒（外贸方向不含销售管理）", async () => {
    for (const 负责人 of [销售, 销管]) {
      const 入 = 向导输入(负责人, { 分配方式: 0, 业务线: "外贸" });
      const r = await 建档向导(入);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toBe("负责人不在所选方向（外贸），请改方向或换人");
      expect(await prisma.customer.count({ where: { name: 入.客户.name } })).toBe(0);
    }
    // 渠道运营同样拒；外贸销售选内贸也拒
    当(渠运);
    const r = await 建档向导(向导输入(外贸销售, { 分配方式: 0, 业务线: "内贸" }));
    expect(r.ok ? "" : r.error).toBe("负责人不在所选方向（内贸），请改方向或换人");
    expect(await prisma.project.count()).toBe(0);
    expect(await 记录们()).toHaveLength(0);
  });

  it("方向一致照常：内贸选内贸销售 / 内贸销售管理、外贸选外贸销售，建成、线记所选方向；业务线选「暂不分配」不核", async () => {
    for (const [负责人, 线] of [[销售, "内贸"], [销管, "内贸"], [外贸销售, "外贸"]] as const) {
      const r = await 建档向导(向导输入(负责人, { 分配方式: 0, 业务线: 线 }));
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      if (!r.ok) return;
      expect(await prisma.project.findUniqueOrThrow({ where: { id: r.projectId! }, select: { ownerId: true, flowLine: true } })).toEqual({ ownerId: 负责人, flowLine: 线 });
    }
    const 暂不 = await 建档向导(向导输入(外贸销售, { 分配方式: 0, 业务线: "暂不分配" }));
    expect(暂不.ok, 暂不.ok ? "" : 暂不.error).toBe(true);
  });

  it("不是市场成员发起的（销售管理、条线总管理指定）不按方向限人（P-转-26 末句）", async () => {
    当(销管);
    const r = await 建档向导(向导输入(外贸销售, { 分配方式: 0, 业务线: "内贸" }));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("负责人下拉跟着方向筛：市场成员拿到候选表（内贸 = 内贸销售 + 销售管理，外贸 = 外贸销售），方向一换下拉只留这条线的人；兼管理的不给表、不筛", async () => {
    const 数 = await 新建分配方式数据({ id: 市场, name: "mkt", email: "", role: "SALES", title: "" } as never);
    expect(数.指定候选表).not.toBeNull();
    expect(new Set(数.指定候选表!.内贸)).toEqual(new Set([销管, 销售, 另一销售]));
    expect(数.指定候选表!.外贸).toEqual([外贸销售]);
    expect(new Set(方向可指定(数.可指定, 数.指定候选表, "外贸"))).toEqual(new Set([外贸销售]));
    expect(new Set(方向可指定(数.可指定, 数.指定候选表, "内贸"))).toEqual(new Set([销管, 销售, 另一销售]));
    expect(方向可指定(数.可指定, 数.指定候选表, "暂不分配")).toEqual(数.可指定);
    expect(指定选项([{ value: 销售, label: "s1" }, { value: 外贸销售, label: "w1" }], 方向可指定(数.可指定, 数.指定候选表, "外贸"), 市场, 销售))
      .toEqual([{ value: 外贸销售, label: "w1" }, { value: 销售, label: "s1（不能被指定）", disabled: true }]);
    const 管 = await 新建分配方式数据({ id: 销管, name: "smgr", email: "", role: "SALES", title: "" } as never);
    expect(管.指定候选表).toBeNull();
  });
});
