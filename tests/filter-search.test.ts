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

/**
 * 守门：本 PR（F-050）换成 FilterSelect 的文件，筛选下拉都用 FilterSelect（能打字搜），别再直接摆 antd <Select。
 * 同文件里不是筛选的下拉（弹窗表单、排序）写进白名单：按那一行里的字认，一条只认一行，行没了白名单也要删。
 * 以后新开的用 useCustomFilters 的页面也要进清单。
 */
describe("列表页筛选行都用 FilterSelect", () => {
  const 根 = path.resolve("src");
  const 清单: Record<string, { 含: string; 因: string }[]> = {
    "app/(app)/channels/ChannelDash.tsx": [],
    "app/(app)/channels/ChannelsView.tsx": [
      { 含: "options={表单属性.map(", 因: "新建 / 编辑渠道弹窗里的渠道属性，表单项" },
      { 含: "options={表单策略.map(", 因: "新建 / 编辑渠道弹窗里的运营策略，表单项" },
      { 含: "<Select placeholder=\"请选择\" options={成员选项(users)} />", 因: "新建 / 编辑渠道弹窗里的负责人，表单项" },
    ],
    "app/(app)/contacts/ContactsView.tsx": [],
    "app/(app)/customers/CustomersView.tsx": [],
    "app/(app)/leads/LeadsView.tsx": [
      { 含: "<Select options={LEAD_STATUSES.filter(", 因: "新建 / 编辑线索弹窗里的状态，表单项" },
      { 含: "<Select options={成员选项(users)} disabled={线索分配开着} />", 因: "新建 / 编辑线索弹窗里的负责人，表单项" },
    ],
    "app/(app)/overview/BoardBlockers.tsx": [],
    "app/(app)/overview/BoardTalks.tsx": [],
    "app/(app)/overview/BoardTopics.tsx": [],
    "app/(app)/overview/DataShell.tsx": [],
    "app/(app)/pool/PoolView.tsx": [
      { 含: "<Select className=\"pool-sort\" aria-label=\"排序\"", 因: "排序，不是筛选；固定几个选项" },
    ],
    "app/(app)/projects/ProjectsView.tsx": [],
    "components/CustomFilters.tsx": [],
    "components/IdleDaysFilter.tsx": [],
  };
  const 行们 = (rel: string) => fs.readFileSync(path.join(根, rel), "utf8").split("\n");

  it.each(Object.keys(清单).map((rel) => [rel]))("%s：除白名单行外没有 <Select", (rel) => {
    const 白 = 清单[rel];
    const 有的 = 行们(rel).map((t, i) => ({ t, 行: i + 1 })).filter((x) => /<Select(\s|>|$)/.test(x.t));
    const 不该有 = 有的.filter((x) => !白.some((w) => x.t.includes(w.含))).map((x) => `${x.行}: ${x.t.trim()}`);
    expect(不该有).toEqual([]);
    // 白名单每条正好认一行：认不到（行改了、删了）或认到多行都要回来改白名单
    for (const w of 白) expect([w.含, 有的.filter((x) => x.t.includes(w.含)).length]).toEqual([w.含, 1]);
  });

  it("用 useCustomFilters 的页面都在清单里", () => {
    const 文件们: string[] = [];
    const 走 = (d: string) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) 走(p);
        else if (p.endsWith(".tsx") && !p.endsWith("CustomFilters.tsx")) 文件们.push(p);
      }
    };
    走(根);
    const 用到的 = 文件们.filter((p) => fs.readFileSync(p, "utf8").includes("useCustomFilters(")).map((p) => path.relative(根, p));
    expect(用到的.length).toBeGreaterThanOrEqual(4);
    expect(用到的.filter((r) => !(r in 清单))).toEqual([]);
  });
});
