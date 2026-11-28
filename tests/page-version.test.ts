/**
 * 「这页数据变了没」（PR-D，lib/page-version.ts）：客户页版本随主体、沟通、负责人变；
 * 被转走（看不到）→ gone；项目页随节点 / 负责人变；列表随总数变。销售、销管两个身份。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 页面版本 } from "@/lib/page-version";
import { 存联系人号码 } from "@/lib/enterprise/customer-v2-db";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, managerId: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  return { id: u.id, name: key, email: `${key}@x`, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
let 销管: 人, 销售: 人;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  忘掉企业版范围();
  销管 = await 造人("mgr", "sales_mgr");
  销售 = await 造人("s1", "sales", 销管.id);
});

describe("页面版本", () => {
  it("客户：没变同值；改客户 / 加沟通 / 换负责人都变；不存在 = gone", async () => {
    const c = await prisma.customer.create({ data: { name: "甲", phone: "13900000001", salesOwnerId: 销售.id } });
    const v0 = await 以(销售, () => 页面版本("customer", c.id, new URLSearchParams()));
    expect(v0).toMatch(/^[0-9a-f]{16}$/);
    expect(await 以(销售, () => 页面版本("customer", c.id, new URLSearchParams()))).toBe(v0);
    await prisma.followUp.create({ data: { customerId: c.id, type: "PHONE", title: "t", content: "c", ownerId: 销售.id } });
    const v1 = await 以(销售, () => 页面版本("customer", c.id, new URLSearchParams()));
    expect(v1).not.toBe(v0);
    await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 销管.id } });
    const v2 = await 以(销管, () => 页面版本("customer", c.id, new URLSearchParams()));
    expect(v2).not.toBe(v1);
    expect(await 以(销售, () => 页面版本("customer", "nope", new URLSearchParams()))).toBe("gone");
  });
  it("客户被转走：原负责人再问，值和转走前不同（前端据此刷新、页面服务端判无权）", async () => {
    const c = await prisma.customer.create({ data: { name: "乙", phone: "13900000002", salesOwnerId: 销售.id } });
    const 前 = await 以(销售, () => 页面版本("customer", c.id, new URLSearchParams()));
    await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 销管.id } });
    const 后 = await 以(销售, () => 页面版本("customer", c.id, new URLSearchParams()));
    expect(后).not.toBe(前);
  });
  it("客户列表：多一位客户值就变", async () => {
    await prisma.customer.create({ data: { name: "丙", phone: "13900000003", salesOwnerId: 销售.id } });
    const v0 = await 以(销售, () => 页面版本("customer-list", "", new URLSearchParams()));
    await prisma.customer.create({ data: { name: "丁", phone: "13900000004", salesOwnerId: 销售.id } });
    expect(await 以(销售, () => 页面版本("customer-list", "", new URLSearchParams()))).not.toBe(v0);
  });
  it("客户：改联系人号码（删了重建）/ 加计划 / 加待办 / 加合同 / 换渠道负责人 / 加关联客户，版本都变", async () => {
    const c = await prisma.customer.create({ data: { name: "戊", phone: "13900000005", salesOwnerId: 销售.id } });
    const 另 = await prisma.customer.create({ data: { name: "己", phone: "13900000006", salesOwnerId: 销售.id } });
    const ct = await prisma.contact.create({ data: { customerId: c.id, name: "联", phone: "13900000007" } });
    const 版 = () => 以(销售, () => 页面版本("customer", c.id, new URLSearchParams()));
    const 行 = (n: string) => [{ kind: "phone", value: n, numberKey: n, region: null }];
    await prisma.$transaction((tx) => 存联系人号码(tx, c.id, ct.id, 行("13900000007")));
    let 前 = await 版();
    expect(await 版()).toBe(前);
    await new Promise((r) => setTimeout(r, 5));
    await prisma.$transaction((tx) => 存联系人号码(tx, c.id, ct.id, 行("13900000008")));
    let 后 = await 版();
    expect(后).not.toBe(前); // 改号码：条数没变，靠最新 createdAt
    前 = 后;
    await prisma.followPlan.create({ data: { customerId: c.id, ownerId: 销售.id, subject: "p", plannedAt: new Date() } });
    后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.task.create({ data: { customerId: c.id, ownerId: 销售.id, title: "t" } });
    后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.customer.update({ where: { id: c.id }, data: { channelOwnerId: 销管.id } });
    后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.entCustomerLink.create({ data: { customerId: c.id, otherId: 另.id, userId: 销售.id } });
    后 = await 版();
    expect(后).not.toBe(前);
  });
  it("客户：换负责人后哈希变（销管看）；写外贸档案顺带推客户 updatedAt，版本变", async () => {
    const { 写外贸档案 } = await import("@/lib/customer-extra-db");
    const c = await prisma.customer.create({ data: { name: "庚", phone: "13900000009", salesOwnerId: 销售.id } });
    const 版 = () => 以(销管, () => 页面版本("customer", c.id, new URLSearchParams()));
    const 前 = await 版();
    await 写外贸档案(prisma, c.id, { whatsapp: "123" } as never);
    expect(await 版()).not.toBe(前);
  });
  it("项目：加成员 / 加留痕 / 加计划 / 客户转走（客户卡归属）版本都变", async () => {
    const c = await prisma.customer.create({ data: { name: "辛", phone: "13900000010", salesOwnerId: 销售.id } });
    const p = await prisma.project.create({ data: { name: "项", customerId: c.id, ownerId: 销售.id, creatorId: 销售.id } });
    const 版 = () => 以(销售, () => 页面版本("project", p.id, new URLSearchParams()));
    let 前 = await 版();
    expect(await 版()).toBe(前);
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 销管.id } });
    let 后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 销售.id, toPhase: "线索", toNode: "潜客培育", kind: "note" } });
    后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.followPlan.create({ data: { customerId: c.id, projectId: p.id, ownerId: 销售.id, subject: "p", plannedAt: new Date() } });
    后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 销管.id } });
    后 = await 版();
    expect(后).not.toBe(前);
  });
  it("项目：客户进公海 / 被领取（只动公海行、不动客户本身）与联系人变化，项目页版本也变", async () => {
    const c = await prisma.customer.create({ data: { name: "壬", phone: "13900000011", salesOwnerId: 销售.id } });
    const p = await prisma.project.create({ data: { name: "项二", customerId: c.id, ownerId: 销售.id, creatorId: 销售.id } });
    const 版 = () => 以(销售, () => 页面版本("project", p.id, new URLSearchParams()));
    let 前 = await 版();
    await prisma.customerPool.create({ data: { customerId: c.id, userId: 销售.id, reason: "手动" } });
    let 后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.customerPool.deleteMany({ where: { customerId: c.id } });
    await prisma.customerClaim.create({ data: { customerId: c.id, userId: 销售.id } });
    后 = await 版();
    expect(后).not.toBe(前);
    前 = 后;
    await prisma.contact.create({ data: { customerId: c.id, name: "联" } });
    后 = await 版();
    expect(后).not.toBe(前);
  });
});
