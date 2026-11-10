/**
 * 退回公海前查联系方式（11-05 用户：「只要有人要把手上的线索、商机或订单扔回去（比如退回公海），一定一定要先检查联系方式是否为空。
 * 如果不为空且正确的话，可以退；如果为空、不为空但错误，则都退不了。」「也包括客户联系人、项目」）。机制总表 M-公海-15。
 *
 * 查哪些（都是页面上看得到、自己改得了的号码）：
 *   1. 客户本身的「电话」（Customer.phone）：填了就要过 查电话（和客户页改电话同一套）；
 *   2. 这位客户名下每位联系人（没删的）的每个号码：按号码类型过 验一行号码（和联系人表单同一套）；
 *   3. 项目挂的联系人（主联系人 Project.contactId + 项目联系人表，可能是挂靠过来的别家联系人）：退项目时查这个项目的；
 *      退客户时查跟着一起进项目公海的那些项目（没结束、不在公海）的。
 * 一个号码都没有 → 退不了；有一个不对 → 退不了（「全部正确」才放行，不是「至少一个对」）。
 * 客户本身挂在 ContactMethod 上、contactId 为空的号码页面上不显示、改不了，不查。
 *
 * 谁都一样（所有角色）；只管手动退回：客户「放回公海」（单个、批量）、项目「放回项目公海」、线索验证「退回公海」。
 * 超时回收、离职交接、导入、撤销、跟着客户 / 项目一起进公海的、建项目向导「公海捞取」（分配放行）不走这里。
 */
import type { Prisma } from "@/generated/prisma";
import { 查电话 } from "@/lib/phone";
import { 验一行号码, type 号码种类 } from "./customer-v2";
import { 号码种类表, 种类叫法, 联系人号码们 } from "./customer-v2-db";

type 库 = Pick<Prisma.TransactionClient, "customer" | "project">;
type 种类表 = readonly 号码种类[];

export const 退回补号尾 = "，改好再退回公海";
export const 联系方式空话 = "联系方式是空的，先补上客户电话或联系人号码再退回公海";

/** 事务外先读号码类型字典（要读设置），再把表交给下面两个 */
export const 退回号码种类表 = 号码种类表;

type 联系人行 = { id: string; name: string; phone: string | null; email: string | null; wechat: string | null; contactMethods: { kind: string; value: string }[] };
const 联系人字段 = { id: true, name: true, phone: true, email: true, wechat: true, contactMethods: { select: { kind: true, value: true } } } as const;

const 带删 = { select: { ...联系人字段, deletedAt: true } } as const;
/** 项目挂的联系人：主联系人 + 项目联系人表（可能是挂靠过来的别家联系人） */
const 项目联系人 = { contact: 带删, contactLinks: { select: { contact: 带删 } } } as const;
type 带删行 = 联系人行 & { deletedAt: Date | null };
function 并进(们: Map<string, 联系人行>, p: { contact: 带删行 | null; contactLinks: { contact: 带删行 }[] }) {
  for (const c of [p.contact, ...p.contactLinks.map((x) => x.contact)]) if (c && !c.deletedAt && !们.has(c.id)) 们.set(c.id, c);
}

/** 一位联系人的号码：返回 [号码个数, 第一句错话] */
function 查联系人(表: 种类表, c: 联系人行): [number, string | null] {
  const 号们 = 联系人号码们(c, c.contactMethods);
  for (const 号 of 号们) {
    const 种 = 表.find((x) => x.kind === 号.kind) ?? { 名: 种类叫法(表, 号.kind), kind: 号.kind };
    // 查的是库里已有的号，占位号这条（P-全局-06）管的是新填，这里照旧放过
    const r = 验一行号码(种, 号.value, { 放过占位: true });
    if (!r.ok) return [号们.length, `联系人「${c.name || "未注明"}」的${r.error}${退回补号尾}`];
  }
  return [号们.length, null];
}

/** 客户电话 + 一串联系人：没错没空返回 null */
function 判(phone: string, 联系人们: readonly 联系人行[], 表: 种类表): string | null {
  let 个数 = 0;
  const 电 = phone.trim();
  if (电) {
    个数++;
    const r = 查电话(电, { 必填: true, 放过占位: true });
    if (!r.ok) return `客户电话「${电}」不对：${r.error}${退回补号尾}`;
  }
  for (const c of 联系人们) {
    const [n, 错] = 查联系人(表, c);
    if (错) return 错;
    个数 += n;
  }
  return 个数 ? null : 联系方式空话;
}

/** 客户放回公海前：每位客户 → 退不了的那句话（能退的不在里面） */
export async function 客户退回前查联系方式(db: 库, customerIds: readonly string[], 表: 种类表): Promise<Map<string, string>> {
  const 错们 = new Map<string, string>();
  if (!customerIds.length) return 错们;
  const 客户们 = await db.customer.findMany({
    where: { id: { in: [...customerIds] } },
    select: {
      id: true, phone: true,
      contacts: { where: { deletedAt: null }, select: 联系人字段 },
      // 跟着客户一起进项目公海的那些项目（没结束、不在公海）挂的联系人也算
      projects: { where: { pooledAt: null, result: null, deletedAt: null }, select: 项目联系人 },
    },
  });
  for (const c of 客户们) {
    const 们 = new Map<string, 联系人行>(c.contacts.map((x) => [x.id, x]));
    for (const p of c.projects) 并进(们, p);
    const 错 = 判(c.phone ?? "", [...们.values()], 表);
    if (错) 错们.set(c.id, 错);
  }
  return 错们;
}

/** 项目放回公海前：客户电话 + 客户名下联系人 + 项目挂的联系人（去重）。能退返回 null */
export async function 项目退回前查联系方式(db: 库, projectId: string, 表: 种类表): Promise<string | null> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: {
      ...项目联系人,
      customer: { select: { phone: true, contacts: { where: { deletedAt: null }, select: 联系人字段 } } },
    },
  });
  if (!p) return null;
  const 们 = new Map<string, 联系人行>(p.customer.contacts.map((c) => [c.id, c]));
  并进(们, p);
  return 判(p.customer.phone ?? "", [...们.values()], 表);
}
