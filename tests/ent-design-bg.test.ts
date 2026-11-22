/**
 * 设计语言 · 底色与模块分区（11-22 用户定方案 A）。D-1 是两个方案共用的底子：
 *   - 卡片不再用阴影（--shadow-card: none），阴影只留给浮层；卡边接回 1px --line
 *   - 内容卡圆角统一到 10：16a 那段卡片和列表表格卡改读 --r-mod，现状 = --r-card，换皮主题兜底接回 --r-pop
 *   - 复盘任务看板列不铺灰底；手机顶栏白底 + 一根 --line
 * 只动现状皮肤：换皮主题都自己定义了 --shadow-card / --card-line / --r-pop，改 :root 的值漏不到它们身上。
 * 不连库、不起浏览器，只读源码。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, globals, 去注释, 根变量, 主题文件, 变量 } from "./skin-css";

const 净 = 去注释(globals);
const 现状 = String.raw`:root:is(:not([data-skin]), [data-skin="now"])`;
const 有规则 = (选择器: string, 体片: string) => {
  const i = 净.indexOf(`${选择器} {`);
  expect(i, `找不到规则 ${选择器}`).toBeGreaterThan(-1);
  expect(净.slice(i, 净.indexOf("}", i))).toContain(体片);
};

describe("D-1 底子：去卡影、圆角 10、看板列、390 顶栏", () => {
  const 根 = 根变量();

  it(":root 卡片无影、1px --line 边；--r-mod 兜底接 --r-pop", () => {
    expect(根.get("--shadow-card")).toBe("none");
    expect(根.get("--card-line")).toBe("var(--line)");
    expect(根.get("--r-mod")).toBe("var(--r-pop)");
    expect(根.get("--r-card")).toBe("10px");
  });

  it("现状的 --r-mod 是 --r-card（小样那张也是）", () => {
    有规则(`${现状}, [data-skin-preview="now"]`, "--r-mod: var(--r-card)");
  });

  it("换皮主题都自己定义卡影、卡边、浮层圆角，:root 改值漏不过去", () => {
    for (const { key, 文 } of 主题文件()) {
      const 块 = 去注释(文);
      const 主块 = 块.slice(块.indexOf("{") + 1, 块.indexOf("\n}"));
      const v = 变量(主块);
      for (const k of ["--shadow-card", "--card-line", "--r-pop", "--r-card"]) expect(v.has(k), `${key} 没定义 ${k}`).toBe(true);
    }
  });

  it("16a 卡片和列表表格卡读 --r-mod，不再借浮层的 --r-pop", () => {
    const i = 净.indexOf(":is(.home-card, .btodo-list");
    expect(净.slice(i, 净.indexOf("}", i))).toContain("border-radius: var(--r-mod)");
    有规则(".list .ant-table-wrapper .ant-table", "border-radius: var(--r-mod)");
    有规则(".list .ant-table-wrapper .ant-table-container", "border-radius: var(--r-mod)");
    有规则(`${现状}:not(.glass) .list .ant-table-wrapper .ant-table`, "box-shadow: 0 0 0 1px var(--card-line)");
  });

  it("antd 的卡片外壳、表头圆角和 --r-card 一致（现状 10）", async () => {
    const { themeConfig } = await import("@/lib/theme");
    const px = Number.parseFloat(根.get("--r-card")!);
    expect(themeConfig.components!.Card!.borderRadiusLG).toBe(px);
    expect(themeConfig.components!.Table!.headerBorderRadius).toBe(px);
  });

  it("分段钮（.cd-seg）选中：现状一圈 1px --line、字重 500；暗黑下比轨道亮（不读 --panel）", () => {
    有规则(`${现状} .cd-seg > button.on`, "box-shadow: 0 0 0 1px var(--line); font-weight: 500");
    有规则(`:root[data-mode="dark"]:is(:not([data-skin]), [data-skin="now"]) .cd-seg > button.on`, "background: color-mix(in srgb, var(--ink) 10%, var(--hover))");
  });

  it("玻璃模式下表格卡不再叠一圈 1px（html.glass 自己有边）", () => {
    expect(净).not.toContain(`${现状} .list .ant-table-wrapper .ant-table {`);
    expect(净).toMatch(/html\.glass \.ant-table-wrapper \.ant-table \{ border: 1px/);
  });

  it("复盘任务看板列在现状下不铺灰底", () => {
    有规则(`${现状} .btodo-col`, "background: transparent");
  });

  it("客户状态条没了卡影，三边用 --card-line 认边", () => {
    有规则(`${现状} .tri-bar`, "border-top: 1px solid var(--card-line)");
  });

  it("手机顶栏：现状白底 + --line 底线，换皮照旧 --line-soft；线不再写在行内样式里", () => {
    有规则(".m-top", "border-bottom: 1px solid var(--line-soft)");
    有规则(`${现状} .m-top`, "background: var(--panel); border-bottom-color: var(--mod-line)");
    const shell = fs.readFileSync(path.join(源, "components/AppShell.tsx"), "utf8");
    const 行 = shell.split("\n").find((l) => l.includes('<Header className="m-top"'));
    expect(行).toBeDefined();
    expect(行).not.toContain("borderBottom");
  });
});

describe("D-2 方案 A「一张纸」：token、原底开关、三页", () => {
  const 根 = 根变量();
  const A = `${现状}:not([data-paper="tone"])`;
  const 暗 = 去注释(fs.readFileSync(path.join(源, "app/dark.css"), "utf8"));
  const 共 = 去注释(fs.readFileSync(path.join(源, "app/skins/shared.css"), "utf8"));

  it("新 token 在 :root 有兜底：--mod-line = --line（比行线深一档）、--mod-title、--pop-bg、--rail-bg 跟地面", () => {
    expect(根.get("--mod-line")).toBe("var(--line)");
    expect(根.get("--mod-title")).toBe("var(--text-muted)");
    expect(根.get("--pop-bg")).toBe("var(--panel)");
    expect(根.get("--rail-bg")).toBe("var(--page-bg)");
    expect(根.get("--page-bg")).toBe("var(--workbench)"); // 换皮主题的地面不动
  });

  it("现状：页面一张白纸、左栏浅灰；「原底」退回浅灰地面；左栏选中块两种底色都是白底", () => {
    有规则(`${现状}, [data-skin-preview="now"]`, "--page-bg: var(--panel); --rail-bg: var(--workbench)");
    有规则(`${现状}[data-paper="tone"]`, "--page-bg: var(--workbench)");
    有规则(`${现状}[data-paper="white"]:not([data-mode="dark"])`, "--nav-on-bg: var(--panel)");
    expect(净).toContain(`${现状}:not([data-mode="dark"]) :is(.rail-on-bg, .rail-fav-i.on) {`);
    expect(净).toContain(".rail { width: var(--rail-w); flex: none; position: sticky; top: 0; height: 100vh; background: var(--rail-bg);");
  });

  it("暗黑（现状）：模块线用浅的那档、浮层抬亮到 #1D2026 并加 1px 线；antd 浮层底读 --pop-bg", () => {
    const i = 暗.indexOf(':root[data-mode="dark"][data-skin="now"],');
    const 块 = 暗.slice(i, 暗.indexOf("}", i));
    expect(块).toContain("--mod-line: var(--line-soft)");
    expect(块).toContain("--pop-bg: #1d2026");
    expect(块).toContain("--shadow-pop: 0 0 0 1px var(--line)");
    for (const 片 of ["--ant-color-bg-elevated: var(--pop-bg)", "--ant-modal-content-bg: var(--pop-bg)", "--ant-modal-header-bg: var(--pop-bg)"]) expect(共).toContain(片);
  });

  it("方案 A 的形状规则都限在现状 + 非原底下（换皮、原底不受影响）", () => {
    const 起 = 净.indexOf(`${A} .rail, ${A} .pane {`);
    expect(起).toBeGreaterThan(0);
    const 段 = 净.slice(起);
    const 选择器们 = [...段.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => m[1].trim().replace(/\s+/g, " ").split(/,(?![^()]*\))\s*/)).filter((x) => !x.startsWith("@"));
    expect(选择器们.length).toBeGreaterThan(30);
    expect(选择器们.filter((x) => !x.startsWith(现状))).toEqual([]);
    expect(选择器们.filter((x) => !x.startsWith(A) && !x.includes(".rail-fb-dot"))).toEqual([]);
  });

  it("三页：首页右栏 / 客户详情三栏 / 复盘各块不画卡，模块之间、栏与栏之间一根 --mod-line，模块标题 13 / 600 灰", () => {
    有规则(`${A} .home-cards`, "border-left: 1px solid var(--mod-line)");
    有规则(`${A} .home-cards > .home-card`, "border: 0; border-radius: 0; background: transparent");
    有规则(`${A} .home-cards .home-card-k`, "font-size: var(--fs-note); font-weight: 600; color: var(--mod-title)");
    有规则(`${A} .cli-ck .cli-frame`, "border-color: transparent");
    有规则(`${A} .rec-page .rec.rec-cd > .rec-rail`, "border-right: 1px solid var(--mod-line)");
    有规则(`${A} .rec-page .cd-zb > .cd-side`, "border-left: 1px solid var(--mod-line)");
    expect(净).toMatch(/\.rec-page :is\(\.rec-rail-blocks, \.cd-mid, \.cd-side\) > \.proj-fold > \.ant-card \{ border: 0; border-radius: 0; background: transparent; box-shadow: none; \}/);
    expect(净).toMatch(/\.proj-fold > \.ant-card > \.ant-card-head \.ant-card-head-title \{ font-size: var\(--fs-note\); font-weight: 600; color: var\(--mod-title\); \}/);
    有规则(`${A} .btodo-list`, "border: 0; border-top: 1px solid var(--mod-line); border-radius: 0; background: transparent");
    有规则(`${A} .btodo-list > .btodo-head .section-title`, "color: var(--mod-title)");
    有规则(`${A} .btodo-board > .btodo-col + .btodo-col`, "border-left: 1px solid var(--mod-line)");
    有规则(`${A} .btodo-cards > .btodo-card + .btodo-card`, "border-left: 1px solid var(--mod-line)");
  });

  it("叶子小块照旧铺一档浅底：首页对话的步骤条、客户详情的节点条不跟着去底", () => {
    有规则(".ais-done", "background: var(--workbench)");
    expect(净.slice(净.indexOf(`${A} .rail, ${A} .pane {`))).not.toMatch(/\.ais-done|\.proj-stage/);
  });
});
