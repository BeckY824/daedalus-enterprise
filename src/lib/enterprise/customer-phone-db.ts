/**
 * 客户「电话」和客户本身的号码（联系方式子表里 contactId 空的那几行）的服务端规矩（11-17 员工反馈）。
 *
 * 原来客户页「电话」走的是宽松的 查电话（lib/phone.ts）：贴进微信号会截出里面的数字存成手机号、6 位乱数也收、
 * 原来有号就清不掉；而建档向导、联系人表单走的是严格的 验号码。现在企业版客户电话也走 验号码 手机号那一套（验客户电话），这里放读库的几样：
 *   客户还有别的联系方式 —— 清空电话 / 删客户本身的号前看：清了以后还剩一个对的联系方式才放（M-必填-01 联系方式必填）
 *   同步电话子表 —— 电话换了、清了：子表里客户本身那行旧号删掉，新号记上（带归属地），同导入 apply.ts
 *   客户电话撞号 —— 全公司查重（客户电话、联系人、子表；排除这位自己），在用的没撞再看回收站
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部, type 谁 } from "@/lib/team-scope";
import { 验号码 } from "./contact-format";
import { 验一行号码, 联系人号查重键, type 号码种类 } from "./customer-v2";
import { 号码种类表, 种类叫法, 联系人号码们 } from "./customer-v2-db";
import { 全公司查号, 回收站里查号, 回收站里有提示, 撞号结论, 记号码 } from "./contact-dedupe";

type 库 = Prisma.TransactionClient | typeof prisma;

export const 清空电话拦话 = "清空后这位客户就没有任何联系方式了：先在联系人或号码里补一个，再清空电话";
export const 删光号码拦话 = "删完后这位客户就没有任何联系方式了：先在联系人里补一个号码，或留一个号码";

/** 电话那格存的号在子表里可能记成的键：新口径（验号码 的 键）+ 老口径（联系人号查重键），删旧行时都认 */
export function 电话子表键们(phone: string | null | undefined): string[] {
  const s = (phone ?? "").trim();
  if (!s) return [];
  const 们 = new Set<string>();
  const r = 验号码("手机号", s, { 放过占位: true });
  if (r.ok) 们.add(r.键);
  const k = 联系人号查重键("phone", s);
  if (k) 们.add(k);
  return [...们];
}

/** 一行号码按它的种类验得过（占位号不算对）。种类表里没有的（自定的被删了）按叫法轻校验 */
function 对的(表: readonly 号码种类[], kind: string, value: string): boolean {
  const 种 = 表.find((x) => x.kind === kind) ?? { 名: 种类叫法(表, kind), kind };
  return 验一行号码(种, value).ok;
}

/**
 * 不算「电话」那一格，这位客户还有没有一个对的联系方式（M-必填-01）：名下联系人（没删的）的号、客户本身子表里的号。
 * 去掉 = 这次要删掉的客户本身那几行（kind + numberKey），不算进去。电话那格对应的子表行一律不算（电话就是要清的那个）
 */
export async function 客户还有别的联系方式(db: 库, customerId: string, 去掉: readonly { kind: string; numberKey: string }[] = [], 算电话 = false): Promise<boolean> {
  const 表 = await 号码种类表();
  const c = await 看全部(() => db.customer.findUnique({
    where: { id: customerId },
    select: {
      phone: true,
      contacts: { where: { deletedAt: null }, select: { phone: true, email: true, wechat: true, contactMethods: { select: { kind: true, value: true } } } },
      contactMethods: { where: { contactId: null }, select: { kind: true, value: true, numberKey: true } },
    },
  }));
  if (!c) return false;
  const 电话键 = new Set(电话子表键们(c.phone));
  if (算电话 && c.phone.trim() && 对的(表, "phone", c.phone)) return true;
  for (const 行 of c.contactMethods) {
    if (行.kind === "phone" && 电话键.has(行.numberKey)) continue;
    if (去掉.some((x) => x.kind === 行.kind && x.numberKey === 行.numberKey)) continue;
    if (对的(表, 行.kind, 行.value)) return true;
  }
  for (const 人 of c.contacts) {
    for (const 号 of 联系人号码们(人, 人.contactMethods)) if (对的(表, 号.kind, 号.value)) return true;
  }
  return false;
}

/** 电话换了 / 清了（事务里调）：子表里客户本身那行旧号删掉（联系人挂着的那行留给联系人），新号记上、带归属地。同导入（apply.ts 改） */
export async function 同步电话子表(tx: Prisma.TransactionClient, customerId: string, 旧: string | null | undefined, 新: string | null | undefined): Promise<void> {
  const 旧键 = 电话子表键们(旧);
  if (旧键.length) await tx.contactMethod.deleteMany({ where: { customerId, contactId: null, kind: "phone", numberKey: { in: 旧键 } } });
  const s = (新 ?? "").trim();
  if (!s) return;
  const r = 验号码("手机号", s, { 放过占位: true });
  if (r.ok) await 看全部(() => 记号码(tx, { 已有: customerId }, null, r));
}

/**
 * 客户电话全公司查重：客户电话、联系人的号、子表（手机 / 座机 / WhatsApp 共用号键），排除这位客户自己（他自己的联系人也不算撞）。
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
