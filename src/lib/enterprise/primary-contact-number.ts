/**
 * 号码记到主联系人（E-260，11-24 客户「客户没有电话这一说法」）：企业版号码一律在联系人上，客户本身不再有号码。
 * 新建客户（新建弹窗、建档向导、首页 AI 建档）、导入 / 定时同步、老线索转项目交来的「客户电话」都走这里落到主联系人：
 *   - 有主联系人（没删的）就记在他身上；没有主联系人、有别的联系人就记在最早那位身上；
 *   - 一位联系人都没有就新建一位主联系人，姓名按客户名称拆（contact-name-from-customer.ts，拆不出留空）。
 * 新建的那位把号写进联系人主表对应那格（手机号 → 电话、邮箱、微信），别的类型（旺旺）只进联系方式子表；
 * 已有的那位主表那格空着才补上，有值的不动（号照样记进子表、挂在他身上）。
 * 只用 tx，调用方在自己的事务里调；查重由调用方先做（这里只写）。
 */
import type { Prisma } from "@/generated/prisma";
import { 记号码, type 记到, type 验好的号 } from "./contact-dedupe";
import { 客户名拆人名 } from "./contact-name-from-customer";

type 主表格 = "phone" | "email" | "wechat";
const 主表哪格: Partial<Record<验好的号["类型"], 主表格>> = { 手机号: "phone", 邮箱: "email", 微信: "wechat" };

/** 找这位客户的主联系人：主联系人优先、再按建的先后；没删的才算。没有返回 null */
export async function 主联系人of(tx: Prisma.TransactionClient, customerId: string): Promise<{ id: string; phone: string | null; email: string | null; wechat: string | null } | null> {
  return tx.contact.findFirst({
    where: { customerId, deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, phone: true, email: true, wechat: true },
  });
}

/**
 * 号码落到主联系人；返回挂上的联系人 id 和是不是这次新建的。
 * 到 = 记号码 的范围（刚建的客户 / 已有的客户，已有的按当前用户范围核）；客户名 = 没联系人时拆姓名用
 */
export async function 号码记到主联系人(
  tx: Prisma.TransactionClient,
  到: 记到,
  号: 验好的号,
  客户名: string | null | undefined,
): Promise<{ contactId: string; 新建: boolean }> {
  const customerId = "刚建的" in 到 ? 到.刚建的 : 到.已有;
  const 格 = 主表哪格[号.类型];
  const 有 = await 主联系人of(tx, customerId);
  if (有) {
    if (格 && !String(有[格] ?? "").trim()) await tx.contact.update({ where: { id: 有.id }, data: { [格]: 号.值 } });
    await 记号码(tx, 到, 有.id, 号);
    return { contactId: 有.id, 新建: false };
  }
  const c = await tx.contact.create({
    data: { name: 客户名拆人名(客户名), isPrimary: true, customerId, ...(格 ? { [格]: 号.值 } : {}) },
    select: { id: true },
  });
  // 主客户那一行也记进联系人挂靠表（同联系人表单新建，迁移 090）
  await tx.contactCustomer.create({ data: { contactId: c.id, customerId } });
  await 记号码(tx, 到, c.id, 号);
  return { contactId: c.id, 新建: true };
}
