/**
 * 能点的东西要是按钮：div / span 之类挂 onClick，键盘 Tab 不到、回车按不动、读屏读不出「按钮」。
 *
 * 2026-11-10 盘点：tsx 里不是 button / a / input 却挂了 onClick 的有十来处，三种情况：
 *   - 只是 stopPropagation() 的外壳（挡住冒泡，不是让人点的）——放行
 *   - 已经补齐 role + tabIndex + onKeyDown（整块卡片当链接点）——放行
 *   - 剩下的改成 <button type="button">（引用圆标、记录筛选片），或补键盘（展开的 AI 过程）
 * 规则：小写标签（含 motion.div 这类）挂 onClick，要么只挡冒泡，要么三件套齐全，要么在下面名单里写明键盘怎么走。
 * onMouseDown / onPointerDown 不管：那是下拉候选、拖拽缝这类，键盘另有路径（方向键、separator 的 onKeyDown）。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 源, 去注释 } from "./skin-css";

/** 本来就能用键盘按的标签 */
const 原生可按 = new Set(["button", "a", "input", "select", "textarea", "summary", "option", "label"]);

/** 放行：文件 + 标签 → 个数和键盘怎么走 */
const 放行: Record<string, { 个: number; 为什么: string }> = {
  "app/(app)/projects/[id]/ProjectInlineField.tsx <div>": { 个: 1, 为什么: "点字直接改是鼠标捷径；键盘走旁边那颗「改X」笔按钮" },
  "app/admin/workspaces/WorkspacesView.tsx <pre>": { 个: 1, 为什么: "点一下全选交付文本；键盘走下面的「复制」按钮" },
  "components/InlineConfirm.tsx <motion.span>": { 个: 1, 为什么: "包着调用方传进来的按钮，只接按钮冒上来的点击" },
  "components/SettingsModal.tsx <motion.div>": { 个: 1, 为什么: "设置浮层外面那层灰（role=presentation）；键盘用 Esc 或右上「关闭设置」" },
};

function 所有tsx(dir: string): string[] {
  const out: string[] = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) {
      if (n !== "generated") out.push(...所有tsx(p));
    } else if (/\.tsx$/.test(n)) out.push(p);
  }
  return out;
}

/** 从 i 起找到和它配对的 }（i 指向 {） */
function 配对(s: string, i: number): number {
  let 深 = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") 深++;
    else if (s[j] === "}" && --深 === 0) return j;
  }
  return s.length;
}

type 点处 = { rel: string; 行: number; 标签: string; 开标签: string };

function 非按钮点击(): 点处[] {
  const out: 点处[] = [];
  for (const f of 所有tsx(源)) {
    const rel = path.relative(源, f).replaceAll("\\", "/");
    const s = 去注释(fs.readFileSync(f, "utf8"));
    for (const m of s.matchAll(/<(motion\.[a-z]+|[a-z][a-z0-9]*)(?=[\s>/])/g)) {
      const 标签 = m[1];
      if (原生可按.has(标签)) continue;
      // 找开标签结尾：跳过 {...} 里的 >（箭头函数、比较）
      let 深 = 0;
      let j = m.index! + m[0].length;
      for (; j < s.length; j++) {
        const c = s[j];
        if (c === "{") 深++;
        else if (c === "}") 深--;
        else if (c === ">" && 深 === 0) break;
      }
      const 开标签 = s.slice(m.index!, j);
      if (!/\sonClick=\{/.test(开标签)) continue;
      out.push({ rel, 行: s.slice(0, m.index!).split("\n").length, 标签, 开标签 });
    }
  }
  return out;
}

/** onClick 只是挡冒泡：{(e) => e.stopPropagation()} */
function 只挡冒泡(开标签: string): boolean {
  const i = 开标签.search(/\sonClick=\{/) + " onClick=".length;
  const 值 = 开标签.slice(i + 1, 配对(开标签, i)).trim();
  return /^\(?\s*(\w+)\s*(?::\s*[\w.<>]+)?\s*\)?\s*=>\s*\{?\s*\1\.stopPropagation\(\);?\s*\}?$/.test(值);
}

const 三件套 = (t: string) => /\srole=/.test(t) && /\stabIndex=/.test(t) && /\sonKeyDown=/.test(t);

describe("能点的东西要是按钮", () => {
  const 全部 = 非按钮点击();
  const 要管 = 全部.filter((d) => !只挡冒泡(d.开标签) && !三件套(d.开标签));

  it("非按钮挂 onClick：要么只挡冒泡，要么 role + tabIndex + onKeyDown 齐全，要么在放行名单里", () => {
    const 数 = new Map<string, 点处[]>();
    for (const d of 要管) {
      const k = `${d.rel} <${d.标签}>`;
      数.set(k, [...(数.get(k) ?? []), d]);
    }
    const 错: string[] = [];
    for (const [k, ds] of 数) {
      const 准 = 放行[k]?.个 ?? 0;
      if (ds.length > 准) 错.push(...ds.map((d) => `${d.rel}:${d.行} <${d.标签}>${准 ? `（放行 ${准} 处，现在 ${ds.length} 处）` : ""}`));
    }
    expect(错, `这些地方能点但键盘按不到，改成 <button type="button">，或补 role + tabIndex + onKeyDown：\n${错.join("\n")}`).toEqual([]);
  });

  it("放行名单没有过期的条目（个数要和现在一样）", () => {
    const 过期 = Object.entries(放行)
      .filter(([k, v]) => 要管.filter((d) => `${d.rel} <${d.标签}>` === k).length !== v.个)
      .map(([k]) => k);
    expect(过期).toEqual([]);
  });

  it("扫描本身能抓到东西（防止正则失灵变成永远通过）", () => {
    expect(全部.length).toBeGreaterThan(5);
    expect(全部.some((d) => 只挡冒泡(d.开标签))).toBe(true);
    expect(全部.some((d) => 三件套(d.开标签))).toBe(true);
  });
});
