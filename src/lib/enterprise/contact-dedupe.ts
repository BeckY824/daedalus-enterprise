/**
 * 企业版建档的全公司号码查重（2026-10-26，测试清单 B8）。格式规矩在 lib/enterprise/contact-format.ts。
 *
 * 对方原来的系统建档先查号码：全公司不分谁名下、不分在客户上还是联系人上，撞到就不让建，并说清是哪种撞法。
 * 这里一律看全部（看全部 + 裸 SQL），撞到以后给人看的样子按 看得到 收（看不到的不给 id、名字、学校、建档时间），
 * 只留负责人名字：提示原文就是「可与 X 沟通核实」。
 *
 * 四种都比：手机号 / 邮箱 / 微信 / 旺旺 ID，内贸外贸一个库，「同类型、同规整值」算撞（规整值 = 验号码 的 键）。比哪几处：
 * - 联系方式子表 ContactMethod（migrations/054）：企业版建档写进来的，按 kind + numberKey 比。旺旺 ID 只在这里
 * - 老列（子表回填之前的数据都在这里，这一版两边都比）：
 *   手机号：客户的电话（同号条件，和 checkDuplicate 同一条；国内号多认一种带 86 的老写法）+ 联系人的电话（号键比）
 *   邮箱 / 微信：CustomerExtra 那两列（外贸查重比的就是它们）+ 联系人的邮箱 / 微信，去空格、不分大小写
 * 本机都没撞的，手机号 / 邮箱 / 微信再问一下团队版服务端（问同事，没开团队版当没撞），和原来的查重一样。
 * 撞了好几条的认「首条」：建档最早的那条（客户还没有编号，建档时间 + id 就是编号顺序），提示说首条的负责人，首条在公海的说公海待捞。
 *
 * B8 的七条提示做了四条：✅首次录入、⛔公海待捞、📒我的通讯录已有、号码重复（看得到的带客户名、本次录入已拦截、可与 X 沟通核实）。
 * 没做：「❎首次录入，但与 X 存在重复」（要按客户名查重，清单 A8 定了不做）；「📁请上传二维码图片」
 * 「🔀请选择号码类型」两条是格式那一半的（contact-format.ts）
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 号键 } from "@/lib/phone";
import { 号键SQL, 同号条件, 分机留存起 } from "@/lib/phone-dedupe";
import { 同邮箱条件, 同微信条件 } from "@/lib/email-dedupe";
import { 看全部, 看得到, 限定的我, 只读错误, type 谁 } from "@/lib/team-scope";
import { 问同事 } from "@/lib/sync/dedupe-client";
import { 查重提示, 验号码, type 号码类型 } from "./contact-format";
import { 号码归属地 } from "./phone-region";

/** ContactMethod.kind：号码类型 → 库里的写法。二维码没有号，不进子表 */
export const 号码库类型 = { 手机号: "phone", 邮箱: "email", 微信: "wechat", 旺旺ID: "wangwang" } as const satisfies Partial<Record<号码类型, string>>;
type 进子表的类型 = keyof typeof 号码库类型;
const 进子表 = (类型: 号码类型): 类型 is 进子表的类型 => 类型 in 号码库类型;

/** 验过格式的一个号（验号码 ok 的那种） */
export type 验好的号 = { 类型: 号码类型; 值: string; 键: string };

type 库 = Prisma.TransactionClient | typeof prisma;

/** 联系人表里号码对得上的客户 id。联系人的电话存的是人填的原样，按号键比；国内号顺带认带 86 的写法。回收站里的联系人不算（P9） */
async function 联系人里的(db: 库, 类型: "手机号" | "邮箱" | "微信", 键: string): Promise<string[]> {
  if (类型 === "手机号") {
    const 键们 = /^\d{11}$/.test(键) ? [键, `86${键}`] : [键];
    const 行 = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT DISTINCT "customerId" AS id FROM "Contact" WHERE "deletedAt" IS NULL AND ${号键SQL('"phone"')} IN (${键们.map(() => "?").join(", ")})`, ...键们);
    return 行.map((r) => r.id);
  }
  const 列 = 类型 === "邮箱" ? "email" : "wechat";
  const 行 = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT "customerId" AS id FROM "Contact" WHERE "deletedAt" IS NULL AND lower(trim("${列}")) = ?`, 键);
  return 行.map((r) => r.id);
}

/**
 * 号码撞到的客户 id（全公司，不分谁名下）。值 / 键 是 验号码 规整过的。除了 = 编辑时排除自己（现在只有新建用）。
 * db 传事务就在事务里查（查完再写）
 */
export async function 全公司查号(db: 库, 类型: 号码类型, 值: string, 键: string, 除了?: string): Promise<string[]> {
  const 客户条件 = async (): Promise<Prisma.CustomerWhereInput | null> => {
    if (类型 === "手机号") {
      // 国内号顺带认库里存成「+86 139…」的老写法（saveCustomer 存的是 11 位，导入 / 老数据不一定）
      const 起 = await 分机留存起();
      const 条件们 = [await 同号条件(db, 值, 起), ...(/^\d{11}$/.test(值) ? [await 同号条件(db, `86${值}`, 起)] : [])];
      return 条件们.length > 1 ? { OR: 条件们 } : 条件们[0];
    }
    if (类型 === "邮箱") return 同邮箱条件(db, 值);
    if (类型 === "微信") return 同微信条件(db, 值);
    return null;
  };
  const ids = new Set<string>();
  const 条件 = await 客户条件();
  if (条件) for (const c of await 看全部(async () => db.customer.findMany({ where: 条件, select: { id: true } }))) ids.add(c.id);
  if (类型 === "手机号" || 类型 === "邮箱" || 类型 === "微信") for (const id of await 联系人里的(db, 类型, 类型 === "手机号" ? 号键(值) : 键)) ids.add(id);
  if (进子表(类型) && 键) {
    for (const r of await db.contactMethod.findMany({ where: { kind: 号码库类型[类型], numberKey: 键 }, select: { customerId: true } })) ids.add(r.customerId);
  }
  if (除了) ids.delete(除了);
  return [...ids];
}

/** 给人看的撞到的那位：和 checkDuplicate 的 DuplicateHit 一个样子 */
export type 撞到的人 = { id: string | null; name: string | null; school: string | null; salesOwnerName: string; createdAt: string | null };

export type 查号结论 =
  | { 状态: "首次录入"; 提示: string; 撞: null }
  | { 状态: "公海待捞" | "我的通讯录已有" | "重复"; 提示: string; 撞: 撞到的人 };

/**
 * 撞到的 id → 提示。好几位都撞的认首条（建档最早、同一刻按 id）：首条在我名下 📒，在公海 ⛔公海待捞，否则说首条的负责人。
 * 我 = 当前登录的人（「我的通讯录」只算本人名下，下属的也算同事的）；读的我 = 看得到的范围（团队版 / 企业版的限定）
 */
export async function 撞号结论(db: 库, ids: string[], 我: string, 读的我: 谁 | null): Promise<查号结论> {
  if (!ids.length) return { 状态: "首次录入", 提示: 查重提示.首次录入, 撞: null };
  const 挑 = await 首条撞的(db, ids);
  if (!挑) return { 状态: "首次录入", 提示: 查重提示.首次录入, 撞: null };
  const 看得见 = 看得到(挑, 读的我);
  const 同事 = 挑.salesOwner?.name ?? "同事";
  const 撞: 撞到的人 = {
    id: 看得见 ? 挑.id : null,
    name: 看得见 ? 挑.name : null,
    school: 看得见 ? 挑.school : null,
    salesOwnerName: 同事,
    createdAt: 看得见 ? 挑.createdAt.toISOString() : null,
  };
  if (挑.salesOwnerId === 我 && !挑.pool) return { 状态: "我的通讯录已有", 提示: 查重提示.我的通讯录已有, 撞 };
  if (挑.pool) return { 状态: "公海待捞", 提示: 查重提示.公海待捞, 撞 };
  return { 状态: "重复", 提示: 查重提示.重复(同事, 撞.name), 撞 };
}

/**
 * 撞到的好几位里认哪一条（建档最早、同一刻按 id），不管看不看得到。
 * 只给服务端内部用（AI 建档撞了要给原负责人建待办，要原客户 id 和负责人 id），别原样交给前端
 */
export async function 首条撞的(db: 库, ids: string[]) {
  if (!ids.length) return null;
  const 们 = await 看全部(async () => db.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, school: true, createdAt: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, salesOwner: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1,
  }));
  return 们[0] ?? null;
}

/** 本机没撞的，再问一下团队版服务端（同 checkDuplicate）。旺旺 ID 服务端没有这一种，不问 */
export async function 问同事撞没撞(类型: 号码类型, 值: string): Promise<查号结论 | null> {
  const 种 = 类型 === "手机号" ? "phone" : 类型 === "邮箱" ? "email" : 类型 === "微信" ? "wechat" : null;
  if (!种) return null;
  const 撞 = await 问同事(种, 值);
  return 撞 ? { 状态: "重复", 提示: 查重提示.重复(撞.同事), 撞: { id: null, name: null, school: null, salesOwnerName: 撞.同事, createdAt: null } } : null;
}

/** 查重整套：全公司本机比一遍，没撞再问团队版服务端。向导的「查重」按钮和 saveCustomer 保存前都走这一个 */
export async function 企业号码查重(db: 库, 号: { 类型: 号码类型; 值: string; 键: string }, 我: string, 读的我: 谁 | null): Promise<查号结论> {
  const ids = await 全公司查号(db, 号.类型, 号.值, 号.键);
  if (ids.length) return 撞号结论(db, ids, 我, 读的我);
  return (await 问同事撞没撞(号.类型, 号.值)) ?? { 状态: "首次录入", 提示: 查重提示.首次录入, 撞: null };
}

/**
 * 记到哪位客户上，调用方必须说清（2026-10-28：函数自己挡越权，不靠入口）：
 * - 刚建的：同一笔事务里刚 create 出来的那位。不查范围——销售管理建档能指定别人当负责人，刚建好的可能不在自己能改的范围里
 * - 已有：库里本来就有的。先按「能改谁」（限定的我：自己 + 实线下属，虚线下属的不算）认一遍，不在范围里抛 只读错误、一行不写；
 *   在 看全部 里调 = 调用方明说不限，照记
 */
export type 记到 = { 刚建的: string } | { 已有: string };

async function 记到谁(tx: Prisma.TransactionClient, 到: 记到): Promise<string> {
  if ("刚建的" in 到) return 到.刚建的;
  const 我 = await 限定的我(prisma);
  if (!我) return 到.已有;
  const c = await tx.customer.findUnique({ where: { id: 到.已有 }, select: { salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } } } });
  if (!c || !看得到(c, 我)) throw new 只读错误("记不了号码：这位客户不在你能改的范围里");
  return 到.已有;
}

/**
 * 往联系方式子表里记一个号（企业版建档，事务里调）。同一位客户同类型同规整值已经有一行的不再加一行：
 * 那一行还没挂联系人、这次给了联系人的，挂上。手机号顺带记归属地（离线号段 / 国外按区号）
 */
export async function 记号码(tx: Prisma.TransactionClient, 到: 记到, contactId: string | null, 号: 验好的号): Promise<void> {
  if (!进子表(号.类型) || !号.键) return;
  const customerId = await 记到谁(tx, 到);
  const kind = 号码库类型[号.类型];
  const 有 = await tx.contactMethod.findFirst({ where: { customerId, kind, numberKey: 号.键 }, select: { id: true, contactId: true } });
  if (有) {
    if (contactId && !有.contactId) await tx.contactMethod.update({ where: { id: 有.id }, data: { contactId } });
    return;
  }
  const region = 号.类型 === "手机号" ? 号码归属地("手机号", 号.值)?.文字 ?? null : null;
  await tx.contactMethod.create({ data: { customerId, contactId, kind, value: 号.值, numberKey: 号.键, formatStatus: "ok", region } });
}

/** 联系人那一步的电话 / 邮箱 / 微信叫什么（提示前面带上，说清是哪一格撞了） */
const 联系人格 = [["phone", "手机号", "联系人电话"], ["email", "邮箱", "联系人邮箱"], ["wechat", "微信", "联系人微信"]] as const;

/** 同第一步 = 和建档选了号码类型的那个号同类型同规整值：saveCustomer 已经查过，不用再查，记子表时挂上联系人 */
export type 联系人的号 = 验好的号 & { 格: string; 同第一步: boolean };

/**
 * 建档向导联系人那一步填的号（企业版，QA #3「邮箱不去重」）：按类型验格式，空着的不管。格式不对返回一句带格名的提示
 */
export function 验联系人号码(联系人: { phone?: string | null; email?: string | null; wechat?: string | null }, 已查?: 验好的号 | null): 联系人的号[] | { error: string } {
  const 们: 联系人的号[] = [];
  for (const [列, 类型, 格] of 联系人格) {
    const 原 = 联系人[列];
    if (!原 || !原.trim()) continue;
    const r = 验号码(类型, 原);
    if (!r.ok) return { error: `${格}：${r.提示}` };
    们.push({ 类型: r.类型, 值: r.值, 键: r.键, 格, 同第一步: !!已查 && 已查.类型 === r.类型 && 已查.键 === r.键 });
  }
  return 们;
}

/** 事务里联系人的号撞了：抛出来整笔回滚，建档向导接住说人话 */
export class 联系人号码撞了 extends Error {
  constructor(readonly ids: string[], readonly 格: string) { super(`${格}撞号`); }
}

// ---------- 联系人号码查重（2026-10-29 P13 第 2 条） ----------

/** 撞到的那位联系人：客户看得到的给 id、名字（界面上点得进去）；看不到的只给负责人名字（同 撞号结论 的口径） */
export type 撞到的联系人 = {
  contactId: string | null;
  name: string | null;
  customerId: string | null;
  customerName: string | null;
  /** 主客户的销售负责人（看不到时提示「可与 X 沟通核实」） */
  同事: string;
  /** 撞的是哪一行：交上来的那行的 kind + 规整后的号 */
  kind: string;
  value: string;
};

/**
 * 联系人的几行号码（kind + 规整值，验联系人号码们 验好的）在全公司联系人里撞没撞：同类型同规整值算撞，不分谁名下。
 * 比两处：联系方式子表里挂在联系人身上的行（kind + numberKey，所有类型含自己加的）；子表回填之前的联系人老三格
 * （手机按号键、国内号顺带认带 86 的；邮箱 / 微信去空格不分大小写）。除了 = 编辑时排除自己。
 * 一位联系人只报一次（撞了好几个号的报第一个撞的号），按建档早的在前。不合并、不挡：拿到结果怎么办由调用方定
 */
export async function 联系人查重(
  db: 库,
  行们: readonly { kind: string; value: string; numberKey: string }[],
  读的我: 谁 | null,
  除了?: string,
): Promise<撞到的联系人[]> {
  const 们 = 行们.filter((x) => x.numberKey);
  if (!们.length) return [];
  const 撞 = new Map<string, { kind: string; value: string }>();
  const 记 = (contactId: string | null | undefined, 行: { kind: string; value: string }) => {
    if (contactId && contactId !== 除了 && !撞.has(contactId)) 撞.set(contactId, { kind: 行.kind, value: 行.value });
  };
  const 子表 = await db.contactMethod.findMany({
    where: { contactId: { not: null }, OR: 们.map((x) => ({ kind: x.kind, numberKey: x.numberKey })) },
    select: { contactId: true, kind: true, numberKey: true },
  });
  for (const 行 of 们) for (const r of 子表) if (r.kind === 行.kind && r.numberKey === 行.numberKey) 记(r.contactId, 行);
  for (const 行 of 们) {
    if (行.kind === "phone") {
      const 键们 = /^\d{11}$/.test(行.numberKey) ? [行.numberKey, `86${行.numberKey}`] : [行.numberKey];
      const rs = await db.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "Contact" WHERE ${号键SQL('"phone"')} IN (${键们.map(() => "?").join(", ")})`, ...键们);
      for (const r of rs) 记(r.id, 行);
    } else if (行.kind === "email" || 行.kind === "wechat") {
      const rs = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "Contact" WHERE lower(trim("${行.kind}")) = ?`, 行.numberKey);
      for (const r of rs) 记(r.id, 行);
    }
  }
  if (!撞.size) return [];
  const 人们 = await 看全部(async () => db.contact.findMany({
    where: { id: { in: [...撞.keys()] } },
    select: {
      id: true, name: true, createdAt: true,
      customer: { select: { id: true, name: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, salesOwner: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }));
  return 人们.map((p) => {
    const 见 = 看得到(p.customer, 读的我);
    const 号 = 撞.get(p.id)!;
    return {
      contactId: 见 ? p.id : null,
      name: 见 ? p.name : null,
      customerId: 见 ? p.customer.id : null,
      customerName: 见 ? p.customer.name : null,
      同事: p.customer.salesOwner?.name ?? "同事",
      kind: 号.kind,
      value: 号.value,
    };
  });
}

/** 撞到的联系人 → 一句话（保存被拦时的那一句；界面另按 撞了 摆成能点的链接） */
export function 联系人撞号话(撞: readonly 撞到的联系人[], 叫法: (kind: string) => string): string {
  const 头 = 撞[0];
  const 谁 = 头.name ? `「${头.name}」（${头.customerName}）` : `${头.同事}名下的一位联系人`;
  return `${叫法(头.kind)} ${头.value} 已经记在${谁}身上${撞.length > 1 ? `等 ${撞.length} 位` : ""}，本次没保存。可以把那位挂到这位客户上，或核对后改号码`;
}
