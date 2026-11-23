/**
 * 设计语言 E6c · D20：globals.css 顶层同一个选择器写了几份。
 *
 * 起因：`.rec-chip` 定义过两次（标签胶囊那段一份、沟通框那段一份），前一份每一项都被后一份盖掉，
 * 改样式的人改了前一份看不到效果，再去后一份补一刀，越堆越乱。E6c 把 `.rec-chip` / `.rec-chip:hover` 的死定义删了（外观不变）。
 *
 * 剩下的重复多数是有意分段写的（基础样式一段、某个页面的覆盖一段），一次拆不完，所以按「只减不增」管（P-界面-15 前端闸门）：
 *   1. 不在下面名单里的选择器，顶层只许写一份——新代码要改样式，去改原来那份
 *   2. 名单里的选择器拆成一份之后，测试会红，提醒把它从名单里划掉（名单只会变短）
 * 只数顶层规则（@media / @supports / @container 里面的按断点、按条件覆盖，不算重复）。
 */
import { describe, it, expect } from "vitest";
import { globals, 去注释 } from "./css-read";

/** 2026-11-22 盘点剩下的 20 个（11-23 删换皮后补 :root，共 21 个），后面的数字是现在写了几份 */
const 还许重复: Record<string, number> = {
  // 根块一份、弹框那段的 --modal-gap 一份（10-03）；11-23 删换皮后根块选择器只剩裸 :root，才数到一起
  ":root": 2,
  ".rail": 2,
  ".rail-fb": 2,
  ".link-strong": 2,
  ".link-strong:hover": 2,
  ".rec-composer": 2,
  ".btodo-head-r": 2,
  ".ant-table-thead > tr > th": 2,
  ".cli-empty .cli-ck-g": 2,
  ".cli-input": 2,
  ".md-table th": 2,
  ".pipe-col": 2,
  ".pipe-card": 3,
  ".dock-body": 2,
  ".has-ai-fab": 2,
  ".att-panel .ant-upload-drag": 2,
  ".org-field-perm tbody th": 2,
  ".cd-seg > button": 2,
  '.pool-pick-p[aria-selected="true"]': 2,
  ".fu-np-note": 2,
  ".ant-select.cf-chip": 2,
};

/** 顶层规则的选择器（空白压成一格），@ 开头的块整个跳过 */
function 顶层选择器(css: string): string[] {
  const s = 去注释(css);
  const out: string[] = [];
  let 深 = 0;
  let 攒 = "";
  for (const ch of s) {
    if (ch === "{") {
      if (深 === 0) {
        const t = 攒.split(/\s+/).filter(Boolean).join(" ");
        if (!t.startsWith("@")) out.push(t);
      }
      深++;
      攒 = "";
    } else if (ch === "}") {
      深--;
      攒 = "";
    } else if (ch === ";" && 深 === 0) 攒 = "";
    else 攒 += ch;
  }
  return out;
}

describe("globals.css 顶层选择器不重复写（只减不增）", () => {
  const 数 = new Map<string, number>();
  for (const x of 顶层选择器(globals)) 数.set(x, (数.get(x) ?? 0) + 1);
  const 重复 = [...数].filter(([, n]) => n > 1);

  it("读得到规则（防解析坏了全放行）", () => {
    expect(数.size).toBeGreaterThan(1000);
    expect(数.get(".rec-chip")).toBe(1);
  });

  it("新出的重复：不在名单里的选择器只许写一份", () => {
    const 新 = 重复.filter(([k, n]) => n > (还许重复[k] ?? 1)).map(([k, n]) => `${k} ×${n}`);
    expect(新, "改原来那份，别在后面再写一份").toEqual([]);
  });

  it("名单只减：拆成一份的从名单里划掉、份数降了就改小", () => {
    const 该划 = Object.entries(还许重复).filter(([k, n]) => (数.get(k) ?? 0) < n).map(([k, n]) => `${k}：名单 ${n}，现在 ${数.get(k) ?? 0}`);
    expect(该划).toEqual([]);
  });
});
