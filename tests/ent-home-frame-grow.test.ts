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

  it("框不定高、不设最大高、不出内部滚动条（问过之后的「一张纸」.cli-paper 除外：设计语言 HC-1 用户 11-22 定框钉视口高、对话在框里滚）", () => {
    for (const r of 框规则.filter((r) => (/\.cli-frame\s*$/.test(r.选) || /\.cli-frame\s*,/.test(r.选)) && !r.选.includes(".cli-paper"))) {
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

  it("输入框还是贴框底（margin-top: auto；现状主题 HC-1 起改成问候到输入框这一组上下居中，见 ent-hc1-layout.ui.test.ts C5，这条老规则留给换皮主题）", () => {
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
    // HC-1：待办那几行收成一份 待办，还没问时原样摆在框顶，问过之后（一张纸）递给框头「待办 N」
    expect(列).toMatch(/\{一张纸 \? <ChatHead [\s\S]*?待办=\{待办\} \/> : 待办\}/);
    expect(列).toContain("<Composer");
    const 待办 = /const 待办 = !窄 && \(([\s\S]*?)\n  \);/.exec(src)?.[1] ?? "";
    for (const 件 of ["放弃条", "<AwaitAssignTodo", "<CoachTopicTodo", "<ReplyDueTodo", "待复核", "<AssignEtaLine"]) expect(待办).toContain(件);
  });
});
