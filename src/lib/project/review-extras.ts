import type { Prisma } from "@/generated/prisma";
import type { 组织规则 } from "./org-rules";
import { 节点超时天数 } from "./timeout";
import { 本套名, type 阶段字典 } from "./stage-dict";

/**
 * 复盘页（企业版按项目）11-01 版式融合后多出来的几块：任务页签下的「回收提醒」、沟通页签旁的「还没沟通过的项目」、
 * 卡点页签和数据页签的「卡点分布」、数据页签「现在」最上面那排 KPI 和「超时预警」。
 * 这里只算、只拼条件，不碰库（单测直接引）；取数在 review-extras-db.ts。
 *
 * 看谁的：同复盘页其他块，范围 = 看板的人 给的那一圈（只看了某个人 = 他；老板、总管理员 = 不限），按项目负责人筛。
 * 口径都借现成的：回收日 = timeout.ts 的 超时回收日，「3 天内」= home-cards.ts 的 即将逾期；
 * 还没沟通过 = 首页「暂未跟进」卡（在推、一条沟通都没挂）；卡点范围 = 卡点看板那一圈（blocker.ts 卡点看板范围，不另起炉灶）。
 */

/** 范围 → 项目负责人条件；不限人 = undefined */
export function 负责人条件(范围: string | readonly string[] | undefined): Prisma.ProjectWhereInput | undefined {
  if (范围 === undefined) return undefined;
  return { ownerId: typeof 范围 === "string" ? 范围 : { in: [...范围] } };
}

/** 回收提醒：线索、商机每个节点一条（节点天数从组织规则读，企业版没设的按字典默认）；数 = 这一圈里 3 天内要回公海的项目 */
export type 回收条 = { 阶段: "线索" | "商机"; 节点: string; 天数: number; 数: number };
export type 回收提醒 = { 开: boolean; 条: 回收条[]; 总数: number };

export function 回收条们(规则: 组织规则, 字典: 阶段字典, 各节点数: ReadonlyMap<string, number>): 回收提醒 {
  if (!规则.超时回收.开) return { 开: false, 条: [], 总数: 0 };
  const 条: 回收条[] = [];
  for (const 阶段 of ["线索", "商机"] as const)
    for (const 节点 of 字典.节点们[阶段]) {
      const 天数 = 节点超时天数(规则, 节点, 字典);
      if (天数) 条.push({ 阶段, 节点, 天数, 数: 各节点数.get(节点) ?? 0 });
    }
  // 节点改过名、存着旧名的项目：并到本套名下；字典里已经没有的节点不摆条，但算进总数
  let 总数 = 0;
  for (const n of 各节点数.values()) 总数 += n;
  return { 开: true, 条, 总数 };
}

/** 一组项目按节点数（节点按本套名并） */
export function 按节点数(们: readonly { node: string }[], 字典: 阶段字典): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of 们) {
    const n = 本套名(p.node, 字典);
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
}

/** 超时预警的一行（数据页签）：3 天内回公海的项目，回收日早的在前 */
export type 预警行 = { id: string; 名: string; 节点: string; 负责人: string; 回收日: string };
export const 预警最多 = 8;

/** 还没沟通过的项目（沟通页签旁）：首页「暂未跟进」同口径，最近建的在前，最多 5 个 + 总数 */
export type 缺沟通行 = { id: string; 名: string; 客户: string; 节点: string; 负责人: string; 建于: string };
export type 缺沟通 = { 总数: number; 行: 缺沟通行[] };
export const 缺沟通最多 = 5;

/** 卡点分布：按阻碍主体（多的在前，没填的叫「没填」放最后）+ 按状态 */
export type 卡点分布 = { 总数: number; 按主体: { 主体: string; 数: number }[]; 按状态: { 状态: string; 数: number }[] };
export const 卡点状态序 = ["待接受", "处理中", "已解决"] as const;

export function 排卡点分布(
  主体们: readonly { obstacle: string; _count: { _all: number } }[],
  状态们: readonly { status: string; _count: { _all: number } }[],
): 卡点分布 {
  const 主体 = new Map<string, number>();
  for (const g of 主体们) {
    const k = g.obstacle.trim() || "没填";
    主体.set(k, (主体.get(k) ?? 0) + g._count._all);
  }
  const 按主体 = [...主体].map(([k, 数]) => ({ 主体: k, 数 })).sort((a, b) => (a.主体 === "没填" ? 1 : b.主体 === "没填" ? -1 : b.数 - a.数 || a.主体.localeCompare(b.主体, "zh")));
  const 状态 = new Map(状态们.map((g) => [g.status, g._count._all]));
  const 序 = [...卡点状态序, ...[...状态.keys()].filter((s) => !(卡点状态序 as readonly string[]).includes(s))];
  const 按状态 = 序.flatMap((s) => (状态.get(s) ? [{ 状态: s, 数: 状态.get(s)! }] : []));
  return { 总数: 按主体.reduce((s, x) => s + x.数, 0), 按主体, 按状态 };
}

/** 数据页签「现在」最上面那排 */
export type 复盘概况 = {
  /** 在推的项目（没结局、不在公海） */
  在跟: number;
  /** 逾期的任务 + 跟进计划（同任务页签「逾期」卡） */
  逾期任务: number;
  /** 未解决卡点（待接受 + 处理中，同卡点看板那一圈） */
  未解决卡点: number;
  /** 已回款：这一圈项目上记的回款，只合本位币 */
  已回款: number;
  /** 待回款：合同金额 − 已回款（本位币的合同、没丢单 / 没流失的），不到 0 记 0 */
  待回款: number;
  /** 别的币种的回款或合同有几个项目（只提示，不折算） */
  外币项目: number;
  /** 3 天内回公海（同首页卡口径，按这一圈负责人数）；超时回收没开 = null */
  将回公海: number | null;
};

/** 不算待回款的结局：没成的项目合同不会再回款 */
export const 不催回款的结局 = ["线索流失", "丢单"] as const;

export function 算回款(
  们: readonly {
    contractAmount: number | null;
    contractCurrency: string | null;
    /** 项目币种：合同没写币种时按它（同项目页） */
    currency?: string | null;
    result: string | null;
    entPayments: readonly { currency: string; amount: number }[];
  }[],
  本位币: string,
): { 已回款: number; 待回款: number; 外币项目: number } {
  let 已回款 = 0;
  let 待回款 = 0;
  let 外币项目 = 0;
  for (const p of 们) {
    const 本币回 = p.entPayments.filter((x) => x.currency === 本位币).reduce((s, x) => s + x.amount, 0);
    const 合同币 = p.contractCurrency ?? p.currency ?? 本位币;
    const 有外币 = p.entPayments.some((x) => x.currency !== 本位币) || (!!p.contractAmount && 合同币 !== 本位币);
    if (有外币) 外币项目++;
    已回款 += 本币回;
    if (p.contractAmount && 合同币 === 本位币 && !(不催回款的结局 as readonly string[]).includes(p.result ?? ""))
      待回款 += Math.max(0, p.contractAmount - 本币回);
  }
  return { 已回款, 待回款, 外币项目 };
}

/**
 * 客户分布（11-03 客户反馈：复盘数据页最下方加客户分布图；同日又要「像地图那种的呈现」）：这一圈负责的客户（不含公海、回收站）按国家、按业务线数。
 * 按国家给两份，都出自同一次 groupBy：
 *   - 按国家：地图旁的榜单用。前 8 个照摆，其余并成「其他」；没填的不在里面，单写一行「未填国家 N 个」（未填国家）
 *   - 全部国家：地图用。不截断、不含没填的
 * 业务线没填的仍单列、排最后
 */
export type 分布条 = { 名: string; 数: number };
export type 客户分布 = { 总数: number; 按国家: 分布条[]; 全部国家: 分布条[]; 未填国家: number; 按业务线: 分布条[] };
export const 国家最多 = 9;

/** 名字去空格后合并同名，多的在前、同数按拼音；空的（null、全空格）另数 */
function 数一列(们: readonly { 键: string | null; 数: number }[]): { 有: 分布条[]; 空: number } {
  const 计 = new Map<string, number>();
  let 空 = 0;
  for (const g of 们) {
    const k = g.键?.trim();
    if (k) 计.set(k, (计.get(k) ?? 0) + g.数);
    else 空 += g.数;
  }
  return { 有: [...计].map(([名, 数]) => ({ 名, 数 })).sort((a, b) => b.数 - a.数 || a.名.localeCompare(b.名, "zh")), 空 };
}

function 排一列({ 有, 空 }: { 有: 分布条[]; 空: number }, 没填: string | null, 最多 = Infinity): 分布条[] {
  const 前 = 有.length > 最多 ? [...有.slice(0, 最多 - 1), { 名: "其他", 数: 有.slice(最多 - 1).reduce((s, x) => s + x.数, 0) }] : 有;
  return 空 && 没填 ? [...前, { 名: 没填, 数: 空 }] : 前;
}

export function 排客户分布(
  国家们: readonly { addrCountry: string | null; _count: { _all: number } }[],
  线们: readonly { bizLine: string | null; _count: { _all: number } }[],
): 客户分布 {
  const 国 = 数一列(国家们.map((g) => ({ 键: g.addrCountry, 数: g._count._all })));
  return {
    总数: 国家们.reduce((s, g) => s + g._count._all, 0),
    按国家: 排一列(国, null, 国家最多),
    全部国家: 国.有,
    未填国家: 国.空,
    按业务线: 排一列(数一列(线们.map((g) => ({ 键: g.bizLine, 数: g._count._all }))), "未填业务线"),
  };
}
