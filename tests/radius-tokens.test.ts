/**
 * 圆角只许五档：4 / 8（--r-ctl）/ 10（--r-card）/ 14（--r-pop）/ 999（--r-tag，胶囊），外加 0 和 50%（正圆）。
 * 16a（2026-11-11）：控件那档 6 → 8（32 高的控件配 8），仍是五档不加档；原来写死 6 的小元素（20px 的头像块、等级章）改 4，其余改 8。
 *
 * 2026-11-10 盘点：圆角写死了 1/2/3/5/8/9/12 多种，主题（luxe 直角、pixel 全 0）改 --r-* 管不到写死的；
 * 状态标签 <Tag> 有三十多处手写 borderRadius: 6，把 antd 主题和 globals.css 的 .ant-tag 规则都盖掉了，标签形状没法统一管。
 *
 * 四条：
 *   1. css 的 border-radius 只许 var(--r-*)、五档 px、0、50%；min()/calc() 里夹的字面量也要在档上。微型字形（9px 停止方块、图例色块）放行，名单在下面
 *   2. tsx/ts 写死的 borderRadius（含 echarts 的 [a, b, c, d]）和字符串里的 border-radius:Npx 也要在档上
 *   3. <Tag> 不许在 style 里写 borderRadius——标签形状只归 lib/theme.ts 的 components.Tag 和 .ant-tag 管
 *   4. antd 主题抄的圆角和 :root 一致
 * 主题（skins/*.css）可以改 --r-* 的值，那是 token 块，不受第 1 条管。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释, 根变量 } from "./skin-css";

const 五档 = new Set([0, 4, 8, 10, 14, 999]);

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

/** 放行写死圆角的选择器：都是不到 10px 的微型字形，五档里最小的 4px 套上去就成圆点了 */
const 字形放行: Record<string, string> = {
  ".cli-stop-mark": "9px 的「停止」方块图标，2px 圆角让它还是方块",
  ".cli-stop-sq": "10px 的「停止」方块图标，同上",
  ".chan-dash-legend i": "渠道看板图例的 8px 色块，要和图表里的方块一致",
};

type 声明 = { rel: string; 行: number; 选择器: string; 值: string };

function css圆角声明(): 声明[] {
  const out: 声明[] = [];
  for (const f of 所有源文件(源, /\.css$/)) {
    const rel = 相对(f);
    const s = 去注释(fs.readFileSync(f, "utf8"));
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const 体起 = m.index + m[1].length + 1;
      const 选择器 = m[1].trim().replace(/\s+/g, " ");
      const d = /(?:^|[;\s])(border(?:-[a-z]+)*-radius)\s*:\s*([^;]+)/g;
      let x: RegExpExecArray | null;
      while ((x = d.exec(m[2]))) {
        const 行 = s.slice(0, 体起 + x.index + x[0].indexOf(x[1])).split("\n").length;
        out.push({ rel, 行, 选择器, 值: x[2].trim().replace(/\s*!important$/, "") });
      }
    }
  }
  return out;
}

/** 一个圆角值里不在档上的部分；空数组 = 合规 */
function 档外(值: string, 有定义: Set<string>): string[] {
  const 错: string[] = [];
  for (const v of 值.matchAll(/var\((--[\w-]+)/g)) {
    if (!v[1].startsWith("--r-")) 错.push(`${v[1]} 不是圆角 token`);
    else if (!有定义.has(v[1])) 错.push(`${v[1]} 在 globals.css 里没定义`);
  }
  for (const n of 值.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)(px|%|rem|em)?/g)) {
    const [, 数, 单位] = n;
    if (单位 === "%" ? 数 !== "50" : !(单位 === "px" || Number(数) === 0) || !五档.has(Number(数))) 错.push(n[0]);
  }
  return 错;
}

describe("圆角只用五档 token", () => {
  const 根 = 根变量();
  const 有定义 = new Set([...去注释(fs.readFileSync(path.join(源, "app/globals.css"), "utf8")).matchAll(/(--r-[\w-]+)\s*:/g)].map((m) => m[1]));

  it("css 的 border-radius 只写 var(--r-*) / 4 / 8 / 10 / 14 / 999px / 0 / 50%", () => {
    const 错: string[] = [];
    for (const d of css圆角声明()) {
      if (字形放行[d.选择器]) continue;
      const x = 档外(d.值, 有定义);
      if (x.length) 错.push(`${d.rel}:${d.行} ${d.选择器} → ${d.值}（${x.join("、")}）`);
    }
    expect(错, `这些圆角不在档上，改成 var(--r-ctl|card|pop|tag) 或 4/8/10/14/999px：\n${错.join("\n")}`).toEqual([]);
  });

  it("字形放行名单没有过期的条目（选择器删了或改到档上了，名单也要删）", () => {
    const 有 = new Set(css圆角声明().filter((d) => 档外(d.值, 有定义).length).map((d) => d.选择器));
    expect(Object.keys(字形放行).filter((k) => !有.has(k))).toEqual([]);
  });

  it("tsx/ts 写死的圆角也在档上（含 echarts 的数组写法和字符串里的 border-radius）", () => {
    const 错: string[] = [];
    for (const f of 所有源文件(源, /\.tsx?$/)) {
      const rel = 相对(f);
      去注释(fs.readFileSync(f, "utf8")).split("\n").forEach((l, i) => {
        for (const m of l.matchAll(/\b[bB]orderRadius\w*\s*:\s*(\[[^\]]*\]|["'`][^"'`]*["'`]|-?\d+(?:\.\d+)?)/g)) {
          const 数 = [...m[1].matchAll(/-?\d+(?:\.\d+)?(%?)/g)].filter((n) => !(n[1] === "%" && n[0] === "50%")).map((n) => Number.parseFloat(n[0]));
          if (数.some((n) => !五档.has(n))) 错.push(`${rel}:${i + 1} ${m[0]}`);
        }
        for (const m of l.matchAll(/border-radius\s*:\s*([^;"'`]+)/g)) {
          if (档外(m[1], 有定义).length) 错.push(`${rel}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(错, `这些圆角不在 0/4/8/10/14/999 上：\n${错.join("\n")}`).toEqual([]);
  });

  it("<Tag> 的 style 里不许写 borderRadius（标签形状只归主题管）", () => {
    const 错: string[] = [];
    for (const f of 所有源文件(源, /\.tsx$/)) {
      const s = 去注释(fs.readFileSync(f, "utf8"));
      for (const m of s.matchAll(/<Tag\b/g)) {
        // 找开标签的结尾：跳过 {...} 里的 >（箭头函数、比较）
        let 深 = 0;
        let j = m.index! + 4;
        for (; j < s.length; j++) {
          const c = s[j];
          if (c === "{") 深++;
          else if (c === "}") 深--;
          else if (c === ">" && 深 === 0) break;
        }
        if (/borderRadius/.test(s.slice(m.index!, j))) 错.push(`${相对(f)}:${s.slice(0, m.index!).split("\n").length}`);
      }
    }
    expect(错, `这些 <Tag> 手写了圆角，删掉，让 lib/theme.ts 的 components.Tag 和 .ant-tag 管：\n${错.join("\n")}`).toEqual([]);
  });

  it("antd 主题抄的圆角和 :root 一致，标签是胶囊", async () => {
    const { themeConfig } = await import("@/lib/theme");
    const px = (k: string) => Number.parseFloat(根.get(k) ?? "NaN");
    const t = themeConfig.token!;
    expect({ borderRadius: t.borderRadius, borderRadiusLG: t.borderRadiusLG }).toEqual({ borderRadius: px("--r-ctl"), borderRadiusLG: px("--r-card") });
    expect(themeConfig.components?.Tag?.borderRadiusSM).toBe(px("--r-tag"));
    expect(px("--r-tag")).toBe(999);
  });
});
