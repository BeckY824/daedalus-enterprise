/**
 * 11-12 客户详情合并第 2 批：客户详情页交给项目区的数据（customers/[id]/project-zone.ts 读项目区）。
 * 钉的是：页签只列我能看的项目；看不到的同事在推项目只给个数；?project= 选页签，带的是看不了的就退回默认那个；
 * 项目区的数据和项目详情页同一个取数；/projects/<id> 进得了客户详情的跳过去
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/[id]/CustomerDetail", () => ({ default: () => null }));

import type { ReactElement } from "react";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomerPage from "@/app/(app)/customers/[id]/page";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import type { 项目区数据 } from "@/app/(app)/customers/[id]/ProjectZone";
import { 项目页去向 } from "@/app/(app)/projects/[id]/load";
import { 项目链接们 } from "@/lib/project/customer-detail-direct";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, managerId?: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(managerId ? { managerId } : {}) } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
const 区 = async (u: 人, c: string, project?: string): Promise<项目区数据 | null> => {
  const el = (await 以(u, () => CustomerPage({ params: Promise.resolve({ id: c }), searchParams: Promise.resolve(project ? { project } : {}) } as never))) as ReactElement<{ 项目数据: 项目区数据 | null }>;
  return el.props.项目数据;
};
const 打开项目 = async (u: 人, id: string) => {
  try { await 以(u, () => ProjectPage({ params: Promise.resolve({ id }) } as never)); return "OK"; } catch (e) { return (e as Error).message; }
};

let 甲: 人, 乙: 人;
let 客户: string, 我的: string, 我结束的: string, 同事的: string;
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  甲 = await 造人("jia", "sales");
  乙 = await 造人("yi", "sales");
  客户 = (await prisma.customer.create({ data: { name: "合并客户", phone: "13900000011", salesOwnerId: 甲.id } })).id;
  const 建 = (name: string, ownerId: string, x: object = {}) => prisma.project.create({ data: { name, customerId: 客户, ownerId, creatorId: ownerId, phase: "商机", node: "需求确认", ...x } }).then((p) => p.id);
  我结束的 = await 建("早结束的项目", 甲.id, { result: "丢单" });
  同事的 = await 建("同事在推的项目", 乙.id);
  我的 = await 建("我在推的项目", 甲.id);
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("客户详情的项目区", () => {
  it("页签只列我能看的；同事在推的只给个数；默认停在没结束、最近动过的那个", async () => {
    const r = (await 区(甲, 客户))!;
    expect(r.页签们.map((t) => t.id).sort()).toEqual([我的, 我结束的].sort());
    expect(JSON.stringify(r)).not.toContain("同事在推的项目");
    expect(r.锁数).toBe(1);
    expect(r.当前?.p.id).toBe(我的);
    expect(r.页签们.find((t) => t.id === 我结束的)?.节点).toBe("丢单");
  });

  it("?project= 选页签；带的是看不了的（同事的、别家客户的、不存在的）退回默认那个，不报找不到", async () => {
    expect((await 区(甲, 客户, 我结束的))!.当前?.p.id).toBe(我结束的);
    expect((await 区(甲, 客户, 同事的))!.当前?.p.id).toBe(我的);
    expect((await 区(甲, 客户, "没有这个"))!.当前?.p.id).toBe(我的);
    const 别家 = (await prisma.customer.create({ data: { name: "别家", phone: "13900000012", salesOwnerId: 甲.id } })).id;
    const 别家项目 = (await prisma.project.create({ data: { name: "别家项目", customerId: 别家, ownerId: 甲.id, creatorId: 甲.id, phase: "商机", node: "需求确认" } })).id;
    expect((await 区(甲, 客户, 别家项目))!.当前?.p.id).toBe(我的);
  });

  it("没有项目：页签空、当前 null（空状态）", async () => {
    const 空 = (await prisma.customer.create({ data: { name: "空客户", phone: "13900000013", salesOwnerId: 甲.id } })).id;
    expect(await 区(甲, 空)).toEqual({ customerId: 空, 页签们: [], 锁数: 0, 当前: null });
  });

  it("/projects/<id>：进得了客户详情的跳到 /customers/<客户>?project=<id>；看不到的照旧 404", async () => {
    expect(await 打开项目(甲, 我的)).toBe(`REDIRECT:/customers/${客户}?project=${我的}`);
    expect(await 打开项目(甲, 同事的)).toBe("NOT_FOUND");
  });

  it("/projects/<id> 的轻判断（审查 #3）：跳不跳和读整份详情一个口径；站内列表能确定的直接给客户页地址，公海、看不了的照旧 /projects/<id>", async () => {
    expect(await 以(甲, () => 项目页去向(甲 as never, 我的))).toEqual({ 种: "客户页", 到: `/customers/${客户}?project=${我的}` });
    expect(await 以(甲, () => 项目页去向(甲 as never, 我结束的))).toEqual({ 种: "客户页", 到: `/customers/${客户}?project=${我结束的}` });
    expect(await 以(甲, () => 项目页去向(甲 as never, 同事的))).toEqual({ 种: "无" });
    expect(await 以(甲, () => 项目页去向(甲 as never, "没有这个"))).toEqual({ 种: "无" });
    const 公海的 = (await prisma.project.create({ data: { name: "公海里的项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "需求确认", pooledAt: new Date() } })).id;
    const 链 = await 以(甲, () => 项目链接们(甲 as never, [我的, 同事的, 公海的]));
    expect(链.get(我的)).toBe(`/customers/${客户}?project=${我的}`);
    expect(链.get(同事的)).toBe(`/projects/${同事的}`);
    expect(链.get(公海的)).toBe(`/projects/${公海的}`);
  });

  it("看得到项目、看不到客户的人（只负责项目、不负责客户）：11-12 起跳客户页（受限客户详情），列表链接也直接给客户页", async () => {
    // 组员看得到客户（限定层按项目组放行），会跳客户页；只负责项目的人客户不归他、看不到，进受限客户详情（tests/ent-project-only-customer.test.ts）
    const 丙 = await 造人("bing", "sales");
    const 丙的 = (await prisma.project.create({ data: { name: "丙负责的项目", customerId: 客户, ownerId: 丙.id, creatorId: 甲.id, phase: "商机", node: "需求确认" } })).id;
    忘掉企业版范围();
    const 到 = `/customers/${客户}?project=${丙的}`;
    expect(await 以(丙, () => 项目页去向(丙 as never, 丙的))).toEqual({ 种: "客户页", 到 });
    expect((await 以(丙, () => 项目链接们(丙 as never, [丙的]))).get(丙的)).toBe(到);
    expect(await 打开项目(丙, 丙的)).toBe(`REDIRECT:${到}`);
  });
});
