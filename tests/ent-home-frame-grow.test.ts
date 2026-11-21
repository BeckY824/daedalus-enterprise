/**
 * 首页左卡越框（11-21 用户截图：待办把输入框挤出白卡底边）。根因：还没问时左框 `.cli-empty .cli-ck .cli-frame { contain: size; }`，
 * 框高只认右边卡列、不认自己的内容，框顶上摆了待办就溢出。现在去掉 contain: size，靠网格默认 stretch：
 * 框至少和卡列一样高（没待办时和原来一样齐），内容多了框跟着长，不越框、框里不出滚动条。
 * 不开浏览器：只钉样式规则和待办挂在框里这两件；布局实测在 3703 用浏览器做（ent-home-frame.ui.test.ts 量没待办时等高）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");
/** 去掉注释，只看规则 */
const 规则 = css.replace(/\/\*[\s\S]*?\*\//g, "");
/** 选择器里带 .cli-frame 的所有规则体（不含嵌在 @container 里的也一起算） */
const 框规则 = [...规则.matchAll(/([^{}]*\.cli-frame[^{}]*)\{([^}]*)\}/g)].map((m) => ({ 选: m[1].trim(), 体: m[2] }));

describe("首页左框高度：至少和卡列一样高，内容多了跟着长", () => {
  it("框上没有 contain: size（不再只认卡列的高）", () => {
    expect(框规则.length).toBeGreaterThan(0);
    for (const r of 框规则) expect(r.体, r.选).not.toMatch(/contain\s*:\s*(size|strict|layout\s+size|size\s+layout)/);
  });

  it("框不定高、不设最大高、不出内部滚动条", () => {
    for (const r of 框规则.filter((r) => /\.cli-frame\s*$/.test(r.选) || /\.cli-frame\s*,/.test(r.选))) {
      expect(r.体, r.选).not.toMatch(/(^|[;\s])(height|max-height)\s*:/);
      expect(r.体, r.选).not.toMatch(/overflow(-y)?\s*:\s*(auto|scroll|hidden)/);
    }
  });

  it("没待办时的对齐照旧：这一格不撑满整屏（flex: none）、右边卡照内容高（align-self: start），框靠网格 stretch 拉到卡列高", () => {
    expect(规则).toMatch(/\.cli-empty \.cli-ck-g \{ flex: none; \}/);
    expect(规则).toMatch(/\.cli-empty \.home-cards \{ align-self: start; position: static; \}/);
    // 网格这一格不设 align-items（默认 stretch），框（.cli-col）也不设 align-self
    expect(规则).toMatch(/\.cli-ck-g \{ flex: 1; display: grid;[^}]*\}/);
    expect(/\.cli-ck-g \{[^}]*align-items/.test(规则)).toBe(false);
    expect(/\.cli-ck \.cli-col \{[^}]*align-self/.test(规则)).toBe(false);
  });

  it("输入框还是贴框底（margin-top: auto）", () => {
    expect(规则).toMatch(/\.cli-empty \.cli-frame \.cli-composer \{ margin-top: auto;/);
  });

  it("窄屏（这一格 ≤ 639）照旧单列、卡 2×2", () => {
    const 窄 = /@container \(max-width: 639px\) \{([\s\S]*?)\n\}/.exec(规则)?.[1] ?? "";
    expect(窄).toMatch(/\.cli-ck-g \{ grid-template-columns: minmax\(0, 1fr\); align-content: start; \}/);
    expect(窄).toMatch(/\.home-cards \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(窄).toMatch(/\.cli-ck \.cli-frame \{ padding: var\(--s4\); \}/);
  });

  it("首页待办都画在左框里（HomeChat 对话列），框长高才把它们包住", () => {
    const src = readFileSync("src/app/(app)/dashboard/HomeChat.tsx", "utf8");
    const 列 = /const 对话列 = \(([\s\S]*?)\n  \);/.exec(src)?.[1] ?? "";
    expect(列).toMatch(/cli-col\$\{外框 \? " cli-frame" : ""\}/);
    for (const 件 of ["放弃条", "<AwaitAssignTodo", "<CoachTopicTodo", "<ReplyDueTodo", "待复核", "<AssignEtaLine", "<Composer"]) expect(列).toContain(件);
  });
});
