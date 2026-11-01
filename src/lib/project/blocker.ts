/**
 * 企业版卡点的读写和谁能动（2026-10-26 起，11-01 按定稿改版）。规矩（取值、编号、会签、角色开关）在 blocker-rules.ts。
 *
 * 流转（11-01）：
 *   发布（从项目上的一条沟通记录，不指认人）→ 待接受
 *   看得到的人都能认领（一人一行，可以多人）→ 处理中；没解决之前还能有人加进来，认领了不能撤、也不能踢人
 *   每位认领人点自己那行的「我已完成」（写处理说明）；最后一位点的时候写解决方案和解决结果 → 已解决、锁定
 *   x/y 在事务里重算：两个人同时点最后一下只会解决一次
 * 每一步记一行 EntBlockerLog。没有指认 / 转让 / 退回，也不设解决时限（dueDays / dueAt 照写，界面不显示）。
 *
 * 谁看得到（B6 / B7，只认业务角色 EntMember.bizRole，账号角色 ADMIN / MANAGER 不算；没设业务角色 = 什么都没有）：
 *   - 角色开关「启用 / 停用」：我的业务角色里有一个启用了才用得上卡点
 *   - 「可看全部」：全部卡点；「只看自己」：创建人、项目负责人（项目不在公海）、点了同意的组员、认领人，
 *     加上创建人 / 负责人的上级链（实线整条链 + 虚线，同项目列表、组织范围of 的「读」，11-01 复盘范围定稿）
 *   看得到 = 能认领（不算改项目）。
 * 谁能写（11-01 定稿）：业务角色 admin（管理员）只读——发、认领、完成、改、删、原因管理一律拒（同时是 director 的不算只读）；
 *   字典、开关、删卡点只有总管理（业务角色 director）。
 * 读写都包在 看全部 里：权限已经在这里明着查过，组员不一定看得到负责人的客户
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "../prisma";
import { 查完再写 } from "../check-then-write";
import { 看已删 } from "../enterprise/soft-delete-core";
import { 看全部 } from "../team-scope";
import { getSetting, setSetting } from "../settings";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织, 直属上级of, 实线下属, 虚线下属, 拆角色, type 组织 } from "@/lib/enterprise/org";
import type { 业务角色 } from "@/lib/sync/dept-policy";
import { 原负责人回避, 历史负责人, 我回避的公海项目 } from "./pool-owner";
import { 能编辑项目, 业务线放行 } from "@/lib/enterprise/permissions";
import {
  规整卡点默认, 合上卡点默认, 规整发布, 规整文字, 拼卡点编号, 卡点编号头, 下一个卡点流水, 写库时限天数, 会签进度,
  规整卡点角色开关, 合上卡点角色开关, 卡点角色键, 卡点权限of, 看得到卡点, 原因种子们, 种子原因id, 规整原因名, 兜底原因,
  卡点状态们, 卡点类型们, 影响等级们, 卡点只读, 能管卡点, 未分类原因id, 未分类原因名,
  type 卡点默认, type 发布输入, type 卡点角色开关, type 卡点状态, type 原因状态,
} from "./blocker-rules";

type 谁 = { id: string; role: string };
type 结果 = { ok: true } | { ok: false; error: string };
type 错 = { ok: false; error: string };
/** 动过的卡点在哪个项目、编号多少（接口拿去刷新页面、写操作日志） */
export type 卡点结果 = { ok: true; projectId: string; code: string; 解决了?: boolean } | 错;

const 没开 = { ok: false as const, error: "卡点是企业版的功能" };
const 不在了 = { ok: false as const, error: "这个卡点已经不在了，刷新看看" };
const 没权 = { ok: false as const, error: "你的业务角色没开卡点，找总管理员在「设置 → 项目模式 → 卡点」里打开" };
const 只总管 = { ok: false as const, error: "只有总管理员能改" };
const 只读 = { ok: false as const, error: "管理员只能看卡点，不能发、认领、完成、改、删" };
export const 卡点默认键 = "entBlockerDefaults";
const 原因种子键 = "entBlockerReasonSeeded";

/* ───────────── 设置：默认值、角色开关 ───────────── */

export async function 读卡点默认(): Promise<卡点默认> {
  return 规整卡点默认(await getSetting<unknown>(卡点默认键));
}
export async function 读卡点角色开关(): Promise<卡点角色开关> {
  return 规整卡点角色开关(await getSetting<unknown>(卡点角色键));
}

/** 我的业务角色（原样读 EntMember，不按账号角色推）：没设 = 空 */
async function 角色们of(userId: string): Promise<业务角色[]> {
  const m = await 看全部(() => prisma.entMember.findUnique({ where: { userId }, select: { bizRole: true } }));
  return 拆角色(m?.bizRole);
}
/** 能写 = 开着且不是只读的管理员；能管 = 总管理（director）：默认值、开关、原因字典、删卡点 */
export type 我的卡点权限 = { 开: boolean; 全部: boolean; 能写: boolean; 能管: boolean };
export async function 卡点权限(me: 谁): Promise<我的卡点权限> {
  if (!企业版()) return { 开: false, 全部: false, 能写: false, 能管: false };
  const 角色们 = await 角色们of(me.id);
  const 权 = 卡点权限of(角色们, await 读卡点角色开关());
  return { ...权, 能写: 权.开 && !卡点只读(角色们), 能管: 能管卡点(角色们) };
}

/** 改卡点默认（默认类型 / 影响）：总管理（director） */
export async function 存卡点默认(me: 谁, patch: unknown): Promise<结果 & { 默认?: 卡点默认 }> {
  if (!企业版()) return 没开;
  if (!能管卡点(await 角色们of(me.id))) return 只总管;
  const 新 = 合上卡点默认(await 读卡点默认(), patch);
  if ("error" in 新) return { ok: false, error: 新.error };
  await setSetting(卡点默认键, 新);
  return { ok: true, 默认: 新 };
}

/** 按业务角色的两个开关：启用 / 停用、只看自己 / 可看全部。总管理（director） */
export async function 存卡点角色开关(me: 谁, patch: unknown): Promise<结果 & { 开关?: 卡点角色开关 }> {
  if (!企业版()) return 没开;
  if (!能管卡点(await 角色们of(me.id))) return 只总管;
  const 新 = 合上卡点角色开关(await 读卡点角色开关(), patch);
  if ("error" in 新) return { ok: false, error: 新.error };
  await setSetting(卡点角色键, 新);
  return { ok: true, 开关: 新 };
}

/* ───────────── 阻碍原因字典 ───────────── */

/** 11 个种子：第一次用到字典时补上（迁移不许 INSERT）；补过记一笔，管理员删掉没用过的种子之后不再长回来 */
export async function 备好原因(): Promise<void> {
  if (!企业版()) return;
  if (await getSetting<boolean>(原因种子键)) return;
  await 看全部(async () => {
    for (const [i, name] of 原因种子们.entries()) {
      const 有 = await prisma.entBlockerReason.findUnique({ where: { name }, select: { id: true } });
      if (!有) await prisma.entBlockerReason.upsert({ where: { id: 种子原因id(i) }, create: { id: 种子原因id(i), name, sort: i }, update: {} });
    }
  });
  await setSetting(原因种子键, true);
}

export type 原因行 = { id: string; name: string; status: 原因状态; sort: number; 用了: number; 并入: string | null };
/** 字典全表（设置页、看板筛选用）：带每个原因挂了几条卡点 */
export async function 原因字典(): Promise<原因行[]> {
  if (!企业版()) return [];
  await 备好原因();
  return 看全部(async () => {
    const 们 = await prisma.entBlockerReason.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }], include: { _count: { select: { links: true } } } });
    const 名 = new Map(们.map((r) => [r.id, r.name]));
    return 们.map((r) => ({
      id: r.id, name: r.name, status: r.status as 原因状态, sort: r.sort, 用了: r._count.links, 并入: r.mergedIntoId ? 名.get(r.mergedIntoId) ?? null : null,
    }));
  });
}

/** 发卡点时下拉里的：启用的（待审核的不进下拉，前台照样能打字新加） */
export async function 可选原因们(): Promise<string[]> {
  return (await 原因字典()).filter((r) => r.status === "启用").map((r) => r.name);
}

async function 管字典<T>(me: 谁, fn: (tx: Prisma.TransactionClient) => Promise<T | 错>): Promise<T | 错> {
  if (!企业版()) return 没开;
  if (!能管卡点(await 角色们of(me.id))) return 只总管;
  await 备好原因();
  return 查完再写((tx) => 看全部(() => fn(tx)));
}

/** 后台新增：直接启用 */
export async function 新增原因(me: 谁, name: unknown): Promise<结果 & { id?: string }> {
  return 管字典(me, async (tx) => {
    const n = 规整原因名(name);
    if (!n) return { ok: false as const, error: "原因名要填，不超过 20 个字" };
    if (await tx.entBlockerReason.findUnique({ where: { name: n } })) return { ok: false as const, error: `已经有「${n}」了` };
    const 末 = await tx.entBlockerReason.findFirst({ orderBy: { sort: "desc" }, select: { sort: true } });
    const r = await tx.entBlockerReason.create({ data: { name: n, sort: (末?.sort ?? 0) + 1, createdById: me.id } });
    return { ok: true as const, id: r.id };
  });
}

export async function 改原因名(me: 谁, id: string, name: unknown): Promise<结果> {
  return 管字典(me, async (tx) => {
    const n = 规整原因名(name);
    if (!n) return { ok: false as const, error: "原因名要填，不超过 20 个字" };
    const r = await tx.entBlockerReason.findUnique({ where: { id: String(id ?? "") } });
    if (!r) return { ok: false as const, error: "这个原因不在了，刷新看看" };
    const 撞 = await tx.entBlockerReason.findUnique({ where: { name: n } });
    if (撞 && 撞.id !== r.id) return { ok: false as const, error: `已经有「${n}」了，要并到一起用「合并」` };
    await tx.entBlockerReason.update({ where: { id: r.id }, data: { name: n } });
    return { ok: true as const };
  });
}

/** 启用 / 停用；待审核的「启用」= 审核通过 */
export async function 改原因状态(me: 谁, id: string, status: unknown): Promise<结果> {
  return 管字典(me, async (tx) => {
    if (status !== "启用" && status !== "停用") return { ok: false as const, error: "只能启用或停用" };
    const r = await tx.entBlockerReason.findUnique({ where: { id: String(id ?? "") } });
    if (!r) return { ok: false as const, error: "这个原因不在了，刷新看看" };
    await tx.entBlockerReason.update({ where: { id: r.id }, data: { status, ...(status === "启用" ? { mergedIntoId: null } : {}) } });
    return { ok: true as const };
  });
}

/** 删：只有没挂过卡点的能删；用过的只能停用 */
export async function 删原因(me: 谁, id: string): Promise<结果> {
  return 管字典(me, async (tx) => {
    const r = await tx.entBlockerReason.findUnique({ where: { id: String(id ?? "") }, include: { _count: { select: { links: true } } } });
    if (!r) return { ok: false as const, error: "这个原因不在了，刷新看看" };
    if (r._count.links > 0) return { ok: false as const, error: `「${r.name}」已经有 ${r._count.links} 条卡点用了，只能停用` };
    await tx.entBlockerReason.delete({ where: { id: r.id } });
    return { ok: true as const };
  });
}

/** 合并：把 从 挂的卡点都挂到 到 上（同一条卡点两个都挂了的去重），从 停用、记下并到哪了 */
export async function 合并原因(me: 谁, 从id: string, 到id: string): Promise<结果 & { 挪了?: number }> {
  return 管字典(me, async (tx) => {
    if (!从id || !到id || 从id === 到id) return { ok: false as const, error: "选两个不同的原因" };
    const [从, 到] = await Promise.all([tx.entBlockerReason.findUnique({ where: { id: 从id } }), tx.entBlockerReason.findUnique({ where: { id: 到id } })]);
    if (!从 || !到) return { ok: false as const, error: "原因不在了，刷新看看" };
    if (到.status !== "启用") return { ok: false as const, error: `「${到.name}」没启用，先启用再并进去` };
    const 链 = await tx.entBlockerReasonLink.findMany({ where: { reasonId: 从.id }, select: { blockerId: true } });
    const 已有 = new Set((await tx.entBlockerReasonLink.findMany({ where: { reasonId: 到.id, blockerId: { in: 链.map((l) => l.blockerId) } }, select: { blockerId: true } })).map((l) => l.blockerId));
    const 新挂 = 链.filter((l) => !已有.has(l.blockerId));
    for (const l of 新挂) await tx.entBlockerReasonLink.create({ data: { blockerId: l.blockerId, reasonId: 到.id } });
    await tx.entBlockerReasonLink.deleteMany({ where: { reasonId: 从.id } });
    await tx.entBlockerReason.update({ where: { id: 从.id }, data: { status: "停用", mergedIntoId: 到.id } });
    return { ok: true as const, 挪了: 链.length };
  });
}

/**
 * 发布时选的原因名 → id：字典里有、启用 / 待审核 → 用它；停用的、并过的 → 用并到的那个，单纯停用的报错；
 * 字典里没有的 → 新建一条「待审核」（谁加的记上），挂在这条卡点上，等总管理员审核、合并或停用
 */
export async function 原因ids(tx: Prisma.TransactionClient, 名们: readonly string[], 我: string): Promise<string[] | 错> {
  const ids: string[] = [];
  for (const name of 名们) {
    let r = await tx.entBlockerReason.findUnique({ where: { name } });
    if (r && r.status === "停用" && r.mergedIntoId) r = await tx.entBlockerReason.findUnique({ where: { id: r.mergedIntoId } });
    if (r && r.status === "停用") return { ok: false, error: `阻碍原因「${r.name}」已停用，换一个` };
    if (!r) {
      const 末 = await tx.entBlockerReason.findFirst({ orderBy: { sort: "desc" }, select: { sort: true } });
      r = await tx.entBlockerReason.create({ data: { name, status: "待审核", sort: (末?.sort ?? 0) + 1, createdById: 我 } });
    }
    if (!ids.includes(r.id)) ids.push(r.id);
  }
  return ids;
}

/* ───────────── 读卡点、谁看得到 ───────────── */

type 项目要的 = { id: string; ownerId: string; pooledAt: Date | null; customerId: string; contactId: string | null; phase: string };
const 项目字段 = { id: true, ownerId: true, pooledAt: true, customerId: true, contactId: true, phase: true } as const;
const 卡点带 = {
  project: { select: { ...项目字段, name: true, members: { where: { inviteStatus: "JOINED" }, select: { userId: true } } } },
  claims: { orderBy: { createdAt: "asc" as const } },
  reasons: { include: { reason: { select: { id: true, name: true, status: true } } } },
  logs: { orderBy: { at: "asc" as const } },
} satisfies Prisma.EntBlockerInclude;
type 带全的卡点 = Prisma.EntBlockerGetPayload<{ include: typeof 卡点带 }>;

const 组织of = async (): Promise<组织 | null> => (企业版() ? 读组织() : null);

/** 单条判断用：项目在公海、且历史负责人要回避（C-01）时把历史负责人一起带上 */
async function 相关人(tx: Prisma.TransactionClient, b: 带全的卡点) {
  const 回避人 = b.project.pooledAt !== null && 原负责人回避() ? await 历史负责人(tx, b.projectId) : null;
  return {
    creatorId: b.creatorId, ownerId: b.project.ownerId, 在公海: b.project.pooledAt !== null,
    组员们: b.project.members.map((m) => m.userId), 认领人们: b.claims.map((c) => c.userId), 回避人,
  };
}

/**
 * 我凭上级身份能看谁的卡点（不含我自己）：实线下属整条链 + 虚线下属和他们的实线下属。
 * 和 组织范围of 的「读」同一套（11-01：「上级可以看下级。最下级只能看自己」），只是不认账号角色 ADMIN——卡点只认业务角色
 */
function 我的下属们(org: 组织 | null, 我: string): Set<string> {
  if (!org || !org.成员.has(我)) return new Set();
  const 线上 = (x: string) => 业务线放行(org, 我, { ownerId: x });
  const 读 = new Set([...实线下属(org, 我)].filter(线上));
  for (const d of 虚线下属(org, 我)) for (const x of [d, ...实线下属(org, d)]) if (线上(x)) 读.add(x);
  读.delete(我);
  return 读;
}

/** 「只看自己」时的查询条件，和 看得到卡点 一个意思（含 C-01：我是历史负责人、还在公海里的项目整条剔掉） */
async function 自己的条件(我: string, org: 组织 | null): Promise<Prisma.EntBlockerWhereInput> {
  const 下属们 = [...我的下属们(org, 我)];
  const 回避 = await 我回避的公海项目(prisma, 我);
  const 看得到: Prisma.EntBlockerWhereInput = {
    OR: [
      { creatorId: 我 },
      { project: { pooledAt: null, ownerId: 我 } },
      ...(下属们.length ? [{ project: { pooledAt: null, ownerId: { in: 下属们 } } }] : []),
      { project: { members: { some: { userId: 我, inviteStatus: "JOINED" } } } },
      { claims: { some: { userId: 我 } } },
    ],
  };
  return 回避.length ? { AND: [看得到, { projectId: { notIn: 回避 } }] } : 看得到;
}

async function 拿卡点(tx: Prisma.TransactionClient, blockerId: string): Promise<带全的卡点 | null> {
  return tx.entBlocker.findUnique({ where: { id: String(blockerId ?? "") }, include: 卡点带 });
}

function 记(tx: Prisma.TransactionClient, blockerId: string, userId: string, action: string, extra: { fromUserId?: string | null; toUserId?: string | null; note?: string | null } = {}) {
  return tx.entBlockerLog.create({ data: { blockerId, userId, action, ...extra } });
}

async function 下一个卡点编号(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const 头 = 卡点编号头(now);
  // 项目 / 沟通记录在回收站里的卡点也占着编号（code 唯一），取最大号要连它们一起看
  const 最大 = await 看已删(() => tx.entBlocker.findFirst({ where: { code: { startsWith: 头 } }, orderBy: { code: "desc" }, select: { code: true } }));
  return 拼卡点编号(now, 下一个卡点流水(最大?.code, now));
}

/**
 * 能不能在这个项目上发卡点：能写（开着、不是只读的管理员）、项目不在公海、能编辑这个项目
 * （负责人本人且是销售 / 销售管理，permissions.ts 能编辑项目；卡点从沟通发，和记沟通同一道门）。
 * 总管理、上级、组员不能在别人的项目上发（C2：只能看、转让；看得到的卡点照样能认领、点完成）
 */
function 能发(me: 谁, p: 项目要的, 权: 我的卡点权限, org: 组织 | null): boolean {
  return 权.能写 && !p.pooledAt && 能编辑项目(me, p, org);
}

/* ───────────── 写：发布、认领、我已完成 ───────────── */

/**
 * 从一条沟通记录发布卡点 → 待接受（没人认领）。类型「暂无卡点」不生成（返回 ok、不带 id）。
 * 阻碍原因多选：字典里没有的新建成待审核；一个没选落「其他」
 */
export async function 发布卡点(
  me: 谁, followUpId: string, input: 发布输入, now: Date = new Date(),
): Promise<结果 & { id?: string; code?: string; projectId?: string }> {
  if (!企业版()) return 没开;
  const [默认, 权, org] = await Promise.all([读卡点默认(), 卡点权限(me), 组织of()]);
  if (!权.开) return 没权;
  if (!权.能写) return 只读;
  await 备好原因();
  return 查完再写((tx) => 看全部(async () => {
    const fp = await tx.followUpProject.findUnique({ where: { followUpId: String(followUpId ?? "") }, include: { project: { select: 项目字段 } } });
    if (!fp) return { ok: false as const, error: "卡点要从项目上的一条沟通记录发，这条沟通找不到了，刷新看看" };
    const p = fp.project;
    if (p.pooledAt) return { ok: false as const, error: "这个项目在公海里，先领取再发卡点" };
    if (!能发(me, p, 权, org)) return { ok: false as const, error: "只有项目负责人能发卡点（总管理员、上级、项目组成员只能看，看得到的卡点能认领）" };
    const 好 = 规整发布(input, 默认);
    if (好 === null) return { ok: true as const };
    if ("error" in 好) return { ok: false as const, error: 好.error };
    const ids = await 原因ids(tx, 好.reasons, me.id);
    if (!Array.isArray(ids)) return ids;
    const 第一个 = await tx.entBlockerReason.findUnique({ where: { id: ids[0] }, select: { name: true } });
    const code = await 下一个卡点编号(tx, now);
    const 天 = 写库时限天数[好.type];
    const b = await tx.entBlocker.create({
      data: {
        code, title: 好.title, projectId: p.id, followUpId: fp.followUpId, customerId: p.customerId, contactId: p.contactId, phase: p.phase,
        type: 好.type, impact: 好.impact, obstacle: 第一个?.name ?? 兜底原因, description: 好.description, dueDays: 天,
        dueAt: new Date(now.getTime() + 天 * 24 * 3600_000), resourceRequest: 好.resourceRequest,
        status: "待接受", creatorId: me.id,
        reasons: { create: ids.map((reasonId) => ({ reasonId })) },
      },
    });
    await 记(tx, b.id, me.id, "publish");
    return { ok: true as const, id: b.id, code, projectId: p.id };
  }));
}

/** 认领：看得到就能认领（待接受、处理中都行），一人一行；已解决锁定后不能再加人 */
export async function 认领卡点(me: 谁, blockerId: string): Promise<卡点结果> {
  if (!企业版()) return 没开;
  const [权, org] = await Promise.all([卡点权限(me), 组织of()]);
  if (!权.开) return 没权;
  if (!权.能写) return 只读;
  return 查完再写((tx) => 看全部(async () => {
    const b = await 拿卡点(tx, blockerId);
    if (!b || !看得到卡点(me.id, 权, await 相关人(tx, b), 我的下属们(org, me.id))) return 不在了;
    if (b.status === "已解决") return { ok: false as const, error: "这个卡点已经解决了，不能再认领" };
    if (b.claims.some((c) => c.userId === me.id)) return { ok: false as const, error: "你已经认领了" };
    await tx.entBlockerClaim.create({ data: { blockerId: b.id, userId: me.id } });
    if (b.status !== "处理中") await tx.entBlocker.update({ where: { id: b.id }, data: { status: "处理中" } });
    await 记(tx, b.id, me.id, "claim", { toUserId: me.id });
    return { ok: true as const, projectId: b.projectId, code: b.code };
  }));
}

/**
 * 我已完成：只有认领人自己点自己那行（写处理说明，选填）。
 * 我是最后一个没完成的 → 必须写解决方案、解决结果，整条变已解决、记解决时间、锁定。
 * 整段在一个事务里重算 x/y，状态从「处理中」改「已解决」用带条件的 updateMany：同时点只解决一次
 */
export async function 完成卡点(
  me: 谁, blockerId: string, input: { note?: unknown; solution?: unknown; result?: unknown }, now: Date = new Date(),
): Promise<卡点结果> {
  if (!企业版()) return 没开;
  const [权, org] = await Promise.all([卡点权限(me), 组织of()]);
  if (!权.开) return 没权;
  if (!权.能写) return 只读;
  return 查完再写((tx) => 看全部(async () => {
    const b = await 拿卡点(tx, blockerId);
    if (!b || !看得到卡点(me.id, 权, await 相关人(tx, b), 我的下属们(org, me.id))) return 不在了;
    if (b.status === "已解决") return { ok: false as const, error: "这个卡点已经解决了" };
    const 我的 = b.claims.find((c) => c.userId === me.id);
    if (!我的) return { ok: false as const, error: "你没认领这个卡点" };
    if (我的.done) return { ok: false as const, error: "你已经点过完成了" };
    const note = 规整文字(input?.note, "处理说明");
    if (note && typeof note === "object") return { ok: false as const, error: note.error };
    const 还差 = await tx.entBlockerClaim.count({ where: { blockerId: b.id, done: false, userId: { not: me.id } } });
    let solution: string | null = null, result: string | null = null;
    if (还差 === 0) {
      const s = 规整文字(input?.solution, "解决方案", true);
      if (typeof s !== "string") return { ok: false as const, error: (s as { error: string }).error };
      const r = 规整文字(input?.result, "解决结果", true);
      if (typeof r !== "string") return { ok: false as const, error: (r as { error: string }).error };
      solution = s; result = r;
    }
    const 改 = await tx.entBlockerClaim.updateMany({ where: { blockerId: b.id, userId: me.id, done: false }, data: { done: true, note, doneAt: now } });
    if (改.count !== 1) return { ok: false as const, error: "你已经点过完成了" };
    await 记(tx, b.id, me.id, "done", { note });
    const 剩 = await tx.entBlockerClaim.count({ where: { blockerId: b.id, done: false } });
    let 解决了 = false;
    if (剩 === 0 && solution && result) {
      const 结 = await tx.entBlocker.updateMany({ where: { id: b.id, status: "处理中" }, data: { status: "已解决", solution, result, resolvedAt: now } });
      if (结.count === 1) { await 记(tx, b.id, me.id, "resolve"); 解决了 = true; }
    }
    return { ok: true as const, projectId: b.projectId, code: b.code, 解决了 };
  }));
}

/** 删卡点：只有总管理（director）；连流转、认领行、原因挂接一起删（级联），删了不进回收站 */
export async function 删卡点(me: 谁, blockerId: string): Promise<卡点结果> {
  if (!企业版()) return 没开;
  const 权 = await 卡点权限(me);
  if (!权.能管) return { ok: false as const, error: "只有总管理员能删卡点" };
  return 查完再写((tx) => 看已删(() => 看全部(async () => {
    const b = await tx.entBlocker.findUnique({ where: { id: String(blockerId ?? "") }, select: { id: true, projectId: true, code: true } });
    if (!b) return 不在了;
    await tx.entBlocker.delete({ where: { id: b.id } });
    return { ok: true as const, projectId: b.projectId, code: b.code };
  })));
}

/* ───────────── 换人：离职交接、项目从公海领走 ───────────── */

/**
 * 把一批卡点上 从 的未完成认领行挪给 到：到 已经认领过的，删掉 从 那行，到 那行要是点过完成就退回未完成（多了一份活）。
 * 已解决的不动（锁定）。每条记一行流转。返回挪了几条卡点
 */
async function 挪认领(
  tx: Prisma.TransactionClient, where: Prisma.EntBlockerWhereInput, 从: string, 到: string, 操作人: string, action: string, note: string | null,
): Promise<number> {
  if (从 === 到) return 0;
  const 行们 = await tx.entBlockerClaim.findMany({ where: { userId: 从, done: false, blocker: { ...where, status: { not: "已解决" } } }, select: { id: true, blockerId: true } });
  for (const c of 行们) {
    const 有 = await tx.entBlockerClaim.findUnique({ where: { blockerId_userId: { blockerId: c.blockerId, userId: 到 } } });
    if (有) {
      await tx.entBlockerClaim.delete({ where: { id: c.id } });
      if (有.done) await tx.entBlockerClaim.update({ where: { id: 有.id }, data: { done: false, doneAt: null } });
    } else {
      await tx.entBlockerClaim.update({ where: { id: c.id }, data: { userId: 到 } });
    }
    await 记(tx, c.blockerId, 操作人, action, { fromUserId: 从, toUserId: 到, note });
  }
  return 行们.length;
}

/**
 * 离职交接（B4，在停用成员 / 客户交接的事务里调，签名不变）：他没完成的认领行
 *   - 有交接人的给交接人（项目不在公海、也不跟着这次进公海的那些）；
 *   - 没交接人的（项目跟着进公海 / 本来就在公海，或者没给接手人）→ 他的直属上级（实线）；
 *   - 都没有 → 这一行从 x/y 里去掉，记一行流转。去掉以后一个认领人都不剩的卡点回到「待接受」。
 * 和接手人已有的行合并时，那行退回未完成（挪认领）。不是企业版什么都不做
 */
export const 离职交接理由 = "成员停用，离职交接";
export const 离职转上级理由 = "成员停用，没有交接人，转给直属上级";
export const 离职去掉理由 = "成员停用，没有交接人也没有直属上级，认领行去掉";
export async function 交接卡点(tx: Prisma.TransactionClient, 走的人: string, 接手人: string | null, 操作人: string, 进公海项目: readonly string[]): Promise<number> {
  if (!企业版() || !走的人) return 0;
  return 看全部(async () => {
    let 数 = 0;
    const 有交接人 = { projectId: { notIn: [...进公海项目] }, project: { pooledAt: null } } satisfies Prisma.EntBlockerWhereInput;
    if (接手人 && 接手人 !== 走的人) 数 += await 挪认领(tx, 有交接人, 走的人, 接手人, 操作人, "handover", 离职交接理由);
    // 剩下的（没交接人）：直属上级接；上级也停用了不算
    const org = await 组织of();
    const 上级 = org ? 直属上级of(org, 走的人) : null;
    const 上级在职 = 上级 && 上级 !== 走的人 ? (await tx.user.findUnique({ where: { id: 上级 }, select: { active: true } }))?.active : false;
    if (上级 && 上级在职) return 数 + await 挪认领(tx, {}, 走的人, 上级, 操作人, "handover", 离职转上级理由);
    const 行们 = await tx.entBlockerClaim.findMany({ where: { userId: 走的人, done: false, blocker: { status: { not: "已解决" } } }, select: { id: true, blockerId: true } });
    for (const c of 行们) {
      await tx.entBlockerClaim.delete({ where: { id: c.id } });
      await 记(tx, c.blockerId, 操作人, "handover", { fromUserId: 走的人, toUserId: null, note: 离职去掉理由 });
      // 一个认领人都不剩：回到待接受（还有别人在的照旧处理中，最后一个点完成的人写方案和结果）
      if ((await tx.entBlockerClaim.count({ where: { blockerId: c.blockerId } })) === 0) {
        await tx.entBlocker.updateMany({ where: { id: c.blockerId, status: "处理中" }, data: { status: "待接受" } });
      }
    }
    return 数 + 行们.length;
  });
}

/**
 * B5：项目换了人，原来那位在这个项目卡点上没完成的认领行由接手的人接过去（挪认领：合并、已解决不动、每条记一行 takeover）。
 * 接线：记转让（公海领取 / 分配公海项目 / 线索分项目 / 改项目换负责人 / 客户转让撤销还项目）、转项目（客户整体转让带着走）、
 * 领客户带走公海项目、移出组员（被移出的人 → 项目负责人）。放回公海不调：没解决的卡点在公海期间原样留着，
 * 不公开（只按 只看自己 的规矩给相关的人看；历史负责人回避开着时他也看不到，见 看得到卡点 的回避人）。
 * 离职交接不走这里（交接卡点 有自己的去向规则）
 */
export const 公海领走接手理由 = "项目从公海领走，接手原负责人的卡点";
export const 转让接手理由 = "项目换负责人，接手原负责人的卡点";
export const 移出组员接手理由 = "移出项目组，认领行转给项目负责人";
export async function 卡点随项目换人(
  tx: Prisma.TransactionClient, projectId: string, 原负责人: string, 新负责人: string, 操作人: string = 新负责人, 理由: string = 公海领走接手理由,
): Promise<number> {
  if (!企业版() || !原负责人 || !新负责人) return 0;
  return 看全部(() => 挪认领(tx, { projectId }, 原负责人, 新负责人, 操作人, "takeover", 理由));
}

/* ───────────── 沟通删了卡点留着（B13） ───────────── */

let followUpId可空: boolean | null = null;
/** 老库的 EntBlocker.followUpId 是 NOT NULL + 级联（建表时那样，迁移改不了约束）；新装的库按 prisma 建，可空、SetNull */
async function 沟通列可空(tx: Prisma.TransactionClient): Promise<boolean> {
  if (followUpId可空 !== null) return followUpId可空;
  const 列 = await tx.$queryRawUnsafe<{ name: string; notnull: number | bigint }[]>(`PRAGMA table_info("EntBlocker")`);
  followUpId可空 = Number(列.find((c) => c.name === "followUpId")?.notnull ?? 1) === 0;
  return followUpId可空;
}
/** 测试用：换库之后重新探 */
export function 忘掉沟通列(): void { followUpId可空 = null; }

/**
 * 彻底删沟通记录之前调：这些沟通上的卡点脱开（followUpId 置空），卡点照旧在。
 * 老库置不了空：返回「还挂着卡点、这次不能彻底删」的沟通 id，调用方跳过它们（留在回收站里）
 */
export async function 卡点脱离沟通(tx: Prisma.TransactionClient, followUpIds: readonly string[]): Promise<Set<string>> {
  if (!followUpIds.length) return new Set();
  const 挂着 = await 看已删(() => 看全部(() => tx.entBlocker.findMany({ where: { followUpId: { in: [...followUpIds] } }, select: { followUpId: true } })));
  if (!挂着.length) return new Set();
  if (await 沟通列可空(tx)) {
    await 看已删(() => 看全部(() => tx.entBlocker.updateMany({ where: { followUpId: { in: [...followUpIds] } }, data: { followUpId: null } })));
    return new Set();
  }
  return new Set(挂着.map((b) => b.followUpId!).filter(Boolean));
}

/* ───────────── 给界面的视图 ───────────── */

export type 卡点流转 = { id: string; action: string; at: Date; 谁: string; 从: string | null; 到: string | null; note: string | null };
export type 认领行 = { userId: string; 名字: string; done: boolean; note: string | null; doneAt: Date | null; 是我: boolean };
export type 卡点视图 = {
  id: string; code: string; title: string; projectId: string; 项目: string; followUpId: string | null; phase: string;
  type: string; impact: string; 原因们: { id: string; name: string; status: string }[]; description: string;
  status: string; creatorId: string; 发布人: string;
  resourceRequest: string | null; solution: string | null; result: string | null; resolvedAt: Date | null;
  createdAt: Date; 认领: 认领行[]; 进度: { 完成: number; 共: number }; 流转: 卡点流转[];
  /** 老卡点（没挂阻碍原因）原来的阻碍主体，详情里显示「原阻碍主体：X」；新卡点 null */
  原阻碍主体: string | null;
  /** 我在这条上能点什么（管理员只读：认领、完成都是 false；删只有总管理） */
  能: { 认领: boolean; 完成: boolean; 最后一个: boolean; 删: boolean };
};

/** 给界面（客户端组件）的样子：日子排成字符串，不带创建人 id */
export type 卡点卡 = Omit<卡点视图, "resolvedAt" | "createdAt" | "流转" | "creatorId" | "认领"> & {
  resolvedAt: string | null; createdAt: string;
  认领: (Omit<认领行, "doneAt" | "userId"> & { doneAt: string | null })[];
  流转: (Omit<卡点流转, "at"> & { at: string })[];
};
export function 卡点给界面(v: 卡点视图): 卡点卡 {
  const { creatorId: _c, ...rest } = v;
  void _c;
  return {
    ...rest, resolvedAt: v.resolvedAt?.toISOString() ?? null, createdAt: v.createdAt.toISOString(),
    认领: v.认领.map(({ userId: _u, ...c }) => { void _u; return { ...c, doneAt: c.doneAt?.toISOString() ?? null }; }),
    流转: v.流转.map((l) => ({ ...l, at: l.at.toISOString() })),
  };
}

async function 名字们(ids: (string | null)[]): Promise<Map<string, string>> {
  const 们 = [...new Set(ids.filter((x): x is string => !!x))];
  if (!们.length) return new Map();
  const us = await 看全部(() => prisma.user.findMany({ where: { id: { in: 们 } }, select: { id: true, name: true, email: true } }));
  return new Map(us.map((u) => [u.id, u.name || u.email]));
}

async function 成视图(me: 谁, 们: 带全的卡点[], 权: 我的卡点权限): Promise<卡点视图[]> {
  const 名 = await 名字们(们.flatMap((b) => [b.creatorId, ...b.claims.map((c) => c.userId), ...b.logs.flatMap((l) => [l.userId, l.fromUserId, l.toUserId])]));
  return 们.map((b) => {
    const 我的 = b.claims.find((c) => c.userId === me.id);
    const 进度 = 会签进度(b.claims);
    const 开着 = 权.能写 && b.status !== "已解决";
    return {
      id: b.id, code: b.code, title: b.title || b.description.slice(0, 20), projectId: b.projectId, 项目: b.project.name, followUpId: b.followUpId, phase: b.phase,
      type: b.type, impact: b.impact, 原因们: b.reasons.map((l) => l.reason), description: b.description,
      原阻碍主体: b.reasons.length === 0 ? (b.obstacle || null) : null,
      status: b.status, creatorId: b.creatorId, 发布人: 名.get(b.creatorId) ?? "—",
      resourceRequest: b.resourceRequest, solution: b.solution, result: b.result, resolvedAt: b.resolvedAt, createdAt: b.createdAt,
      认领: b.claims.map((c) => ({ userId: c.userId, 名字: 名.get(c.userId) ?? "—", done: c.done, note: c.note, doneAt: c.doneAt, 是我: c.userId === me.id })),
      进度: { 完成: 进度.完成, 共: 进度.共 },
      流转: b.logs.map((l) => ({
        id: l.id, action: l.action, at: l.at, 谁: 名.get(l.userId) ?? "—",
        从: l.fromUserId ? 名.get(l.fromUserId) ?? "—" : null, 到: l.toUserId ? 名.get(l.toUserId) ?? "—" : null, note: l.note,
      })),
      能: {
        认领: 开着 && !我的,
        完成: 开着 && !!我的 && !我的.done,
        最后一个: 开着 && !!我的 && !我的.done && 进度.共 - 进度.完成 === 1,
        删: 权.能管,
      },
    };
  });
}

/** 我看得到的卡点（再并上调用方的条件）：没开 = 空；全部 = 不限；只看自己 = 自己的条件 */
async function 看得到的(me: 谁, where: Prisma.EntBlockerWhereInput, opt: { 只看自己?: boolean; orderBy?: Prisma.EntBlockerOrderByWithRelationInput[]; take?: number } = {}): Promise<卡点视图[]> {
  if (!企业版()) return [];
  const [权, org] = await Promise.all([卡点权限(me), 组织of()]);
  if (!权.开) return [];
  const 范围 = 权.全部 && !opt.只看自己 ? {} : await 自己的条件(me.id, org);
  return 看全部(async () => {
    const 们 = await prisma.entBlocker.findMany({ where: { AND: [范围, where] }, include: 卡点带, orderBy: opt.orderBy ?? [{ createdAt: "desc" }], take: opt.take });
    return 成视图(me, 们, 权);
  });
}

/** 项目详情里的卡点 */
export async function 项目的卡点(me: 谁, projectId: string): Promise<卡点视图[]> {
  return 看得到的(me, { projectId: String(projectId ?? "") });
}

/** 我的卡点（项目列表页）：我认领了还没点完成的，加上我看得到的、还没人认领的（只按自己相关的算，不看全部） */
export async function 我的卡点(me: 谁): Promise<卡点视图[]> {
  return 看得到的(me, { OR: [{ status: "待接受" }, { status: "处理中", claims: { some: { userId: me.id, done: false } } }] }, { 只看自己: true, orderBy: [{ createdAt: "asc" }] });
}

/** 项目详情要不要给「发卡点」按钮：和 发布卡点 同一个判断 */
export async function 能发卡点(me: 谁, projectId: string): Promise<boolean> {
  if (!企业版()) return false;
  const [权, org] = await Promise.all([卡点权限(me), 组织of()]);
  if (!权.开) return false;
  return 看全部(async () => {
    const p = await prisma.project.findUnique({ where: { id: String(projectId ?? "") }, select: 项目字段 });
    return !!p && 能发(me, p, 权, org);
  });
}

/* ───────────── 复盘看板：三栏 + 筛选 + 统计（B15） ───────────── */

export type 看板筛选 = {
  我的认领?: boolean; 只看自己?: boolean; 原因?: string; 类型?: string; 影响?: string; 项目?: string;
};
export type 看板统计 = { 未解决: number; 已解决: number; 按影响: { 名: string; 数: number }[]; 按原因: { id: string; 名: string; 状态: string; 数: number }[] };
export type 卡点看板数 = { 开: boolean; 全部: boolean; 栏: Record<卡点状态, 卡点视图[]>; 已解决共: number; 统计: 看板统计; 项目们: { id: string; name: string }[]; 原因们: { id: string; name: string; status: string }[] };
/** 已解决那一栏只列最近的这么多条（总数照数） */
export const 已解决栏上限 = 50;

export function 看板条件(f: 看板筛选, 我: string): Prisma.EntBlockerWhereInput {
  const 且: Prisma.EntBlockerWhereInput[] = [];
  if (f.我的认领) 且.push({ claims: { some: { userId: 我 } } });
  // 未分类（老数据）：一个原因都没挂的老卡点（B9）
  if (f.原因) 且.push(f.原因 === 未分类原因id ? { reasons: { none: {} } } : { reasons: { some: { reasonId: f.原因 } } });
  if (f.类型 && (卡点类型们 as readonly string[]).includes(f.类型)) 且.push({ type: f.类型 });
  if (f.影响 && (影响等级们 as readonly string[]).includes(f.影响)) 且.push({ impact: f.影响 });
  if (f.项目) 且.push({ projectId: f.项目 });
  return 且.length ? { AND: 且 } : {};
}

export async function 卡点看板(me: 谁, f: 看板筛选 = {}): Promise<卡点看板数> {
  const 空栏 = { 待接受: [], 处理中: [], 已解决: [] } as Record<卡点状态, 卡点视图[]>;
  const 空 = { 开: false, 全部: false, 栏: 空栏, 已解决共: 0, 统计: { 未解决: 0, 已解决: 0, 按影响: [], 按原因: [] }, 项目们: [], 原因们: [] };
  if (!企业版()) return 空;
  const [权, org] = await Promise.all([卡点权限(me), 组织of()]);
  if (!权.开) return 空;
  await 备好原因();
  const 范围 = 权.全部 && !f.只看自己 ? {} : await 自己的条件(me.id, org);
  const where: Prisma.EntBlockerWhereInput = { AND: [范围, 看板条件(f, me.id)] };
  return 看全部(async () => {
    const [开着, 解决了, 已解决共, 按影响, 原因数, 未分类数, 项目们] = await Promise.all([
      prisma.entBlocker.findMany({ where: { AND: [where, { status: { not: "已解决" } }] }, include: 卡点带, orderBy: [{ createdAt: "asc" }] }),
      prisma.entBlocker.findMany({ where: { AND: [where, { status: "已解决" }] }, include: 卡点带, orderBy: [{ resolvedAt: "desc" }], take: 已解决栏上限 }),
      prisma.entBlocker.count({ where: { AND: [where, { status: "已解决" }] } }),
      prisma.entBlocker.groupBy({ by: ["impact"], where, _count: { _all: true } }),
      prisma.entBlockerReasonLink.groupBy({ by: ["reasonId"], where: { blocker: where }, _count: { _all: true } }),
      prisma.entBlocker.count({ where: { AND: [where, { reasons: { none: {} } }] } }),
      // 项目筛选的下拉：我看得到的卡点挂在哪些项目上（不带项目筛选本身）
      prisma.entBlocker.findMany({ where: 范围, distinct: ["projectId"], select: { project: { select: { id: true, name: true } } } }),
    ]);
    const 视图 = await 成视图(me, [...开着, ...解决了], 权);
    const 栏: Record<卡点状态, 卡点视图[]> = { 待接受: [], 处理中: [], 已解决: [] };
    for (const v of 视图) (栏[v.status as 卡点状态] ?? 栏.待接受).push(v);
    // 原因筛选的下拉：没并走的都列（停用的老卡点上还挂着，照样能筛）
    const 原因们 = await prisma.entBlockerReason.findMany({ where: { mergedIntoId: null }, select: { id: true, name: true, status: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] });
    const 用到的 = await prisma.entBlockerReason.findMany({ where: { id: { in: 原因数.map((r) => r.reasonId) } }, select: { id: true, name: true, status: true } });
    const 原因of = new Map(用到的.map((r) => [r.id, r]));
    return {
      开: true, 全部: 权.全部, 栏, 已解决共,
      统计: {
        未解决: 开着.length, 已解决: 已解决共,
        按影响: 影响等级们.map((名) => ({ 名, 数: 按影响.find((x) => x.impact === 名)?._count._all ?? 0 })),
        按原因: 原因数
          .map((r) => ({ id: r.reasonId, 名: 原因of.get(r.reasonId)?.name ?? "—", 状态: 原因of.get(r.reasonId)?.status ?? "启用", 数: r._count._all }))
          .sort((a, b) => b.数 - a.数 || a.名.localeCompare(b.名))
          .concat(未分类数 ? [{ id: 未分类原因id, 名: 未分类原因名, 状态: "未分类", 数: 未分类数 }] : []),
      },
      项目们: 项目们.map((x) => x.project).sort((a, b) => a.name.localeCompare(b.name)),
      // 下拉最后多一项「未分类（老数据）」，筛没挂原因的老卡点
      原因们: [...原因们, { id: 未分类原因id, name: 未分类原因名, status: "未分类" }],
    };
  });
}

/** 项目详情里每条沟通的编号和下一步时间（不是企业版给空的） */
export async function 沟通编号们(followUpIds: string[]): Promise<Map<string, { code: string; nextAt: Date | null }>> {
  if (!企业版() || !followUpIds.length) return new Map();
  const 们 = await prisma.entFollowUpMeta.findMany({ where: { followUpId: { in: followUpIds } }, select: { followUpId: true, code: true, nextAt: true } });
  return new Map(们.map((m) => [m.followUpId, { code: m.code, nextAt: m.nextAt }]));
}

export { 卡点状态们 };
