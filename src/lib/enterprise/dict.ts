/**
 * 企业版选项字典（2026-10-26，迁移 057）：线索分配、回收、判无效、转让、验证、客户状态、项目标签这几处下拉的选项，
 * 一张 EntDictItem 表按 kind 分。默认值照对方给的流程表，第一次读某一类时补上（迁移不许 INSERT），固定 id；
 * 只停用不删，用过的照样认。只给选项、不设必填（10-26 会定的「首版不设必填」）。
 *
 * 谁能改同项目模式的两本字典：「后台设置谁能改」的字典一行（挡改设置(me, "字典")）。不是企业版不读不写。
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { EntDictItem, Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 挡改设置 } from "./edit-perm";
import { 字典种类们, 字典定义, 项目画像项, 选项名上限, 其他项, 其他前缀, 拆其他, 其他没写好, 字典项释义, type 字典种类 } from "./dict-kinds";
import { 分配谁能用key, 规整分配谁能用, 能用分配方式, 谁能用的话, type 分配谁能用配置 } from "./assign-use";
import { 读组织 } from "./org";
import { 方式对类型, 类型对方式 } from "@/lib/follow-method";

export * from "./dict-kinds";
export * from "./assign-use";

const 是种类 = (k: unknown): k is 字典种类 => typeof k === "string" && (字典种类们 as readonly string[]).includes(k);
/** 默认项的固定 id：dict-<种类>-<序号>，改名不变 */
const 默认id = (kind: 字典种类, i: number) => `dict-${kind}-${i}`;

type 结果 = { ok: true } | { ok: false; error: string };

/** 几个人同时第一次读同一类时，别人刚建好的那项会撞唯一键 = 已经有了，跳过（10-30 CI 压测撞出来的） */
async function 建了就算(建: PromiseLike<unknown>) {
  try {
    await 建;
  } catch (e) {
    if ((e as { code?: string })?.code !== "P2002") throw e;
  }
}

/** 一类的选项：按排序列出（停用的也列，界面自己挑）；这一类一行都没有就先建默认的 */
export async function 企业字典(kind: 字典种类, db: Prisma.TransactionClient = prisma): Promise<EntDictItem[]> {
  const 停用 = 字典定义[kind].默认停用 ?? [];
  const { 默认顺序 } = 字典定义[kind];
  if (字典定义[kind].旧默认) {
    await 补换默认(kind, db);
    await 删多出的旧默认(kind, db);
  }
  if ((await db.entDictItem.count({ where: { kind } })) === 0) {
    for (const [i, name] of 字典定义[kind].默认.entries()) {
      await 建了就算(db.entDictItem.upsert({ where: { kind_name: { kind, name } }, update: {}, create: { id: 默认id(kind, i), kind, name, sort: 默认位置(kind, i), active: !停用.includes(name) } }));
    }
    if (停用.length) await 记下补停过(kind, db);
    if (默认顺序) await 记下(换顺序记号(kind), db);
    await 记下补新过(kind, db);
  } else {
    if (停用.length) await 补停用(kind, 停用, db);
    // 先补新加的默认项（排在原序号上），补换顺序 才看得到它们
    await 补新默认(kind, 停用, db);
    if (默认顺序) await 补换顺序(kind, db);
  }
  return db.entDictItem.findMany({ where: { kind }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
}

/**
 * 默认停用是后加的（10-28）：之前建好的库里这几项还启用着，补停一次。只停还叫原名的默认项，
 * 停完（或新建时就停着）记一笔，以后管理员自己再启用就不再动它。不放迁移：迁移只加表加列，也管不住「只停一次」
 */
const 补停用记号 = (kind: 字典种类) => `entDict.defaultOff.${kind}`;
async function 记下补停过(kind: 字典种类, db: Prisma.TransactionClient) {
  await db.setting.upsert({ where: { key: 补停用记号(kind) }, update: {}, create: { key: 补停用记号(kind), value: "true" } });
}
async function 补停用(kind: 字典种类, 停用: readonly string[], db: Prisma.TransactionClient) {
  if (await db.setting.findUnique({ where: { key: 补停用记号(kind) } })) return;
  const ids = 字典定义[kind].默认.flatMap((n, i) => (停用.includes(n) ? [默认id(kind, i)] : []));
  await db.entDictItem.updateMany({ where: { kind, id: { in: ids }, name: { in: [...停用] } }, data: { active: false } });
  await 记下补停过(kind, db);
}

/**
 * 默认项改过名（客户状态 10-28 整套换；客户类型 10-30 换两轮：先贸易商→中间贸易商等，再一般客户→暂不确认）：
 * 之前建好的库里，还叫某一轮旧名的默认项（固定 id、名字没被人改过）改成同序号的新名，每轮只改一次，按先后一轮一轮来
 * （很老的库先过第一轮再过第二轮）。新名已经被别的项占了的那一个跳过；人改过名、自己加的不动。每轮改完记一笔，以后不再碰。
 * 新默认比这一轮短（需求状态 10-30 五项变四项）：多出来的、还叫旧名的那几项先停用，删不删看下面 删多出的旧默认。
 * 第一轮的记号沿用原来的 key（已经改过的库不会重来），第二轮起 key 后面带轮次
 */
const 换默认记号 = (kind: 字典种类, 轮: number) => (轮 === 0 ? `entDict.defaultRenamed.${kind}` : `entDict.defaultRenamed.${kind}.${轮 + 1}`);
async function 补换默认(kind: 字典种类, db: Prisma.TransactionClient) {
  const { 默认, 旧默认 = [] } = 字典定义[kind];
  const 记号们 = 旧默认.map((_, 轮) => 换默认记号(kind, 轮));
  const 记过 = new Set((await db.setting.findMany({ where: { key: { in: 记号们 } }, select: { key: true } })).map((x) => x.key));
  if (记号们.every((k) => 记过.has(k))) return;
  const 现有 = await db.entDictItem.findMany({ where: { kind }, select: { id: true, name: true } });
  const 占着 = new Set(现有.map((x) => x.name));
  for (const [轮, 这轮旧名] of 旧默认.entries()) {
    if (记过.has(记号们[轮])) continue;
    for (const [i, 旧名] of 这轮旧名.entries()) {
      const 新名 = 默认[i];
      const 那项 = 现有.find((x) => x.id === 默认id(kind, i) && x.name === 旧名);
      if (那项 && i >= 默认.length) await db.entDictItem.update({ where: { id: 那项.id }, data: { active: false } });
      if (!那项 || !新名 || 新名 === 旧名 || 占着.has(新名)) continue;
      await db.entDictItem.update({ where: { id: 那项.id }, data: { name: 新名 } });
      那项.name = 新名;
      占着.delete(旧名);
      占着.add(新名);
    }
    await 记下(记号们[轮], db);
  }
}

/**
 * 新默认比旧默认短、多出来的那几项（需求状态的订单交付，10-31 用户：「清除掉需求状态里的订单交付，这个是没对齐的」）：
 * 固定 id、还叫旧名（停没停用都算）的，没有项目在用就删掉；有项目存着这个值就留着停用（项目上照常显示原值）。
 * 只看项目画像里的单选项（项目画像项），别的种类不删。做完记一笔，以后不再碰
 */
const 删旧默认记号 = (kind: 字典种类) => `entDict.defaultDropped.${kind}`;
async function 删多出的旧默认(kind: 字典种类, db: Prisma.TransactionClient) {
  const { 默认, 旧默认 = [] } = 字典定义[kind];
  const 多出的 = 旧默认.flatMap((这轮) => 这轮.slice(默认.length).map((旧名, j) => [默认.length + j, 旧名] as const));
  const 画像 = 项目画像项.find((x) => x.种类 === kind && !x.多选);
  if (!多出的.length || !画像) return;
  if (await db.setting.findUnique({ where: { key: 删旧默认记号(kind) } })) return;
  for (const [序, 旧名] of 多出的) {
    const 那项 = await db.entDictItem.findFirst({ where: { id: 默认id(kind, 序), kind, name: 旧名 }, select: { id: true } });
    if (!那项) continue;
    const 在用 = await db.project.count({ where: { [画像.键]: 旧名 } });
    if (在用) await db.entDictItem.update({ where: { id: 那项.id }, data: { active: false } });
    else await db.entDictItem.deleteMany({ where: { id: 那项.id } });
  }
  await 记下(删旧默认记号(kind), db);
}

/**
 * 默认项后来往末尾加过（10-30：号码类型加传真、Telegram，客户类型加专业运营商、一般客户）：之前建好的库里缺哪个默认 id 就建哪个，
 * 排在序号位置上；原来排在这些位置及以后的（自己加的项）整体往后让，还在新默认后面。名字已经被别的项占了的跳过（不和人加的重名）。
 * 记号存的是补到第几项，以后默认再往后加还会补；默认停用的建出来就停着。几个人同时补时自己加的会多让几格，相对顺序不变
 */
const 补新记号 = (kind: 字典种类) => `entDict.defaultAdded.${kind}`;
async function 记下补新过(kind: 字典种类, db: Prisma.TransactionClient) {
  const value = String(字典定义[kind].默认.length);
  await db.setting.upsert({ where: { key: 补新记号(kind) }, update: { value }, create: { key: 补新记号(kind), value } });
}
async function 补新默认(kind: 字典种类, 停用: readonly string[], db: Prisma.TransactionClient) {
  const { 默认 } = 字典定义[kind];
  const 记 = await db.setting.findUnique({ where: { key: 补新记号(kind) } });
  if (记 && Number(记.value) >= 默认.length) return;
  const 现有 = await db.entDictItem.findMany({ where: { kind }, select: { id: true, name: true } });
  const 缺 = 默认.flatMap((name, i) => (现有.some((x) => x.id === 默认id(kind, i)) || 现有.some((x) => x.name === name) ? [] : [{ name, i }]));
  if (缺.length) {
    await db.entDictItem.updateMany({ where: { kind, sort: { gte: 缺[0].i } }, data: { sort: { increment: 缺.length } } });
    for (const { name, i } of 缺) await 建了就算(db.entDictItem.create({ data: { id: 默认id(kind, i), kind, name, sort: i, active: !停用.includes(name) } }));
  }
  await 记下补新过(kind, db);
}

/** 第 i 个默认项排第几：有 默认顺序 按它，没有就是 i */
function 默认位置(kind: 字典种类, i: number): number {
  const { 默认, 默认顺序 } = 字典定义[kind];
  const k = 默认顺序?.indexOf(默认[i]) ?? -1;
  return k >= 0 ? k : i;
}
const 记下 = (key: string, db: Prisma.TransactionClient) => db.setting.upsert({ where: { key }, update: {}, create: { key, value: "true" } });

/**
 * 默认顺序是后改的（客户状态 10-29：流失挪到丢单前面）：之前建好的库里，要挪的默认项都还是原名、还在原位置（sort = 序号）才挪，
 * 有一项被人改过名或挪过就整类不动（不猜人的意思）。只看一次，记一笔
 */
const 换顺序记号 = (kind: 字典种类) => `entDict.defaultOrder.${kind}`;
async function 补换顺序(kind: 字典种类, db: Prisma.TransactionClient) {
  if (await db.setting.findUnique({ where: { key: 换顺序记号(kind) } })) return;
  const { 默认 } = 字典定义[kind];
  const 要挪 = 默认.flatMap((name, i) => (默认位置(kind, i) !== i ? [{ id: 默认id(kind, i), name, i }] : []));
  const 现有 = await db.entDictItem.findMany({ where: { id: { in: 要挪.map((x) => x.id) } }, select: { id: true, name: true, sort: true } });
  const 没动过 = 要挪.every((x) => 现有.some((r) => r.id === x.id && r.name === x.name && r.sort === x.i));
  if (没动过) for (const x of 要挪) await db.entDictItem.update({ where: { id: x.id }, data: { sort: 默认位置(kind, x.i) } });
  await 记下(换顺序记号(kind), db);
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
 * 页面渲染用的读法：同一次请求里同一类只读一次（React cache，10-29）。客户页一屏要读好几类、中栏名单也要读客户状态，
 * 每处直接调 企业字典 是每次 3～4 句（数行数、看记号、取列表）。只给服务端组件渲染用：写库、校验提交（选的原因）照旧现读
 */
export const 页面字典 = cache((kind: 字典种类): Promise<EntDictItem[]> => 企业字典(kind));
/** 同 可选项，走 页面字典 */
export const 页面可选项 = cache(async (kind: 字典种类): Promise<string[]> => {
  if (!企业版()) return [];
  return (await 页面字典(kind)).filter((x) => x.active).map((x) => x.name);
});

/**
 * 下拉里每项下面那行灰字（10-30，客户状态、客户类型）：名字 → 释义，只列有释义的（停用的也列：客户身上的原值可能是停用项）。
 * 按默认 id 认（字典项释义），所以管理员改了名的还带着原释义，自己加的没有。界面只拿得到名字，所以按名字给
 */
export const 页面释义 = cache(async (kind: 字典种类): Promise<Record<string, string>> => {
  if (!企业版() || !字典定义[kind].释义) return {};
  const 表: Record<string, string> = {};
  for (const x of await 页面字典(kind)) {
    const 释 = 字典项释义(kind, x.id);
    if (释) 表[x.name] = 释;
  }
  return 表;
});
/** 客户页、客户列表用的两类释义一次给（字典已经被 页面可选项 读过，走请求内缓存，不多查库） */
export const 页面客户释义 = cache(async (): Promise<{ 状态: Record<string, string>; 类型: Record<string, string> }> => {
  const [状态, 类型] = await Promise.all([页面释义("custStatus"), 页面释义("custType")]);
  return { 状态, 类型 };
});

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

/** 分配方式默认五项的序号：0 指定分配、1 自动分配、2 公海捞取、3 暂不分配、4 个人自拓（默认id("assign", i)） */
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

/**
 * 跟进记录的沟通方式和类型一起定（10-31，企业版）；事务外调。
 * 选了方式：得是启用着的（改已有的、方式没变的不查：原来那项后来停用了照样能存），type 按方式对出来。
 * 没选方式：任务、提醒没有方式；别的按 type 补一个（从旧入口、AI 速记来的）。不是企业版：method 不写
 */
export async function 定沟通方式(method: unknown, type: string, 原方式?: string | null): Promise<{ ok: true; method?: string | null; type: string } | { ok: false; error: string }> {
  if (!企业版()) return { ok: true, type };
  if (type === "TASK" || type === "REMIND") return { ok: true, method: null, type };
  const n = typeof method === "string" ? method.trim() : "";
  if (!n) {
    // 改已有的、没带方式（旧入口）：type 没变就留着原来的方式，不把 Telegram 冲成「其他方式」
    if (原方式 && 方式对类型(原方式) === type) return { ok: true, method: 原方式, type };
    return { ok: true, method: 类型对方式(type), type };
  }
  if (n !== 原方式) {
    const 查 = await 选的原因("followMethod", n);
    if (!查.ok) return 查;
  }
  return { ok: true, method: n, type: 方式对类型(n) };
}

/** 新记一条沟通（项目上记、建档向导、线索转项目、客户页建项目）的方式和类型一起定好再去规整；事务外调。别的版本原样回去 */
export async function 认跟进方式<T extends { type: string; method?: string | null }>(f: T): Promise<T | { error: string }> {
  if (!企业版() || !f || typeof f !== "object") return f;
  const r = await 定沟通方式(f.method, f.type);
  if (!r.ok) return { error: r.error };
  return { ...f, type: r.type, method: r.method ?? null };
}
