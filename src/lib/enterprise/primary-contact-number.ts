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
import { 验号码 } from "./contact-format";
import { 号键 } from "../phone";
import { 看全部 } from "../team-scope";

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

/* ───────────────────────── 导入 / 定时同步交来的客户电话 ───────────────────────── */

/**
 * 导入、增量导入、飞书 / 钉钉定时同步、客户页 Excel 导入交来的「客户电话」怎么落（导入规矩：只补空、逐格留空、没对上的并进备注、整批可撤销）：
 *   - 这位客户名下（没删的联系人主表电话格、联系方式子表）已经有这个号 → 已有，什么都不写（同号不重复）；
 *   - 一位联系人都没有 → 新建：建一位主联系人，姓名按客户名拆（拆不出留空），号写进他的电话格；
 *   - 有主联系人（主联系人优先、再按建的先后），他电话格空着、调用方说能补（能补主表格）→ 补主表：号写进那一格；
 *   - 电话格有别的号、或不让补主表（原系统同步来的联系人：补了下次同步那一格会算我们这边改过、记冲突）：
 *     号格式验得过 → 进子表：记进联系方式子表、挂在他身上；验不过（座机这类，照旧不进子表）→ 进备注：他的备注后面添一行「电话：…」；
 *     不让补主表的那位（原系统同步来的）备注也不碰（审查单 A-11），这一行添在客户备注后面 → 进客户备注。
 * 号格式验不过的照旧原样存（以前原样进客户电话格，现在原样进联系人电话格）。返回落成什么样，调用方据此记导入记录（撤回用）。
 * 只用 tx；记子表不限范围（导入、同步都是调用方明说看全部的）
 */
export type 导入落号 =
  | { 怎么: "已有" }
  | { 怎么: "新建"; contactId: string }
  | { 怎么: "补主表"; contactId: string; 原: string | null }
  | { 怎么: "进子表"; contactId: string; 号: 验好的号 }
  | { 怎么: "进备注"; contactId: string; 原: string | null; 新: string }
  | { 怎么: "进客户备注"; 原: string | null; 新: string };

/** 备注里添的那一行 */
export const 号进备注行 = (号: string) => `电话：${号}`;

export async function 导入号落主联系人(
  tx: Prisma.TransactionClient,
  customerId: string,
  原号: string,
  客户名: string | null | undefined,
  能补主表格: (contactId: string) => Promise<boolean> = async () => true,
): Promise<导入落号> {
  const 原 = 原号.trim();
  if (!原) return { 怎么: "已有" };
  const r = 验号码("手机号", 原);
  const 号: 验好的号 | null = r.ok && r.键 ? { 类型: r.类型, 值: r.值, 键: r.键 } : null;
  const 值 = 号?.值 ?? 原;
  const 同号 = (p: string | null | undefined) => {
    if (!p?.trim()) return false;
    if (号键(p) === 号键(原)) return true;
    const x = 号 ? 验号码("手机号", p) : null;
    return !!x?.ok && x.键 === 号!.键;
  };
  const 们 = await tx.contact.findMany({
    where: { customerId, deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, phone: true, remark: true },
  });
  if (们.some((c) => 同号(c.phone))) return { 怎么: "已有" };
  if (号 && (await tx.contactMethod.findFirst({ where: { customerId, kind: { in: [...号码类子表种类] }, numberKey: 号.键 }, select: { id: true } }))) return { 怎么: "已有" };
  const 主 = 们[0];
  if (!主) {
    const c = await tx.contact.create({ data: { name: 客户名拆人名(客户名), isPrimary: true, phone: 值, customerId }, select: { id: true } });
    // 主客户那一行也记进联系人挂靠表（审查单 A-15，同 号码记到主联系人、联系人表单新建）
    await tx.contactCustomer.create({ data: { contactId: c.id, customerId } });
    if (号) await 看全部(() => 记号码(tx, { 已有: customerId }, c.id, 号));
    return { 怎么: "新建", contactId: c.id };
  }
  const 能补 = await 能补主表格(主.id);
  if (!主.phone?.trim() && 能补) {
    await tx.contact.update({ where: { id: 主.id }, data: { phone: 值 } });
    if (号) await 看全部(() => 记号码(tx, { 已有: customerId }, 主.id, 号));
    return { 怎么: "补主表", contactId: 主.id, 原: 主.phone };
  }
  if (号) {
    await 看全部(() => 记号码(tx, { 已有: customerId }, 主.id, 号));
    return { 怎么: "进子表", contactId: 主.id, 号 };
  }
  const 行 = 号进备注行(原);
  const 添 = (旧: string | null) => ((旧 ?? "").split("\n").some((l) => l.trim() === 行) ? null : 旧 ? `${旧}\n${行}` : 行);
  if (!能补) {
    // 原系统同步来的联系人：电话格不补，备注也不碰（审查单 A-11，同一个理由），号添在客户备注后面
    const 客 = await tx.customer.findUnique({ where: { id: customerId }, select: { remark: true } });
    const 新 = 添(客?.remark ?? null);
    if (新 === null) return { 怎么: "已有" };
    await tx.customer.update({ where: { id: customerId }, data: { remark: 新 } });
    return { 怎么: "进客户备注", 原: 客?.remark ?? null, 新 };
  }
  const 新 = 添(主.remark);
  if (新 === null) return { 怎么: "已有" };
  await tx.contact.update({ where: { id: 主.id }, data: { remark: 新 } });
  return { 怎么: "进备注", contactId: 主.id, 原: 主.remark, 新 };
}

/** 子表里算「电话」的几种：手机、座机、WhatsApp 共用号键（11-17） */
const 号码类子表种类 = ["phone", "landline", "whatsapp"] as const;
