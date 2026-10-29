/**
 * 企业版软删 · 读的时候统一滤掉（P9，2026-10-29）。
 *
 * 客户、项目、联系人、沟通记录删了不真删，只记 deletedAt，进设置 → 回收站，30 天后自动清掉（见 soft-delete.ts）。
 * 读的时候不让每个页面各写一遍 deletedAt: null：lib/team-scope.ts 的 加上限定 里先过 去掉已删()，
 * 企业版的 prisma（含读池、测试里套同一层的库）每条查询都经过这里：
 *
 *   - 查 / 数 / 聚合 / 分组（findMany、findFirst、findUnique 含 OrThrow、count、aggregate、groupBy）：
 *     软删表补 deletedAt: null；挂在它们下面的表（任务、合同、项目节点日志、卡点……）补「父行没删」
 *   - include / select 带出来的关联、_count：列表关联和可空单关联同样补（必填单关联由父模型那一层保证）
 *   - where 里的关联条件（some / none / every）：只认没删的子行，「名下有没删的项目」才算有项目
 *   - 改 / 删（update、updateMany、delete、deleteMany）：软删表只碰没删的，回收站里的行改不到
 *   - create / upsert 不动
 *
 * 要看回收站里的（恢复、彻底删除、到期清理、回收站列表）包在 看已删() 里。
 * 裸 SQL（$queryRaw）不经过扩展：读这四张表的那几句各自带了 "deletedAt" IS NULL（客户列表、范围计数、同号查重……）。
 * 不是企业版这里什么都不做：deletedAt 一直是空，加了条件也只是白查。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@/generated/prisma";

/** 有 deletedAt 的四张表 */
export const 软删表 = ["Customer", "Project", "Contact", "FollowUp"] as const;
export type 软删表名 = (typeof 软删表)[number];
/** 回收站留几天，过了自动清掉 */
export const 回收站保留天数 = 30;
/** 删一位客户时一起进回收站的（同一个 deletedAt），恢复客户时按同一个时刻一起回来 */
export const 客户连带: readonly 软删表名[] = ["Contact", "Project", "FollowUp"];
/** 父行删了照样看得到的表：线索转过客户也还是线索（客户进回收站，线索页照旧在） */
const 不随父滤 = new Set(["Lead"]);

const 软 = new Set<string>(软删表);
type 参数 = Record<string, unknown>;
type 关系字段 = { name: string; type: string; isList: boolean; isRequired: boolean; relationFromFields?: readonly string[] };
const 关系们 = new Map<string, Map<string, 关系字段>>(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    new Map(m.fields.filter((f) => f.kind === "object").map((f) => [f.name, f as unknown as 关系字段])),
  ]),
);

const 看删 = new AsyncLocalStorage<true>();
/** 这一段里的查询连回收站里的一起看（恢复、彻底删除、到期清理、回收站列表） */
export function 看已删<T>(fn: () => Promise<T>): Promise<T> {
  // 和 看全部 一样在 run 里 await：Prisma 的查询是懒的
  return 看删.run(true, async () => await fn());
}
export function 在看已删(): boolean {
  return 看删.getStore() === true;
}

/** 这张表「没删」的条件：软删表看自己的 deletedAt；挂在软删表下面的看父行（自己持外键的那几条单关联）；别的表 null */
const 条件缓存 = new Map<string, 参数 | null>();
export function 未删条件(model: string): 参数 | null {
  if (软.has(model)) return { deletedAt: null };
  if (不随父滤.has(model)) return null;
  if (条件缓存.has(model)) return 条件缓存.get(model)!;
  const 条: 参数[] = [];
  for (const f of 关系们.get(model)?.values() ?? []) {
    if (f.isList || !软.has(f.type) || !f.relationFromFields?.length) continue;
    // 可空的外键：没挂（空）也算没删
    条.push(f.isRequired ? { [f.name]: { is: { deletedAt: null } } } : { OR: [{ [f.relationFromFields[0]]: null }, { [f.name]: { is: { deletedAt: null } } }] });
  }
  const r = 条.length === 0 ? null : 条.length === 1 ? 条[0] : { AND: 条 };
  条件缓存.set(model, r);
  return r;
}

function 并上(where: unknown, 条件: 参数): 参数 {
  const w = (where ?? {}) as 参数;
  const 旧 = w.AND ? (Array.isArray(w.AND) ? w.AND : [w.AND]) : [];
  // 原来的 where 原样摊开、条件并进 AND：findUnique / update / delete 要求唯一键留在最外层
  return { ...w, AND: [...旧, 条件] };
}

/** where 里的关联条件只认没删的子行；AND / OR / NOT 一层层往下走 */
function 改条件(model: string, w: unknown): unknown {
  if (!w || typeof w !== "object" || Array.isArray(w)) return w;
  const 关系 = 关系们.get(model);
  const out: 参数 = {};
  for (const [k, v] of Object.entries(w as 参数)) {
    if (k === "AND" || k === "OR" || k === "NOT") {
      out[k] = Array.isArray(v) ? v.map((x) => 改条件(model, x)) : 改条件(model, v);
      continue;
    }
    const f = 关系?.get(k);
    if (!f || !v || typeof v !== "object") {
      out[k] = v;
      continue;
    }
    if (f.isList) {
      const 子 = 未删条件(f.type);
      const o: 参数 = {};
      for (const [op, inner] of Object.entries(v as 参数)) {
        const 里 = 改条件(f.type, inner);
        if (!子) o[op] = 里;
        else if (op === "some" || op === "none") o[op] = 并上(里, 子);
        else if (op === "every") o[op] = { OR: [{ NOT: 子 }, 里 ?? {}] }; // 删了的子行不拦「每一条都……」
        else o[op] = 里;
      }
      out[k] = o;
    } else {
      const x = v as 参数;
      out[k] = "is" in x || "isNot" in x
        ? Object.fromEntries(Object.entries(x).map(([op, inner]) => [op, inner === null ? null : 改条件(f.type, inner)]))
        : 改条件(f.type, x);
    }
  }
  return out;
}

/** include / select 带出来的关联、_count：列表关联和可空单关联补「没删」；必填单关联由父模型保证 */
function 改关联(model: string, args: 参数): 参数 {
  const 关系 = 关系们.get(model);
  if (!关系) return args;
  let out = args;
  for (const 模式 of ["include", "select"] as const) {
    const 原 = args[模式];
    if (!原 || typeof 原 !== "object") continue;
    const 选 = { ...(原 as 参数) };
    for (const f of 关系.values()) {
      const v = 选[f.name];
      if (!v) continue;
      let a = 改关联(f.type, v === true ? {} : { ...(v as 参数) });
      if (a.where) a = { ...a, where: 改条件(f.type, a.where) };
      const 子 = 未删条件(f.type);
      if (子 && (f.isList || !f.isRequired)) a = { ...a, where: 并上(a.where, 子) };
      选[f.name] = a;
    }
    if (选._count) {
      const 计数 = 选._count === true ? {} : (选._count as 参数);
      const 原计数 = 计数.select as 参数 | undefined;
      const 列表 = [...关系.values()].filter((f) => f.isList);
      const 数 = { ...(原计数 ?? Object.fromEntries(列表.map((f) => [f.name, true]))) };
      for (const f of 列表) {
        const v = 数[f.name];
        const 子 = 未删条件(f.type);
        if (!v || !子) continue;
        const a = v === true ? {} : (v as 参数);
        数[f.name] = { ...a, where: 并上(改条件(f.type, a.where), 子) };
      }
      选._count = { ...计数, select: 数 };
    }
    out = { ...out, [模式]: 选 };
  }
  return out;
}

const 读操作 = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const 带条件的写 = new Set(["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany"]);

/** lib/team-scope.ts 的扩展在每条查询最前面调：企业版、不在 看已删() 里才改参数 */
export function 去掉已删(model: string | undefined, operation: string, args: unknown): unknown {
  if (!model) return args;
  let a = 改关联(model, (args ?? {}) as 参数);
  if (a.where && (读操作.has(operation) || 带条件的写.has(operation))) a = { ...a, where: 改条件(model, a.where) };
  const 条件 = 读操作.has(operation) ? 未删条件(model) : 带条件的写.has(operation) && 软.has(model) ? { deletedAt: null } : null;
  return 条件 ? { ...a, where: 并上(a.where, 条件) } : a;
}
