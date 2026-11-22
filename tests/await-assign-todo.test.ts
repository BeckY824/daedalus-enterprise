/**
 * 首页待办「待分配新线索 N 条 · 最早 … · 去分配 ›」那一行（11-21，替原来的黄色大卡 LeadFullNotices）：
 * 不引浏览器：renderToStaticMarkup（同 ai-meter-bar.test.ts）。钉：没有 = 不画；一行、带条数和最早时间、链到新线索页的筛选；
 * 没有关闭按钮（分走了自动少）；只占一行（home-cth-todo-one 不换行，塞进首页左卡不把卡撑高）
 */
import { describe, it, expect, vi, afterEach } from "vitest";
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

  afterEach(() => { vi.useRealTimers(); });
  it("有：一行，条数、最早时间、去分配链到 /leads?f=await-assign；没有关闭按钮", () => {
    // 最早是服务端按北京墙钟写好的（list.ts 数待分配 → 短时刻）；设计语言 H-A（11-21，H-新13）现状主题把它认回那一刻再走 smartTime
    // （全站同一套：今天 16:00 · 昨天 · 3 天前 · 11 月 18 日），时间不拆行（home-cth-todo-time）
    vi.useFakeTimers({ now: new Date("2026-11-21T12:00:00+08:00"), toFake: ["Date"] });
    const html = 渲({ 条数: 3, 最早: "11-20 16:00" });
    expect(html).toContain("待分配新线索 3 条");
    expect(html).toContain('最早 <span class="home-cth-todo-time">昨天</span>');
    expect(渲({ 条数: 1, 最早: "11-21 09:30" })).toContain('<span class="home-cth-todo-time">今天 09:30</span>');
    // 认不出的串原样摆（不丢字）
    expect(渲({ 条数: 1, 最早: "—" })).toContain('<span class="home-cth-todo-time">—</span>');
    expect(html).toContain('href="/leads?f=await-assign"');
    expect(html).toContain("去分配 ›");
    expect(html).toContain('class="home-cth-todo home-cth-todo-one"');
    expect(html).not.toMatch(/<button|关闭/);
    // 不再一条线索一张卡、不列线索名
    expect(html.match(/home-cth-todo-one/g)).toHaveLength(1);
  });

  it("只占一行：home-cth-todo-one 不换行、放不下省略（换皮主题）；现状主题和别的待办同一种行，放不下折行、时间不截（H-A）", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(':root:is(:not([data-skin]), [data-skin="now"]) .home-cth-todo-one { flex-wrap: wrap;');
    expect(css).toContain(':root:is(:not([data-skin]), [data-skin="now"]) .home-cth-todo-time { white-space: nowrap; }');
    expect(css).toMatch(/\.home-cth-todo-one \{[^}]*flex-wrap: nowrap/);
    expect(css).toMatch(/\.home-cth-todo-one \.home-cth-todo-t \{[^}]*text-overflow: ellipsis/);
    // 整行不裁（overflow: hidden 会裁掉「去分配」的键盘焦点框），省略只在标题、中间那段上
    expect(/\.home-cth-todo-one \{[^}]*overflow/.test(css)).toBe(false);
  });
});

describe("文案不再一句里两种说法（11-21）", () => {
  it("挑不到人回的整句只留原因本身", () => {
    expect(挑不到原因("外贸线没人可分。这条新线索留在原处，可以手动指派")).toBe("外贸线没人可分");
    expect(挑不到原因("外贸线没人可分。已留在新线索待分配，可以手动指派")).toBe("外贸线没人可分");
    expect(挑不到原因("这条业务线没人可分")).toBe("这条业务线没人可分");
  });
});
