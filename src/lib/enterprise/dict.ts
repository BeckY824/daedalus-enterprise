/**
 * 企业版选项字典（2026-10-26，迁移 057）：线索分配、回收、判无效、转让、验证、客户状态、项目标签这几处下拉的选项，
 * 一张 EntDictItem 表按 kind 分。默认值照对方给的流程表，第一次读某一类时补上（迁移不许 INSERT），固定 id；
 * 只停用不删，用过的照样认。只给选项、不设必填（10-26 会定的「首版不设必填」）。
 *
 * 谁能改同项目模式的两本字典：「后台设置谁能改」的字典一行（挡改设置(me, "字典")）。不是企业版不读不写。
 */
import { prisma } from "@/lib/prisma";
import type { EntDictItem, Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 挡改设置 } from "./edit-perm";
import { 字典种类们, 字典定义, 选项名上限, 其他项, 其他前缀, 拆其他, 其他没写好, type 字典种类 } from "./dict-kinds";
import { 分配谁能用key, 规整分配谁能用, 能用分配方式, 谁能用的话, type 分配谁能用配置 } from "./assign-use";
import { 读组织 } from "./org";

export * from "./dict-kinds";
export * from "./assign-use";

const 是种类 = (k: unknown): k is 字典种类 => typeof k === "string" && (字典种类们 as readonly string[]).includes(k);
/** 默认项的固定 id：dict-<种类>-<序号>，改名不变 */
const 默认id = (kind: 字典种类, i: number) => `dict-${kind}-${i}`;

type 结果 = { ok: true } | { ok: false; error: string };

/** 一类的选项：按排序列出（停用的也列，界面自己挑）；这一类一行都没有就先建默认的 */
export async function 企业字典(kind: 字典种类, db: Prisma.TransactionClient = prisma): Promise<EntDictItem[]> {
  if ((await db.entDictItem.count({ where: { kind } })) === 0) {
    for (const [i, name] of 字典定义[kind].默认.entries()) {
      await db.entDictItem.upsert({ where: { kind_name: { kind, name } }, update: {}, create: { id: 默认id(kind, i), kind, name, sort: i } });
    }
  }
  return db.entDictItem.findMany({ where: { kind }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
}

/** 全部几类一次读出，设置页用；不是企业版 = null */
export async function 全部企业字典() {
  if (!企业版()) return null;
  const 各类 = await Promise.all(字典种类们.map(async (k) => [k, await 企业字典(k)] as const));
  return Object.fromEntries(各类) as Record<字典种类, EntDictItem[]>;
}

/** 下拉里能选的名字（停用的不出）；不是企业版 = 空 */
export async function 可选项(kind: 字典种类): Promise<string[]> {
  if (!企业版()) return [];
  return (await 企业字典(kind)).filter((x) => x.active).map((x) => x.name);
}

/**
 * 下拉提交上来的原因（10-27）：不是企业版或没选 = null；选的必须是这一类当前启用的选项。
 * 在事务外调（读设置别进事务，会等到超时）。
 */
export async function 选的原因(kind: 字典种类, v: unknown): Promise<{ ok: true; 值: string | null } | { ok: false; error: string }> {
  if (!企业版()) return { ok: true, 值: null };
  const n = typeof v === "string" ? v.trim() : "";
  if (!n) return { ok: true, 值: null };
  // 选「其他」要写一句：存成「其他：xxx」，只要「其他」这一项还启用着
  const 其他错 = 其他没写好(n);
  if (其他错) return { ok: false, error: 其他错 };
  const { 选, 写 } = 拆其他(n);
  if (!(await 可选项(kind)).includes(选 ?? n)) return { ok: false, error: `「${选 ?? n}」不在${字典定义[kind].名}里（可能刚被停用），刷新后再选` };
  return { ok: true, 值: 选 === 其他项 ? `${其他前缀}${写.trim()}` : n };
}

/** 分配方式默认五项的序号：0 指定分配、1 自动分配、2 公海捞取、3 暂不分配、4 自拓自持（默认id("assign", i)） */
export type 分配方式序号 = 0 | 1 | 2 | 3 | 4;
export const 是分配方式序号 = (x: unknown): x is 分配方式序号 => x === 0 || x === 1 || x === 2 || x === 3 || x === 4;

/** 分配记录上的「分配方式」：取字典里这一项现在的叫法（改过名跟着改）；事务外调 */
export async function 分配方式叫法(i: 分配方式序号): Promise<string> {
  const 有 = (await 企业字典("assign")).find((x) => x.id === 默认id("assign", i));
  return 有?.name ?? 字典定义.assign.默认[i];
}

/** 分配方式谁能用（assign-use.ts）：没存 = 默认；不是企业版 = 空 */
export async function 读分配谁能用(): Promise<分配谁能用配置> {
  if (!企业版()) return {};
  const { getSetting } = await import("@/lib/settings");
  return 规整分配谁能用(await getSetting<unknown>(分配谁能用key));
}

/**
 * 用某个分配方式之前查：这个人的业务角色能不能用（i 是默认项序号）。
 * null = 能用，否则是挡住的那句；不是企业版 = null（不管）。事务外调
 */
export async function 挡分配方式(me: { id: string; role: string }, i: 分配方式序号): Promise<string | null> {
  if (!企业版() || me.role === "ADMIN") return null;
  const id = 默认id("assign", i);
  const [org, 配置] = await Promise.all([读组织(), 读分配谁能用()]);
  if (能用分配方式(org, me, id, 配置)) return null;
  return 谁能用的话(id, await 分配方式叫法(i), 配置);
}

/** 建档向导的「分配方式」下拉：默认五项里这个人能用、还启用着的，按字典顺序；不是企业版 = 空 */
export async function 我能用的分配方式(me: { id: string; role: string }): Promise<{ i: 分配方式序号; 名: string }[]> {
  if (!企业版()) return [];
  const [项们, org, 配置] = await Promise.all([企业字典("assign"), 读组织(), 读分配谁能用()]);
  const 出: { i: 分配方式序号; 名: string }[] = [];
  for (const x of 项们) {
    const i = [0, 1, 2, 3, 4].find((k) => 默认id("assign", k) === x.id);
    if (!是分配方式序号(i) || !x.active) continue;
    if (me.role === "ADMIN" || 能用分配方式(org, me, x.id, 配置)) 出.push({ i, 名: x.name });
  }
  return 出;
}

/** 存「谁能用」：只认分配方式字典里有的项；谁能改同字典一行 */
export async function 改分配谁能用(me: { id: string; role: string }, 配置: unknown): Promise<结果> {
  const 挡住 = await 挡(me, "assign");
  if (挡住) return { ok: false, error: 挡住 };
  const 有的 = new Set((await 企业字典("assign")).map((x) => x.id));
  const 新 = Object.fromEntries(Object.entries(规整分配谁能用(配置)).filter(([id]) => 有的.has(id)));
  const { setSetting } = await import("@/lib/settings");
  await setSetting(分配谁能用key, { ...(await 读分配谁能用()), ...新 });
  return { ok: true };
}

async function 挡(me: { id: string; role: string }, kind: unknown): Promise<string | null> {
  if (!企业版()) return "企业版才有这项设置";
  if (!是种类(kind)) return "没有这类选项";
  const 挡住 = await 挡改设置(me, "字典");
  return 挡住 && `${字典定义[kind].名}${挡住}`;
}

function 规整名(name: unknown): string | { error: string } {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return { error: "选项不能空着" };
  if (n.length > 选项名上限) return { error: `选项请控制在 ${选项名上限} 字以内` };
  return n;
}

/** 加一个选项，排在这一类最后；停用过的同名选项重新启用 */
export async function 加字典项(me: { id: string; role: string }, kind: unknown, name: unknown): Promise<结果 & { id?: string }> {
  const 挡住 = await 挡(me, kind);
  if (挡住) return { ok: false, error: 挡住 };
  const k = kind as 字典种类;
  const n = 规整名(name);
  if (typeof n !== "string") return { ok: false, ...n };
  await 企业字典(k);
  const 有 = await prisma.entDictItem.findUnique({ where: { kind_name: { kind: k, name: n } } });
  if (有) {
    if (有.active) return { ok: false, error: `已经有「${n}」了` };
    await prisma.entDictItem.update({ where: { id: 有.id }, data: { active: true } });
    return { ok: true, id: 有.id };
  }
  const 末 = await prisma.entDictItem.aggregate({ where: { kind: k }, _max: { sort: true } });
  const r = await prisma.entDictItem.create({ data: { kind: k, name: n, sort: (末._max.sort ?? -1) + 1 } });
  return { ok: true, id: r.id };
}

/** 改名 / 停用 / 启用。不删：停用的不能再选，已经用过的照样显示 */
export async function 改字典项(me: { id: string; role: string }, id: string, patch: { name?: unknown; active?: boolean }): Promise<结果 & { kind?: 字典种类; 原名?: string }> {
  const r = await prisma.entDictItem.findUnique({ where: { id: String(id ?? "") } });
  const 挡住 = await 挡(me, r?.kind ?? 字典种类们[0]);
  if (挡住) return { ok: false, error: 挡住 };
  if (!r) return { ok: false, error: "这个选项已经不在了，刷新看看" };
  const data: { name?: string; active?: boolean } = {};
  if (patch.name !== undefined) {
    const n = 规整名(patch.name);
    if (typeof n !== "string") return { ok: false, ...n };
    if (n !== r.name && (await prisma.entDictItem.findUnique({ where: { kind_name: { kind: r.kind, name: n } } }))) {
      return { ok: false, error: `已经有「${n}」了` };
    }
    data.name = n;
  }
  if (patch.active !== undefined) data.active = patch.active === true;
  await prisma.entDictItem.update({ where: { id: r.id }, data });
  return { ok: true, kind: r.kind as 字典种类, 原名: r.name };
}
