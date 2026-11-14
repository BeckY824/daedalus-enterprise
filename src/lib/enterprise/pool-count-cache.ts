/**
 * 公海页分组计数的短时缓存（8.5 万客户提速第二轮，11-14）。
 *
 * 那句（unified-pool-sql.ts 分组数SQL）要把 6.6 万位公海客户逐位连回客户表再分组，没关键词时单句 55–76 ms，30 人并发时占每请求 SQL 时间的 12%；
 * 改写试过（两层分组、只分原始列再在外层算快捷）都下不去：连表 + 分组本身就要 ~20 ms 以上，所以缓存几秒。
 *
 * 键 = 整句 SQL + 全部参数（属性名单、这个人回避掉的客户、来源、号码不全……）原样拼起来：结果只是这几样输入加库里数据的函数，
 * 输入一样的两个人拿到的本来就是同一个数；回避的人「排掉」不同，键就不同，不会拿到按别人范围数出来的数。
 * 陈旧窗口：经限定层（lib/prisma 的 prisma）的任何写、任何 $executeRaw 都把版本号加一，之后的读不再用旧的（team-scope 写了库）；
 * 不经限定层直接写库的（底层客户端、另一个进程）最多晚 存活毫秒 才看到。只缓存数，不缓存行。
 * 同一时刻同样的几句只发一次（正在算的那个 promise 大家一起等）。
 * 多租户（托管版）不缓存：键里没有工作区。测试里默认关（测试常拿底层客户端改数据再读），要测它的用 测试里开公海分组缓存
 *
 * 压测用的统计（只数不改行为）：命中 / 未命中（没有或过期）/ 作废（没过期但写过库）三个进程内计数，公海分组缓存统计() 读；
 * 设 CRM_POOL_CACHE_STATS=1 时每 30 秒（有变化才）打一行日志。默认关
 */
import { multiTenant } from "@/lib/tenant/context";

const 存活毫秒 = 3000;
const 最多几条 = 256;

type 项 = { 到: number; 版本: number; 值: Promise<unknown> };
type 统计 = { 命中: number; 未命中: number; 作废: number };
const g = globalThis as unknown as { __公海分组缓存?: Map<string, 项>; __写库版本?: number; __公海分组缓存测试?: boolean; __公海分组统计?: 统计; __公海分组统计计时?: ReturnType<typeof setInterval> };
const 表 = () => (g.__公海分组缓存 ??= new Map());
const 计 = () => (g.__公海分组统计 ??= { 命中: 0, 未命中: 0, 作废: 0 });

/** 进程启动以来的命中 / 未命中 / 作废次数（压测看缓存起没起作用） */
export function 公海分组缓存统计(): 统计 {
  return { ...计() };
}

function 开统计日志() {
  if (process.env.CRM_POOL_CACHE_STATS !== "1" || g.__公海分组统计计时) return;
  let 上次 = "";
  g.__公海分组统计计时 = setInterval(() => {
    const { 命中, 未命中, 作废 } = 计();
    const 行 = `[公海分组缓存] 命中 ${命中} 未命中 ${未命中} 作废 ${作废}`;
    if (行 !== 上次) console.log(行);
    上次 = 行;
  }, 30_000);
  g.__公海分组统计计时.unref?.();
}

/** 写库版本：限定层每次写都加一（team-scope 写了库） */
export function 写库版本(): number {
  return g.__写库版本 ?? 0;
}
export function 记一次写库() {
  g.__写库版本 = 写库版本() + 1;
}

export function 测试里开公海分组缓存(开: boolean) {
  g.__公海分组缓存测试 = 开;
  表().clear();
}

function 开着(): boolean {
  if (multiTenant()) return false;
  if (process.env.NODE_ENV === "test") return !!g.__公海分组缓存测试;
  return true;
}

/**
 * 按 SQL + 参数缓存一句只读查询的结果，存活 活多久 毫秒（默认 存活毫秒）、写过库就作废。
 * 第三轮（11-14）起也给：跟进数公海那一路（scope-sql 公海跟进数，键 = 整句 + 参数）、客户页国家 / grade 下拉（scope-sql 看得到的下拉值，
 * 键 = 列名 + 这个人读客户时限定层并进去的整句条件，活 60 秒）。键要把「结果取决于的全部输入」放进去，不同范围不会拿到同一份
 */
export function 缓存分组数<T>(sql: string, 值: readonly unknown[], 查: () => Promise<T>, 活多久 = 存活毫秒): Promise<T> {
  if (!开着()) return 查();
  const 键 = JSON.stringify([sql, 值]);
  const 现 = Date.now();
  const 版本 = 写库版本();
  const 有 = 表().get(键);
  开统计日志();
  if (有 && 有.到 > 现 && 有.版本 === 版本) {
    计().命中++;
    return 有.值 as Promise<T>;
  }
  if (有 && 有.到 > 现) 计().作废++;
  else 计().未命中++;
  if (表().size >= 最多几条) {
    for (const [k, v] of 表()) if (v.到 <= 现 || v.版本 !== 版本) 表().delete(k);
    if (表().size >= 最多几条) 表().clear();
  }
  const p = 查();
  表().set(键, { 到: 现 + 活多久, 版本, 值: p });
  // 出错的不留：下一次照常重查
  p.catch(() => {
    if (表().get(键)?.值 === p) 表().delete(键);
  });
  return p;
}
