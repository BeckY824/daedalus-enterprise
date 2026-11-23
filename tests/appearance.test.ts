/**
 * 外观（设置 → 外观）。本地存的值不可信；首次绘制前那段脚本和设置页读的是同一套规矩。
 * 两边对不上的后果：刷新时先按脚本认的挂一个样子，React 起来后又换成另一个——闪一下。
 */
import { describe, it, expect } from "vitest";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { 读外观, 外观预设脚本, 外观键, 默认外观, 解明暗, 明暗表 } from "@/lib/appearance";

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

describe("外观", () => {
  it("没存过、坏 JSON、认不出的值，一律回到默认（浅色）；<html> 上只挂 data-mode", () => {
    for (const raw of [null, "", "{", '"white"', "null", "3", '{"mode":"night"}']) {
      expect(读外观(raw)).toEqual(默认外观);
      expect(跑(raw).dataset).toEqual({ mode: "light" });
    }
  });

  it("明暗：三档两边认法一样，跟随系统按 prefers-color-scheme 解，挂上去的只有 light / dark", () => {
    expect(明暗表.map((x) => x.key)).toEqual(["light", "dark", "system"]);
    expect(默认外观).toEqual({ mode: "light" });
    for (const mode of ["light", "dark", "system"] as const)
      for (const 系统暗 of [false, true]) {
        const raw = JSON.stringify({ mode });
        expect(读外观(raw)).toEqual({ mode });
        const 该挂 = mode === "system" ? (系统暗 ? "dark" : "light") : mode;
        expect(解明暗(mode, 系统暗)).toBe(该挂);
        expect(跑(raw, MAC, 系统暗).dataset).toEqual({ mode: 该挂 });
      }
    // 没有 matchMedia 时 system 解成亮色：和 解明暗(…, false) 一致
    expect(跑(JSON.stringify({ mode: "system" })).dataset).toEqual({ mode: "light" });
    for (const mode of ["night", 1, null, "DARK"]) {
      const raw = JSON.stringify({ mode });
      expect(读外观(raw)).toEqual({ mode: "light" });
      expect(跑(raw, MAC, true).dataset).toEqual({ mode: "light" });
    }
    // matchMedia 抛错也不能拖垮整段脚本
    const dataset: Record<string, string> = {};
    vm.runInNewContext(外观预设脚本, {
      localStorage: { getItem: () => JSON.stringify({ mode: "system" }) },
      navigator: { userAgent: MAC },
      matchMedia: () => {
        throw new Error("x");
      },
      document: { documentElement: { dataset, classList: { add: () => {} } } },
    });
    expect(dataset).toEqual({ mode: "light" });
  });

  it("11-23 外观只留一套：以前存的主题、底色、底色版、网页毛玻璃一律不认，不报错，明暗照旧；两边认出来的一样（不闪）", () => {
    for (const 旧 of [
      { paper: "tone", skin: "ledger", mode: "dark", paperV: 2 },
      { paper: "white", skin: "tech", mode: "system" },
      { paper: "tone", mode: "light", paperV: 1 },
      { skin: "pixel" },
    ]) {
      const raw = JSON.stringify(旧);
      const v = 读外观(raw);
      expect(v).toEqual({ mode: 旧.mode ?? "light" });
      expect(跑(raw, MAC, false).dataset, raw).toEqual({ mode: 解明暗(v.mode, false) });
    }
    // 网页毛玻璃存在另一个键里：存着 true 也不挂 glass / web-glass
    const 类 = new Set<string>();
    vm.runInNewContext(外观预设脚本, {
      localStorage: { getItem: (k: string) => (k === "daedalus.webGlass" ? "true" : null) },
      navigator: { userAgent: MAC },
      matchMedia: () => ({ matches: false }),
      document: { documentElement: { dataset: {}, classList: { add: (c: string) => 类.add(c) } } },
    });
    expect([...类]).toEqual([]);
    // 脚本里不再碰 data-skin / data-paper / 毛玻璃
    expect(外观预设脚本).not.toMatch(/skin|paper|glass/);
    // 设置页存的就是认出来的那份（整份重存，旧的主题、底色一并丢掉）
    const 页 = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/settings/AppearanceTab.tsx"), "utf8");
    expect(页).toContain("存(a)");
    expect(页).not.toMatch(/appr-paper|appr-skin|appr-glass/);
  });

  it("Windows 上（网页也算）首次绘制前挂 os-win，浅灰字和桌面端一样压深；Mac 不挂", () => {
    expect(跑(null, WIN).类.has("os-win")).toBe(true);
    expect(跑(null, `${WIN.replace(" Safari/", " daedalus-crm/0.46.27 Electron/38.2.0 Safari/")}`).类.has("os-win")).toBe(true);
    expect(跑(null, MAC).类.has("os-win")).toBe(false);
    // 挂 os-win 不影响认外观
    expect(跑(JSON.stringify({ mode: "dark" }), WIN).dataset).toEqual({ mode: "dark" });
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
          expect(一个).toBe("html.os-win[data-mode]");
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
