/**
 * 联系人真没了（回收站到期清理、系统管理员彻底删除、从客户上移出、撤回导入）之前，把他挂在联系方式子表里的号摘掉（审核 11-18 P1-4）。
 *
 * ContactMethod.contactId 外键是 onDelete: SetNull：不先摘，删联系人只会把 contactId 置空，这一行号就成了「客户本身的号」，
 * 之后谁再录这个号都撞到这位客户（P-删-08 查重只认在用和回收站里的，彻底删了的人的号不该再算这位客户的），客户的号码里还多出一个不认识的号。
 *
 * 摘法（同撤回导入原来的 摘联系人号，enterprise-import/apply.ts 改成用这一份）：
 *   - 这一行号和客户主表电话（Customer.phone）是同一个手机号：导入时客户电话和联系人电话共用一行，这行本来也是客户的号 → 留下、摘掉联系人（contactId 置空）；
 *   - 别的一律删掉。
 * tx 要能看到回收站里的行（调用方包在 看已删 里，或联系人本来就在用）
 */
import type { Prisma } from "@/generated/prisma";
import { 验号码 } from "./contact-format";

type Tx = Prisma.TransactionClient;

/** 客户主表电话规整成子表的查重键（手机号；验不过 = 空） */
function 主表电话键(phone: string | null | undefined): string {
  if (!phone) return "";
  const r = 验号码("手机号", phone, { 放过占位: true });
  return r.ok ? r.键 : "";
}

/** 摘掉这些联系人名下的号；返回删了几行、留给客户几行 */
export async function 摘联系人号(tx: Tx, contactIds: string | readonly string[]): Promise<{ 删: number; 留给客户: number }> {
  const ids = [...new Set(typeof contactIds === "string" ? [contactIds] : contactIds)];
  if (!ids.length) return { 删: 0, 留给客户: 0 };
  const 行们 = await tx.contactMethod.findMany({ where: { contactId: { in: ids } }, select: { id: true, customerId: true, kind: true, numberKey: true } });
  if (!行们.length) return { 删: 0, 留给客户: 0 };
  const 客户ids = [...new Set(行们.filter((m) => m.kind === "phone").map((m) => m.customerId))];
  const 主表键 = new Map(
    (客户ids.length ? await tx.customer.findMany({ where: { id: { in: 客户ids } }, select: { id: true, phone: true } }) : [])
      .map((c) => [c.id, 主表电话键(c.phone)] as const),
  );
  const 留 = 行们.filter((m) => m.kind === "phone" && !!m.numberKey && 主表键.get(m.customerId) === m.numberKey).map((m) => m.id);
  const 留集 = new Set(留);
  const 删 = 行们.filter((m) => !留集.has(m.id)).map((m) => m.id);
  if (留.length) await tx.contactMethod.updateMany({ where: { id: { in: 留 } }, data: { contactId: null } });
  if (删.length) await tx.contactMethod.deleteMany({ where: { id: { in: 删 } } });
  return { 删: 删.length, 留给客户: 留.length };
}
