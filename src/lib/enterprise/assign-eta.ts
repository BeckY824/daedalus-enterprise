/**
 * 企业版自动分配「快轮到我」（11-18 客户定第 1、2 题，都选 A）。
 *
 * - 估算：按自动分配现行的挑人规则（市场发起时的候选池：这条线勾的部门 / 成员标记里、在职、只给销售、不含销售管理；
 *   本月分得最少优先、一样少按账号开得早；每月 1 号清零；指定分配也计数），用 lead-assign 的 挑接手人 一条条往下挑，
 *   数出「前面约 N 条轮到你」（lead-assign 前面几条）。两条线都在候选里的人取小的那个。
 * - 系统里一条分配记录都还没有 = 「暂无法估算」；有了才给数。
 * - 首页一直显示一行（只对参加自动分配的销售）；设置 → 组织架构 →「线索分配」那一屏多一列「前面约几条」。
 *   谁能看（能看轮到）：本人；分配线索的人（总管理、条线总管理、市场管理）看全部；只是销售管理的看本组（部门连下级）。
 *   没有销售管理的组由总管理看（总管理本来看全部）。只认业务角色，不看账号 ADMIN / MANAGER。
 * - 推送（快轮到提醒）：每次分配以后（notice-sources 分配通知 末尾调）给候选池里的销售各算一遍，进入 3 条以内时铃铛 + 飞书各发一次。
 *   边沿触发：「这一轮推过没有」不另存字段，记在通知表的去重键上——键 = 这个人一共收到过几条分配（被分到一条 = 换一轮、重新计数）；
 *   同一轮里数字来回跳也只有第一次进 3 条以内那次记得上（EntNotice 的 userId + dedupeKey 唯一），所以不重复推。只推销售本人，管理只看不推。
 */
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import type { 组织 } from "./org-core";
import { 能分配线索 } from "./permissions";
import { 规则开着 } from "./rules";
import { notify } from "./notify";
import {
  月份, 本月加额们, 生效配额, 前面几条, 计不计数, 自动候选人们, 认参与状态, 企划线索计数key, 自动分配不参与key, 不设配额key,
  type 候选人, type 线,
} from "./lead-assign";
import { 按部门候选, 只留销售, 两条线, 规整线部门, 线部门key, 线部门们, type 线部门 } from "./assign-line";
import { 去掉销售管理 } from "./customer-region";

/** 前面几条以内算「快轮到」（员工原话「还有 3 条就轮到我时提醒我」） */
export const 快轮到条数 = 3;
export const 快轮到kind = "快轮到";
/** 首页、设置那一列旁边的说明 */
export const 估算说明 = "这是估算：指定分配、有人暂停或新同事加入都会让它变";

/** 前面约几条：数 = 按现在的数估出来的；暂无法估算 = 系统里还没有一条分配记录 */
export type 轮到 = { 数: number } | "暂无法估算";

/** 后台设的「各条线参与自动分配的部门」；没设 = 两条线都没勾（按成员标记） */
export async function 读线部门(): Promise<线部门> {
  return 规整线部门(await getSetting<unknown>(线部门key));
}
/** 每人参与状态（暂停 / 禁止的才在表里）；老格式 string[] 读成禁止，存坏了当人人允许 */
export async function 参与状态表() {
  return 认参与状态(await getSetting<unknown>(自动分配不参与key));
}
/** 不进轮转的人：暂停、禁止都算 */
export async function 不参与名单(): Promise<string[]> {
  return Object.keys(await 参与状态表());
}
/** 规则里的「不设配额」开着没：没存过 = 开着（11-01 A10 / A11），存了 false 才按配额 */
export async function 不设配额开着(): Promise<boolean> {
  return (await getSetting<boolean>(不设配额key)) !== false;
}

/**
 * 市场成员发起自动分配时这条线的候选池（P-转-26，按客户区域定事业部）：这条线的人（勾了部门按部门，没勾按成员标记），
 * 去掉现负责人、销售管理，只留有「销售」业务角色的。assign-actions 自动分给 按区域那一支和这里的估算共用
 */
export function 自动分配池(org: 组织, 现负责人: string | null, line: 线, 设: 线部门): string[] {
  return 只留销售(org, 去掉销售管理(org, 按部门候选(org, 现负责人, line, 设, 自动候选人们)));
}

/**
 * 挑人要的数（自动分给 和 估算共用一份）：这几个人本月已分（只数算数的）、生效配额、建号时间（= 进池先后），
 * 外加不参与名单、营销企划算不算数、是不是不设配额
 */
export async function 读挑人底子(人们: readonly string[], 月 = 月份()) {
  const ids = [...人们];
  const [计数, 配额, 加额, 建号, 不参与, 企划算数, 不限额] = await Promise.all([
    prisma.entLeadAssign.groupBy({ by: ["toUserId"], where: { month: 月, counted: true, toUserId: { in: ids } }, _count: { _all: true } }),
    prisma.entLeadQuota.findMany({ where: { userId: { in: ids } } }),
    本月加额们(ids, 月),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, createdAt: true } }),
    不参与名单(),
    getSetting<boolean>(企划线索计数key),
    不设配额开着(),
  ]);
  const 数 = new Map(计数.map((c) => [c.toUserId, c._count._all]));
  // 生效配额 = 设的 + 本月加的额（线索最终判无效 +1）
  const 额 = new Map(配额.map((q) => [q.userId, 生效配额(q.quota, 加额.get(q.userId) ?? 0)]));
  const 候选: 候选人[] = 建号.map((u) => ({ userId: u.id, 已分: 数.get(u.id) ?? 0, 配额: 额.get(u.id) ?? null, 进池: u.createdAt }));
  return { 候选, 额, 建号, 不参与, 企划算数, 不限额 };
}

/**
 * 参加自动分配的销售各自「前面约几条」：规则「线索分配」没开 = 空表。不在任何一条线的候选池里、暂停 / 禁止、按配额分时分满了的人不在表里。
 * 系统里还没有一条分配记录：在池里、参与着的人都是「暂无法估算」
 */
export async function 估算轮到(org: 组织): Promise<Map<string, 轮到>> {
  const 出 = new Map<string, 轮到>();
  if (!(await 规则开着("线索分配"))) return 出;
  const 设 = await 读线部门();
  const 池们 = 两条线.map((l) => 自动分配池(org, null, l, 设));
  const 全部 = [...new Set(池们.flat())];
  if (!全部.length) return 出;
  const [底, 有记录] = await Promise.all([读挑人底子(全部), prisma.entLeadAssign.findFirst({ select: { id: true } })]);
  const 不参与 = new Set(底.不参与);
  // 估的是市场按区域发起的营销线索（最常见的那种）：营销线索一律算数
  const 查满 = 计不计数("营销", 底.企划算数);
  for (const 池 of 池们) {
    const 候选 = 底.候选.filter((c) => 池.includes(c.userId));
    for (const c of 候选) {
      if (不参与.has(c.userId)) continue;
      if (!有记录) { 出.set(c.userId, "暂无法估算"); continue; }
      const n = 前面几条(候选, 不参与, 查满, 底.不限额, c.userId);
      if (n === null) continue;
      const 旧 = 出.get(c.userId);
      if (!旧 || 旧 === "暂无法估算" || n < 旧.数) 出.set(c.userId, { 数: n });
    }
  }
  return 出;
}

/** 我自己的（首页那一行）：不是参加自动分配的销售 = null，不画 */
export async function 我的轮到(org: 组织, userId: string): Promise<轮到 | null> {
  return (await 估算轮到(org)).get(userId) ?? null;
}

/**
 * 谁能看 目标 的「前面约几条」（11-18 第 2 题 A）：本人；分配线索的人（能分配线索、且是总管理 / 条线总管理 / 市场管理）看全部；
 * 销售管理看本组（他所在部门连下级）。别的都看不到。只认业务角色
 */
export function 能看轮到(org: 组织, me: { id: string; role?: string | null }, 目标: string): boolean {
  if (me.id === 目标) return true;
  const 角色 = org.成员.get(me.id)?.角色们 ?? [];
  if (能分配线索(me, org) && 角色.some((r) => r === "director" || r === "marketing_mgr")) return true;
  if (!角色.includes("sales_mgr")) return false;
  const 我组 = org.成员.get(me.id)?.deptId;
  const 他组 = org.成员.get(目标)?.deptId;
  return !!我组 && !!他组 && 线部门们(org.部门, [我组]).has(他组);
}

/** 给人看的那一句：「前面约 N 条轮到你」/「下一条就轮到你」/「暂无法估算」 */
export function 轮到话(x: 轮到, 你 = "你"): string {
  if (x === "暂无法估算") return "暂无法估算";
  return x.数 === 0 ? `下一条就轮到${你}` : `前面约 ${x.数} 条轮到${你}`;
}

/**
 * 分配以后给候选池里的销售判断要不要推「快轮到」（边沿触发，见文件头）。只推本人；出任何错由调用方吞掉。
 * 返回这次新推了几位（测试用）
 */
export async function 快轮到提醒(org: 组织): Promise<number> {
  const 估 = await 估算轮到(org);
  const 近的 = [...估].filter((e): e is [string, { 数: number }] => e[1] !== "暂无法估算" && e[1].数 <= 快轮到条数);
  if (!近的.length) return 0;
  // 这一轮 = 这个人一共收到过几条分配（不分月份、算不算数）：被分到一条就换一轮
  const 收到 = await prisma.entLeadAssign.groupBy({ by: ["toUserId"], where: { toUserId: { in: 近的.map(([id]) => id) } }, _count: { _all: true } });
  const 轮 = new Map(收到.map((c) => [c.toUserId, c._count._all]));
  let 推了 = 0;
  for (const [userId, x] of 近的) {
    推了 += await notify([userId], {
      kind: 快轮到kind,
      title: `自动分配快轮到你了：${轮到话(x)}`,
      body: `按现在的数估的。${估算说明}。`,
      link: "/dashboard",
      key: `assign-eta:${轮.get(userId) ?? 0}`,
    });
  }
  return 推了;
}
