import type { Prisma } from "@/generated/prisma";
import type { dayjs } from "@/lib/utils";

/**
 * 企业版复盘页「卡点」「沟通」两个页签（P7 U-复盘-01，10-31）的规矩：地址栏怎么读、查哪些行。
 * 只管拼条件，不碰库（页面、测试都直接用）；取数在 review-tabs-db.ts。
 *
 * 看谁的跟「任务」「数据」两个页签同一个 看板的人 的 谁（board-member.ts）：
 *   - 业务员：谁 = [自己]；经理：谁 = 自己 + 下属（选了某个人 = [他]）；老板、总管理员：谁 = undefined（不限人）。
 * 这一层是服务端兜底：企业版没开「按组织看客户」时 prisma 那层不拦人。
 *
 * 地址栏：tab=block  bs=open|done|all（卡点状态，默认 open）  p=页码
 *        tab=talk   t=7|30|90|all（最近几天，默认 all）  p=页码
 */

export const 复盘列表每页 = 20;

/** 卡点页签的状态筛选：未解决（看板 / 待接受 / 处理中）、已解决、全部 */
export const 卡点筛们 = ["open", "done", "all"] as const;
export type 卡点筛 = (typeof 卡点筛们)[number];
export const 卡点筛叫法: Record<卡点筛, string> = { open: "未解决", done: "已解决", all: "全部" };
export const 读卡点筛 = (v?: string): 卡点筛 => ((卡点筛们 as readonly string[]).includes(v ?? "") ? (v as 卡点筛) : "open");

/** 沟通页签的时间筛选：最近 7 / 30 / 90 天、全部 */
export const 沟通段们 = ["7", "30", "90", "all"] as const;
export type 沟通段 = (typeof 沟通段们)[number];
export const 沟通段叫法: Record<沟通段, string> = { "7": "近 7 天", "30": "近 30 天", "90": "近 90 天", all: "全部" };
export const 读沟通段 = (v?: string): 沟通段 => ((沟通段们 as readonly string[]).includes(v ?? "") ? (v as 沟通段) : "all");

/** 页码超出最后一页时落到最后一页 */
export function 夹页(页: number, 总数: number, 每页 = 复盘列表每页): number {
  return Math.min(Math.max(1, 页), Math.max(1, Math.ceil(总数 / 每页)));
}

/**
 * 卡点页签查哪些（查询包在 看全部 里，范围全靠这里，同 blocker.ts 的明着查）：
 *   - 谁 = undefined（老板、总管理员）：全部卡点；
 *   - 否则：项目负责人在 谁 里、项目不在公海（公海里的卡点不跟着公开，E11）；
 *     谁 里有我自己时，再加上指认 / 转给我的、我发布的、我是点了同意的组员的项目上的。
 *     经理看下属时只按下属负责的项目算，不按「指认给下属的」——那可能是别的组的项目，经理看不到。
 */
export function 卡点条件(谁: readonly string[] | undefined, 我: string, 筛: 卡点筛): Prisma.EntBlockerWhereInput {
  const 状态: Prisma.EntBlockerWhereInput = 筛 === "open" ? { status: { not: "已解决" } } : 筛 === "done" ? { status: "已解决" } : {};
  if (!谁) return 状态;
  const 或: Prisma.EntBlockerWhereInput[] = [{ project: { ownerId: { in: [...谁] }, pooledAt: null } }];
  if (谁.includes(我))
    或.push(
      { assigneeId: 我 },
      { creatorId: 我 },
      { project: { pooledAt: null, members: { some: { userId: 我, inviteStatus: "JOINED" } } } },
    );
  return { ...状态, OR: 或 };
}

/**
 * 沟通页签查哪些：挂在项目节点上的沟通记录（项目没删），谁 给了就按记录人（ownerId）筛，段 = 最近几天（从那天零点起）。
 * 查询走带限定的 prisma：看得到哪些客户的沟通由那一层管（公海里同事客户的沟通内容照旧不给）
 */
export function 沟通条件(谁: readonly string[] | undefined, 段: 沟通段, now: ReturnType<typeof dayjs>): Prisma.FollowUpWhereInput {
  return {
    projectNode: { is: { project: { deletedAt: null } } },
    ...(谁 ? { ownerId: { in: [...谁] } } : {}),
    ...(段 === "all" ? {} : { occurredAt: { gte: now.startOf("day").subtract(Number(段) - 1, "day").toDate() } }),
  };
}

export type 复盘卡点行 = {
  id: string;
  code: string;
  projectId: string;
  项目: string;
  客户: string;
  type: string;
  impact: string;
  description: string;
  status: string;
  /** 项目负责人 */
  负责人: string;
  /** 现在谁在处理；看板上的为空 */
  经手人: string | null;
  createdAt: string;
};
export type 复盘卡点 = { 总数: number; 页: number; 行: 复盘卡点行[] };

export type 复盘沟通行 = {
  id: string;
  时间: string;
  projectId: string;
  项目: string;
  /** 记这条时项目在哪个节点 */
  节点: string;
  客户: string;
  方式: string;
  标题: string;
  内容: string;
  负责人: string;
};
export type 复盘沟通 = { 总数: number; 页: number; 行: 复盘沟通行[] };
