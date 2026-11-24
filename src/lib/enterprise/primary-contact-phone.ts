/**
 * 客户的「联系电话」= 主联系人的第一个号（E-260，客户「客户没有电话这一说法」）：企业版号码一律在联系人上。
 * 客户列表「联系电话」列、导出「联系电话」、跟进记录导出、受限详情只读卡、AI 查询里的电话都按这里取，
 * 打码（号码脱敏器、公海打码）由调用方照旧套在取出来的号上。
 *
 * 取法：没删的联系人里主联系人优先、再按建的先后（同 primary-contact-number.ts 的 主联系人of）；
 * 他主表的电话格有值就用它，没有就用他号码几行里第一个号码类（手机、座机、WhatsApp、传真），邮箱 / 微信 / 旺旺不算电话。
 * 纯函数，不碰库：查询那头用 主联系人号码选 带上这几格。
 */
import { 企业版 } from "./switch";

/** 号码类的几种（同客户详情页 打码种类：这几种过脱敏器） */
export const 号码类种类: ReadonlySet<string> = new Set(["phone", "landline", "whatsapp", "fax"]);

/** prisma select / include 里带上主联系人（一位）和他的号码几行 */
export const 主联系人号码选 = {
  where: { deletedAt: null },
  orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }],
  take: 1,
  select: {
    phone: true,
    contactMethods: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { kind: true, value: true } },
  },
};

export type 带号的联系人 = { phone: string | null; contactMethods?: readonly { kind: string; value: string }[] };

/** 主联系人的第一个号；联系人一位都没有 / 都没号返回空串。传进来的联系人按 主联系人号码选 的顺序排好（只看第一位） */
export function 主联系人电话(联系人们: readonly 带号的联系人[] | null | undefined): string {
  const c = 联系人们?.[0];
  if (!c) return "";
  const 主表 = c.phone?.trim();
  if (主表) return 主表;
  return c.contactMethods?.find((m) => 号码类种类.has(m.kind) && m.value.trim())?.value.trim() ?? "";
}

/** 客户的「电话」：企业版取主联系人的第一个号（客户没有电话），别的版本照旧客户电话那格。打码由调用方套 */
export function 客户电话(r: { phone: string | null; contacts?: readonly 带号的联系人[] | null }): string {
  return 企业版() ? 主联系人电话(r.contacts) : (r.phone ?? "");
}

/**
 * 客户详情页（RecordView）背调用的电话（E-260 审查 12）：同 主联系人电话 一个口径。
 * 页面交来的联系人里挂来的（别家客户的联系人挂到这位）不算；号码几行（号码们）已按建的先后排好、号码类照旧打过码。
 * 主联系人优先（页面已按 主联系人优先、建的先后、id 排好，这里再稳排一次防调用方漏排）
 */
export function 详情背调电话(
  联系人们: readonly { phone: string | null; isPrimary: boolean; 挂靠?: unknown; 号码们?: readonly { kind: string; value: string }[] }[],
): string {
  const 本客户的 = 联系人们.filter((c) => !c.挂靠);
  const 排好 = [...本客户的.filter((c) => c.isPrimary), ...本客户的.filter((c) => !c.isPrimary)];
  return 主联系人电话(排好.slice(0, 1).map((c) => ({ phone: c.phone, contactMethods: c.号码们 ?? [] })));
}
