import type { Prisma } from "@/generated/prisma";
import { 转交商机 } from "@/lib/opportunity-activity";
import { prisma } from "@/lib/prisma";
import { 记转让, 转让痕, 收回提醒尾, 旧收回提醒尾, 将回收提醒跟着换人 } from "@/lib/project/db";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";
import { 卡点随项目换人, 转让接手理由 } from "@/lib/project/blocker";
import { 记换负责人, 公海前负责人, type 换负责人种类 } from "@/lib/owner-log-db";
import { 历史负责人们 } from "@/lib/project/pool-owner";
import { 公海领走接手理由 } from "@/lib/project/blocker";
import { 换负责人待办, 待办痕, 接上待办痕 } from "@/lib/project/carry-tasks";
import { 撞号提醒尾 } from "@/lib/enterprise/contact-format";
import { 预览列几个, type 带走数, type 转走项目预览 } from "@/lib/carry-over";

/**
 * 客户换了销售负责人，原负责人在他身上**没做完的活**跟着走（2026-10-02 排查 B3）：
 * 没完成的计划、待办，进行中的商机。原来不跟：客户转给李四以后，到点提醒、早报还发给张三，李四收不到。
 * 只动原负责人名下的——别的同事挂在这位客户上的活不碰；做完的、赢单丢单的是历史，不动。
 * 项目（团队版项目模式）不一样，见 跟着客户转的项目：团队版整体转；企业版见 带走一位（转客户带全部，领 / 分带原负责人自己的）。
 */
export async function 带走没做完的(换: { customerId: string; 旧: string }[], 新: string, 操作人?: string): Promise<带走数> {
  return (await 带走并记下(换, 新, 操作人)).数;
}

/**
 * 客户换人时，哪些项目跟着走（团队版项目模式 1a，2026-10-23 定「整体转」）：这位客户名下的项目
 * 不管原来是谁负责的，都连同客户一起转给新负责人；只有放在项目公海里的不动（等人领）。
 * 企业版传 旧：只带他自己负责的（从公海领 / 分走，同事负责的留在各自名下）。
 * 企业版转客户不传 旧：全部项目，含同事负责的（P-转-07，11-09）；公海里的另走 带走公海项目
 */
export function 跟着客户转的项目(customerId: string, 旧?: string): Prisma.ProjectWhereInput {
  return 企业版() && 旧 !== undefined ? { customerId, pooledAt: null, ownerId: 旧 } : { customerId, pooledAt: null };
}

/**
 * 转之前先数一数会一起转走哪些项目（企业版 D-36「转之前先列出会一起转走的 N 个项目」，2026-10-24；P-转-07 11-09）。
 * 条件和真转的一样，数出来的就是转完说的那个数：
 *   不在公海的客户：名下全部项目（含同事负责的、线索公海里的）；公海里的客户（领 / 分）：线索公海里的 + 进公海前负责人自己的。
 * 同事负责的、公海里的在预览里写明负责人（转之前要看清）。
 * 客户按调用方能看到的算（限定着查，看不到的本来也转不了）；项目看全部：会带走同事负责的，那些也得列出来
 */
export async function 数转走的项目(ids: string[], 新: string): Promise<转走项目预览> {
  if (!ids.length) return { 项目数: 0, 项目: [] };
  const 换人的 = await prisma.customer.findMany({ where: { id: { in: [...new Set(ids)] }, salesOwnerId: { not: 新 } }, select: { id: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
  if (!换人的.length) return { 项目数: 0, 项目: [] };
  return 看全部(async () => {
    if (!企业版()) {
      const where: Prisma.ProjectWhereInput = { AND: [{ OR: 换人的.map((c) => 跟着客户转的项目(c.id)) }, { ownerId: { not: 新 } }] };
      const [项目数, 们] = await Promise.all([
        prisma.project.count({ where }),
        prisma.project.findMany({ where, orderBy: { createdAt: "asc" }, take: 预览列几个, select: { name: true, customer: { select: { name: true } } } }),
      ]);
      return { 项目数, 项目: 们.map((p) => ({ name: p.name, 客户: p.customer.name })) };
    }
    const 条件: Prisma.ProjectWhereInput[] = [];
    for (const c of 换人的) {
      if (!c.pool) 条件.push({ customerId: c.id });
      else {
        条件.push({ customerId: c.id, pooledAt: { not: null } });
        条件.push({ customerId: c.id, pooledAt: null, ownerId: await 公海前负责人(prisma, c.id, c.salesOwnerId) });
      }
    }
    const where: Prisma.ProjectWhereInput = { AND: [{ OR: 条件 }, { ownerId: { not: 新 } }] };
    const [项目数, 们] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({ where, orderBy: { createdAt: "asc" }, take: 预览列几个, select: { name: true, ownerId: true, pooledAt: true, customerId: true, customer: { select: { name: true } } } }),
    ]);
    const 主 = new Map(换人的.map((c) => [c.id, c.salesOwnerId]));
    const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(们.map((p) => p.ownerId).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      项目数,
      项目: 们.map((p) => {
        // 客户负责人自己的不用写；同事负责的写名字，公海里的写「线索公海」（P-转-07：转之前列清楚）
        const 负责人 = p.pooledAt ? "线索公海" : p.ownerId && p.ownerId !== 主.get(p.customerId) ? (名.get(p.ownerId) ?? "") : "";
        return { name: p.name, 客户: p.customer.name, ...(负责人 ? { 负责人 } : {}) };
      }),
    };
  });
}

/**
 * 把挑出来的项目转给新负责人，每个项目记一行转让痕（谁、何时、从谁到谁）；返回转了哪几个。
 * 一次改、一次写痕：停用成员一次转一两百个，逐个改会拖到事务超时（企业版 D-36 要求 200 条一次做完）。
 * 下一步（时间 + 文字）企业版跟着项目走、不清，同手动转让（改项目，11-03 A2-3）；不是企业版照旧清掉。
 * 「再不跟进就回公海」的提醒也跟着项目交给新负责人（将回收提醒跟着换人；事务里读不了规则，不再算回收日）。
 * 卡点跟着（B5）：上一位在这些项目卡点上没完成的认领行给新负责人（同 记转让）；离职交接传 false，交给 交接卡点 按它的规则分
 */
export async function 转项目(tx: Prisma.TransactionClient, where: Prisma.ProjectWhereInput, 新: string, 操作人: string, 卡点跟着 = true, 痕说明: string | null = null): Promise<string[]> {
  const 们 = await tx.project.findMany({ where: { AND: [where, { ownerId: { not: 新 } }] }, select: { id: true, name: true, customerId: true, ownerId: true, phase: true, node: true, result: true } });
  if (!们.length) return [];
  const ids = 们.map((p) => p.id);
  await tx.project.updateMany({ where: { id: { in: ids } }, data: { ownerId: 新, ...(企业版() ? {} : { nextStepAt: null, nextStepText: null }) } });
  for (const p of 们) await 将回收提醒跟着换人(tx, p, p.ownerId || null, 新);
  await tx.projectNodeLog.createMany({ data: 们.map((p) => 转让痕(p, 操作人, p.ownerId, 新, "transfer", 痕说明)) });
  if (卡点跟着) for (const p of 们) if (p.ownerId) await 卡点随项目换人(tx, p.id, p.ownerId, 新, 操作人, 转让接手理由);
  return ids;
}

/**
 * 撤销时把带过来的项目还回去：只还「还在这位客户下、还归现负责人、没进公海」的。
 * 整体转会带走别的同事负责的项目，所以各还各的：按这个项目最近一行「转给现负责人」的转让痕还给当时的负责人，
 * 找不到痕的（老数据）还给客户原负责人。
 * 企业版按原样回滚（P-撤销-01）：被撤的那行转让痕删掉，不另记一行；卡点认领行照样还回去
 */
export async function 还项目(tx: Prisma.TransactionClient, ids: string[] | undefined, customerId: string, 现: string, 原: string, 操作人: string) {
  if (!ids?.length) return;
  const 们 = await tx.project.findMany({ where: { id: { in: ids }, customerId, ownerId: 现, pooledAt: null }, select: { id: true, phase: true, node: true, result: true } });
  for (const p of 们) {
    const 痕 = await tx.projectNodeLog.findFirst({ where: { projectId: p.id, kind: "transfer", toOwnerId: 现 }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { id: true, fromOwnerId: true } });
    const 还给 = 痕?.fromOwnerId ?? 原;
    if (还给 === 现) continue;
    await tx.project.update({ where: { id: p.id }, data: { ownerId: 还给 } });
    if (企业版()) {
      if (痕) await tx.projectNodeLog.delete({ where: { id: 痕.id } });
      await 卡点随项目换人(tx, p.id, 现, 还给, 操作人, 转让接手理由);
    } else await 记转让(tx, p, 操作人, 现, 还给);
  }
}

/** 转走的是哪几条（撤销时只还这几条，不碰「转之前就归新负责人」的那些——0.46.15 公海复查）。项目可能没有：老版本撤销条上带回来的没这一项 */
export type 带走的 = { 计划: string[]; 待办: string[]; 商机: string[]; 项目?: string[]; 公海项目?: string[] };

/**
 * 同 带走没做完的，另外返回转走的那几条的 id。操作人记在项目的转让痕上，不给就记新负责人。
 * 同一个事务里记一行换负责人（kind 分得出是改负责人、公海领取还是公海分配，见 owner-log-db.ts）
 */
export async function 带走并记下(换: { customerId: string; 旧: string }[], 新: string, 操作人: string = 新, kind: 换负责人种类 = "assign"): Promise<{ 数: 带走数; 记下: 带走的 }> {
  const 数: 带走数 = { 计划和待办: 0, 商机: 0, 项目: 0 };
  const 记下: 带走的 = { 计划: [], 待办: [], 商机: [], 项目: [], 公海项目: [] };
  for (const { customerId, 旧 } of 换) {
    if (旧 === 新) continue;
    /*
      函数式事务，不用数组式：托管版的 prisma 是按工作区解析的代理，模型方法一调就执行、返回原生 Promise，
      数组式 $transaction 收到它会直接抛错（而那几条已经写进去了）。函数式拿到的 tx 是真客户端，两边都对（2026-10-02 排查 A3）
      先取 id 再按 id 改：同一个事务里，取到的就是改掉的
    */
    /*
      看全部（团队版业务员，lib/team-scope.ts）：业务员把自己的客户交给同事，客户一换负责人他就看不到了，
      限定着查会漏掉这位客户上的商机（商机跟着客户可见），活带不过去（2026-10-04 五人实测）。要转哪几条由上面的条件定，不靠限定
    */
    const { 计划, 待办, 商机, 项目, 公海项目 } = await 看全部(() => prisma.$transaction((tx) => 带走一位(tx, customerId, 旧, 新, 操作人, kind)));
    数.计划和待办 += 计划.length + 待办.length;
    数.商机 += 商机.length;
    数.项目 = (数.项目 ?? 0) + 项目.length + 公海项目.length;
    记下.项目!.push(...项目);
    记下.公海项目!.push(...公海项目);
    记下.计划.push(...计划);
    记下.待办.push(...待办);
    记下.商机.push(...商机);
  }
  return { 数, 记下 };
}

/**
 * 换负责人时不跟着转的系统提醒（待办的查询条件）。分配通知数「客户上还有几条待办」也用这份，不算这些。
 * 超时收回的提醒是给原负责人的，不跟着转（企业版单项目客户随项目进了公海，领客户时提醒别落到新负责人头上）；
 * AI 建档撞号的提醒同理：是告诉原负责人「某某撞了你的客户」，客户转给触发人后跟过去就成了「你撞了你自己」（11-04 线上）；
 * 离职交接例外：接手人接的是原负责人的位置，撞号还得有人核对，跟着交过去
 */
export function 不跟着转的提醒(kind: 换负责人种类): Prisma.TaskWhereInput[] {
  return [收回提醒尾, 旧收回提醒尾, ...(kind === "deactivate" ? [] : [撞号提醒尾])].map((尾) => ({ NOT: { title: { endsWith: 尾 } } }));
}

/**
 * 带走并记下 里一位客户的那一段，放在调用方自己的事务里做（市场分给销售时客户和项目在同一笔事务里换人；事务里不能再开事务）。
 * 调用方自己管限定（要转哪几条由条件定，不靠限定）。调用前客户要已经归 新（带走公海项目 按这个认）。
 *
 * 旧 可能是占位账号（公海里的客户，M-公海-03）：活都还在进公海前那位名下，按 公海前负责人 找；换负责人记录照旧记 旧 → 新。
 * 项目（企业版）：
 *   kind = assign（转客户）：名下全部，含同事负责的、线索公海里的（P-转-07）；
 *   claim / pool-assign（从客户公海领 / 分）：进公海前负责人自己的；线索公海里的由调用方 领客户带走公海项目 带（M-公海-05）；
 *   deactivate（离职转交）：照旧只带他自己的（规划第二节「不改的」）
 * 留下待办计划（只有市场首次分给销售传，X-18 / P-转-10）：原负责人的待办、计划不搬、不关，还归他；
 * 客户负责人、项目、公海项目、联系人（跟客户走）、进行中的商机照走。别的入口不传，照旧带活
 * 项目痕（同样只有市场首次分给销售传）：被带走的项目那行转让痕记这一句，「我分出去的」按它认
 */
export async function 带走一位(tx: Prisma.TransactionClient, customerId: string, 旧: string, 新: string, 操作人: string, kind: 换负责人种类, 带项目 = true, 选项: { 留下待办计划?: boolean; 项目痕?: string } = {}) {
  const 实际旧 = 企业版() ? await 公海前负责人(tx, customerId, 旧) : 旧;
  const 留下 = 选项.留下待办计划 === true;
  const 计划 = 留下 ? [] : (await tx.followPlan.findMany({ where: { customerId, ownerId: 实际旧, done: false }, select: { id: true } })).map((x) => x.id);
  const 待办 = 留下 ? [] : (await tx.task.findMany({ where: { customerId, ownerId: 实际旧, done: false, AND: 不跟着转的提醒(kind) }, select: { id: true } })).map((x) => x.id);
  const 商机 = (await tx.opportunity.findMany({ where: { customerId, ownerId: 实际旧, status: "OPEN" }, select: { id: true } })).map((x) => x.id);
  if (计划.length) await tx.followPlan.updateMany({ where: { id: { in: 计划 } }, data: { ownerId: 新 } });
  if (待办.length) await tx.task.updateMany({ where: { id: { in: 待办 } }, data: { ownerId: 新 } });
  if (商机.length) await 转交商机(tx, { id: { in: 商机 } }, 新);
  const 转客户 = 企业版() && kind === "assign";
  // 带项目=false：没开项目模式的离职交接只交客户，不改项目（11-03 B7-2）
  const 项目 = 带项目 ? await 转项目(tx, 转客户 ? 跟着客户转的项目(customerId) : 跟着客户转的项目(customerId, 实际旧), 新, 操作人, true, 选项.项目痕 ?? null) : [];
  const 公海项目 = 带项目 && 转客户 ? await 带走公海项目(tx, [customerId], 新, 操作人, undefined, 选项.项目痕 ?? null) : [];
  await 记换负责人(tx, [{ customerId, from: 旧, to: 新 }], 操作人, kind);
  return { 计划, 待办, 商机, 项目, 公海项目 };
}

/**
 * 同一笔事务里：这几位客户（已经归 新）名下还在线索公海里的项目一起归 新——负责人改成 新、出公海、清下一步，
 * 每个记一行 pool-claim（同单独领项目）。不在公海里的不碰（那些归谁由 带走一位 管）。
 * 带待办：每个项目进公海时关掉的那批待办照勾重新打开（carry-tasks.ts），几条写进各自那行 pool-claim
 */
export async function 带走公海项目(tx: Prisma.TransactionClient, customerIds: string[], 新: string, 操作人: string, 带待办?: boolean, 痕说明: string | null = null): Promise<string[]> {
  // 只认现在真归 新 的客户：领的事务和这里之间又被人改给了别人的不带
  // 带否定条件 Prisma 不会自己拆批，一次分过 999 位客户报 P2029（11-03 B2-3）：500 位一批查
  const 们 = [];
  for (let i = 0; i < customerIds.length; i += 500) {
    们.push(...(await tx.project.findMany({
      where: { customerId: { in: customerIds.slice(i, i + 500) }, pooledAt: { not: null }, customer: { salesOwnerId: 新 } },
      select: { id: true, ownerId: true, phase: true, node: true, result: true, customerId: true, name: true, pooledAt: true },
    })));
  }
  if (!们.length) return [];
  const ids = 们.map((p) => p.id);
  await tx.project.updateMany({ where: { id: { in: ids } }, data: { ownerId: 新, pooledAt: null, nextStepAt: null, nextStepText: null } });
  // 公海里的项目 ownerId 是空的（企业版进公海清负责人）：从谁 记留痕里的历史负责人
  const 原 = await 历史负责人们(tx, ids);
  const 痕: Map<string, string | null> = new Map();
  for (const p of 们) 痕.set(p.id, 待办痕(带待办, await 换负责人待办(tx, p, 原.get(p.id) ?? null, 新, 带待办)));
  await tx.projectNodeLog.createMany({ data: 们.map((p) => 转让痕(p, 操作人, 原.get(p.id) ?? (p.ownerId || null), 新, "pool-claim", 接上待办痕(痕说明, 痕.get(p.id) ?? null))) });
  // B5：历史负责人没完成的卡点认领行给领走的人（同单独领项目走 记转让）
  for (const p of 们) {
    const 从 = 原.get(p.id) ?? p.ownerId;
    if (从) await 卡点随项目换人(tx, p.id, 从, 新, 操作人, 公海领走接手理由);
  }
  return ids;
}
