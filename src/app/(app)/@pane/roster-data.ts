import { prisma } from "@/lib/prisma";
import { 负责人显示名 } from "@/lib/pool";
import { 最近跟进的客户, 不限定时最近跟进的客户, 看得到的非公海数 } from "@/lib/scope-sql";
import { 客户筛选条件 } from "@/app/(app)/customers/query";
import type { Prisma } from "@/generated/prisma";
import { scheduleValue, scheduleOrder, earliestScheduled } from "@/lib/schedule-date";
import { requireUser } from "@/lib/auth";
import { FOLLOW_TYPE_MAP } from "@/lib/constants";
import { 企业版 } from "@/lib/enterprise/switch";
import { 按主键取没删的 } from "@/lib/enterprise/soft-delete-core";
import { getBusiness } from "@/lib/business";
import { 读名单项目 } from "@/lib/project/list";
import { 补项目去 } from "@/lib/project/customer-detail-direct";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 字典of } from "@/lib/project/stage-dict";
import { 页面字典 } from "@/lib/enterprise/dict";
import { 客户状态色表 } from "@/lib/enterprise/cust-status-color";
import { 拼地址 } from "@/lib/enterprise/customer-v2";
import { 客户显名 } from "@/lib/enterprise/customer-title";
import { 权限组织 } from "@/lib/enterprise/org";
import { 有管理范围 } from "@/lib/enterprise/permissions";
import type { CustomerRosterData } from "@/components/CustomerRoster";
import type { ProjectRosterData } from "@/components/ProjectRoster";

/**
 * 客户详情中栏名单的数据（原来写在 @pane/panes.tsx 学员名单 里，名单现在在 roster-panes.tsx）。拆出来是为了两处共用（跳转优化 PR-A 审查补）：
 *   - 进详情时 @pane/customers/(detail)/layout.tsx → 学员名单 在服务端算一遍
 *   - 名单挪进 layout 以后换人不再重查：切回标签页、或隔了 60 秒以上又换了一位时，名单自己在后台拉 /api/roster/customers 换上新的
 *     （lib/roster-refresh.ts）。不用 router.refresh：那会清掉整个路由缓存（预取的、后退要用的都没了）
 */
export async function 客户名单数据(): Promise<{ data: CustomerRosterData; 默认页签: "全部" | "我的" }> {
  const me = await requireUser();
  // 业务员（带范围）先用裸 SQL 挑出那 50 位的编号再按编号取，免得范围那句 OR 把客户表整张扫两遍（lib/scope-sql.ts）
  const 企业 = 企业版();
  /*
    公海不进这张名单（P-看-03「公海只在公海页签出现」，11-11 实点：总数和「全部」混进公海、「我的」从 50 位里筛成空）：
    总数 = 客户列表「客户」页签那个数（lib/pool-db.ts 客户页签数 的非公海；这里直接数非公海（scope-sql 看得到的非公海数），不数公海那头：
    回避名单过上限的销售数公海要 0.2–0.5 s，每次进详情都吃一下，11-22 切页卡顿调研），行的条件 = 客户列表不筛时的条件（query.ts 客户筛选条件），
    「我的」另取自己负责的最近 50 位，不在「全部」那 50 位里再筛
  */
  /*
    不限定的人（4 核提速 C，11-16）另走一句裸 SQL 取编号（顺 (lastFollowAt, createdAt, id) 凑够 50 位就停，见 不限定时最近跟进的客户）；
    有市场只读、回避名单过上限这些两边都回 null 的照旧走下面 Prisma 那句
  */
  const [非公海数, ids, 列表条件, 状态字典] = await Promise.all([看得到的非公海数(), 最近跟进的客户(50).then((x) => x ?? 不限定时最近跟进的客户(50)), 客户筛选条件({}, me.id), 企业 ? 页面字典("custStatus") : null]);
  const 排序 = [{ lastFollowAt: "desc" as const }, { createdAt: "desc" as const }];
  const 字段 = {
    id: true, name: true, shortName: true, customerNo: true, followStatus: true, custStatus: true, lastFollowAt: true, salesOwnerId: true,
    salesOwner: { select: { name: true } },
    channel: { select: { name: true } },
    addrCountry: true, addrProvince: true, addrCity: true,
    referrerCustomerId: true,
    /*
      每位最近一条跟进：Prisma 把 50 位的跟进一句取回（customerId IN (50 个)，take 在内存里按位截）。只按 occurredAt 排时，
      没统计信息的 SQLite 会挑 (deletedAt, occurredAt) 顺着时间扫 25 万条再挑这 50 位（55–60 ms，迁移 137 带出来的）；
      先按 customerId 排，(customerId, …) 的索引接得住，每位内部还是按时间倒序，截出来的那条不变（0.2 ms，tests/perf-85k-indexes.test.ts 钉着）
    */
    followUps: { orderBy: [{ customerId: "asc" as const }, { occurredAt: "desc" as const }], take: 1, select: { content: true, type: true } },
    // 最近一条还没做的计划：「本周要跟」那个页签和右下角的圆点都看它
    plans: { where: { done: false }, orderBy: [{ plannedAt: "asc" as const }, { id: "asc" as const }], select: { plannedAt: true, plannedOn: true } },
  } satisfies Prisma.CustomerSelect;
  /*
    和客户页「范围」对齐（客户 11-18 第 12 题）：「我的」= 我负责的。企业版里没有管理范围的（销售）默认停在「我的」，
    「我的」那一页的总数另数一句（= 客户页「我负责的」= 设置里的客户数）；有管理范围的默认「全部」（= 我可见的）
  */
  const 管理 = 企业 ? 有管理范围(me, await 权限组织()) : true;
  const [取, 我的, 我的总数] = await Promise.all([
    // 按编号取走主键（第四轮 11-14）：带着 deletedAt IS NULL 时 SQLite 放着主键不走、顺 deletedAt 索引扫 8.5 万位，见 按主键取没删的
    ids
      ? 按主键取没删的(() => prisma.customer.findMany({ where: { id: { in: ids } }, select: { ...字段, deletedAt: true } }))
      : prisma.customer.findMany({ where: 列表条件, orderBy: 排序, take: 50, select: 字段 }),
    prisma.customer.findMany({ where: { AND: [列表条件, { salesOwnerId: me.id }] }, orderBy: 排序, take: 50, select: 字段 }),
    企业 ? prisma.customer.count({ where: { AND: [列表条件, { salesOwnerId: me.id }] } }) : undefined,
  ]);
  const 位 = new Map(ids?.map((id, i) => [id, i]));
  const rows = ids ? 取.sort((a, b) => 位.get(a.id)! - 位.get(b.id)!) : 取;
  const 一行 = (c: (typeof 取)[number]) => {
    const p = earliestScheduled(c.plans, p => scheduleOrder(p.plannedAt, p.plannedOn), 1)[0];
    return {
      // 企业版客户名称选填（11-19）：名单上的名字（头像、名单内筛也按它）没全称按简称 → 客户编号叫
      id: c.id, name: 企业 ? 客户显名(c) : c.name, followStatus: c.followStatus,
      ...(企业 ? { custStatus: c.custStatus } : {}),
      lastFollowAt: c.lastFollowAt ? c.lastFollowAt.toISOString() : null,
      ownerName: 负责人显示名(c.salesOwner.name),
      mine: c.salesOwnerId === me.id,
      lastNote: c.followUps[0]?.content?.trim().slice(0, 60) || null,
      // 渠道名 > 转介绍 > 最近一次跟进方式，都没有就留空。
      // 企业版（11-04 用户：名单里名字上方从「来源」改成客户所在国家地区）：国内「省 市」、国外「国家 城市」，不带区；没填就留空
      source: 企业 ? 拼地址({ addrCountry: c.addrCountry, addrProvince: c.addrProvince, addrCity: c.addrCity }) || null : c.channel?.name ?? (c.referrerCustomerId ? "转介绍" : c.followUps[0] ? (FOLLOW_TYPE_MAP[c.followUps[0].type]?.label ?? null) : null),
      nextPlanAt: p ? scheduleValue(p.plannedAt, p.plannedOn) : null,
    };
  };
  const 行们 = rows.map(一行);
  /*
    业务员看得到的不在公海的客户就是自己名下的：两份 50 位一模一样。同一个数组交给页面，RSC 只写一遍
    （11-14 体验优化：客户详情每次少十几 KB）；有一位不同就照旧各给各的
  */
  const 同一份 = 我的.length === rows.length && 我的.every((c, i) => c.id === rows[i].id);
  return {
    data: {
      total: 非公海数,
      客户状态: 状态字典 ? { 顺序: 状态字典.filter((x) => x.active).map((x) => x.name), 颜色: 客户状态色表(状态字典) } : null,
      rows: 行们,
      mineRows: 同一份 ? 行们 : 我的.map(一行),
      ...(我的总数 !== undefined ? { mineTotal: 我的总数 } : {}),
    },
    默认页签: 管理 ? "全部" : "我的",
  };
}

/** 项目详情中栏名单的数据（同上：@pane/projects/(detail)/layout.tsx 和 /api/roster/projects 共用）；不是企业版、项目模式关着回 null */
export async function 项目名单数据(): Promise<ProjectRosterData | null> {
  const me = await requireUser();
  if (!企业版() || (await getBusiness()).projectMode !== true) return null;
  const 规则 = await 生效组织规则();
  const 名单 = await 读名单项目(me, 字典of(true, 规则.阶段.出口叫法));
  // 点一行直接去项目页会跳去的客户页（跳转优化 PR-A 3703 实操补）：不经过 /projects/<id> 再 replace 那段空正文；拿不准的照旧 /projects/<id>
  return { ...名单, rows: await 补项目去(me, 名单.rows, (r) => r.id) };
}
