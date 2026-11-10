import type { Prisma } from "@/generated/prisma";
import { 转交商机 } from "@/lib/opportunity-activity";
import { 转项目 } from "@/lib/carry-over-db";
import { 记换负责人 } from "@/lib/owner-log-db";
import { 转让痕 } from "@/lib/project/db";
import { 进公海清负责人, 公海无负责人 } from "@/lib/project/pool-owner";
import { 客户名下在推项目进公海, 客户进公海清负责人 } from "@/lib/enterprise/pool-link";
import { 月份 } from "@/lib/enterprise/lead-assign";
import { 停用进公海理由, 停用项目进公海理由, type 停用分拣结果 } from "@/lib/offboard-db";

/**
 * 离职交接真动数据的两半（原来写在 settings/actions.ts deactivateUser 的事务里，2026-10-26 抽出来）：
 * 企业版「交接中」（规则「交接要接手人确认」，测试清单 D10）要把它拆开——放进公海的那半发起时就放，
 * 给接手人的那半等接手人确认了再给。规则关着时 deactivateUser 在同一笔事务里先后调这两半，顺序、写法和原来一字不差。
 * 两半都在调用方的事务里跑，分拣（停用分拣）也由调用方在同一笔事务里先做
 */

/** 给接手人的那半：客户改负责人（记历史负责人）、进行中商机、没做完的待办计划、线索、渠道、项目。返回转走的项目 id */
export async function 离职转给接手人(
  tx: Prisma.TransactionClient,
  分: 停用分拣结果,
  id: string,
  接手人: string,
  操作人: string,
  记分配: boolean,
): Promise<string[]> {
  await tx.customer.updateMany({ where: { id: { in: 分.客户 } }, data: { salesOwnerId: 接手人 } });
  // 历史负责人：每位转走的客户记一行「他 → 接手人」（D-36）；进公海的另记，见 离职放进公海
  await 记换负责人(tx, 分.客户.map((customerId) => ({ customerId, from: id, to: 接手人 })), 操作人, "deactivate");
  await 转交商机(tx, { id: { in: 分.商机 }, ownerId: id, status: "OPEN" }, 接手人);
  await tx.task.updateMany({ where: { id: { in: 分.待办 } }, data: { ownerId: 接手人 } });
  await tx.followPlan.updateMany({ where: { id: { in: 分.计划 } }, data: { ownerId: 接手人 } });
  /**
   * 线索、渠道原本漏了转交：
   *   线索      —— 留在停用的人名下，列表按负责人筛选时谁都看不到，等于丢了
   *   渠道负责人 —— Channel.channelOwnerId 还指着停用的人，之后这个渠道新带来的学员会继续算到一个离职的人头上
   */
  await tx.lead.updateMany({ where: { id: { in: 分.线索 } }, data: { ownerId: 接手人 } });
  if (记分配) await 记交接分配(tx, 分.线索, id, 接手人, 操作人);
  await tx.channel.updateMany({ where: { id: { in: 分.渠道 } }, data: { channelOwnerId: 接手人 } });
  // 项目：跟着转走的客户转（团队版整体转；企业版只带他负责的、同事待分配的，同转让客户），企业版再加上他负责、挂在别人客户上的。
  // 他的卡点认领行不在这里跟着走：停用的事务里另调 交接卡点（有交接人 / 直属上级 / 去掉三种去向）；
  // 同事待分配的、已停用同事进行中的（P-转-18）认领行是同事的，交接卡点管不到，跟着项目走（同转客户）。分.项目 被调用方清空时（没开项目模式）不动
  const 待分配 = new Set(分.清待分配);
  const 同事项目 = new Set([...分.清待分配, ...分.停用同事]);
  const 同事的 = 分.项目.filter((p) => 同事项目.has(p));
  const 其余 = 分.项目.filter((p) => !同事项目.has(p));
  const 转了 = 其余.length ? await 转项目(tx, { id: { in: 其余 }, pooledAt: null }, 接手人, 操作人, false) : [];
  const 转了同事 = 同事的.length ? await 转项目(tx, { id: { in: 同事的 }, pooledAt: null }, 接手人, 操作人, true) : [];
  // 清待分配：同事待分配的；离职的人自己占着待分配、这次转过去的也清（P-转-20、X-84），转过去就是接手人的、算他持有
  const 清的 = [...同事的.filter((p) => 待分配.has(p)), ...转了];
  if (清的.length) await tx.project.updateMany({ where: { id: { in: 清的 }, awaitAssignAt: { not: null } }, data: { awaitAssignAt: null } });
  return [...转了, ...转了同事];
}

/**
 * 放进公海的那半（企业版「放进公海」方式，企业版入口现在拒绝这种方式，底层先按规则做好）：
 * 客户进客户公海，他自己负责的线索 / 商机项目一起进线索公海，客户负责人清空、他记历史（M-公海-03）；
 * 他负责、挂在别人客户上的线索 / 商机阶段项目放回线索公海。调用方要在事务外先 钉住老签约
 */
export async function 离职放进公海(tx: Prisma.TransactionClient, 分: 停用分拣结果, 操作人: string): Promise<void> {
  if (分.进公海客户.length) {
    const 客户们 = await tx.customer.findMany({ where: { id: { in: 分.进公海客户 } }, select: { id: true, salesOwnerId: true } });
    await tx.customerPool.createMany({ data: 分.进公海客户.map((customerId) => ({ customerId, userId: 操作人, reason: 停用进公海理由 })) });
    await 客户名下在推项目进公海(tx, 客户们, 操作人, 停用进公海理由, new Date());
    await 客户进公海清负责人(tx, 客户们, 操作人);
  }
  if (分.进公海项目.length) {
    const 们 = await tx.project.findMany({ where: { id: { in: 分.进公海项目 } }, select: { id: true, ownerId: true, phase: true, node: true, result: true } });
    // 企业版进公海清空负责人（pool-owner.ts），离职的人记在 pool-release 的 from 上 = 历史负责人。
    // 他没做完的待办不在这里关：离职交接里待办归接手人（停用分拣 待办）
    await tx.project.updateMany({ where: { id: { in: 分.进公海项目 } }, data: { pooledAt: new Date(), nextStepAt: null, nextStepText: null, ...(进公海清负责人() ? { ownerId: 公海无负责人 } : {}) } });
    await tx.projectNodeLog.createMany({ data: 们.map((p) => 转让痕(p, 操作人, p.ownerId, null, "pool-release", 停用项目进公海理由)) });
  }
}

/**
 * 企业版「线索分配」开着时，离职转给接手人的线索也记一行分配（EntLeadAssign），和手动分配同一张表：
 * 分配记录里查得到这条线索怎么到了接手人手上。只记还没转化的；不算进接手人当月的分配数（counted=false），
 * 交接来的不占配额；走哪条线不填，种类沿用这条线索最近一次分配的（没分配过 = 营销）
 */
async function 记交接分配(tx: Prisma.TransactionClient, 线索: string[], from: string, to: string, by: string) {
  if (!线索.length) return;
  const 没转化 = (await tx.lead.findMany({ where: { id: { in: 线索 }, convertedAt: null }, select: { id: true } })).map((l) => l.id);
  if (!没转化.length) return;
  const 上次 = new Map<string, string>();
  for (const r of await tx.entLeadAssign.findMany({ where: { leadId: { in: 没转化 } }, orderBy: { createdAt: "desc" }, select: { leadId: true, kind: true } })) {
    if (r.leadId && !上次.has(r.leadId)) 上次.set(r.leadId, r.kind);
  }
  const 月 = 月份();
  await tx.entLeadAssign.createMany({
    data: 没转化.map((leadId) => ({ leadId, toUserId: to, fromUserId: from, byUserId: by, line: null, kind: 上次.get(leadId) ?? "营销", counted: false, month: 月 })),
  });
}
