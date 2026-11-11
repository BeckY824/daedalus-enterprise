"use server";

/**
 * 商机的写入口只剩 setOppStatus 一个（2026-11-11 删商机死代码第一步）。
 *
 * 企业版只用项目（lib/enterprise/project-only.ts，business-config 锁死 projectMode）：商机的新建、编辑、拖阶段、删除、撤销删除、
 * 报价明细这些入口企业版一个都走不到，连同商机框（OpportunityForm / QuoteLines）一起删了。
 * setOppStatus 留着只因为签约那条线（customers/actions.ts 的 deleteContract，删签约时把顺手赢下的商机退回进行中）还引着它；
 * 那条线企业版同样被 只用项目挡老入口("合同") 挡在前面，等 Contract 那一步一起收。
 */

import { 不在了 } from "@/lib/not-there";
import { 推进版本 } from "@/lib/edit-version";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { STAGE_PROBABILITY, OPP_STAGES, OPP_STATUSES } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";
import { getBusiness } from "@/lib/business";
import { 外贸订单 } from "@/lib/business-config";
import type { Prisma } from "@/generated/prisma";
import { 只用项目挡老入口 } from "@/lib/enterprise/project-only";

/** 状态在界面上叫什么。日志是给人看的，不能写 WON / LOST */
const 状态名: Record<string, string> = { OPEN: "进行中", WON: "赢单", LOST: "丢单" };

/** 商机一动，列表、看板、首页数字都得重算；带上客户就连那张详情页一起 */
function 刷新商机(客户id?: string) {
  for (const p of ["/opportunities", "/opportunities/pipeline", "/dashboard"]) revalidatePath(p);
  if (客户id) revalidatePath(`/customers/${客户id}`);
}

/**
 * 记下 / 撤掉结单时刻（排查 C6）。变成赢单或丢单的那一下记一笔；回到进行中就删掉；
 * 本来就是这个状态（改个备注）不碰——「本月赢单」按它数，不能因为改备注就挪到本月。
 */
async function 记结单(id: string, 原状态: string | null, 新状态: string, db: Prisma.TransactionClient) {
  // 离开赢单（改成丢单、拖回别的阶段）：「是哪笔签约赢下的」那一行跟着删（2026-10-04 L-007）——
  // 之后再删那笔签约，不该把人后来改过的状态又退一遍
  if (新状态 !== "WON") await db.contractWin.deleteMany({ where: { opportunityId: id } });
  if (新状态 === "OPEN") {
    await db.opportunityClose.deleteMany({ where: { opportunityId: id } });
    return;
  }
  if (原状态 === 新状态) return;
  await db.opportunityClose.upsert({
    where: { opportunityId: id },
    create: { opportunityId: id, closedAt: new Date() },
    update: { closedAt: new Date() },
  });
}

/**
 * 这个商机已经转成订单了（外贸「订单 = 签约」）：不许直接改回进行中 / 丢单（二审）——那笔签约还在，
 * 再转一次就是两张单。要改先到客户页删掉那张订单（删时商机会自己退回进行中）。返回拦下的那句话，没转过返回 null。
 * 2026-10-29 订单表（TradeOrder）删了：「转过」改认签约联动赢下它的那一行（ContractWin），只在外贸模版下认——
 * 原来只有外贸会有订单，通用模版照旧能直接改回
 */
async function 转过订单的话(商机id: string, db: Prisma.TransactionClient | typeof prisma = prisma, 是外贸?: boolean): Promise<string | null> {
  if (!(是外贸 ?? 外贸订单(await getBusiness()))) return null;
  const 赢 = await db.contractWin.findUnique({ where: { opportunityId: 商机id }, select: { contractId: true } });
  return 赢 ? "这个商机已经转成订单了：要改回去，先到客户页的「订单」里删掉那张订单" : null;
}

/** 撤销须带写入后版本；有后续修改就拒绝覆盖。关闭概率统一为100/0，重新打开恢复合法阶段。 */
export async function setOppStatus(
  id: string,
  status: "OPEN" | "WON" | "LOST",
  还原?: { stage: string; probability: number; 版本?: string },
) {
  try {
    const me = await requireUser();
    const 老入口 = await 只用项目挡老入口("商机");
    if (老入口) return { ok: false as const, error: 老入口 };
    if (!OPP_STATUSES.includes(status)) return { ok: false as const, error: `商机状态「${status}」不是合法取值` };
    if (还原 && (!OPP_STAGES.includes(还原.stage as (typeof OPP_STAGES)[number]) || !Number.isFinite(还原.probability) || 还原.probability < 0 || 还原.probability > 100)) return { ok: false as const, error: "撤销的阶段或概率不合法" };
    if (还原 && status !== "WON" && 还原.stage === "赢单成交") return { ok: false as const, error: "进行中或丢单不能使用赢单阶段" };
    const 是外贸 = 外贸订单(await getBusiness());
    const result = await prisma.$transaction(async (tx) => {
      const 原 = await tx.opportunity.findUnique({ where: { id } });
      if (!原) return { ok: false as const, error: "商机不存在（可能已删除）" };
      if (还原?.版本 && 原.updatedAt.toISOString() !== 还原.版本) return { ok: false as const, error: "商机后来又变过了，不能撤销旧操作，请查看最新内容" };
      if (原.status === "WON" && status !== "WON") {
        const 挡 = await 转过订单的话(id, tx, 是外贸);
        if (挡) return { ok: false as const, error: 挡 };
      }
      if (status === "WON" && 是外贸 && !(await 转过订单的话(id, tx, 是外贸))) return { ok: false as const, error: "请通过「转为订单」登记订单，不能直接标为已转订单" };
      const stage = status === "WON" ? "赢单成交" : 还原?.stage ?? (原.stage === "赢单成交" ? "谈判审核" : 原.stage);
      const probability = status === "WON" ? 100 : status === "LOST" ? 0 : 还原?.probability ?? (原.status !== "OPEN" ? STAGE_PROBABILITY[stage] ?? 20 : 原.probability);
      if (原.status === status && 原.stage === stage && 原.probability === probability) return { ok: true as const, o: 原, changed: false };
      const o = await tx.opportunity.update({ where: { id }, data: { status, stage, probability, activityAt: new Date(), ...推进版本(原.updatedAt.toISOString()) } });
      await 记结单(id, 原.status, status, tx);
      return { ok: true as const, o, changed: true };
    });
    if (!result.ok) return result;
    const o = result.o;
    if (result.changed) await recordAudit({
      user: me, action: "update", entity: "Opportunity", entityId: id,
      summary: 还原 ? `商机「${o.name}」撤销改状态，回到${状态名[status] ?? status}（${o.stage}）` : `商机「${o.name}」标记为${状态名[status] ?? status}`,
      detail: { 状态: 状态名[status] ?? status, 金额: o.amount, ...(还原 ? { 阶段: o.stage, 概率: o.probability } : {}) },
    });
    刷新商机(o.customerId);
    return { ok: true as const, 版本: o.updatedAt.toISOString() };
  } catch (e) { return 不在了(e); }
}
