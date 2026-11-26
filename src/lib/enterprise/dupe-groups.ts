/**
 * 疑似重复清单（12-15 第三批 C，P-合并-06；客户 E-331 行 31、E-363 四③④）：同名客户不自动并，出一张清单，逐组点「合并」或「不是同一个人」。
 *
 * 成组：只按客户名（全称）的 名键（enterprise-import/clean.ts：空白、全半角、大小写不算），名键不足两个字的不比（同 dupe-ledger 够长）；
 * 号码相同的建档时已拦、导入已跳过（M-导入-29），这里不看号。两家业务线都填了且不同（内贸 / 外贸）的不算一对（同 customer-merge 拦的原因）。
 * 标了「不是同一个人」的一对（CustomerNotDupe，撤销了的不算）不再算一对；一组里一对都不剩就不列。
 *
 * 谁看哪些（E-363 四③）：负责人只看自己名下有份的组——只算有一家是我负责、不在公海的那几对；系统管理员看全部。
 * 不另开上级视图（销售管理、条线总管理不看下属的组）。两家都在公海的那对（公海组，P-合并-07）下一单 D 才列，这里先不算。
 * 清单里以前建下的同名不补记撞号次数（E-363 四④）：这里只读，不写撞号台账。
 *
 * 写（标、撤）：只读角色、设了「只看某人」的只看不改；负责人只能标 / 撤自己名下有份的那几对。每次标、撤都在两家客户上各记一条操作日志（not-dupe / not-dupe-undo），
 * 撤销不删行，打上谁、何时撤的（迁移 177）。
 * 合并不在这里：清单上的「合并」开客户详情那只合并框（MergeHost），同事负责的那家走第二批合并申请，谁能并照旧在 customer-merge / merge-request 判。
 */
import type { PrismaClient } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 名键 } from "@/lib/enterprise-import/clean";
import { 客户编号文字 } from "@/lib/customer-no";
import type { 组织 } from "@/lib/enterprise/org-core";
import { 是系统管理员, 只读角色, 只看的人, 只读话of, 只看某人话 } from "@/lib/enterprise/permissions";

type 库 = PrismaClient;
export type 看的人 = { id: string; name?: string | null; role?: string | null };

/** 名键不足两个字的不比：撞得太多、多半不是同一位（同 dupe-ledger 够长） */
export const 够长 = (k: string) => k.length >= 2;
/** 一页几组 */
export const 每页组数 = 20;
/** 一次标「不是同一个人」最多几家（一组再多也是同名的几家，超了多半是传错） */
export const 一组最多 = 30;

/** 一对的编号：两个客户编号排好、用 __ 连（同 CustomerNotDupe.id） */
export function 对id(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export type 成员行 = { id: string; name: string; bizLine: string | null; salesOwnerId: string | null; 在公海: boolean; 建档: number };
export type 组 = { 键: string; 们: 成员行[]; 对们: string[] };

const 有值 = (v: string | null | undefined) => !!v && v.trim() !== "";
const 业务线冲突 = (a: 成员行, b: 成员行) => 有值(a.bizLine) && 有值(b.bizLine) && a.bizLine!.trim() !== b.bizLine!.trim();
/** 这位是不是我负责、不在公海的 */
const 我的 = (r: 成员行, 我: string) => !r.在公海 && r.salesOwnerId === 我;

/**
 * 成组（纯函数，测试直接调）：同名键的几家里，两两看是不是要列的一对——业务线不冲突、没标着「不是同一个人」、不是两家都在公海（D 再列）；
 * 不是系统管理员的只算有一家是我的那几对。一组只列出现在这些对里的几家，一对都不剩的组不列。
 * 组按组里最晚建档的那家倒排（新冒出来的重复先看），同一刻按名键
 */
export function 成组(行们: 成员行[], 标着: Set<string>, 看: { 管: boolean; 我: string }): 组[] {
  const 按键 = new Map<string, 成员行[]>();
  for (const r of 行们) {
    const k = 名键(r.name ?? "");
    if (!够长(k)) continue;
    const 们 = 按键.get(k);
    if (们) 们.push(r); else 按键.set(k, [r]);
  }
  const 出: 组[] = [];
  for (const [键, 们] of 按键) {
    if (们.length < 2) continue;
    const 对们: string[] = [];
    const 在 = new Set<string>();
    for (let i = 0; i < 们.length; i++) {
      for (let j = i + 1; j < 们.length; j++) {
        const a = 们[i], b = 们[j];
        if (a.在公海 && b.在公海) continue;
        if (业务线冲突(a, b)) continue;
        if (!看.管 && !我的(a, 看.我) && !我的(b, 看.我)) continue;
        const id = 对id(a.id, b.id);
        if (标着.has(id)) continue;
        对们.push(id); 在.add(a.id); 在.add(b.id);
      }
    }
    if (!对们.length) continue;
    出.push({ 键, 们: 们.filter((r) => 在.has(r.id)).sort((x, y) => x.建档 - y.建档 || (x.id < y.id ? -1 : 1)), 对们 });
  }
  const 最晚 = (g: 组) => Math.max(...g.们.map((r) => r.建档));
  return 出.sort((x, y) => 最晚(y) - 最晚(x) || (x.键 < y.键 ? -1 : x.键 > y.键 ? 1 : 0));
}

/** 裸 SQL 回的时间可能是毫秒数（bigint）也可能是字符串：一律转成毫秒 */
function 毫秒(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

type 裸行 = { id: string; name: string | null; bizLine: string | null; salesOwnerId: string | null; createdAt: unknown; inPool: number | bigint | boolean };
const 转行 = (r: 裸行): 成员行 => ({ id: r.id, name: r.name ?? "", bizLine: r.bizLine, salesOwnerId: r.salesOwnerId, 在公海: !!Number(r.inPool), 建档: 毫秒(r.createdAt) });
// 按 id 取的几家（标、撤、合并放行）不带 NOT INDEXED：走主键，别顺表扫（12-15 C 审查建议 9）；整表读才用 整表SQL
const 选列SQL = `SELECT c.id, c."name", c."bizLine", c."salesOwnerId", c."createdAt", EXISTS (SELECT 1 FROM "CustomerPool" p WHERE p."customerId" = c.id) AS inPool FROM "Customer" c`;
const 整表SQL = `SELECT c.id, c."name", c."bizLine", c."salesOwnerId", c."createdAt", EXISTS (SELECT 1 FROM "CustomerPool" p WHERE p."customerId" = c.id) AS inPool FROM "Customer" c NOT INDEXED WHERE c."deletedAt" IS NULL AND length(trim(c."name")) >= 2`;

/**
 * 名键底数据（id、全称、业务线、负责人、在不在公海、建档）的进程内短缓存：清单页、客户详情那一行提示、合并申请放行三处共用，
 * 不再每次整表扫一遍、把名字全取进 JS（12-15 C 审查建议 2、3）。失效看一句指纹：在用客户数 + 客户 max(updatedAt) + 公海行数 + 公海 max(at)
 * （改名、换负责人、新增、删除都动 updatedAt 或条数；进出公海动公海行数 / 时刻）。标着的对不在缓存里，每次现读（有索引、行少）。
 * 一个进程一份；指纹读完到底数据读完之间有人写，缓存的是更新的数据挂旧指纹，下一次指纹对不上会重读，不会读到比库旧的
 */
type 底 = { 行们: 成员行[]; 按id: Map<string, 成员行>; 按键: Map<string, 成员行[]> };
let 缓存: { 指纹: string; 底P: Promise<底> } | null = null;
/** 测试 / 导入脚本整库换数据后手动清（正常写入靠指纹自动失效） */
export function 忘掉疑似重复缓存() { 缓存 = null; }

async function 读指纹(db: 库): Promise<string> {
  const [r] = await db.$queryRawUnsafe<{ n: unknown; u: unknown; pn: unknown; pa: unknown }[]>(
    `SELECT (SELECT count(*) FROM "Customer" WHERE "deletedAt" IS NULL) AS n, (SELECT max("updatedAt") FROM "Customer") AS u, (SELECT count(*) FROM "CustomerPool") AS pn, (SELECT max("at") FROM "CustomerPool") AS pa`,
  );
  return [r?.n, r?.u, r?.pn, r?.pa].map((v) => String(v instanceof Date ? v.getTime() : v)).join("|");
}

async function 装底(db: 库): Promise<底> {
  const 行们 = (await db.$queryRawUnsafe<裸行[]>(整表SQL)).map(转行);
  const 按键 = new Map<string, 成员行[]>();
  for (const r of 行们) {
    const k = 名键(r.name);
    if (!够长(k)) continue;
    const 们 = 按键.get(k);
    if (们) 们.push(r); else 按键.set(k, [r]);
  }
  return { 行们, 按id: new Map(行们.map((r) => [r.id, r])), 按键 };
}

async function 读底(db: 库): Promise<底> {
  const 指纹 = await 读指纹(db);
  if (缓存?.指纹 === 指纹) return 缓存.底P;
  const 底P = 装底(db);
  const 这份 = { 指纹, 底P };
  缓存 = 这份;
  // 读失败不留着：下一次重读
  底P.catch(() => { if (缓存 === 这份) 缓存 = null; });
  return 底P;
}

/** 标着的对（没撤的）；给了客户 id 只取碰到这几家的 */
async function 标着的对(db: 库, ids?: string[]): Promise<Set<string>> {
  const 行 = await db.customerNotDupe.findMany({
    where: { undoneAt: null, ...(ids ? { OR: [{ customerId: { in: ids } }, { otherId: { in: ids } }] } : {}) },
    select: { id: true },
  });
  return new Set(行.map((r) => r.id));
}

export type 清单成员 = {
  id: string; 名: string; 编号: string | null; 负责人: string | null; 在公海: boolean; 我的: boolean;
  /** 建档时间（毫秒） */
  建档: number; 项目数: number;
  /** 清单上「合并」并进来那家要不要走第二批合并申请（同事负责的，系统管理员不用） */
  要申请: boolean;
};
export type 清单组 = { 键: string; 们: 清单成员[]; 留下: string; 并掉: string; 对们: string[]; 太多: boolean };
export type 清单页 = { 组们: 清单组[]; 共: number; 页: number; 每页: number; 管: boolean };

/**
 * 「合并」默认哪家留下、哪家并进来（框里还能「换一家」）：留下的先挑我负责的（系统管理员不挑）、不在公海的，再挑项目多的、建档早的；
 * 并进来的挑剩下里同样排第一的。服务端照旧按这两家重新判能不能并
 */
function 挑留并(们: 清单成员[], 管: boolean, 对们: string[]): { 留下: string; 并掉: string } {
  const 在对 = new Set(对们);
  const 分 = (m: 清单成员) => [m.在公海 ? 1 : 0, 管 || m.我的 ? 0 : 1, -m.项目数, m.建档];
  const 排 = [...们].sort((a, b) => {
    const x = 分(a), y = 分(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.id < b.id ? -1 : 1;
  });
  // 并进来那家只在和留下这家成对的里挑（不成对的合并框里服务端也不放行；12-15 C 审查建议 7）
  const 留 = 排[0];
  const 并 = 排.find((m) => m.id !== 留.id && 在对.has(对id(留.id, m.id))) ?? 排[1];
  return { 留下: 留.id, 并掉: 并.id };
}

/** 把几组的成员补上负责人名、编号、项目数 */
async function 补全(db: 库, 组们: 组[], 看: { 管: boolean; 我: string }): Promise<清单组[]> {
  const ids = [...new Set(组们.flatMap((g) => g.们.map((r) => r.id)))];
  if (!ids.length) return [];
  const [客户们, 项目数们] = await 看全部(() => Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, customerNo: true, salesOwner: { select: { name: true } } } }),
    db.project.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
  ]));
  const 客 = new Map(客户们.map((c) => [c.id, c]));
  const 数 = new Map(项目数们.map((p) => [p.customerId, p._count._all]));
  return 组们.map((g) => {
    const 们 = g.们.map((r): 清单成员 => {
      const c = 客.get(r.id);
      const 我 = 我的(r, 看.我);
      return {
        id: r.id, 名: r.name.trim(), 编号: 客户编号文字(c?.customerNo) ?? null, 负责人: r.在公海 ? null : c?.salesOwner?.name ?? null,
        在公海: r.在公海, 我的: 我, 建档: r.建档, 项目数: 数.get(r.id) ?? 0, 要申请: !看.管 && !我 && !r.在公海,
      };
    });
    return { 键: g.键, 们, ...挑留并(们, 看.管, g.对们), 对们: g.们.length > 一组最多 ? [] : g.对们, 太多: g.们.length > 一组最多 };
  });
}

const 看法of = (me: 看的人, org: 组织 | null) => ({ 管: 是系统管理员(me, org), 我: me.id });

/** 疑似重复清单的一页（页从 1 起；越界落到最后一页） */
export async function 疑似重复页(db: 库, me: 看的人, org: 组织 | null, 页 = 1): Promise<清单页> {
  const 看 = 看法of(me, org);
  const [底, 标着] = await Promise.all([读底(db), 标着的对(db)]);
  const 全 = 成组(底.行们, 标着, 看);
  const 末页 = Math.max(1, Math.ceil(全.length / 每页组数));
  const p = Math.min(Math.max(1, Math.floor(Number(页)) || 1), 末页);
  return { 组们: await 补全(db, 全.slice((p - 1) * 每页组数, p * 每页组数), 看), 共: 全.length, 页: p, 每页: 每页组数, 管: 看.管 };
}

/** 「已标」页签用：不成组，只带界面要的「管」（谁看全部）；待处理的组数那一项在这个页签上不写数（12-15 C 审查建议 3） */
export function 清单空页(me: 看的人, org: 组织 | null): 清单页 {
  return { 组们: [], 共: 0, 页: 1, 每页: 每页组数, 管: 看法of(me, org).管 };
}

/** 客户详情顶部那一行提示：这位客户在登录的人的清单里和几家同名（0 = 不提示）。读缓存里同名键那几家，不整库成组 */
export async function 本客户疑似重复数(db: 库, me: 看的人, org: 组织 | null, customerId: string): Promise<number> {
  const 底 = await 读底(db);
  const 这位 = 底.按id.get(customerId);
  if (!这位) return 0;
  const 行们 = 底.按键.get(名键(这位.name));
  if (!行们 || 行们.length < 2) return 0;
  const g = 成组(行们, await 标着的对(db, 行们.map((r) => r.id)), 看法of(me, org)).find((x) => x.们.some((r) => r.id === customerId));
  return g ? g.们.length - 1 : 0;
}

/**
 * 合并申请里「并进来那家我看不到」的放行：留下那家是我负责、不在公海，且按登录的人重新成组，两家在他清单上成对
 * （名键同、业务线不冲突、没标不是同一个人）。只回是不是，不带任何客户资料
 */
export async function 两家在我清单成对(db: 库, me: 看的人, org: 组织 | null, 留下id: string, 并掉id: string): Promise<boolean> {
  if (留下id === 并掉id) return false;
  const 底 = await 读底(db);
  const 留 = 底.按id.get(留下id), 并 = 底.按id.get(并掉id);
  if (!留 || !并) return false;
  const 行们 = [留, 并];
  if (!留 || !我的(留, me.id)) return false;
  if (new Set(行们.map((r) => 名键(r.name))).size !== 1) return false;
  const 对们 = 成组(行们, await 标着的对(db, [留下id, 并掉id]), 看法of(me, org)).flatMap((g) => g.对们);
  return 对们.includes(对id(留下id, 并掉id));
}

type 写结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function 能写(me: 看的人, org: 组织 | null): string | null {
  if (只读角色(me, org)) return 只读话of(me, org);
  if (只看的人(org, me.id)) return 只看某人话;
  return null;
}

/**
 * 标「不是同一个人」：传一组里的几家（清单上那一行），按登录的人重新成组，只标这几家之间、他清单上还列着的那几对
 * （负责人只标自己名下有份的，系统管理员全标）。一对都没有 = 回原因。两家客户上各记一条操作日志
 */
export async function 标不是同一个人(db: 库, me: 看的人, org: 组织 | null, ids: string[]): Promise<写结果<{ 对们: string[] }>> {
  const 不能 = 能写(me, org);
  if (不能) return { ok: false, error: 不能 };
  const 要 = [...new Set(ids)];
  if (要.length > 一组最多) return { ok: false, error: `同名超过 ${一组最多} 家，太多请逐家处理` };
  if (要.length < 2) return { ok: false, error: "参数不对，刷新再试" };
  const 现在 = new Date();
  // 读行、重判成组、写标记同在一个事务里：判完到写之间别人标过 / 改过名的，按事务里读到的为准（12-15 C 审查建议 8）
  const r = await db.$transaction(async (tx) => {
    const 行们 = (await tx.$queryRawUnsafe<裸行[]>(`${选列SQL} WHERE c."deletedAt" IS NULL AND c.id IN (${要.map(() => "?").join(",")})`, ...要)).map(转行);
    if (行们.length !== 要.length) return { ok: false as const, error: "有客户已经不在了（合并或删除），刷新再看" };
    if (new Set(行们.map((r) => 名键(r.name))).size !== 1) return { ok: false as const, error: "这几家名字已经不一样了，刷新再看" };
    const 标着 = new Set((await tx.customerNotDupe.findMany({
      where: { undoneAt: null, OR: [{ customerId: { in: 要 } }, { otherId: { in: 要 } }] }, select: { id: true },
    })).map((x) => x.id));
    const 对们 = 成组(行们, 标着, 看法of(me, org)).flatMap((g) => g.对们);
    if (!对们.length) return { ok: false as const, error: "这几家已经标过了，或者不是你名下的，刷新再看" };
    const 名 = new Map(行们.map((r) => [r.id, r.name.trim()]));
    for (const id of 对们) {
      const [a, b] = id.split("__");
      await tx.customerNotDupe.upsert({
        where: { id },
        create: { id, customerId: a, otherId: b, userId: me.id, at: 现在 },
        update: { userId: me.id, at: 现在, undoneAt: null, undoneById: null },
      });
      await tx.auditLog.createMany({
        data: [[a, b], [b, a]].map(([这, 那]) => ({
          userId: me.id, userName: me.name ?? "", action: "not-dupe", entity: "Customer", entityId: 这, at: 现在,
          summary: `疑似重复清单：标了和「${名.get(那) ?? ""}」不是同一个人`, detail: JSON.stringify({ pair: id, other: 那 }),
        })),
      });
    }
    return { ok: true as const, 对们 };
  });
  if (!r.ok) return r;
  const 对们 = r.对们;
  return { ok: true, 对们 };
}

/**
 * 撤销「不是同一个人」：不删行，打上谁、何时撤的，这一对重新列出来。只撤还标着的；负责人只能撤有一家是他负责、不在公海的那几对，系统管理员不限
 */
export async function 撤销不是同一个人(db: 库, me: 看的人, org: 组织 | null, 对们: string[]): Promise<写结果<{ 撤了: number }>> {
  const 不能 = 能写(me, org);
  if (不能) return { ok: false, error: 不能 };
  const 要 = [...new Set(对们)];
  if (!要.length || 要.length > 一组最多 * 一组最多) return { ok: false, error: "参数不对，刷新再试" };
  const 行 = await db.customerNotDupe.findMany({ where: { id: { in: 要 }, undoneAt: null }, select: { id: true, customerId: true, otherId: true } });
  const 管 = 是系统管理员(me, org);
  const 客户们 = await 看全部(() => db.customer.findMany({
    where: { id: { in: 行.flatMap((r) => [r.customerId, r.otherId]) } },
    select: { id: true, name: true, salesOwnerId: true, pool: { select: { customerId: true } } },
  }));
  const 客 = new Map(客户们.map((c) => [c.id, c]));
  const 是我的 = (id: string) => { const c = 客.get(id); return !!c && !c.pool && c.salesOwnerId === me.id; };
  const 能撤 = 行.filter((r) => 管 || 是我的(r.customerId) || 是我的(r.otherId));
  if (!能撤.length) return { ok: false, error: "没有能撤的标记（已经撤过，或者不是你名下的），刷新再看" };
  const 现在 = new Date();
  // 只撤还标着的：updateMany 带 undoneAt: null，别人刚撤过的 0 行、跳过不记日志（12-15 C 审查建议 8）。标着的对不进缓存，撤完不用清缓存
  let 撤了 = 0;
  await db.$transaction(async (tx) => {
    for (const r of 能撤) {
      const { count } = await tx.customerNotDupe.updateMany({ where: { id: r.id, undoneAt: null }, data: { undoneAt: 现在, undoneById: me.id } });
      if (count === 0) continue;
      撤了++;
      await tx.auditLog.createMany({
        data: [[r.customerId, r.otherId], [r.otherId, r.customerId]].map(([这, 那]) => ({
          userId: me.id, userName: me.name ?? "", action: "not-dupe-undo", entity: "Customer", entityId: 这, at: 现在,
          summary: `疑似重复清单：撤销了和「${客.get(那)?.name?.trim() ?? ""}」不是同一个人的标记`, detail: JSON.stringify({ pair: r.id, other: 那 }),
        })),
      });
    }
  });
  if (!撤了) return { ok: false, error: "没有能撤的标记（已经撤过，或者不是你名下的），刷新再看" };
  return { ok: true, 撤了 };
}

export type 已标一对 = { id: string; 两家: { id: string; 名: string; 负责人: string | null; 我的: boolean }[]; 谁标: string | null; 标于: number };

/** 「已标不是同一个人」：登录的人能撤的那些（负责人：有一家是他负责的；系统管理员：全部），新标的在前，最多 100 对 */
export async function 已标的对(db: 库, me: 看的人, org: 组织 | null): Promise<已标一对[]> {
  const 管 = 是系统管理员(me, org);
  const 我的们 = 管 ? null : (await 看全部(() => db.customer.findMany({ where: { salesOwnerId: me.id, pool: { is: null } }, select: { id: true } }))).map((c) => c.id);
  const 行 = await db.customerNotDupe.findMany({
    where: { undoneAt: null, ...(我的们 ? { OR: [{ customerId: { in: 我的们 } }, { otherId: { in: 我的们 } }] } : {}) },
    orderBy: [{ at: "desc" }, { id: "asc" }], take: 100,
  });
  const ids = [...new Set(行.flatMap((r) => [r.customerId, r.otherId]))];
  const [客户们, 人们] = await 看全部(() => Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, salesOwnerId: true, salesOwner: { select: { name: true } }, pool: { select: { customerId: true } } } }),
    db.user.findMany({ where: { id: { in: [...new Set(行.map((r) => r.userId))] } }, select: { id: true, name: true } }),
  ]));
  const 客 = new Map(客户们.map((c) => [c.id, c]));
  const 人 = new Map(人们.map((u) => [u.id, u.name]));
  // 有一家已经不在了（合并 / 删除）的不列：撤了也不会重新成组
  return 行.filter((r) => 客.has(r.customerId) && 客.has(r.otherId)).map((r) => ({
    id: r.id,
    两家: [r.customerId, r.otherId].map((id) => { const c = 客.get(id)!; return { id, 名: c.name.trim(), 负责人: c.pool ? null : c.salesOwner?.name ?? null, 我的: !c.pool && c.salesOwnerId === me.id }; }),
    谁标: 人.get(r.userId) ?? null, 标于: r.at.getTime(),
  }));
}
