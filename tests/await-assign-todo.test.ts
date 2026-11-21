/**
 * 首页待办「待分配新线索 N 条 · 最早 … · 去分配 ›」那一行（11-21，替原来的黄色大卡 LeadFullNotices）：
 * 不引浏览器：renderToStaticMarkup（同 ai-meter-bar.test.ts）。钉：没有 = 不画；一行、带条数和最早时间、链到新线索页的筛选；
 * 没有关闭按钮（分走了自动少）；只占一行（home-cth-todo-one 不换行，塞进首页左卡不把卡撑高）
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import AwaitAssignTodo from "@/app/(app)/leads/AwaitAssignTodo";
import { 挑不到原因 } from "@/lib/enterprise/await-assign-core";

const 渲 = (数据: Parameters<typeof AwaitAssignTodo>[0]["数据"]) => renderToStaticMarkup(createElement(AwaitAssignTodo, { 数据 }));

describe("待分配新线索那一行", () => {
  it("没有（null、0 条）：什么都不画", () => {
    expect(渲(null)).toBe("");
    expect(渲({ 条数: 0, 最早: null })).toBe("");
  });

  it("有：一行，条数、最早时间、去分配链到 /leads?f=await-assign；没有关闭按钮", () => {
    const html = 渲({ 条数: 3, 最早: "2026-11-20T08:00:00.000Z" });
    expect(html).toContain("待分配新线索 3 条");
    expect(html).toMatch(/最早 2026-11-20 \d\d:00/);
    expect(html).toContain('href="/leads?f=await-assign"');
    expect(html).toContain("去分配 ›");
    expect(html).toContain('class="home-cth-todo home-cth-todo-one"');
    expect(html).not.toMatch(/<button|关闭/);
    // 不再一条线索一张卡、不列线索名
    expect(html.match(/home-cth-todo-one/g)).toHaveLength(1);
  });

  it("只占一行：home-cth-todo-one 不换行、放不下省略", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.home-cth-todo-one \{[^}]*flex-wrap: nowrap/);
    expect(css).toMatch(/\.home-cth-todo-one \.home-cth-todo-t \{[^}]*text-overflow: ellipsis/);
  });
});

describe("文案不再一句里两种说法（11-21）", () => {
  it("挑不到人回的整句只留原因本身", () => {
    expect(挑不到原因("外贸线没人可分。这条新线索留在原处，可以手动指派")).toBe("外贸线没人可分");
    expect(挑不到原因("外贸线没人可分。已留在新线索待分配，可以手动指派")).toBe("外贸线没人可分");
    expect(挑不到原因("这条业务线没人可分")).toBe("这条业务线没人可分");
  });
});
