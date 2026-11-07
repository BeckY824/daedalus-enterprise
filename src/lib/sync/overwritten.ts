/**
 * 被同事盖掉的改动（2026-10-16 团队版全面检验 A 条，用户让做）。
 *
 * 两个人断网时（或几乎同时）改了同一位客户的同一格：同步按「谁后改」算（字段钟），这一点不变。
 * 但先改的那个人自己写的内容会悄悄变成同事的，设置页原来只写「推了 N 条、收到 N 条」，他根本不知道。
 * 现在回放时（local.ts 回放）发现这种情况就记一笔，设置 → 团队里提示「有 N 处你改的被同事后来的改动盖掉了」，
 * 把他原来写的给他看，需要的话自己改回去。只提示，不回滚。
 *
 * 什么算「同时改」：同事那一笔改在**我这一笔传上去之前**（或者我这笔还没传上去）——那时同事不可能看到我写的。
 * 我传上去以后同事才改的，是接着我的改，不提示（不然每次正常协作都冒一条）。我这一笔什么时候传上去的记在 _sync_push。
 *
 * 只记本人在这台电脑上改过的格子（字段钟是本机设备的）；时间戳那几列不算；值一样不算。
 * 记录挂在本机还看得到的记录上：清理失权副本、业务员离开团队时跟着清掉（不在这台留别人客户的内容）。
 */
import type { PrismaClient, Prisma } from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** 这几张表的改动才提示（人在界面上改的业务资料）；账号、设置、渠道这些不提 */
const 提示的表 = new Set(["Customer", "CustomerExtra", "Contact", "FollowUp", "Opportunity", "Contract", "Task", "FollowPlan", "Lead", "UnassignedContact"]);
const 不算的列 = new Set(["updatedAt", "createdAt", "activityAt", "lastFollowAt", "plannedHasTime", "dueHasTime"]);
const 最多存 = 500;

export async function 建被盖表(db: Db) {
  await db.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS _sync_overwritten (id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL, col TEXT NOT NULL, mine TEXT, theirs TEXT, mineAt BIGINT NOT NULL, theirAt BIGINT NOT NULL, createdAt BIGINT NOT NULL, seenAt BIGINT)");
  // 每次推送成功记一笔：推到第几条、什么时候（判断「同事改的时候我这笔传上去没有」）
  await db.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS _sync_push (upto INTEGER NOT NULL, at BIGINT NOT NULL)");
}

/** 推送成功之后调（local.ts 记已推）：只留最近 30 天 */
export async function 记推送时间(db: Db, 到: number) {
  await 建被盖表(db);
  const 现在 = Date.now();
  await db.$executeRawUnsafe("INSERT INTO _sync_push (upto, at) VALUES (?, ?)", 到, 现在);
  await db.$executeRawUnsafe("DELETE FROM _sync_push WHERE at < ?", 现在 - 30 * 86_400_000);
}

const 数 = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v ?? 0));
const 钟毫秒 = (h: string) => Number(h.split("-")[0]) || 0;

/**
 * 我这一格（本机字段钟 本机钟）是什么时候传上去的：还没传 = 无穷大；记不到（这台在有这张表之前就推过了）= null，不提示
 */
async function 传上去的时间(tx: Db, t: string, k: string, 本机钟: string): Promise<number | null> {
  const seq = (await tx.$queryRawUnsafe<{ seq: bigint | number }[]>("SELECT seq FROM _sync_log WHERE tbl = ? AND pk = ? AND at = ? ORDER BY seq DESC LIMIT 1", t, k, 钟毫秒(本机钟)))[0]?.seq;
  if (seq == null) return null;
  const 已推 = 数((await tx.$queryRawUnsafe<{ v: bigint }[]>("SELECT v FROM _sync_cursor WHERE k = 'pushed'"))[0]?.v);
  if (数(seq) > 已推) return Infinity;
  const at = (await tx.$queryRawUnsafe<{ at: bigint | number | null }[]>("SELECT MIN(at) AS at FROM _sync_push WHERE upto >= ?", 数(seq)))[0]?.at;
  return at == null ? null : 数(at);
}

/** 本机读出来的日期是 Date、开关可能是 true/false，同步来的是毫秒数、0/1：都换成后一种，才比得出「值一样」 */
const 存值 = (v: unknown) => (v == null ? null : String(v instanceof Date ? v.getTime() : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? Number(v) : v).slice(0, 500));

/**
 * 回放里要改的这几格：本机钟是我这台的、同事那笔改在我这笔传上去之前、值确实变了 → 记下（在回放的事务里调，改之前）
 */
export async function 记被盖(tx: Db, x: { t: string; k: string; 本机设备: string; 对方钟: string; 格: { c: string; 本机钟: string; 我的: unknown; 对方的: unknown }[] }) {
  if (!提示的表.has(x.t)) return;
  const 要记 = x.格.filter((g) => g.本机钟.endsWith(`-${x.本机设备}`) && !不算的列.has(g.c) && 存值(g.我的) !== 存值(g.对方的));
  if (!要记.length) return;
  await 建被盖表(tx);
  const 对方 = 钟毫秒(x.对方钟);
  for (const g of 要记) {
    const 传 = await 传上去的时间(tx, x.t, x.k, g.本机钟);
    if (传 == null || 对方 >= 传) continue;
    // 同一格还没看过的旧一条换成新的（来回被盖几次只留最后一次）
    await tx.$executeRawUnsafe("DELETE FROM _sync_overwritten WHERE tbl = ? AND pk = ? AND col = ? AND seenAt IS NULL", x.t, x.k, g.c);
    await tx.$executeRawUnsafe("INSERT INTO _sync_overwritten (tbl, pk, col, mine, theirs, mineAt, theirAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", x.t, x.k, g.c, 存值(g.我的), 存值(g.对方的), 钟毫秒(g.本机钟), 对方, Date.now());
  }
  await tx.$executeRawUnsafe(`DELETE FROM _sync_overwritten WHERE id NOT IN (SELECT id FROM _sync_overwritten ORDER BY id DESC LIMIT ${最多存})`);
}

export type 被盖条目 = { id: number; 表: string; 名称: string; 列: string; 我写的: string | null; 现在: string | null; 我改的时间: string; 同事改的时间: string; href: string | null };
const q = (s: string) => `"${s.replaceAll('"', '""')}"`;
const 主键列: Record<string, string> = { CustomerExtra: "customerId" };

/** 记录已经不在这台电脑上（失权清掉、离开团队）：它的被盖记录一起删，不留别人客户的内容 */
export async function 清掉不在的被盖(db: Db) {
  const 表们 = await db.$queryRawUnsafe<{ tbl: string }[]>("SELECT DISTINCT tbl FROM _sync_overwritten").catch(() => [] as { tbl: string }[]);
  for (const { tbl } of 表们) {
    if (!提示的表.has(tbl)) continue;
    const pk = 主键列[tbl] ?? "id";
    await db.$executeRawUnsafe(`DELETE FROM _sync_overwritten WHERE tbl = ? AND NOT EXISTS (SELECT 1 FROM ${q(tbl)} WHERE ${q(pk)} = _sync_overwritten.pk)`, tbl);
  }
}
