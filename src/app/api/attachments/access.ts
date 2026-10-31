import { prisma, defaultClient } from "@/lib/prisma";
import { 同事的客户, 只读话, 虚线只读线索 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 附件个数, 项目分类附件数 } from "@/lib/attachments";
import { getCurrentUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 能管项目, 露客户, 看得到的客户 } from "@/lib/project/db";
import type { 归属 } from "@/lib/attachment-rules";

/**
 * ?opportunityId= / ?leadId= / ?contactId= / ?projectId=，多选一。
 * 线索、联系人、项目只有企业版认（联系人附件 2026-10-28，项目附件 P11 10-29）：不是企业版只认商机，别的当参数不对。?orderId= 随订单表 2026-10-29 删了，当参数不对
 */
export function 读归属(q: URLSearchParams): 归属 | null {
  const 好 = (s: string | null): s is string => !!s && /^[\w-]{1,64}$/.test(s);
  const 键们 = (企业版() ? (["opportunityId", "leadId", "contactId", "projectId"] as const) : (["opportunityId"] as const));
  const 给了 = (["opportunityId", "orderId", "leadId", "contactId", "projectId"] as const).filter((k) => q.get(k) !== null);
  if (给了.length !== 1 || !(键们 as readonly string[]).includes(给了[0])) return null;
  const k = 给了[0];
  const v = q.get(k);
  return 好(v) ? ({ [k]: v } as 归属) : null;
}

/**
 * 附件跟着它挂的商机 / 线索 / 联系人走权限：用加了限定的 prisma 去取那一条——看不到的那条，它的附件也看不到。
 * 要改（传、删）时再挡只读的客户（团队互看时同事的、企业版虚线下属的）。线索没转客户时，改得了线索才改得了附件（和改线索一个口径）。
 * 项目（企业版、项目模式开着）不走客户那条：看 = 看得到项目且露客户（公海里同事客户的项目，客户信息都不给，附件也不给）；
 * 改 = 能管项目（负责人、老板、主管），和编辑项目一个口径。
 * 返回给日志用的一句「商机「xx」」，不行就回一句人话
 */
export async function 认父记录(挂在: 归属, 要改: boolean): Promise<{ 叫法: string } | { 错: string; 状态: number }> {
  let 客户: string | null;
  let 叫法: string;
  if ("projectId" in 挂在) return 认项目(挂在.projectId, 要改);
  if ("opportunityId" in 挂在) {
    const o = await prisma.opportunity.findFirst({ where: { id: 挂在.opportunityId }, select: { name: true, customerId: true } });
    if (!o) return { 错: "这个商机已经不在了，刷新看看", 状态: 404 };
    客户 = o.customerId;
    叫法 = `商机「${o.name}」`;
  } else if ("leadId" in 挂在) {
    if (!企业版()) return { 错: "此版本未开放线索附件", 状态: 404 };
    const l = await prisma.lead.findFirst({ where: { id: 挂在.leadId }, select: { name: true, customerId: true, ownerId: true } });
    if (!l) return { 错: "这条线索已经不在了，刷新看看", 状态: 404 };
    // 虚线下属没转客户的线索：看得到、改不了（改线索走写的范围），附件也只给看
    if (要改 && await 虚线只读线索(defaultClient, l)) return { 错: await 只读话(defaultClient), 状态: 403 };
    客户 = l.customerId;
    叫法 = `线索「${l.name}」`;
  } else {
    if (!企业版()) return { 错: "此版本未开放联系人附件", 状态: 404 };
    const c = await prisma.contact.findFirst({ where: { id: 挂在.contactId }, select: { name: true, customerId: true } });
    if (!c) return { 错: "这位联系人已经不在了，刷新看看", 状态: 404 };
    客户 = c.customerId;
    叫法 = `联系人「${c.name}」`;
  }
  if (要改 && 客户 && await 同事的客户(defaultClient, 客户)) return { 错: await 只读话(defaultClient), 状态: 403 };
  return { 叫法 };
}

/** 项目附件的权限：带限定的 prisma 取项目（看不到的项目当不在），再按 露客户 / 能管项目 挡 */
async function 认项目(projectId: string, 要改: boolean): Promise<{ 叫法: string } | { 错: string; 状态: number }> {
  if (!企业版() || (await getBusiness()).projectMode !== true) return { 错: "此版本未开放项目附件", 状态: 404 };
  const 我 = await getCurrentUser();
  if (!我) return { 错: "请先登录", 状态: 401 };
  const p = await prisma.project.findFirst({ where: { id: projectId }, select: { name: true, customerId: true, ownerId: true, pooledAt: true } });
  if (!p) return { 错: "这个项目已经不在了，刷新看看", 状态: 404 };
  if (!露客户(我, p, await 看得到的客户([p.customerId]))) return { 错: "这个项目在公海里，先领取再看附件", 状态: 403 };
  if (要改 && !能管项目(我, p)) return { 错: p.pooledAt ? "这个项目在公海里，先领取再改" : "只有项目负责人、老板或主管能改", 状态: 403 };
  return { 叫法: `项目「${p.name}」` };
}

/**
 * 一个附件按哪条父记录认权限：联系人优先（线索转过客户的两列都有），认不过再按线索认——
 * 联系人被删了、线索还在，线索页上照样能看能删
 */
export async function 认附件父记录(
  a: { opportunityId: string | null; leadId: string | null; contactId: string | null; projectId: string | null },
  要改: boolean,
): Promise<{ 叫法: string } | { 错: string; 状态: number }> {
  // 项目附件只挂项目这一列（P11）
  const 候选: 归属[] = a.projectId ? [{ projectId: a.projectId }] : a.opportunityId ? [{ opportunityId: a.opportunityId }]
    : [...(a.contactId ? [{ contactId: a.contactId }] : []), ...(a.leadId ? [{ leadId: a.leadId }] : [])];
  if (!候选.length) return { 错: "找不到这个附件", 状态: 404 };
  let 先错: { 错: string; 状态: number } | null = null;
  for (const 挂在 of 候选) {
    const r = await 认父记录(挂在, 要改);
    if (!("错" in r)) return r;
    先错 ??= r;
  }
  return 先错!;
}

/**
 * 企业版项目详情页联系人那一行的「附件」入口（2026-10-28）：和接口同一个口径——
 * 认父记录 读不到就不给入口（同事的线索、别人的客户），改不了（同事的 / 虚线下属的客户）就只给看。不是企业版一律 null
 */
export async function 联系人附件入口(contactId: string): Promise<{ 个数: number; 只读: boolean } | null> {
  if (!企业版() || "错" in await 认父记录({ contactId }, false)) return null;
  const 个数 = (await 附件个数(defaultClient, { contactIds: [contactId] })).联系人.get(contactId) ?? 0;
  return { 个数, 只读: "错" in await 认父记录({ contactId }, true) };
}

/**
 * 企业版项目详情页的「附件」区（P11，10-29）：和接口同一个口径——看不到（不是企业版、项目模式关着、公海里同事客户的项目）
 * 就不给这一区，改不了（不是负责人 / 老板 / 主管）就只给看。10-31 分两格：合同附件 / 其它附件，各几个
 */
export async function 项目附件入口(projectId: string): Promise<{ 合同: number; 其它: number; 只读: boolean } | null> {
  if (!企业版() || "错" in await 认父记录({ projectId }, false)) return null;
  const 个数 = await 项目分类附件数(defaultClient, projectId);
  return { ...个数, 只读: "错" in await 认父记录({ projectId }, true) };
}
