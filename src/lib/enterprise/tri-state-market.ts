/**
 * 客户三态 · 市场成员判定变化清单（客户 11-12 第二轮答复 S8）。
 *
 * 市场成员（有市场角色、没有销售角色，T9）名下的客户不计三态。部门 / 角色调整后按当天的状态重算、不追溯；
 * 但「是不是市场成员」一变，他名下的客户就整批进 / 出三态计时，不能静默切换：
 *   - 夜扫时（三态开着才跑）拿在职成员当天的判定和上次记下的快照比，变了的人给系统管理员发一条站内通知
 *     （谁、从什么变成什么、名下几家客户受影响、从哪天起进 / 出计时），同时记一条操作日志（可查）；
 *   - 快照存 Setting（三态市场快照键：成员 id → 是不是市场成员），比完就换成今天的，同一次变化只发一次；
 *   - 第一次跑（没有快照）只记快照不发；新来的人、停用的人不算「变化」（快照里没有 / 今天不在职）
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

/** Setting：上次夜扫时在职成员是不是市场成员（{ [userId]: boolean }） */
export const 三态市场快照键 = "entTriMarketSnapshot";

export type 市场变化 = { userId: string; name: string; 变成市场: boolean; 客户数: number };

/** 当天在职成员 → 是不是市场成员（同 tri-state-db.ts 收三态客户 的判法） */
export const 市场判定 = (org: 组织): Record<string, boolean> =>
  Object.fromEntries([...org.成员.keys()].map((id) => [id, 是市场角色(org, id) && !是销售角色(org, id)]));

/** 比快照、发通知、记日志、换快照。返回这次变了的人 */
export async function 市场成员变化(org: 组织, 今天: string): Promise<市场变化[]> {
  const 现在的 = 市场判定(org);
  const 旧 = await getSetting<Record<string, boolean>>(三态市场快照键);
  if (!旧 || typeof 旧 !== "object") {
    await setSetting(三态市场快照键, 现在的);
    return [];
  }
  const 变了 = Object.keys(现在的).filter((id) => typeof 旧[id] === "boolean" && 旧[id] !== 现在的[id]);
  if (!变了.length) {
    // 有人进出（新来、停用）也把快照换成今天的
    if (JSON.stringify(旧) !== JSON.stringify(现在的)) await setSetting(三态市场快照键, 现在的);
    return [];
  }
  const 出: 市场变化[] = await 看全部(async () => {
    const 占位 = await 无负责人占位Id(prisma);
    const 名 = new Map((await prisma.user.findMany({ where: { id: { in: 变了 } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 数 = new Map((await prisma.customer.groupBy({
      by: ["salesOwnerId"], where: { salesOwnerId: { in: 变了.filter((x) => x !== 占位) }, pool: { is: null }, poolInvalidAt: null }, _count: { _all: true },
    })).map((g) => [g.salesOwnerId, g._count._all]));
    return 变了.map((id) => ({ userId: id, name: 名.get(id) ?? id, 变成市场: 现在的[id], 客户数: 数.get(id) ?? 0 }));
  });
  const 句 = (x: 市场变化) => x.变成市场
    ? `${x.name} 从销售变成市场成员：名下 ${x.客户数} 家客户从 ${今天} 起不再计三态（市场成员另列）`
    : `${x.name} 从市场成员变成销售：名下 ${x.客户数} 家客户从 ${今天} 起进入三态计时`;
  const 管 = 系统管理员们(org);
  if (管.length) {
    await notify(管, {
      kind: "三态", title: `${出.length} 位成员的「市场成员」判定变了，影响 ${出.reduce((s, x) => s + x.客户数, 0)} 家客户的三态计时`,
      body: 出.map(句).join("\n"), link: "/settings", key: `tri-market-change:${今天}:${出.map((x) => `${x.userId}${x.变成市场 ? 1 : 0}`).sort().join(",")}`,
    });
  }
  for (const x of 出) await recordAudit({ user: 系统, action: "update", entity: "User", entityId: x.userId, summary: `客户三态：${句(x)}`, detail: { 三态市场成员: x.变成市场, 客户数: x.客户数, 起: 今天 } });
  await setSetting(三态市场快照键, 现在的);
  return 出;
}
