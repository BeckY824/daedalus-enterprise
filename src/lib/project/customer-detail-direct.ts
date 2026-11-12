import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能看项目 } from "@/lib/enterprise/permissions";
import { 市场进不了详情的 } from "@/lib/enterprise/market-view-db";
import { 看得到的客户 } from "./db";
import { 客户页项目地址 } from "./customer-detail-href";
import { 仅项目客户们 } from "@/lib/enterprise/project-only-customers";

/**
 * 站内列表链到项目（11-12 客户详情合并第 2 批审查 #3）：确定 /projects/<id> 会跳去客户页项目页签的，直接给客户页地址，省一跳；
 * 拿不准的照旧给 /projects/<id>，让项目页自己判（projects/[id]/load.ts 项目页去向）。
 * 「确定」= 不在公海（公海有原负责人回避，留给项目页判）、市场没挡、能看项目、看得到客户（或仅项目里有这个项目）——和 项目页去向 跳客户页那条同一口径
 */
export async function 项目链接们(me: SessionUser, ids: readonly string[]): Promise<Map<string, string>> {
  const 原 = new Map(ids.map((id) => [id, `/projects/${encodeURIComponent(id)}`]));
  if (!企业版() || !ids.length) return 原;
  const 行 = await prisma.project.findMany({
    where: { id: { in: [...new Set(ids)] }, pooledAt: null },
    select: { id: true, customerId: true, ownerId: true, creatorId: true, pooledAt: true, bizLine: true, members: { where: { inviteStatus: "JOINED" }, select: { userId: true } } },
  });
  if (!行.length) return 原;
  const [org, 市场挡, 看得到, 仅项目] = await Promise.all([
    权限组织(), 市场进不了详情的(me.id, 行.map((r) => r.id)), 看得到的客户(行.map((r) => r.customerId)),
    // 只负责项目的人：客户看不到，但他自己的项目跳受限客户详情（同 项目页去向）
    仅项目客户们(me).then((m) => new Set([...m.values()].flat())),
  ]);
  for (const r of 行) {
    if (市场挡.has(r.id) || (!看得到.has(r.customerId) && !仅项目.has(r.id))) continue;
    if (!能看项目(me, { ...r, 已加入: r.members.map((m) => m.userId) }, org)) continue;
    原.set(r.id, 客户页项目地址(r.customerId, r.id));
  }
  return 原;
}
