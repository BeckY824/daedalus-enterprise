/**
 * 批次 20b：query_records 在 c1 上 79 次里 26 次「查询写得不对」（33%）。
 *
 * 钉的是：
 * - 意思唯一的写法先规整、不白跑一趟：英文键名、条件给成一个对象 / JSON 串 / {"字段": 值}、
 *   运算的常见别写（=、in、contains、>= 对日期）、字段的同义写法（创建时间 ↔ 建档时间）、表名带「表」字、等于给数组
 * - 意思不唯一或写错的照旧报错，但错误里写清哪一处错、能填什么（字段带类型、日期怎么写、枚举的取值）
 * - 只用项目的企业版查线索 / 商机 / 签约表：挡回，指去「项目」表按「阶段」筛；工具说明里也不列这三张
 * - 工具回话除了 error 还带一句「照着只改那一处再调一次」
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 校验规格 } from "@/lib/agent/query";
import { TOOLS, query_records说明 } from "@/lib/agent/tools";
import { 这一家的工具 } from "@/lib/agent/run";
import { SCHEMAS } from "@/lib/agent/schemas";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

const b = DEFAULT_BUSINESS;
const 错话 = (raw: unknown, 选项: { 只用项目?: boolean } = {}) => {
  try {
    校验规格(raw, b, 选项);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("没报错");
};

describe("能确定意思的写法直接认（20b）", () => {
  it("英文键名、条件给成一个对象", () => {
    const s = 校验规格({ table: "客户", conditions: { field: "跟进状态", op: "=", value: "意向较高" }, limit: 5 }, b);
    expect(s).toMatchObject({ 表: "客户", 取: 5, 条件: [{ 字段: "跟进状态", 运算: "等于", 值: "意向较高" }] });
  });

  it("条件给成 JSON 字符串、给成 {字段: 值}", () => {
    expect(校验规格({ 表: "客户", 条件: '[{"字段":"城市","运算":"包含","值":"杭州"}]' }, b).条件).toEqual([{ 字段: "城市", 运算: "包含", 值: "杭州" }]);
    expect(校验规格({ 表: "客户", 条件: { 城市: "杭州", 跟进状态: ["意向较高", "已签约"] } }, b).条件).toEqual([
      { 字段: "城市", 运算: "等于", 值: "杭州" },
      { 字段: "跟进状态", 运算: "属于", 值: ["意向较高", "已签约"] },
    ]);
  });

  it("表名带「表」、别称；字段同义写法；日期用 >= / 之后", () => {
    const s = 校验规格({ 表: "客户表", 条件: [{ 字段: "创建时间", 运算: ">=", 值: "2026-11-01" }, { 字段: "负责人", 运算: "等于", 值: "张三" }] }, b);
    expect(s.表).toBe("客户");
    expect(s.条件).toEqual([
      { 字段: "建档时间", 运算: "不早于", 值: "2026-11-01" },
      { 字段: "销售负责人", 运算: "等于", 值: "张三" },
    ]);
    expect(校验规格({ 表: "沟通记录", 条件: [{ 字段: "发生时间", 运算: "之前", 值: "2026-11-01" }] }, b)).toMatchObject({ 表: "跟进记录", 条件: [{ 运算: "不晚于" }] });
    expect(校验规格({ 表: "项目", 条件: [{ 字段: "建档时间", 运算: "最近", 值: "30天" }] }, b).条件).toEqual([{ 字段: "创建时间", 运算: "最近天数", 值: 30 }]);
  });

  it("等于给了一串值 = 属于；固定取值写成「A、B」也拆开", () => {
    expect(校验规格({ 表: "客户", 条件: [{ 字段: "跟进状态", 运算: "等于", 值: ["意向较高", "已签约"] }] }, b).条件[0]).toMatchObject({ 运算: "属于", 值: ["意向较高", "已签约"] });
    expect(校验规格({ 表: "客户", 条件: [{ 字段: "跟进状态", 运算: "in", 值: "意向较高、已签约" }] }, b).条件[0]).toMatchObject({ 运算: "属于", 值: ["意向较高", "已签约"] });
  });

  it("排序只给字段名；只计数给字符串", () => {
    expect(校验规格({ 表: "客户", 排序: "建档时间", 只计数: "true" }, b)).toMatchObject({ 排序: { 字段: "建档时间", 降序: true }, 只计数: true });
    expect(校验规格({ 表: "客户", sort: { field: "最近跟进", desc: false } }, b).排序).toEqual({ 字段: "最近跟进", 降序: false });
  });
});

describe("写错时说清哪一处错、能填什么（20b）", () => {
  it("字段不存在：列出能用的字段和类型", () => {
    const s = 错话({ 表: "客户", 条件: [{ 字段: "星座", 运算: "等于", 值: "x" }] });
    expect(s).toContain("没有「星座」这个字段");
    expect(s).toContain("跟进状态（枚举）");
    expect(s).toContain("建档时间（日期）");
  });

  it("运算认不出：列出全部运算和这个字段能用的", () => {
    const s = 错话({ 表: "客户", 条件: [{ 字段: "城市", 运算: "约等于", 值: "杭州" }] });
    expect(s).toContain("不认识的运算「约等于」");
    expect(s).toContain("能用：包含、等于");
  });

  it("日期用等于：说清某一天写两条、最近 N 天用最近天数", () => {
    const s = 错话({ 表: "客户", 条件: [{ 字段: "建档时间", 运算: "等于", 值: "2026-11-01" }] });
    expect(s).toContain("不早于 YYYY-MM-DD、不晚于 YYYY-MM-DD");
    expect(s).toContain("最近天数");
  });

  it("固定取值用包含：说用等于 / 属于，并列出取值", () => {
    const s = 错话({ 表: "客户", 条件: [{ 字段: "跟进状态", 运算: "包含", 值: "意向" }] });
    expect(s).toContain("用「等于」或「属于」");
    expect(s).toContain("意向较高");
  });

  it("表名不对：列出能查的表", () => {
    expect(错话({ 表: "客户档案" })).toContain("「表」只能填其中之一");
  });

  it("只用项目：查线索 / 商机 / 签约表挡回，指去项目表按阶段筛", () => {
    for (const 表 of ["线索", "商机", "签约", "订单"]) {
      const s = 错话({ 表 }, { 只用项目: true });
      expect(s).toContain("只用项目");
      expect(s).toContain("「项目」表");
      expect(s).toContain('"字段":"阶段"');
    }
    // 不是只用项目的家照常能查
    expect(校验规格({ 表: "线索" }, b).表).toBe("线索");
  });
});

describe("工具这一层（20b）", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("business", { projectMode: true });
    invalidateSettingsCache();
  });
  afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("出错时回话带 error 和「照着只改那一处」", async () => {
    const u = await prisma.user.create({ data: { email: "a", name: "甲", title: "", role: "ADMIN", password: "x" } });
    const r = await TOOLS.find((t) => t.name === "query_records")!.run({ 表: "线索" }, { userId: u.id, userName: u.name, b: { ...b, projectMode: true }, recordOffset: 0, proposals: [] } as never);
    expect(r.summary).toBe("查询写得不对");
    expect((r.data as { error: string }).error).toContain("「项目」表");
    expect((r.data as { 怎么改: string }).怎么改).toContain("只改错的那一处");
  });

  it("只用项目时工具说明不列线索 / 商机 / 签约表，写明规则和例子", () => {
    const { TOOL_MAP } = 这一家的工具({ projectMode: true }, true);
    const d = TOOL_MAP.get("query_records")!.description;
    expect(d).toBe(query_records说明(true));
    // 「线索验证」表照列；单独的线索 / 商机 / 签约不列
    const 表段 = (x: string) => x.match(/「表」只能填 ([^；]*) 之一/)![1].split("、");
    expect(表段(d)).not.toContain("线索");
    expect(表段(d)).not.toContain("商机");
    expect(表段(d)).not.toContain("签约");
    expect(表段(d)).toContain("线索验证");
    expect(d).toContain("日期字段只能用 不早于 / 不晚于 / 最近天数");
    expect(d).toContain('"表":"项目"');
    // 不是只用项目：照列
    expect(表段(这一家的工具({ projectMode: false }, false).TOOL_MAP.get("query_records")!.description)).toContain("线索");
  });

  it("原生调用的参数表：表、运算是枚举", () => {
    const p = SCHEMAS.query_records.properties as Record<string, { enum?: string[]; items?: { properties: Record<string, { enum?: string[] }> } }>;
    expect(p.表.enum).toContain("项目");
    expect(p.条件.items!.properties.运算.enum).toEqual(["包含", "等于", "不等于", "属于", "大于", "小于", "不早于", "不晚于", "最近天数", "为空", "非空"]);
  });
});
