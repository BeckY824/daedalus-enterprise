/**
 * 客户页旧导入抽屉的查重索引（M-导入-29，企业版）：和迁移导入（report.ts 读本地索引）同一套号、同一个口径，
 * 交给 clean.ts 的 撞已有客户 去比。客户看全部（同事的、公海里的也算已有）；回收站里的不算（那条路另有 回收站里）。
 * 不给 客户号：抽屉的电话那格本来就按 认人表 整串认人，这里只补「WhatsApp / 座机 / 联系人 / 子表的号」和客户名，不足 10 位的号不比
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 名键, 归档号索引, type 本地索引 } from "./clean";

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
    ...算的.map((c) => ({ v: c.phone, customerId: c.id })),
    ...客户WA.map((x) => ({ v: x.whatsapp, customerId: x.customerId })),
    ...联系人们.map((c) => ({ v: c.phone, customerId: c.customerId })),
    ...子表号.map((x) => ({ v: x.value, customerId: x.customerId })),
  ]);
  return { 客户名, 客户号: new Map(), 归档号 };
}
