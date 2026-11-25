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
 *
 * 历史分析回填的项目（source = 历史分析来源）按 system-created.ts「所有统计都不算」（25E 总控定）：
 * - query_records 查项目表不论按什么条件都排掉；挂在项目下的表（节点记录、卡点、回款……）也只算非回填项目的；
 * - list_projects 的总数、各阶段个数不算它；明细照旧列出（同项目列表 / 公海页），行上标「数据来源：历史分析」并说明不计入；
 * - get_customer 名下项目同样列出带标签，项目个数不算它。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 校验规格, 编译, 说人话 } from "@/lib/agent/query";
import { 不算补建, 不算历史分析, 不进统计, 补建创建人, 历史分析来源, 历史分析留痕人 } from "@/lib/project/system-created";
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

  it("不带创建时间（问现在有多少）补建的照算、只排不进统计的（历史回填 + 仅记录用，X-147）；别的表按创建时间筛也不动", () => {
    const 项目 = 校验规格({ 表: "项目", 条件: [{ 字段: "阶段", 运算: "等于", 值: "线索" }] });
    expect(编译(项目).where).toEqual({ AND: [{ phase: "线索" }, 不进统计] });
    expect(编译(校验规格({ 表: "项目", 条件: [] })).where).toEqual({ AND: [不进统计] });
    const 客户 = 校验规格({ 表: "客户", 条件: [{ 字段: "创建时间", 运算: "不早于", 值: 本月初 }] });
    const 客户and = (编译(客户).where as { AND: unknown[] }).AND;
    expect(客户and).not.toContainEqual(不算补建);
    expect(客户and).not.toContainEqual(不算历史分析);
    expect(客户and).not.toContainEqual(不进统计);
  });

  it("挂在项目下的表只算非回填项目的；节点记录另排回填留痕人", () => {
    for (const 表 of ["卡点", "项目成员", "项目回款", "线索验证", "提成", "提成分配"]) {
      expect((编译(校验规格({ 表, 条件: [] })).where as { AND: unknown[] }).AND, 表).toContainEqual({ project: { is: 不进统计 } });
    }
    const 节点 = (编译(校验规格({ 表: "节点记录", 条件: [] })).where as { AND: unknown[] }).AND;
    expect(节点).toContainEqual({ project: { is: 不进统计 } });
    expect(节点).toContainEqual({ userId: { not: 历史分析留痕人 } });
  });

  it("人话里写明不含补建 / 不含历史回填，过程条上能核对", () => {
    const s = 校验规格({ 表: "项目", 条件: [{ 字段: "创建时间", 运算: "不早于", 值: 本月初 }], 只计数: true });
    expect(说人话(s)).toMatch(/不含补建/);
    const 全部 = 说人话(校验规格({ 表: "项目", 条件: [] }));
    expect(全部).not.toMatch(/补建/);
    expect(全部).toMatch(/不含历史回填/);
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

  it("不按创建时间（现在一共多少个线索）：补建的算、历史回填的不算 → 3 个", async () => {
    const r = await 跑({ 表: "项目", 条件: [{ 字段: "阶段", 运算: "等于", 值: "线索" }], 只计数: true });
    expect((r.data as { 总数: number }).总数).toBe(3);
  });

  it("按阶段分组、列明细：都不含历史回填的", async () => {
    const g = await 跑({ 表: "项目", 条件: [], 分组: "阶段" });
    expect((g.data as { 总数: number; 分组: { 条数: number }[] }).分组).toEqual([expect.objectContaining({ 阶段: "线索", 条数: 3 })]);
    const 列 = await 跑({ 表: "项目", 条件: [], 取: 20 });
    expect((列.data as { 结果: { 项目名称: string }[] }).结果.map((r) => r.项目名称).sort()).toEqual(["真线索一", "真线索二", "补建"].sort());
  });

  it("list_projects：总数、各阶段不算历史回填的；明细照旧列出、标来源，说明不计入", async () => {
    const r = await TOOLS.find((t) => t.name === "list_projects")!.run({}, { userId: 王.id, userName: 王.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never);
    const d = r.data as { 总数: number; 各阶段: Record<string, number>; 项目: { 名称: string; 数据来源?: string }[] };
    expect(d.总数).toBe(3);
    expect(d.各阶段.线索).toBe(3);
    expect(d.项目.map((p) => p.名称).sort()).toEqual(["回填", "补建", "真线索一", "真线索二"].sort());
    expect(d.项目.find((p) => p.名称 === "回填")!.数据来源).toMatch(/历史分析.*不计入/);
    expect(d.项目.find((p) => p.名称 === "真线索一")!.数据来源).toBeUndefined();
    expect(r.summary).toMatch(/^3 个项目/);
    expect(r.summary).toMatch(/另有 1 个历史分析回填.*不计入/);
  });

  it("list_projects 带关键词：数也不算历史回填的", async () => {
    const r = await TOOLS.find((t) => t.name === "list_projects")!.run({ keyword: "甲公司" }, { userId: 王.id, userName: 王.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never);
    expect((r.data as { 总数: number }).总数).toBe(3);
  });
});
