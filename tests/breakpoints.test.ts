/**
 * 视口断点只许三条线：768（手机 | 桌面）、1200（窄屏 | 宽屏）、1440（宽屏里筛选条还收不收）。
 * 写法固定：max-width 只写 767 / 1199 / 1439，min-width 只写 768 / 1200 / 1440。
 *
 * 2026-11-10 盘点：css 里写了 560/640/760/767/768/899/900/992/1023/1180/1199/1213/1279/1439/1799 十几种，
 * 同一类「窄了就收」的版面各收各的，窗口拖一下这里收了那里没收。收法（2026-11-10）：
 *   - 1024 以下的几档（560/640/760/899/900/992/1023）并到手机档 767：桌面最小窗口 1024，这样 1024 起的版面一点不变
 *   - 1180 → 1199；「更多筛选」只留图标那条 1279 → 1439（和公海筛选同一档，只会更早收，不会更挤）
 * 放行的是**按版面算出来的门槛**（几栏宽度相加），不是设备档，名单在下面，每条写了怎么算的；
 * 容器查询 @container 跟着组件自己的宽度走，不归这里管。高度查询（max-height）也不管。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释 } from "./css-read";
import { 名单门槛 } from "@/lib/roster";

const 档 = { max: new Set([767, 1199, 1439]), min: new Set([768, 1200, 1440]) };

/** 放行：文件 + 查询 → 怎么算出来的 */
const 版面门槛: Record<string, string> = {
  "app/globals.css (max-width: 1213px)": "记录页名单放不下就收：左栏 220 + 名单 312 + 留白 52 + 两栏下限 630 = lib/roster.ts 名单门槛 1214（下面有一条测试对数）",
  "app/(app)/settings/settings.css (max-width: 799px)": "合并台账日期范围弹层双月并排约 780 宽 + 两边各留 8 = 796，视口不到这个宽就改上下两个月；按弹层宽度算，不是设备档",
  "app/globals.css (max-width: 575px)": "客户页页头两颗按钮各占一半只管手机竖屏（同 antd xs 576）：576–767 窄窗口按钮留在客户名一行右端（11-12 规矩），这是按钮放得下的门槛，不是设备档",
  "app/globals.css (max-width: 1799px)": "AI 面板常驻时 xl 栅格重映射：正文 = 窗口 - 左栏 220 - 面板 380，窗口 1800 正文才有 1200",
  "components/AppShell.tsx (max-width: 1599px)": "AI 面板能不能常驻（面板放不下），面板 380 + 左栏 220 + 正文下限",
};

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

type 断点 = { rel: string; 行: number; 查询: string; 向: "max" | "min"; 宽: number };

function 视口断点(): 断点[] {
  const out: 断点[] = [];
  for (const f of 所有源文件(源, /\.css$/)) {
    const rel = 相对(f);
    const s = 去注释(fs.readFileSync(f, "utf8"));
    for (const m of s.matchAll(/@media\b([^{]*)\{/g)) {
      for (const q of m[1].matchAll(/\((max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\)/g)) {
        out.push({ rel, 行: s.slice(0, m.index!).split("\n").length, 查询: `(${q[1]}-width: ${q[2]}px)`, 向: q[1] as "max" | "min", 宽: Number(q[2]) });
      }
    }
  }
  // js 里给 matchMedia / useNarrow 的字面量查询；模板串里 ${门槛} 算出来的不在这里（数字不是写死的）
  for (const f of 所有源文件(源, /\.tsx?$/)) {
    const rel = 相对(f);
    fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      for (const q of l.matchAll(/\((max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\)/g)) {
        out.push({ rel, 行: i + 1, 查询: `(${q[1]}-width: ${q[2]}px)`, 向: q[1] as "max" | "min", 宽: Number(q[2]) });
      }
    });
  }
  return out;
}

describe("视口断点只用三条线", () => {
  const 全部 = 视口断点();

  it("max-width 只写 767/1199/1439，min-width 只写 768/1200/1440（版面门槛除外）", () => {
    const 错 = 全部
      .filter((d) => !档[d.向].has(d.宽) && !版面门槛[`${d.rel} ${d.查询}`])
      .map((d) => `${d.rel}:${d.行} ${d.查询}`);
    expect(错, `这些断点不在三档上：手机 max 767 / 窄屏 min 768 max 1199 / 宽屏 min 1200 max 1439 / min 1440：\n${错.join("\n")}`).toEqual([]);
  });

  it("版面门槛名单没有过期的条目", () => {
    const 有 = new Set(全部.map((d) => `${d.rel} ${d.查询}`));
    expect(Object.keys(版面门槛).filter((k) => !有.has(k))).toEqual([]);
  });

  it("记录页名单那条 css 断点和 lib/roster.ts 的名单门槛对得上", () => {
    expect(全部.some((d) => d.rel === "app/globals.css" && d.向 === "max" && d.宽 === 名单门槛 - 1)).toBe(true);
  });
});

/*
 * 设计语言 E6d · D23：视口断点上面已经收成三档；剩下两类原来没人管、7E 收过之后又长出新档：
 *   - 容器查询 @container：跟组件自己的宽度走，门槛按那块版面算（几栏放得下），不并到视口三档。
 *     但同一个门槛写成 629 / 630 / 639 这种「差不多」的数，就是各收各的。现在的 16 个进名单（11-23 跟 main 补 2 个，共 18 个），只减不增：
 *     新组件要收，先用名单里已有的门槛；真要新门槛，写进名单并写清怎么算的。
 *   - 高度查询 max-height：只有矮窗口弹框收表单间距那一条。
 * 合并现有门槛（比如 639 → 629）会让某个宽度区间的版面变样，不在「不改外观」的 E6 里做。
 */
const 容器门槛: Record<string, string> = {
  "(max-width: 480px)": "数据页（overview）待办卡片、待办行收成一列",
  "(max-width: 559px)": "客户详情资料区（cdzone / 骨架屏）两栏 → 一栏，和 min 560 成对",
  "(min-width: 560px)": "同上，资料区两栏起",
  "(max-width: 560px)": "渠道看板指标两列、数据页待办看板收成一列（和上一条差 1px，不同组件，合并会让 560 那一像素变样）",
  "(max-width: 629px)": "记录页 / 项目详情两栏下限 630（lib/roster 名单门槛里的两栏下限），放不下就一栏",
  "(min-width: 630px)": "同上，两栏起",
  "(max-width: 639px)": "首页问答卡（.cli-ck）一栏，指标卡并到下面两列",
  "(min-width: 720px)": "数据页客户地图：排名摆到地图右边",
  "(max-width: 720px)": "设置页目录收到上面；客户三态状态条窄了只留主按钮",
  "(max-width: 760px)": "数据页卡点分栏、沟通 / 话题带侧栏收成一栏",
  "(max-width: 819px)": "客户详情资料区（cdzone / 骨架屏）三栏 → 两栏",
  "(max-width: 900px)": "渠道看板指标六列 → 三列",
  "(max-width: 1000px)": "项目详情右栏收窄到 280",
  "(max-width: 1039px)": "客户详情（新版）左栏 260 → 232",
  // 11-23 跟 main 补（渠道看板 D33 / D39，E6d 之后 main 上新加）：KPI 26 号 + 金额缩写一格约 150 宽，看板 561–1040 排 3×2
  "(min-width: 561px)": "渠道看板 KPI 3×2 的下沿（和 max 560 的两列成对）",
  "(max-width: 1040px)": "渠道看板 KPI 3×2 的上沿（1280 宽 + 侧栏时看板窄于 1040）",
  "(max-width: 1089px)": "记录页三栏 → 两栏，和 min 1090 成对",
  "(min-width: 1090px)": "同上，三栏起",
  // 11-23 跟 main 补（HC-5 · P-界面-60，#441）：首页问答格（.cli-ck）宽 ≥1340 时问过之后右边指标卡不收、照问之前 2:1。
  // 1920 宽减左栏 220、中栏 232、四边 48 = 1420（中栏收起 1652），都 ≥1340；Mac 1440、Win 125% 的 1536（格宽 1268 以下）都在它下面、照旧收起
  "(min-width: 1340px)": "首页问答格问过之后右栏指标卡不收（HC-5）",
};
const 高度门槛: Record<string, string> = {
  "(max-height: 820px)": "矮窗口（13 寸不全屏）弹框表单项间距 24 → 14",
};

function 条件查询(规则: "@container" | "@media", 量: "width" | "height"): { rel: string; 行: number; 查询: string }[] {
  const out: { rel: string; 行: number; 查询: string }[] = [];
  for (const f of 所有源文件(源, /\.css$/)) {
    const rel = 相对(f);
    const s = 去注释(fs.readFileSync(f, "utf8"));
    for (const m of s.matchAll(new RegExp(`${规则}\\b([^{]*)\\{`, "g"))) {
      for (const q of m[1].matchAll(new RegExp(`\\((max|min)-${量}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\)`, "g"))) {
        out.push({ rel, 行: s.slice(0, m.index!).split("\n").length, 查询: `(${q[1]}-${量}: ${q[2]}px)` });
      }
    }
  }
  return out;
}

describe("容器查询和高度查询的门槛只减不增（E6d · D23）", () => {
  const 容器 = 条件查询("@container", "width");
  const 高度 = 条件查询("@media", "height");

  it("读得到（防解析坏了全放行）", () => {
    expect(容器.length).toBeGreaterThan(40);
    expect(高度.length).toBeGreaterThan(0);
  });

  it("容器查询只用名单里的门槛", () => {
    const 错 = 容器.filter((d) => !容器门槛[d.查询]).map((d) => `${d.rel}:${d.行} ${d.查询}`);
    expect(错, `新门槛先看能不能用名单里已有的；真要新的，写进 容器门槛 并写清怎么算的：\n${错.join("\n")}`).toEqual([]);
  });

  it("高度查询只用名单里的门槛", () => {
    const 错 = 高度.filter((d) => !高度门槛[d.查询]).map((d) => `${d.rel}:${d.行} ${d.查询}`);
    expect(错).toEqual([]);
  });

  it("名单没有过期的条目（门槛删掉了就从名单划掉）", () => {
    const 有容器 = new Set(容器.map((d) => d.查询));
    const 有高度 = new Set(高度.map((d) => d.查询));
    expect([...Object.keys(容器门槛).filter((k) => !有容器.has(k)), ...Object.keys(高度门槛).filter((k) => !有高度.has(k))]).toEqual([]);
  });
});
