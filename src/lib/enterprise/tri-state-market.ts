/**
 * 客户三态 · 市场成员判定变化清单（客户 11-12 第二轮答复 S8）。
 *
 * 市场成员（有市场角色、没有销售角色，T9）名下的客户不计三态。部门 / 角色调整后按当天的状态重算、不追溯；
 * 但「是不是市场成员」一变，他名下的客户就整批进 / 出三态计时，不能静默切换：
 *   - 夜扫时（三态开着才跑）拿在职成员当天的判定和上次记下的快照比，变了的人给系统管理员发一条站内通知
 *     （谁、从什么变成什么、名下几家客户受影响、从哪天起进 / 出计时），同时记一条操作日志（可查）；
 *   - 快照存 Setting（三态市场快照键：成员 id → 是不是市场成员），比完就换成今天的，同一次变化只发一次；
 *   - 第一次跑（没有快照）只记快照不发；在职期间改判的人名下 0 家也报；
 *   - 停用（停用的人名下客户不再按市场成员另列）、重新启用、新加入的，名下客户的另列 / 计三态翻了、且有候选客户才报（新来名下 0 家不算变化）
 */
import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { 看全部 } from "@/lib/team-scope";
import { 系统 } from "@/lib/project/timeout";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 是市场角色, 是销售角色 } from "./permissions";
import { 系统管理员们 } from "./tri-state-people";
import type { 组织 } from "./org";
import { notify } from "./notify";

/** Setting：上次夜扫时成员是不是市场成员（{ [userId]: boolean | "停用" }；旧格式只有 boolean，照样能读） */
export const 三态市场快照键 = "entTriMarketSnapshot";

/** 快照里一个人的值：在职时是不是市场成员；停用了记「停用」（停用的人名下客户不按市场成员排，等于不是市场成员） */
export type 快照值 = boolean | "停用";
/** 怎么变的：同一个人在职期间换了角色 / 部门、停用、重新启用、新加入 */
export type 变化方式 = "改判" | "停用" | "重新启用" | "新加入";
export type 市场变化 = { userId: string; name: string; 变成市场: boolean; 客户数: number; 方式: 变化方式 };

/** 当天在职成员 → 是不是市场成员（同 tri-state-db.ts 收三态客户 的判法；停用的人不在组织里） */
export const 市场判定 = (org: 组织): Record<string, boolean> =>
  Object.fromEntries([...org.成员.keys()].map((id) => [id, 是市场角色(org, id) && !是销售角色(org, id)]));

/** 名下客户算不算市场另列：只有在职的市场成员算 */
const 另列 = (v: 快照值 | undefined) => v === true;

/** 比快照、发通知、记日志、换快照。返回这次变了的人 */
export async function 市场成员变化(org: 组织, 今天: string): Promise<市场变化[]> {
  const 在职 = 市场判定(org);
  const 旧 = await getSetting<Record<string, 快照值>>(三态市场快照键);
  // 新快照：在职的记判定；旧快照里有、今天不在职的记「停用」（重新启用时才认得出来）
  const 现在的: Record<string, 快照值> = { ...在职 };
  if (旧 && typeof 旧 === "object") for (const id of Object.keys(旧)) if (!(id in 在职)) 现在的[id] = "停用";
  if (!旧 || typeof 旧 !== "object") {
    await setSetting(三态市场快照键, 现在的);
    return [];
  }
  const 方式of = (id: string): 变化方式 => {
    const 原 = 旧[id];
    if (原 === undefined) return "新加入";
    if (现在的[id] === "停用") return "停用";
    if (原 === "停用") return "重新启用";
    return "改判";
  };
  // 名下客户另列 / 计三态翻了的人（在职改判的，名下 0 家也报；停用、重新启用、新加入的名下有客户才报）
  const 翻了 = Object.keys(现在的).filter((id) => 另列(旧[id]) !== 另列(现在的[id]));
  const 出: 市场变化[] = 翻了.length ? await 看全部(async () => {
    const 占位 = await 无负责人占位Id(prisma);
    const 名 = new Map((await prisma.user.findMany({ where: { id: { in: 翻了 } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 数 = new Map((await prisma.customer.groupBy({
      by: ["salesOwnerId"], where: { salesOwnerId: { in: 翻了.filter((x) => x !== 占位) }, pool: { is: null }, poolInvalidAt: null }, _count: { _all: true },
    })).map((g) => [g.salesOwnerId, g._count._all]));
    return 翻了
      .map((id) => ({ userId: id, name: 名.get(id) ?? id, 变成市场: 另列(现在的[id]), 客户数: 数.get(id) ?? 0, 方式: 方式of(id) }))
      .filter((x) => x.方式 === "改判" || x.客户数 > 0);
  }) : [];
  if (!出.length) {
    // 没人要报（新来的、停用了但名下没客户的……）也把快照换成今天的
    if (JSON.stringify(旧) !== JSON.stringify(现在的)) await setSetting(三态市场快照键, 现在的);
    return [];
  }
  const 句 = (x: 市场变化) => {
    switch (x.方式) {
      case "停用": return `${x.name} 停用：${x.客户数} 家起计三态（原是市场成员，名下客户从 ${今天} 起进入三态计时）`;
      case "重新启用": return `${x.name} 重新启用：${x.客户数} 家不再计三态（是市场成员，名下客户从 ${今天} 起市场成员另列）`;
      case "新加入": return `${x.name} 新加入、是市场成员：名下 ${x.客户数} 家客户从 ${今天} 起不再计三态（市场成员另列）`;
      default: return x.变成市场
        ? `${x.name} 从销售变成市场成员：名下 ${x.客户数} 家客户从 ${今天} 起不再计三态（市场成员另列）`
        : `${x.name} 从市场成员变成销售：名下 ${x.客户数} 家客户从 ${今天} 起进入三态计时`;
    }
  };
  const 管 = 系统管理员们(org);
  if (管.length) {
    await notify(管, {
      kind: "三态", title: `${出.length} 位成员的「市场成员」判定变了，影响 ${出.reduce((s, x) => s + x.客户数, 0)} 家客户的三态计时`,
      body: 出.map(句).join("\n"), link: "/settings",
      key: `tri-market-change:${今天}:${出.map((x) => `${x.userId}${x.方式 === "停用" ? "停" : x.变成市场 ? 1 : 0}`).sort().join(",")}`,
    });
  }
  for (const x of 出) await recordAudit({ user: 系统, action: "update", entity: "User", entityId: x.userId, summary: `客户三态：${句(x)}`, detail: { 三态市场成员: x.变成市场, 客户数: x.客户数, 起: 今天, 方式: x.方式 } });
  await setSetting(三态市场快照键, 现在的);
  return 出;
}
