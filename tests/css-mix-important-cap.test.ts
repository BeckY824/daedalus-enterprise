/**
 * 设计语言 E6 · D27：color-mix 现调色、!important 太多（现在-设计语言 D27：133 / 143 处）。
 *
 * 现调色的颜色不进 token，暗色管不到；!important 一多，后来的人只能再加 !important 才盖得过。
 * 一处处收会动外观（E6 不改外观），先按「只减不增」管住（P-界面-15）：
 *   1. 数量不许超过下面的上限（css 去掉注释后数；ts / tsx 里写在样式字符串里的也数）
 *   2. 收掉了几处，测试红，提醒把上限改成新的数（上限只往下走）
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释 } from "./css-read";

/** 11-22 盘点 css 134 / 138、ts 3 / 1；11-23 跟 main（删了换皮主题文件）重数 */
const 上限 = { css: { colorMix: 87, important: 124 }, ts: { colorMix: 2, important: 1 } };

function 走(dir: string, f: (p: string) => void) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) { if (n !== "generated") 走(p, f); } else f(p);
  }
}
const 数 = { css: { colorMix: 0, important: 0 }, ts: { colorMix: 0, important: 0 } };
走(源, (p) => {
  const 类 = p.endsWith(".css") ? "css" : /\.tsx?$/.test(p) ? "ts" : null;
  if (!类) return;
  const s = 类 === "css" ? 去注释(fs.readFileSync(p, "utf8")) : fs.readFileSync(p, "utf8");
  数[类].colorMix += (s.match(/color-mix\(/g) ?? []).length;
  数[类].important += (s.match(/!important/g) ?? []).length;
});

describe("color-mix / !important 只减不增", () => {
  it("不超过上限：新样式用 token（--brand-bg、--hover…），盖不过先查选择器，别再加 !important", () => {
    expect(数.css.colorMix).toBeLessThanOrEqual(上限.css.colorMix);
    expect(数.css.important).toBeLessThanOrEqual(上限.css.important);
    expect(数.ts.colorMix).toBeLessThanOrEqual(上限.ts.colorMix);
    expect(数.ts.important).toBeLessThanOrEqual(上限.ts.important);
  });
  it("收掉了就把上限改成新的数（上限只往下走）", () => {
    expect(数).toEqual(上限);
  });
});
