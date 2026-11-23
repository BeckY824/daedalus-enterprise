/**
 * 暗黑下 antd 那一层（src/app/antd-dark.css）的「必须一致的清单」：挂的类名 ↔ lib/theme.ts 的 ANTD_CSS_VAR_KEY、
 * 覆盖的 --ant-* ↔ antd 真有的变量、layout.tsx 的引入顺序。**哪一处漏了都不报错**——拼错的那一项暗黑下悄悄还是浅色。
 * 另附现状明亮下的对比度（:root 的值）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ANTD_CSS_VAR_KEY } from "@/lib/theme";
import { 源, 拆块, 变量, 根变量, 去注释 } from "./css-read";

const layout = fs.readFileSync(path.join(源, "app/layout.tsx"), "utf8");

describe("暗黑下 antd 接到我们的 token 上（antd-dark.css）", () => {
  const shared = 去注释(fs.readFileSync(path.join(源, "app/antd-dark.css"), "utf8"));

  it("挂的类名和 lib/theme.ts 钉死的 cssVar key 是同一个", () => {
    const 用到 = new Set([...shared.matchAll(/\.(css-var-[\w-]+)/g)].map((m) => m[1]));
    expect([...用到]).toEqual([ANTD_CSS_VAR_KEY]);
  });

  it("每条都只在暗黑时生效，浅色下 antd 原样（lib/theme.ts）", () => {
    for (const b of 拆块(shared))
      for (const sel of b.选择器.split(/,(?![^()]*\))/).map((x) => x.trim()))
        expect(sel, "antd-dark.css 的选择器要以 :root[data-mode=\"dark\"] .css-var-dd 开头").toMatch(/^:root\[data-mode="dark"\] \.css-var-dd/);
  });

  it("layout.tsx 引入 antd-dark.css，排在 globals.css 之后、dark.css 之前", () => {
    const i = (x: string) => layout.indexOf(`import "./${x}";`);
    expect(i("globals.css")).toBeGreaterThanOrEqual(0);
    expect(i("antd-dark.css")).toBeGreaterThan(i("globals.css"));
    expect(i("dark.css")).toBeGreaterThan(i("antd-dark.css"));
  });

  it("覆盖的 --ant-* 名字 antd 真有（拼错一个，那一项就还是蓝的）", async () => {
    const { theme } = await import("antd");
    const 全局 = new Set(Object.keys(theme.getDesignToken()).map((k) => "--ant-" + k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase()));
    // 组件变量的名字前缀是组件名（--ant-table-…、--ant-button-…），不一定和类名一样（按钮的类名是 .ant-btn）
    const 驼峰 = (x: string) => x.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    const 源码 = (dir: string) => {
      if (!dir) return "";
      const d = path.resolve(__dirname, "../node_modules/antd/es", dir, "style");
      return fs.existsSync(d) ? fs.readdirSync(d).map((n) => fs.readFileSync(path.join(d, n), "utf8")).join("\n") : "";
    };
    const 错: string[] = [];
    for (const b of 拆块(shared)) {
      const 组件块 = /\.css-var-dd:is\(/.test(b.选择器);
      for (const k of 变量(b.体).keys()) {
        if (全局.has(k)) continue;  // 全局名在组件块里重设也行（只在那一层生效，比如弹窗的圆角）
        const m = /^--ant-([a-z]+)-(.+)$/.exec(k);
        // 分页里那几个输入框的变量是借 Input 的 token 算的
        const 借用: Record<string, string> = { pagination: "input" };
        if (!组件块 || !m || !(源码(m[1]) + 源码(借用[m[1]] ?? "")).includes(驼峰(m[2]))) 错.push(k);
      }
    }
    expect(错, `antd 没有这些变量：${错.join("、")}`).toEqual([]);
  });

  /*
    J-216：深色下顶部提示条（message）原来是白底浅字——antd 把它的底色算成组件变量写死 #fff，
    全局的 --ant-color-bg-elevated 管不到。上面那条只能证明变量名拼对了，**这条规则被整条删掉不会红**，所以单独钉
  */
  it("顶部提示条（message）的底色跟着暗黑走：--ant-message-content-bg 指向面板色", () => {
    const 块 = 拆块(shared).find((b) => /\.ant-message\b/.test(b.选择器));
    expect(块, "antd-dark.css 里没有给 .ant-message 的那一块了——深色主题的保存/撤销提示会变回白底浅字").toBeTruthy();
    const v = 变量(块!.体).get("--ant-message-content-bg");
    expect(v, "那一块里没有覆盖 --ant-message-content-bg").toBeTruthy();
    expect(v).toMatch(/var\(--(panel|card|surface|bg)[\w-]*\)/);
  });
});

/* ---------- 对比度：字还得读得清 ---------- */
function 亮度(hex: string) {
  const h = hex.replace("#", "");
  const 全 = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(全.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const 对比 = (a: string, b: string) => {
  const [x, y] = [亮度(a), 亮度(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** :root 的值，var() 一路解到 hex */
function 取(n: string, 深 = 0): string | undefined {
  const v = 根变量().get(n);
  if (!v || 深 > 8) return undefined;
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? 取(m[1], 深 + 1) : /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined;
}

it("对比度（WCAG）：现状明亮下正文 7、说明 / 状态字 / 按钮字 4.5", () => {
  const 对: [string, string, number][] = [
    ["--ink", "--panel", 7],
    ["--ink", "--page-bg", 7],
    ["--ink-soft", "--panel", 4.5],
    ["--text-muted", "--panel", 4.5],
    ["--text-muted", "--page-bg", 4.5],
    ["--on-ink", "--brand", 4.5],
    ["--brand-deep", "--brand-bg", 4.5],
    ["--success-text", "--success-bg", 4.5],
    ["--warning-text", "--warning-bg", 4.5],
    ["--danger-text", "--danger-bg", 4.5],
    ["--nav-on-fg", "--nav-on-bg", 4.5],
  ];
  const 差: string[] = [];
  for (const [字, 底, 下限] of 对) {
    const a = 取(字), b = 取(底);
    if (!a || !b) { 差.push(`${字} / ${底} 解不出颜色`); continue; }
    const r = 对比(a, b);
    // 0.01 的余量：主按钮白字压主色是 4.497，四舍五入就是 4.5
    if (r + 0.01 < 下限) 差.push(`${字} ${a} 在 ${底} ${b} 上只有 ${r.toFixed(2)}，要 ≥${下限}`);
  }
  expect(差).toEqual([]);
});
