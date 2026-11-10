/**
 * 企业版客户「渠道触点」（P-渠道-08，迁移 116 的 Customer.touchpoint）。纯算，服务端、客户端都能用。
 * 「公司资源」「客户介绍」不设主渠道：这两类客户主渠道留空，用触点标来源性质；主渠道和触点至少填一个。
 *   - 公司资源 = 公司分配资源；客户介绍 = 客情转化 / 转介绍，另挂介绍人客户（P-渠道-09，referrerCustomerId）
 * 取值先放这两个（规则「取值先放公司资源、客户介绍」），要加在这里加
 */

export const 渠道触点们 = ["公司资源", "客户介绍"] as const;
export type 渠道触点 = (typeof 渠道触点们)[number];
/** 选了这个才出「介绍人客户」（P-渠道-09） */
export const 客户介绍触点: 渠道触点 = "客户介绍";

/**
 * 交来的一格认成触点：去首尾空白后和取值之一一字不差才认。
 * 空的 = null（没填）；认不出的 = undefined（调用方拦下）
 */
export function 认渠道触点(v: string | null | undefined): 渠道触点 | null | undefined {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return (渠道触点们 as readonly string[]).includes(s) ? (s as 渠道触点) : undefined;
}

/** 新建（建档向导、AI 建档）原来要渠道的地方：渠道和触点至少一个（P-渠道-08）；服务端、向导第二步同一句 */
export const 渠道或触点必填 = "请选渠道或渠道触点";
export const 新建来源还差 = (渠道: string | null | undefined, 触点: string | null | undefined): string => (!渠道 && !触点 ? 渠道或触点必填 : "");
