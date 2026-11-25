/**
 * 回访计划去哪（E-283 第 3 条，11-26 终审定稿）：售后回访顺手排的计划带 afterSaleProjectId（下次回访，FollowPlan 迁移 173）。
 * 到期提醒（due-notice.ts）、数据页待办（board-todos-db.ts）、计划页行链接三处原来各按「这位客户最近动过的在推项目 / 客户页」猜去处，
 * 售后计划会被带到无关的在推项目上。三处都先问这里：
 *   带 afterSaleProjectId、项目没删、仍是交付结清、项目客户 = 计划客户、看的人看得到这个项目（能看项目，市场挡着的不算）→ 去这个项目；
 *   核不过（项目撤回了交付结清、删了、换了客户、看的人看不到——比如只是客户负责人）= 不在结果里，调用方按自己原来的回落走（客户页 / 计划页），
 *   只是售后计划不再挂到别的在推项目上（回访计划不认项目 那一组）。
 * 只回项目（id、名字、级别）；地址各处自己拼（铃铛 /projects/<id> 让项目页自己判跳哪；页面上走 项目链接们 直达客户页项目页签）
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织 } from "@/lib/enterprise/org";
import { 能看项目, 权限项目选, 带已加入 } from "@/lib/enterprise/permissions";
import { 市场进不了详情的 } from "@/lib/enterprise/market-view-db";
import { 是交付 } from "./stage-dict";
import { 项目链接们 } from "./customer-detail-direct";

type 谁 = { id: string; role: string };
export type 回访计划 = { id: string; customerId: string; afterSaleProjectId?: string | null };

export type 回访项目 = { id: string; name: string; level: string | null };

/** 计划 id → 该去的交付结清项目（核得过的才有）。看的人：铃铛是计划负责人，页面上是当前登录的人 */
export async function 回访计划去项目<T extends 回访计划>(计划们: readonly T[], 看的人: (计划: T) => 谁 | null): Promise<Map<string, 回访项目>> {
  const 结果 = new Map<string, 回访项目>();
  const 带的 = 计划们.filter((p) => !!p.afterSaleProjectId);
  if (!企业版() || !带的.length) return 结果;
  const 项目们 = await 看全部(() => prisma.project.findMany({
    where: { id: { in: [...new Set(带的.map((p) => p.afterSaleProjectId!))] } },
    select: { id: true, name: true, level: true, customerId: true, ...权限项目选 },
  }));
  if (!项目们.length) return 结果;
  const 按id = new Map(项目们.map((p) => [p.id, p]));
  const org = await 读组织();
  const 挡of = new Map<string, Promise<Set<string>>>();
  const 市场挡 = (人: string) => {
    if (!挡of.has(人)) 挡of.set(人, 市场进不了详情的(人, 项目们.map((p) => p.id)));
    return 挡of.get(人)!;
  };
  for (const 计划 of 带的) {
    const p = 按id.get(计划.afterSaleProjectId!);
    const 人 = 看的人(计划);
    if (!p || !人 || p.deletedAt || !是交付(p.result) || p.customerId !== 计划.customerId) continue;
    if (!能看项目(人, 带已加入(p), org)) continue;
    if ((await 市场挡(人.id)).has(p.id)) continue;
    结果.set(计划.id, { id: p.id, name: p.name, level: p.level || null });
  }
  return 结果;
}

/** 计划页（整页和分批补详情）：核得过的售后计划带上 回访去（直达客户页项目页签，拿不准的 /projects/<id>）；别的原样 */
export async function 带回访去处<T extends 回访计划>(me: 谁, 计划们: T[]): Promise<(T & { 回访去?: string })[]> {
  const 去 = await 回访计划去项目(计划们, () => me);
  if (!去.size) return 计划们;
  const 链 = await 项目链接们(me, [...去.values()].map((p) => p.id));
  return 计划们.map((p) => {
    const x = 去.get(p.id);
    return x ? { ...p, 回访去: 链.get(x.id) ?? `/projects/${encodeURIComponent(x.id)}` } : p;
  });
}

/** 售后计划（带 afterSaleProjectId 的）核不过时不再按「客户最近的在推项目」猜去处：调用方据此跳过那一档，直接回落客户页 / 计划页 */
export function 是回访计划(p: { afterSaleProjectId?: string | null }): boolean {
  return !!p.afterSaleProjectId;
}
