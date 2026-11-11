/**
 * 字号只许用 globals.css :root 的六档：--fs-min 12 / --fs-note 13 / --fs-body 14 / --fs-section 15 / --fs-title 22 / --fs-num 26。
 *
 * 2026-11-10 盘点：颜色、动效有守卫（design-tokens / motion-tokens），字号没有，于是写死的字号散成 18 种——
 * 12.5px 二十多处（半像素字号在 Windows 上发虚）、比 12px 还小的正文十来处，违反 :root 自己写的「比这更小的字不存在」。
 *
 * 三条：
 *   1. css 里的 font-size 只许 var(--fs-*)，或从它推出来的 var(--dt-*)（详情页大一号）、图标的 var(--ic)、inherit、0（藏字）。图标、字形（箭头、圆点、评分条）放行，名单在下面，每条写了为什么
 *   2. tsx/ts 里写死的 fontSize 数字只许在六档上；比 12 小的只放行图标（*Outlined）和图表轴/图例（echarts 的 axisLabel、textStyle）
 *   3. 镜像不许漂：antd 主题（lib/theme.ts）抄的字号要和 :root 一字不差
 * 主题（skins/*.css）可以改 --fs-* 的值，那是 token 块，不受第 1 条管。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释, 根变量 } from "./skin-css";

const 六档 = new Set([12, 13, 14, 15, 22, 26]);

function 所有源文件(dir: string, 后缀: RegExp): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n !== "generated") out.push(...所有源文件(p, 后缀));
    } else if (后缀.test(n)) out.push(p);
  }
  return out;
}
const 相对 = (f: string) => path.relative(源, f).replaceAll("\\", "/");

/** 放行写死字号的选择器：都是图标或字形，不是要读的字 */
const 字形放行: Record<string, string> = {
  ".rail-user-caret": "侧栏底部账号名后面的下拉小箭头（DownOutlined）",
  ".rec-chip-caret": "记录筛选片上的下拉小箭头（DownOutlined）",
  ".cf-any-mark": "客户表单「四选一」的角标符号，aria-hidden，悬停看说明",
  ".proj-stage-mark": "项目阶段条里 8px 圆点里的图标",
  ".slc-k": "滑动确认的把手箭头",
  ".md-code": "行内代码跟着所在段落缩一点（0.92em），不是固定字号",
  ".rs-bars": "背调评分条 ●●●○○，字形当图形用",
};

type 声明 = { rel: string; 行: number; 选择器: string; 值: string };

function css字号声明(): 声明[] {
  const out: 声明[] = [];
  for (const f of 所有源文件(源, /\.css$/)) {
    const rel = 相对(f);
    const s = 去注释(fs.readFileSync(f, "utf8"));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const 体起 = m.index + m[1].length + 1;
      const 选择器 = m[1].trim().replace(/\s+/g, " ");
      const d = /(?:^|[;\s])font-size\s*:\s*([^;]+)/g;
      let x: RegExpExecArray | null;
      while ((x = d.exec(m[2]))) {
        const 行 = s.slice(0, 体起 + x.index + x[0].indexOf("font-size")).split("\n").length;
        out.push({ rel, 行, 选择器, 值: x[1].trim().replace(/\s*!important$/, "") });
      }
    }
  }
  return out;
}

describe("字号只用六档 token", () => {
  const 根 = 根变量();
  /** globals.css 里定义过的字号 token：:root 的 --fs-* / --ic，和详情页从 --fs-* 推出来的 --dt-*（.rec-page 那块） */
  const 有定义 = new Set([...去注释(fs.readFileSync(path.join(源, "app/globals.css"), "utf8")).matchAll(/(--(?:fs|dt)-[\w-]+|--ic)\s*:/g)].map((m) => m[1]));

  it("css 的 font-size 只写 var(--fs-*)，写死的只放行图标/字形", () => {
    const 错: string[] = [];
    for (const d of css字号声明()) {
      if (d.值 === "inherit" || d.值 === "0") continue;
      const v = /^var\((--(?:fs|dt)-[\w-]+|--ic)(?:,\s*([^)]+))?\)$/.exec(d.值);
      if (v) {
        if (!有定义.has(v[1])) 错.push(`${d.rel}:${d.行} ${d.选择器} → ${d.值}（globals.css 里没定义这个 token）`);
        const 备 = v[2] && /^(\d+(?:\.\d+)?)px$/.exec(v[2].trim());
        if (v[2] && !(备 && 六档.has(Number(备[1])))) 错.push(`${d.rel}:${d.行} ${d.选择器} → ${d.值}（兜底值也要在六档上，或者干脆不写）`);
        continue;
      }
      if (字形放行[d.选择器]) continue;
      错.push(`${d.rel}:${d.行} ${d.选择器} → font-size: ${d.值}`);
    }
    expect(错, `这些字号写死了，改成 var(--fs-min|note|body|section|title|num)：\n${错.join("\n")}`).toEqual([]);
  });

  it("font 简写里也不许夹写死的字号", () => {
    const 错: string[] = [];
    for (const f of 所有源文件(源, /\.css$/)) {
      去注释(fs.readFileSync(f, "utf8")).split("\n").forEach((l, i) => {
        if (/(?:^|[;{\s])font\s*:[^;]*\d(?:px|rem|em)\b/.test(l)) 错.push(`${相对(f)}:${i + 1}`);
      });
    }
    expect(错).toEqual([]);
  });

  it("字形放行名单没有过期的条目（选择器删了，名单也要删）", () => {
    const 有 = new Set(css字号声明().filter((d) => !d.值.startsWith("var(")).map((d) => d.选择器));
    expect(Object.keys(字形放行).filter((k) => !有.has(k))).toEqual([]);
  });

  it("tsx/ts 写死的 fontSize 只许在六档上；小于 12 只放行图标和图表轴", () => {
    const 错: string[] = [];
    for (const f of 所有源文件(源, /\.tsx?$/)) {
      const rel = 相对(f);
      去注释(fs.readFileSync(f, "utf8")).split("\n").forEach((l, i) => {
        for (const m of l.matchAll(/\bfontSize\s*:\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?/g)) {
          const n = Number(m[1]);
          if (六档.has(n)) continue;
          if (n >= 9 && n < 12 && /Outlined\b|axisLabel|textStyle/.test(l)) continue;
          错.push(`${rel}:${i + 1} fontSize: ${m[1]}`);
        }
      });
    }
    expect(错, `这些字号不在 12/13/14/15/22/26 上：\n${错.join("\n")}`).toEqual([]);
  });

  it("antd 主题抄的字号和 :root 一致", async () => {
    const { themeConfig } = await import("@/lib/theme");
    const px = (k: string) => Number.parseFloat(根.get(k) ?? "NaN");
    const t = themeConfig.token!;
    expect({ fontSize: t.fontSize, fontSizeSM: t.fontSizeSM, fontSizeHeading4: t.fontSizeHeading4, fontSizeHeading5: t.fontSizeHeading5 }).toEqual({
      fontSize: px("--fs-body"),
      fontSizeSM: px("--fs-min"),
      fontSizeHeading4: px("--fs-title"),
      fontSizeHeading5: px("--fs-section"),
    });
    expect(themeConfig.components?.Statistic?.contentFontSize).toBe(px("--fs-num"));
    expect(themeConfig.components?.Tag?.fontSizeSM).toBe(px("--fs-min"));
  });
});
