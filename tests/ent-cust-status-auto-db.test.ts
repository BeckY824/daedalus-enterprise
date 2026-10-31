/**
 * 企业版客户状态按项目自动算：读写库这一半（10-30，lib/enterprise/cust-status-auto-db.ts + 各写入口）。
 *   - 重算：存字典这一项「现在的名字」（管理员改了名跟着走）；没项目清成 null；没变的不写
 *   - 写入口跟着算：客户页新建项目、改节点（推进 / 丢单）、回收站恢复（企业版删项目一律拒，M-权限-10）
 *   - 全量重算：分页、返回改了几个
 *   - 开关：项目模式关着、不是企业版，一格不改
 *   - 客户表单：开着时新建不给状态、整表保存不碰、行内改直接拒
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const 开关 = vi.hoisted(() => ({ 项目模式关: false }));

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));
// 企业版锁死项目模式开着；测「项目模式关」只能在这里改 getBusiness 的结果
vi.mock("@/lib/business", async (orig) => {
  const m = await orig<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), ...(开关.项目模式关 ? { projectMode: false } : {}) }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 重算客户状态, 全量重算客户状态, 项目变了重算, 客户状态名们, 客户状态自动 } from "@/lib/enterprise/cust-status-auto-db";
import { 客户状态id } from "@/lib/enterprise/cust-status-auto";
import { 改节点, 删项目 } from "@/lib/project/db";
import { 恢复 } from "@/lib/enterprise/soft-delete";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";

const 老板 = { id: "tester-id", role: "ADMIN" };
let 序 = 0;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  开关.项目模式关 = false;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
});
afterEach(() => { vi.unstubAllEnvs(); 开关.项目模式关 = false; });
afterAll(() => prisma.$disconnect());

async function 客户(custStatus: string | null = null) {
  return (await prisma.customer.create({ data: { name: `测试客户${++序}`, phone: `1380000${String(1000 + 序).slice(-4)}`, salesOwnerId: "tester-id", custStatus } })).id;
}
async function 项目(customerId: string, phase: string, node: string, result: string | null = null) {
  return (await prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId: "tester-id", creatorId: "tester-id", phase, node, result } })).id;
}
const 状态 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id }, select: { custStatus: true } })).custStatus;

describe("重算客户状态", () => {
  it("按项目算、存名字；没项目的清成 null；没变的不写（不碰 updatedAt）", async () => {
    const 甲 = await 客户();
    await 项目(甲, "线索", "潜客培育");
    await 项目(甲, "商机", "共识方案");
    const 乙 = await 客户();
    await 项目(乙, "订单", "尾款结算", "成功交付");
    await 项目(乙, "订单", "尾款结算", "成功交付");
    const 丙 = await 客户("意向");
    expect(await 重算客户状态(prisma, [甲, 乙, 丙, null, 甲])).toBe(3);
    expect([await 状态(甲), await 状态(乙), await 状态(丙)]).toEqual(["意向", "复购", null]);

    const 前 = (await prisma.customer.findUniqueOrThrow({ where: { id: 甲 } })).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    expect(await 重算客户状态(prisma, [甲, 乙, 丙])).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 甲 } })).updatedAt).toEqual(前);
  });

  it("软删的项目不算", async () => {
    const 甲 = await 客户();
    const p = await 项目(甲, "订单", "尾款结算", "成功交付");
    await 项目(甲, "线索", "潜客培育");
    await prisma.project.update({ where: { id: p }, data: { deletedAt: new Date() } });
    await 重算客户状态(prisma, [甲]);
    expect(await 状态(甲)).toBe("潜在");
  });

  it("字典改了名：存新名字；字典表还没这一项用默认名", async () => {
    expect(await 客户状态名们()).toEqual(["潜在", "意向", "成交", "交付", "复购", "忠诚", "丢单", "流失", "异常"]);
    await prisma.entDictItem.create({ data: { id: 客户状态id(1), kind: "custStatus", name: "有意向", sort: 1 } });
    const 甲 = await 客户();
    await 项目(甲, "商机", "明确需求");
    await 重算客户状态(prisma, [甲]);
    expect(await 状态(甲)).toBe("有意向");
  });
});

describe("写入口跟着算", () => {
  it("客户页新建项目：潜在", async () => {
    const 甲 = await 客户();
    const r = await 给客户建项目({
      customerId: 甲,
      项目: { name: "新项目", ownerId: "tester-id" },
      跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-28 10:00", 节点: "潜客培育", 明确回复: true },
    } as Parameters<typeof 给客户建项目>[0]);
    expect(r.ok).toBe(true);
    expect(await 状态(甲)).toBe("潜在");
  });

  it("改节点：推进到首款支付 = 成交；点丢单 = 丢单", async () => {
    const 甲 = await 客户();
    const p = await 项目(甲, "商机", "明确需求");
    expect(await 改节点(老板, p, { phase: "商机", node: "共识方案" })).toMatchObject({ ok: true });
    expect(await 状态(甲)).toBe("意向");
    expect(await 改节点(老板, p, { phase: "商机", node: "共识方案", result: "丢单" }, { 备注: "不要了" })).toMatchObject({ ok: true });
    expect(await 状态(甲)).toBe("丢单");
  });

  it("删项目被拒（M-权限-10）状态不动；回收站里的项目不算、恢复回来又是交付", async () => {
    const 甲 = await 客户();
    const 交 = await 项目(甲, "订单", "尾款结算", "成功交付");
    await 项目(甲, "线索", "潜客培育");
    await 项目变了重算([甲]);
    expect(await 状态(甲)).toBe("交付");
    expect(await 删项目(老板, 交)).toMatchObject({ ok: false });
    expect(await 状态(甲)).toBe("交付");
    // 企业版项目只会随客户一起进回收站；这里直接写 deletedAt 造一个回收站里的项目
    await prisma.project.update({ where: { id: 交 }, data: { deletedAt: new Date() } });
    await 项目变了重算([甲]);
    expect(await 状态(甲)).toBe("潜在");
    expect(await 恢复(老板, "Project", 交)).toMatchObject({ ok: true });
    expect(await 状态(甲)).toBe("交付");
  });
});

describe("全量重算", () => {
  it("分页走完，返回改了几个", async () => {
    const 已对 = await 客户("潜在");
    await 项目(已对, "线索", "潜客培育");
    const 要改 = await 客户("意向");
    await 项目(要改, "订单", "物流运输", "异常状态");
    const 没项目 = await 客户("成交");
    const 删了的 = await 客户("意向");
    await prisma.customer.update({ where: { id: 删了的 }, data: { deletedAt: new Date() } });
    expect(await 全量重算客户状态()).toBe(2);
    expect([await 状态(已对), await 状态(要改), await 状态(没项目), await 看已删(() => 状态(删了的))]).toEqual(["潜在", "异常", null, "意向"]);
    expect(await 全量重算客户状态()).toBe(0);
  });
});

describe("开关关着一格不改", () => {
  it("项目模式关：改节点、全量、项目变了重算都不动客户状态", async () => {
    开关.项目模式关 = true;
    expect(await 客户状态自动()).toBe(false);
    const 甲 = await 客户("忠诚");
    const p = await 项目(甲, "商机", "明确需求");
    expect(await 改节点(老板, p, { phase: "商机", node: "共识方案" })).toMatchObject({ ok: true });
    expect(await 项目变了重算([甲])).toBe(0);
    expect(await 全量重算客户状态()).toBe(0);
    expect(await 状态(甲)).toBe("忠诚");
  });

  it("不是企业版：改节点不动客户状态", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 客户状态自动()).toBe(false);
    const 甲 = await 客户("忠诚");
    const p = await 项目(甲, "商机", "明确需求");
    expect(await 改节点(老板, p, { phase: "商机", node: "共识方案" })).toMatchObject({ ok: true });
    expect(await 全量重算客户状态()).toBe(0);
    expect(await 状态(甲)).toBe("忠诚");
  });
});

describe("客户表单（自动算开着）", () => {
  const 新建 = (改: Record<string, unknown> = {}) =>
    saveCustomer({
      name: `测试客户${++序}`, phone: `1390000${String(1000 + 序).slice(-4)}`, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
      ...改,
    } as Parameters<typeof saveCustomer>[0]);

  it("新建不给状态（交了也不收）；整表保存交了别的值也不碰；行内改直接拒", async () => {
    const a = await 新建({ custStatus: "意向" });
    if (!a.ok) throw new Error(a.error);
    expect(await 状态(a.id)).toBe(null);
    await 项目(a.id, "商机", "首款支付");
    await 项目变了重算([a.id]);
    expect(await 状态(a.id)).toBe("成交");

    const c = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
    const 值 = {
      name: c.name, phone: c.phone, school: c.school, grade: c.grade, major: c.major,
      followStatus: c.followStatus, decisionStatus: c.decisionStatus, expectedSignAt: c.expectedSignAt,
      remark: c.remark, salesOwnerId: c.salesOwnerId, channelId: c.channelId, referrerCustomerId: c.referrerCustomerId,
      channelOwnerId: c.channelOwnerId,
    };
    const r = await saveCustomer({ id: a.id, updatedAt: c.updatedAt.toISOString(), base: 值, ...值, remark: "改备注", custStatus: "忠诚" } as Parameters<typeof saveCustomer>[0]);
    expect(r.ok).toBe(true);
    expect(await 状态(a.id)).toBe("成交");

    expect(await patchCustomer(a.id, "custStatus", "忠诚")).toEqual({ ok: false, error: "客户状态按项目自动算，不能手改" });
    expect(await 状态(a.id)).toBe("成交");
  });
});
