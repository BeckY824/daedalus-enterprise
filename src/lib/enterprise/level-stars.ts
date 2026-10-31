/**
 * 级别显示（企业版）。10-31 会议（F-客户-01）起去掉星标，只显示字母 S / A / B / C；
 * 原来的「S=4★ … C=1★」改成直接给字母。导出名（级别星、级别星数、满星）照留，调用的地方不用改。
 * 项目级别（Project.level，迁移 093）、客户级别都按这一份显示，别各写各的。
 * 纯数据、浏览器和服务端都能用；能选哪几档、说明文字见 customer-v2.ts 企业客户级别 / 企业级别说明
 */
import { 企业客户级别, type 企业客户级别 as 级别 } from "./customer-v2";

/** 档位高低（S 最高）：只用来排序、比较，界面不再画成星 */
export const 级别星数: Readonly<Record<级别, number>> = { S: 4, A: 3, B: 2, C: 1 };

/** 最高一档的数 */
export const 满星 = Math.max(...企业客户级别.map((x) => 级别星数[x]));

/**
 * 级别 → 显示用的字母（「A」）；没分级、认不出的给空串。
 * 第二个参数（原来的「补齐空心星」）留着兼容，不再起作用
 */
export function 级别星(v: string | null | undefined, _补齐 = true): string {
  return v && Object.hasOwn(级别星数, v) ? v : "";
}
