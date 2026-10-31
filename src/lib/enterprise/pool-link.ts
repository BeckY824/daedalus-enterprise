/**
 * 企业版两级公海的联动（2026-10-26）：客户公海和项目公海不拆开。规则开关在 pool-rules.ts，只企业版做。
 *   - 单项目客户：客户名下只有这一个项目，项目进项目公海 → 客户也进客户公海；领这个项目 → 客户一起领过来
 *   - 领客户即领项目：领 / 分配客户公海里的客户，名下放在项目公海里的项目一起归领的人
 *     （领项目把客户一起带出客户公海时也一样，10-31，见 单项目客户跟着领）
 *     （没进项目公海的项目本来就跟着客户整体转，见 carry-over-db 跟着客户转的项目）
 *   - 多项目客户（10-27 晚会议定固定 客户可转让，不再二选一，见 org-rules.ts 多项目客户走法们）：不数项目，客户是一个整体：
 *     项目进项目公海 → 客户也进（名下有没结束的订单阶段项目除外，订单不进公海）；领这个项目 → 客户连同名下别的项目一起领过来
 *
 * 查和改都包在 看全部() 里：按组织看客户开着时请求带着打开页面那个人的范围，判「名下只有一个项目」不能只数他看得到的
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 公海规则, 单项目客户进公海理由, 客户整体进公海理由 } from "./pool-rules";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 带走一位 } from "@/lib/carry-over-db";
import { 转让痕 } from "@/lib/project/db";

/**
 * 项目刚进了项目公海（主动放回、超时回收），在同一笔事务里调：客户名下一共只有这一个项目、
 * 客户和项目是同一位负责人、客户还不在公海 → 客户也放进客户公海。返回放了没有。
 * 只看同一位负责人：客户归别人、只是项目归他的，不能因为他放回项目就把别人的客户也扔进公海。
 * 操作人 = 放进去的人；超时回收没有人放，传 null（同自动掉公海）。
 * 多项目客户也进（客户整体转让）：名下有没结束的订单阶段项目才不进（别的项目跟着客户待着，谁领客户谁带走）
 */
export async function 单项目客户跟进公海(
  tx: Prisma.TransactionClient,
  p: { customerId: string; ownerId: string },
  操作人: string | null,
  at: Date,
): Promise<boolean> {
  if (!企业版() || !公海规则.单项目客户跟着进公海) return false;
  return 看全部(async () => {
    const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    if (!c || c.pool || c.salesOwnerId !== p.ownerId) return false;
    const 几个 = await tx.project.count({ where: { customerId: p.customerId } });
    if (几个 !== 1 && (await tx.project.count({ where: { customerId: p.customerId, phase: "订单", result: null } }))) return false;
    await tx.customerPool.create({ data: { customerId: p.customerId, userId: 操作人, reason: 几个 === 1 ? 单项目客户进公海理由 : 客户整体进公海理由, at } });
    return true;
  });
}

/**
 * 刚从项目公海领了一个项目，在同一笔事务里调：客户在客户公海里、名下只有这一个项目 → 客户也归领的人，
 * 规矩同客户公海领取（记领取时间、删公海那一行、原负责人没做完的活跟着过来、记一行换负责人）。
 * 返回领过来的客户（原来归谁），没领返回 null。不数项目（客户整体转让），客户在客户公海就一起领，
 * 名下没进项目公海的别的项目由 带走一位 一起转过来；
 * 名下还放在项目公海里的别的项目也一起归 新（10-31，同 领客户带走公海项目：每个记一行 pool-claim，操作人 = 操作人）。
 * 调用方要先把手上这个项目移出项目公海再调，不然它会被当成「别的公海项目」再记一行
 */
export async function 单项目客户跟着领(
  tx: Prisma.TransactionClient,
  customerId: string,
  新: string,
  操作人: string = 新,
): Promise<{ customerId: string; 旧: string } | null> {
  if (!企业版() || !公海规则.领项目带走单项目客户) return null;
  return 看全部(async () => {
    if (!(await tx.customerPool.findUnique({ where: { customerId }, select: { customerId: true } }))) return null;
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true } });
    if (!c) return null;
    // 顺序同客户公海领取：先改负责人、最后删公海那一行
    if (c.salesOwnerId !== 新) await tx.customer.update({ where: { id: customerId }, data: { salesOwnerId: 新 } });
    await tx.customerClaim.upsert({ where: { customerId }, update: { userId: 新, at: new Date() }, create: { customerId, userId: 新 } });
    await tx.customerPool.deleteMany({ where: { customerId } });
    if (c.salesOwnerId !== 新) await 带走一位(tx, customerId, c.salesOwnerId, 新, 新, "claim");
    if (公海规则.领客户带走公海里的项目) await 带走公海项目(tx, [customerId], 新, 操作人);
    return { customerId, 旧: c.salesOwnerId };
  });
}

/**
 * 客户公海里的客户刚被领走 / 分走（已经归 新）：名下放在项目公海里的项目一起归 新，每个记一行 pool-claim。
 * 不拦持有上限：同跟着客户转（超上限 的说明）。返回带过来的项目 id
 */
export async function 领客户带走公海项目(customerIds: string[], 新: string, 操作人: string): Promise<string[]> {
  if (!企业版() || !公海规则.领客户带走公海里的项目 || !customerIds.length) return [];
  return 看全部(() => 查完再写((tx) => 带走公海项目(tx, customerIds, 新, 操作人)));
}

/**
 * 同一笔事务里：这几位客户（已经归 新）名下还在项目公海里的项目一起归 新——负责人改成 新、出项目公海、清下一步，
 * 每个记一行 pool-claim（同单独领项目）。不在项目公海里的不碰（那些归谁由 带走一位 / 跟着客户转的项目 管）
 */
async function 带走公海项目(tx: Prisma.TransactionClient, customerIds: string[], 新: string, 操作人: string): Promise<string[]> {
  // 只认现在真归 新 的客户：领的事务和这里之间又被人改给了别人的不带
  const 们 = await tx.project.findMany({
    where: { customerId: { in: customerIds }, pooledAt: { not: null }, customer: { salesOwnerId: 新 } },
    select: { id: true, ownerId: true, phase: true, node: true, result: true },
  });
  if (!们.length) return [];
  const ids = 们.map((p) => p.id);
  await tx.project.updateMany({ where: { id: { in: ids } }, data: { ownerId: 新, pooledAt: null, nextStepAt: null, nextStepText: null } });
  await tx.projectNodeLog.createMany({ data: 们.map((p) => 转让痕(p, 操作人, p.ownerId, 新, "pool-claim")) });
  return ids;
}
