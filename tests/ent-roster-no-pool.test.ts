/**
 * 客户详情页左侧窄名单不含公海（P-看-03「公海只在公海页签出现」，11-11 实点）：
 * 原来头部总数 = 自己的 + 全部公海，「全部」列的是最近跟进的公海客户，「我的」只在那 50 位里筛成空。
 * 现在总数 = 客户列表「客户」页签的数，「全部」不含公海，「我的」另取自己负责的。销售、销管、系统管理员各一条。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 学员名单 } from "@/app/(app)/@pane/panes";
import { 客户页签数 } from "@/lib/pool-db";
import { 客户筛选条件 } from "@/app/(app)/customers/query";
import type { CustomerRosterData } from "@/components/CustomerRoster";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 系统管理员: 人, 销管: 人, 销售: 人, 别的销售: 人;
const 公海ids: string[] = [];
const 名下: Record<string, string[]> = {};

const 造人 = async (key: string, name: string, role: string, bizRole: string, managerId: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
let 序号 = 0;
const 建客户 = async (salesOwnerId: string, 天前: number) => {
  序号 += 1;
  const c = await prisma.customer.create({
    data: { name: `客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId, lastFollowAt: new Date(Date.now() - 天前 * 86400_000) },
  });
  (名下[salesOwnerId] ??= []).push(c.id);
  return c;
};
const 名单 = async (u: 人) => ((await 以(u, () => 学员名单())) as ReactElement<{ data: CustomerRosterData }>).props.data;
const 列表总数 = (u: 人) => 以(u, async () => prisma.customer.count({ where: await 客户筛选条件({}, u.id) }));

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  序号 = 0;
  公海ids.length = 0;
  for (const k of Object.keys(名下)) delete 名下[k];
  系统管理员 = await 造人("dir", "系统管理员", "ADMIN", "director");
  销管 = await 造人("mgr", "销管", "SALES", "sales_mgr");
  销售 = await 造人("s1", "销售", "SALES", "sales", 销管.id);
  别的销售 = await 造人("s2", "别的销售", "SALES", "sales");
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
  // 自己的客户跟进旧（10 天前起），公海客户跟进新（今天），量超过 50：原来「全部」那 50 位全是公海的
  for (let i = 0; i < 3; i++) await 建客户(销售.id, 10 + i);
  for (let i = 0; i < 2; i++) await 建客户(销管.id, 20 + i);
  for (let i = 0; i < 2; i++) await 建客户(别的销售.id, 30 + i);
  const 占位 = await 无负责人占位Id(prisma);
  for (let i = 0; i < 55; i++) {
    const c = await 建客户(占位, 0);
    await prisma.customerPool.create({ data: { customerId: c.id, reason: "手动" } });
    公海ids.push(c.id);
  }
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); 忘掉企业版范围(); });

describe("客户详情窄名单不含公海（P-看-03）", () => {
  it("销售：总数 = 客户列表总数 = 自己的 3 位；全部、我的都不含公海；我的就是自己负责的", async () => {
    const d = await 名单(销售);
    const 列表 = await 列表总数(销售);
    expect(d.total).toBe(列表);
    expect(d.total).toBe(3);
    expect(d.total).toBe((await 以(销售, 客户页签数)).非公海);
    expect(d.rows.map((r) => r.id).sort()).toEqual([...名下[销售.id]].sort());
    expect(d.rows.some((r) => 公海ids.includes(r.id))).toBe(false);
    expect(d.mineRows?.map((r) => r.id).sort()).toEqual([...名下[销售.id]].sort());
  });

  it("销管：总数 = 客户列表总数 = 自己 + 实线下属；不含公海；我的只有自己负责的", async () => {
    const d = await 名单(销管);
    expect(d.total).toBe(await 列表总数(销管));
    expect(d.total).toBe(5);
    expect(d.rows.some((r) => 公海ids.includes(r.id))).toBe(false);
    expect(d.rows.map((r) => r.id).sort()).toEqual([...名下[销管.id], ...名下[销售.id]].sort());
    expect(d.mineRows?.map((r) => r.id).sort()).toEqual([...名下[销管.id]].sort());
  });

  it("系统管理员（不限定，走 Prisma）：总数 = 客户列表总数 = 全部非公海；不含公海", async () => {
    const d = await 名单(系统管理员);
    expect(d.total).toBe(await 列表总数(系统管理员));
    expect(d.total).toBe(7);
    expect(d.rows).toHaveLength(7);
    expect(d.rows.some((r) => 公海ids.includes(r.id))).toBe(false);
    expect(d.mineRows).toEqual([]);
  });
});
