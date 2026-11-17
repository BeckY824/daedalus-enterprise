/**
 * 补零项目客户的脚本建的「潜客培育」项目（M-公海-14 老数据补齐，11-17）：creatorId 记 补建创建人、createdAt 记客户的建档时间。
 * 它们不是谁这段时间新建的，所以「新建」类的数一律不算（不然补一次就把历史月份撑大）：
 *   - 数据页 新建（按年 / 按月走势、按人、本月 / 本年漏斗与线索瀑布那批）：overview/project-stats.ts
 *   - 首页卡「本月新增」（卡上的数和点进去的列表同一个条件）：home-cards.ts
 *   - 渠道看板、渠道列表分档（本月 / 本季 / 自定义）的「总线索 / 关联项目」：channel-dash.ts（「全部」照旧算，它是关联项目总数、不是新建）
 * 别的（阶段、节点、结局、转商机 / 转订单、持有数……）照常算。
 * 这里只有常量、不碰 prisma，界面、单测都能引
 */
import type { Prisma } from "@/generated/prisma";

/** 补建项目的 creatorId（不是哪位成员；同超时回收留痕里的 系统操作人 一个值） */
export const 补建创建人 = "system";

/** 「新建」类计数用：排掉补建的项目 */
export const 不算补建 = { creatorId: { not: 补建创建人 } } satisfies Prisma.ProjectWhereInput;

/** 这个项目是补建的吗（取回来在内存里分时用） */
export function 是补建(p: { creatorId?: string | null }): boolean {
  return p.creatorId === 补建创建人;
}
