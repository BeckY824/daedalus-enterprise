import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { dayjs } from "@/lib/utils";
import { 生效组织规则 } from "./org-rules-store";
import { 项目回收日, 算超时要的 } from "./db";
import { 字典of } from "./stage-dict";
import { 首页卡条件, 即将逾期, 即将逾期粗筛 } from "./home-cards";
import { 卡点看板范围 } from "./blocker";
import { 复盘待办计数 } from "./board-todos-db";

type 谁 = { id: string; role: string };
import {
  负责人条件, 回收条们, 按节点数, 排卡点分布, 排客户分布, 算回款, 预警最多, 缺沟通最多,
  type 回收提醒, type 预警行, type 缺沟通, type 卡点分布, type 复盘概况, type 客户分布,
} from "./review-extras";

/**
 * 复盘页 11-01 版式融合多出来的几块取数（口径在 review-extras.ts）。
 * 范围 = 看板的人 给的那一圈（只看了某个人 = 他；老板、总管理员 = undefined 不限），按项目负责人筛；
 * 走带限定的 prisma（同首页卡、项目页）；卡点包在 看全部 里、范围同卡点看板（blocker.ts 卡点看板范围，按卡点的角色开关）。
 */

type 范围 = string | readonly string[] | undefined;
const 名 = (u: { name: string | null; email: string }) => u.name || u.email;

async function 叫们(ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const us = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } });
  return new Map(us.map((u) => [u.id, 名(u)]));
}

/**
 * 3 天内回公海的项目：任务页签的「回收提醒」（按节点几条）和数据页签的「超时预警」（最早的几个）同一次查。
 * 库里先用首页卡同一个粗筛，再逐个算回收日（同 即将逾期的项目）
 */
export async function 将回公海of(范围: 范围, 今: Date = new Date()): Promise<{ 提醒: 回收提醒; 预警: 预警行[] }> {
  const 规则 = await 生效组织规则();
  const 字典 = 字典of(企业版());
  const 粗 = 即将逾期粗筛(规则, 字典, 今);
  if (!粗) return { 提醒: 回收条们(规则, 字典, new Map()), 预警: [] };
  const 人 = 负责人条件(范围);
  const 们 = (await prisma.project.findMany({ where: { AND: [粗, ...(人 ? [人] : [])] }, select: 算超时要的 }))
    .map((p) => ({ p, 日: 项目回收日(规则, p) }))
    .filter((x): x is { p: typeof x.p; 日: string } => !!x.日 && 即将逾期(x.日, 今))
    .sort((a, b) => a.日.localeCompare(b.日) || a.p.name.localeCompare(b.p.name, "zh"));
  const 前几 = 们.slice(0, 预警最多);
  const 叫 = await 叫们(前几.map((x) => x.p.ownerId));
  return {
    提醒: 回收条们(规则, 字典, 按节点数(们.map((x) => x.p), 字典)),
    预警: 前几.map(({ p, 日 }) => ({ id: p.id, 名: p.name, 节点: p.node, 负责人: 叫.get(p.ownerId) ?? "—", 回收日: 日 })),
  };
}

/** 还没沟通过的项目：首页「暂未跟进」同一个条件，这一圈负责的，最近建的在前 */
export async function 缺沟通of(范围: 范围): Promise<缺沟通> {
  const 规则 = await 生效组织规则();
  const 人 = 负责人条件(范围);
  const where = { AND: [首页卡条件("no-follow", 规则, 字典of(企业版())), ...(人 ? [人] : [])] };
  const [总数, 们] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 缺沟通最多,
      select: { id: true, name: true, node: true, ownerId: true, createdAt: true, customer: { select: { name: true } } },
    }),
  ]);
  const 叫 = await 叫们(们.map((p) => p.ownerId));
  return {
    总数,
    行: 们.map((p) => ({ id: p.id, 名: p.name, 客户: p.customer?.name ?? "—", 节点: p.node, 负责人: 叫.get(p.ownerId) ?? "—", 建于: p.createdAt.toISOString() })),
  };
}

/** 卡点分布：未解决的，同卡点看板那一圈（卡点看板范围），按阻碍主体、按状态各一次 groupBy；卡点没开 = 空 */
export async function 卡点分布of(me: 谁): Promise<卡点分布> {
  const 范围 = await 卡点看板范围(me);
  if (!范围) return { 总数: 0, 按主体: [], 按状态: [] };
  const where = { AND: [范围, { status: { not: "已解决" } }] };
  return 看全部(async () => {
    const [主体们, 状态们] = await Promise.all([
      prisma.entBlocker.groupBy({ by: ["obstacle"], where, _count: { _all: true } }),
      prisma.entBlocker.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    return 排卡点分布(主体们, 状态们);
  });
}

/** 客户分布：这一圈负责的客户（按客户负责人；不含公海，回收站的由软删统一滤掉），按国家、按业务线各一次 groupBy */
export async function 客户分布of(范围: 范围): Promise<客户分布> {
  const where = {
    pool: { is: null },
    ...(范围 === undefined ? {} : { salesOwnerId: typeof 范围 === "string" ? 范围 : { in: [...范围] } }),
  };
  const [国家们, 线们] = await Promise.all([
    prisma.customer.groupBy({ by: ["addrCountry"], where, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["bizLine"], where, _count: { _all: true } }),
  ]);
  return 排客户分布(国家们, 线们);
}

/**
 * 数据页签「现在」最上面那排 + 卡点分布 + 超时预警。
 * 范围 给项目和任务（同图表）；卡点按 me 的卡点看板那一圈
 */
export async function 复盘概况of(
  范围: 范围,
  me: 谁,
  本位币: string,
  now: ReturnType<typeof dayjs> = dayjs(),
): Promise<{ 概况: 复盘概况; 预警: 预警行[]; 分布: 卡点分布 }> {
  const 人 = 负责人条件(范围);
  const 圈 = (w: object) => ({ AND: [w, ...(人 ? [人] : [])] });
  const [在跟, 计数, 分布, 钱们, 回公海, 规则] = await Promise.all([
    prisma.project.count({ where: 圈({ result: null, pooledAt: null }) }),
    复盘待办计数(范围, now),
    卡点分布of(me),
    prisma.project.findMany({
      where: 圈({ pooledAt: null, OR: [{ contractAmount: { gt: 0 } }, { entPayments: { some: {} } }] }),
      select: { contractAmount: true, contractCurrency: true, currency: true, result: true, entPayments: { select: { currency: true, amount: true } } },
    }),
    将回公海of(范围, now.toDate()),
    生效组织规则(),
  ]);
  const 回款 = 算回款(钱们, 本位币);
  return {
    概况: {
      在跟,
      逾期任务: 计数.overdue,
      未解决卡点: 分布.总数,
      已回款: 回款.已回款,
      待回款: 回款.待回款,
      外币项目: 回款.外币项目,
      将回公海: 规则.超时回收.开 ? 回公海.提醒.总数 : null,
    },
    预警: 回公海.预警,
    分布,
  };
}
