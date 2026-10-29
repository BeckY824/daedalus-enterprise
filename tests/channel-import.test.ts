/**
 * 企业版渠道批量导入的规矩（2026-10-29）：用自己造的小 CSV 走一遍 解析CSV → 排导入，
 * 见 src/lib/enterprise/channel-import.ts 文件头。脚本 scripts/import-channels.ts 只管读写库，不在这里测。
 */
import { describe, it, expect } from "vitest";
import { 解析CSV带行号, 解码CSV } from "@/lib/import/parse";
import { 排导入, 计划报告, 认人, 认状态, type 导入用员工 } from "@/lib/enterprise/channel-import";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";

const 员工们: 导入用员工[] = [
  { id: "u1", name: "王一", active: true },
  { id: "u2", name: "李二", active: true },
  { id: "u3", name: "赵三", active: false },
  { id: "u4", name: "重名", active: true },
  { id: "u5", name: "重名", active: true },
];
const 兜底负责人 = { id: "boss", name: "老板" };
const 上下文 = (已有全称: string[] = []) => ({ 员工们, 已有全称, 字典属性: 字典定义.channelAttr.默认, 兜底负责人 });
/** 脚本里就是这么读 CSV 的：空行丢掉，行号按原文 */
const 排 = (csv: string, 已有全称: string[] = []) => {
  const 表 = 解析CSV带行号(csv);
  return 排导入(表.rows, { ...上下文(已有全称), 行号: 表.行号 });
};

const CSV = [
  "渠道属性,渠道名称,来源名称,渠道状态,结束日期,负责人,创建人,累计运营天数,备用列",
  "公域引流,抖音,官方号,启用,,王一,李二,12,x",
  "客户介绍,老客户,张先生,停用,2026-09-30,赵三,,3,",
  "人脉引荐,抖音,官方号,启用,,王一,,,", // 和第 2 行重复
  "分销合作,小红书,店铺,正常,2026/13/40,查无此人,重名,,",
  ",朋友圈,朋友圈,怪状态,,,,,", // 来源和名称一样：全称只写名称；属性空照收
  "个人自拓,,无名称,,,,,,",
  ",,,,,,,,",
  "新属性,线下展会,十月场,,,李二,,,",
  "公域引流,已有渠道,老来源,,,,,,",
].join("\n");

describe("排导入：自己造的 CSV", () => {
  const 计划 = 排(CSV, ["已有渠道|老来源"]);

  it("表头：认不出的列报一句，累计运营天数故意不读不报", () => {
    expect(计划.表头提示).toEqual(["「备用列」这列不认识，没读"]);
  });

  it("建哪些：全称按 名称|来源 拼，行号按表格里看到的", () => {
    expect(计划.要建.map((c) => [c.行号, c.name])).toEqual([
      [2, "抖音|官方号"],
      [3, "老客户|张先生"],
      [5, "小红书|店铺"],
      [6, "朋友圈"],
      [9, "线下展会|十月场"],
    ]);
    const [抖音, 老客户, 小红书, 朋友圈, 展会] = 计划.要建;
    expect(抖音).toMatchObject({ attr: "公域引流", platform: "抖音", active: true, endDate: null, channelOwnerId: "u1", createdById: "u2" });
    // 离职员工也能认作负责人（在职里没有同名的）；停用、结束日期照收
    expect(老客户).toMatchObject({ active: false, channelOwnerId: "u3", createdById: null });
    expect(老客户.endDate?.getFullYear()).toBe(2026);
    expect(老客户.endDate?.getMonth()).toBe(8);
    expect(老客户.endDate?.getDate()).toBe(30);
    // 日期认不出留空；负责人对不上挂兜底；创建人重名留空
    expect(小红书).toMatchObject({ endDate: null, channelOwnerId: "boss", createdById: null, active: true });
    expect(朋友圈).toMatchObject({ attr: null, platform: "朋友圈", active: true, channelOwnerId: "boss" });
    expect(展会).toMatchObject({ attr: "新属性", channelOwnerId: "u2" });
  });

  it("重复：库里已有的、和前面行重复的都跳过", () => {
    expect(计划.重复).toEqual([
      { 行号: 4, 全称: "抖音|官方号", 和: "第 2 行" },
      { 行号: 10, 全称: "已有渠道|老来源", 和: "库里已有" },
    ]);
  });

  it("拦下：缺名称；整行空的不算，但后面的行号照原表数", () => {
    expect(计划.拦下).toEqual([{ 行号: 7, 原因: "渠道名称没填" }]);
  });

  it("提示：每一格没按原样收的都说一句", () => {
    const 话 = (行号: number) => 计划.提示.filter((p) => p.行号 === 行号).map((p) => p.话);
    expect(话(2)).toEqual([]);
    expect(话(5)).toEqual([
      "结束日期「2026/13/40」认不出，留空",
      "负责人：员工里没有「查无此人」，先挂给 老板",
      "创建人：有 2 个在职员工都叫「重名」，分不清，留空",
    ]);
    expect(话(6)).toEqual(["渠道状态「怪状态」认不出，按启用收", "负责人没填，先挂给 老板"]);
    expect(话(9)[0]).toMatch(/渠道属性「新属性」不在字典里/);
  });

  it("报告：演练说库没动，--apply 后写已建", () => {
    const 演练 = 计划报告(计划, false);
    expect(演练).toContain("将建 5 个渠道；全称重复跳过 2 行；拦下 1 行。");
    expect(演练).toContain("第 4 行  抖音|官方号（和第 2 行重复）");
    expect(演练).toContain("[表头] 「备用列」这列不认识，没读");
    expect(演练).toContain("这是演练，库没动");
    const 写了 = 计划报告(计划, true);
    expect(写了).toContain("已建 5 个渠道");
    expect(写了).not.toContain("这是演练");
  });
});

describe("排导入：表头", () => {
  it("缺渠道名称或来源列：整张表不导", () => {
    const 计划 = 排("渠道属性,渠道名称\n公域引流,抖音");
    expect(计划.要建).toEqual([]);
    expect(计划.表头提示).toEqual(["缺「来源名称」这列，整张表没法导"]);
  });
  it("开头空行跳过；表头别名「来源」「状态」「渠道负责人」也认；列顺序随意", () => {
    const 计划 = 排(",,\n\n渠道负责人,来源,渠道名称,状态\n李二,群里,微信,关闭");
    expect(计划.表头提示).toEqual([]);
    expect(计划.要建).toEqual([{ 行号: 4, name: "微信|群里", attr: null, platform: "微信", active: false, endDate: null, channelOwnerId: "u2", createdById: null }]);
  });
  it("不给原表行号：按下标 + 1", () => {
    expect(排导入([["渠道名称", "来源名称"], ["", "x"]], 上下文()).拦下).toEqual([{ 行号: 2, 原因: "渠道名称没填" }]);
  });
  it("空表", () => {
    expect(排导入([], 上下文()).表头提示).toEqual(["表是空的"]);
  });
  it("全称超过上限拦下", () => {
    const 计划 = 排导入([["渠道名称", "来源名称"], ["长".repeat(50), "源".repeat(40)]], 上下文());
    expect(计划.要建).toEqual([]);
    expect(计划.拦下[0].原因).toMatch(/超过 80 个字/);
  });
  it("UTF-8 带 BOM 的 CSV 也读得对", () => {
    const bytes = new TextEncoder().encode("﻿渠道名称,来源名称\n抖音,官方号\n");
    const 计划 = 排(解码CSV(bytes));
    expect(计划.表头提示).toEqual([]);
    expect(计划.要建.map((c) => c.name)).toEqual(["抖音|官方号"]);
  });
});

describe("认人 / 认状态", () => {
  it("在职优先、重名不认、没有就说没有", () => {
    expect(认人(" 王一 ", 员工们)).toEqual({ id: "u1" });
    expect(认人("赵三", 员工们)).toEqual({ id: "u3" });
    expect(认人("重名", 员工们)).toEqual({ 错: "有 2 个在职员工都叫「重名」，分不清" });
    expect(认人("无", 员工们)).toEqual({ 错: "员工里没有「无」" });
    // 在职和离职同名：认在职那个
    expect(认人("同", [{ id: "x", name: "同", active: false }, { id: "y", name: "同", active: true }])).toEqual({ id: "y" });
  });
  it("状态写法", () => {
    expect(认状态("")).toEqual({ active: true, 认出来了: true });
    expect(认状态("有效")).toEqual({ active: true, 认出来了: true });
    expect(认状态("已停用")).toEqual({ active: false, 认出来了: true });
    expect(认状态("暂停中")).toEqual({ active: true, 认出来了: false });
  });
});
