/**
 * 动效的底座（globals.css 的三条曲线四档时长）和那条硬规矩：
 * **开了「减弱动态效果」之后，界面不许再有位移。**
 *
 * 为什么用读文件的方式测：动效本身没什么可断言的（0.26 秒好看还是 0.3 秒好看，测不出来），
 * 但"全站只有这三条曲线""按下那档最短""减弱动态时不位移"这三件是规矩，规矩测得出来。
 * 规矩一旦破了不会有人发现——界面照样能用，只是慢慢变回一盘散沙。
 *
 * 2026-11 动效底座（P-界面-38）：全站按 Apple 默认「不回弹」弹簧。JS 用弹簧参数（lib/motion 的 弹簧），
 * CSS 用 linear() 采样同一条弹簧；新增「不回弹」「减弱动态只留透明度」两组规矩。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 拆块, 变量, 主题文件 } from "./skin-css";

const css = fs.readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
const 根 = css.slice(css.indexOf(":root"), css.indexOf("\n}"));

/** 一条 CSS 曲线会不会冲过终点（或先往回退）：cubic-bezier 看两个控制点的 y，linear() 看每一站的输出 */
function 过冲(值: string): boolean {
  const b = /^cubic-bezier\(([^)]*)\)$/.exec(值.trim());
  if (b) {
    const [, y1, , y2] = b[1].split(",").map(Number);
    return !(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1);
  }
  const l = /^linear\(([^()]*)\)$/.exec(值.trim());
  if (l) return l[1].split(",").some((站) => { const y = Number(站.trim().split(/\s+/)[0]); return !(y >= 0 && y <= 1); });
  return false;
}

describe("动效底座", () => {
  it("循环周期（--breath）在 :root 里，阶段条当前节点的呼吸用它，不写死秒数", () => {
    expect(/--breath:\s*[\d.]+s;/.test(根)).toBe(true);
    expect(css).toMatch(/animation: proj-stage-breath var\(--breath\) var\(--ease-morph\) infinite/);
    expect(css).not.toMatch(/proj-stage-breath\s+[\d.]+m?s/);
  });

  it("三条曲线、四档时长都在 :root 里", () => {
    for (const t of ["--ease:", "--ease-spring:", "--ease-morph:"]) {
      expect(根, `${t} 应该定义在 :root`).toContain(t);
    }
    // 四档 + 两档专用（浮层 100、悬停离开 150）+ 落印，一档不多：2026-09-28 之前实际有六档（160/180/200 挤在 40ms 里），注释却写四档
    const 档 = [...根.matchAll(/(--t(?:-[\w-]+)?):\s*\d+ms/g)].map((m) => m[1]).sort();
    expect(档).toEqual(["--t", "--t-fast", "--t-leave", "--t-morph", "--t-pop", "--t-press", "--t-seal"]);
  });

  it("并掉的档位没人再用", () => {
    // 删了定义、没删用处的话，var(--t-enter) 会悄悄变成 0 秒——不报错，只是那一下没了动效
    expect(css).not.toMatch(/var\(--t-(?:slow|enter)\)/);
  });

  it("按下那一档最短：90ms，比悬停还快", () => {
    const 取 = (name: string) => Number(/(\d+)ms/.exec(根.slice(根.indexOf(name)))?.[1]);
    expect(取("--t-press:")).toBe(90);
    expect(取("--t-press:")).toBeLessThan(取("--t-fast:"));
  });

  it("浮层 100ms 从 .97 出来、悬停离开 150ms（P-界面-38）", () => {
    const 取 = (name: string) => /:\s*([\d.]+)(ms)?;/.exec(根.slice(根.indexOf(name)))?.[1];
    expect(取("--t-pop:")).toBe("100");
    expect(取("--t-leave:")).toBe("150");
    expect(Number(取("--pop-scale:"))).toBe(0.97);
  });

  it("曲线只在 :root 里写死，别处一律用 token", () => {
    /**
     * 散在各处的 bezier 是"每次各拍一个"的开始。JS 那边（motion 不认 CSS 变量）
     * 只能写数值，但样式表这边没有这个借口。
     */
    // 注释里提到别人的曲线不算数（比如那句"antd 自带的是 .08,.82,.17,1"）
    // 唯一例外：紧跟 :root 的那段 @supports，给不认 linear() 的老浏览器退回 cubic-bezier
    const 去注释 = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const 退路 = /@supports not \(transition-timing-function: linear\(0, 1\)\) \{[^{}]*\{[^{}]*\}\s*\}/.exec(去注释);
    expect(退路, "globals.css 里应该有给老浏览器的 @supports 退路").not.toBeNull();
    const 正文 = 去注释.slice(去注释.indexOf("\n}", 去注释.indexOf(":root"))).replace(退路![0], "");
    const 散的 = [...正文.matchAll(/cubic-bezier\([^)]*\)|\blinear\([^)]*\)/g)].map((m) => m[0]);
    expect(散的, `样式表里还有写死的曲线：${散的.join(" / ")}`).toEqual([]);
  });

  it("老浏览器的退路只换 --ease / --ease-spring，退到不过冲的 cubic-bezier", () => {
    const 去注释 = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const 体 = /@supports not \(transition-timing-function: linear\(0, 1\)\) \{[^{}]*\{([^{}]*)\}/.exec(去注释)![1];
    const 名 = [...体.matchAll(/(--[\w-]+):\s*cubic-bezier\(([^)]*)\)/g)].map((m) => {
      const [, y1, , y2] = m[2].split(",").map(Number);
      expect(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `${m[1]} 过冲了`).toBe(true);
      return m[1];
    });
    expect(名.sort()).toEqual(["--ease", "--ease-spring"]);
  });

  it("上限 320ms：超过就是在让人等（CSS 的时长档、JS 的弹簧都算）", async () => {
    // --t-seal 单独一条规矩，见下一条
    const 毫秒 = [...css.matchAll(/--t(?!-seal)[\w-]*:\s*(\d+)ms/g)].map((m) => Number(m[1]));
    expect(毫秒.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...毫秒)).toBeLessThanOrEqual(320);
    /**
     * 弹簧没有「时长」，只有到位的过程：看得见的那段（走到 95%）不许超过 320，
     * 尾巴那千分之几的收拢不算（motion 的 visualDuration 也是这么算的）。三档实测约 138 / 188 / 229ms
     */
    const { 弹簧, 弹簧轨迹 } = await import("@/lib/motion");
    for (const [k, p] of Object.entries(弹簧)) {
      const { 位置 } = 弹簧轨迹(p);
      const 到95 = 位置.findIndex((x) => x >= 0.95); // 一步 1ms
      expect(到95, `弹簧.${k}`).toBeGreaterThan(0);
      expect(到95, `弹簧.${k} 走到 95% 用了 ${到95}ms`).toBeLessThanOrEqual(320);
    }
  });

  it("只有落印能放到 480ms，而且只许落印用它", () => {
    /**
     * 2026-09-28 拍板的唯一例外：建议卡确认时落的那个印。它是回执不是等待（数据已经写了、还能撤），
     * 一天十几次，盖章要三段才看得出。其余照旧 ≤320——所以要钉住「只有它」，
     * 不然 480 很快会被拿去给别的东西用。
     */
    const 值 = [...css.matchAll(/--t-seal:\s*(\d+)ms/g)].map((m) => Number(m[1]));
    expect(值.length).toBeGreaterThan(0);
    expect(Math.max(...值)).toBeLessThanOrEqual(480);
    const 用处 = [...css.matchAll(/([^{}]*)\{[^{}]*var\(--t-seal\)/g)].map((m) => m[1].trim());
    expect(用处.length).toBeGreaterThan(0);
    const 别处 = 用处.filter((sel) => !/seal/.test(sel));
    expect(别处, `这些选择器不是落印，不许用 --t-seal：${别处.join(" / ")}`).toEqual([]);
  });

  it("lib/motion.ts 和 :root 逐值一致，一个不多一个不少", async () => {
    /**
     * motion 认不了 CSS 变量，JS 那边只能抄一份数。抄的那份一漂，同一屏上 CSS 动的和 JS 动的
     * 就不是一套手感（2026-09-28 之前就是这样：Rise 0.42s、左栏底块第四条曲线）。照 palette.ts 那条钉住。
     * 弹簧那条 linear() 不是手抄的：JS 现算一遍采样，和 :root 里的字面值逐字对——改了弹簧参数忘了重贴，这里红。
     */
    const { 曲线CSS, 时长, 间隔, 浮层缩放, 弹簧, 弹簧采样, 弹簧CSS } = await import("@/lib/motion");
    const 名 = (前缀: string, k: string, 本名: string) => (k === 本名 ? 前缀 : `${前缀}-${k}`);
    // 去空白、数字按值比（CSS 里写 .33，JS 拼出来是 0.33）
    const 去空白 = (x: string) => x.replace(/\s+/g, "").replace(/-?[\d.]+/g, (n) => String(Number(n)));

    const css时长 = Object.fromEntries([...根.matchAll(/(--t(?:-[\w-]+)?):\s*(\d+)ms/g)].map((m) => [m[1], Number(m[2]) / 1000]));
    const js时长 = Object.fromEntries(Object.entries(时长).map(([k, v]) => [名("--t", k, "base"), v]));
    expect(js时长, "时长对不上 :root").toEqual(css时长);

    expect(弹簧CSS).toBe(`linear(${弹簧采样(弹簧.ui).join(", ")})`);
    const css曲线 = Object.fromEntries([...根.matchAll(/(--ease(?:-[\w-]+)?):\s*([^;]+);/g)].map((m) => [m[1], 去空白(m[2])]));
    const js曲线 = Object.fromEntries(Object.entries(曲线CSS).map(([k, v]) => [名("--ease", k, "ease"), 去空白(v)]));
    expect(js曲线, "曲线对不上 :root").toEqual(css曲线);

    const stagger = /--stagger:\s*(\d+)ms/.exec(根);
    expect(stagger, "--stagger 应该定义在 :root").not.toBeNull();
    expect(间隔).toBe(Number(stagger![1]) / 1000);

    const 缩放 = /--pop-scale:\s*([\d.]+);/.exec(根);
    expect(缩放, "--pop-scale 应该定义在 :root").not.toBeNull();
    expect(浮层缩放).toBe(Number(缩放![1]));
  });

  it("JS 里的时长、间隔、曲线只许写在 lib/motion.ts", () => {
    /**
     * 镜像对上了还不够：别处照样可以绕开它直接写 0.42。这条扫 src 下所有 .ts/.tsx，
     * 抓的是 motion 那几个键的值里写死的数（`duration: 0.26`、`少动 ? 0 : 0.42`、`delay: i * 0.04`、
     * `staggerChildren: 0.1`）和写死的曲线（`ease: [..]`、`ease: "easeOut"`、cubic-bezier）。
     * 只认小数：`duration: 6` 是 antd 提示停几秒、`duration: 300 + …` 是演示数据里的通话时长，都不是动效。
     */
    const 根目录 = path.resolve(__dirname, "../src");
    const 去注释 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, "")).replace(/^\s*\/\/.*$/gm, "");
    const 规矩: [RegExp, string][] = [
      // 值里任何位置出现小数都算：`少动 ? 0 : 0.18`、`时长(0.28)` 也是写死
      [/\b(?:duration|staggerChildren|delayChildren|repeatDelay)\s*:[^,}\n]*\d*\.\d/, "裸时长"],
      // delay 常写成 `Math.min(i, 8) * 0.04`，括号里有逗号，所以放宽到整个花括号
      [/\bdelay\s*:[^}\n]*\d*\.\d/, "裸间隔"],
      [/\bease\s*:\s*(?:\[|["'`])/, "裸曲线"],
      [/cubic-bezier\(/, "裸曲线"],
    ];
    const 文件 = (dir: string): string[] =>
      fs.readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) return n === "generated" ? [] : 文件(p);
        return /\.tsx?$/.test(n) ? [p] : [];
      });
    const 散的: string[] = [];
    for (const f of 文件(根目录)) {
      const rel = path.relative(根目录, f).replaceAll("\\", "/");
      if (rel === "lib/motion.ts") continue;
      去注释(fs.readFileSync(f, "utf8"))
        .split("\n")
        .forEach((l, i) => {
          for (const [re, 叫] of 规矩) if (re.test(l)) 散的.push(`${rel}:${i + 1} ${叫}：${l.trim().slice(0, 120)}`);
        });
    }
    expect(散的, `这些地方还写着裸的动效数值，改成 lib/motion.ts 的 时长 / 曲线 / 间隔：\n${散的.join("\n")}`).toEqual([]);
  });

  it("开了「减弱动态」之后不许再有位移", () => {
    const i = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(i).toBeGreaterThan(-1);
    const 块 = css.slice(i);
    // 时长归零挡不住位移本身：按下去照样缩，只是缩得飞快，而那正是开这个开关的人不想要的
    expect(块).toContain("transform: none !important");
    expect(块).toContain("scale: none !important");
  });
});

/* ---------- 主题（src/app/skins/*.css）换的曲线和时长：同一套规矩，一套一套查 ---------- */
describe("主题的动效", () => {
  const 档 = new Set([90, 120, 180, 320]);
  const 主题们 = 主题文件();

  it("时长只落在 90 / 120 / 180 / 320 四档，按下 90 且比悬停快，落印 ≤480", () => {
    const 错: string[] = [];
    for (const { key, 文 } of 主题们)
      for (const b of 拆块(文).filter((b) => b.token块)) {
        const v = 变量(b.体);
        for (const [k, 值] of v) {
          if (!/^--t(-|$)/.test(k)) continue;
          const ms = /^(\d+)ms$/.exec(值)?.[1];
          if (!ms) { 错.push(`${key} ${k}: ${值} 不是毫秒`); continue; }
          if (k === "--t-seal") { if (Number(ms) > 480) 错.push(`${key} --t-seal ${ms} > 480`); continue; }
          if (!档.has(Number(ms))) 错.push(`${key} ${k}: ${ms}ms 不在四档里`);
        }
        const 按下 = v.get("--t-press"), 悬停 = v.get("--t-fast");
        if (按下 && 按下 !== "90ms") 错.push(`${key} --t-press 必须是 90ms`);
        if (按下 && 悬停 && parseInt(按下) >= parseInt(悬停)) 错.push(`${key} 按下不比悬停快`);
      }
    expect(错).toEqual([]);
  });

  it("曲线只许 cubic-bezier()、linear() 或 steps()，而且只写在 token 块里", () => {
    const 错: string[] = [];
    for (const { key, 文 } of 主题们)
      for (const b of 拆块(文)) {
        if (!b.token块) {
          if (/cubic-bezier\(|steps\(|\blinear\(/.test(b.体)) 错.push(`${key} 形状规则里写了曲线：${b.选择器}`);
          continue;
        }
        for (const [k, 值] of 变量(b.体))
          if (/^--ease/.test(k) && !/^(cubic-bezier\([^)]*\)|linear\([^()]*\)|steps\(\s*\d+\s*(,\s*[\w-]+\s*)?\))$/.test(值)) 错.push(`${key} ${k}: ${值}`);
      }
    expect(错).toEqual([]);
  });

  it("主题的曲线也不回弹（像素的阶跃照留）", () => {
    const 错: string[] = [];
    for (const { key, 文 } of 主题们)
      for (const b of 拆块(文).filter((b) => b.token块))
        for (const [k, 值] of 变量(b.体)) if (/^--ease/.test(k) && 过冲(值)) 错.push(`${key} ${k}: ${值}`);
    expect(错).toEqual([]);
  });

  it("主题的曲线 JS 也读得懂（lib/motion 从 CSS 变量读，读不懂会悄悄回到现状）", async () => {
    const { 读曲线 } = await import("@/lib/motion");
    const 兜底 = [9, 9, 9, 9] as const;
    for (const { key, 文 } of 主题们)
      for (const b of 拆块(文).filter((b) => b.token块))
        for (const [k, 值] of 变量(b.体)) if (/^--ease/.test(k)) expect(读曲线(值, 兜底), `${key} ${k}`).not.toBe(兜底);
  });

  it("主题绕不过减弱动态：形状规则里的位移、动画、过渡不许带 !important", () => {
    const 错: string[] = [];
    for (const { key, 文 } of 主题们)
      for (const b of 拆块(文).filter((b) => !b.token块))
        for (const d of b.体.split(";"))
          if (/!important/.test(d) && /^\s*(transform|translate|scale|rotate|animation|transition)/.test(d)) 错.push(`${key}: ${d.trim()}`);
    expect(错).toEqual([]);
  });

  it("像素那种「沉下去」的按下用 translate：减弱动态时也要撤", () => {
    const i = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(css.slice(i)).toContain("translate: none !important");
  });

  it("落印那档（--t-seal）主题里也只许落印用", () => {
    for (const { key, 文 } of 主题们)
      for (const b of 拆块(文).filter((b) => !b.token块))
        if (b.体.includes("var(--t-seal)")) expect(b.选择器, `${key}`).toMatch(/seal/);
  });
});

describe("过渡和动画都走曲线 token（主题换曲线时才跟得上）", () => {
  /**
   * 2026-09-28：globals.css 里有一批写的是 CSS 关键字 ease / ease-out，或者干脆没写曲线（默认就是 ease）。
   * 主题换了 --ease 之后它们纹丝不动：像素主题里一半一格一格跳、一半照旧滑。现在一律 var(--ease*)。
   * 例外两类，逐条列在这里：
   *   环境动画  无限循环的呼吸、扫光、光标闪（infinite）。它们不是「一个东西变成另一个」，是背景里的节拍
   *   进度      跟着真实进度走的宽度，匀速（linear）才不骗人
   */
  // 撤销条的倒计时环（components/UndoBar.tsx）：环剩多少 = 还剩几秒，匀速才不骗人
  const 进度例外 = ["width var(--t) linear", "undo-ring var(--undo-ms, 5s) linear forwards"];
  it("一次性的 transition / animation 必须写 var(--ease*)", () => {
    const 正文 = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const 散的: string[] = [];
    for (const m of 正文.matchAll(/(?:^|[;{\s])(transition|animation)\s*:\s*([^;{}]+)/g)) {
      const 值 = m[2].trim();
      if (/^none\b/.test(值) || /infinite/.test(值) || 进度例外.includes(值)) continue;
      for (const 段 of 值.split(/,(?![^()]*\))/)) if (!/var\(--ease/.test(段)) 散的.push(`${m[1]}: ${段.trim()}`);
    }
    expect(散的, `这些过渡没走曲线 token：\n${散的.join("\n")}`).toEqual([]);
  });
});

/* 11-12 阶段条改成分段滑块：浮片用 left / width 滑（不用 transform），曲线走 token；减弱动态时只留透明度过渡 */
describe("阶段条浮片", () => {
  const 体 = (sel: string, 从 = 0) => { const i = css.indexOf(`${sel} {`, 从); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
  it("滑动走 --ease-spring、时长用 token，不用 transform", () => {
    const 片 = 体(".proj-stage-thumb");
    expect(片).toContain("left var(--t-morph) var(--ease-spring)");
    expect(片).not.toMatch(/transform|translate|cubic-bezier|\d+ms/);
  });
  it("减弱动态时浮片不滑，只淡入淡出", () => {
    const i = css.indexOf(".proj-stage-thumb { transition: opacity");
    expect(i).toBeGreaterThan(-1);
    expect(css.lastIndexOf("@media (prefers-reduced-motion: reduce)", i)).toBeGreaterThan(css.indexOf(".proj-stage-thumb {"));
  });
});

/* ---------- P-界面-38：全站不回弹 ---------- */
describe("不回弹", () => {
  it("弹簧三档都是临界阻尼附近，真跑一遍也不越过终点", async () => {
    const { 弹簧 } = await import("@/lib/motion");
    for (const [k, p] of Object.entries(弹簧)) {
      const ζ = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
      expect(ζ, `弹簧.${k} 阻尼比`).toBeGreaterThanOrEqual(0.99);
      // 不提前停，整整跑 2 秒看最高点（ζ 略小于 1 时理论过冲 < 1e-12）
      let x = 0, v = 0, 最高 = 0;
      for (let i = 0; i < 2000; i++) { const a = (-p.stiffness * (x - 1) - p.damping * v) / p.mass; v += a / 1000; x += v / 1000; 最高 = Math.max(最高, x); }
      expect(最高, `弹簧.${k} 最高点`).toBeLessThanOrEqual(1.0005);
    }
  });

  it(":root 的三条曲线都不过冲（原来 --ease-spring 冲到 1.34）", () => {
    for (const m of 根.matchAll(/(--ease(?:-[\w-]+)?):\s*([^;]+);/g)) expect(过冲(m[2]), `${m[1]}: ${m[2]}`).toBe(false);
  });

  it("linear() 读得懂：默认那条读回来就是 JS 的弹簧曲线，带百分比的也照规范读", async () => {
    const { 读曲线, 曲线, 弹簧CSS } = await import("@/lib/motion");
    const 兜底 = [9, 9, 9, 9] as const;
    expect(读曲线(弹簧CSS, 兜底)).toBe(曲线.ease);
    const f = 读曲线("linear(0, 0.5 25%, 1)", 兜底) as (t: number) => number;
    expect(typeof f).toBe("function");
    expect(f(0.25)).toBeCloseTo(0.5);
    expect(f(0.625)).toBeCloseTo(0.75);
    // 中间缺输入的均分；两个百分比 = 一段平台
    const g = 读曲线("linear(0, 0.2, 0.4 50% 75%, 1)", 兜底) as (t: number) => number;
    expect(g(0.25)).toBeCloseTo(0.2);
    expect(g(0.6)).toBeCloseTo(0.4);
    expect(g(1)).toBe(1);
    expect(读曲线("linear(0.5)", 兜底)).toBe(兜底);
    expect(读曲线("linear(0, oops, 1)", 兜底)).toBe(兜底);
  });

  it("MotionConfig 的默认过渡：默认主题走 ui 弹簧，主题换了曲线就走它的曲线和 --t", async () => {
    const { 从样式读动效, 默认过渡, 弹簧, 弹簧CSS } = await import("@/lib/motion");
    const 现状 = 从样式读动效((n) => (n === "--ease" ? ` ${弹簧CSS} ` : ""));
    expect(现状.是弹簧).toBe(true);
    expect(默认过渡(现状)).toBe(弹簧.ui);
    const 像素 = 从样式读动效((n) => ({ "--ease": "steps(3, end)", "--t": "120ms" })[n] ?? "");
    expect(像素.是弹簧).toBe(false);
    const t = 默认过渡(像素) as { duration: number; ease: (t: number) => number };
    expect(t.duration).toBe(0.12);
    expect(t.ease(0.5)).toBeCloseTo(1 / 3);
  });
});

/* ---------- P-界面-38：减弱动态只留透明度（CSS 这一半；JS 那一半见 motion-reduced.ui.test.ts） ---------- */
describe("减弱动态只留透明度（CSS）", () => {
  /** globals.css 和各主题里所有 @media (prefers-reduced-motion: reduce) { … } 的内层 */
  const 减弱块们 = [css, ...主题文件().map((x) => x.文)].flatMap((文) => {
    const s = 文.replace(/\/\*[\s\S]*?\*\//g, "");
    const out: string[] = [];
    for (const m of s.matchAll(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g)) {
      let d = 1, j = m.index! + m[0].length;
      for (; j < s.length && d > 0; j++) d += s[j] === "{" ? 1 : s[j] === "}" ? -1 : 0;
      out.push(s.slice(m.index! + m[0].length, j - 1));
    }
    return out;
  });

  const 全部 = [css, ...主题文件().map((x) => x.文)].join("\n");
  function 只动透明度(名: string): boolean {
    const i = 全部.indexOf(`@keyframes ${名} {`);
    if (i < 0) return false;
    let d = 0, j = 全部.indexOf("{", i);
    const 起 = j;
    for (; j < 全部.length; j++) { d += 全部[j] === "{" ? 1 : 全部[j] === "}" ? -1 : 0; if (d === 0) break; }
    const 属性 = [...全部.slice(起 + 1, j).matchAll(/\{([^{}]*)\}/g)].flatMap((m) => m[1].split(";").map((x) => x.split(":")[0].trim()).filter(Boolean));
    return 属性.length > 0 && 属性.every((x) => x === "opacity");
  }

  it("找得到减弱动态块（防止正则失效后空跑）", () => {
    expect(减弱块们.length).toBeGreaterThanOrEqual(5);
  });

  it("块里的过渡只许是 none 或只过渡透明度；位移、缩放、旋转只许撤成 none；动画只许关掉", () => {
    const 错: string[] = [];
    for (const 块 of 减弱块们)
      for (const m of 块.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        for (const d of m[2].split(";")) {
          const i = d.indexOf(":");
          if (i < 0) continue;
          const 名 = d.slice(0, i).trim(), 值 = d.slice(i + 1).replace("!important", "").trim();
          const 选 = m[1].trim().slice(0, 60);
          if (名 === "transition" && !/^none$/.test(值) && !值.split(/,(?![^()]*\))/).every((段) => /^opacity\b/.test(段.trim())))
            错.push(`${选} transition: ${值}`);
          if (名 === "transition-property" && !/^(none|opacity)$/.test(值)) 错.push(`${选} transition-property: ${值}`);
          if (/^(transform|scale|translate|rotate)$/.test(名) && 值 !== "none") 错.push(`${选} ${名}: ${值}`);
          // 动画可以留，但关键帧里只许动透明度（比如 AI 在跑的那颗点：rd-pulse 只明暗呼吸）
          if ((名 === "animation" || 名 === "animation-name") && 值 !== "none" && !只动透明度(值.split(/\s+/)[0]))
            错.push(`${选} ${名}: ${值}`);
        }
    expect(错, `减弱动态块里还有会动的：\n${错.join("\n")}`).toEqual([]);
  });

  it("兜底那条把所有过渡、动画压到一瞬，并撤掉按下的缩放和位移", () => {
    const 兜底 = 减弱块们.find((b) => /\*,\s*\*::before,\s*\*::after\s*\{/.test(b));
    expect(兜底).toBeTruthy();
    expect(兜底).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(兜底).toMatch(/animation-duration:\s*0\.01ms !important/);
    for (const p of ["transform", "scale", "translate"]) expect(兜底).toMatch(new RegExp(`${p}:\\s*none !important`));
  });
});
