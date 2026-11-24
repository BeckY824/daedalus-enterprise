/**
 * 新建客户时交来的号（企业版建好记到主联系人，E-260）的全公司查重。
 *
 * 原来这里还有客户「电话」格就地改、清空、客户本身号码几行的读库规矩（11-17）：E-260 客户没有电话这一说法
 * （客户「客户没有电话这一说法」），客户详情的电话格、号码几行都删了，那几样（客户还有别的联系方式、同步电话子表、电话子表键们）跟着删；
 * 号码一律在联系人上，改号走联系人卡。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import type { 谁 } from "@/lib/team-scope";
import { 全公司查号, 回收站里查号, 回收站里有提示, 撞号结论 } from "./contact-dedupe";

type 库 = Prisma.TransactionClient | typeof prisma;

/**
 * 号码全公司查重：联系人的号、子表（手机 / 座机 / WhatsApp 共用号键），排除这位客户自己（他自己的联系人也不算撞）。
 * 在用的撞了说首条那位（同建档向导的提示）；在用的没撞再看回收站。都没撞回 null（团队版同事那边调用方另问）
 */
export async function 客户电话撞号(db: 库, customerId: string | undefined, 号: { 值: string; 键: string }, 我: string, 读的我: 谁 | null): Promise<string | null> {
  if (!号.值 || !号.键) return null;
  const ids = await 全公司查号(db, "手机号", 号.值, 号.键, customerId);
  // 子表里挂在回收站客户上的行也会查出 id，首条认不出（看不到删了的）= 在用的没撞，往下看回收站
  const 论 = ids.length ? await 撞号结论(db, ids, 我, 读的我) : null;
  if (论 && 论.状态 !== "首次录入") return `手机号 ${号.值}：${论.提示}`;
  if ((await 回收站里查号(db, "手机号", 号.值, 号.键, customerId)).length) return `手机号 ${号.值}：${回收站里有提示}`;
  return null;
}
