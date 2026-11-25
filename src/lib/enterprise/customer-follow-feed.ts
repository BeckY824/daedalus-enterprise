/**
 * 企业版客户页的「沟通记录」（2026-10-29 P14 第 6 条）：只读时间线，汇总这位客户在各项目里的跟进。
 *
 * 收哪些：
 *   - 客户本身挂的老跟进（不属于任何项目的）；
 *   - 这位客户是主客户的项目、或以关联客户挂进去的项目（ProjectCustomer，P17），这些项目下的跟进。
 * 看不到的项目一条都不出、也不报数：
 *   - 候选项目全走带限定的客户端（Project / ProjectCustomer / FollowUpProject 都按项目可见范围滤，team-scope.ts）；
 *   - 再照项目详情页的口子（lib/project/db.ts 露客户）：公海里同事客户的项目，沟通内容领了再看——这里也不出。
 * 最后那一查用 看全部：关联项目的跟进挂在那个项目的主客户名下，限定层按客户滤会把我看得到的项目的记录也滤掉；
 * 项目 id 已经是上面滤过的，跟项目详情页「沟通」卡给的是同一批。
 */
import { 改过的沟通们 } from "./follow-edited";
import { 沟通附件们 } from "@/lib/attachments";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 露客户, 看得到的客户 } from "@/lib/project/db";
import { 能往项目记沟通, 能记售后回访, 售后客户 } from "@/lib/project/follow-needs-project";
import { 是交付, 同名们 } from "@/lib/project/stage-dict";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";

/** 判客户看不看得到用哪个：服务端动作（翻页）现读 看得到的客户；客户页渲染传请求内缓存的 页面看得到的客户（lib/project/visible-customers.ts） */
export type 可见法 = (ids: string[]) => Promise<Set<string>>;
import { 我回避的公海项目, 回避豁免 } from "@/lib/project/pool-owner";
import { followHistoryInclude, followHistoryOrder, serializeFollowHistory } from "@/app/(app)/customers/[id]/follow-history-query";
import type { FollowUpRow } from "@/app/(app)/customers/[id]/types";
import type { 附件 } from "@/lib/attachment-rules";
import { 是同号留痕 } from "./same-number-mark";

export type 沟通游标 = { occurredAt: string; id: string };
export const 汇总每页 = 50;
/** 一位客户最多汇总多少个项目（查询里 in 的上限；正常远到不了） */
const 项目上限 = 500;

type 项目行 = { id: string; name: string; customerId: string; ownerId: string; pooledAt: Date | null; result: string | null; nextStepAt: Date | null; nextStepText: string | null; updatedAt: Date; members: { inviteStatus: string }[] };

/**
 * 这位客户、当前这位看得到沟通内容的项目（主客户是它的 + 关联进来的；连挂过 = 再加历史上挂过这位跟进的）。
 * 只挂过 = 这一个只因「挂过」才在里面（主客户不是它、也没关联它）：连挂过 = true 的结果滤掉这些，就是连挂过 = false 的结果
 * （每个项目自己过可见、回避，不看别的项目；顺序按 updatedAt 排，滤掉几个不改别的先后）
 */
async function 看得到的项目们(me: { id: string; role?: string }, customerId: string, 连挂过: boolean, 可见: 可见法): Promise<{ 行: 项目行; 主: boolean; 只挂过: boolean }[]> {
  const [主, 关联, 挂过] = await Promise.all([
    prisma.project.findMany({ where: { customerId }, select: { id: true }, take: 项目上限 }),
    prisma.projectCustomer.findMany({ where: { customerId }, select: { projectId: true }, take: 项目上限 }),
    // 历史上记在这位客户名下、后来挂到项目上的（项目主客户改过的老数据）
    连挂过 ? prisma.followUpProject.findMany({ where: { followUp: { customerId } }, select: { projectId: true }, distinct: ["projectId"], take: 项目上限 }) : Promise.resolve([]),
  ]);
  const 直接 = new Set([...主.map((p) => p.id), ...关联.map((r) => r.projectId)]);
  const ids = [...new Set([...直接, ...挂过.map((r) => r.projectId)])];
  if (ids.length === 0) return [];
  const ps = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, customerId: true, ownerId: true, pooledAt: true, result: true, nextStepAt: true, nextStepText: true, updatedAt: true, members: { where: { userId: me.id }, select: { inviteStatus: true } } },
    orderBy: { updatedAt: "desc" },
  });
  // 公海里我是历史负责人的项目：沟通入口、时间线都不出（C-01，lib/project/pool-owner.ts；总管理 / 管理员照出）
  const [看得到, 回避] = await Promise.all([可见(ps.map((p) => p.customerId)), 回避豁免(me).then((免) => (免 ? ([] as string[]) : 我回避的公海项目(prisma, me.id)))]);
  return ps.filter((p) => 露客户(me, p, 看得到) && !回避.includes(p.id)).map((p) => ({ 行: p, 主: p.customerId === customerId, 只挂过: !直接.has(p.id) }));
}

const 项目名表 = (们: { 行: 项目行 }[]) => new Map(们.map(({ 行 }) => [行.id, 行.name]));

/** 汇总时间线收哪些项目：id → 名称 */
export async function 汇总的项目(me: { id: string; role?: string }, customerId: string, 可见: 可见法 = 看得到的客户): Promise<Map<string, string>> {
  return 项目名表(await 看得到的项目们(me, customerId, true, 可见));
}

/** 「跟进」菜单列的项目（第 3 条）：主客户的 + 关联进来的，进行中的在前、各自按最近改动排 */
export type 跟进去处 = {
  id: string;
  名: string;
  /** 这位是主客户（否则是关联进来的） */
  主: boolean;
  /** 有结局或在公海里：还能点进去看，排到后面、菜单上标一句 */
  结束: boolean;
  说明: "已结束" | "在公海" | null;
  /** 项目下一步时间（ISO）；待办里摆一行只读的（第 2 条） */
  下一步: string | null;
  /** 项目下一步做什么（10-29 起记沟通时自己写的一句话）；老数据只有时间、这里是空 */
  下一步文字: string | null;
  /** 我能往这个项目记沟通（和项目详情记沟通同一条：负责人或已进组的组员，11-17；只看的上级是 false）。客户页「关联项目」下拉只列这些 */
  能记: boolean;
  /**
   * 售后回访（11-25，E-283）：这是交付结清的项目、我能在上面记售后回访（项目负责人 / 已进组组员 / 客户负责人，客户不在公海；同 能记售后回访）。
   * 客户页记沟通框「关联项目」另列一组「已交付结清 · 售后回访」只列这些；不给 = 不能
   */
  能记售后?: true;
};
/** 客户页渲染时手上已有的两格（客户负责人、在不在公海），给了就不再查一句 */
export type 售后客户格 = { 客户负责人: string | null; 客户在公海: boolean };
export async function 跟进去处们(me: { id: string; role?: string }, customerId: string, 可见: 可见法 = 看得到的客户, 客?: 售后客户格): Promise<跟进去处[]> {
  const org = await 权限组织();
  const 们 = await 看得到的项目们(me, customerId, false, 可见);
  return 排去处(me, 们, org, await 售后去处(me, customerId, 们, org, 客));
}

/**
 * 售后回访的去处（11-25）：看得到的交付结清项目（主客户是这位的）逐个判我能不能记；我是客户负责人时，
 * 看不到的交付结清项目（企业版项目不跟客户走，别人负责、我没进组）按 id 取全补进来——服务端 可记沟通项目们 同一批。
 * 客户在公海一个都不给。只在有交付结清项目、或我是客户负责人时才多查（不是企业版不查）
 */
async function 售后去处(me: { id: string; role?: string }, customerId: string, 们: { 行: 项目行; 主: boolean }[], org: Awaited<ReturnType<typeof 权限组织>>, 给的?: 售后客户格): Promise<{ 能记: Set<string>; 补: 跟进去处[] }> {
  const 空 = { 能记: new Set<string>(), 补: [] };
  if (!企业版() || !org) return 空;
  const 交付 = 们.filter((x) => x.主 && 是交付(x.行.result));
  const 客 = 给的 ?? (交付.length ? await 售后客户(customerId) : null);
  if (!客 || 客.客户在公海) return 空;
  const 谁 = { id: me.id, role: me.role ?? "" };
  const 能记 = new Set(交付.filter((x) => 能记售后回访(谁, { ...x.行, ...客 }, org, x.行.members[0]?.inviteStatus)).map((x) => x.行.id));
  if (客.客户负责人 !== me.id) return { 能记, 补: [] };
  const 有 = new Set(们.map((x) => x.行.id));
  const 看不到的 = await 看全部(() => prisma.project.findMany({
    where: { customerId, result: { in: 同名们("交付结清") } }, select: { id: true, name: true, ownerId: true, result: true }, orderBy: { updatedAt: "desc" }, take: 50,
  }));
  const 补 = 看不到的.filter((p) => !有.has(p.id) && 能记售后回访(谁, { ...p, ...客 }, org, null)).map((p): 跟进去处 => ({
    id: p.id, 名: p.name, 主: true, 结束: true, 说明: "已结束", 下一步: null, 下一步文字: null, 能记: false, 能记售后: true,
  }));
  return { 能记, 补 };
}

function 排去处(me: { id: string; role?: string }, 项目们: { 行: 项目行; 主: boolean }[], org: Awaited<ReturnType<typeof 权限组织>>, 售后: { 能记: Set<string>; 补: 跟进去处[] } = { 能记: new Set(), 补: [] }): 跟进去处[] {
  const 行们 = 项目们.map(({ 行, 主 }) => ({
    id: 行.id,
    名: 行.name,
    主,
    结束: !!行.result || !!行.pooledAt,
    说明: 行.result ? ("已结束" as const) : 行.pooledAt ? ("在公海" as const) : null,
    下一步: 行.nextStepAt?.toISOString() ?? null,
    下一步文字: 行.nextStepText,
    能记: 能往项目记沟通({ id: me.id, role: me.role ?? "" }, 行, org, 行.members[0]?.inviteStatus),
    ...(售后.能记.has(行.id) ? { 能记售后: true as const } : {}),
  }));
  return [...行们.filter((x) => !x.结束), ...行们.filter((x) => x.结束), ...售后.补];
}

/** 挂在这些项目上的跟进记在哪几位客户名下（去重）。从 FollowUpProject 出发走 projectId 索引、再按主键连跟进，只碰这几个项目的那几条 */
async function 挂项目的客户们(ids: string[]): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ c: string }[]>(
    `SELECT DISTINCT f."customerId" AS c FROM "FollowUpProject" lk CROSS JOIN "FollowUp" f WHERE f.id = lk."followUpId" AND lk."projectId" IN (SELECT value FROM json_each(?))`,
    JSON.stringify(ids),
  );
  return rows.map((r) => r.c);
}

/** 和 followHistoryOrder 同一个顺序（occurredAt 倒序、同一刻按 id 倒序；id 按字节比，同 SQLite 的 BINARY） */
function 按时间线顺序(a: { occurredAt: Date; id: string }, b: { occurredAt: Date; id: string }): number {
  return +b.occurredAt - +a.occurredAt || Buffer.compare(Buffer.from(b.id), Buffer.from(a.id));
}

/**
 * 一页：新的在前，游标是不可变的排序边界（同 loadFollowHistory）。
 * 调用方先确认这位客户当前这位看得到（客户页本身就要看得到）。
 */
export async function 客户沟通汇总(me: { id: string; role?: string }, customerId: string, before?: 沟通游标, 可见: 可见法 = 看得到的客户): Promise<{ rows: FollowUpRow[]; hasMore: boolean }> {
  return 汇总一页(customerId, await 汇总的项目(me, customerId, 可见), before);
}

/**
 * 客户页渲染一次要两样（沟通记录第一页 + 「跟进」菜单）：看得到的项目只算一遍（连挂过 = true），
 * 菜单滤掉只从「挂过」来的——和分开调 客户沟通汇总、跟进去处们 结果一样，少算一遍项目（主客户、关联、项目行、客户可见、回避各一句）
 */
export async function 客户页沟通两样(me: { id: string; role?: string }, customerId: string, 可见: 可见法 = 看得到的客户, 客?: 售后客户格): Promise<[{ rows: FollowUpRow[]; hasMore: boolean }, 跟进去处[]]> {
  const [们, org] = await Promise.all([看得到的项目们(me, customerId, true, 可见), 权限组织()]);
  const 菜单 = 们.filter((x) => !x.只挂过);
  return Promise.all([汇总一页(customerId, 项目名表(们), undefined), 售后去处(me, customerId, 菜单, org, 客).then((售后) => 排去处(me, 菜单, org, 售后))]);
}

/** 客户列表「最近跟进」那一句最多给多少字（列里一行省略，悬停看全文） */
export const 一句字数 = 120;

/**
 * 客户列表这一页取「最近跟进那一条」的查询（员工反馈 2I）：一页一句，不随行数加查询。
 * 只按 customerId 筛、先按 customerId 排，走 (customerId, occurredAt) 索引（同记录页窄名单，tests/perf-85k-indexes.test.ts 钉着）；
 * 不在句子里给 occurredAt 加上下界：带着时间范围 SQLite（没统计信息）改挑 (deletedAt, occurredAt) 把这段时间的跟进全扫一遍再排（试过、计划里钉着）。
 * 「不晚于现在」（同 customers/[id]/actions.ts 重算 lastFollowAt 的口径）在读回来以后滤。这一页没有跟进过的客户不查；都没有 = null
 */
export function 最近一句取法(行们: readonly { id: string; lastFollowAt: Date | null }[]) {
  const 有 = 行们.filter((r) => r.lastFollowAt);
  if (!有.length) return null;
  return {
    where: { customerId: { in: 有.map((r) => r.id) } },
    orderBy: [{ customerId: "asc" as const }, { occurredAt: "desc" as const }, { id: "desc" as const }],
    select: { customerId: true, occurredAt: true, content: true, title: true, projectNode: { select: { projectId: true } } },
  } satisfies Prisma.FollowUpFindManyArgs;
}

/**
 * 客户列表「最近跟进」后面那一句（员工反馈 2I，11-17：「最近跟进（时间 + 一句）」）：客户 id → 一句。
 * 时间就是 Customer.lastFollowAt（#307 筛选、排序同一个字段，全量），一句 = 它背后那一条（没删、不晚于现在里最晚的）的内容，空白收拢、截到 一句字数。
 * 内容的可见范围同客户页「沟通记录」（上面 看得到的项目们 / 汇总一页）：按项目滤开着时，那一条挂在我看不到的项目上（不在限定层给的项目里、
 * 露客户 不过、公海里我回避的）就不给这一句——不退回去给更早那条，时间和一句要对得上；挂在这位客户名下删了的项目上照给（客户页也照摆）。
 * 行们只能是这个人看得到的客户（列表这一页）：跟进那句用 看全部，挂项目那一格不让限定层滤成空（滤成空会被当成「没挂项目」露出来）
 */
export async function 列表最近一句们(me: { id: string; role?: string }, 行们: readonly { id: string; lastFollowAt: Date | null }[], 按项目滤: boolean, 可见: 可见法 = 看得到的客户): Promise<Record<string, string>> {
  const 取法 = 最近一句取法(行们);
  if (!取法) return {};
  const 今 = Date.now();
  const 全 = await 看全部(() => prisma.followUp.findMany(取法));
  const 最近 = new Map<string, (typeof 全)[number]>();
  // 同号再次录入的系统留痕不续最近跟进（same-number-mark.ts），句子也跳过它，和 lastFollowAt 对得上；读回来再滤，不改句子（计划钉在 perf-85k-indexes）
  for (const f of 全) if (f.occurredAt.getTime() <= 今 && !是同号留痕(f.title) && !最近.has(f.customerId)) 最近.set(f.customerId, f);
  const pids = 按项目滤 ? [...new Set([...最近.values()].flatMap((f) => (f.projectNode ? [f.projectNode.projectId] : [])))] : [];
  const 能看 = new Set<string>();
  const 删了的 = new Map<string, string>();
  if (pids.length) {
    // 限定层给的项目（没删的）；常见情形到这一句就够了，下面三样只在用得上时才查（一页最多多这几句，和行数无关）
    const ps = await prisma.project.findMany({ where: { id: { in: pids } }, select: { id: true, customerId: true, ownerId: true, pooledAt: true } });
    // 这一页的客户本来就是我看得到的（列表那句走的限定层）：主客户是别家的才另判
    const 本页 = new Set(行们.map((r) => r.id));
    const 别家 = [...new Set(ps.map((p) => p.customerId).filter((c) => !本页.has(c)))];
    const 给了 = new Set(ps.map((p) => p.id));
    const 没给 = pids.filter((id) => !给了.has(id));
    const [看得到别家, 回避, 删] = await Promise.all([
      别家.length ? 可见(别家) : Promise.resolve(new Set<string>()),
      // 回避只管公海里的项目（我回避的公海项目）：这几个都不在公海就不读回避名单
      ps.some((p) => p.pooledAt) ? 回避豁免(me).then((免) => (免 ? ([] as string[]) : 我回避的公海项目(prisma, me.id))) : Promise.resolve([] as string[]),
      // 没给的里面可能是删了的项目（客户页照摆挂在这位名下删了的项目上的沟通）
      没给.length ? 看全部(() => 看已删(() => prisma.project.findMany({ where: { id: { in: 没给 }, deletedAt: { not: null } }, select: { id: true, customerId: true } }))) : Promise.resolve([]),
    ]);
    const 看得到 = new Set([...本页, ...看得到别家]);
    for (const p of ps) if (露客户(me, p, 看得到) && !回避.includes(p.id)) 能看.add(p.id);
    for (const p of 删) 删了的.set(p.id, p.customerId);
  }
  const 结果: Record<string, string> = {};
  for (const [cid, f] of 最近) {
    const pid = 按项目滤 ? f.projectNode?.projectId : undefined;
    if (pid && !能看.has(pid) && 删了的.get(pid) !== cid) continue;
    const 句 = (f.content || f.title).replace(/\s+/g, " ").trim().slice(0, 一句字数);
    if (句) 结果[cid] = 句;
  }
  return 结果;
}

/**
 * 这位客户名下的跟进、当前这位能看的那些（审核 11-18 权限 P1-5，P-看-12）：给按客户直接读跟进的老接口（翻页、重读一条、挑客户近况、临战简报）用，
 * 同 汇总一页 这位客户那一句——不挂项目的 + 挂在我看得到的项目上的 + 挂在这位名下删了的项目上的。
 * 不是企业版只用项目 = null（不滤，照原样）
 */
export async function 客户跟进可见条件(me: { id: string; role?: string }, customerId: string, 可见: 可见法 = 看得到的客户): Promise<Prisma.FollowUpWhereInput | null> {
  if (!(await 企业版只用项目())) return null;
  const [项目们, 删了的] = await Promise.all([
    汇总的项目(me, customerId, 可见),
    看全部(() => 看已删(() => prisma.project.findMany({ where: { customerId, deletedAt: { not: null } }, select: { id: true }, take: 项目上限 }))),
  ]);
  const 这位的项目 = [...项目们.keys(), ...删了的.map((p) => p.id)];
  return 这位的项目.length ? { OR: [{ projectNode: null }, { projectNode: { projectId: { in: 这位的项目 } } }] } : { projectNode: null };
}

async function 汇总一页(customerId: string, 项目们: Map<string, string>, before?: 沟通游标): Promise<{ rows: FollowUpRow[]; hasMore: boolean }> {
  const ids = [...项目们.keys()];
  /*
    这位客户名下进了回收站的项目：挂在上面、记在这位客户名下的沟通照旧留在客户下（删项目时就是这么说的），
    和客户本身的老跟进一样摆，不标项目（11-03 C2-2：原来一起藏了，客户页「还没有沟通记录」，删客户预检却数得到）
  */
  const 删了的 = (await 看全部(() => 看已删(() => prisma.project.findMany({ where: { customerId, deletedAt: { not: null } }, select: { id: true }, take: 项目上限 })))).map((p) => p.id);
  /*
    收的是三段的并：这位客户不挂项目的、挂在 ids 上的（可能记在别的客户名下）、这位客户名下挂在 删了的 上的。
    按「记在哪位客户名下」拆成几句、各取一页再在这里合（8.5 万客户提速第三轮，11-14）：三段 OR 在一句里时，
    条件跨了 FollowUpProject 那张表，SQLite 用不上 customerId 的索引，改顺 (deletedAt, occurredAt) 把 25 万条跟进倒着扫、边扫边挑，
    这位客户没几条时要扫完整表（单句 95 ms，压测 p95 712 ms）。每句都带 customerId = ? 就走 (customerId, occurredAt)（0.1 ms）。
    每句各取 汇总每页 + 1 条，合起来再按同一个顺序截：全局前 n 条一定在各句的前 n 条里，所以页和 hasMore 跟原来一句时一样。
    别的客户：只能是挂在 ids 上的那几条的客户，先从 FollowUpProject 出发查出来（只多不少就行，每句自己还带着项目条件）
  */
  const 游标 = before ? [{ OR: [
    { occurredAt: { lt: new Date(before.occurredAt) } },
    { occurredAt: new Date(before.occurredAt), id: { lt: before.id } },
  ] }] : [];
  const 别的客户 = ids.length ? (await 挂项目的客户们(ids)).filter((c) => c !== customerId) : [];
  const 这位的项目 = [...ids, ...删了的];
  const 一位 = (c: string, 条件: Prisma.FollowUpWhereInput) => 看全部(() => prisma.followUp.findMany({
    where: { AND: [{ customerId: c }, 条件, ...游标] },
    orderBy: followHistoryOrder, take: 汇总每页 + 1,
    include: { ...followHistoryInclude, projectNode: { select: { projectId: true } } },
  }));
  const 各句 = await Promise.all([
    一位(customerId, 这位的项目.length ? { OR: [{ projectNode: null }, { projectNode: { projectId: { in: 这位的项目 } } }] } : { projectNode: null }),
    ...别的客户.map((c) => 一位(c, { projectNode: { projectId: { in: ids } } })),
  ]);
  const rows = 各句.length === 1 ? 各句[0] : 各句.flat().sort(按时间线顺序).slice(0, 汇总每页 + 1);
  const 页 = rows.slice(0, 汇总每页);
  // 删了的项目不标（上面的 删了的）
  const 项目of = (f: (typeof 页)[number]) => (f.projectNode && 项目们.has(f.projectNode.projectId) ? f.projectNode.projectId : null);
  /*
    「已修改」小字（11-19 记录人 30 分钟内能改）：这一页一句留痕。
    沟通上的截图、录音（F-047）：只给挂在 项目们 上的那几条——项目们 就是限定层 + 露客户 + 公海回避滤过的，和附件接口 认沟通 → 认项目看 同一把尺；
    不挂项目的、挂在删了的项目上的，接口本来就不给看，这里也不带。这一页一句（IN），没有挂项目的就不查
  */
  /*
    只给记在这位客户名下的（审查建议 1）：附件接口 认沟通 用带限定的 followUp 查，还要求「沟通记在哪位客户名下、我也看得到那位」；
    别的客户名下那几条（关联项目带进来的）不一定过得了，带了会是点不开的破图，所以不带
  */
  const 带附件 = (f: (typeof 页)[number]) => f.customerId === customerId && !!项目of(f);
  const 挂项目的 = 页.filter(带附件).map((f) => f.id);
  const [改过的, 附件表] = await Promise.all([改过的沟通们(页.map((f) => f.id)), 挂项目的.length ? 沟通附件们(prisma, 挂项目的) : Promise.resolve(new Map<string, 附件[]>())]);
  return {
    rows: 页.map((f) => {
      const pid = 项目of(f);
      const 行 = serializeFollowHistory(f);
      const 附 = 带附件(f) ? 附件表.get(f.id) : undefined;
      // 别的客户名下的记录（关联项目的）：商机是那家客户的，不在这里露
      return { ...行, opportunity: f.customerId === customerId ? 行.opportunity : null, 项目: pid ? { id: pid, 名: 项目们.get(pid) ?? "" } : null, ...(改过的.has(f.id) ? { 已修改: true } : {}), ...(附?.length ? { 附件: 附 } : {}) };
    }),
    hasMore: rows.length > 汇总每页,
  };
}
