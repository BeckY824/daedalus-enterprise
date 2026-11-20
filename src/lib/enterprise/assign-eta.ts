/**
 * 企业版自动分配「快轮到我」（11-18 客户定第 1、2 题，都选 A）。
 *
 * - 估算：按自动分配现行的挑人规则（候选池 自动分配池：这条线勾的部门 / 成员标记里、在职、销售，内贸线另含销售管理（11-18 第 9 题 B），
 *   义乌档口整组不进（第 8 题 B）；本月分得最少优先、一样少按账号开得早；中途回来 / 加入的按同池最少的数起算（第 3 题 B，起算补）；
 *   每月 1 号清零；指定分配也计数，公海分配不计（第 2 题）），用 lead-assign 的 挑接手人 一条条往下挑，
 *   数出「前面约 N 条轮到你」（lead-assign 前面几条）。两条线都在候选里的人取小的那个。
 * - 系统里一条分配记录都还没有 = 「暂无法估算」；有了才给数。
 * - 首页一直显示一行（只对参加自动分配的销售）；设置 → 组织架构 →「线索分配」那一屏多一列「前面约几条」。
 *   谁能看（能看轮到）：本人；分配线索的人（总管理、条线总管理、市场管理）看全部；只是销售管理的看本组（部门连下级）。
 *   没有销售管理的组由总管理看（总管理本来看全部）。只认业务角色，不看账号 ADMIN / MANAGER。
 * - 推送（快轮到提醒）：每次分配以后（notice-sources 分配通知 末尾调）给候选池里的销售各算一遍，进入 3 条以内时铃铛 + 飞书各发一次。
 *   边沿触发：「这一轮推过没有」不另存字段，记在通知表的去重键上——键 = 本月（北京）+ 这个人一共收到过几条分配（被分到一条 = 换一轮、重新计数；换月也是新一轮）；
 *   同一轮里数字来回跳也只有第一次进 3 条以内那次记得上（EntNotice 的 userId + dedupeKey 唯一），所以不重复推。只推销售本人，管理只看不推。
 */
import { prisma } from "@/lib/prisma";
import { getSetting, invalidateSettingsCache } from "@/lib/settings";
import type { 组织 } from "./org-core";
import { 能分配线索 } from "./permissions";
import { 规则开着 } from "./rules";
import { notify } from "./notify";
import {
  月份, 本月加额们, 生效配额, 前面几条, 计不计数, 自动候选人们, 认参与状态, 企划线索计数key, 自动分配不参与key, 不设配额key,
  起算时刻key, 认起算时刻, 起算补, 月初of, 按行数已分, 参与状态of, 接手问题, 挂补位,
  type 候选人, type 线, type 分配行, type 线索种类,
} from "./lead-assign";
import { 待用补位行, type 补位行 } from "./invalid-makeup";
import { 按部门候选, 自动可接, 在不进自动分配部门, 两条线, 规整线部门, 线部门key, 线部门们, type 线部门 } from "./assign-line";
import { 查完再写 } from "@/lib/check-then-write";

/** 前面几条以内算「快轮到」（员工原话「还有 3 条就轮到我时提醒我」） */
export const 快轮到条数 = 3;
export const 快轮到kind = "快轮到";
/** 首页、设置那一列旁边的说明 */
export const 估算说明 = "这是估算：指定分配、有人暂停或新同事加入都会让它变";

/**
 * 前面约几条：数 = 按现在的数估出来的；暂无法估算 = 系统里还没有一条分配记录。
 * 待补 = 他有几条判无效待补（方向对得上这条线的，invalid-makeup.ts）；有待补的排在前面，数多半是 0
 */
export type 轮到 = { 数: number; 待补?: number } | "暂无法估算";

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
 * 自动分配这条线的候选池（P-转-26 按客户区域那一支、项目业务线那一支、「快轮到我」估算共用）：这条线的人（勾了部门按部门，没勾按成员标记），
 * 去掉现负责人；只留能接的（自动可接：销售；内贸线另加销售管理，11-18 第 9 题 B，外贸销售管理不参与）；
 * 整组不进自动分配的部门（义乌档口，11-18 第 8 题 B）去掉。参与状态、配额由 挑接手人 再筛
 */
export function 自动分配池(org: 组织, 现负责人: string | null, line: 线, 设: 线部门): string[] {
  return 自动可接(org, 按部门候选(org, 现负责人, line, 设, 自动候选人们), line).filter((id) => !在不进自动分配部门(org, id));
}

/** 起算时刻表（见 lead-assign 起算时刻key）；存坏了当没设 */
export async function 起算时刻表(): Promise<Map<string, Date>> {
  return 认起算时刻(await getSetting<unknown>(起算时刻key));
}

/** 本月算数的分配行（谁、什么时候）：本月已分和起算补都从这里数；事务里重读计数传 tx */
export async function 本月分配行(ids: readonly string[], 月 = 月份(), db: Pick<typeof prisma, "entLeadAssign"> = prisma): Promise<分配行[]> {
  if (!ids.length) return [];
  const 们 = await db.entLeadAssign.findMany({ where: { month: 月, counted: true, toUserId: { in: [...ids] } }, select: { toUserId: true, createdAt: true } });
  return 们.map((r) => ({ toUserId: r.toUserId, at: r.createdAt }));
}

/**
 * 挑人要的数（自动分给 和 估算共用一份）：这几个人本月已分（只数算数的）、生效配额、建号时间（= 进池先后），
 * 外加不参与名单、营销企划算不算数、是不是不设配额、起算时刻和本月分配行。
 * 排序前要过 排位(子集)：按同池（传进来的那几位）做起算补（11-18 第 3 题 B），估算时每条线各补各的。
 * 补位（判无效待补，invalid-makeup.ts）：传了 = 这次分配用待补（算本月已分的新线索自动分配），排位时把方向对得上 线 的待补挂上去，
 * 挑接手人 让有待补的先；不传（公海分配、不算数的）= 不挂、照原来挑。kind 是营销企划且设成不算数的，同样不挂
 */
export async function 读挑人底子(人们: readonly string[], 月 = 月份(), 补位: { 线: 线 | null; kind?: 线索种类 } | null = null) {
  const ids = [...人们];
  const [行们, 配额, 加额, 建号, 不参与, 企划算数, 不限额, 起算, 补位行们] = await Promise.all([
    本月分配行(ids, 月),
    prisma.entLeadQuota.findMany({ where: { userId: { in: ids } } }),
    本月加额们(ids, 月),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, createdAt: true } }),
    不参与名单(),
    getSetting<boolean>(企划线索计数key),
    不设配额开着(),
    起算时刻表(),
    补位 ? 待用补位行(ids) : Promise.resolve([] as 补位行[]),
  ]);
  // 这次分配用不用待补：只用在算本月已分的那种（营销企划设成不算数的不用）
  const 用补位 = !!补位 && 计不计数(补位.kind ?? "营销", 企划算数);
  // 生效配额 = 设的 + 本月加的额（线索最终判无效 +1）
  const 额 = new Map(配额.map((q) => [q.userId, 生效配额(q.quota, 加额.get(q.userId) ?? 0)]));
  const 候选: 候选人[] = 按行数已分(建号.map((u) => ({ userId: u.id, 已分: 0, 配额: 额.get(u.id) ?? null, 进池: u.createdAt })), 行们);
  const 不参与集 = new Set(不参与);
  const 月初 = 月初of();
  /**
   * 排序用的候选（起算补过、挂了待补）：池 = 子集（不传 = 全部）；行 = 换一份分配行（事务里重读的）；
   * 补 = 换一份待用补位（事务里重读的）；线 = 换一条线挂待补（估算两条线各算各的；不传按读的时候给的线）
   */
  const 排位 = (子集?: readonly string[], 行?: readonly 分配行[], 补?: readonly 补位行[], 线?: 线 | null): 候选人[] => {
    const 池 = 子集 ? 候选.filter((c) => 子集.includes(c.userId)) : 候选;
    const 数过 = 行 ? 按行数已分(池, 行) : 池;
    const 排 = 起算补(数过, 起算, 行 ?? 行们, 不参与集, 月初);
    return 用补位 ? 挂补位(排, 补 ?? 补位行们, 线 === undefined ? 补位!.线 : 线) : 排;
  };
  return { 候选, 额, 建号, 不参与, 企划算数, 不限额, 排位, 用补位 };
}

/**
 * 内贸销售管理第一次进自动分配池（11-18 第 9 题 B 上线时他们本月都是 0 条）：记一笔起算时刻 = 现在，之后按起算补起算，
 * 不会一上线就连收十几条。只记没记过的、没有「销售」角色的销售管理（兼着销售的本来就在池里）；读改写在一个事务里，别的进程先记了就不动。
 * 出错只记日志：顶多这一次按 0 起算
 */
export async function 补记销售管理起算(org: 组织, 人们: readonly string[]): Promise<void> {
  const 要记 = 人们.filter((id) => {
    const 角色们 = org.成员.get(id)?.角色们 ?? [];
    return 角色们.includes("sales_mgr") && !角色们.includes("sales");
  });
  if (!要记.length) return;
  const 有 = await 起算时刻表();
  const 没记 = 要记.filter((id) => !有.has(id));
  if (!没记.length) return;
  try {
    const 记了 = await 查完再写(async (tx) => {
      const 行 = await tx.setting.findUnique({ where: { key: 起算时刻key } });
      let 原: Record<string, unknown> = {};
      try { const v: unknown = 行 ? JSON.parse(行.value) : {}; if (v && typeof v === "object" && !Array.isArray(v)) 原 = v as Record<string, unknown>; } catch { /* 坏了当空 */ }
      const 新 = 没记.filter((id) => !(id in 原));
      if (!新.length) return false;
      const 现在 = new Date().toISOString();
      const value = JSON.stringify({ ...原, ...Object.fromEntries(新.map((id) => [id, 现在])) });
      await tx.setting.upsert({ where: { key: 起算时刻key }, update: { value }, create: { key: 起算时刻key, value } });
      return true;
    });
    if (记了) invalidateSettingsCache();
  } catch (e) {
    console.warn("[自动分配] 销售管理起算时刻没记上：", e instanceof Error ? e.message : e);
  }
}

/** 指定分配（新建线索「指定分配」、定时指定、新线索列表「分配」同一条，11-18 第 8 题 B）：只给参与状态「正常」的销售 / 销售管理 */
export const 不正常不能指定话 = (态: string) => `只能指定给参与状态「正常」的销售：他现在是「${态}」，找总管理员在 设置 → 组织架构 →「线索分配」改`;

/**
 * 能不能指定给这个人：先看是不是在职的销售 / 销售管理（接手问题，业务线不比），再看参与状态（规则「线索分配」开着才看）。
 * null = 可以；义乌档口整组不进自动分配，但参与状态正常的照样能被指定
 */
export async function 指定问题(org: 组织, userId: string): Promise<string | null> {
  const 问 = 接手问题(org, userId, null);
  if (问) return 问;
  if (!(await 规则开着("线索分配"))) return null;
  const 态 = 参与状态of(await 参与状态表(), userId);
  return 态 === "允许" ? null : 不正常不能指定话(态 === "暂停" ? "暂停" : "禁止");
}

/**
 * 指定分配的选人下拉只列这些人（审核 11-18 追加：不等服务端拒）：组织里能被 指定问题 放行的——在职的销售 / 销售管理，
 * 规则「线索分配」开着时还要参与状态正常。和 指定问题 同一口径，一次读参与状态表
 */
export async function 可指定的人(org: 组织): Promise<string[]> {
  const 看态 = await 规则开着("线索分配");
  const 表 = 看态 ? await 参与状态表() : {};
  return [...org.成员.keys()].filter((id) => 接手问题(org, id, null) === null && (!看态 || 参与状态of(表, id) === "允许"));
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
  await 补记销售管理起算(org, 全部);
  // 估的是市场按区域发起的营销线索：用待补（判无效待补的人排在前面，M-线索-02 补「优先」），每条线挂各自方向的
  const [底, 有记录] = await Promise.all([读挑人底子(全部, 月份(), { 线: null }), prisma.entLeadAssign.findFirst({ select: { id: true } })]);
  const 不参与 = new Set(底.不参与);
  // 估的是市场按区域发起的营销线索（最常见的那种）：营销线索一律算数
  const 查满 = 计不计数("营销", 底.企划算数);
  for (const [i, 池] of 池们.entries()) {
    // 起算补按这条线的池各补各的（同池最少的数）；待补只挂方向对得上这条线的
    const 候选 = 底.排位(池, undefined, undefined, 两条线[i]);
    for (const c of 候选) {
      if (不参与.has(c.userId)) continue;
      if (!有记录) { 出.set(c.userId, "暂无法估算"); continue; }
      const n = 前面几条(候选, 不参与, 查满, 底.不限额, c.userId);
      if (n === null) continue;
      const 旧 = 出.get(c.userId);
      if (!旧 || 旧 === "暂无法估算" || n < 旧.数) 出.set(c.userId, { 数: n, ...(c.待补?.length ? { 待补: c.待补.length } : {}) });
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
  const 话 = x.数 === 0 ? `下一条就轮到${你}` : `前面约 ${x.数} 条轮到${你}`;
  return x.待补 ? `${话}（判无效待补 ${x.待补} 条，优先补）` : 话;
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
      // 键带上月份（11-18 通知审核）：每月 1 号清零后数又从头排，总收到条数没变，只用条数会撞上上个月那一轮的键、把提醒吞掉。
      // 撤销分配（总条数退回去）同月内仍会撞到撤销前那一轮的键：那一轮已经推过，不再推，算可接受
      key: `assign-eta:${月份()}:${轮.get(userId) ?? 0}`,
    });
  }
  return 推了;
}
