/**
 * 企业版客户侧清桌面端遗留（2026-10-28）：
 *   - 客户状态（字典 custStatus）：九个新默认；老库还叫旧名的默认项改一次新名，人改过的不动
 *   - 保存 / 行内改：新建给第一项、乱给的拒、清空可以；开关关着不收这个字段
 *   - 渠道：编辑时原来有渠道的不许清空；换的渠道得是启用中的
 *   - 本月成交：一个项目转订单又成功交付，只数一次
 *   - 列表按客户状态筛：开关关着地址栏带了也当没带
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 企业字典, 可选项, 字典定义 } from "@/lib/enterprise/dict";
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { 客户筛选条件 } from "@/app/(app)/customers/query";
import { 项目一段 } from "../src/app/(app)/overview/project-stats";

const 新默认 = ["潜在", "意向", "成交", "交付", "复购", "忠诚", "丢单", "流失", "异常"];
/** 2026-10-29 P13 调了默认顺序（流失放到丢单前面），默认表的序号不动，只改排序 */
const 新顺序 = ["潜在", "意向", "成交", "交付", "复购", "忠诚", "流失", "丢单", "异常"];
let 销售: string;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  销售 = (await prisma.user.create({ data: { email: "s@t", name: "销售", role: "SALES", password: "x" } })).id;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const 新建 = (改: Record<string, unknown> = {}) =>
  saveCustomer({
    name: "测试客户", phone: "13800000001", school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: 销售, channelId: null, referrerCustomerId: null,
    ...改,
  } as Parameters<typeof saveCustomer>[0]);

/** 整表保存：其余照库里的，只改给的几项 */
async function 整表保存(id: string, 改: Record<string, unknown>) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
  const 值 = {
    name: c.name, phone: c.phone, school: c.school, grade: c.grade, major: c.major,
    followStatus: c.followStatus, decisionStatus: c.decisionStatus, expectedSignAt: c.expectedSignAt,
    remark: c.remark, salesOwnerId: c.salesOwnerId, channelId: c.channelId, referrerCustomerId: c.referrerCustomerId,
    channelOwnerId: c.channelOwnerId, custStatus: c.custStatus,
  };
  return saveCustomer({ id, updatedAt: c.updatedAt.toISOString(), base: 值, ...值, ...改 } as Parameters<typeof saveCustomer>[0]);
}
const 状态 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id }, select: { custStatus: true } })).custStatus;

describe("客户状态字典", () => {
  it("新库：九个新默认，按序启用", async () => {
    expect(字典定义.custStatus.默认).toEqual(新默认);
    expect(await 可选项("custStatus")).toEqual(新顺序);
  });

  it("老库还叫旧名的默认项改成同序号新名；人改过名的、自己加的不动；只改一次", async () => {
    const 旧 = 字典定义.custStatus.旧默认!;
    for (const [i, name] of 旧.entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-custStatus-${i}`, kind: "custStatus", name: i === 1 ? "我们改过的" : name, sort: i } });
    }
    await prisma.entDictItem.create({ data: { kind: "custStatus", name: "自己加的", sort: 99 } });
    const 名 = (await 企业字典("custStatus")).map((x) => x.name);
    expect(名).toEqual(["潜在", "我们改过的", ...新顺序.slice(2), "自己加的"]);
    // 改完再把某项改回旧名，不会再被换
    await prisma.entDictItem.update({ where: { id: "dict-custStatus-0" }, data: { name: 旧[0] } });
    expect((await 企业字典("custStatus"))[0].name).toBe(旧[0]);
  });

  it("开关关着：可选项是空的，一行不建", async () => {
    vi.unstubAllEnvs();
    expect(await 可选项("custStatus")).toEqual([]);
    expect(await prisma.entDictItem.count({ where: { kind: "custStatus" } })).toBe(0);
  });
});

describe("保存客户状态", () => {
  it("新建没给：第一项「潜在」；给了合法的照存；乱给的拒", async () => {
    const a = await 新建();
    expect(a.ok).toBe(true);
    if (a.ok) expect(await 状态(a.id)).toBe("潜在");
    const b = await 新建({ phone: "13800000002", custStatus: "意向" });
    if (b.ok) expect(await 状态(b.id)).toBe("意向");
    else throw new Error(b.error);
    const c = await 新建({ phone: "13800000003", custStatus: "胡写的" });
    expect(c).toMatchObject({ ok: false, error: "客户状态「胡写的」不在可选范围内，请刷新后重选" });
  });

  it("编辑：没交保留原值；清空可以；库里原值停用了原样交回也认", async () => {
    const a = await 新建({ custStatus: "成交" });
    if (!a.ok) throw new Error(a.error);
    await prisma.entDictItem.updateMany({ where: { kind: "custStatus", name: "成交" }, data: { active: false } });
    expect((await 整表保存(a.id, { remark: "改备注" })).ok).toBe(true);
    expect(await 状态(a.id)).toBe("成交");
    expect((await 整表保存(a.id, { custStatus: null })).ok).toBe(true);
    expect(await 状态(a.id)).toBe(null);
  });

  it("行内改：合法照改、乱给的拒、清空可以", async () => {
    const a = await 新建();
    if (!a.ok) throw new Error(a.error);
    expect(await patchCustomer(a.id, "custStatus", "复购")).toMatchObject({ ok: true });
    expect(await 状态(a.id)).toBe("复购");
    expect(await patchCustomer(a.id, "custStatus", "胡写的")).toMatchObject({ ok: false });
    expect(await patchCustomer(a.id, "custStatus", null)).toMatchObject({ ok: true });
    expect(await 状态(a.id)).toBe(null);
  });

  it("开关关着：保存时交了也不存，行内改直接拒", async () => {
    vi.unstubAllEnvs();
    const a = await 新建({ custStatus: "意向" });
    if (!a.ok) throw new Error(a.error);
    expect(await 状态(a.id)).toBe(null);
    expect(await patchCustomer(a.id, "custStatus", "意向")).toEqual({ ok: false, error: "这个字段不能在这里改" });
  });
});

describe("渠道", () => {
  // 2026-10-29 定稿 P5 待定 18：客户来源记第一次带来的渠道，建好之后不能改（原来「换成启用的可以」随之作废）
  it("原来有渠道的不许清空、不许换；新建时选停用的渠道拒", async () => {
    const 甲 = (await prisma.channel.create({ data: { name: "甲渠道", channelOwnerId: 销售 } })).id;
    const 乙 = (await prisma.channel.create({ data: { name: "乙渠道", active: false, channelOwnerId: 销售 } })).id;
    const 丙 = (await prisma.channel.create({ data: { name: "丙渠道", channelOwnerId: 销售 } })).id;
    const a = await 新建({ channelId: 甲 });
    if (!a.ok) throw new Error(a.error);
    expect(await 整表保存(a.id, { channelId: null })).toEqual({ ok: false, error: "请选择渠道" });
    expect(await 整表保存(a.id, { channelId: 丙 })).toEqual({ ok: false, error: "客户来源记的是第一次带来的渠道，建好之后不能改" });
    expect((await 整表保存(a.id, { channelId: 甲 })).ok).toBe(true);
    expect(await 新建({ name: "另一位", phone: "13800000002", channelId: 乙 })).toEqual({ ok: false, error: "这个渠道不存在或已停用，请换一个" });
  });

  it("开关关着：清空渠道照旧放行", async () => {
    vi.unstubAllEnvs();
    const 甲 = (await prisma.channel.create({ data: { name: "甲渠道", channelOwnerId: 销售 } })).id;
    const a = await 新建({ channelId: 甲 });
    if (!a.ok) throw new Error(a.error);
    expect((await 整表保存(a.id, { channelId: null })).ok).toBe(true);
  });
});

describe("本月成交（按项目）", () => {
  it("转订单和成功交付在同一段里的同一个项目只数一次", async () => {
    const 客户 = await prisma.customer.create({ data: { name: "云帆科技", phone: "13900000001", salesOwnerId: 销售 } });
    const 起 = new Date(2026, 8, 1), 止 = new Date(2026, 8, 30, 23, 59, 59, 999), 日 = (n: number) => new Date(2026, 8, n, 10);
    const 建 = (o: { name: string; phase: string; node: string; result?: string; closedAt?: Date }) =>
      prisma.project.create({ data: { customerId: 客户.id, creatorId: 销售, ownerId: 销售, createdAt: new Date(2026, 6, 1), ...o } });
    const 转订单 = (projectId: string, at: Date) =>
      prisma.projectNodeLog.create({ data: { projectId, userId: 销售, fromPhase: "商机", fromNode: "首款支付", toPhase: "订单", toNode: "生产备货", at } });
    const a = await 建({ name: "a", phase: "订单", node: "尾款结算", result: "成功交付", closedAt: 日(20) });
    await 转订单(a.id, 日(5));
    const b = await 建({ name: "b", phase: "订单", node: "生产备货" });
    await 转订单(b.id, 日(6));
    await 建({ name: "c", phase: "订单", node: "尾款结算", result: "成功交付", closedAt: 日(25) });
    await 建({ name: "d", phase: "商机", node: "明确需求", result: "丢单", closedAt: 日(26) });
    const 数 = await 项目一段(起, 止, "day", "CNY");
    expect(数.合计).toMatchObject({ 转订单: 2, 成功交付: 2 });
    expect(数.成交).toBe(3);
  });
});

describe("列表按客户状态筛", () => {
  it("企业版认；开关关着当没带", async () => {
    expect(await 客户筛选条件({ custStatus: "意向" })).toMatchObject({ custStatus: "意向" });
    vi.unstubAllEnvs();
    expect(await 客户筛选条件({ custStatus: "意向" })).not.toHaveProperty("custStatus");
  });
});
