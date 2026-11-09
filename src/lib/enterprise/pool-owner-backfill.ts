import { prisma } from "@/lib/prisma";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 系统 } from "@/lib/project/timeout";
import { 看全部 } from "@/lib/team-scope";

/**
 * M-公海-03 上线前进客户公海的老数据：负责人还挂着原负责人。这里补成和新进公海的一样：
 * 负责人改挂占位账号，原负责人记一行 pool-release（时间记当初进公海的时间，不是跑脚本的时间）。
 * 可以重复跑：已经挂占位账号的不再动。没跑之前旧数据也不会放错人（领取、回避都同时认旧字段），
 * 所以顺序是先上代码、再跑 scripts/pool-owner-backfill.ts。
 * 客户上他自己负责、还没进线索公海的项目不动：老规则下它们跟着客户待着，领客户时照样带走；数目报出来看一眼
 */
export type 补记结果 = {
  /** 这次改了（演练 = 将改）几位客户 */
  客户: number;
  /** 这些客户上负责人还是原负责人、没进线索公海的项目（不动，只报） */
  没进线索公海的项目: number;
};

export async function 补记存量公海客户(真写: boolean): Promise<补记结果> {
  // 换负责人之前先钉住老签约（同所有换负责人的动作）；只有真写才动库
  if (真写) await 钉住老签约();
  return 看全部(async () => {
    const 占位 = 真写
      ? await 无负责人占位Id(prisma)
      : (await prisma.user.findUnique({ where: { email: 无负责人占位邮箱 }, select: { id: true } }))?.id ?? "";
    const 们 = await prisma.customer.findMany({
      where: { pool: { isNot: null }, salesOwnerId: { not: 占位 } },
      select: { id: true, salesOwnerId: true, pool: { select: { at: true } } },
    });
    let 项目数 = 0;
    for (let i = 0; i < 们.length; i += 200) {
      for (const c of 们.slice(i, i + 200)) {
        项目数 += await prisma.project.count({ where: { customerId: c.id, ownerId: c.salesOwnerId, pooledAt: null, result: null } });
      }
    }
    if (真写) {
      for (const c of 们) {
        await prisma.$transaction(async (tx) => {
          // 跑的时候客户刚好被领走了就不算了：只改还挂着读到的那位、还在公海里的
          const r = await tx.customer.updateMany({ where: { id: c.id, salesOwnerId: c.salesOwnerId, pool: { isNot: null } }, data: { salesOwnerId: 占位 } });
          if (!r.count) return;
          await tx.customerOwnerLog.create({
            data: { customerId: c.id, userId: 系统.id, at: c.pool?.at ?? new Date(), fromOwnerId: c.salesOwnerId, toOwnerId: 占位, kind: "pool-release" },
          });
        });
      }
    }
    return { 客户: 们.length, 没进线索公海的项目: 项目数 };
  });
}
