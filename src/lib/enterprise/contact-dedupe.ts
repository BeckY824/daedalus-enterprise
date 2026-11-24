/**
 * 企业版建档的全公司号码查重（2026-10-26，测试清单 B8）。格式规矩在 lib/enterprise/contact-format.ts。
 *
 * 对方原来的系统建档先查号码：全公司不分谁名下、不分在客户上还是联系人上，撞到就不让建，并说清是哪种撞法。
 * 这里一律看全部（看全部 + 裸 SQL），撞到以后给人看的样子按 看得到 收（看不到的不给 id、名字、学校、建档时间），
 * 只留负责人名字：提示原文就是「可与 X 沟通核实」。
 *
 * 四种都比：手机号 / 邮箱 / 微信 / 旺旺 ID，内贸外贸一个库。原来「同类型、同规整值」算撞（规整值 = 验号码 的 键）；
 * 11-20 起号码不分类型、全公司唯一（客户原话「无论什么样的号码类型，号码必须是唯一值，全局查重」）：同类型的照下面比，
 * 再按 跨类键 和所有类型的号比一遍（微信填了手机号、邮箱和微信同一串都算撞），见 跨类查。同类型那几处：
 * - 联系方式子表 ContactMethod（migrations/054）：企业版建档写进来的，按 kind + numberKey 比。旺旺 ID 只在这里
 * - 老列（子表回填之前的数据都在这里，这一版两边都比）：
 *   手机号：联系人的电话（号键比）。客户的电话格不比（E-260 客户没有电话，数据脚本已挪到主联系人）
 *   邮箱 / 微信：CustomerExtra 那两列（外贸查重比的就是它们）+ 联系人的邮箱 / 微信，去空格、不分大小写
 * 本机都没撞的，手机号 / 邮箱 / 微信再问一下团队版服务端（问同事，没开团队版当没撞），和原来的查重一样。
 * 撞了好几条的认「首条」：建档最早的那条（客户还没有编号，建档时间 + id 就是编号顺序），提示说首条的负责人，首条在公海的说公海待捞。
 *
 * 回收站里的也算撞（客户 11-05（X-10），防删了再用同号重建）：本机在用的都没撞，再看回收站（删了还没过 30 天的客户 / 联系人），
 * 撞了拦下、叫人找系统管理员恢复（状态「回收站里有」，提示原文是我们拟的）。在用的撞了照旧按在用的说，回收站只在在用的都没撞时才查。
 *
 * B8 的七条提示做了四条：✅首次录入、⛔公海待捞、📒我的通讯录已有、号码重复（看得到的带客户名、本次录入已拦截、可与 X 沟通核实）。
 * 没做：「❎首次录入，但与 X 存在重复」（要按客户名查重，清单 A8 定了不做）；「📁请上传二维码图片」
 * 「🔀请选择号码类型」两条是格式那一半的（contact-format.ts）
 */
import type { Prisma } from "@/generated/prisma";
import { 负责人显示名 } from "@/lib/pool";
import { prisma, defaultClient } from "@/lib/prisma";
import { 号键 } from "@/lib/phone";
import { 号键SQL } from "@/lib/phone-dedupe";
import { 同邮箱条件, 同微信条件 } from "@/lib/email-dedupe";
import { 看全部, 看得到, 限定的我, 只读错误, 现在的公海回避, type 谁 } from "@/lib/team-scope";
import { 公海客户原负责人是 } from "@/lib/owner-log-db";
import { 问同事 } from "@/lib/sync/dedupe-client";
import { 查重提示, 验号码, type 号码类型 } from "./contact-format";
import { 通号种类, 号键变体, 通号键, 撞号怎么办, 回收站话, 联系人显名 } from "./customer-v2";
import { 全角转半角 } from "@/lib/fullwidth";
import { 号码归属地 } from "./phone-region";
import { 拦原负责人 } from "./pool-rules";
import { 离职负责人找谁 } from "./departed-owner";
import { 看已删, 在看已删 } from "./soft-delete-core";

import { 全称或显名, 显名列 } from "@/lib/enterprise/customer-title";
/** ContactMethod.kind：号码类型 → 库里的写法。二维码没有号，不进子表 */
export const 号码库类型 = { 手机号: "phone", 邮箱: "email", 微信: "wechat", 旺旺ID: "wangwang" } as const satisfies Partial<Record<号码类型, string>>;
/** 反过来：ContactMethod.kind → 号码类型（只有这四类走建档查重、能当客户的企业号码；座机、WhatsApp 这些没有） */
export const 库类型到号码类型: Readonly<Record<string, 号码类型 | undefined>> = Object.fromEntries(Object.entries(号码库类型).map(([t, k]) => [k, t as 号码类型]));
type 进子表的类型 = keyof typeof 号码库类型;
const 进子表 = (类型: 号码类型): 类型 is 进子表的类型 => 类型 in 号码库类型;

/** 验过格式的一个号（验号码 ok 的那种） */
export type 验好的号 = { 类型: 号码类型; 值: string; 键: string };

type 库 = Prisma.TransactionClient | typeof prisma;

/**
 * 联系人表里号码对得上的客户 id。联系人的电话存的是人填的原样，按号键比；国内号顺带认带 86 的写法。
 * 回收站里的联系人不算（P9）；包在 看已删 里（回收站里查号）连回收站里的一起算——裸 SQL 不经过软删扩展，这里自己认
 */
async function 联系人里的(db: 库, 类型: "手机号" | "邮箱" | "微信", 键: string): Promise<string[]> {
  const 未删 = 在看已删() ? "" : `"deletedAt" IS NULL AND `;
  if (类型 === "手机号") {
    const 键们 = /^\d{11}$/.test(键) ? [键, `86${键}`] : [键];
    const 行 = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT DISTINCT "customerId" AS id FROM "Contact" WHERE ${未删}${号键SQL('"phone"')} IN (${键们.map(() => "?").join(", ")})`, ...键们);
    return 行.map((r) => r.id);
  }
  const 列 = 类型 === "邮箱" ? "email" : "wechat";
  const 行 = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT "customerId" AS id FROM "Contact" WHERE ${未删}lower(trim("${列}")) = ?`, 键);
  return 行.map((r) => r.id);
}

/**
 * 号码撞到的客户 id（全公司，不分谁名下）。值 / 键 是 验号码 规整过的。除了 = 编辑时排除自己（现在只有新建用）。
 * db 传事务就在事务里查（查完再写）
 */
export async function 全公司查号(db: 库, 类型: 号码类型, 值: string, 键: string, 除了?: string): Promise<string[]> {
  /*
    客户本身没有电话（E-260，客户「客户没有电话这一说法」）：不再比客户的电话格（数据脚本已把客户电话挪到主联系人、清空），
    手机号只比联系人、子表；邮箱 / 微信照旧比客户档案那两格
  */
  const 客户条件 = async (): Promise<Prisma.CustomerWhereInput | null> => {
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
  // 座机、WhatsApp 和手机共用号键（11-17）：子表里这两类同号的也算撞（老行的键可能还带着 86，见 号键变体）
  if (类型 === "手机号" && 键) {
    for (const r of await db.contactMethod.findMany({ where: { kind: { in: [...通号种类] }, numberKey: { in: 号键变体(键) } }, select: { customerId: true } })) ids.add(r.customerId);
  }
  // 不分类型（11-20）：这个号记成了别的类型（微信格里的手机号、档案邮箱格里的微信号……）也算撞
  const 跨 = await 跨类查(db, 值);
  for (const id of [...跨.客户, ...跨.联系人.values()]) ids.add(id);
  if (除了) ids.delete(除了);
  return [...ids];
}

// ---------- 跨类型查重（11-20：号码不分类型，全公司唯一） ----------

/** 像电话的：只有数字和 + - ( ) . 这些分隔符，数字 5–20 位（同座机、WhatsApp 的位数） */
function 像电话(s: string): boolean {
  if (!/^\+?[\d\-()（）.－—–]+$/.test(s)) return false;
  const n = s.replace(/\D/g, "").length;
  return n >= 5 && n <= 20;
}

/**
 * 跨类型比的键（11-20）：全角转半角（数字、字母、＋、．、＠）、去掉所有空白、转小写、去掉开头的 @（Telegram 用户名的写法）；
 * 像电话的再按 通号键 规整（+86 / 0086 去掉、+86 区号座机换回 0 开头、国外号去掉 +），和手机号的键（验号码 的 键）同一个空间；别的就是这一串。
 * 两边都只拿原值算这一个键（不用各类型自己的键：自定类型的键去了分隔符，拿它比会一头查得到一头查不到）。
 * 电话 = 是不是按电话规整的（电话那一路还要认库里带 86 的老写法，见 号键变体）
 */
export function 跨类键(原: string): { 键: string; 电话: boolean } {
  const s = 全角转半角(原).replace(/\s+/g, "").toLowerCase().replace(/^@+/, "");
  if (!s) return { 键: "", 电话: false };
  return 像电话(s) ? { 键: 通号键(s), 电话: true } : { 键: s, 电话: false };
}

/** 号码子表里 numberKey 不等于 跨类键 的几类（Telegram 键去了 @、自定类型键去了分隔符）：跨类型比的时候按 value 现算 */
const 按原值比的种类SQL = `("kind" = 'telegram' OR ("kind" >= 'custom:' AND "kind" < 'custom;'))`;

const 占位 = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/**
 * 跨类型查重的几句裸 SQL（导出给用例看查询计划，tests/ent-contact-dedupe.test.ts）。客户、档案那几句不带回收站条件：
 * 「deletedAt IS NULL」、「customerId IN (没删的客户)」一加，SQLite 就改走 deletedAt 索引、表达式索引不用了（审查实测 85–165ms），
 * 查出来以后再按客户删没删滤（滤回收站）
 */
export const 跨类SQL = {
  /**
   * 客户档案邮箱 / 微信 / 阿里国际站ID 原样比：走 048 的三个表达式索引。拆成三句 UNION（写成一句 OR，SQLite 整表扫，13ms）；
   * 阿里国际站ID 在 c2 上全空，ANALYZE 的统计让它那句走整表（约 4ms），不强指索引（老库没有 048 时 INDEXED BY 会报错）
   */
  档案原样: (n: number) =>
    (["email", "wechat", "alibabaId"] as const).map((列) => `SELECT "customerId" AS id FROM "CustomerExtra" WHERE lower(trim("${列}")) IN (${占位(n)})`).join(" UNION "),
  /** 客户档案微信格、WhatsApp 格按号键比（只有像电话的号查；带分隔符的老写法也认）：走 156 的号键索引 */
  档案号键: (n: number) =>
    (["wechat", "whatsapp"] as const).map((列) => `SELECT "customerId" AS id FROM "CustomerExtra" WHERE ${号键SQL(`"${列}"`)} IN (${占位(n)})`).join(" UNION "),
  /**
   * 联系人电话、微信格（像电话的号）：电话按号键走 142 的 Contact_phoneKey_idx；微信格先原样比、带分隔符的老写法再按号键比
   * （联系人表几千行，整表比约 1ms，不另建索引）。也不带回收站条件（带上就改走 deletedAt 索引），查出来再滤
   */
  联系人号键: (号键n: number, 原样n: number) =>
    `SELECT "id", "customerId", "deletedAt" FROM "Contact" WHERE ${号键SQL('"phone"')} IN (${占位(号键n)}) UNION ` +
    `SELECT "id", "customerId", "deletedAt" FROM "Contact" WHERE lower(trim("wechat")) IN (${占位(原样n)}) OR ("wechat" GLOB '*[^0-9a-zA-Z_@.]*' AND ${号键SQL('"wechat"')} IN (${占位(号键n)}))`,
} as const;

/**
 * 跨类型撞到的（11-20）：号码不分类型，和全公司所有类型的号比，只按 跨类键 比（两边同一个规整）。
 * - 客户 = 号记在客户本身上的：档案（CustomerExtra）的邮箱 / 微信 / 阿里国际站ID / WhatsApp、子表里没挂联系人的行
 *   （客户电话格不比：E-260 客户没有电话，数据脚本已挪到主联系人；回收站里的客户没挪，连回收站查时比它们的电话格，审查单 A-4a）
 * - 联系人 = 号记在联系人身上的（联系人 id → 客户 id）：联系人老三格、子表里挂了联系人的行
 * 子表按 numberKey 比（Telegram、自定类型按 value 现算）；老列像电话的按号键比（库里带空格、横杠、+86 的写法都认），别的去空格不分大小写。
 * 裸 SQL 自己认回收站（同 联系人里的：包在 看已删 里连回收站一起算）；子表走 db（企业版 prisma 的软删层滤掉父行删了的，
 * defaultClient 不滤、调用方自己滤，同 联系人查重）
 */
async function 跨类查(db: 库, 值: string): Promise<{ 客户: Set<string>; 联系人: Map<string, string> }> {
  const 客户 = new Set<string>();
  const 联系人 = new Map<string, string>();
  const k = 跨类键(值);
  if (!k.键) return { 客户, 联系人 };
  const 删 = 在看已删();
  /** 电话那一路的几种键（含带 86 的老键） */
  const 电话 = k.电话 ? 号键变体(k.键) : [];
  /** 号键SQL 比的写法（号键SQL 把 + 去掉了）：再认 00 国际前缀 */
  const 号键们 = [...new Set([...电话, ...电话.map((x) => `00${x}`)])];
  /** 原样（去首尾空格、小写）比的写法：电话的 + 和 00 开头的也认 */
  const 原样们 = k.电话 ? [...new Set([...电话, ...电话.map((x) => `+${x}`), ...电话.map((x) => `00${x}`)])] : [k.键];

  // 1. 子表：numberKey 就是 跨类键 的那几类走 (kind, numberKey) 索引；Telegram、自定类型按 value 现算（kind 范围走同一个索引）
  for (const r of await db.contactMethod.findMany({
    where: { numberKey: { in: 原样们 }, kind: { not: "telegram" }, NOT: { kind: { startsWith: "custom:" } } },
    select: { customerId: true, contactId: true },
  })) {
    if (r.contactId) 联系人.set(r.contactId, r.customerId);
    else 客户.add(r.customerId);
  }
  const 按原值 = k.电话
    ? { 式: `${号键SQL('"value"')} IN (${占位(号键们.length)})`, 参: 号键们 }
    : { 式: `ltrim(lower(replace(replace(trim("value"), ' ', ''), '　', '')), '@') = ?`, 参: [k.键] };
  for (const r of await db.$queryRawUnsafe<{ customerId: string; contactId: string | null }[]>(
    `SELECT "customerId", "contactId" FROM "ContactMethod" WHERE ${按原值比的种类SQL} AND ${按原值.式}`, ...按原值.参)) {
    if (r.contactId) 联系人.set(r.contactId, r.customerId);
    else 客户.add(r.customerId);
  }

  // 2. 联系人老三格：像电话的按号键走索引；文字号整表比（联系人表几千行）
  const 人 = k.电话
    ? { sql: 跨类SQL.联系人号键(号键们.length, 原样们.length), 参: [...号键们, ...原样们, ...号键们] }
    : {
        sql: `SELECT "id", "customerId", "deletedAt" FROM "Contact" WHERE lower(trim("email")) = ? OR lower(trim("wechat")) = ? OR lower(${号键SQL('"phone"')}) = ?`,
        参: [k.键, k.键, k.键],
      };
  for (const r of await db.$queryRawUnsafe<{ id: string; customerId: string; deletedAt: unknown }[]>(人.sql, ...人.参)) {
    if (删 || r.deletedAt == null) 联系人.set(r.id, r.customerId);
  }

  // 3. 客户档案（CustomerExtra）：邮箱 / 微信 / 阿里国际站ID 原样比（048 的索引）；像电话的再按号键比微信格（带分隔符的老写法）和 WhatsApp（156 的索引）。
  //    不在 SQL 里滤回收站（见 跨类SQL），查出来再按客户删没删滤
  const 档ids = new Set((await db.$queryRawUnsafe<{ id: string }[]>(跨类SQL.档案原样(原样们.length), ...原样们, ...原样们, ...原样们)).map((r) => r.id));
  if (k.电话) for (const r of await db.$queryRawUnsafe<{ id: string }[]>(跨类SQL.档案号键(号键们.length), ...号键们, ...号键们)) 档ids.add(r.id);
  if (档ids.size && !删) {
    const 留 = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "Customer" WHERE "id" IN (${占位(档ids.size)}) AND "deletedAt" IS NULL`, ...档ids);
    档ids.clear();
    for (const r of 留) 档ids.add(r.id);
  }
  for (const id of 档ids) 客户.add(id);

  // 4. 回收站里的客户电话格（审查单 A-4a）：数据脚本只把在用客户的电话挪到主联系人，删了的客户 Customer.phone 还留着。
  //    只在连回收站一起查（看已删）时比、只比删了的：在用客户照 E-260 不比电话格。删了的客户不多，按 deletedAt 索引筛完再比号键
  if (删 && k.电话) {
    for (const r of await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "Customer" WHERE "deletedAt" IS NOT NULL AND ${号键SQL('"phone"')} IN (${占位(号键们.length)})`, ...号键们)) 客户.add(r.id);
  }
  return { 客户, 联系人 };
}

/**
 * 一行号码（联系方式子表的 kind + 规整值）全公司撞到的客户 id（11-17：客户本身的号码几行）。
 * 手机 / 邮箱 / 微信 / 阿里国际站ID 走 全公司查号；别的类型（座机、WhatsApp、传真、Telegram、自定的）比子表里同类同键的行，
 * 再按 跨类键 和所有类型的号比（11-20）。除了 = 排除这位客户
 */
export async function 一行号全公司查(db: 库, 行: { kind: string; value: string; numberKey: string }, 除了?: string): Promise<string[]> {
  if (!行.numberKey) return [];
  const 类型 = 库类型到号码类型[行.kind];
  if (类型) return 全公司查号(db, 类型, 行.value, 行.numberKey, 除了);
  // 座机、WhatsApp 和手机共用号键：按手机号那套比（客户电话、联系人电话、子表里的手机 / 座机 / WhatsApp）
  if (通号种类.has(行.kind)) return 全公司查号(db, "手机号", 通号当电话(行.numberKey), 行.numberKey, 除了);
  const ids = new Set((await db.contactMethod.findMany({ where: { kind: 行.kind, numberKey: { in: 号键变体(行.numberKey) } }, select: { customerId: true } })).map((r) => r.customerId));
  // 不分类型（11-20）：和所有类型的号比
  const 跨 = await 跨类查(db, 行.value || 行.numberKey);
  for (const id of [...跨.客户, ...跨.联系人.values()]) ids.add(id);
  if (除了) ids.delete(除了);
  return [...ids];
}

/** 一行号码（任何类型）只在回收站里撞到的客户 id（11-20 跨类型；同 回收站里查号）：连回收站一起查一遍，去掉在用的 */
export async function 一行号回收站查(db: 库, 行: { kind: string; value: string; numberKey: string }, 除了?: string): Promise<string[]> {
  const 全 = await 看已删(() => 一行号全公司查(db, 行, 除了));
  if (!全.length) return [];
  const 在用 = new Set(await 一行号全公司查(db, 行, 除了));
  return 全.filter((id) => !在用.has(id));
}

/** 通号键 → 拿去和客户电话比的写法：大陆手机、0 开头的座机原样，别的（国外号）前面补 + */
const 通号当电话 = (键: string): string => (/^1[3-9]\d{9}$/.test(键) || 键.startsWith("0") ? 键 : `+${键}`);

/**
 * 号码只在回收站里撞到的客户 id（客户 11-05（X-10））：连回收站一起查一遍，去掉在用的那些。
 * 剩下的 = 删了的客户；或客户还在、带这个号的联系人删了。回收站过了 30 天清掉的就不再算
 */
export async function 回收站里查号(db: 库, 类型: 号码类型, 值: string, 键: string, 除了?: string): Promise<string[]> {
  const 全 = await 看已删(() => 全公司查号(db, 类型, 值, 键, 除了));
  if (!全.length) return [];
  const 在用 = new Set(await 全公司查号(db, 类型, 值, 键, 除了));
  return 全.filter((id) => !在用.has(id));
}

/**
 * 客户还在、带这个号的联系人删了：回收站里那几位联系人的 id（查重捞回用，soft-delete.ts）。
 * 联系人自己的电话 / 邮箱 / 微信对得上的，加上号码子表里挂在这位联系人名下的
 */
export async function 回收站里带号的联系人(db: 库, 号: 验好的号, 客户ids: string[]): Promise<string[]> {
  if (!客户ids.length) return [];
  const ids = new Set<string>();
  const 在 = `"customerId" IN (${客户ids.map(() => "?").join(", ")})`;
  if (号.类型 === "手机号") {
    const 键 = 号键(号.值);
    const 键们 = /^\d{11}$/.test(键) ? [键, `86${键}`] : [键];
    for (const r of await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "Contact" WHERE "deletedAt" IS NOT NULL AND ${在} AND ${号键SQL('"phone"')} IN (${键们.map(() => "?").join(", ")})`, ...客户ids, ...键们)) ids.add(r.id);
  } else if (号.类型 === "邮箱" || 号.类型 === "微信") {
    const 列 = 号.类型 === "邮箱" ? "email" : "wechat";
    for (const r of await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "Contact" WHERE "deletedAt" IS NOT NULL AND ${在} AND lower(trim("${列}")) = ?`, ...客户ids, 号.键)) ids.add(r.id);
  }
  if (进子表(号.类型) && 号.键) {
    const kind = 号码库类型[号.类型];
    const 挂的 = await 看已删(() => db.contactMethod.findMany({ where: { kind, numberKey: 号.键, customerId: { in: 客户ids }, contactId: { not: null } }, select: { contactId: true } }));
    const 删了的 = await 看已删(() => db.contact.findMany({ where: { id: { in: 挂的.map((r) => r.contactId!) }, deletedAt: { not: null } }, select: { id: true } }));
    for (const r of 删了的) ids.add(r.id);
  }
  // 不分类型（11-20）：号记成别的类型的联系人（微信格里存的手机号……）也捞回
  const 跨 = await 看已删(() => 跨类查(db, 号.值));
  const 候 = [...跨.联系人].filter(([, 客]) => 客户ids.includes(客)).map(([id]) => id);
  if (候.length) for (const r of await 看已删(() => db.contact.findMany({ where: { id: { in: 候 }, deletedAt: { not: null } }, select: { id: true } }))) ids.add(r.id);
  return [...ids];
}

/**
 * 联系人表单的号（审核 11-18 新建入口 P2-6，P-删-08）：在用的都没撞时，回收站里撞了的第一行。
 * 任何类型都查（11-20 起都拦），
 * 回 捞回键 要的 类型 + 值（查号码 / 从回收站捞回 认的写法）。回收站里也没有回 null
 */
export async function 联系人回收站撞(db: 库, 行们: readonly { kind: string; value: string; numberKey: string }[]): Promise<{ 类型: 号码类型; 值: string } | null> {
  for (const 行 of 行们) {
    if (!行.numberKey) continue;
    // 一行号回收站查：任何类型都和所有类型的号比（11-20），撞了一律拦
    if (!(await 一行号回收站查(db, 行)).length) continue;
    return 捞回用的号(行);
  }
  return null;
}

/**
 * 回收站撞了的这一行，拿去「从回收站捞回」用哪个 类型 + 值（捞回认 验号码 的四类，查重跨类型，认哪类都捞得到同一批）：
 * 手机 / 邮箱 / 微信 / 旺旺按本类；座机、WhatsApp 和别的类型里像电话的按手机号；别的（Telegram 用户名、自定类型的串）
 * 挑第一个验得过的（微信 → 邮箱 → 旺旺）；都验不过的照样拦，类型按微信给（捞回那一步会说格式不对，叫人找系统管理员）
 */
function 捞回用的号(行: { kind: string; value: string; numberKey: string }): { 类型: 号码类型; 值: string } {
  const 本类 = 库类型到号码类型[行.kind];
  if (本类) return { 类型: 本类, 值: 行.value };
  const 跨 = 跨类键(行.value || 行.numberKey);
  if (通号种类.has(行.kind)) return { 类型: "手机号", 值: 通号当电话(行.numberKey) };
  if (跨.电话) return { 类型: "手机号", 值: 通号当电话(跨.键) };
  const 原 = (行.value || 行.numberKey).trim().replace(/^@+/, "");
  for (const 类型 of ["微信", "邮箱", "旺旺ID"] as const) {
    const r = 验号码(类型, 原);
    if (r.ok) return { 类型, 值: r.值 };
  }
  return { 类型: "微信", 值: 原 };
}
/** 联系人表单撞了回收站里的号：拦下，提示里给「从回收站捞回」 */
export const 联系人回收站撞话 = 回收站话(false);

/** 回收站里撞了的提示（客户 11-05（X-10）；11-05 客户回复「可以捞回且只有查重触发时可以捞回」，原文是我们拟的） */
export const 回收站里有提示 = "这个号码在回收站里，本次录入已拦截，可以从回收站捞回";

/** 在用的没撞、回收站里撞了：拦下，提示里给「从回收站捞回」（查重捞回，soft-delete.ts）；回收站里也没有回 null。不给客户名、id（回收站里的不在列表里，点不进去） */
export async function 回收站撞没撞(db: 库, 号: 验好的号): Promise<查号结论 | null> {
  const ids = await 回收站里查号(db, 号.类型, 号.值, 号.键);
  if (!ids.length) return null;
  return { 状态: "回收站里有", 提示: 回收站里有提示, 撞: { id: null, name: null, school: null, salesOwnerName: "系统管理员", createdAt: null } };
}

/** 给人看的撞到的那位：和 checkDuplicate 的 DuplicateHit 一个样子 */
export type 撞到的人 = {
  id: string | null; name: string | null; school: string | null; salesOwnerName: string; createdAt: string | null;
  /** 负责人已离职（11-03 C4-5）：该找谁（他在职的直属上级，没有就「系统管理员」）。在职的没有这格 */
  负责人已离职找?: string;
};

export type 查号结论 =
  | { 状态: "首次录入"; 提示: string; 撞: null }
  | { 状态: "我的通讯录已有" | "重复"; 提示: string; 撞: 撞到的人 }
  /** 在用的没撞、回收站里撞了（客户 11-05（X-10））：撞 只有「系统管理员」这个名字，没有客户名、id */
  | { 状态: "回收站里有"; 提示: string; 撞: 撞到的人 }
  /** 原负责人是我 = 我自己放回（或被收回）公海的、企业版原负责人领不回也看不到：向导不给「打开它」「去领取」（11-03 B7-3） */
  | { 状态: "公海待捞"; 提示: string; 撞: 撞到的人; 原负责人是我?: true };

/**
 * 撞到的 id → 提示。好几位都撞的认首条（建档最早、同一刻按 id）：首条在我名下 📒，在公海 ⛔公海待捞，否则说首条的负责人。
 * 我 = 当前登录的人（「我的通讯录」只算本人名下，下属的也算同事的）；读的我 = 看得到的范围（团队版 / 企业版的限定）
 */
export async function 撞号结论(db: 库, ids: string[], 我: string, 读的我: 谁 | null): Promise<查号结论> {
  if (!ids.length) return { 状态: "首次录入", 提示: 查重提示.首次录入, 撞: null };
  const 挑 = await 首条撞的(db, ids);
  if (!挑) return { 状态: "首次录入", 提示: 查重提示.首次录入, 撞: null };
  const 看得见 = 看得到(挑, 读的我);
  const 同事 = 负责人显示名(挑.salesOwner?.name ?? "同事");
  const 撞: 撞到的人 = {
    id: 看得见 ? 挑.id : null,
    // 全称选填（11-19）：查重提示里叫 全称或显名（有全称照旧写全称，没全称兜简称 → 客户编号），不出空白
    name: 看得见 ? 全称或显名(挑) : null,
    school: 看得见 ? 挑.school : null,
    salesOwnerName: 同事,
    createdAt: 看得见 ? 挑.createdAt.toISOString() : null,
  };
  if (挑.salesOwnerId === 我 && !挑.pool) return { 状态: "我的通讯录已有", 提示: 查重提示.我的通讯录已有, 撞 };
  if (挑.pool) return { 状态: "公海待捞", 提示: 查重提示.公海待捞, 撞, ...((await 我回避的(db, 挑, 我)) ? { 原负责人是我: true as const } : {}) };
  const 找谁 = await 离职负责人找谁(挑.salesOwnerId);
  if (找谁) return { 状态: "重复", 提示: 查重提示.重复离职(找谁, 撞.name), 撞: { ...撞, 负责人已离职找: 找谁 } };
  return { 状态: "重复", 提示: 查重提示.重复(同事, 撞.name), 撞 };
}

/**
 * 这位公海客户是不是我退的、我领不回也看不到（11-03 B7-3）：和 team-scope 公海回避 同一套——负责人是我，或在我的回避名单里；
 * 名单过上限（null）时照回避的退路，看有没有我退的公海项目；客户例外里的（最近一次不是我）不算
 */
export async function 我回避的(db: 库, 挑: { id: string; salesOwnerId: string | null }, 我: string): Promise<boolean> {
  if (!拦原负责人()) return false;
  if (挑.salesOwnerId === 我) return true;
  if ((await 看全部(() => 公海客户原负责人是(db, [我], [挑.id]))).size) return true;
  const 避 = await 现在的公海回避(defaultClient);
  if (!避 || 避.本人 !== 我) return false;
  if (避.客户) return 避.客户.includes(挑.id);
  if (避.客户例外?.includes(挑.id)) return false; // 早先退过、最近一次不是我（X-76）
  return 看全部(async () => !!(await db.project.findFirst({ where: { customerId: 挑.id, pooledAt: { not: null }, logs: { some: { kind: "pool-release", fromOwnerId: 我 } } }, select: { id: true } })));
}

/**
 * 撞到的好几位里认哪一条（建档最早、同一刻按 id），不管看不看得到。
 * 只给服务端内部用（AI 建档撞了要给原负责人建待办，要原客户 id 和负责人 id），别原样交给前端
 */
export async function 首条撞的(db: 库, ids: string[]) {
  if (!ids.length) return null;
  const 们 = await 看全部(async () => db.customer.findMany({
    where: { id: { in: ids } },
    select: { ...显名列, school: true, createdAt: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, salesOwner: { select: { name: true } } },
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

/**
 * 查重整套：全公司本机在用的比一遍，没撞看回收站（客户 11-05（X-10）），再没撞问团队版服务端。
 * 向导的「查重」按钮、建档向导联系人那一步、saveCustomer 保存前都走这一个
 */
export async function 企业号码查重(db: 库, 号: { 类型: 号码类型; 值: string; 键: string }, 我: string, 读的我: 谁 | null): Promise<查号结论> {
  const ids = await 全公司查号(db, 号.类型, 号.值, 号.键);
  if (ids.length) return 撞号结论(db, ids, 我, 读的我);
  return (await 回收站撞没撞(db, 号)) ?? (await 问同事撞没撞(号.类型, 号.值)) ?? { 状态: "首次录入", 提示: 查重提示.首次录入, 撞: null };
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
  /** 撞的是别的客户本身的号（客户电话、客户本身的号码几行，11-17），不是联系人：contactId、name 空 */
  客户本身?: true;
};

/**
 * 联系人的几行号码（kind + 规整值，验联系人号码们 验好的）在全公司联系人里撞没撞：同类型同规整值算撞，不分谁名下；
 * 11-20 起再按 跨类键 和所有类型的号比（跨类查）。
 * 比两处：联系方式子表里挂在联系人身上的行（kind + numberKey，所有类型含自己加的）；子表回填之前的联系人老三格
 * （手机按号键、国内号顺带认带 86 的；邮箱 / 微信去空格不分大小写）。除了 = 编辑时排除自己。
 * 一位联系人只报一次（撞了好几个号的报第一个撞的号），按建档早的在前。不合并、不挡：拿到结果怎么办由调用方定
 */
export async function 联系人查重(
  db: 库,
  行们: readonly { kind: string; value: string; numberKey: string }[],
  读的我: 谁 | null,
  除了?: string,
  /** 正在给哪位客户存联系人：这位客户本身子表里的号（contactId 空的行，数据脚本挪完后没有了）不算撞；客户电话格不再比（E-260） */
  除了客户?: string,
): Promise<撞到的联系人[]> {
  const 们 = 行们.filter((x) => x.numberKey);
  if (!们.length) return [];
  const 撞 = new Map<string, { kind: string; value: string }>();
  const 记 = (contactId: string | null | undefined, 行: { kind: string; value: string }) => {
    if (contactId && contactId !== 除了 && !撞.has(contactId)) 撞.set(contactId, { kind: 行.kind, value: 行.value });
  };
  /*
    同一个号键空间（11-17）：手机、座机、WhatsApp 互相比（键按 通号键，老行的键可能还带着 86，见 号键变体）；别的类型同类同键
  */
  const 通 = (kind: string) => kind === "phone" || 通号种类.has(kind);
  const 比的种类 = (kind: string) => (通(kind) ? ["phone", ...通号种类] : [kind]);
  const 子表 = await db.contactMethod.findMany({
    where: { OR: 们.map((x) => ({ kind: { in: 比的种类(x.kind) }, numberKey: { in: 号键变体(x.numberKey) } })) },
    select: { contactId: true, customerId: true, kind: true, numberKey: true },
  });
  /** 撞到的别的客户本身的号：客户 id → 撞的那行 */
  const 客户撞 = new Map<string, { kind: string; value: string }>();
  const 记客户 = (customerId: string, 行: { kind: string; value: string }) => {
    if (customerId !== 除了客户 && !客户撞.has(customerId)) 客户撞.set(customerId, { kind: 行.kind, value: 行.value });
  };
  for (const 行 of 们) {
    for (const r of 子表) {
      if (!比的种类(行.kind).includes(r.kind) || !号键变体(行.numberKey).includes(r.numberKey)) continue;
      if (r.contactId) 记(r.contactId, 行);
      else 记客户(r.customerId, 行);
    }
  }
  for (const 行 of 们) {
    if (通(行.kind)) {
      const 键们 = 号键变体(行.numberKey);
      const rs = await db.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "Contact" WHERE ${号键SQL('"phone"')} IN (${键们.map(() => "?").join(", ")})`, ...键们);
      for (const r of rs) 记(r.id, 行);
      // 客户电话格不比（E-260 客户没有电话）：原来这里比客户电话，本客户自己电话格的号放行（X-159 那条豁免）随之没了
    } else if (行.kind === "email" || 行.kind === "wechat") {
      const rs = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "Contact" WHERE lower(trim("${行.kind}")) = ?`, 行.numberKey);
      for (const r of rs) 记(r.id, 行);
    }
  }
  // 不分类型（11-20）：和所有类型的号比（联系人微信格填了别人的手机号、别的客户档案里的邮箱 / 微信……）
  for (const 行 of 们) {
    const 跨 = await 跨类查(db, 行.value || 行.numberKey);
    for (const contactId of 跨.联系人.keys()) 记(contactId, 行);
    for (const customerId of 跨.客户) 记客户(customerId, 行);
  }
  if (!撞.size && !客户撞.size) return [];
  if (!撞.size) return 客户撞了(db, 客户撞, 读的我);
  // 回收站里的联系人、挂在回收站里客户上的不算在用（db 多半是不过限定层的 defaultClient，软删不会自动滤；回收站另走 联系人回收站撞）
  const 人们 = await 看全部(async () => db.contact.findMany({
    where: { id: { in: [...撞.keys()] }, deletedAt: null, customer: { deletedAt: null } },
    select: {
      id: true, name: true, createdAt: true,
      customer: { select: { ...显名列, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, salesOwner: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }));
  const 联系人们 = 人们.map((p) => {
    const 见 = 看得到(p.customer, 读的我);
    const 号 = 撞.get(p.id)!;
    return {
      contactId: 见 ? p.id : null,
      name: 见 ? p.name : null,
      customerId: 见 ? p.customer.id : null,
      customerName: 见 ? 全称或显名(p.customer) : null,
      同事: 负责人显示名(p.customer.salesOwner?.name ?? "同事"),
      kind: 号.kind,
      value: 号.value,
    };
  });
  /*
    撞到的联系人就挂在那位客户上的：说联系人就够了，不再另报客户本身。按真 id 去重、在抹掉看不到的 id 之前（3703 实操 #384：
    原来拿抹过的 customerId 比，看不到的客户 id 成了 null，同一位看不到的客户（联系人和客户本身同号）黄条列两行）
  */
  for (const p of 人们) 客户撞.delete(p.customer.id);
  const 客户们 = 客户撞.size ? await 客户撞了(db, 客户撞, 读的我) : [];
  return [...联系人们, ...客户们];
}

/** 撞到的别的客户本身的号 → 给人看的样子（看得到的给客户 id、名字；看不到的只给负责人名字）。回收站里的客户不在里面 */
async function 客户撞了(db: 库, 客户撞: Map<string, { kind: string; value: string }>, 读的我: 谁 | null): Promise<撞到的联系人[]> {
  const 们 = await 看全部(async () => db.customer.findMany({
    where: { id: { in: [...客户撞.keys()] }, deletedAt: null },
    select: { ...显名列, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, salesOwner: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }));
  return 们.map((c) => {
    const 见 = 看得到(c, 读的我);
    const 号 = 客户撞.get(c.id)!;
    return {
      contactId: null, name: null,
      customerId: 见 ? c.id : null, customerName: 见 ? 全称或显名(c) : null,
      同事: 负责人显示名(c.salesOwner?.name ?? "同事"),
      kind: 号.kind, value: 号.value, 客户本身: true as const,
    };
  });
}

/**
 * 撞到的联系人 → 一句话（保存被拦时的那一句；界面另按 撞了 摆成能点的链接）。
 * 这位客户 = 正在给哪位客户存联系人：撞到的就在这位客户上时不再叫人「挂到这位客户上」（11-03 测试 B7-6）
 */
export function 联系人撞号话(撞: readonly 撞到的联系人[], 叫法: (kind: string) => string, 这位客户?: string, 能挂 = false): string {
  const 头 = 撞[0];
  const 谁 = 头.客户本身
    ? (头.customerName ? `客户「${头.customerName}」本身` : `${头.同事}名下的一位客户本身`)
    : 头.contactId ? `「${联系人显名(头.name)}」（${头.customerName}）` : `${头.同事}名下的一位联系人`;
  // 后半句同联系人框黄条（撞号怎么办）：能挂 = 新建（编辑没有挂过来这条路），且撞到的里有看得到的别家联系人才提
  return `${叫法(头.kind)} ${头.value} 已经记在${谁}身上${撞.length > 1 ? `等 ${撞.length} 位` : ""}，本次没保存。${撞号怎么办(撞, 这位客户, 能挂)}`;
}
