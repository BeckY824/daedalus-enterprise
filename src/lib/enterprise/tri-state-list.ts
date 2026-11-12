/**
 * 客户三态 · 列表和看板上的标（P-界面-19 ①②，构想页 C2 / C5）：只读，不算三态、不写钟。
 *
 * 标看的是夜扫写在钟上的状态（EntCustomerClock，tri-state-db.ts 写钟）：沉睡 / 待回收 / 待回收且被挡（对用户叫「暂缓回收中」）。
 * 负责人是市场成员（市场角色、又不兼销售，同 tri-state-db.ts 收三态客户）的一律写「不计时」，不看钟（换到市场成员名下后钟停在原状态，夜扫不再写）。
 * 待回收的「N 天后进公海」= 到最早进公海日还差几天：读钟上存的最早进公海日（poolDueDay，写钟时按完整事实算好的，同客户详情状态条，
 * 含暂缓解除后那 10 天、推后当天重起一轮）。只在夜扫记号里那份规则和现在生效的一样时才读（管理员白天改了天数，详情马上按新规则算，
 * 钟上存的还是夜扫按旧规则算的，到次日 00:05 才对上）；记号走设置缓存，不多一条查询。钟上这列空（老钟、还没重扫）或规则改过，退回旧算法：同服务端 算三态() 的排期（待回收最早进公海日），
 * 节点 = 钟上的进入日（已含继续持有顺延）+ 这位客户适用那套的进公海天数（M-公海-25 选套），再按钟上本轮提醒了几次、最近哪天提醒往后排（3 次提醒没发够不进）。
 *
 * 一页客户一次查：钟一句；内贸、外贸两套的进公海天数不一样、这一页又有钟上没存最早进公海日的待回收才再取一句这些客户的项目选套。
 * 三态关着时调用方根本不调（不多一条查询）
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "./switch";
import { getBusiness } from "@/lib/business";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import type { 三态规则 } from "@/lib/project/org-rules";
import { 选套, 加天, 差天, 待回收最早进公海日, 三态扫过键, 扫过的是这份规则, type 三态项目 } from "./tri-state";
import { getSetting } from "@/lib/settings";
import { 项目业务线 } from "./assign-line";
import { 是市场角色, 是销售角色 } from "./permissions";
import { 读组织, type 组织 } from "./org";
import { 看全部 } from "@/lib/team-scope";
import { beijingDay } from "@/lib/business-clock";
import { 是三态筛选值, type 三态标 } from "./tri-state-label";

/** 三态在不在跑（同 tri-state-db.ts 三态开着；这里不引那份，免得列表页带上夜扫那一串） */
export async function 三态界面开着(): Promise<boolean> {
  if (!企业版()) return false;
  if ((await getBusiness()).projectMode !== true) return false;
  return (await 生效组织规则()).三态.开;
}

/** 市场成员（不计三态）：在职、有市场角色、没有销售角色 */
export const 市场成员们 = (org: 组织): string[] => [...org.成员.keys()].filter((id) => 是市场角色(org, id) && !是销售角色(org, id));

/**
 * 这些客户的标（客户 id → 标；活跃的、在公海的不给）。行 = 这一页的客户（id、负责人、在不在公海），一页最多 100 位。
 * 负责人不知道（看板卡片是项目行，不带客户负责人）的照样排掉市场成员名下的：在取钟那一句里按客户负责人筛，不另查，只是不标「不计时」。
 * 包 看全部：这一页的客户已经是看得到的，选套要按全部项目算（同夜扫），不按我能看的
 */
export async function 三态标们(
  行: readonly { id: string; salesOwnerId?: string; 在公海: boolean }[],
  规则: 三态规则,
  今天: string = beijingDay(new Date()),
): Promise<Record<string, 三态标>> {
  const 出: Record<string, 三态标> = {};
  const 要 = 行.filter((r) => !r.在公海);
  if (!要.length) return 出;
  const org = await 读组织();
  const 市场 = new Set(市场成员们(org));
  const 是市场的 = (r: { salesOwnerId?: string }) => r.salesOwnerId !== undefined && 市场.has(r.salesOwnerId);
  const 计时的 = 要.filter((r) => !是市场的(r));
  for (const r of 要) if (是市场的(r)) 出[r.id] = { 态: "不计时" };
  if (!计时的.length) return 出;
  const 钟们 = await 看全部(() => prisma.entCustomerClock.findMany({
    where: { customerId: { in: 计时的.map((r) => r.id) }, state: { in: ["沉睡", "待回收"] }, ...(市场.size ? { customer: { salesOwnerId: { notIn: [...市场] } } } : {}) },
    select: { customerId: true, state: true, enteredDay: true, blocked: true, dealDay: true, noticeCount: true, lastNoticeDay: true, poolDueDay: true },
  }));
  // 钟上存了最早进公海日、又是按现在这份规则存的直接读；没存的（老钟）、规则白天改过的才按提醒次数排、才要选套
  const 存的算数 = 扫过的是这份规则(await getSetting<string>(三态扫过键), 规则);
  const 读存的 = (k: { poolDueDay: string | null }): k is { poolDueDay: string } => 存的算数 && !!k.poolDueDay;
  const 待回收们 = 钟们.filter((k) => k.state === "待回收" && !k.blocked && !读存的(k));
  // 两套进公海天数一样就不用看这位客户用哪套
  const 要选套 = 规则.内贸.进公海 !== 规则.外贸.进公海 && 待回收们.length > 0;
  const 项目of = new Map<string, 三态项目[]>();
  if (要选套) {
    const 成员线 = new Map([...org.成员].map(([id, m]) => [id, { line: m.line }]));
    const ps = await 看全部(() => prisma.project.findMany({ where: { customerId: { in: 待回收们.map((k) => k.customerId) }, pooledAt: null }, select: { customerId: true, ownerId: true, bizLine: true } }));
    // 选套只看业务线，别的格子填个样子
    for (const p of ps) 项目of.set(p.customerId, [...(项目of.get(p.customerId) ?? []), { 阶段: "线索", 业务线: 项目业务线(p, 成员线), 同事负责: false, 最近推进日: 今天, 结束: false }]);
  }
  for (const k of 钟们) {
    if (k.state === "沉睡") { 出[k.customerId] = { 态: "沉睡" }; continue; }
    if (k.blocked) { 出[k.customerId] = { 态: "暂缓回收中" }; continue; }
    if (读存的(k)) { 出[k.customerId] = { 态: "待回收", 几天后进公海: 差天(今天, k.poolDueDay) }; continue; }
    const 套 = 要选套 ? 规则[选套(项目of.get(k.customerId) ?? [], 规则, k.dealDay ? 规则.成交.活跃段 : null)] : 规则.内贸;
    // 同服务端排期（M-公海-17）：最早进公海 = max(进公海节点, 第 3 次提醒 + 间隔)；提醒没发够，天数到了也还没进
    const 最早 = 待回收最早进公海日({ 待回收: k.enteredDay, 进公海: 加天(k.enteredDay, 套.进公海) }, 套.进公海, 今天, k.noticeCount, k.lastNoticeDay);
    出[k.customerId] = { 态: "待回收", 几天后进公海: 差天(今天, 最早) };
  }
  return 出;
}

/**
 * 「全部回收状态」筛选（地址栏 triState）：三态关着、值认不出 = null（当没筛）。
 * 沉睡 / 待回收 / 暂缓回收中按钟上的状态，排掉负责人是市场成员的（他们写「不计时」）；不计时 = 负责人是市场成员。
 * 公海那一层由调用方的页签条件管（客户页签本来就不含公海里的）
 */
export async function 三态筛选条件(值: string | undefined): Promise<Prisma.CustomerWhereInput | null> {
  if (!是三态筛选值(值) || !(await 三态界面开着())) return null;
  const 市场 = 市场成员们(await 读组织());
  if (值 === "不计时") return { salesOwnerId: { in: 市场 } };
  const 钟 = 值 === "沉睡" ? { state: "沉睡" } : { state: "待回收", blocked: 值 === "暂缓回收中" };
  return { entClock: { is: 钟 }, salesOwnerId: { notIn: 市场 } };
}
