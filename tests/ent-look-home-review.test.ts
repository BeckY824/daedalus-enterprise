/**
 * PR4 首页 / 复盘 / 渠道观感（前端改版逐块确认 home.hero、home.ask、ov.data、ch.seg）：只动样式，不动行为。
 *
 *   home.hero  问候带一点模糊淡入；三条示例依次浮现（间隔 = --stagger）
 *   home.ask   输入框聚焦时一圈品牌色环；发送键从灰变可点时弹一下（--ease-spring）
 *   ov.data    全周期漏斗的条进页时从零长出；换时间段宽度平滑过渡（--t-morph）
 *   ch.seg     渠道表换「按子 / 按主」时行依次落位；刚建那一行的 row-fresh 照样压得过它
 *
 * 动效只许引用令牌（--t* / --ease* / --stagger），不许写裸毫秒和裸曲线；
 * 进场动画只用 backwards，不用 both / forwards——填住终帧会压掉悬停时抬起的 transform。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");

/** 取某个选择器（原样）那一条的声明体 */
function 规则(sel: string): string {
  const i = css.indexOf(`\n${sel} {`) + 1;
  expect(i, `globals.css 里找不到 ${sel}`).toBeGreaterThan(0);
  return css.slice(i + sel.length + 2, css.indexOf("}", i));
}

function 只用令牌(体: string, sel: string) {
  expect(体, `${sel} 写了裸时长`).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/);
  expect(体, `${sel} 写了裸曲线`).not.toMatch(/cubic-bezier|\bease-(?:in|out)\b/);
}

describe("首页", () => {
  it("问候模糊淡入，只引用令牌、不填终帧", () => {
    const 体 = 规则(".cli-welcome-t");
    expect(体).toMatch(/animation:\s*cli-greet-in var\(--t-morph\) var\(--ease\) backwards/);
    只用令牌(体, ".cli-welcome-t");
    expect(css).toMatch(/@keyframes cli-greet-in \{ from \{[^}]*filter: blur\(/);
  });

  it("示例依次浮现：间隔按 --stagger，不填终帧（悬停还要抬起来）", () => {
    const 体 = 规则(".cli-welcome-q > .cli-q");
    expect(体).toMatch(/animation:\s*cli-q-in var\(--t\) var\(--ease\) backwards/);
    expect(体).toMatch(/animation-delay:\s*calc\(var\(--stagger\)/);
    只用令牌(体, ".cli-welcome-q > .cli-q");
    expect(css).toMatch(/\.cli-welcome-q > \.cli-q:nth-child\(2\) \{ --q-i: 2; \}/);
  });

  it("输入框聚焦一圈品牌色环；发送键可点时弹一下", () => {
    const 焦 = 规则(".cli-input:focus-within");
    expect(焦).toMatch(/border-color:\s*var\(--brand\)/);
    expect(焦).toMatch(/box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--brand\)/);
    expect(规则(".cli-input")).toMatch(/box-shadow var\(--t-fast\) var\(--ease\)/);
    const 发 = 规则(".cli-send:not(:disabled)");
    expect(发).toMatch(/animation:\s*cli-send-on var\(--t\) var\(--ease-spring\) backwards/);
    只用令牌(发, ".cli-send:not(:disabled)");
  });
});

describe("复盘 · 数据", () => {
  it("漏斗条从零长出、换段宽度平滑过渡", () => {
    const 体 = 规则(".pfun-bar");
    expect(体).toMatch(/animation:\s*pfun-grow var\(--t-morph\) var\(--ease-morph\) backwards/);
    expect(体).toMatch(/transition:\s*width var\(--t-morph\) var\(--ease-morph\)/);
    只用令牌(体, ".pfun-bar");
    expect(css).toMatch(/@keyframes pfun-grow \{ from \{ clip-path: inset\(0 100% 0 0/);
  });

  it("卡点页签上人员选择留在原地，只变淡（页头不跳）", () => {
    const 体 = 规则(".data-shell-bar-who.is-na");
    expect(体).toMatch(/opacity:\s*0\.4/);
    expect(规则(".data-shell-bar-who")).toMatch(/transition:\s*opacity var\(--t\) var\(--ease\)/);
  });
});

describe("渠道", () => {
  it("换口径时行依次落位；刚建那一行的 row-fresh 优先级更高，不被盖掉", () => {
    const sel = ":where(.chan-list .ant-table-tbody > tr:not(.ant-table-placeholder)) > td";
    const 体 = 规则(sel);
    expect(体).toMatch(/animation:\s*chan-row-in var\(--t\) var\(--ease\) backwards/);
    expect(体).toMatch(/animation-delay:\s*calc\(var\(--stagger\)/);
    只用令牌(体, sel);
    // :where 压到 0 权重，.row-fresh > td（0,1,1）压得过 td（0,0,1）
    expect(css).toContain(".row-fresh > td { animation: row-fresh");
  });
});

describe("渠道（第二轮）", () => {
  it("排队序号只数真数据行（data-row-key），不假设第一行是测量行", () => {
    expect(css).toContain(":where(.chan-list .ant-table-tbody > tr:nth-child(2 of [data-row-key])) > td { --row-i: 1; }");
    expect(css).not.toMatch(/chan-list \.ant-table-tbody > tr:nth-child\(\d\)\)/);
  });
  it("投入记录 / 录入表单淡入落位；主渠道开关存好闪一下：只用令牌", () => {
    const 投 = 规则(".chan-invest > li, .chan-invest-form");
    expect(投).toMatch(/animation:\s*chan-invest-in var\(--t\) var\(--ease\) backwards/);
    只用令牌(投, "chan-invest");
    const 闪 = 规则(".chan-main-saved");
    expect(闪).toMatch(/animation:\s*chan-main-saved var\(--t-morph\) var\(--ease\) backwards/);
    只用令牌(闪, "chan-main-saved");
  });
});
