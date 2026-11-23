/**
 * 设计语言 · 卡片底子（D-1，11-22）：
 *   - 卡片不再用阴影（--shadow-card: none），阴影只留给浮层；卡边接回 1px --line
 *   （D-55 · 11-23 改：白卡压白底 --line 只有约 1.28:1，卡片外框全站换成 --field-line + 很淡的影 --card-raise-a，表格行线、分隔线不动）
 *   - 内容卡圆角统一到 10：16a 那段卡片和列表表格卡读 --r-mod = --r-card
 *   - 复盘任务看板列不铺灰底；手机顶栏白底 + 一根 --line
 * 11-23 外观只留一套：D-2 方案 A「一张纸」和底色开关都删了，页面是 :root 的卡片。
 * 卡片改进（11-23 用户定最终外观）：只有导航栏（左栏、手机顶栏）铺 --workbench 浅灰，页面底和卡片都是白（--panel）；暗黑跟着 dark.css 的这两个色。
 * 不连库、不起浏览器，只读源码。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, globals, 去注释, 根变量 } from "./css-read";

const 净 = 去注释(globals);
const 现状 = ":root:root";
const 有规则 = (选择器: string, 体片: string) => {
  const i = 净.indexOf(`${选择器} {`);
  expect(i, `找不到规则 ${选择器}`).toBeGreaterThan(-1);
  expect(净.slice(i, 净.indexOf("}", i))).toContain(体片);
};

describe("D-1 底子：去卡影、圆角 10、看板列、390 顶栏", () => {
  const 根 = 根变量();

  it(":root 卡片外框 --field-line + 很淡的影（D-55）；--r-mod 就是 --r-card（10）；页面底白、左栏浅灰、浮层底白", () => {
    expect(根.get("--shadow-card")).toBe("0 1px 2px rgb(0 0 0 / var(--card-raise-a))");
    expect(根.get("--card-raise-a")).toBe("0.04");
    expect(根.get("--card-line")).toBe("var(--field-line)");
    expect(根.get("--line"), "行线、分隔线不跟着卡边变深").toBe("#e3e3e8");
    expect(根.get("--r-mod")).toBe("var(--r-card)");
    expect(根.get("--r-card")).toBe("10px");
    expect(根.get("--page-bg")).toBe("var(--panel)");
    expect(根.get("--rail-bg")).toBe("var(--workbench)");
    expect(根.get("--mod-line")).toBe("var(--line)");
    expect(根.get("--pop-bg")).toBe("var(--panel)");
  });

  it("16a 卡片和列表表格卡读 --r-mod，不再借浮层的 --r-pop", () => {
    const i = 净.indexOf(":is(.home-card, .btodo-list");
    expect(净.slice(i, 净.indexOf("}", i))).toContain("border-radius: var(--r-mod)");
    有规则(".list .ant-table-wrapper .ant-table", "border-radius: var(--r-mod)");
    有规则(".list .ant-table-wrapper .ant-table-container", "border-radius: var(--r-mod)");
    有规则(`${现状} .list .ant-table-wrapper .ant-table`, "box-shadow: 0 0 0 1px var(--card-line), var(--shadow-card)");
  });

  it("antd 的卡片外壳、表头圆角和 --r-card 一致（现状 10）", async () => {
    const { themeConfig } = await import("@/lib/theme");
    const px = Number.parseFloat(根.get("--r-card")!);
    expect(themeConfig.components!.Card!.borderRadiusLG).toBe(px);
    expect(themeConfig.components!.Table!.headerBorderRadius).toBe(px);
  });

  it("分段钮（.cd-seg）选中：一圈 1px --line、字重 500；暗黑下比轨道亮（不读 --panel）", () => {
    有规则(`${现状} .cd-seg > button.on`, "box-shadow: 0 0 0 1px var(--line); font-weight: 500");
    有规则(`${现状}[data-mode="dark"] .cd-seg > button.on`, "background: color-mix(in srgb, var(--ink) 10%, var(--hover))");
  });

  it("复盘任务看板列不铺灰底", () => {
    有规则(`${现状} .btodo-col`, "background: transparent");
  });

  it("客户状态条三边用 --card-line 认边", () => {
    有规则(`${现状} .tri-bar`, "border-top: 1px solid var(--card-line)");
  });

  it("手机顶栏：是手机上的导航栏，和左栏同铺 --rail-bg + --mod-line 底线（盖过基础规则的 --line-soft）；线不再写在行内样式里", () => {
    有规则(".m-top", "border-bottom: 1px solid var(--line-soft)");
    有规则(`${现状} .m-top`, "background: var(--rail-bg); border-bottom-color: var(--mod-line)");
    const shell = fs.readFileSync(path.join(源, "components/AppShell.tsx"), "utf8");
    const 行 = shell.split("\n").find((l) => l.includes('<Header className="m-top"'));
    expect(行).toBeDefined();
    expect(行).not.toContain("borderBottom");
  });

  it("暗黑不另定页面底、左栏底：跟着 dark.css 的 --panel / --workbench 走（页面 #171a1f、左栏 #0f1115，照原型-卡片改进深色）", () => {
    const 暗 = 去注释(fs.readFileSync(path.join(源, "app/dark.css"), "utf8"));
    expect(暗).not.toMatch(/--page-bg\s*:/);
    expect(暗).not.toMatch(/--rail-bg\s*:/);
    expect(暗).toContain("--workbench: #0f1115; --panel: #171a1f;");
    // 卡片外框暗黑同一写法：--field-line #3a3f48 + 影的透明度 .30
    expect(暗).toContain("--card-line: var(--field-line);");
    expect(暗).toContain("--card-raise-a: 0.3;");
    expect(暗).toContain("--shadow-card: 0 1px 2px rgb(0 0 0 / var(--card-raise-a));");
  });

  it("左栏实底（D-55）：只有 .rail 那条 background: var(--rail-bg)，不再有半透明 color-mix + backdrop-filter 的覆盖", () => {
    有规则(".rail", "background: var(--rail-bg)");
    expect(净).not.toMatch(/html \.rail\s*\{/);
    expect(净).not.toMatch(/backdrop-filter/);
    // 选择器落在左栏本身（最后一段是 .rail）的规则，底色只许是 --rail-bg
    const 左栏本身 = [...净.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").some((x) => /\.rail\s*$/.test(x.trim())) && /background(-color)?\s*:/.test(m[2]));
    expect(左栏本身.length).toBeGreaterThan(0);
    for (const m of 左栏本身) expect(m[2], m[1].trim()).toMatch(/background(-color)?\s*:\s*var\(--rail-bg\)/);
  });

  it("设置开关卡（.sw-card / .sw-ov）外框也走 --card-line", () => {
    const 设 = 去注释(fs.readFileSync(path.join(源, "app/(app)/settings/settings.css"), "utf8"));
    for (const k of [".sw-ov {", ".sw-card {"]) {
      const i = 设.indexOf(k);
      expect(设.slice(i, 设.indexOf("}", i)), k).toContain("border: 1px solid var(--card-line)");
    }
  });
});

describe("设置页套卡、外观小样（11-23 审查）", () => {
  it("设置大卡 .set-body 里套的卡退回 --line、不带影（不出两道深线），定位高亮 .set-hit 不让", () => {
    有规则(".set-body :is(.ant-card.ant-card-bordered, .sw-ov, .sw-card):not(.set-hit)", "border-color: var(--line); box-shadow: none;");
  });

  it("外观明暗小样和实际一致：白页面 + 浅灰左栏条 + 白卡（--field-line 边）；浅色小样那份也给 --field-line", () => {
    有规则(".appr-mini-mode", "padding: 0; overflow: hidden; background: var(--panel);");
    有规则(".appr-mini-half", "flex: 1; display: flex; gap: 6px; background: var(--panel);");
    有规则(".appr-mini-rail", "width: 22%; background: var(--workbench);");
    有规则(".appr-mini-card", "background: var(--panel); border: 1px solid var(--field-line);");
    const 暗 = 去注释(fs.readFileSync(path.join(源, "app/dark.css"), "utf8"));
    const i = 暗.indexOf('[data-mode-preview="light"] {');
    expect(暗.slice(i, 暗.indexOf("}", i))).toContain("--field-line: #c7c7cc");
  });
});

describe("暗黑下的 antd 浮层和分段、页签", () => {
  const 共 = 去注释(fs.readFileSync(path.join(源, "app/antd-dark.css"), "utf8"));

  it("antd 浮层底读 --pop-bg", () => {
    for (const 片 of ["--ant-color-bg-elevated: var(--pop-bg)", "--ant-modal-content-bg: var(--pop-bg)", "--ant-modal-header-bg: var(--pop-bg)"]) expect(共).toContain(片);
  });

  it("暗黑：浮层抬亮到 #1D2026 并加 1px 线、模块线用浅的那档，写在 :root[data-mode=\"dark\"] 块里无条件生效（页面底 = --panel，浮层同色没边认不出）", () => {
    const 暗 = 去注释(fs.readFileSync(path.join(源, "app/dark.css"), "utf8"));
    const i = 暗.indexOf(':root[data-mode="dark"],');
    expect(i, "暗黑主块").toBeGreaterThan(-1);
    const 块 = 暗.slice(i, 暗.indexOf("}", i));
    expect(块).toContain("--mod-line: var(--line-soft)");
    expect(块).toContain("--pop-bg: #1d2026");
    expect(块).toContain("--shadow-pop: 0 0 0 1px var(--line), 0 8px 24px rgba(0, 0, 0, 0.5)");
    expect(块, "浮层底不能和页面底同色").not.toContain("--pop-bg: #171a1f");
    // 不能再挂在 data-skin / data-paper 条件上（那两个开关已删，挂上就永远不生效）
    expect(暗).not.toMatch(/data-(skin|paper)/);
  });

  it("分段控件选中字、页签未选中字跟着 --ink（theme.ts 写死的是浅色墨色）", () => {
    const 段 = 共.slice(共.indexOf(".css-var-dd:is(.ant-segmented, .ant-segmented-css-var)"));
    const 段体 = 段.slice(0, 段.indexOf("}"));
    expect(段体).toContain("--ant-segmented-item-selected-color: var(--ink)");
    expect(段体).toContain("--ant-segmented-item-hover-color: var(--ink)");
    const 签 = 共.slice(共.indexOf(".css-var-dd:is(.ant-tabs, .ant-tabs-css-var)"));
    expect(签.slice(0, 签.indexOf("}"))).toContain("--ant-tabs-item-color: var(--ink)");
  });
});
