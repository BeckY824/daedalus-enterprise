/**
 * 公海页搜索拆词、空格归一（23D，2F 后续）：统一公海的 筛排（项目行、渠道名单在内存里比）按 search-terms.ts 拆搜索词 拆开，每个词都要中，
 * 各词可以中在不同的格（客户名、简称、编号、项目名）；像号码、客户编号、网址的整串不拆。库里那条路（客户行）和这里对拍在
 * tests/ent-unified-pool-paging.test.ts（逐身份、逐筛选组合，含多词）。
 * 这里不碰库：逐条复现写法不一样的几类，外加「一个词的输入，拆词前后结果集一样」对拍（改前的比法原样抄在下面）。
 */
import { describe, it, expect } from "vitest";
import { 筛排, 公海词们, type 公海行 } from "@/lib/enterprise/unified-pool";
import { 看成客户编号 } from "@/lib/customer-no";
import { 拆搜索词, 含词, 全半角写法 } from "@/lib/search-terms";

const 行 = (id: string, 补: Partial<公海行>): 公海行 => ({
  id, 种: "客户", customerId: id, projectId: null, 客户名: id, 项目名: null, 进程: null, 进程明细: null, 属性: "线索池",
  最后跟进: null, 入池时间: "2026-10-01T00:00:00Z", 创建时间: "2026-09-01T00:00:00Z",
  类: "主动退回", 累计: 1, 入池原因: "", 快捷: "首次退回", 原负责人是我: false, ...补,
});

const 全部 = [
  行("acme", { 客户名: "Acme Trading Ltd", 项目名: "春季展会-灯具采购" }),
  行("hd", { 客户名: "华东  测试贸易有限公司" }), // 库里中间两个空格
  行("jt", { 客户名: "某某（集团）有限公司", 项目名: "家具、地毯" }), // 全角括号；两个项目「、」连着
  行("beta", { 客户名: "ＢＥＴＡ全角科技" }), // 全角字母
  行("short", { 客户名: "远航实业有限公司", 客户简称: "远航", 客户编号: 112 }),
  行("phone", { 客户名: "号码写进名字的 138 0000 客户" }),
  行("hide", { 客户名: null, 项目名: "春季展会-家具" }), // 同事的客户：名字不露
  行("p1", { 种: "项目", customerId: "K", projectId: "p1", 客户名: "星辰贸易", 项目名: "灯具 二期", 属性: "客户池", 快捷: null }),
];
const 搜 = (keyword: string) => 筛排(全部, { keyword }).行.map((r) => r.id).sort();

describe("写法不一样也搜得到（改前这几条都是空的）", () => {
  it.each<[string, string[]]>([
    ["Acme　Trading", ["acme"]], // 全角空格
    ["Acme   Trading", ["acme"]], // 多个空格
    ["Trading Acme", ["acme"]], // 词序反了
    ["华东 测试贸易", ["hd"]], // 库里两个空格、输入一个
    ["某某(集团)", ["jt"]], // 输入半角括号、库里全角
    ["某某【集团】", ["jt"]],
    ["ＡＣＭＥ", ["acme"]], // 输入全角字母
    ["beta全角", ["beta"]], // 库里全角字母、输入半角
    ["Acme 灯具", ["acme"]], // 一个中客户名、一个中项目名
    ["地毯 某某", ["jt"]], // 两个项目「、」连着，词中其中一个
    ["远航 112", ["short"]], // 一个中简称、一个中编号
    ["星辰 二期", ["p1"]], // 项目行：客户名 + 项目名
  ])("「%s」", (k, 应) => {
    expect(搜(k)).toEqual(应);
  });

  it("每个词都要中：有一个词哪儿都没有就不出", () => {
    expect(搜("Acme 没有这个词")).toEqual([]);
    expect(搜("华东 Acme")).toEqual([]);
  });

  it("像号码、像客户编号的整串不拆：「138 0000」只比整串（拆开了「0000」「138」各自乱中）", () => {
    expect(拆搜索词("138 0000")).toEqual(["138 0000"]);
    expect(搜("138 0000")).toEqual(["phone"]);
    expect(搜("138  0000")).toEqual(["phone"]); // 空格先归一
    expect(拆搜索词("NO. 112")).toEqual(["NO. 112"]);
    expect(搜("NO. 112")).toEqual(["short"]);
    expect(搜("ＮＯ．００１１２")).toEqual(["short"]);
  });

  it("客户名不露的行，按客户名的词搜不到（名字是空的）；项目名照样中", () => {
    expect(搜("春季展会 家具")).toEqual(["hide"]);
    expect(搜("春季展会 Acme")).toEqual(["acme"]);
  });

  it("空白、全是分隔符当没搜", () => {
    expect(搜("　 ")).toEqual(全部.map((r) => r.id).sort());
    expect(公海词们("  ")).toEqual([]);
  });
});

describe("对拍：一个词的输入，拆词前后结果集一样", () => {
  // 改前 筛排 的比法原样（unified-pool.ts 23D 以前）
  const 改前 = (rows: readonly 公海行[], keyword: string) => {
    const 词 = keyword.trim().toLowerCase();
    const 号 = 词 ? 看成客户编号(词) : null;
    return (词 ? rows.filter((r) => (r.客户名 ?? "").toLowerCase().includes(词) || (r.客户简称 ?? "").toLowerCase().includes(词) || (号 !== null && r.客户编号 === 号) || (r.项目名 ?? "").toLowerCase().includes(词)) : [...rows]).map((r) => r.id).sort();
  };
  // 造一批名字：中英文、大小写、编号、空项目、不露的客户名
  const 字 = ["华东", "测试", "Acme", "acme", "TRADING", "灯具", "家具", "贸易", "有限公司", "星辰", "12", "NO", "-", "1"];
  const 多 = Array.from({ length: 200 }, (_, i) => 行(`r${i}`, {
    客户名: i % 13 === 0 ? null : `${字[i % 字.length]}${字[(i * 7) % 字.length]}${i % 3 ? "" : 字[(i * 5) % 字.length]}${i}`,
    项目名: i % 4 === 0 ? null : `${字[(i * 3) % 字.length]}-${字[(i * 11) % 字.length]}`,
    ...(i % 9 === 0 ? { 客户简称: 字[(i * 2) % 字.length] } : {}),
    ...(i % 6 === 0 ? { 客户编号: i } : {}),
  }));
  it.each(["华东", "acme", "ACME", "Trading", "灯具", "贸易有限", "12", "NO.00012", "1", "-", " 星辰 ", "有限公司1", "没有这个"])("「%s」", (k) => {
    expect(筛排(多, { keyword: k }, { 按项目: true }).行.map((r) => r.id).sort()).toEqual(改前(多, k));
  });
});

describe("工具", () => {
  it("含词：全角字母、大小写都认；数字原样；空的不中", () => {
    expect(含词("ＢＥＴＡ全角", "beta")).toBe(true);
    expect(含词("Beta", "BETA")).toBe(true);
    expect(含词("项目１", "项目1")).toBe(false);
    expect(含词(null, "x")).toBe(false);
  });
  it("全半角写法：没有字母数字只有自己；有的再给全角写法", () => {
    expect(全半角写法("灯具")).toEqual(["灯具"]);
    expect(全半角写法("AB1")).toEqual(["AB1", "ＡＢ1", "ＡＢ１"]);
    expect(全半角写法("12")).toEqual(["12", "１２"]);
  });
});
