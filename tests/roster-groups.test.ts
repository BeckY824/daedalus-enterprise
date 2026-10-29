import { describe, it, expect } from "vitest";
import { 名单分组, 项目名单分组, 客户状态分组, 未填写组 } from "@/lib/roster-groups";
import { 客户状态色, 客户状态色表 } from "@/lib/enterprise/cust-status-color";
import { FOLLOW_STATUSES } from "@/lib/constants";

const 人 = (id: string, followStatus: string | null) => ({ id, followStatus: followStatus as string });

describe("名单按跟进状态分组：一个人都不能从分组视图里消失（2026-10-04 L-072）", () => {
  it("预设状态按预设顺序排，没人的组不出", () => {
    const g = 名单分组([人("a", "跟进中"), 人("b", "待跟进"), 人("c", "跟进中")]);
    expect(g.map((x) => [x.s, x.rows.map((r) => r.id)])).toEqual([["待跟进", ["b"]], ["跟进中", ["a", "c"]]]);
  });
  it("预设外的状态（老库 / 导入来的）→ 单独成组，接在预设后面，组名就是它自己", () => {
    const g = 名单分组([人("a", "意向强"), 人("b", FOLLOW_STATUSES[0]), 人("c", "意向强"), 人("d", "老客户")]);
    expect(g.map((x) => x.s)).toEqual([FOLLOW_STATUSES[0], "意向强", "老客户"]);
    expect(g.find((x) => x.s === "意向强")!.rows.map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("空串 / 只有空格 / null 的状态 → 归到「未填写」，不成一个组头空白的组", () => {
    const g = 名单分组([人("a", ""), 人("b", "  "), 人("c", null), 人("d", "待跟进")]);
    expect(g.map((x) => x.s)).toEqual(["待跟进", 未填写组]);
    expect(未填写组).toBe("未填写");
    expect(g.find((x) => x.s === 未填写组)!.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(g.every((x) => x.s.trim() !== "")).toBe(true);
  });
  it("前后带空格的预设状态 → 并进同名的预设组，不出两个看着一样的组", () => {
    const g = 名单分组([人("a", " 跟进中 "), 人("b", "跟进中")]);
    expect(g).toHaveLength(1);
    expect(g[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("分完组的人数加起来 = 进来的人数", () => {
    const 输入 = [人("a", ""), 人("b", "意向强"), 人("c", "待跟进"), 人("d", null), 人("e", "已签约")];
    expect(名单分组(输入).reduce((n, g) => n + g.rows.length, 0)).toBe(输入.length);
  });
});

describe("项目名单按当前阶段分组（P11）：一个项目都不能消失", () => {
  const 项 = (id: string, 阶段: string | null) => ({ id, 阶段 });
  it("按三大阶段的顺序排，没项目的阶段不出组头", () => {
    const g = 项目名单分组([项("a", "订单"), 项("b", "线索"), 项("c", "订单")]);
    expect(g.map((x) => [x.s, x.rows.map((r) => r.id)])).toEqual([["线索", ["b"]], ["订单", ["a", "c"]]]);
  });
  it("字典外的阶段单独成组接在后面，空的归「未填写」放最后", () => {
    const g = 项目名单分组([项("a", ""), 项("b", "老阶段"), 项("c", "商机"), 项("d", null), 项("e", " 线索 ")]);
    expect(g.map((x) => x.s)).toEqual(["线索", "商机", "老阶段", 未填写组]);
    expect(g.find((x) => x.s === 未填写组)!.rows.map((r) => r.id)).toEqual(["a", "d"]);
    expect(g.flatMap((x) => x.rows)).toHaveLength(5);
  });
});

describe("企业版客户中栏按客户状态分组（10-29）：顺序跟字典走，一位都不能消失", () => {
  const 客 = (id: string, custStatus: string | null) => ({ id, custStatus });
  it("按传进来的字典顺序排（不是默认顺序），没人的状态不出组头", () => {
    const g = 客户状态分组([客("a", "成交"), 客("b", "潜在"), 客("c", "成交"), 客("d", "意向")], ["成交", "意向", "潜在", "交付"]);
    expect(g.map((x) => [x.s, x.rows.map((r) => r.id)])).toEqual([["成交", ["a", "c"]], ["意向", ["d"]], ["潜在", ["b"]]]);
  });
  it("停用了的（不在顺序里）照样成组接在后面，空的归「未填写」放最后", () => {
    const g = 客户状态分组([客("a", null), 客("b", "异常"), 客("c", "潜在"), 客("d", " "), 客("e", "老状态")], ["潜在", "意向"]);
    expect(g.map((x) => x.s)).toEqual(["潜在", "异常", "老状态", 未填写组]);
    expect(g.flatMap((x) => x.rows)).toHaveLength(5);
  });
  it("不看跟进状态：只有跟进状态没有客户状态的归「未填写」", () => {
    const g = 客户状态分组([{ id: "a", custStatus: null, followStatus: "跟进中" }], ["潜在"]);
    expect(g.map((x) => x.s)).toEqual([未填写组]);
  });
});

describe("客户状态配色：稳定，改名不变色", () => {
  it("默认项按固定 id 认，改了名颜色不变", () => {
    expect(客户状态色({ id: "dict-custStatus-2", name: "成交" })).toBe("green");
    expect(客户状态色({ id: "dict-custStatus-2", name: "已成交" })).toBe("green");
    expect(客户状态色({ id: "dict-custStatus-8", name: "异常" })).toBe("red");
  });
  it("自己加的按名字散，同名同色，表里一项一色", () => {
    const a = 客户状态色({ id: "x1", name: "待回访" });
    expect(客户状态色({ id: "x2", name: "待回访" })).toBe(a);
    expect(客户状态色({ name: "待回访" })).toBe(a);
    const 表 = 客户状态色表([{ id: "dict-custStatus-0", name: "潜在" }, { id: "x1", name: "待回访" }]);
    expect(表).toEqual({ 潜在: "blue", 待回访: a });
  });
});
