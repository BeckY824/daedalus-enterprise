/**
 * AI 助手问「本月新增多少项目」不算补建的项目（11-17 复盘第 9 类）。
 *
 * query_records 查「项目」表按「创建时间」筛，以前照建档时间直接数：
 * 补零项目客户的脚本补建的潜客培育项目（creatorId = 补建创建人，createdAt 记客户建档时间）、
 * 「历史沟通分析」回填的（source = 历史分析来源）都会被数进去，补一次就把那几个月的「新增」撑大。
 * 口径同数据页 / 首页卡「本月新增」（lib/project/system-created.ts 的 不算补建）：
 * - 项目表带了「创建时间」条件 = 问的是「新建」，排掉补建和历史分析回填的；
 * - 不带创建时间（问现在有多少、在哪个阶段）照旧全算，别的表不受影响；
 * - 过程条上那句人话写明「不含补建」，人能核对。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 校验规格, 编译, 说人话 } from "@/lib/agent/query";
import { 不算补建, 补建创建人, 历史分析来源 } from "@/lib/project/system-created";
import { dayjs } from "@/lib/utils";

const 本月初 = dayjs().startOf("month").format("YYYY-MM-DD");

describe("编译：项目表按创建时间筛 = 问新建，排掉补建", () => {
  it("带创建时间：where 里并上 不算补建", () => {
    const s = 校验规格({ 表: "项目", 条件: [{ 字段: "创建时间", 运算: "不早于", 值: 本月初 }], 只计数: true });
    const and = (编译(s).where as { AND: unknown[] }).AND;
    expect(and).toContainEqual(不算补建);
  });

  it("最近天数、按建档时间这种叫法也算", () => {
    const s = 校验规格({ 表: "项目", 条件: [{ 字段: "建档时间", 运算: "最近天数", 值: 30 }] });
    expect((编译(s).where as { AND: unknown[] }).AND).toContainEqual(不算补建);
  });

  it("不带创建时间（问现在有多少）照旧全算；别的表按创建时间筛也不动", () => {
    const 项目 = 校验规格({ 表: "项目", 条件: [{ 字段: "阶段", 运算: "等于", 值: "线索" }] });
    expect(编译(项目).where).toEqual({ AND: [{ phase: "线索" }] });
    const 客户 = 校验规格({ 表: "客户", 条件: [{ 字段: "创建时间", 运算: "不早于", 值: 本月初 }] });
    expect((编译(客户).where as { AND: unknown[] }).AND).not.toContainEqual(不算补建);
  });

  it("人话里写明不含补建，过程条上能核对", () => {
    const s = 校验规格({ 表: "项目", 条件: [{ 字段: "创建时间", 运算: "不早于", 值: 本月初 }], 只计数: true });
    expect(说人话(s)).toMatch(/不含补建/);
    expect(说人话(校验规格({ 表: "项目", 条件: [] }))).not.toMatch(/补建/);
  });
});

describe("query_records 实查：本月新增多少项目", () => {
  let 王: { id: string; name: string };

  beforeEach(async () => {
    await resetDb();
    王 = await prisma.user.create({ data: { email: "w@t", password: "x", name: "王", role: "ADMIN" } });
    const 客户 = await prisma.customer.create({ data: { name: "甲公司", phone: "13900000001", salesOwnerId: 王.id } });
    // 真新建的 2 个
    await prisma.project.create({ data: { customerId: 客户.id, name: "真线索一", phase: "线索", ownerId: 王.id, creatorId: 王.id } });
    await prisma.project.create({ data: { customerId: 客户.id, name: "真线索二", phase: "线索", ownerId: 王.id, creatorId: 王.id } });
    // 补建的潜客培育（createdAt 落在本月：客户本月建档）
    await prisma.project.create({ data: { customerId: 客户.id, name: "补建", phase: "线索", node: "潜客培育", ownerId: 王.id, creatorId: 补建创建人 } });
    // 历史分析回填的，creatorId 不是 system 也按来源排
    await prisma.project.create({ data: { customerId: 客户.id, name: "回填", phase: "线索", ownerId: 王.id, creatorId: 王.id, source: 历史分析来源, importBatch: "b1" } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const 跑 = (args: Record<string, unknown>) =>
    TOOLS.find((t) => t.name === "query_records")!.run(args, { userId: 王.id, userName: 王.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never);

  it("按创建时间数：只数真新建的 2 个", async () => {
    const r = await 跑({ 表: "项目", 条件: [{ 字段: "创建时间", 运算: "不早于", 值: 本月初 }], 只计数: true });
    expect((r.data as { 总数: number }).总数).toBe(2);
    expect(r.summary).toMatch(/不含补建/);
  });

  it("不按创建时间（现在一共多少个线索）：4 个都算", async () => {
    const r = await 跑({ 表: "项目", 条件: [{ 字段: "阶段", 运算: "等于", 值: "线索" }], 只计数: true });
    expect((r.data as { 总数: number }).总数).toBe(4);
  });
});
