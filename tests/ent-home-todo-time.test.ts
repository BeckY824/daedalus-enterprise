/**
 * 首页顶部待办的时间（设计语言 H-A，11-21，H-新13）：服务端多传的 ISO 瞬间走 smartTime，不从「MM-DD HH:mm」短串认回（短串没年份，跨年会认错）。
 * 单测时区是 Asia/Shanghai（vitest.config），和生产一致；浏览器按企业版业务钟（北京）算那半在 ent-design-ha-layout.ui.test.ts（页面开在伦敦时区）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { 时段smart } from "@/app/(app)/dashboard/todo-time";
import ReplyDueTodo from "@/app/(app)/dashboard/ReplyDueTodo";
import AwaitAssignTodo from "@/app/(app)/leads/AwaitAssignTodo";
import { 短时刻, 指定回复文字 } from "@/lib/project/time-fields";

const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`).toISOString();
const 现在是 = (s: string) => vi.useFakeTimers({ now: new Date(京(s)), toFake: ["Date"] });
afterEach(() => { vi.useRealTimers(); });

describe("时段smart（指定回复时间）", () => {
  it("同一天只写结束钟点；跨天两头都写；只填一头写「前后」「前」；开始不带钟点（昨天、N 天前）只写开始；都没有 = null", () => {
    现在是("2026-11-21 12:00");
    expect(时段smart(京("2026-11-21 21:00"), 京("2026-11-21 22:00"))).toBe("今天 21:00 – 22:00");
    expect(时段smart(京("2026-11-21 21:00"), 京("2026-11-22 09:00"))).toBe("今天 21:00 – 明天 09:00");
    expect(时段smart(京("2026-11-20 21:00"), 京("2026-11-20 22:00"))).toBe("昨天");
    expect(时段smart(京("2026-11-18 21:00"), 京("2026-11-18 22:00"))).toBe("3 天前");
    expect(时段smart(京("2026-11-21 21:00"), null)).toBe("今天 21:00 前后");
    expect(时段smart(null, 京("2026-11-22 09:00"))).toBe("明天 09:00 前");
    expect(时段smart(null, null)).toBeNull();
  });

  it("跨年：12-31 23:50 – 01-01 00:10 按北京日界线分两天，跨年那头不当成今年", () => {
    现在是("2026-12-31 23:55");
    expect(时段smart(京("2026-12-31 23:50"), 京("2027-01-01 00:10"))).toBe("今天 23:50 – 明天 00:10");
    现在是("2027-01-01 00:20");
    expect(时段smart(京("2026-12-31 23:50"), 京("2027-01-01 00:10"))).toBe("昨天 – 今天 00:10");
    现在是("2027-01-20 09:00");
    expect(时段smart(京("2026-12-31 23:50"), 京("2027-01-01 00:10"))).toBe("2026 年 12 月 31 日 – 1 月 1 日");
  });
});

describe("首页待办行用 ISO，不用短串", () => {
  it("待回复客户：跨年那条用 始 / 终 写「昨天 – 今天 00:10」；短串（服务端那一刻写的、可能没年份）只给换皮主题和旧数据", () => {
    现在是("2027-01-01 00:20");
    // 服务端在 2026-12-31 写的短串，开始那头没年份（「12-31 23:50」）：到了 2027 年从它认回会当成 2027-12-31，所以前端只用 ISO
    const 短 = 指定回复文字(new Date(京("2026-12-31 23:50")), new Date(京("2027-01-01 00:10")), new Date(京("2026-12-31 23:55")));
    expect(短).toBe("12-31 23:50 – 2027-01-01 00:10");
    const html = renderToStaticMarkup(createElement(ReplyDueTodo, { 数据: { 条数: 1, 最早: { projectId: "p", name: "某项目", 时: 短, 始: 京("2026-12-31 23:50"), 终: 京("2027-01-01 00:10") } } }));
    expect(html).toContain('<span class="home-cth-todo-time">指定回复 昨天 – 今天 00:10</span>');
    expect(html).toContain("待回复客户 1 条");
    // 没有 ISO（旧数据）：照摆短串
    expect(renderToStaticMarkup(createElement(ReplyDueTodo, { 数据: { 条数: 1, 最早: { projectId: "p", name: "某项目", 时: "11-21 21:00 – 22:00" } } }))).toContain("指定回复 11-21 21:00 – 22:00");
  });

  it("按分配超时：始 = 计时起点，写「N 天前 分配」/「昨天 分配」", () => {
    现在是("2027-01-01 00:20");
    const html = renderToStaticMarkup(createElement(ReplyDueTodo, { 数据: { 条数: 1, 超时: 1, 最早: { projectId: "p", name: "某项目", 时: 短时刻(new Date(京("2026-12-31 23:50")), new Date(京("2026-12-31 23:55")))!, 始: 京("2026-12-31 23:50"), 终: null, 超时: true, 分配话: "分配后 1 小时未跟进" } } }));
    expect(html).toContain('<span class="home-cth-todo-time">昨天 分配</span> · 某项目 · 分配后 1 小时未跟进');
    expect(html).toContain("（超时 1 条）");
  });

  it("待分配新线索：用 最早At；跨年 12-31 23:50 在 01-01 看是「昨天」", () => {
    现在是("2027-01-01 00:20");
    const html = renderToStaticMarkup(createElement(AwaitAssignTodo, { 数据: { 条数: 2, 最早: "12-31 23:50", 最早At: 京("2026-12-31 23:50") } }));
    expect(html).toContain('最早 <span class="home-cth-todo-time">昨天</span>');
    现在是("2027-01-01 00:20");
    expect(renderToStaticMarkup(createElement(AwaitAssignTodo, { 数据: { 条数: 2, 最早: "2027-01-01 00:10", 最早At: 京("2027-01-01 00:10") } }))).toContain('<span class="home-cth-todo-time">今天 00:10</span>');
  });
});
