import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import type { 换负责人记录 } from "@/lib/owner-log";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 系统 } from "@/lib/project/timeout";

/**
 * 客户换负责人的记录（企业版 D-36，2026-10-24）：谁转的、从谁到谁、什么时候；from = 「历史负责人」。
 * 换负责人的几条路都走这一处：改负责人 / 批量分配 / 公海领取 / 公海分配（带走并记下）、成员停用转交、两种撤销。
 * 放在换负责人的同一个事务里写：负责人改了、记录没写上的情况不会有
 */
/** market-assign = 客户第一次从市场成员分给销售（P-转-03、P-公海-11）：算分配、不算转客户，只是记录分得出 */
export type 换负责人种类 = "assign" | "market-assign" | "claim" | "pool-assign" | "deactivate" | "undo" | "pool-release";

export async function 记换负责人(
  tx: Pick<Prisma.TransactionClient, "customerOwnerLog">,
  换: { customerId: string; from: string | null; to: string }[],
  操作人: string,
  kind: 换负责人种类,
): Promise<void> {
  const 真换了 = 换.filter((x) => x.from !== x.to);
  if (!真换了.length) return;
  await tx.customerOwnerLog.createMany({
    data: 真换了.map((x) => ({ customerId: x.customerId, userId: 操作人, fromOwnerId: x.from, toOwnerId: x.to, kind })),
  });
}

/**
 * 换负责人之后多久内还能撤（30 分钟）。是假设、不是定稿：撤销提示条只亮几秒，
 * 30 分钟留够网络慢、标签页挂着没关、提示条点了没回来再点一次；再长就不算「刚才那一下」了
 */
export const 撤销时限毫秒 = 30 * 60 * 1000;

/**
 * 撤销换负责人只认「我自己刚才那一下」：这几位客户各自最近的一条换负责人记录，得是 操作人 把他从 原 换到 现 的。
 * 原 / 现 是前端传回来的（撤销提示条带着）：光凭「现在还归 现」认，业务员把 原 填成自己、现 填成同事，
 * 就能把同事的客户「撤」到自己名下（2026-10-28 越权排查）。回能撤的客户 id。
 * 只认 撤销时限 之内的那一下（2026-10-28 审查）：不限时的话，拿旧的撤销参数隔几天还能撤，
 * 业务员能把早已不归他的客户拉回来（只要中间没人再换过）。时限外没有记录 = 最近那一下太旧，撤不了。
 * 看全部里查：客户换了人，操作人多半已经看不到这位客户和他的记录了
 */
export async function 是我刚换的(撤: { customerId: string; 原: string; 现: string }[], 操作人: string): Promise<Set<string>> {
  if (!撤.length) return new Set();
  // 只取时限内的记录：最近一条若早于时限，时限内就没有记录，等于撤不了；最近一条在时限内，它也就是时限内最近的那条
  const 起 = new Date(Date.now() - 撤销时限毫秒);
  const 记录 = await 看全部(() => prisma.customerOwnerLog.findMany({
    where: { customerId: { in: [...new Set(撤.map((x) => x.customerId))] }, at: { gte: 起 } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { customerId: true, userId: true, fromOwnerId: true, toOwnerId: true },
  }));
  const 最近 = new Map<string, (typeof 记录)[number]>();
  for (const r of 记录) if (!最近.has(r.customerId)) 最近.set(r.customerId, r);
  return new Set(撤.filter((x) => {
    const r = 最近.get(x.customerId);
    return !!r && r.userId === 操作人 && r.fromOwnerId === x.原 && r.toOwnerId === x.现;
  }).map((x) => x.customerId));
}

/**
 * 这位客户进公海前真正的负责人：公海里客户挂占位账号（M-公海-03），活还在原负责人名下，
 * 领 / 分 / 撤销时要按原负责人找活。旧 是真人时 to 不会等于他（pool-release 的 to 永远是占位），原样返回。
 * 取最近一条：进出过几次公海的，只认这一次进去时的那位
 */
export async function 公海前负责人(tx: Pick<Prisma.TransactionClient, "customerOwnerLog">, customerId: string, 旧: string): Promise<string> {
  const r = await tx.customerOwnerLog.findFirst({
    where: { customerId, toOwnerId: 旧, kind: "pool-release" },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { fromOwnerId: true },
  });
  return r?.fromOwnerId ?? 旧;
}

/**
 * 公海里的客户，人们 里谁是「最近一次进公海时的负责人」（P-公海-04 原负责人回避）：回 客户 id → 那位。
 * 只认最近一次：最近那条「换到占位账号」的 from 才算；曾经负责过、后来转走的人不算（范围不比项目侧 公海里历史负责人是 更宽）。
 * 只看挂占位账号的客户：负责人还是真人的是部署前进公海的老数据，调用方接着按 salesOwnerId 认。
 * db 用不限定的（看全部里）：这时候公海里的客户原负责人本来就看不到
 */
export async function 公海客户原负责人是(db: Pick<Prisma.TransactionClient, "user" | "customer" | "customerOwnerLog">, 人们: string[], 限定客户?: string[]): Promise<Map<string, string>> {
  const 出 = new Map<string, string>();
  if (!人们.length || (限定客户 && !限定客户.length)) return 出;
  const 占位 = (await db.user.findUnique({ where: { email: 无负责人占位邮箱 }, select: { id: true } }))?.id;
  if (!占位) return 出;
  const 候选 = await db.customer.findMany({
    where: {
      salesOwnerId: 占位,
      pool: { isNot: null },
      deletedAt: null,
      ...(限定客户 ? { id: { in: 限定客户 } } : {}),
      ownerLogs: { some: { toOwnerId: 占位, fromOwnerId: { in: 人们 } } },
    },
    select: { id: true },
  });
  const 人 = new Set(人们);
  for (let i = 0; i < 候选.length; i += 400) {
    const 记录 = await db.customerOwnerLog.findMany({
      where: { customerId: { in: 候选.slice(i, i + 400).map((c) => c.id) }, toOwnerId: 占位 },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { customerId: true, fromOwnerId: true },
    });
    const 看过 = new Set<string>();
    for (const r of 记录) {
      if (看过.has(r.customerId)) continue;
      看过.add(r.customerId);
      if (r.fromOwnerId && 人.has(r.fromOwnerId)) 出.set(r.customerId, r.fromOwnerId);
    }
  }
  return 出;
}

/**
 * 界面灰领取按钮用（接口拦在 pool-actions.ts 领取）：这几位公海客户里原负责人是我的，
 * 负责人还是我的老数据 + 最近一次进公海时负责人是我的。回客户 id
 */
export async function 我放出去的公海客户(们: { id: string; 在公海: boolean; salesOwnerId: string }[], 我: string): Promise<string[]> {
  const 公海们 = 们.filter((c) => c.在公海);
  if (!公海们.length) return [];
  const 放走的 = await 看全部(() => 公海客户原负责人是(prisma, [我], 公海们.map((c) => c.id)));
  return 公海们.filter((c) => c.salesOwnerId === 我 || 放走的.has(c.id)).map((c) => c.id);
}

/**
 * 撤销换负责人（P-撤销-01，企业版）：被撤的那条 from → to 删掉，不另记一条（操作日志 AuditLog 照留）。
 * 只删最近那条且不是 pool-release：撤领取时被撤的是 占位 → 我 那条，进公海那条还得留着，它记着原负责人。
 * 要在把负责人还回去之前或之后调都行，条件只看记录本身
 */
export async function 删被撤的换负责人记录(tx: Pick<Prisma.TransactionClient, "customerOwnerLog">, customerId: string | string[], from: string, to: string): Promise<void> {
  // 一批客户（同一个 from → to）一次查、一次删：每位只删自己最近那条
  const 们 = await tx.customerOwnerLog.findMany({
    where: { customerId: { in: typeof customerId === "string" ? [customerId] : customerId }, fromOwnerId: from, toOwnerId: to, NOT: { kind: "pool-release" } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { id: true, customerId: true },
  });
  const 最近 = new Map<string, string>();
  for (const r of 们) if (!最近.has(r.customerId)) 最近.set(r.customerId, r.id);
  if (最近.size) await tx.customerOwnerLog.deleteMany({ where: { id: { in: [...最近.values()] } } });
}

/**
 * 撤销放进公海（P-撤销-01，企业版）：负责人按进公海那条 pool-release 还回去，那条删掉。不信前端传的值。
 * 老数据进公海没清负责人、没有这条的不动（负责人本来就是他）
 */
export async function 还原进公海前负责人(tx: Pick<Prisma.TransactionClient, "customer" | "customerOwnerLog">, 客户们: string[]): Promise<void> {
  for (const customerId of 客户们) {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true } });
    if (!c) continue;
    const r = await tx.customerOwnerLog.findFirst({
      where: { customerId, toOwnerId: c.salesOwnerId, kind: "pool-release" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { id: true, fromOwnerId: true },
    });
    if (!r?.fromOwnerId) continue;
    await tx.customer.update({ where: { id: customerId }, data: { salesOwnerId: r.fromOwnerId } });
    await tx.customerOwnerLog.delete({ where: { id: r.id } });
  }
}

/**
 * 详情页的「历史负责人」：这位客户全部换负责人记录，按时间正序，人名换好。
 * 名字按 id 直接查、不挑在职——停用（离职）的人登不进来，但他当过负责人、转过人照旧显示名字
 */
export async function 历史负责人of(customerId: string): Promise<换负责人记录[]> {
  const 记录 = await prisma.customerOwnerLog.findMany({ where: { customerId }, orderBy: [{ at: "asc" }, { id: "asc" }] });
  if (!记录.length) return [];
  const ids = [...new Set(记录.flatMap((r) => [r.userId, r.fromOwnerId, r.toOwnerId]).filter((x): x is string => !!x))];
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const 叫 = (id: string | null) => (id ? (名.get(id) ?? "已删除的成员") : null);
  return 记录.map((r) => ({ at: r.at.toISOString(), 操作人: r.userId === 系统.id ? 系统.name : (名.get(r.userId) ?? null), 从: 叫(r.fromOwnerId), 到: 叫(r.toOwnerId), kind: r.kind }));
}
