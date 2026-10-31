/**
 * 联系人「号码保护」（企业版，10-31）：只是联系人卡上的一枚小标签，不能点、不能改。
 * 不参与任何逻辑：查重（contact-dedupe.ts）、分配、权限、打码（field-perm-table.ts）都不看它；也不加库字段，现算。
 *
 * 判定：联系人留了电话（手机或座机，改版后的号码行或老的 phone 格），且所属客户有负责人、不在公海 →「已开启」；
 * 其余一律「已关闭」（标签照样摆，状态一眼看得到，不靠「有没有这枚标签」去猜）。
 * 挂靠来的联系人按当前这页的客户算（卡片摆在哪位客户下就看哪位）。纯函数，界面和测试都用
 */
export type 号码保护状态 = "已开启" | "已关闭";

/** 算「有电话」的号码类型：手机、座机（和 customer-v2.ts 内置号码种类的 kind 一致） */
const 电话种类 = new Set(["phone", "landline"]);

type 联系人 = { phone?: string | null; 号码们?: readonly { kind: string; value: string }[] | null };
type 客户 = { salesOwnerId?: string | null; pool?: unknown };

export function 有电话(c: 联系人): boolean {
  if (c.号码们?.some((m) => 电话种类.has(m.kind) && m.value?.trim())) return true;
  return !!c.phone?.trim();
}

export function 号码保护of(c: 联系人, 客户: 客户): { 状态: 号码保护状态; 原因: string } {
  if (!有电话(c)) return { 状态: "已关闭", 原因: "这位联系人没留电话" };
  if (客户.pool) return { 状态: "已关闭", 原因: "客户在公海里" };
  if (!客户.salesOwnerId) return { 状态: "已关闭", 原因: "客户还没有负责人" };
  return { 状态: "已开启", 原因: "有电话、客户有负责人" };
}
