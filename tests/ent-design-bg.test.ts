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
    有规则(`${现状} .list .ant-table-wrapper .ant-table`, "box-shadow: 0 0 0 1px var(--card-line)");
  });

  it("antd 的卡片外壳、表头圆角和 --r-card 一致（现状 10）", async () => {
    const { themeConfig } = await import("@/lib/theme");
    const px = Number.parseFloat(根.get("--r-card")!);
    expect(themeConfig.components!.Card!.borderRadiusLG).toBe(px);
    expect(themeConfig.components!.Table!.headerBorderRadius).toBe(px);
  });

  it("复盘任务看板列在现状下不铺灰底", () => {
    有规则(`${现状} .btodo-col`, "background: transparent");
  });

  it("客户状态条没了卡影，三边用 --card-line 认边", () => {
    有规则(`${现状} .tri-bar`, "border-top: 1px solid var(--card-line)");
  });

  it("手机顶栏：现状白底 + --line 底线，换皮照旧 --line-soft；线不再写在行内样式里", () => {
    有规则(".m-top", "border-bottom: 1px solid var(--line-soft)");
    有规则(`${现状} .m-top`, "background: var(--panel); border-bottom-color: var(--line)");
    const shell = fs.readFileSync(path.join(源, "components/AppShell.tsx"), "utf8");
    const 行 = shell.split("\n").find((l) => l.includes('<Header className="m-top"'));
    expect(行).toBeDefined();
    expect(行).not.toContain("borderBottom");
  });
});
