/**
 * 色值只许在两个地方写死：globals.css 的 :root 和 lib/palette.ts。
 *
 * 2026-09-18 盘点：全站 79 个不同的 hex、170 多处，同一个浅蓝四个版本，
 * 主蓝有两个（#2f6bff 和 antd 的 #1668dc 并存了半年没人发现）。
 * 这不是审美问题，是"每次各拍一个"的必然结果——:root 顶上那段注释早就写了
 * "页面里不再出现裸 hex"，但没有守卫的规矩就是没有规矩（动效那套能守住，
 * 正是因为 motion-tokens.test.ts 钉着）。
 *
 * 两条：
 *   1. :root 和 palette.ts 之外不许有 hex——散一个就红，红的那行告诉你该用哪个 token
 *   2. palette.ts 里的每个值都必须在 :root 里有同样的值——两份镜像不许漂
 * Logo 原来是品牌图形放行；P10 起它的两色走 --logo-frame / --logo-line（暗黑要换），不再放行。
 * 暗黑（app/dark.css）和主题文件一样：色值只许在 token 块里。
 *
 * 运营台（/admin）原来另有一套色板、在这里单独放行，12c 整个删了。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 拆块 } from "./skin-css";

const 根目录 = path.resolve(__dirname, "../src");
const css = fs.readFileSync(path.join(根目录, "app/globals.css"), "utf8");
// 去注释时把块注释换成同样多的换行，报出来的行号才对得上编辑器
const 去注释 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, "")).replace(/^\s*\/\/.*$/gm, "");
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function 所有源文件(dir: string): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n !== "generated") out.push(...所有源文件(p));
    } else if (/\.(tsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}

const 放行 = new Set(["app/globals.css", "lib/palette.ts"]);

/** 主题（app/skins/*.css）：色值只许写在 token 块里（:root[data-skin="x"] {…}、白底那块、小样那块），形状规则里一个都不许有 */
const 抹主题token块 = (文: string) => {
  let out = 文;
  // 从后往前抹：抹掉的块会变短，先抹前面的话后面那些块的位置就错了
  for (const b of 拆块(文).reverse()) if (b.token块) out = out.slice(0, b.起) + out.slice(b.起, b.止).replace(/[^\n]/g, "") + out.slice(b.止);
  return out;
};

describe("色值只在 :root 和 palette.ts 里写死", () => {
  it("别处一律用 token", () => {
    const 散的: string[] = [];
    for (const f of 所有源文件(根目录)) {
      const rel = path.relative(根目录, f).replaceAll("\\", "/");
      if (放行.has(rel)) continue;
      let 文 = 去注释(fs.readFileSync(f, "utf8"));
      if (rel.startsWith("app/skins/") || rel === "app/dark.css") 文 = 抹主题token块(文);
      const 行 = 文.split("\n");
      行.forEach((l, i) => {
        for (const m of l.match(HEX) ?? []) 散的.push(`${rel}:${i + 1} ${m}`);
      });
    }
    expect(散的, `这些地方还写着裸 hex，改成 var(--…) 或 palette.…：\n${散的.join("\n")}`).toEqual([]);
  });

  it("globals.css 里 :root 之外也不许有", () => {
    const 正文 = 去注释(css.slice(css.indexOf("\n}", css.indexOf(":root"))));
    expect(正文.match(HEX) ?? []).toEqual([]);
  });

  it("palette.ts 的每个值都在 :root 里，一字不差", async () => {
    const { palette, categorical, avatarBg } = await import("@/lib/palette");
    const 根 = 去注释(css.slice(css.indexOf(":root"), css.indexOf("\n}", css.indexOf(":root"))));
    const 根里的值 = new Set((根.match(HEX) ?? []).map((h) => h.toLowerCase()));
    const 漏了: string[] = [];
    for (const [k, v] of Object.entries({ ...palette, ...categorical })) if (!根里的值.has(v.toLowerCase())) 漏了.push(`${k}=${v}`);
    avatarBg.forEach((v, i) => { if (!根里的值.has(v.toLowerCase())) 漏了.push(`avatar[${i}]=${v}`); });
    expect(漏了, `palette.ts 里这些值 :root 没有：${漏了.join("、")}`).toEqual([]);
  });

  it("颜色总数有上限：语义色 + 八个分类色 + 八个头像色，再多就是又开始各拍各的", () => {
    const 根 = 去注释(css.slice(css.indexOf(":root"), css.indexOf("\n}", css.indexOf(":root"))));
    const 不同 = new Set((根.match(HEX) ?? []).map((h) => h.toLowerCase()));
    expect(不同.size).toBeLessThanOrEqual(48);
  });
});

/* D1 · 设计语言 11-21（客户详情规范；用户 11-21 定全站照走）。浏览器里的实测在 tests/ent-design-d1.ui.test.ts */
describe("D1 · 设计语言 token 和基础控件", () => {
  const 根 = 去注释(css.slice(css.indexOf(":root"), css.indexOf("\n}", css.indexOf(":root"))));
  const 全 = 去注释(css);
  const 取 = (名: string) => new RegExp(`${名}:\\s*([^;]+);`).exec(根)?.[1]?.trim();

  it("规范的 17 个 token 都在 :root，值照规范", () => {
    const 期 = {
      "--empty-fg": "var(--text-muted)", "--count-fg": "var(--text-muted)",
      "--hit": "28px", "--hit-touch": "44px", "--ctl-h-sm": "28px", "--ctl-h": "32px", "--ctl-h-lg": "40px",
      "--card-pad": "16px", "--card-head-h": "48px", "--card-gap": "12px",
      "--field-line": "#c7c7cc", "--field-line-hover": "#86868b", "--ctl-line": "#86868b",
      "--tag-bg": "var(--hover)", "--tag-fg": "var(--ink-soft)", "--edge-fade": "24px", "--skel-delay": "180ms",
      "--sheet-r": "var(--r-pop)", "--ai-safe": "72px",
    };
    for (const [k, v] of Object.entries(期)) expect(取(k), k).toBe(v);
    expect(取("--focus-ring")).toMatch(/^0 0 0 3px color-mix\(in srgb, var\(--brand\) 18%, transparent\)$/);
    expect(取("--error-ring")).toMatch(/^0 0 0 3px color-mix\(in srgb, var\(--danger\) 12%, transparent\)$/);
  });

  it("--field-line 替换 --line-strong，两者不并存（总控 11-21 定）；输入框不再铺灰底（--field-bg 删掉）", () => {
    const 散 = 所有源文件(根目录).flatMap((f) => {
      const 文 = 去注释(fs.readFileSync(f, "utf8"));
      return /--line-strong|--field-bg\b|lineStrong/.test(文) ? [path.relative(根目录, f)] : [];
    });
    expect(散, "这些文件还在用 --line-strong / --field-bg / palette.lineStrong").toEqual([]);
  });

  it("现状主题的输入框：白底 + --field-line，悬停 --field-line-hover，聚焦主色 + --focus-ring，报错 --danger + --error-ring", () => {
    const 段 = 全.slice(全.indexOf(".ant-input-outlined, .ant-input-number-outlined"), 全.indexOf(".ant-input-number-actions"));
    expect(段).toMatch(/background: var\(--panel\); border-color: var\(--field-line\);/);
    expect(段).toMatch(/:hover \{\s*background: var\(--panel\); border-color: var\(--field-line-hover\);/);
    expect(段).toMatch(/border-color: var\(--brand\); box-shadow: var\(--focus-ring\);/);
    expect(段).toMatch(/\[class\*="-status-error"\][^{]*\{\s*background: var\(--panel\); border-color: var\(--danger\);/);
    expect(段).toContain("box-shadow: var(--error-ring)");
  });

  it("自绘的搜索框（中栏名单 .pane-search、左栏 .rail-search）也是白底 + --field-line，聚焦主色 + 光晕", () => {
    expect(全).toMatch(/\.pane-search \{[^}]*background: var\(--panel\); border: 1px solid var\(--field-line\);/);
    expect(全).toMatch(/\.pane-search:hover \{ border-color: var\(--field-line-hover\);/);
    expect(全).toMatch(/\.pane-search:focus-within \{ border-color: var\(--brand\); box-shadow: var\(--focus-ring\); \}/);
    expect(全).toMatch(/\.rail-search \{[^}]*border: 1px solid var\(--field-line\);/);
  });

  it("复选框、单选框（含表格勾选、树勾选）的框换成 --ctl-line", () => {
    const m = /:is\(([^)]*\.ant-checkbox[^)]*)\)\s*\{\s*--ant-color-border: var\(--ctl-line\);/.exec(全);
    expect(m, "没找到把 --ant-color-border 换成 --ctl-line 的那条").toBeTruthy();
    for (const c of [".ant-checkbox-inner", ".ant-radio-inner", ".ant-tree-checkbox-inner"]) expect(m![1]).toContain(c);
  });

  it("空值「—」：.rec-field-empty 和 TSX 里写「—」的 span 一律 --empty-fg，不再用 faint", () => {
    expect(全).toMatch(/\.rec-field-empty \{ color: var\(--empty-fg\); \}/);
    expect(全).toMatch(/\.rec-page \.rec-field-empty \{ color: var\(--empty-fg\); \}/);
    const 浅空 = 所有源文件(根目录).filter((f) => f.endsWith(".tsx")).flatMap((f) =>
      fs.readFileSync(f, "utf8").split("\n").map((l, i) => [l, i] as const)
        .filter(([l]) => /\{(空值符|未选占位)\}/.test(l) && /var\(--text-(faint|muted)\)/.test(l))
        .map(([, i]) => `${path.relative(根目录, f)}:${i + 1}`));
    expect(浅空, "这些「—」还写死 faint / muted，改 var(--empty-fg)").toEqual([]);
  });

  it("标签权重（D10）：灰底那条 ≥ 0,5,0，压过 antd 预设色 .ant-tag.ant-tag-blue:not(.ant-tag-disabled).ant-tag-filled（0,4,0）；带色三条再高一档", () => {
    // 类 + :not() 括号里最重的一项（1 个类）各算一档；:is() 同理
    const 分 = (sel: string) => (sel.replace(/:(not|is)\(([^)]*)\)/g, " .x ").match(/\.[\w-]+/g) ?? []).length;
    const 规则 = [...全.matchAll(/^(\.ant-tag[^{]*)\{/gm)].map((m) => m[1].trim()).filter((s) => /:not\(\.ant-tag-solid/.test(s));
    const 灰 = 规则.find((s) => !/:is\(|tag-key|pool-tag/.test(s));
    expect(灰).toBeTruthy();
    expect(分(灰!)).toBeGreaterThanOrEqual(5);
    for (const s of 规则.filter((x) => x !== 灰)) expect(分(s), s).toBeGreaterThan(分(灰!));
    expect(全).toMatch(/background: var\(--tag-bg\); color: var\(--tag-fg\);/);
  });

  it("lib/theme.ts 抄的控件三档高、卡头高和 :root 一致；输入框聚焦光晕和 --focus-ring 同一个透明度", async () => {
    const { themeConfig } = await import("@/lib/theme");
    const t = themeConfig.token!;
    expect(`${t.controlHeightSM}px`).toBe(取("--ctl-h-sm"));
    expect(`${t.controlHeight}px`).toBe(取("--ctl-h"));
    expect(`${t.controlHeightLG}px`).toBe(取("--ctl-h-lg"));
    expect(`${themeConfig.components!.Card!.headerHeight}px`).toBe(取("--card-head-h"));
    const { palette, alpha } = await import("@/lib/palette");
    expect(themeConfig.components!.Input!.activeShadow).toBe(`0 0 0 3px ${alpha(palette.brand, 0.18)}`);
    expect(palette.fieldLine).toBe(取("--field-line"));
    expect(palette.ctlLine).toBe(取("--ctl-line"));
  });
});
