/**
 * 回答的渲染。**换到 DeepSeek 之后它非常爱画表**——问一个渠道的电话，
 * 它先画一张六列的表（只有一行）。提示词能压住一部分，压不住的那部分
 * 不能让人看见一排竖线和 `|---|---|`，所以渲染器得认表格。
 *
 * 不引 jsdom：`renderToStaticMarkup` + `createElement`，在 .ts 里就跑得起来。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "@/components/Markdown";

const 渲 = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("表格", () => {
  const 表 = ["| 渠道 | 负责人 | 状态 |", "|---|---|---|", "| 明杰哥 | becky | 在用 |", "| 老周 | 张三 | 已停用 |"].join("\n");

  it("画成真表格，不是一堆竖线", () => {
    const h = 渲(表);
    expect(h).toContain("<table");
    // 格子里套着 Inline 的 span（加粗和引用要在里面切），所以只断言「这一格里有这几个字」
    expect(h).toMatch(/<th>.*渠道.*<\/th>/);
    expect(h).toMatch(/<td>.*明杰哥.*<\/td>/);
    // 分隔线不许漏成一行内容
    expect(h).not.toContain("---");
    expect(h).not.toContain("|");
  });

  it("模型漏写分隔线时也照样渲染——那是常事，不能退化成竖线", () => {
    const h = 渲(["| 明杰哥 | becky |", "| 老周 | 张三 |"].join("\n"));
    expect(h).toContain("<table");
    expect(h).not.toContain("|");
    // 没有分隔线就没有表头，全部当正文行
    expect(h).not.toContain("<thead");
  });

  it("表格外面套一层能横滚的壳：窄面板里不把整栏撑开", () => {
    expect(渲(表)).toContain('class="md-tw"');
  });

  it("表格前后的正文照常渲染", () => {
    const h = 渲(`就这一个渠道：\n${表}\n要不要再建一个？`);
    expect(h).toContain("就这一个渠道：");
    expect(h).toContain("要不要再建一个？");
    expect(h).toContain("<table");
  });

  it("格子里的加粗照样生效", () => {
    expect(渲("| a |\n|---|\n| **粗** |")).toContain("<strong>");
  });
});

describe("格子里带竖线（名字、抬头里常有）", () => {
  /** 每行的格子文字，按 <tr> 切；格子里套着 span，只取纯文字 */
  const 行们 = (h: string) =>
    [...h.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd](?: class="md-num")?>(.*?)<\/t[hd]>/g)].map((c) => c[1].replace(/<[^>]+>/g, "")));
  const 头 = "| 渠道 | 新增 | 负责人 |\n|---|---|---|\n";

  it("GFM 转义 \\| 不是分界，渲出来是一个 |", () => {
    const h = 渲(`${头}| 区域\\|主体 | 3 | 张三 |\n| NO.86565\\|线索验证 | 1 | 李四 |`);
    expect(行们(h)).toEqual([
      ["渠道", "新增", "负责人"],
      ["区域|主体", "3", "张三"],
      ["NO.86565|线索验证", "1", "李四"],
    ]);
    expect(h).not.toContain("\\");
  });

  it("全角「｜」本来就不切，原样留在格子里", () => {
    expect(行们(渲(`${头}| 主渠道｜子渠道 | 5 | 王五 |`))[1]).toEqual(["主渠道｜子渠道", "5", "王五"]);
  });

  it("没转义的老对话：列数多于表头，贴字的那条竖线并回去", () => {
    // 名字在第二列也能找回来：分界两边有空格，名字里的竖线两边贴着字
    const h = 渲("| 负责人 | 客户 | 新增 |\n|---|---|---|\n| 张三 | 区域|主体 | 3 |\n| 李四 | 普通客户 | 2 |");
    expect(行们(h)).toEqual([
      ["负责人", "客户", "新增"],
      ["张三", "区域|主体", "3"],
      ["李四", "普通客户", "2"],
    ]);
  });

  it("没转义且竖线两边有空格：多出的格并进第一列（名字惯例在第一列），原文照显示", () => {
    expect(行们(渲(`${头}| 主渠道 | 子渠道 | 5 | 王五 |`))[1]).toEqual(["主渠道 | 子渠道", "5", "王五"]);
  });

  it("列数正好的行一格不动；空格子不当成贴字", () => {
    expect(行们(渲(`${头}| a |  | c |\n| x | y | z |`)).slice(1)).toEqual([
      ["a", "", "c"],
      ["x", "y", "z"],
    ]);
  });

  it("没有表头不知道该几列，不并：只认转义", () => {
    expect(行们(渲("| 区域\\|主体 | 3 |\n| 甲|乙 | 4 |"))).toEqual([
      ["区域|主体", "3"],
      ["甲", "乙", "4"],
    ]);
  });
});

describe("竖线：列数、正文、已知盲区", () => {
  const 行们 = (h: string) =>
    [...h.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd](?: class="md-num")?>(.*?)<\/t[hd]>/g)].map((c) => c[1].replace(/<[^>]+>/g, "")));

  it("列数按分隔行定：表头名字里自带没转义的 | 不把列数算大", () => {
    const h = 渲("| 区域|主体 | 新增 |\n|---|:--:|\n| 华东 | 区域|主体2 | 3 |\n| 华北 | 4 |");
    expect(行们(h)).toEqual([
      ["区域|主体", "新增"],
      ["华东 | 区域|主体2", "3"],
      ["华北", "4"],
    ]);
  });

  it("正文、列表、标题里的 \\| 还原成 |；行内代码里的原样", () => {
    const h = 渲("抬头是 区域\\|主体，代码 `a\\|b`\n- 渠道 主渠道\\|子渠道\n## NO.86565\\|线索验证");
    expect(h).toContain("区域|主体");
    expect(h).toContain("主渠道|子渠道");
    expect(h).toContain("NO.86565|线索验证");
    expect(h).toMatch(/<code class="md-code">a\\\|b<\/code>/);
    expect(h.replace(/<code[^>]*>.*?<\/code>/g, "")).not.toContain("\\");
  });

  // 下面两条是已知盲区，钉住现状：没转义时只能靠「贴字」和「名字在第一列」猜，猜不中就并错格（列数仍和表头对齐）
  it("盲区：紧凑表 |a|b|c|（分界不留空格）且名字不在第一列——并进了前两格", () => {
    expect(行们(渲("|负责人|客户|新增|\n|---|---|---|\n|张三|区域|主体|3|"))[1]).toEqual(["张三|区域", "主体", "3"]);
  });

  it("盲区：行内代码里带空格的 `a | b` 不在第一列——GFM 也会切开，兜底并进第一列", () => {
    expect(行们(渲("| 负责人 | 代号 | 新增 |\n|---|---|---|\n| 张三 | `a | b` | 3 |"))[1]).toEqual(["张三 | `a", "b`", "3"]);
  });
});

describe("产出方：回答提示词要求模型把格子里的 | 写成 \\|", () => {
  it("finalPrompt 里有这条，且模板字符串里写的是 \\\\|（到模型那儿是 \\|）", () => {
    const 源码 = readFileSync("src/lib/agent/run.ts", "utf8");
    const 段 = 源码.slice(源码.indexOf("const finalPrompt = `"), 源码.indexOf("const 组织回答"));
    expect(段).toContain("写成 \\\\|，例如 区域\\\\|主体；全角「｜」照原样写");
  });
});

describe("行内代码", () => {
  it("`13900008888` 渲染成 code，不是三个反引号", () => {
    const h = 渲("电话是 `13900008888`。");
    expect(h).toContain('class="md-code"');
    expect(h).toContain("13900008888");
    expect(h).not.toContain("`");
  });
});

describe("原来就有的那几样没被表格这一段带坏", () => {
  it("列表、标题、加粗照旧", () => {
    const h = 渲("## 标题\n- 一\n- 二\n**粗**");
    expect(h).toContain('class="md-h"');
    expect(h).toContain("<ul");
    expect(h).toContain("<li>");
    expect(h).toContain("<strong>");
  });

  it("分隔线仍然不占位", () => {
    expect(渲("上\n---\n下")).not.toContain("<hr");
  });
});

describe("数字列（设计语言 HC-2a，C6-A：现状主题右对齐、等宽）", () => {
  it("整列有字的格都是数字（金额、百分比、带单位）才加 .md-num，表头同列也加；日期、文字列不加", async () => {
    const { 数字列 } = await import("@/components/Markdown");
    expect([...数字列([["华东", "¥12,800", "35%", "11-20", "3 个"], ["北岸", "960", "—", "11-02", "12 个"]])]).toEqual([1, 2, 4]);
    const h = 渲("| 客户 | 金额 |\n|---|---|\n| 华东 | ¥12,800 |\n| 北岸 | 960 |");
    expect(h).toContain('<th class="md-num">');
    expect(h.match(/<td class="md-num">/g)?.length).toBe(2);
    expect(h).toMatch(/<td>.*华东.*?<\/td>/);
  });
});
