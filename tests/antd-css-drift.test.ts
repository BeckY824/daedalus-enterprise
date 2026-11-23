/**
 * 设计语言 E6 · D18：antd 主题（lib/theme.ts）和 globals.css :root 两套值漂移。
 *
 * 盘点（11-22）：theme.ts 注释原来写「和 --shadow-card / --shadow-pop 一字不差」，实际少一圈 0.5px 描边、卡片扩散也不同；
 * 菜单图标 antd 15，--ic 16（卡片外壳圆角 11-22 还差 14 / 10，D-1 起卡片圆角统一 10，已对上）。
 * 并成一套会改外观（E6 不改外观），先把现有的差写成名单：
 *   1. 名单外的 antd 值必须和 :root 对得上（新加的 token 不许再漂）
 *   2. 名单里的差没了（两边对上了），测试红，提醒划掉（只减不增）
 */
import { describe, it, expect } from "vitest";
import { globals } from "./css-read";
import { themeConfig } from "@/lib/theme";

const 根 = globals.slice(globals.indexOf(":root"), globals.indexOf("\n}", globals.indexOf(":root")));
const 取 = (名: string) => new RegExp(`${名}:\\s*([^;]+);`).exec(根)?.[1]?.trim();
const 去空 = (s: string) => s.replace(/\s+/g, " ").trim();

type 对照 = { antd: () => unknown; css: string; 转: (v: unknown) => string };
const px = (v: unknown) => `${v}px`;
const 原样 = (v: unknown) => 去空(String(v));
const t = themeConfig.token!;
const c = themeConfig.components!;

/** antd 值 ↔ :root 变量：每条都该对得上 */
const 对照表: Record<string, 对照> = {
  "token.boxShadow ↔ --shadow-card": { antd: () => t.boxShadow, css: "--shadow-card", 转: 原样 },
  "token.boxShadowSecondary ↔ --shadow-pop": { antd: () => t.boxShadowSecondary, css: "--shadow-pop", 转: 原样 },
  "token.borderRadius ↔ --r-ctl": { antd: () => t.borderRadius, css: "--r-ctl", 转: px },
  "token.borderRadiusLG ↔ --r-card": { antd: () => t.borderRadiusLG, css: "--r-card", 转: px },
  "Card.borderRadiusLG ↔ --r-card": { antd: () => c.Card?.borderRadiusLG, css: "--r-card", 转: px },
  "Modal.borderRadiusLG ↔ --r-pop": { antd: () => c.Modal?.borderRadiusLG, css: "--r-pop", 转: px },
  "Drawer.borderRadiusLG ↔ --r-pop": { antd: () => c.Drawer?.borderRadiusLG, css: "--r-pop", 转: px },
  "Popover.borderRadiusLG ↔ --r-pop": { antd: () => c.Popover?.borderRadiusLG, css: "--r-pop", 转: px },
  "Dropdown.borderRadiusLG ↔ --r-pop": { antd: () => c.Dropdown?.borderRadiusLG, css: "--r-pop", 转: px },
  "Menu.iconSize ↔ --ic": { antd: () => c.Menu?.iconSize, css: "--ic", 转: px },
  "Menu.collapsedIconSize ↔ --ic": { antd: () => c.Menu?.collapsedIconSize, css: "--ic", 转: px },
};

/** 现在还差着的（11-22 盘点，11-23 跟 main 划掉已对上的卡片圆角），后面写为什么没并 */
const 还许不同: Record<string, string> = {
  "token.boxShadow ↔ --shadow-card": "D-55 起 CSS 只剩一层淡影（0 1px 2px，浓淡跟 --card-raise-a）、边走 --card-line；antd 两层 1px 2px + 4px 16px。卡片投影以 CSS 为准，antd 这条只剩 antd 内部没接管的少数地方在用",
  "token.boxShadowSecondary ↔ --shadow-pop": "CSS 多 0.5px 描边，其余一样",
  "Menu.iconSize ↔ --ic": "侧栏菜单图标 15，全站图标 16；并了侧栏图标大 1px",
};

describe("antd 主题和 :root 的值不漂（只减不增）", () => {
  const 结果 = Object.entries(对照表).map(([k, x]) => {
    const css = 取(x.css);
    const antd = x.antd();
    return { k, css, antd: antd === undefined ? undefined : x.转(antd), 对上: antd !== undefined && css !== undefined && x.转(antd) === 去空(css) };
  });

  it("两边都读得到（防改名后全放行）", () => {
    expect(结果.filter((r) => r.css === undefined || r.antd === undefined).map((r) => r.k)).toEqual([]);
  });

  it("名单外的都对得上", () => {
    const 漂 = 结果.filter((r) => !r.对上 && !还许不同[r.k]).map((r) => `${r.k}：antd ${r.antd} / css ${r.css}`);
    expect(漂).toEqual([]);
  });

  it("名单只减：已经对上的从名单里划掉", () => {
    expect(结果.filter((r) => r.对上 && 还许不同[r.k]).map((r) => r.k)).toEqual([]);
    expect(Object.keys(还许不同).filter((k) => !对照表[k])).toEqual([]);
  });
});
