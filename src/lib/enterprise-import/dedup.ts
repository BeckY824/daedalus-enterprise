/**
 * 客户页旧导入抽屉的查重索引（M-导入-29，企业版）：和迁移导入（report.ts 读本地索引）同一套号、同一个口径，
 * 交给 clean.ts 的 撞已有客户 去比。客户看全部（同事的、公海里的也算已有）；回收站里的不算（那条路另有 回收站里）。
 * 不给 客户号（整串比短号那一路）：电话那格和 WhatsApp / 座机 / 联系人 / 子表的号一样按 归档号键 比，不足 10 位的号不比
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 企业版 } from "@/lib/enterprise/switch";
import { 名键, 归档号键, 归档号索引, type 本地索引 } from "./clean";

export type 导入查重索引 = Pick<本地索引, "客户名" | "客户号" | "归档号">;

/** 不算 = 这一批自己刚建的客户（分段导入后几趟别把前几趟建的当成「已有」） */
export async function 读导入查重索引(不算: ReadonlySet<string> = new Set()): Promise<导入查重索引> {
  const [客户们, 客户WA, 联系人们, 子表号] = await 看全部(async () =>
    Promise.all([
      prisma.customer.findMany({ select: { id: true, name: true, phone: true } }),
      prisma.customerExtra.findMany({ where: { whatsapp: { not: null } }, select: { customerId: true, whatsapp: true } }),
      prisma.contact.findMany({ select: { customerId: true, phone: true } }),
      prisma.contactMethod.findMany({ where: { kind: { in: ["phone", "landline", "whatsapp"] } }, select: { customerId: true, value: true } }),
    ]),
  );
  const 算的 = 客户们.filter((c) => !不算.has(c.id));
  const 客户名 = new Map<string, string[]>();
  for (const c of 算的) {
    const k = 名键(c.name);
    if (!k) continue;
    const a = 客户名.get(k);
    if (a) a.push(c.id);
    else 客户名.set(k, [c.id]);
  }
  const 归档号 = 归档号索引(new Set(算的.map((c) => c.id)), [
    // 企业版客户没有电话（E-260）：不比客户电话格，号都在联系人主表 / 子表上
    ...(企业版() ? [] : 算的.map((c) => ({ v: c.phone, customerId: c.id }))),
    ...客户WA.map((x) => ({ v: x.whatsapp, customerId: x.customerId })),
    ...联系人们.map((c) => ({ v: c.phone, customerId: c.customerId })),
    ...子表号.map((x) => ({ v: x.value, customerId: x.customerId })),
  ]);
  return { 客户名, 客户号: new Map(), 归档号 };
}

/**
 * 回收站里的号（企业版，P-删-08 导入查重也算回收站里的号码；审核 11-18 P1-3：设置 → 企业版导入原来只比在用的）：
 * 删了的客户的电话 / WhatsApp / 名下联系人 / 子表号，加上在用客户名下删了的联系人的电话和子表号，按 归档号键 规整（同 归档号索引 的口径）。
 * 回收站过了 30 天清掉的就不在了，自然不算。不是企业版 = 空
 */
export async function 读回收站号键(): Promise<Set<string>> {
  if (!企业版()) return new Set();
  const 删了的 = { deletedAt: { not: null } };
  const [客户们, 客户WA, 联系人们, 子表号] = await 看已删(() => 看全部(async () =>
    Promise.all([
      prisma.customer.findMany({ where: 删了的, select: { phone: true } }),
      prisma.customerExtra.findMany({ where: { whatsapp: { not: null }, customer: 删了的 }, select: { whatsapp: true } }),
      prisma.contact.findMany({ where: { OR: [删了的, { customer: 删了的 }] }, select: { phone: true } }),
      prisma.contactMethod.findMany({
        where: { kind: { in: ["phone", "landline", "whatsapp"] }, OR: [{ customer: 删了的 }, { contact: 删了的 }] },
        select: { value: true },
      }),
    ]),
  ));
  const 键们 = new Set<string>();
  for (const v of [...(企业版() ? [] : 客户们.map((c) => c.phone)), ...客户WA.map((x) => x.whatsapp), ...联系人们.map((c) => c.phone), ...子表号.map((x) => x.value)]) {
    const k = 归档号键(v);
    if (k) 键们.add(k);
  }
  return 键们;
}
