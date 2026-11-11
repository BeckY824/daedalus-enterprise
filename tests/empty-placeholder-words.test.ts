/**
 * 没填就是「—」：代码里不许再写「暂未确认」「暂不确认」这两个占位词（11-11 用户：「只要未填的都用 — 代替即可。这个是整个设计都要遵守的」）。
 *
 * 以前客户类型字典有「暂不确认」、需求状态字典有「暂未确认」，导入时空着也落这几个字，页面上就显示出来了。
 * 现在：字典默认里拿掉、导入留空、显示一律走 lib/empty-value 的 空值符；库里没清干净的老值靠 旧占位词 兜成「—」。
 *
 * 去掉注释后，src 里出现这两个词只许在下面名单里的文件（兜老数据、认老占位的地方），每条写了为什么。
 * 新写的界面要表示「没填」，用 空值符 / 空显 / 去空，别再写占位词。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源 } from "./skin-css";
import { 是空值, 空显, 旧占位词 } from "@/lib/empty-value";
import { 字典定义, 字典种类们 } from "@/lib/enterprise/dict-kinds";
import { 是占位值 } from "@/lib/project/required";

const 占位词 = /暂未确认|暂不确认/;

const 放行: Record<string, string> = {
  "lib/empty-value.ts": "旧占位词：库里老值显示、分组时按没填兜成「—」",
  "lib/enterprise-import/mapping.ts": "客户类型旧占位：10-30 ～ 11-11 导入落过，合并 / 冲突判断时当空的看",
  "lib/project/required.ts": "必填检查的占位名单：手填了这几个字也算没填",
};

function 所有源文件(dir: string): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n !== "generated") out.push(...所有源文件(p));
    } else if (/\.(tsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}

/** 去掉块注释和整行 / 行尾的 // 注释（前面是空白或行首的才算，免得误伤字符串里的 http://） */
const 去注释 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

describe("没填就显示「—」，不写占位词", () => {
  it("src 里（去掉注释）不出现「暂未确认」「暂不确认」，名单里的兜底文件除外", () => {
    const 犯 = 所有源文件(源)
      .map((f) => path.relative(源, f).replaceAll("\\", "/"))
      .filter((rel) => !(rel in 放行))
      .flatMap((rel) =>
        去注释(fs.readFileSync(path.join(源, rel), "utf8"))
          .split("\n")
          .flatMap((行, i) => (占位词.test(行) ? [`${rel}:${i + 1}  ${行.trim()}`] : [])),
      );
    expect(犯, "要表示没填用 lib/empty-value 的 空值符 / 空显，别写占位词").toEqual([]);
  });

  it("放行名单里的文件都还在（删了 / 挪了就把名单也改了）", () => {
    for (const rel of Object.keys(放行)) expect(fs.existsSync(path.join(源, rel)), rel).toBe(true);
  });

  it("默认字典里没有占位项（暂不确认、暂未确认、待定、未知、不详、不确定……）：没选就是空、显示「—」", () => {
    const 犯 = 字典种类们.flatMap((k) =>
      字典定义[k].默认.filter((x) => 是占位值(x) || 旧占位词.includes(x) || /^(不确定|未定|暂不确定|未明确|其他待定)$/.test(x)).map((x) => `${k}: ${x}`),
    );
    expect(犯).toEqual([]);
    // 真答案不算占位：价格感知「暂无异议」、场地现状「暂无场地」
    expect(字典定义.projPrice.默认).toContain("暂无异议");
    expect(字典定义.projSite.默认).toContain("暂无场地");
  });

  it("库里的老占位值显示成「—」", () => {
    for (const v of 旧占位词) {
      expect(是空值(v)).toBe(true);
      expect(是空值(` ${v} `)).toBe(true);
      expect(空显(v)).toBe("—");
    }
    expect(是空值("个人买家")).toBe(false);
    expect(是空值("暂无异议")).toBe(false);
  });
});
