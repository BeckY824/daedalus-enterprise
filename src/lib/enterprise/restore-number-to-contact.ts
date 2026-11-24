/**
 * 回收站捞回客户时，客户本身的号落到主联系人（E-260 审查 4b，11-24）。
 *
 * 企业版客户没有电话（客户「客户没有电话这一说法」）：数据脚本只挪了没删的客户，回收站里的客户 Customer.phone、
 * 客户本身的号码行（ContactMethod.contactId 空）还在。从回收站恢复（回收站页恢复、查重捞回都走 soft-delete.ts 只恢复）时，
 * 在恢复那笔事务里接着挪，口径照数据脚本 E260挪号.cjs 和 primary-contact-number.ts：
 *   - 主联系人 = 没删的联系人里主联系人优先、再按建的先后、id（主联系人of）；一位都没有就按客户名拆姓名新建一位主联系人，补主客户挂靠行
 *   - 客户本身的号码行：同一号（同类型同查重键；号码类也比联系人电话格）已在这位客户哪位没删的联系人身上 → 摘掉这一行；
 *     不在 → 改挂到主联系人身上（不复制），他主表对应那格（电话 / 邮箱 / 微信）空着就补上，有值的不动
 *   - Customer.phone：按 导入号落主联系人 落（已有不重复记；主联系人电话格空着补主表；有别的号进号码行；格式验不过进他的备注）
 *   - Customer.phone 置空串
 * 再删：联系人随客户一起进回收站，号在联系人身上；再捞回时客户本身已没有号，这里什么都不做。
 * 回收站恢复本身没有撤回，挪过去的号不会退回客户电话格（客户本来就不该有电话）。
 * 只用 tx：调用方在恢复的事务里调（看已删 里，所以这里每条查联系人都自己带 deletedAt: null）
 */
import type { Prisma } from "@/generated/prisma";
import { 主联系人of, 导入号落主联系人 } from "./primary-contact-number";
import { 客户名拆人名 } from "./contact-name-from-customer";
import { 号键 } from "../phone";

type Tx = Prisma.TransactionClient;
type 主联系人 = NonNullable<Awaited<ReturnType<typeof 主联系人of>>>;

/** 号码行的种类 → 联系人主表那一格（同 primary-contact-number.ts 主表哪格） */
const 主表哪格: Record<string, "phone" | "email" | "wechat" | undefined> = { phone: "phone", email: "email", wechat: "wechat" };
/** 和联系人电话格比的几种（手机、座机、WhatsApp 共用号键，11-17） */
const 号码类 = new Set(["phone", "landline", "whatsapp"]);

export async function 捞回客户号落主联系人(tx: Tx, customerId: string): Promise<void> {
  const c = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, phone: true } });
  if (!c) return;
  const 电话 = (c.phone ?? "").trim();
  const 散行 = await tx.contactMethod.findMany({
    where: { customerId, contactId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, value: true, numberKey: true },
  });
  if (!散行.length && !电话 && c.phone === "") return;

  let 主: 主联系人 | null = await 主联系人of(tx, customerId);
  const 要主联系人 = async (): Promise<主联系人> => {
    if (主) return 主;
    const n = await tx.contact.create({
      data: { name: 客户名拆人名(c.name), isPrimary: true, customerId },
      select: { id: true, phone: true, email: true, wechat: true },
    });
    // 主客户那一行也记进联系人挂靠表（同联系人表单新建、号码记到主联系人）
    await tx.contactCustomer.create({ data: { contactId: n.id, customerId } });
    主 = n;
    return n;
  };

  if (散行.length) {
    const 在用 = await tx.contact.findMany({ where: { customerId, deletedAt: null }, select: { id: true, phone: true } });
    const 已挂 = 在用.length
      ? await tx.contactMethod.findMany({ where: { customerId, contactId: { in: 在用.map((x) => x.id) } }, select: { kind: true, numberKey: true } })
      : [];
    const 已有键 = new Set(已挂.map((m) => `${m.kind}\t${m.numberKey}`));
    const 电话格键 = new Set(在用.map((x) => 号键(x.phone ?? "")).filter(Boolean));
    for (const m of 散行) {
      const 键 = `${m.kind}\t${m.numberKey}`;
      if (已有键.has(键) || (号码类.has(m.kind) && 电话格键.has(号键(m.value)))) {
        await tx.contactMethod.delete({ where: { id: m.id } });
        continue;
      }
      const p = await 要主联系人();
      await tx.contactMethod.update({ where: { id: m.id }, data: { contactId: p.id } });
      已有键.add(键);
      const 格 = 主表哪格[m.kind];
      if (格 && !String(p[格] ?? "").trim()) {
        await tx.contact.update({ where: { id: p.id }, data: { [格]: m.value } });
        主 = { ...p, [格]: m.value };
      }
      if (号码类.has(m.kind)) 电话格键.add(号键(m.value));
    }
  }

  if (电话) {
    await 要主联系人();
    await 导入号落主联系人(tx, customerId, 电话, c.name);
  }
  if (c.phone !== "") await tx.customer.update({ where: { id: customerId }, data: { phone: "" } });
}
