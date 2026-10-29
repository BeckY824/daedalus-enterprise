/**
 * 企业版渠道统计（2026-10-29 渠道改版）：列表那一排数的口径钉在这里，
 * 见 src/lib/enterprise/channel-stats.ts 文件头。
 */
import { describe, it, expect } from "vitest";
import {
  算渠道统计, 算产出比, 运营天数, 拼全称, 拆来源, 产出比分布, 是有效线索, 算成交, 全称分隔, 能录投入,
  type 统计用项目, type 渠道统计,
} from "@/lib/enterprise/channel-stats";
import { 建组织 } from "@/lib/enterprise/org-core";

const 日 = (s: string) => new Date(`${s}T00:00:00`);
const 项 = (channelId: string | null, phase: string, amount = 0, currency = "CNY", result: string | null = null): 统计用项目 => ({ channelId, phase, result, amount, currency });

describe("拼全称 / 拆来源", () => {
  it("名称|来源；来源空或和名称一样只写名称", () => {
    expect(拼全称("抖音", "张老师")).toBe(`抖音${全称分隔}张老师`);
    expect(拼全称(" 抖音 ", " 张老师 ")).toBe("抖音|张老师");
    expect(拼全称("抖音", "")).toBe("抖音");
    expect(拼全称("抖音", "抖音")).toBe("抖音");
    expect(拼全称("", "张老师")).toBe("张老师");
    expect(拼全称(null, undefined)).toBe("");
  });
  it("拆来源：前缀对得上就拆出来，对不上整段当来源", () => {
    expect(拆来源("抖音|张老师", "抖音")).toBe("张老师");
    expect(拆来源("抖音", "抖音")).toBe("抖音");
    expect(拆来源("林老师", null)).toBe("林老师");
    expect(拆来源("小红书|王", "抖音")).toBe("小红书|王");
    // 来源里自己带分隔符：只拆第一段名称
    expect(拆来源("抖音|A|B", "抖音")).toBe("A|B");
  });
});

describe("运营天数", () => {
  it("同一天 0 天；没结束日期算到今天；结束在创建前不出负数", () => {
    expect(运营天数(日("2026-10-01"), null, 日("2026-10-01"))).toBe(0);
    expect(运营天数(new Date("2026-10-01T23:30:00"), null, new Date("2026-10-02T00:10:00"))).toBe(1);
    expect(运营天数(日("2026-10-01"), null, 日("2026-10-29"))).toBe(28);
    expect(运营天数(日("2026-10-01"), 日("2026-10-11"), 日("2026-10-29"))).toBe(10);
    expect(运营天数(日("2026-10-11"), 日("2026-10-01"), 日("2026-10-29"))).toBe(0);
  });
});

describe("算产出比", () => {
  it("同币种：成交 ÷ 投入，两位小数；成交 0 算得出 0", () => {
    expect(算产出比([{ 币种: "CNY", 合计: 1000 }], [{ 币种: "CNY", 合计: 300 }])).toEqual({ 产出比: 3.33, 产出比说明: null });
    expect(算产出比([], [{ 币种: "CNY", 合计: 300 }])).toEqual({ 产出比: 0, 产出比说明: null });
  });
  it("没投入、投入混币种、成交里有别的币种：null 带原因", () => {
    expect(算产出比([{ 币种: "CNY", 合计: 1 }], [])).toEqual({ 产出比: null, 产出比说明: "还没录投入" });
    expect(算产出比([], [{ 币种: "CNY", 合计: 1 }, { 币种: "USD", 合计: 1 }]).产出比说明).toMatch(/几种币种/);
    expect(算产出比([{ 币种: "USD", 合计: 9 }], [{ 币种: "CNY", 合计: 1 }]).产出比说明).toMatch(/CNY以外/);
  });
});

describe("算渠道统计", () => {
  const 渠道们 = [
    { id: "a", createdAt: 日("2026-10-01"), endDate: null },
    { id: "b", createdAt: 日("2026-10-20"), endDate: 日("2026-10-25") },
  ];
  const 项目们 = [
    项("a", "线索"),
    项("a", "线索"),
    项("a", "商机", 500),
    项("a", "订单", 1000),
    项("a", "订单", 800, "CNY", "异常状态"), // 异常的不进成交，但算关联订单
    项("a", "订单", 200),
    项("b", "订单", 50, "USD"),
    项(null, "订单", 99999), // 客户没挂渠道的不归任何渠道
    项("zz", "线索"), // 渠道不在清单里的不出
  ];
  const 投入们 = [
    { channelId: "a", amount: 300, currency: "CNY" },
    { channelId: "a", amount: 100, currency: "CNY" },
    { channelId: "b", amount: 10, currency: "CNY" },
  ];
  const s = 算渠道统计(渠道们, 项目们, 投入们, 日("2026-10-29"));

  it("各阶段计数、关联项目是全部阶段", () => {
    expect(s.a).toMatchObject({ 关联线索: 2, 有效线索: 2, 关联商机: 1, 关联订单: 3, 关联项目: 6, 累计运营天数: 28 });
    expect(s.b).toMatchObject({ 关联线索: 0, 关联订单: 1, 关联项目: 1, 累计运营天数: 5 });
    expect(Object.keys(s).sort()).toEqual(["a", "b"]);
  });
  it("累计成交只算订单阶段、不是异常状态的；按币种合计不换汇", () => {
    expect(s.a.累计成交).toEqual([{ 币种: "CNY", 合计: 1200 }]);
    expect(s.a.当前投入).toEqual([{ 币种: "CNY", 合计: 400 }]);
    expect(s.a.产出比).toBe(3);
    expect(s.b.累计成交).toEqual([{ 币种: "USD", 合计: 50 }]);
    expect(s.b.产出比).toBeNull();
    expect(s.b.产出比说明).toMatch(/不换汇/);
  });
  it("没有项目也没有投入的渠道：全 0、产出比 null", () => {
    const 空 = 算渠道统计([{ id: "c", createdAt: 日("2026-10-29"), endDate: null }], [], [], 日("2026-10-29")).c;
    expect(空).toMatchObject({ 关联项目: 0, 累计成交: [], 当前投入: [], 产出比: null, 产出比说明: "还没录投入", 累计运营天数: 0 });
  });
  it("口子函数：有效线索现在全算；成交排除异常状态", () => {
    expect(是有效线索(项("a", "线索"))).toBe(true);
    expect(算成交(项("a", "订单", 1))).toBe(true);
    expect(算成交(项("a", "订单", 1, "CNY", "异常状态"))).toBe(false);
    expect(算成交(项("a", "商机", 1))).toBe(false);
  });
});

describe("产出比分布", () => {
  const 统 = (产出比: number | null) => ({ 产出比 }) as 渠道统计;
  it("算不了的不进；全算不了给 null", () => {
    expect(产出比分布([统(1), 统(3), 统(null), 统(2.5)])).toEqual({ 平均: 2.17, 最高: 3, 最低: 1, 个数: 3 });
    expect(产出比分布([统(0), 统(null)])).toEqual({ 平均: 0, 最高: 0, 最低: 0, 个数: 1 });
    expect(产出比分布([统(null)])).toBeNull();
    expect(产出比分布([])).toBeNull();
  });
});

describe("能录投入（P16：只有老板、总管理员、市场管理）", () => {
  const org = 建组织(
    ["boss", "dir", "adm", "mm", "sm", "ops", "s", "multi"].map((id) => ({ id, role: id === "boss" ? "ADMIN" : "SALES", active: true })),
    ([["dir", "director"], ["adm", "admin"], ["mm", "marketing_mgr"], ["sm", "sales_mgr"], ["ops", "channel_ops"], ["s", "sales"], ["multi", "sales,marketing_mgr"]] as const)
      .map(([userId, bizRole]) => ({ userId, deptId: null, bizRole, line: null, managerId: null, dottedManagerId: null })),
    [],
  );
  it("老板、总管理、管理员、市场管理（兼着也算）能录；销售管理、渠道运营、销售不能", () => {
    expect(能录投入(org, { id: "boss", role: "ADMIN" })).toBe(true);
    for (const id of ["dir", "adm", "mm", "multi"]) expect(能录投入(org, { id, role: "SALES" })).toBe(true);
    for (const id of ["sm", "ops", "s", "不在组织里"]) expect(能录投入(org, { id, role: "SALES" })).toBe(false);
  });
});
