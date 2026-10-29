import { prisma } from "@/lib/prisma";
import { 搜索词 } from "@/lib/search-keyword";
import { 负责人候选 } from "@/lib/owners";
import type { 项目行 } from "./board";
import type { 阶段 } from "./nodes";
import { 看得到的客户, 露客户, 公海超时收回, 待我回的邀请, 项目回收日, 算超时要的 } from "./db";
import { 即将回收 } from "./timeout";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { dayjs } from "@/lib/utils";
import { 已立项天数 } from "./project-fields";
import { 回填一次 } from "./expected-deal";
import { 数收回次数, 合收回次数, 收回次数筛 } from "./recycle-count";
import { 认首页卡, 首页卡条件, 即将逾期 } from "./home-cards";
import { 字典of, 阶段与进程, type 阶段字典 } from "./stage-dict";
import { 待我复核的 } from "./lead-verify";

/** f：企业版首页四张指标卡点进来带的筛选（month-new / key / no-follow / due-soon，口径见 home-cards.ts） */
export type 项目筛选 = { keyword?: string; ownerId?: string; pool?: string; recycled?: string; f?: string };

/** 一页最多列这么多个项目（按最近改过排），更早的靠搜索 */
export const 项目上限 = 500;

/**
 * 企业版首页「有 N 条新线索」：还在线索阶段、没结局（没线索流失）、不在公海的项目。
 * 老的 Lead 表在企业版不再列，数它会说出一个点进 /leads 对不上的数（10-28 排查）。
 */
export function 数新线索() {
  return prisma.project.count({ where: { phase: "线索", result: null, pooledAt: null } });
}

/**
 * 项目页和企业版「新线索」页共用的取数：先跑超时回收，再按筛选取项目、拼成 项目行。
 * 只看阶段 = "线索" 时只取还在线索阶段的（含已线索流失的），企业版 /leads 用。
 */
export async function 读项目列表(me: Parameters<typeof 公海超时收回>[0] & Parameters<typeof 待我回的邀请>[0], sp: 项目筛选, 只看阶段?: 阶段) {
  // 企业版超时回收：先收再列，列表里看到的就是收完的样子
  await 公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e));
  await 回填一次();
  const 词 = 搜索词(sp.keyword);
  const 企 = 企业版();
  const 规则 = 企 ? await 生效组织规则() : null;
  const 今 = new Date();
  // 首页指标卡的筛选只在企业版认；条件和卡上 count 用的是同一份（home-cards.ts），数对得上
  const 卡 = 规则 ? 认首页卡(sp.f) : "";
  const rows = await prisma.project.findMany({
    where: {
      ...(只看阶段 ? { phase: 只看阶段 } : {}),
      ...(词 ? { OR: [{ name: { contains: 词 } }, { customer: { name: { contains: 词 } } }] } : {}),
      ...(typeof sp.ownerId === "string" && sp.ownerId ? { ownerId: sp.ownerId } : {}),
      ...(sp.pool === "1" ? { pooledAt: { not: null } } : {}),
      // 卡的条件里也可能有 OR（即将逾期的粗筛），放进 AND 里不和搜索词的 OR 打架
      ...(卡 && 规则 ? { AND: [首页卡条件(卡, 规则, 字典of(企), 今)] } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 项目上限,
    include: {
      customer: { select: { name: true, lastFollowAt: true, pool: { select: { customerId: true } }, channel: { select: { name: true } } } },
      exceptionCategory: { select: { name: true } },
      channel: { select: { name: true } },
      logs: 算超时要的.logs,
    },
  });
  // 企业版「收回次数」：从留痕里数；按次数筛只在企业版的项目公海里生效
  const 收回筛 = 企 && sp.pool === "1" ? 收回次数筛(sp.recycled) : "";
  const 将收 = (p: (typeof rows)[number]) => {
    if (!规则 || p.pooledAt) return null;
    const 日 = 项目回收日(规则, p);
    return 即将回收(日, 今) ? 日 : null;
  };
  const [人, users, 可见, 邀请, 收回, 待复核] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, name: true } }),
    负责人候选(),
    看得到的客户(rows.map((r) => r.customerId)),
    待我回的邀请(me),
    企 ? 数收回次数(rows.map((r) => r.id), prisma) : Promise.resolve(null),
    企 ? 待我复核的(me) : Promise.resolve([]),
  ]);
  const 名字 = new Map(人.map((u) => [u.id, u.name]));
  // 公海里同事客户的项目：不露客户名；按客户名搜也不该搜出它（否则等于拿名字试出来）
  const 露 = (p: (typeof rows)[number]) => 露客户(me, p, 可见);
  const 行: 项目行[] = rows.filter((p) => (!词 || p.name.toLowerCase().includes(词.toLowerCase()) || 露(p)) && 合收回次数(收回?.get(p.id) ?? 0, 收回筛) && (卡 !== "due-soon" || (!!规则 && 即将逾期(项目回收日(规则, p), 今)))).map((p) => ({
    id: p.id, name: p.name, customerId: p.customerId, customerName: 露(p) ? p.customer.name : null,
    ownerId: p.ownerId, ownerName: 名字.get(p.ownerId) ?? "已不在的成员",
    phase: p.phase, node: p.node, result: p.result, exceptionCategory: p.exceptionCategory?.name ?? null, exceptionReason: p.exceptionReason,
    pooled: !!p.pooledAt,
    ...(企 ? { 即将回收: 将收(p) } : {}),
    // 项目来源和渠道统计同一条规则：项目自己选的优先，没选跟客户来源（lib/enterprise/channel-stats.ts 项目算哪个渠道）；客户不露时不拿客户的来源
    ...(企 ? { expectedDealAt: p.expectedDealAt ? dayjs(p.expectedDealAt).format("YYYY-MM-DD") : null, 已立项天数: 已立项天数(p.createdAt, 今), 项目来源: p.channel?.name ?? (露(p) ? p.customer.channel?.name : null) ?? null, level: p.level } : {}),
    ...(收回 ? { 收回次数: 收回.get(p.id) ?? 0 } : {}),
    amount: p.amount, currency: p.currency, updatedAt: p.updatedAt.toISOString(),
  }));
  return {
    行,
    取到上限: rows.length >= 项目上限,
    // 结局叫法跟着字典：企业版组织规则里改过的出口叫法
    企业版: 企,
    出口叫法: 规则?.阶段.出口叫法,
    users,
    邀请们: 邀请.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    // 企业版线索验证（P12）：等我复核 / 终验 / 认领的线索
    待复核们: 待复核.map((r) => ({ ...r, 更新于: r.更新于.toISOString() })),
    filters: { keyword: 词, ownerId: typeof sp.ownerId === "string" ? sp.ownerId : "", pool: sp.pool === "1" ? "1" : "", recycled: 收回筛, f: 卡 },
  };
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
  lastAt: string | null;
  lastNote: string | null;
  /** 项目的下一步日期：「本周要跟」和右下角圆点看它（计划是挂在客户上的，按项目只有这一格）；有结局或在公海就不算 */
  nextAt: string | null;
};

/**
 * 企业版项目详情页的中栏名单（P11）：和项目页同一个范围——同一个按可见范围筛过的 prisma、同样按最近改过排、同样最多 项目上限 个，
 * 不另开权限口子。不跑超时回收（那是项目页列表的事，详情页每点一个都扫一遍太重）
 */
export async function 读名单项目(me: { id: string }, 字典: 阶段字典): Promise<{ rows: 名单项目[]; 取到上限: boolean }> {
  const rows = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    take: 项目上限,
    select: {
      id: true, name: true, phase: true, node: true, result: true, pooledAt: true, ownerId: true, customerId: true, nextStepAt: true,
      customer: { select: { name: true } },
      followUps: { orderBy: { followUp: { occurredAt: "desc" } }, take: 1, select: { followUp: { select: { type: true, content: true, occurredAt: true } } } },
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
        lastAt: f ? f.occurredAt.toISOString() : null,
        lastNote: f?.content?.trim().slice(0, 60) || null,
        nextAt: r.nextStepAt && !r.result && !r.pooledAt ? dayjs(r.nextStepAt).format("YYYY-MM-DD") : null,
      };
    }),
  };
}
