/**
 * F-050：筛选下拉打字搜的比法（lib/filter-search.ts）和「各页筛选行都用 FilterSelect」的守门。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { 少选项上限, 选项个数, 选项匹配, 选项文字, 节点文字 } from "@/lib/filter-search";

describe("选项匹配", () => {
  it("按包含、不分大小写、去首尾空格；只输空格当没输", () => {
    expect(选项匹配("王", { value: "u1", label: "王小二" })).toBe(true);
    expect(选项匹配("小二", { value: "u1", label: "王小二" })).toBe(true);
    expect(选项匹配("  wang ", { value: "u2", label: "Alice WANG" })).toBe(true);
    expect(选项匹配("李", { value: "u1", label: "王小二" })).toBe(false);
    expect(选项匹配("   ", { value: "u1", label: "王小二" })).toBe(true);
    expect(选项匹配("王", undefined)).toBe(false);
  });

  it("比看得见的字，不比 value；label 是节点时取里面的字，没字才看 title、value", () => {
    expect(选项匹配("u1", { value: "u1", label: "王小二" })).toBe(false);
    const 节点 = createElement("span", null, createElement("b", null, "线索池"), " ", 12);
    expect(节点文字(节点)).toBe("线索池 12");
    expect(选项匹配("线索", { value: "线索池", label: 节点 })).toBe(true);
    expect(选项文字({ value: "x", label: createElement("i"), title: "带说明" })).toBe("带说明");
    expect(选项文字({ value: "展会" })).toBe("展会");
  });
});

describe("选项个数", () => {
  it("分组只数组里的；value 为空的「全部 X」不算", () => {
    expect(选项个数([{ value: "", label: "全部成员" }, { value: "a" }, { value: "b" }])).toBe(2);
    expect(选项个数([{ label: "线索", options: [{ value: "1" }, { value: "2" }] }, { label: "报价", options: [{ value: "3" }] }])).toBe(3);
    expect(选项个数(undefined)).toBe(0);
    expect(少选项上限).toBe(6);
  });
});

/** 守门：用 useCustomFilters 的列表页，筛选项都用 FilterSelect（能打字搜），别再直接摆 antd Select */
describe("列表页筛选行都用 FilterSelect", () => {
  const 根 = path.resolve("src");
  const 文件们: string[] = [];
  const 走 = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) 走(p);
      else if (p.endsWith(".tsx") && !p.endsWith("CustomFilters.tsx")) 文件们.push(p);
    }
  };
  走(根);
  const 用到的 = 文件们.filter((p) => fs.readFileSync(p, "utf8").includes("useCustomFilters("));
  it("至少找到客户、项目、公海、渠道四页", () => {
    expect(用到的.length).toBeGreaterThanOrEqual(4);
  });
  it.each(用到的.map((p) => [path.relative(根, p)]))("%s：useCustomFilters 那一段里没有 <Select", (rel) => {
    const s = fs.readFileSync(path.join(根, rel), "utf8");
    const 起 = s.indexOf("useCustomFilters(");
    // 那一段到调用的右括号：数括号配对
    let 深 = 0, 止 = 起;
    for (let i = s.indexOf("(", 起); i < s.length; i++) {
      if (s[i] === "(") 深++;
      else if (s[i] === ")" && --深 === 0) { 止 = i; break; }
    }
    const 段 = s.slice(起, 止);
    expect(段.length).toBeGreaterThan(50);
    expect(段).not.toMatch(/<Select[\s<>]/);
  });
});
