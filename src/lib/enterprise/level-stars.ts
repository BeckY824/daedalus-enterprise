/**
 * 级别显示成星级（企业版，定稿 -2 版）：S=4★、A=3★、B=2★、C=1★。
 * 项目级别（Project.level，迁移 093）先用；客户级别以后也按这一份显示，别各写各的。
 * 纯数据、浏览器和服务端都能用；能选哪几档、说明文字见 customer-v2.ts 企业客户级别 / 企业级别说明
 */
import { 企业客户级别, type 企业客户级别 as 级别 } from "./customer-v2";

/** 每档几颗星（导出给客户级别以后复用） */
export const 级别星数: Readonly<Record<级别, number>> = { S: 4, A: 3, B: 2, C: 1 };

/** 最多几颗星：空心星补到这么多，几档对得齐 */
export const 满星 = Math.max(...企业客户级别.map((x) => 级别星数[x]));

/**
 * 级别 → 星串：实心 = 这一档的星数、空心补齐到 满星（「★★☆☆」）；没分级、认不出的给空串。
 * 补齐 = false 只给实心（「★★」），放窄的地方
 */
export function 级别星(v: string | null | undefined, 补齐 = true): string {
  const n = v && Object.hasOwn(级别星数, v) ? 级别星数[v as 级别] : 0;
  if (!n) return "";
  return "★".repeat(n) + (补齐 ? "☆".repeat(满星 - n) : "");
}
