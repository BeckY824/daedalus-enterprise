/**
 * 渠道两层的统计、导入、导出（11-10，P-渠道-01 附.5「统计、导入导出按两层」+ P-渠道-06 历史渠道新数据不得选）：
 * - 渠道页「按主渠道」看：子渠道行按主渠道并成一行（按主渠道汇总）；
 * - 客户导入认「主渠道」「子渠道」两列，拼回全称；只有子渠道、历史渠道都留空并进备注；
 * - 企业版客户导出把来源拆成主渠道、子渠道两列，原样导回来落回同一个渠道。
 */
import { describe, it, expect } from "vitest";
import { 按主渠道汇总, type 主渠道行 } from "@/lib/enterprise/channel-main-core";
import type { 渠道统计 } from "@/lib/enterprise/channel-stats";
import { 摊开 } from "@/lib/import/plan";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { 客户导出表, 拆导出渠道, type 导出行 } from "@/app/(app)/customers/export-table";
import { DEFAULT_BUSINESS, BUSINESS_PRESETS } from "@/lib/business-config";

const 统 = (x: Partial<渠道统计>): 渠道统计 => ({
  关联线索: 0, 有效线索: 0, 关联商机: 0, 关联订单: 0, 关联项目: 0, 累计成交: [], 当前投入: [], 产出比: null, 产出比说明: "还没录投入",
  累计运营天数: 0, 线索转商机: { 分子: 0, 分母: 0, 比例: null }, 商机转订单: { 分子: 0, 分母: 0, 比例: null }, ...x,
});
const 主 = (x: Partial<主渠道行> & { id: string; name: string }): 主渠道行 => ({ allowSub: true, selfDev: false, category: null, active: true, sort: 0, ...x });

describe("渠道页按主渠道统计", () => {
  it("挂了主渠道的按主渠道 id 并；没挂的老渠道按全称前半段并；个数相加、子渠道数数对", () => {
    const 主们 = [主({ id: "m1", name: "展会" }), 主({ id: "m2", name: "旧平台", category: "历史渠道", active: true })];
    const 行 = 按主渠道汇总([
      { name: "展会|2026广交会", platform: "展会", mainId: "m1", active: true, 统计: 统({ 关联线索: 2, 关联项目: 2 }) },
      { name: "展会|2025广交会", platform: "展会", mainId: "m1", active: false, 统计: 统({ 关联线索: 1, 关联项目: 1 }) },
      { name: "旧平台|某账号", platform: "旧平台", mainId: "m2", active: true, 统计: 统({ 关联订单: 3 }) },
      { name: "老渠道｜甲", platform: null, mainId: null, active: false, 统计: 统({ 关联商机: 1 }) },
      { name: "老渠道", platform: null, mainId: null, active: true },
    ], 主们);
    expect(行.map((r) => [r.id, r.name, r.子渠道数, r.active, r.历史])).toEqual([
      ["m1", "展会", 2, true, false],
      ["m2", "旧平台", 1, true, true],
      ["名:老渠道", "老渠道", 2, true, false],
    ]);
    expect(行[0].统计).toMatchObject({ 关联线索: 3, 关联项目: 3 });
    expect(行[1].统计.关联订单).toBe(3);
    expect(行[2].统计.关联商机).toBe(1);
  });
  it("主渠道停用了，这一行就是停用（不看底下子渠道）", () => {
    const [r] = 按主渠道汇总([{ name: "展会|甲", platform: "展会", mainId: "m1", active: true }], [主({ id: "m1", name: "展会", active: false })]);
    expect(r.active).toBe(false);
  });
});

describe("客户导入认主渠道、子渠道两列", () => {
  const 表 = 字段表(DEFAULT_BUSINESS);
  const 认得 = new Set(["展会|2026广交会", "官网"]);
  const 摊 = (表头: string[], 数据: string[][], 历史渠道?: Set<string>) =>
    摊开({ 表头, 数据, 映射: 猜列(表头, 表), 字段表: 表, 认得的渠道: 认得, 历史渠道 });

  it("表头「主渠道」「子渠道」各对到来源渠道、子渠道", () => {
    expect(猜列(["姓名", "手机号", "主渠道", "子渠道"], 表)).toEqual(["name", "phone", "channelName", "subChannel"]);
  });
  it("两列拼回全称「主|子」；子渠道空就是主渠道本身", () => {
    const [a, b] = 摊(["姓名", "手机号", "主渠道", "子渠道"], [["张三", "13800000001", "展会", "2026广交会"], ["李四", "13800000002", "官网", ""]]);
    expect(a.值.channelName).toBe("展会|2026广交会");
    expect(b.值.channelName).toBe("官网");
    expect([a.问题, b.问题]).toEqual([[], []]);
    expect(a.值).not.toHaveProperty("subChannel");
  });
  it("只有子渠道、没有主渠道：认不出，留空并进备注", () => {
    const [r] = 摊(["姓名", "手机号", "主渠道", "子渠道"], [["张三", "13800000001", "", "2026广交会"]]);
    expect(r.值.channelName).toBeUndefined();
    expect(r.问题[0].说法).toContain("只有子渠道");
    expect(r.值.remark).toContain("2026广交会");
  });
  it("历史渠道（P-渠道-06）：新导入的不落到它上面，留空、两格原文并进备注、说清是历史渠道", () => {
    const [r] = 摊(["姓名", "手机号", "主渠道", "子渠道"], [["张三", "13800000001", "旧平台", "某账号"]], new Set(["旧平台|某账号"]));
    expect(r.值.channelName).toBeUndefined();
    expect(r.问题.map((x) => x.说法).join()).toContain("历史渠道");
    expect(r.值.remark).toContain("旧平台");
    expect(r.值.remark).toContain("某账号");
  });
  it("外贸模版不摆渠道：子渠道也不认", () => {
    expect(字段表(BUSINESS_PRESETS["外贸出口"]).some((f) => f.名 === "subChannel")).toBe(false);
  });
});

describe("企业版客户导出按两层", () => {
  const 行 = (channelName: string | null): 导出行 => ({
    name: "张三", phone: "13800000001", school: null, major: null, grade: null, referrerName: null, channelName,
    attributionName: null, followStatus: "未跟进", decisionStatus: "未决策", expectedSignAt: null, signedAmount: 0, salesOwnerName: "甲", remark: null,
  });
  it("拆导出渠道：全称拆两格，没子渠道 / 子和主同名 / 尾巴竖线都只留主渠道", () => {
    expect(拆导出渠道("展会|2026广交会")).toEqual(["展会", "2026广交会"]);
    expect(拆导出渠道("展会｜2026广交会")).toEqual(["展会", "2026广交会"]);
    expect(拆导出渠道("官网")).toEqual(["官网", ""]);
    expect(拆导出渠道("官网|官网")).toEqual(["官网", ""]);
    expect(拆导出渠道("官网|")).toEqual(["官网", ""]);
    expect(拆导出渠道(null)).toEqual(["", ""]);
  });
  it("两层时多「主渠道」「子渠道」两列；不开两层表头不变", () => {
    const 平 = 客户导出表([行("展会|2026广交会")], DEFAULT_BUSINESS);
    expect(平.head).not.toContain("主渠道");
    const 层 = 客户导出表([行("展会|2026广交会")], DEFAULT_BUSINESS, false, true);
    expect(层.head.length).toBe(平.head.length + 2);
    expect(层.body[0][层.head.indexOf("主渠道")]).toBe("展会");
    expect(层.body[0][层.head.indexOf("子渠道")]).toBe("2026广交会");
    expect(层.body[0].length).toBe(层.head.length);
  });
  it("导出 → 原样导回来：落回同一个渠道全称", () => {
    const { head, body } = 客户导出表([行("展会|2026广交会"), 行("官网")], DEFAULT_BUSINESS, false, true);
    const 表 = 字段表(DEFAULT_BUSINESS);
    const 回来 = 摊开({ 表头: head, 数据: body, 映射: 猜列(head, 表), 字段表: 表, 认得的渠道: new Set(["展会|2026广交会", "官网"]) });
    expect(回来.map((r) => r.值.channelName)).toEqual(["展会|2026广交会", "官网"]);
  });
});
