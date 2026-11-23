/**
 * 客户编号（2026-11-17，客户抬头 PR-1）：每位客户一个「NO.」+ 5 位的编号，抬头可以重名，唯一性只靠它。
 *
 * - 存在 Customer.customerNo（迁移 146，可空 + 唯一索引），页面上写成 客户编号文字(n)：NO.00001；过了 99999 照写全，不截。
 * - 取号只走 取客户编号：计数表 CustomerNoSeq（迁移 147）只有一行，一句 UPDATE … SET n = n + 1 RETURNING n。
 *   不用 max + 1：最新那位客户被彻底删掉（回收站 30 天后）下一位会拿到同一个号，违反「不复用」；多进程同时建也会撞。
 *   号一经发出就不改、不复用；取了号但建客户失败（事务回滚）的话这个号也跟着回滚——取号和建客户在同一个事务里。
 * - 建客户的入口全部经 带客户编号(db, data) 取号（tests/customer-no.test.ts 按源码钉着每一个 customer.create）；
 *   撤销导入建回的客户（enterprise-import/revert.ts）快照里带着原号就用原号，不另取。
 * - 计数表那一行：存量库由回填脚本（scripts/customer-no-backfill.mjs）按建档时间给老客户从 1 起补号、补完把计数推到最大号时建；
 *   回填之前取号拿不到号 → 新客户先空着（页面显示短号），回填时按建档时间一并补上。
 *   全新的库（一位客户都没有，全新安装、测试库）第一次取号时自己建这一行，从 1 起。
 */
import type { Prisma } from "@/generated/prisma";

/** 能跑裸 SQL 的客户端或事务 */
type 库 = { $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Prisma.PrismaPromise<T> };

/**
 * 短号：库里的 id 是 cuid（一长串），没有编号时（项目、回填前的客户）要显示「编号」就取 id 末 6 位、转大写，前面加 #。
 * 只为了看着能分开，不保证全局唯一（同一页上撞号的概率很小），也不能拿来查。原在 project/relate-names.ts，那边转导出
 */
export function 短号(id: string): string {
  const t = (id ?? "").trim();
  return t ? `#${t.slice(-6).toUpperCase()}` : "";
}

export const 客户编号前缀 = "NO.";
/** 编号写成几位：不足补 0（客户方答复示例「NO.01237」） */
export const 客户编号位数 = 5;

/** NO.00012；空的给 null（调用方显示短号或「—」） */
export function 客户编号文字(n: number | null | undefined): string | null {
  if (n == null || !Number.isInteger(n) || n <= 0) return null;
  return 客户编号前缀 + String(n).padStart(客户编号位数, "0");
}

/**
 * 关键词像一个客户编号（「NO.00123」「no 123」「00123」，全角也认）时给出编号数字，不像返回 null。
 * 带「NO.」前缀的几位都认；纯数字要够编号的位数（客户编号位数，页面上编号就写这么多位）才认：「00123」「29792」是编号，
 * 「123」「2024」这种短数字多半是年份、型号、号码片段，不当编号（11-23 复审：短数字会把同号的客户 / 重复咨询线索带出来）。
 * 纯数字和号码片段并行（都进 OR），编号是精确比，不会多搜出一片
 */
export function 看成客户编号(k: string): number | null {
  // 全角的字母、数字、点（「ＮＯ．００１２」）先转半角
  const m = /^(no\.?\s*)?(\d{1,9})$/i.exec(k.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim());
  if (!m || (!m[1] && m[2].length < 客户编号位数)) return null;
  const n = Number(m[2]);
  return n > 0 ? n : null;
}

export const 取号SQL = `UPDATE "CustomerNoSeq" SET "n" = "n" + 1 WHERE "id" = 1 RETURNING "n"`;
/** 计数行还没有、库里一位客户都没有：建这一行，第一个号是 1。并发时只有一个建得上，另一个 ON CONFLICT 什么都不做、回头再取号 */
const 起头SQL = `INSERT INTO "CustomerNoSeq" ("id", "n") SELECT 1, 1 WHERE NOT EXISTS (SELECT 1 FROM "Customer") ON CONFLICT ("id") DO NOTHING RETURNING "n"`;

const 数 = (rows: { n: number | bigint }[]) => (rows.length ? Number(rows[0].n) : null);

/**
 * 取下一个客户编号。和建客户放在同一个事务里调（传 tx）。
 * 计数行还没建（存量库没跑回填脚本）返回 null：这位客户先不编号，回填时一起补
 */
export async function 取客户编号(db: 库): Promise<number | null> {
  const n = 数(await db.$queryRawUnsafe<{ n: number | bigint }[]>(取号SQL));
  if (n !== null) return n;
  const 起 = 数(await db.$queryRawUnsafe<{ n: number | bigint }[]>(起头SQL));
  if (起 !== null) return 起;
  // 别的进程刚建上了那一行（或者库里本来就有客户、还没回填）：再取一次，还没有就是没回填
  return 数(await db.$queryRawUnsafe<{ n: number | bigint }[]>(取号SQL));
}

/**
 * 建客户的 data 补上编号：取一个新号；只有撤销导入建回（enterprise-import/revert.ts）给了原号时用原号。
 * 所有 customer.create 都过这里（tests/customer-no.test.ts 按源码钉着）。取不到号（存量库还没回填）就不带这一格
 */
export async function 带客户编号<T extends object>(db: 库, data: T, 原号?: unknown): Promise<T & { customerNo?: number }> {
  const customerNo = typeof 原号 === "number" && Number.isInteger(原号) && 原号 > 0 ? 原号 : await 取客户编号(db);
  return customerNo === null ? data : { ...data, customerNo };
}

/**
 * 页面上显示的编号：有编号写 NO.00012；回填前还没有编号的写短号（relate-names.ts 短号：#+ id 末 6 位），
 * 两样都没有（不会发生）给「—」
 */
export function 客户编号显示(c: { id: string; customerNo?: number | null }): string {
  return 客户编号文字(c.customerNo) ?? (短号(c.id) || "—");
}
