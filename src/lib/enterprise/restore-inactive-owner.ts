/**
 * P-删-06：从回收站恢复（或查重捞回）客户时原负责人已停用。系统里没有地方存「上级指定的接手人」，一律走「否则」：
 * 清空负责人进客户公海，做法同离职放进公海（offboard-move.ts 离职放进公海）、手动放进公海（pool-actions 放进公海连项目）那一段：
 * 进 CustomerPool → 他自己负责、还没结束的线索 / 商机项目一起进线索公海（客户名下在推项目进公海：清负责人、清组员、清验证、关待办、记 pool-release）
 * → 客户负责人换成占位账号、原负责人记历史（客户进公海清负责人，M-公海-03）。
 *
 * 例外同离职公海方式的分拣（offboard-db.ts 停用分拣）：名下有没结束的订单阶段项目、有同事负责还没结束的项目（M-公海-02 两个例外）、
 * 已签约 / 已流失（不掉公海的状态）、正在交接中的 → 不进公海，照原样留在停用的人名下，由调用方通知去离职交接看板指定接手人（X-31）。
 *
 * 不和恢复同一笔事务：恢复那笔包在 看已删() 里，在里面数项目会把还在回收站里的（更早单独删的）也算上、还会把它们放进公海；
 * 所以恢复提交之后另开一笔。这一笔没做成客户就照原样留在停用的人名下（等于例外），不连累已经做成的恢复
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 无负责人占位邮箱, 不掉公海的状态 } from "@/lib/pool";
import { 恢复进公海理由 } from "@/lib/offboard-db";
import { 能进公海的阶段 } from "@/lib/project/db";
import { 系统 } from "@/lib/project/timeout";
import { 企业版 } from "./switch";
import { 客户名下在推项目进公海, 客户进公海清负责人 } from "./pool-link";
import { 有同事在推的客户 } from "./colleague-projects";
import { 交接中的客户 } from "./handover-db";
import { 进公海挂靠通知 } from "./attach-approval";

/** 原 = 已停用的原负责人；进了公海 false = 例外挡住，还挂在他名下，没进原因 = 命中的那几条（通知里照着写；进公海那笔没做成时空着） */
export type 停用负责人去向 = { 原: string; 进了公海: boolean; 没进原因?: string[] };

/** 客户刚恢复回来（事务已提交）时调。原负责人在职、客户本来就在公海、不是企业版 → null，什么都不动。操作人空 = 系统 */
export async function 恢复后停用负责人去向(customerId: string, 操作人: string): Promise<停用负责人去向 | null> {
  if (!企业版()) return null;
  const c = await 看全部(() => prisma.customer.findUnique({
    where: { id: customerId },
    select: { salesOwnerId: true, followStatus: true, pool: { select: { customerId: true } }, salesOwner: { select: { active: true, email: true } } },
  }));
  if (!c || c.pool || c.salesOwner.active || c.salesOwner.email === 无负责人占位邮箱) return null;
  const 原 = c.salesOwnerId;
  const 这位 = [{ id: customerId, salesOwnerId: 原 }];
  try {
    const 没进原因 = await 看全部(async () => [
      (await prisma.project.count({ where: { customerId, pooledAt: null, result: null, phase: { notIn: [...能进公海的阶段] } } })) > 0 ? "有没结束的订单阶段项目" : null,
      (await 有同事在推的客户(prisma, 这位)).size > 0 ? "有同事在推的项目" : null,
      不掉公海的状态.includes(c.followStatus) ? c.followStatus : null,
      (await 交接中的客户([customerId])).size > 0 ? "正在交接中" : null,
    ].filter((x): x is string => !!x));
    if (没进原因.length) return { 原, 进了公海: false, 没进原因 };
    // 负责人要清空，也算一次换负责人：先钉住老签约（事务外，同手动放进公海）
    await 钉住老签约();
    await 查完再写((tx) => 看全部(async () => {
      await tx.customerPool.create({ data: { customerId, userId: 操作人 || null, reason: 恢复进公海理由 } });
      // 先项目后清负责人：项目那边靠客户原来的负责人认「他自己负责的」
      await 客户名下在推项目进公海(tx, 这位, 操作人 || 系统.id, 恢复进公海理由, new Date());
      await 客户进公海清负责人(tx, 这位, 操作人 || null);
    }));
    await 进公海挂靠通知([customerId]);
    return { 原, 进了公海: true };
  } catch (e) {
    console.warn("[回收站] 恢复后进公海没做成，客户留在停用的人名下：", e instanceof Error ? e.message : e);
    return { 原, 进了公海: false };
  }
}
