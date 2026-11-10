/**
 * 企业版两级公海的联动（2026-10-26，11-09 按 M-公海-01/02/06 拆开）：客户公海和线索公海（代码里仍叫项目公海）分开。
 * 规则开关在 pool-rules.ts，只企业版做。
 *   - 项目层动作（放回、超时收回、单独领、分配、转让）只动项目，客户负责人不动（开关 单项目客户跟着进公海、领项目带走单项目客户 关着）
 *   - 客户进客户公海（手动放进公海、离职公海方式）：客户负责人自己负责的线索 / 商机项目一起进线索公海，
 *     客户负责人清空，原负责人记历史（客户进公海清负责人，M-公海-03）
 *   - 领客户即领项目：领 / 分配客户公海里的客户，名下放在线索公海里的项目一起归领的人（M-公海-05）
 *     （没进线索公海的项目本来就跟着客户转，见 carry-over-db 跟着客户转的项目）
 *
 * 查和改都包在 看全部() 里：按组织看客户开着时请求带着打开页面那个人的范围，判「名下只有一个项目」不能只数他看得到的
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 公海规则, 单项目客户进公海理由, 客户整体进公海理由 } from "./pool-rules";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 带走一位, 带走公海项目, type 带走的 } from "@/lib/carry-over-db";
import { 记转让, 能进公海的阶段, 超上限n, 算持有的项目 } from "@/lib/project/db";
import type { 组织规则 } from "@/lib/project/org-rules";
import { 进公海后负责人, 进公海关待办 } from "@/lib/project/pool-owner";
import { 在推项目条件 } from "@/lib/project/active";
import { 系统 } from "@/lib/project/timeout";
import { 有同事在推的客户 } from "./colleague-projects";
import { 记换负责人, type 换负责人种类 } from "@/lib/owner-log-db";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 交接中的客户 } from "./handover-db";

/**
 * 客户刚进了客户公海（手动放进公海、离职公海方式），同一笔事务里：负责人清空（M-公海-03）。
 * salesOwnerId 必填外键，写占位账号；原负责人记一行 pool-release（from = 原负责人，to = 占位账号），领 / 分 / 撤销都按它认。
 * 要排在 客户名下在推项目进公海 之后：那边靠客户原来的负责人认「他自己负责的」项目。
 * 换负责人之前调用方要在事务外先 钉住老签约（这也是一次换负责人）。操作人 null = 系统（超时）
 */
export async function 客户进公海清负责人(tx: Prisma.TransactionClient, 们: { id: string; salesOwnerId: string }[], 操作人: string | null): Promise<void> {
  if (!企业版() || !公海规则.进公海清负责人 || !们.length) return;
  await 看全部(async () => {
    const 占位 = await 无负责人占位Id(tx);
    const 要清 = 们.filter((c) => c.salesOwnerId !== 占位);
    if (!要清.length) return;
    await 记换负责人(tx, 要清.map((c) => ({ customerId: c.id, from: c.salesOwnerId, to: 占位 })), 操作人 ?? 系统.id, "pool-release");
    for (let i = 0; i < 要清.length; i += 500) {
      await tx.customer.updateMany({ where: { id: { in: 要清.slice(i, i + 500).map((c) => c.id) } }, data: { salesOwnerId: 占位 } });
    }
  });
}

/**
 * 开关 单项目客户跟着进公海 11-09 起关着，下面是打开时的做法。
 * 项目刚进了项目公海（主动放回、超时回收），在同一笔事务里调：客户名下一共只有这一个项目、
 * 客户和项目是同一位负责人、客户还不在公海 → 客户也放进客户公海。返回放了没有。
 * 只看同一位负责人：客户归别人、只是项目归他的，不能因为他放回项目就把别人的客户也扔进公海。
 * 操作人 = 放进去的人；超时回收没有人放，传 null（同自动掉公海）。
 * 多项目客户也进（客户整体转让）：名下有没结束的订单阶段项目、或有同事负责还没结束的项目（例外二，11-05）才不进。
 * 进了的：客户负责人名下别的线索 / 商机项目一起进项目公海，同手动放进公海（X-12，11-05 用户：「按手动 建议来」），
 * 原来只放客户、别的项目还挂在原负责人名下，原负责人回避后看不到、也推不了。
 * 退回原因 = 放回项目时选的「回收原因：X」（整串），接在说明后面记进客户公海那一行，统一公海的「入池原因」列读得到（M-公海-09）
 */
export async function 单项目客户跟进公海(
  tx: Prisma.TransactionClient,
  p: { customerId: string; ownerId: string },
  操作人: string | null,
  at: Date,
  退回原因?: string | null,
): Promise<boolean> {
  if (!企业版() || !公海规则.单项目客户跟着进公海) return false;
  return 看全部(async () => {
    const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    if (!c || c.pool || c.salesOwnerId !== p.ownerId) return false;
    // 申请移交 / 转让交接还没确认的客户不跟着进公海（X-38 → P-转-05）
    if ((await 交接中的客户([p.customerId], tx)).size) return false;
    const 几个 = await tx.project.count({ where: { customerId: p.customerId } });
    if (几个 !== 1 && (await tx.project.count({ where: { customerId: p.customerId, phase: "订单", result: null } }))) return false;
    // M-公海-02 例外二（P-公海-06，11-05）：名下有同事负责、还没结束的项目，客户不跟着进（手上这个已经进了项目公海，不算）
    if (几个 !== 1 && (await 有同事在推的客户(tx, [{ id: p.customerId, salesOwnerId: c.salesOwnerId }])).size) return false;
    const 说明 = 几个 === 1 ? 单项目客户进公海理由 : 客户整体进公海理由;
    const 理由 = 退回原因 ? `${说明}；${退回原因}` : 说明;
    await tx.customerPool.create({ data: { customerId: p.customerId, userId: 操作人, reason: 理由, at } });
    // 手上这个调用方已经放进项目公海（pooledAt 有值，不算在推），这里只带别的；超时回收没有人放，留痕记系统
    if (几个 !== 1) await 客户名下在推项目进公海(tx, [{ id: p.customerId, salesOwnerId: c.salesOwnerId }], 操作人 ?? 系统.id, 理由, at);
    await 客户进公海清负责人(tx, [{ id: p.customerId, salesOwnerId: c.salesOwnerId }], 操作人);
    return true;
  });
}

/**
 * 客户刚整体进了客户公海，同一笔事务里：客户负责人自己负责、还没结束的线索 / 商机项目一起进项目公海，返回这些项目 id（撤销用）。
 * 手动放进公海（P-公海-06）和项目放回 / 超时把客户带进公海（X-12）走同一段。
 * 项目这一半同项目放回公海：清负责人（pool-owner.ts）、原负责人记在 pool-release 的 from 上、关他在这位客户上没做完的待办。
 * 同事的、订单阶段的不碰（调用方已经整位拦掉）。理由 = 记在每行 pool-release 上的说明，null 不记
 */
export async function 客户名下在推项目进公海(
  tx: Prisma.TransactionClient,
  们: { id: string; salesOwnerId: string }[],
  操作人: string,
  理由: string | null,
  现在: Date,
): Promise<string[]> {
  return 看全部(async () => {
    const 主 = new Map(们.map((c) => [c.id, c.salesOwnerId]));
    const 放了: string[] = [];
    for (let i = 0; i < 们.length; i += 500) {
      const 项目 = await tx.project.findMany({
        where: { customerId: { in: 们.slice(i, i + 500).map((c) => c.id) }, ...在推项目条件, phase: { in: [...能进公海的阶段] } },
        select: { id: true, customerId: true, name: true, ownerId: true, phase: true, node: true, result: true },
      });
      for (const p of 项目) {
        if (!p.ownerId || p.ownerId !== 主.get(p.customerId)) continue;
        await tx.project.update({ where: { id: p.id }, data: { ownerId: 进公海后负责人(p.ownerId), pooledAt: 现在, nextStepAt: null, nextStepText: null } });
        await 记转让(tx, p, 操作人, p.ownerId, null, "pool-release", 理由, 现在);
        // 客户这时已经在公海里：原负责人在这位客户上没做完的待办全关（pool-owner.ts 进公海关待办）
        await 进公海关待办(tx, p, p.ownerId, 现在);
        放了.push(p.id);
      }
    }
    return 放了;
  });
}

/**
 * 领 / 分线索公海里的一个项目给 新 之前（事务里、改负责人之前）核持有上限（M-公海-18）：
 * 手上这个算持有就进 1 个；开关 领项目带走单项目客户 开着、客户在客户公海里时，单项目客户跟着领 还会把客户名下别的公海项目一起带过来，
 * 照领多项目的公海客户（#203）一起数（客户原负责人自己的项目进客户公海时已进线索公海，剩下的不算持有）。开关关着时同 超上限，话术一字不差。
 * 另进：调用方另外要进手的（分项目给 市场转客户带过来的同事待分配项目）。
 * 整包：销售管理、总管理分客户在客户公海里的项目（P-公海-10，客户整包出公海），不看开关、照样把名下别的公海项目一起数。不是企业版 / 没开上限回 null
 */
export async function 领项目连带超上限(
  tx: Prisma.TransactionClient,
  规则: 组织规则,
  新: string,
  p: { id: string; customerId: string; phase: string; result: string | null },
  另进 = 0,
  整包 = false,
): Promise<string | null> {
  if (!企业版()) return null;
  const 一 = !p.result && (能进公海的阶段 as readonly string[]).includes(p.phase) ? 1 : 0;
  const 带 = (整包 || 公海规则.领项目带走单项目客户) && 公海规则.领客户带走公海里的项目
    ? await 看全部(async () => (await tx.customerPool.findUnique({ where: { customerId: p.customerId }, select: { customerId: true } }))
      ? tx.project.count({ where: { customerId: p.customerId, pooledAt: { not: null }, id: { not: p.id }, ...算持有的项目 } })
      : 0)
    : 0;
  return 超上限n(tx, 规则, 新, 一 + 带 + 另进);
}

/**
 * 开关 领项目带走单项目客户 11-09 起关着，下面是打开时的做法。
 * 刚从项目公海领了一个项目，在同一笔事务里调：客户在客户公海里、名下只有这一个项目 → 客户也归领的人，
 * 规矩同客户公海领取（记领取时间、删公海那一行、原负责人没做完的活跟着过来、记一行换负责人）。
 * 返回领过来的客户（原来归谁），没领返回 null。不数项目（客户整体转让），客户在客户公海就一起领，
 * 名下没进项目公海的别的项目由 带走一位 一起转过来；
 * 名下还放在项目公海里的别的项目也一起归 新（10-31，同 领客户带走公海项目：每个记一行 pool-claim，操作人 = 操作人）。
 * 调用方要先把手上这个项目移出项目公海再调，不然它会被当成「别的公海项目」再记一行。
 * 带待办（C-06）：一起带过来的公海项目，进公海时关掉的那批待办照这个勾重新打开（同手上这个项目）；没传不碰
 */
export async function 单项目客户跟着领(
  tx: Prisma.TransactionClient,
  customerId: string,
  新: string,
  操作人: string = 新,
  带待办?: boolean,
): Promise<{ customerId: string; 旧: string } | null> {
  if (!企业版() || !公海规则.领项目带走单项目客户) return null;
  return 客户整包出公海(tx, customerId, 新, 操作人, 带待办);
}

/**
 * 客户在客户公海里，销售管理 / 总管理把他名下一个项目从线索公海、项目公海分给销售（P-公海-10，11-09 定）：客户和名下别的公海项目一起出公海归 新，
 * 不看开关 领项目带走单项目客户。同一笔事务里、手上这个项目已移出公海之后调。规矩同客户公海分配：先改负责人、记领取、删公海那一行，
 * 原负责人（进公海前那位）没做完的活跟着过来，记一行换负责人（kind 默认 claim；管理分配传 pool-assign、操作人 = 分的人）；
 * 名下还在公海里的项目每个记一行 pool-claim。客户不在客户公海里回 null。返回原负责人（占位账号）和一起带过来的公海项目
 */
export async function 客户整包出公海(
  tx: Prisma.TransactionClient,
  customerId: string,
  新: string,
  操作人: string = 新,
  带待办?: boolean,
  kind: 换负责人种类 = "claim",
): Promise<整包出公海 | null> {
  if (!企业版()) return null;
  return 看全部(async () => {
    if (!(await tx.customerPool.findUnique({ where: { customerId }, select: { customerId: true } }))) return null;
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true } });
    if (!c) return null;
    // 顺序同客户公海领取：先改负责人、最后删公海那一行
    if (c.salesOwnerId !== 新) await tx.customer.update({ where: { id: customerId }, data: { salesOwnerId: 新 } });
    await tx.customerClaim.upsert({ where: { customerId }, update: { userId: 新, at: new Date() }, create: { customerId, userId: 新 } });
    await tx.customerPool.deleteMany({ where: { customerId } });
    const 带 = c.salesOwnerId !== 新 ? await 带走一位(tx, customerId, c.salesOwnerId, 新, kind === "claim" ? 新 : 操作人, kind) : null;
    const 公海项目 = 公海规则.领客户带走公海里的项目 ? await 带走公海项目(tx, [customerId], 新, 操作人, 带待办) : [];
    // 撤销整包退回（P-公海-10）只还这次带过来的活，同客户公海分配的 带过来
    const 带过来: 带走的 = { 计划: 带?.计划 ?? [], 待办: 带?.待办 ?? [], 商机: 带?.商机 ?? [], 项目: 带?.项目 ?? [] };
    return { customerId, 旧: c.salesOwnerId, 公海项目, 带过来 };
  });
}

/** 客户整包出公海带走了什么：旧 = 出公海前的负责人（一般是无负责人占位账号），撤销整包退回时按它还 */
export type 整包出公海 = { customerId: string; 旧: string; 公海项目: string[]; 带过来: 带走的 };

/**
 * 客户公海里的客户刚被领走 / 分走（已经归 新）：名下放在项目公海里的项目一起归 新，每个记一行 pool-claim。
 * 持有上限这里不拦：领取 / 分配公海在动手之前整批核过（pool-actions 带走公海项目超上限，M-公海-18，11-09）。返回带过来的项目 id。
 * 带待办（C-06，领取 / 分配客户时的勾）：这些项目进公海时关掉的那批待办重新打开给 新；没传不碰
 */
export async function 领客户带走公海项目(customerIds: string[], 新: string, 操作人: string, 带待办?: boolean): Promise<string[]> {
  if (!企业版() || !公海规则.领客户带走公海里的项目 || !customerIds.length) return [];
  return 看全部(() => 查完再写((tx) => 带走公海项目(tx, customerIds, 新, 操作人, 带待办)));
}

