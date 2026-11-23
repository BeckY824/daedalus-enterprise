/**
 * 外观（设置 → 外观）。本地存的值不可信；首次绘制前那段脚本和设置页读的是同一套规矩。
 * 两边对不上的后果：刷新时先按脚本认的挂一个样子，React 起来后又换成另一个——闪一下。
 */
import { describe, it, expect } from "vitest";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { 读外观, 外观预设脚本, 外观键, 默认外观, 网页玻璃键, 解明暗, 明暗表, 底色表, 存外观值, 底色版 } from "@/lib/appearance";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** 系统暗：undefined = 环境里根本没有 matchMedia（老浏览器 / 测试 vm），脚本得照样跑完 */
function 跑(存的: string | null, ua = MAC, 系统暗?: boolean) {
  const dataset: Record<string, string> = {};
  const 类 = new Set<string>();
  vm.runInNewContext(外观预设脚本, {
    localStorage: { getItem: (k: string) => (k === 外观键 ? 存的 : null) },
    navigator: { userAgent: ua },
    ...(系统暗 === undefined ? {} : { matchMedia: (q: string) => ({ matches: 系统暗 && q === "(prefers-color-scheme: dark)" }) }),
    document: { documentElement: { dataset, classList: { add: (c: string) => 类.add(c) } } },
  });
  return { dataset, 类 };
}

/** 脚本认出来的外观；mode 是存的值，挂上去的是解出来的 light / dark，另看 dataset.mode */
function 跑脚本(存的: string | null) {
  const { dataset } = 跑(存的);
  const v = 读外观(存的);
  // 没有 matchMedia 时 system 解成亮色：和 解明暗(…, false) 一致
  expect(dataset.mode).toBe(解明暗(v.mode, false));
  return { paper: dataset.paper, skin: dataset.skin, mode: v.mode };
}

const 网页 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const 桌面端 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Electron/38.0.0 Safari/537.36";

/** 跑一遍首次绘制前的脚本，看 <html> 上挂了哪些类 */
function 跑玻璃(存的: string | null, ua: string, 少透明 = false) {
  const 类 = new Set<string>();
  const dataset: Record<string, string> = {};
  vm.runInNewContext(外观预设脚本, {
    localStorage: { getItem: (k: string) => (k === 网页玻璃键 ? 存的 : null) },
    navigator: { userAgent: ua },
    matchMedia: (q: string) => ({ matches: 少透明 && q.includes("reduced-transparency") }),
    document: { documentElement: { dataset, classList: { add: (c: string) => 类.add(c) } } },
  });
  return [...类].sort();
}

describe("外观", () => {
  it("没存过、坏 JSON、认不出的值，一律回到默认（原底、现状、浅色）", () => {
    for (const raw of [null, "", "{", '"white"', '{"paper":"pink","skin":"neon"}']) {
      expect(读外观(raw)).toEqual(默认外观);
      expect(跑脚本(raw)).toEqual(默认外观);
    }
  });

  it("存了白底：设置页和首次绘制前的脚本认出来的一样", () => {
    const raw = JSON.stringify({ paper: "white", skin: "now", paperV: 底色版 });
    expect(读外观(raw)).toEqual({ paper: "white", skin: "now", mode: "light" });
    expect(跑脚本(raw)).toEqual(读外观(raw));
  });

  it("五套主题（现状、像素、科技、高级、账簿）两边都认，底色和主题任意组合", async () => {
    const { 主题表 } = await import("@/lib/appearance");
    expect(主题表.map((x) => x.key)).toEqual(["now", "pixel", "tech", "luxe", "ledger"]);
    for (const { key } of 主题表)
      for (const paper of ["tone", "white"]) {
        const raw = JSON.stringify({ paper, skin: key, paperV: 底色版 });
        expect(读外观(raw)).toEqual({ paper, skin: key, mode: "light" });
        expect(跑脚本(raw)).toEqual(读外观(raw));
      }
  });

  it("明暗：三档两边认法一样，跟随系统按 prefers-color-scheme 解，挂上去的只有 light / dark", () => {
    expect(明暗表.map((x) => x.key)).toEqual(["light", "dark", "system"]);
    expect(默认外观.mode).toBe("light");
    for (const mode of ["light", "dark", "system"] as const)
      for (const 系统暗 of [false, true]) {
        const raw = JSON.stringify({ paper: "white", skin: "pixel", mode, paperV: 底色版 });
        expect(读外观(raw)).toEqual({ paper: "white", skin: "pixel", mode });
        const 该挂 = mode === "system" ? (系统暗 ? "dark" : "light") : mode;
        expect(解明暗(mode, 系统暗)).toBe(该挂);
        expect(跑(raw, MAC, 系统暗).dataset).toEqual({ paper: "white", skin: "pixel", mode: 该挂 });
      }
    // 认不出的明暗回到亮色，不连累另外两项
    for (const mode of ["night", 1, null, "DARK"]) {
      const raw = JSON.stringify({ paper: "white", skin: "luxe", mode, paperV: 底色版 });
      expect(读外观(raw)).toEqual({ paper: "white", skin: "luxe", mode: "light" });
      expect(跑(raw, MAC, true).dataset).toEqual({ paper: "white", skin: "luxe", mode: "light" });
    }
    // matchMedia 抛错也不能拖垮整段脚本（paper / skin 照挂）
    const dataset: Record<string, string> = {};
    vm.runInNewContext(外观预设脚本, {
      localStorage: { getItem: () => JSON.stringify({ skin: "tech", mode: "system" }) },
      navigator: { userAgent: MAC },
      matchMedia: () => {
        throw new Error("x");
      },
      document: { documentElement: { dataset, classList: { add: () => {} } } },
    });
    expect(dataset).toEqual({ paper: "tone", skin: "tech", mode: "light" });
  });

  it("11-23 默认切回原底：没明确选过白底的（没存、D-2 那天及以前存的白底）一律原底；原底存着就认；11-23 起在设置页选的白底照它", () => {
    expect(底色版).toBe(3);
    expect(默认外观.paper).toBe("tone");
    // 没存过（新电脑、清过本地）：原底
    expect(读外观(null).paper).toBe("tone");
    expect(跑(null).dataset.paper).toBe("tone");
    // 存过整份外观但没有 paper 这一项（更早的版本）：原底
    expect(跑(JSON.stringify({ skin: "now", mode: "dark" })).dataset).toEqual({ paper: "tone", skin: "now", mode: "dark" });
    // 以前存的白底（没有底色版 = D-2 以前；版本 2 = D-2 那天，分不出是选的还是顺手记下的默认）：不分主题，一律回到原底；明暗、主题照旧
    for (const skin of ["now", "pixel", "tech", "luxe", "ledger", undefined]) {
      for (const 版 of [undefined, 1, 2]) {
        const raw = JSON.stringify({ paper: "white", skin, mode: "dark", paperV: 版 });
        const 该 = { paper: "tone", skin: skin ?? "now", mode: "dark" };
        expect(读外观(raw), raw).toEqual(该);
        expect(跑(raw).dataset, raw).toEqual(该);
      }
    }
    // 原底不看底色版：D-2 以前、D-2 那天、11-23 起存的原底都照旧是原底
    for (const skin of ["now", "pixel", "luxe"] as const)
      for (const 版 of [undefined, 1, 2, 底色版]) {
        const raw = JSON.stringify({ paper: "tone", skin, mode: "dark", paperV: 版 });
        expect(读外观(raw), raw).toEqual({ paper: "tone", skin, mode: "dark" });
        expect(跑(raw).dataset, raw).toEqual({ paper: "tone", skin, mode: "dark" });
      }
    // 11-23 起在设置页选的白底（存外观值 带上底色版）：照它
    const 存 = 存外观值({ paper: "white", skin: "now", mode: "light" });
    expect(存).toEqual({ paper: "white", skin: "now", mode: "light", paperV: 底色版 });
    const 白底 = JSON.stringify(存);
    expect(读外观(白底).paper).toBe("white");
    expect(跑(白底).dataset).toEqual({ paper: "white", skin: "now", mode: "light" });
    // 设置页存的时候一律经 存外观值（不然这之后选的白底也会被当成旧值）
    const 页 = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/settings/AppearanceTab.tsx"), "utf8");
    expect(页).toContain("存(存外观值(a))");
    expect(页).not.toMatch(/存\(a\)/);
    // 服务端先按默认渲染 data-paper（首屏不闪：没存偏好的人第一帧就是原底，和脚本认的一致）
    const 根 = fs.readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(根).toContain("data-paper={默认外观.paper}");
    // 设置页「底色」一行默认的原底排在前面
    expect(底色表.map((x) => x.key)).toEqual(["tone", "white"]);
  });

  it("白底只换地面，不许在 :root 之外写色值", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
    const 块 = /:root\[data-paper="white"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(块).toContain("--page-bg");
    expect(块).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("网页版毛玻璃：默认关，存了 true 才在首次绘制前挂上 glass + web-glass", () => {
    for (const raw of [null, "", "false", "1", '"true"', "{"]) expect(跑玻璃(raw, 网页)).toEqual([]);
    expect(跑玻璃("true", 网页)).toEqual(["glass", "web-glass"]);
  });

  it("网页版毛玻璃：系统开了「减少透明度」不挂；桌面端由壳挂，脚本不碰", () => {
    expect(跑玻璃("true", 网页, true)).toEqual([]);
    expect(跑玻璃("true", 桌面端)).toEqual([]);
  });

  it("网页版那层底图只挂在 web-glass 上，颜色只用 token", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
    const 块 = /html\.glass\.web-glass\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(块).toContain("var(--workbench)");
    expect(块).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("Windows 上（网页也算）首次绘制前挂 os-win，默认主题的浅灰字和桌面端一样压深；Mac 不挂", () => {
    expect(跑(null, WIN).类.has("os-win")).toBe(true);
    expect(跑(null, `${WIN.replace(" Safari/", " daedalus-crm/0.46.27 Electron/38.2.0 Safari/")}`).类.has("os-win")).toBe(true);
    expect(跑(null, MAC).类.has("os-win")).toBe(false);
    // 挂 os-win 不影响认外观
    const raw = JSON.stringify({ paper: "white", skin: "luxe", paperV: 底色版 });
    expect(跑(raw, WIN).dataset).toMatchObject({ paper: "white", skin: "luxe" });
  });

  it("低配机（≤4 核或 ≤4GB，报得出来才算）首次绘制前挂 lite-fx（⌘K 毛玻璃退回实色）；报不出来按正常机器", () => {
    const 机 = (nav: Record<string, unknown>) => {
      const 类 = new Set<string>();
      vm.runInNewContext(外观预设脚本, {
        localStorage: { getItem: () => null },
        navigator: { userAgent: MAC, ...nav },
        document: { documentElement: { dataset: {}, classList: { add: (c: string) => 类.add(c) } } },
      });
      return 类.has("lite-fx");
    };
    expect(机({ hardwareConcurrency: 4 })).toBe(true);
    expect(机({ hardwareConcurrency: 12, deviceMemory: 4 })).toBe(true);
    expect(机({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
    expect(机({})).toBe(false);
    const css = fs.readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
    // 毛玻璃那几条都排除了 lite-fx
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*\.cmdk-root[^{}]*)\{[^{}]*backdrop-filter:\s*(?!none)[^;]*;/g)) expect(m[1]).toContain(":not(.lite-fx)");
  });

  it("os-win 在网页上只改字色：其余 os-win 规则都得限在 .shell-desktop 里", () => {
    const 全部 = (fs.readdirSync(path.resolve(__dirname, "../src"), { recursive: true }) as string[])
      .filter((f) => f.endsWith(".css"))
      .map((f) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))
      .join("\n");
    // 运营台的 opx-os-win 是另一回事，不算
    const 是它 = (x: string) => /(?<![\w-])os-win\b/.test(x);
    const 选择器 = [...全部.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(([, sel]) => 是它(sel));
    expect(选择器.length).toBeGreaterThan(1);
    for (const [, sel, body] of 选择器)
      for (const 一个 of sel.split(",").map((x) => x.trim()).filter(是它))
        if (!一个.includes(".shell-desktop")) {
          expect(一个).toBe('html.os-win[data-skin="now"]');
          expect(body.replace(/--text-(muted|faint)\s*:[^;]*;?/g, "").trim()).toBe("");
        }
  });

  it("根布局把脚本放在 <head> 里（放进 body 就晚了一帧，会闪）", () => {
    const layout = fs.readFileSync(path.resolve(__dirname, "../src/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<head>[\s\S]*外观预设脚本[\s\S]*<\/head>/);
    // 服务端先按默认挂上 data-mode，脚本再改；少了这一项，没开 JS 的人看到的是一半亮一半暗
    expect(layout).toMatch(/data-mode=\{默认外观\.mode\}/);
  });
});
