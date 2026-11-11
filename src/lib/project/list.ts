import { prisma, defaultClient } from "@/lib/prisma";
import { 搜索词, 客户号码条件, 号码藏着 } from "@/lib/search-keyword";
import { 负责人候选 } from "@/lib/owners";
import type { 项目行, 看板合计组 } from "./board";
import type { 阶段 } from "./nodes";
import { 看得到的客户, 露客户, 公海超时收回, 待我回的邀请, 项目回收日, 算超时要的, 超时成员线 } from "./db";
import { 即将回收 } from "./timeout";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { dayjs } from "@/lib/utils";
import { 已立项天数 } from "./project-fields";
import { 回填一次 } from "./expected-deal";
import { 数收回次数, 合收回次数, 收回次数筛 } from "./recycle-count";
import { 认首页卡, 首页卡条件, 即将逾期 } from "./home-cards";
import { 首页卡范围 } from "./home-cards-db";
import { 字典of, 阶段与进程, 阶段们, 结局们of, 同名们, 本套名, 归阶段的结局, type 阶段字典 } from "./stage-dict";
import { 本套位置 } from "./nodes";
import type { Prisma } from "@/generated/prisma";
import { 待我复核的, 验证结果叫法, 实际待, 无效交给 } from "./lead-verify";
import { 看全部, 客户读条件 } from "../team-scope";
import { 读市场身份 } from "@/lib/enterprise/market-view-db";
import { 市场项目条件, 只看进度 } from "@/lib/enterprise/market-view";
import { 历史负责人们, 我回避的公海项目, 回避豁免 } from "./pool-owner";
import { 渠道筛选选项 } from "@/lib/enterprise/channel-options";
import { 企业级别 } from "@/lib/enterprise/customer-v2";
import { 未分级 } from "@/app/(app)/customers/query-shared";
import { 创建时间段, 是日期 } from "@/lib/custom-date-range";

/** 判了无效的三个叫法：列表上叫法后面跟原因摘要（客户 11-05（X-09）：「初验无效 · 原因」） */
const 带原因的叫法: ReadonlySet<验证结果叫法> = new Set<验证结果叫法>(["初验无效", "终验无效", "无效线索"]);
/** 验证结果格里那一行：判无效的叫法 · 无效原因；其余只写叫法。放不下由列表一行省略、悬停看全文 */
export function 验证摘要(叫法: 验证结果叫法, 无效原因: string | null): string {
  const 因 = 无效原因?.trim();
  return 带原因的叫法.has(叫法) && 因 ? `${叫法} · ${因}` : 叫法;
}

/** 每一步的叫法，和详情页线索验证时间线一致（projects/[id]/LeadVerifyPanel.tsx 步叫法） */
const 步叫法: Record<string, string> = {
  销售初判: "负责人初判", 市场复核: "管理员复核", 销售终验: "负责人确认", 总管理终判: "管理员最终确认", 销售认领: "负责人认领",
};
/** 一步在悬停全文里的那一行：哪天 谁 · 哪步 · 判定（无效原因：…；说明） */
export function 痕一行(l: { step: string; verdict: string; reason: string | null; note: string | null; 谁: string; at: Date }): string {
  const 头 = `${dayjs(l.at).format("YYYY-MM-DD")} ${l.谁} · ${步叫法[l.step] ?? l.step} · ${l.verdict}`;
  const 尾 = [l.reason?.trim() ? `无效原因：${l.reason.trim()}` : null, l.note?.trim() || null].filter(Boolean).join("；");
  return 尾 ? `${头}（${尾}）` : 头;
}

/**
 * 这一页项目的验证全过程（项目 id → 一步一行的全文）：痕一次取（projectId in）、经手人名字一次取。
 * 传进来的只是已经按列表范围筛过的项目，所以取痕不再套「谁在看」（复核的人多半看不到建的人，同 读线索验证）
 */
export async function 读验证痕们(projectIds: string[]): Promise<Map<string, string>> {
  const 全文 = new Map<string, string>();
  if (!projectIds.length) return 全文;
  const 痕 = await 看全部(() => prisma.entLeadVerifyLog.findMany({ where: { projectId: { in: projectIds } }, orderBy: { at: "asc" } }));
  if (!痕.length) return 全文;
  const 名 = new Map((await 看全部(() => prisma.user.findMany({ where: { id: { in: [...new Set(痕.map((l) => l.userId))] } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]));
  const 按项目 = new Map<string, string[]>();
  for (const l of 痕) {
    const 行 = 痕一行({ ...l, 谁: 名.get(l.userId) ?? "已不在的成员" });
    按项目.set(l.projectId, [...(按项目.get(l.projectId) ?? []), 行]);
  }
  for (const [id, 行们] of 按项目) 全文.set(id, 行们.join("\n"));
  return 全文;
}

/** f：企业版首页四张指标卡点进来带的筛选（month-new / key / no-follow / due-soon，口径见 home-cards.ts） */
export type 项目筛选 = { keyword?: string; ownerId?: string; pool?: string; recycled?: string; f?: string; phase?: string; node?: string; creator?: string; channelId?: string; level?: string;
  /** 创建时间（11-11，渠道页点数字进来要按时间分）：两个日历日，两头都算，北京日界线（custom-date-range.ts 创建时间段） */
  createdFrom?: string; createdTo?: string;
  /** 「手机号」筛选（11-11）：项目的客户号码对得上的（同客户列表，lib/search-keyword.ts 客户号码SQL）；客户不露的不算 */
  phone?: string;
  /** 服务端分页（11-11，同客户列表）：第几页、每页几条（10–100）、按哪列排（认项目排序；不给 = 最近改过在前） */
  page?: string; pageSize?: string; sort?: string };

/**
 * 按阶段、进程筛（10-30 用户：「项目页面没有关于进程，阶段的筛选选项」）。和列表上的显示同一套认法（阶段与进程）：
 * 有结局的按结局认阶段（线索流失归线索、丢单归商机…），进程选结局 = 筛这个结局，选节点 = 停在这个节点、还没结局的。
 * 认不出的值当没筛。库里存着旧节点名 / 旧结局的（企业版 10-31 改名）新旧名一起筛（同名们）。
 */
export function 阶段进程条件(sp: { phase?: string; node?: string }, 字典: 阶段字典): { 阶段: 阶段 | ""; 进程: string; where: Prisma.ProjectWhereInput[] } {
  const 阶段 = (阶段们 as readonly string[]).includes(sp.phase ?? "") ? (sp.phase as 阶段) : "";
  // 传旧名（老链接、老书签）先换成这套的新名再认
  const 名 = sp.node ? 本套名(sp.node, 字典) : "";
  const 是结局 = (结局们of(字典) as readonly string[]).includes(名);
  const 是节点 = 阶段们.some((s) => 字典.节点们[s].includes(名));
  const 进程 = 是结局 || 是节点 ? 名 : "";
  const where: Prisma.ProjectWhereInput[] = [];
  if (阶段) {
    // 和渠道统计同一句（stage-dict.ts 项目在阶段）：没结局看 phase，有结局看结局归哪个阶段
    where.push({ OR: [{ phase: 阶段, result: null }, { result: { in: 归阶段的结局(字典, 阶段) } }] });
  }
  if (进程) where.push(是结局 ? { result: { in: 同名们(进程) } } : { node: { in: 同名们(进程) }, result: null });
  return { 阶段, 进程, where };
}

/** 项目详情页中栏名单最多列这么多个项目（按最近改过排，读名单项目）；项目列表 11-11 起服务端分页，不再受它限 */
export const 项目上限 = 500;

/**
 * 企业版首页「有 N 条新线索」：还在线索阶段、没结局（没线索流失）、不在公海的项目。
 * 老的 Lead 表在企业版不再列，数它会说出一个点进 /leads 对不上的数（10-28 排查）。
 */
export function 数新线索() {
  return prisma.project.count({ where: { phase: "线索", result: null, pooledAt: null } });
}

/** 项目列表每页几条：同客户列表（customers/page.tsx），10–100，默认 20 */
export const 每页默认 = 20;
export function 认每页(v: unknown): number {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(100, Math.max(10, n)) : 每页默认;
}
function 认页码(v: unknown): number {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/**
 * 项目列表能排的列（11-11 改服务端排，在全部筛选结果里排）：创建时间、预计成交（没填的总在最后）、负责人（按名字拼音）。
 * 不给 = 默认最近改过在前。每种都带主键做最后一道，翻页顺序稳定
 */
export const 项目排序们 = ["created-asc", "created-desc", "deal-asc", "deal-desc", "owner-asc", "owner-desc"] as const;
export type 项目排序 = (typeof 项目排序们)[number] | "";
export const 认项目排序 = (v: unknown): 项目排序 => ((项目排序们 as readonly unknown[]).includes(v) ? (v as 项目排序) : "");
const 默认序: Prisma.ProjectOrderByWithRelationInput[] = [{ updatedAt: "desc" }, { id: "desc" }];
function 排序of(排: 项目排序): Prisma.ProjectOrderByWithRelationInput[] {
  if (排 === "created-asc") return [{ createdAt: "asc" }, { id: "asc" }];
  if (排 === "created-desc") return [{ createdAt: "desc" }, { id: "desc" }];
  // 预计成交：没填的两头都在最后（同原来浏览器里的 按预计成交排）；同一天的照默认最近改过在前
  if (排 === "deal-asc" || 排 === "deal-desc") return [{ expectedDealAt: { sort: 排 === "deal-asc" ? "asc" : "desc", nulls: "last" } }, ...默认序];
  return 默认序;
}

/**
 * 「露客户」（db.ts 露客户）的库里写法：客户在我读客户的范围里，或项目不在公海、负责人是我。不限定（全看得到）= null。
 * 项目列表按客户名搜、按号码筛、按客户来源算渠道时，客户不露的不算中（不然拿名字 / 号码 / 渠道试得出同事客户挂着哪些项目）；
 * 原来取回 500 条后在内存里滤，11-11 挪进 where，count 和分页才对得上
 */
export async function 露客户条件(me: { id: string }): Promise<Prisma.ProjectWhereInput | null> {
  const 范围 = await 客户读条件(defaultClient);
  return 范围 ? { OR: [{ customer: 范围 as Prisma.CustomerWhereInput }, { pooledAt: null, ownerId: me.id }] } : null;
}

/**
 * 项目列表的条件（项目页、企业版新线索页、渠道页名单都用这一个）：筛选、可见范围以外的「列不列」全在 where 里，
 * 只剩两道库里写不出的（收回次数、3 天内回公海），由 读项目列表 取回候选后再滤（后筛）
 */
async function 列表条件(me: { id: string; role: string } & Parameters<typeof 回避豁免>[0], sp: 项目筛选, 只看阶段?: 阶段) {
  const 词 = 搜索词(sp.keyword);
  const 企 = 企业版();
  const 规则 = 企 ? await 生效组织规则() : null;
  const 今 = new Date();
  // 首页指标卡的筛选只在企业版认；条件和卡上 count 用的是同一份（home-cards.ts），数对得上
  const 卡 = 规则 ? 认首页卡(sp.f) : "";
  // 点卡进来的，和卡上的数同一圈（首页卡范围：按负责人，最下级只看自己，上级看自己 + 下属，总管理 / 管理员全看），数对得上
  const 卡的圈 = 卡 ? await 首页卡范围(me) : undefined;
  const 字典 = 字典of(企);
  const 阶进 = 阶段进程条件(sp, 字典);
  // 企业版市场视角（11-04 P-界面-05）：市场成员 = 自己负责的 ∪ 自己建的已分出去的；市场管理 = 本人 + 实线下属，可按创建人筛；公海的都不列
  const 市场 = 企 ? await 读市场身份(me.id) : null;
  const 创建人 = 市场?.视角 === "市场管理" && typeof sp.creator === "string" && 市场.圈.includes(sp.creator) ? sp.creator : "";
  // 自定义筛选（11-06）：渠道和列表上「渠道」一列同一条规则——项目自己选的优先，没选跟客户来源（channel-stats.ts 项目算哪个渠道）
  const 来源 = 企 && typeof sp.channelId === "string" ? sp.channelId : "";
  const 级别筛 = !企 ? "" : sp.level === 未分级 ? 未分级 : (企业级别(sp.level) ?? "");
  const 建于 = 创建时间段(sp.createdFrom, sp.createdTo);
  // 手机号（11-11）：先按号码找客户（电话藏着的人 = null，不筛），再取挂在这些客户上的项目，客户要露
  const 号码 = await 客户号码条件(sp.phone, me.id);
  const 露 = 词 || 来源 || 号码 ? await 露客户条件(me) : null;
  const 并露 = (w: Prisma.ProjectWhereInput): Prisma.ProjectWhereInput => (露 ? { AND: [w, 露] } : w);
  // 企业版「收回次数」：从留痕里数；按次数筛只在企业版的项目公海里生效
  const 收回筛 = 企 && sp.pool === "1" ? 收回次数筛(sp.recycled) : "";
  const 并且: Prisma.ProjectWhereInput[] = [
    ...(建于 ? [{ createdAt: 建于 }] : []),
    // 按号码筛中的是客户：客户不露的不列，不然拿号码试得出同事公海客户挂着哪些项目
    ...(号码 ? [并露({ customer: 号码 })] : []),
    // 客户不露时不拿客户的来源（同列上的「渠道」）：否则筛一下就试出同事客户从哪来
    ...(来源 ? [{ OR: [{ channelId: 来源 }, 并露({ channelId: null, customer: { channelId: 来源 } })] }] : []),
    ...(级别筛 ? [{ level: 级别筛 === 未分级 ? null : 级别筛 }] : []),
    ...(卡 && 规则 ? [首页卡条件(卡, 规则, 字典of(企), 今), ...(卡的圈 ? [卡的圈] : [])] : []),
    ...阶进.where,
    ...(市场 ? [市场项目条件(me.id, 市场.圈, 创建人)] : []),
    // 公海里同事客户的项目：不露客户名；按客户名搜也不该搜出它（否则等于拿名字试出来）。搜索词的 OR 放进 AND 里，不和别的 OR 打架
    ...(词 ? [{ OR: [{ name: { contains: 词 } }, 并露({ customer: { name: { contains: 词 } } })] }] : []),
  ];
  // 企业版 C-01：公海里我是历史负责人的项目我看不到（总管理 / 管理员不算，lib/project/pool-owner.ts 回避豁免）
  const 回避 = (await 回避豁免(me)) ? [] : await 我回避的公海项目(prisma, me.id);
  const where: Prisma.ProjectWhereInput = {
    ...(只看阶段 ? { phase: 只看阶段 } : {}),
    ...(回避.length ? { id: { notIn: 回避 } } : {}),
    ...(typeof sp.ownerId === "string" && sp.ownerId ? { ownerId: sp.ownerId } : {}),
    // 企业版公海只有一处（/pool）：默认列表不列公海项目，不然同一个项目两边都有；团队版公海项目照旧混在列表里，页上有「在公海」标。
    // 点首页卡进来的不加：哪些算由卡的条件定（「本月新增」不管在不在推，含公海），和卡上的数对得上
    ...(sp.pool === "1" ? { pooledAt: { not: null } } : 企 && !卡 ? { pooledAt: null } : {}),
    ...(并且.length ? { AND: 并且 } : {}),
  };
  return { where, 词, 企, 规则, 今, 卡, 阶进, 市场, 创建人, 来源, 级别筛, 号码, 收回筛 };
}

/** 分页取回的一行（include 和原来一页 500 条时一样） */
function 行include(市场: boolean, meId: string) {
  return {
    customer: { select: { name: true, lastFollowAt: true, channelId: true, pool: { select: { customerId: true } }, channel: { select: { name: true } } } },
    exceptionCategory: { select: { name: true } },
    channel: { select: { name: true } },
    logs: 算超时要的.logs,
    ...(市场 ? {
      entLeadVerify: { select: { verdict: true, pending: true, salesAck: true, invalidReason: true } },
      members: { where: { userId: meId, inviteStatus: "JOINED" }, select: { userId: true } },
    } : {}),
  } satisfies Prisma.ProjectInclude;
}

/** 负责人一列排序用的名字：同列上显示的（没了的人写「已不在的成员」，空写「没人」）；拼音序，同名按 id */
async function 负责人顺序(ownerIds: string[], 降: boolean): Promise<string[]> {
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: ownerIds.filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const 叫 = (id: string) => 名.get(id) ?? (id ? "已不在的成员" : "没人");
  const 序 = [...ownerIds].sort((a, b) => 叫(a).localeCompare(叫(b), "zh-CN") || (a < b ? -1 : a > b ? 1 : 0));
  return 降 ? 序.reverse() : 序;
}

/**
 * 项目页和企业版「新线索」页共用的取数：先跑超时回收，再按筛选取这一页项目、拼成 项目行（11-11 起服务端分页，同客户列表）。
 * 总数 = 全部符合条件的条数；筛选、排序都在库里对全部结果做；看板列头的数和金额也按全部算（看板合计）。
 * 只看阶段 = "线索" 时只取还在线索阶段的（含已线索流失的），企业版 /leads 用。
 */
export async function 读项目列表(me: Parameters<typeof 公海超时收回>[0] & Parameters<typeof 待我回的邀请>[0] & { role: string }, sp: 项目筛选, 只看阶段?: 阶段) {
  // 企业版超时回收：先收再列，列表里看到的就是收完的样子
  await 公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e));
  await 回填一次();
  const { where, 词, 企, 规则, 今, 卡, 阶进, 市场, 创建人, 来源, 级别筛, 号码, 收回筛 } = await 列表条件(me, sp, 只看阶段);
  const 排 = 认项目排序(sp.sort);
  const 每页 = 认每页(sp.pageSize);
  const 要页 = 认页码(sp.page);
  const 按负责人 = 排 === "owner-asc" || 排 === "owner-desc";
  // 超时按项目业务线分内外贸天数（C7）：老项目没填业务线按负责人的线
  const 超时线们 = 规则 ? await 超时成员线(规则) : null;
  const include = 行include(!!市场, me.id);

  let 总数: number;
  let 页: number;
  let 看板合计: 看板合计组[];
  let rows: Prisma.ProjectGetPayload<{ include: ReturnType<typeof 行include> }>[];
  // 收回次数、3 天内回公海：库里写不出，取回全部候选（只要几列）逐个算，再按序切这一页。
  // 候选本来就窄：收回次数只在企业版项目公海（/projects?pool=1 已转去 /pool），3 天内回公海先过紧筛
  const 后筛 = !!收回筛 || 卡 === "due-soon";
  if (后筛) {
    const 候选 = await prisma.project.findMany({
      where,
      orderBy: 排序of(按负责人 ? "" : 排),
      select: { ...算超时要的, amount: true, currency: true },
    });
    const 收回 = 收回筛 ? await 数收回次数(候选.map((r) => r.id), prisma) : null;
    let 剩 = 候选.filter((p) => 合收回次数(收回?.get(p.id) ?? 0, 收回筛) && (卡 !== "due-soon" || (!!规则 && 即将逾期(项目回收日(规则, p, 超时线们), 今))));
    if (按负责人) {
      const 位 = new Map((await 负责人顺序([...new Set(剩.map((r) => r.ownerId))], 排 === "owner-desc")).map((id, i) => [id, i]));
      剩 = 剩.map((r, i) => ({ r, i })).sort((a, b) => 位.get(a.r.ownerId)! - 位.get(b.r.ownerId)! || a.i - b.i).map((x) => x.r);
    }
    总数 = 剩.length;
    页 = Math.min(要页, Math.max(1, Math.ceil(总数 / 每页)));
    const ids = 剩.slice((页 - 1) * 每页, 页 * 每页).map((r) => r.id);
    const 取 = new Map((await prisma.project.findMany({ where: { id: { in: ids } }, include })).map((r) => [r.id, r]));
    rows = ids.flatMap((id) => (取.has(id) ? [取.get(id)!] : []));
    const 组 = new Map<string, 看板合计组>();
    for (const r of 剩) {
      const k = JSON.stringify([r.phase, r.node, r.result, r.currency]);
      const g = 组.get(k) ?? { phase: r.phase, node: r.node, result: r.result, currency: r.currency, amount: 0, 数: 0 };
      g.amount += r.amount;
      g.数 += 1;
      组.set(k, g);
    }
    看板合计 = [...组.values()];
  } else {
    // 一句 groupBy 出总数（各组相加）和看板列头；按负责人排时再按负责人数一遍，用来定这一页落在哪几位名下
    const [分组, 按人] = await Promise.all([
      prisma.project.groupBy({ by: ["phase", "node", "result", "currency"], where, _count: { _all: true }, _sum: { amount: true } }),
      按负责人 ? prisma.project.groupBy({ by: ["ownerId"], where, _count: { _all: true } }) : Promise.resolve(null),
    ]);
    看板合计 = 分组.map((g) => ({ phase: g.phase, node: g.node, result: g.result, currency: g.currency, amount: g._sum.amount ?? 0, 数: g._count._all }));
    总数 = 看板合计.reduce((n, g) => n + g.数, 0);
    页 = Math.min(要页, Math.max(1, Math.ceil(总数 / 每页)));
    if (按人) {
      // 负责人按名字拼音排（库里只会按编码排汉字）：先按人数定这一页从哪位的第几个起，再一位一位按默认序取，每位都走 ownerId 索引
      const 数 = new Map(按人.map((g) => [g.ownerId, g._count._all]));
      const 序 = await 负责人顺序([...数.keys()], 排 === "owner-desc");
      rows = [];
      let 起 = (页 - 1) * 每页;
      for (const id of 序) {
        if (rows.length >= 每页) break;
        const n = 数.get(id)!;
        if (起 >= n) { 起 -= n; continue; }
        rows.push(...(await prisma.project.findMany({ where: { AND: [where, { ownerId: id }] }, orderBy: 默认序, skip: 起, take: 每页 - rows.length, include })));
        起 = 0;
      }
    } else {
      rows = 总数 ? await prisma.project.findMany({ where, orderBy: 排序of(排), skip: (页 - 1) * 每页, take: 每页, include }) : [];
    }
  }

  const 将收 = (p: (typeof rows)[number]) => {
    if (!规则 || p.pooledAt) return null;
    const 日 = 项目回收日(规则, p, 超时线们);
    return 即将回收(日, 今) ? 日 : null;
  };
  // 公海里的项目负责人一栏写原负责人（企业版库里已清空，从留痕取）
  const 原负责人 = await 历史负责人们(prisma, rows.filter((r) => r.pooledAt).map((r) => r.id));
  const 负责人of = (p: (typeof rows)[number]) => (p.pooledAt ? 原负责人.get(p.id) ?? p.ownerId : p.ownerId);
  const [人, users, 可见, 邀请, 收回, 待复核] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(负责人of))] } }, select: { id: true, name: true } }),
    负责人候选(),
    看得到的客户(rows.map((r) => r.customerId)),
    待我回的邀请(me),
    企 ? 数收回次数(rows.map((r) => r.id), prisma) : Promise.resolve(null),
    企 ? 待我复核的(me) : Promise.resolve([]),
  ]);
  const 名字 = new Map(人.map((u) => [u.id, u.name]));
  // 市场视角：等我拍板的市场复核那几条照旧能进详情（复核要看来龙去脉）；验证结果的「待」按规则实际交给谁算（同详情页）
  const 我复核 = new Set(待复核.filter((r) => r.步 === "市场复核").map((r) => r.projectId));
  const 交给 = 市场 ? await 无效交给(市场.org) : "总管理终判";
  // 验证结果悬停看全过程（客户 11-05（X-09））：这一页的痕一次取、经手人名字一次取，不按行查
  const 痕们 = 市场 ? await 读验证痕们(rows.filter((r) => (r as { entLeadVerify?: unknown }).entLeadVerify).map((r) => r.id)) : new Map<string, string>();
  const 市场格 = (p: (typeof rows)[number]): Pick<项目行, "只看进度" | "验证结果" | "验证全文"> => {
    if (!市场) return {};
    const v = (p as { entLeadVerify?: { verdict: string; pending: string | null; salesAck: string | null; invalidReason: string | null } | null }).entLeadVerify;
    const 已加入 = ((p as { members?: { userId: string }[] }).members ?? []).map((m) => m.userId);
    const 叫法 = v ? 验证结果叫法({ 判定: v.verdict, 待: 实际待(v.pending, 交给), 终验: v.salesAck }) : null;
    return {
      只看进度: 只看进度(市场.圈, me.id, { ownerId: p.ownerId, 已加入 }, 我复核.has(p.id)),
      验证结果: 叫法 ? 验证摘要(叫法, v?.invalidReason ?? null) : p.phase === "线索" && !p.result ? "暂未验证" : null,
      验证全文: 痕们.get(p.id) ?? null,
    };
  };
  // 公海里同事客户的项目：不露客户名（按客户名搜、按号码筛、按客户来源算渠道的「客户要露」已在 where 里，列表条件）
  const 露 = (p: (typeof rows)[number]) => 露客户(me, p, 可见);
  const 行: 项目行[] = rows.map((p) => ({
    id: p.id, name: p.name, customerId: p.customerId, customerName: 露(p) ? p.customer.name : null,
    ownerId: p.ownerId, ownerName: 名字.get(负责人of(p)) ?? (负责人of(p) ? "已不在的成员" : "没人"),
    // 库里存着旧节点名 / 旧结局的按这套的新名给界面（企业版 10-31 改名）
    ...本套位置({ phase: p.phase, node: p.node, result: p.result }, 字典of(企)), exceptionCategory: p.exceptionCategory?.name ?? null, exceptionReason: p.exceptionReason,
    pooled: !!p.pooledAt,
    ...(企 && p.awaitAssignAt && !p.pooledAt ? { 待分配: true } : {}),
    ...(企 ? { 即将回收: 将收(p), 回收日: 规则 && !p.pooledAt ? 项目回收日(规则, p, 超时线们) : null, 下一步时间: p.nextStepAt ? dayjs(p.nextStepAt).format("YYYY-MM-DD") : null } : {}),
    // 项目来源和渠道统计同一条规则：项目自己选的优先，没选跟客户来源（lib/enterprise/channel-stats.ts 项目算哪个渠道）；客户不露时不拿客户的来源
    ...(企 ? { expectedDealAt: p.expectedDealAt ? dayjs(p.expectedDealAt).format("YYYY-MM-DD") : null, 已立项天数: 已立项天数(p.createdAt, 今), 项目来源: p.channel?.name ?? (露(p) ? p.customer.channel?.name : null) ?? null, level: p.level } : {}),
    ...(收回 ? { 收回次数: 收回.get(p.id) ?? 0 } : {}),
    ...市场格(p),
    amount: p.amount, currency: p.currency, updatedAt: p.updatedAt.toISOString(), createdAt: p.createdAt.toISOString(),
  }));
  return {
    行,
    /** 全部符合条件的条数（各页相加 = 它）；页 = 实际给的这一页（要的页越界时落到最后一页），每页 = 认过的每页条数 */
    总数,
    页,
    每页,
    /** 要的页码原样（地址栏上越界时界面把它改成实际的页，同客户列表） */
    要的页: typeof sp.page === "string" ? sp.page : undefined,
    排序: 排,
    /** 看板列头按全部算（看板分列 的 全部） */
    看板合计,
    // 结局叫法跟着字典：企业版组织规则里改过的出口叫法
    企业版: 企,
    出口叫法: 规则?.阶段.出口叫法,
    // 「给老客户开项目」弹窗：开了超时回收，首条沟通要填下一步时间（同客户页 customers/[id]/page.tsx）
    要下一步: !!规则?.超时回收.开,
    users,
    邀请们: 邀请.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    // 企业版线索验证（P12）：等我复核 / 终验 / 认领的线索
    待复核们: 待复核.map((r) => ({ ...r, 更新于: r.更新于.toISOString() })),
    filters: { keyword: 词, ownerId: typeof sp.ownerId === "string" ? sp.ownerId : "", pool: sp.pool === "1" ? "1" : "", recycled: 收回筛, f: 卡, phase: 阶进.阶段, node: 阶进.进程, creator: 创建人, channelId: 来源, level: 级别筛,
      // 原样回给界面（选择器回显）；写错的那头 创建时间段 当没给
      createdFrom: 是日期(sp.createdFrom) ? sp.createdFrom : "", createdTo: 是日期(sp.createdTo) ? sp.createdTo : "",
      phone: 号码 ? 搜索词(sp.phone) : "" },
    // 电话藏着的人（字段权限 Y27）不摆「手机号」筛选
    能按号码筛: !(await 号码藏着(me.id)),
    // 自定义筛选「渠道」的候选；新线索页不摆
    渠道筛选项: 企 && !只看阶段 ? await 渠道筛选选项() : [],
    // 市场视角（null = 别的角色，界面照旧）；市场管理的「创建人」筛选候选 = 本人 + 实线下属
    市场: 市场 ? { 视角: 市场.视角, 创建人们: 市场.视角 === "市场管理" ? await prisma.user.findMany({ where: { id: { in: 市场.圈 } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [] } : null,
  };
}

/**
 * 渠道页「点数字看名单」（11-11）：一批候选项目里，哪些会出现在这个人的项目列表上——按渠道筛、不搜、没点首页卡时
 * 读项目列表 的条件（列表条件：企业版不列公海的、市场视角只列市场圈的、原负责人回避）原样并上；
 * 项目自己没填来源、跟客户来源算渠道的，客户不露时不算进这个渠道（同列表按渠道筛的那条 露客户条件）。
 * 两边同一个 列表条件，不会一边改了一边没改；名单数 = 点进去项目列表的服务端总数（tests/ent-channel-drilldown.test.ts 对拍）
 */
export async function 列表里的项目(me: { id: string; role?: string }, 候选: Prisma.ProjectWhereInput): Promise<Set<string>> {
  const { where } = await 列表条件({ role: "", ...me }, {});
  const 露 = await 露客户条件(me);
  const 行 = await prisma.project.findMany({
    where: { AND: [候选, where, ...(露 ? [{ OR: [{ channelId: { not: null } }, 露] }] : [])] },
    select: { id: true },
  });
  return new Set(行.map((r) => r.id));
}

/**
 * 渠道页「另 M 条在公海」（11-11）：一批候选项目里，在公海、并且会出现在公海页「渠道名单」里的那些（P-看-03 公海只在公海页出现，不放进项目列表）。
 * 和项目列表按渠道筛同一条归属规则：项目自己选了来源的照算；没选、跟客户来源算的，客户要露（露客户条件；公海里的项目只认客户看不看得到）。
 * 可见范围（含原负责人回避）由限定层管，这里不另放宽。公海页渠道名单（unified-pool-db.ts 读公海页 的 名单）用同一句，条数对得上
 */
export async function 公海名单条件(me: { id: string }, 候选: Prisma.ProjectWhereInput): Promise<Prisma.ProjectWhereInput> {
  const 露 = await 露客户条件(me);
  return { AND: [候选, { pooledAt: { not: null } }, ...(露 ? [{ OR: [{ channelId: { not: null } }, 露] }] : [])] };
}

/** 公海页按项目一条一行时的筛选（地址栏 projChannel / phase / createdFrom / createdTo）；空的那项不筛 */
export type 公海名单筛 = { channelId?: string; phase?: string; createdFrom?: string; createdTo?: string };

/**
 * 公海页渠道名单的候选：这个渠道（项目来源优先，没填跟客户来源）+ 同口径的阶段（阶段进程条件）+ 项目创建时间段
 * （北京日，和项目列表 createdFrom / createdTo 同一个 创建时间段）。哪项都没有 = null（不按名单列）
 */
export function 公海名单候选(f: 公海名单筛): Prisma.ProjectWhereInput | null {
  const 建于 = 创建时间段(f.createdFrom, f.createdTo);
  const 并: Prisma.ProjectWhereInput[] = [
    ...(f.channelId ? [{ OR: [{ channelId: f.channelId }, { channelId: null, customer: { channelId: f.channelId } }] }] : []),
    ...(建于 ? [{ createdAt: 建于 }] : []),
  ];
  if (!并.length) return null;
  return { AND: [...并, ...(f.phase ? 阶段进程条件({ phase: f.phase }, 字典of(企业版())).where : [])] };
}

/**
 * 项目详情页中栏名单的一行（P11，照客户记录页的名单）：名字、在哪个阶段 / 进程、最近一次沟通。
 * 客户名和沟通内容只在露客户时给（公海里同事客户的项目不露，lib/project/db.ts 露客户），不露时这几格都是 null
 */
export type 名单项目 = {
  id: string;
  name: string;
  阶段: string;
  进程: string;
  结局: string | null;
  pooled: boolean;
  customerName: string | null;
  /** 最近一次沟通的方式（FOLLOW_TYPE_MAP 的键）和时间 */
  lastType: string | null;
  /** 企业版沟通方式（10-31） */
  lastMethod: string | null;
  lastAt: string | null;
  lastNote: string | null;
  /** 项目的下一步日期：「本周要跟」和右下角圆点看它（计划是挂在客户上的，按项目只有这一格）；有结局或在公海就不算 */
  nextAt: string | null;
  /** 项目的下一步做什么（10-29，一句话）；老数据、有结局或在公海是空 */
  nextText: string | null;
};

/**
 * 企业版项目详情页的中栏名单（P11）：和项目页同一个范围——同一个按可见范围筛过的 prisma、同样按最近改过排、同样最多 项目上限 个，
 * 不另开权限口子。不跑超时回收（那是项目页列表的事，详情页每点一个都扫一遍太重）
 */
export async function 读名单项目(me: { id: string; role?: string }, 字典: 阶段字典): Promise<{ rows: 名单项目[]; 取到上限: boolean }> {
  // 市场视角：名单和项目页同一圈，但「只看进度」的那些点不进详情，名单里就不列（market-view.ts）
  const 市场 = 企业版() ? await 读市场身份(me.id) : null;
  // 公海项目不进名单（企业版公海只在 /pool，和项目页默认列表一样）；历史负责人回避的都在公海里，也就不用另外排
  const rows = await prisma.project.findMany({
    where: 市场 ? { AND: [{ pooledAt: null }, 市场项目条件(me.id, 市场.圈), { OR: [{ ownerId: { in: 市场.圈 } }, { members: { some: { userId: me.id, inviteStatus: "JOINED" } } }] }] } : { pooledAt: null },
    orderBy: { updatedAt: "desc" },
    take: 项目上限,
    select: {
      id: true, name: true, phase: true, node: true, result: true, pooledAt: true, ownerId: true, customerId: true, nextStepAt: true, nextStepText: true,
      customer: { select: { name: true } },
      followUps: { orderBy: { followUp: { occurredAt: "desc" } }, take: 1, select: { followUp: { select: { type: true, method: true, content: true, occurredAt: true } } } },
    },
  });
  const 可见 = await 看得到的客户(rows.map((r) => r.customerId));
  return {
    取到上限: rows.length >= 项目上限,
    rows: rows.map((r) => {
      const 露 = 露客户(me, r, 可见);
      const f = 露 ? r.followUps[0]?.followUp : undefined;
      return {
        id: r.id, name: r.name, ...阶段与进程(r, 字典), pooled: !!r.pooledAt,
        customerName: 露 ? r.customer.name : null,
        lastType: f?.type ?? null,
        lastMethod: f?.method ?? null,
        lastAt: f ? f.occurredAt.toISOString() : null,
        lastNote: f?.content?.trim().slice(0, 60) || null,
        nextAt: r.nextStepAt && !r.result && !r.pooledAt ? dayjs(r.nextStepAt).format("YYYY-MM-DD") : null,
        nextText: !r.result && !r.pooledAt ? r.nextStepText : null,
      };
    }),
  };
}
