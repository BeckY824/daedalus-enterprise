/**
 * 客户页「范围」筛选（客户 11-18 第 12 题：「把客户的页签直接加一个筛选项：我负责的、我参与的、我可见的（给管理用）」）：
 * - 我负责的 = 客户负责人是我；我参与的 = 我是这位客户名下某个项目的组员（点了同意）、客户不是我负责的；我可见的 = 按权限能看到的全部
 * - 销售默认「我负责的」（列表总数 = 设置里他的客户数，不再多算组员客户）；有管理范围的默认「我可见的」，只有他们有这一项
 * - 地址栏 scope=mine / joined / visible 记选中项；没这一项的人带了 visible 当默认
 * - 带关键词（快路径）同样按范围筛；导出、看板拿到的条件里带着同一个范围
 * - 客户详情左侧名单：销售默认停在「我的」，「我的」的总数 = 我负责的
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null }, 在请求: false }));
vi.mock("next/headers", async (原) => ({
  ...(await 原<object>()),
  cookies: async () => {
    if (!mocks.在请求) throw new Error("不在请求里");
    return { get: () => undefined };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/customers/CustomersView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/HandoverPending", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/ProjectsView", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomersPage from "@/app/(app)/customers/page";
import { 学员名单 } from "@/app/(app)/@pane/panes";
import type { CustomerRosterData } from "@/components/CustomerRoster";
import { 生效客户范围, 客户范围选项, 名单底句 } from "@/lib/enterprise/customer-scope";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, managerId: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  return { id: u.id, name: key, email: `${key}@x`, role: "SALES", title: "", avatar: null };
};
let 序 = 0;
const 建客户 = async (owner: 人, 名 = "范围客户") => {
  序 += 1;
  return prisma.customer.create({ data: { name: `${名}${序}`, phone: `1370000${String(序).padStart(4, "0")}`, salesOwnerId: owner.id } });
};
const 挂项目 = async (customerId: string, owner: 人, 组员?: { 人: 人; 状态: string }) => {
  const p = await prisma.project.create({ data: { name: `项目${序}`, customerId, ownerId: owner.id, creatorId: owner.id, phase: "线索", node: "潜客培育" } });
  if (组员) await prisma.projectMember.create({ data: { projectId: p.id, userId: 组员.人.id, inviteStatus: 组员.状态 } });
  return p;
};

type 页属性 = { total: number; filters: Record<string, string>; 客户范围?: { 值: string; 默认: string; 选项: string[] } };
const 打开 = async (谁: 人, sp: Record<string, string> = {}): Promise<页属性> => {
  mocks.user = { ...谁 };
  mocks.在请求 = true;
  try {
    const el = (await 以谁的身份(谁.id, () => CustomersPage({ searchParams: Promise.resolve(sp) } as never))) as ReactElement<页属性>;
    return el.props;
  } finally {
    mocks.在请求 = false;
  }
};

let 经理: 人, 甲: 人, 乙: 人;
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting(规则.按组织看客户.key, true);
  序 = 0;
  经理 = await 造人("jl", "sales_mgr");
  甲 = await 造人("jia", "sales", 经理.id);
  乙 = await 造人("yi", "sales");
  // 甲负责 3 位；乙负责 3 位，其中 1 位挂着甲已加入的项目、1 位挂着甲只是被邀请（没同意）的项目
  for (let i = 0; i < 3; i++) await 挂项目((await 建客户(甲)).id, 甲);
  const 参与 = await 建客户(乙, "参与客户");
  await 挂项目(参与.id, 乙, { 人: 甲, 状态: "JOINED" });
  const 邀请 = await 建客户(乙);
  await 挂项目(邀请.id, 乙, { 人: 甲, 状态: "INVITED" });
  await 建客户(乙);
  // 甲负责、又是组员的（自己负责的项目上也挂着自己）：只算「我负责的」
  const 自己 = await 建客户(甲);
  await 挂项目(自己.id, 甲, { 人: 甲, 状态: "JOINED" });
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("纯函数：默认值和选项", () => {
  it("销售：默认我负责的，只有负责 / 参与两项；地址栏带 visible 当默认", () => {
    expect(客户范围选项(false)).toEqual(["mine", "joined"]);
    expect(生效客户范围(undefined, false)).toBe("mine");
    expect(生效客户范围("joined", false)).toBe("joined");
    expect(生效客户范围("visible", false)).toBe("mine");
    expect(生效客户范围("乱写", false)).toBe("mine");
  });
  it("有管理范围：默认我可见的，三项都有", () => {
    expect(客户范围选项(true)).toEqual(["mine", "joined", "visible"]);
    expect(生效客户范围(undefined, true)).toBe("visible");
    expect(生效客户范围("mine", true)).toBe("mine");
  });
});

describe("客户页按范围筛（企业版项目模式）", () => {
  it("销售默认「我负责的」：列表总数 = 自己负责的 4 位（= 设置里的客户数），不含参与项目的客户", async () => {
    const p = await 打开(甲);
    expect(p.filters.scope).toBe("mine");
    expect(p.客户范围).toMatchObject({ 值: "mine", 默认: "mine", 选项: ["mine", "joined"] });
    expect(p.total).toBe(4);
    expect(p.total).toBe(await prisma.customer.count({ where: { salesOwnerId: 甲.id, pool: { is: null } } }));
  });
  it("销售选「我参与的」：只有挂着他已加入项目、不是他负责的那 1 位（被邀请没同意的不算）", async () => {
    const p = await 打开(甲, { scope: "joined" });
    expect(p.filters.scope).toBe("joined");
    expect(p.total).toBe(1);
  });
  it("带关键词（快路径）也按范围筛", async () => {
    expect((await 打开(甲, { keyword: "参与客户" })).total).toBe(0);
    expect((await 打开(甲, { keyword: "参与客户", scope: "joined" })).total).toBe(1);
    expect((await 打开(甲, { keyword: "范围客户", scope: "mine" })).total).toBe(4);
  });
  it("销售带 scope=visible：没有这一项，按默认「我负责的」", async () => {
    const p = await 打开(甲, { scope: "visible" });
    expect(p.filters.scope).toBe("mine");
    expect(p.total).toBe(4);
  });
  it("销售管理默认「我可见的」（下属的都在）；切「我负责的」只剩自己的", async () => {
    const p = await 打开(经理);
    expect(p.filters.scope).toBe("visible");
    expect(p.客户范围).toMatchObject({ 值: "visible", 默认: "visible", 选项: ["mine", "joined", "visible"] });
    // 下属负责的 4 位都在（下属加入的项目挂着的客户按原可见规则也可能在，不钉死）
    expect(p.total).toBeGreaterThanOrEqual(4);
    expect((await 打开(经理, { scope: "mine" })).total).toBe(0);
  });
});

describe("客户详情左侧名单：和「我负责的」对齐", () => {
  it("销售默认停在「我的」，「我的」总数 = 自己负责的；管理默认停在「全部」", async () => {
    mocks.user = { ...甲 };
    const 甲的 = ((await 以谁的身份(甲.id, () => 学员名单())) as ReactElement<{ data: CustomerRosterData; 默认页签?: string }>).props;
    expect(甲的.默认页签).toBe("我的");
    expect(甲的.data.mineTotal).toBe(4);
    mocks.user = { ...经理 };
    const 经理的 = ((await 以谁的身份(经理.id, () => 学员名单())) as ReactElement<{ data: CustomerRosterData; 默认页签?: string }>).props;
    expect(经理的.默认页签).toBe("全部");
  });
});

describe("左侧名单底下那句：写的数 = 点过去表格里的数", () => {
  it("销售停在「全部」（负责 + 参与，客户页没有一项能一次显示）：链到我负责的、数写我负责的", () => {
    expect(名单底句({ 页签: "全部", 默认页签: "我的", 全部总数: 60, 全部条数: 50, 我负责总数: 30, 我的条数: 30 })).toEqual({ href: "/customers?scope=mine", 条: 50, 名: "我负责的", 总: 30 });
    // 名单里已经摆全了：不写
    expect(名单底句({ 页签: "全部", 默认页签: "我的", 全部总数: 40, 全部条数: 40, 我负责总数: 30, 我的条数: 30 })).toBeNull();
  });
  it("销售停在「我的」：只在我负责的多于摆出来的时候写", () => {
    expect(名单底句({ 页签: "我的", 默认页签: "我的", 全部总数: 120, 全部条数: 50, 我负责总数: 80, 我的条数: 50 })).toEqual({ href: "/customers?scope=mine", 条: 50, 名: "我负责的", 总: 80 });
    expect(名单底句({ 页签: "我的", 默认页签: "我的", 全部总数: 120, 全部条数: 50, 我负责总数: 30, 我的条数: 30 })).toBeNull();
  });
  it("有管理范围：「全部」链 /customers（默认我可见的）写全部总数；「我的」链我负责的", () => {
    expect(名单底句({ 页签: "全部", 默认页签: "全部", 全部总数: 900, 全部条数: 50, 我负责总数: 3, 我的条数: 3 })).toEqual({ href: "/customers", 条: 50, 名: "全部", 总: 900 });
    expect(名单底句({ 页签: "我的", 默认页签: "全部", 全部总数: 900, 全部条数: 50, 我负责总数: 70, 我的条数: 50 })).toEqual({ href: "/customers?scope=mine", 条: 50, 名: "我负责的", 总: 70 });
  });
  it("连库对拍：销售名单「全部」那句落到的范围，客户页的总数 = 名单给的数；管理「全部」落到默认，总数 = 名单全部总数", async () => {
    type 名单属性 = { data: CustomerRosterData; 默认页签: "全部" | "我的" };
    for (const [谁, 页签] of [[甲, "全部"], [甲, "我的"], [经理, "全部"]] as const) {
      mocks.user = { ...谁 };
      const r = ((await 以谁的身份(谁.id, () => 学员名单())) as ReactElement<名单属性>).props;
      // 摆出来的条数当 0：逼它一定写这一句，只看数和链接对不对得上
      const 句 = 名单底句({ 页签, 默认页签: r.默认页签, 全部总数: r.data.total, 全部条数: 0, 我负责总数: r.data.mineTotal, 我的条数: 0 })!;
      const sp = Object.fromEntries(new URLSearchParams(句.href.split("?")[1] ?? ""));
      expect((await 打开(谁, sp)).total, `${谁.name} ${页签}`).toBe(句.总);
    }
  });
});
