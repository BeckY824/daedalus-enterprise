import type { Prisma } from "@/generated/prisma";
import { 转交商机 } from "@/lib/opportunity-activity";
import { prisma } from "@/lib/prisma";
import { 记转让, 转让痕, 收回提醒尾, 旧收回提醒尾, 将回收提醒跟着换人, 算持有的项目 } from "@/lib/project/db";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";
import { 卡点随项目换人, 转让接手理由 } from "@/lib/project/blocker";
import { 记换负责人, 公海前负责人, type 换负责人种类 } from "@/lib/owner-log-db";
import { 历史负责人们 } from "@/lib/project/pool-owner";
import { 公海领走接手理由 } from "@/lib/project/blocker";
import { 换负责人待办, 待办痕, 接上待办痕 } from "@/lib/project/carry-tasks";
import { 撞号提醒尾 } from "@/lib/enterprise/contact-format";
import { 预览列几个, type 带走数, type 转走项目预览 } from "@/lib/carry-over";
import { 权限组织, type 组织 } from "@/lib/enterprise/org";
import { 算市场转客户, 市场转一位, 客户层分配方式 } from "@/lib/enterprise/market-transfer";
import { 同事待分配随客户通知, type 留下的活, type 同事待分配条 } from "@/lib/enterprise/notice-sources";
import { 停用的同事 } from "@/lib/offboard-db";
import { 换负责人, 还负责人 } from "@/lib/project/owner-write";

/**
 * 客户换了销售负责人，原负责人在他身上**没做完的活**跟着走（2026-10-02 排查 B3）：
 * 没完成的计划、待办，进行中的商机。原来不跟：客户转给李四以后，到点提醒、早报还发给张三，李四收不到。
 * 只动原负责人名下的——别的同事挂在这位客户上的活不碰；做完的、赢单丢单的是历史，不动。
 * 项目（团队版项目模式）不一样，见 跟着客户转的项目：团队版整体转；企业版见 带走一位（转客户连同事在推的一起带，P-转-07）。
 */
export async function 带走没做完的(换: { customerId: string; 旧: string }[], 新: string, 操作人?: string): Promise<带走数> {
  return (await 带走并记下(换, 新, 操作人)).数;
}

/**
 * 客户换人时，哪些项目跟着走（团队版项目模式 1a，2026-10-23 定「整体转」）：这位客户名下的项目
 * 不管原来是谁负责的，都连同客户一起转给新负责人；只有放在项目公海里的不动（等人领）。
 * 企业版传 旧：这一条只管他自己负责的；转客户时公海里的另走 带走公海项目，同事负责的（待分配的、在推的）见 带走一位（P-转-07）
 */
export function 跟着客户转的项目(customerId: string, 旧?: string): Prisma.ProjectWhereInput {
  return 企业版() && 旧 !== undefined ? { customerId, pooledAt: null, ownerId: 旧 } : { customerId, pooledAt: null };
}

/**
 * 转客户时一起带走的同事在推项目（企业版 P-转-07，Even 规格书 11-08 决策一，用户 11-10「统一以 Even 的口径为准」）：
 * 没进公海、不在待分配（待分配的另走一段，要清待分配）、没结局、负责人不是客户原负责人也不是接手人。
 * 已有结局的同事项目是历史（签约、流失算在同事头上），不动
 */
export function 同事在推的项目(customerId: string, 主人: string, 新: string): Prisma.ProjectWhereInput {
  return { customerId, pooledAt: null, awaitAssignAt: null, result: null, ownerId: { notIn: [主人, 新, ""] } };
}

/**
 * 转之前先数一数会一起转走哪些项目（企业版 D-36「转之前先列出会一起转走的 N 个项目」，2026-10-24；P-转-07 Even 口径）。
 * 条件和真转的一样，数出来的就是转完说的那个数：线索公海里的 + 原负责人（公海里的客户：进公海前负责人）自己的；
 * 不在公海的客户再加同事负责、正在待分配的；再加同事在推的（同事在推的项目，见 带走一位）。
 * 项目数是全部；公海里的、待分配的在预览里写明，同事在推的不列名字、只另给 同事 个数（Even C4，X-49 待定）。
 * 客户按调用方能看到的算（限定着查，看不到的本来也转不了）；项目看全部：同事负责的也得列出来
 */
export async function 数转走的项目(ids: string[], 新: string, 除了: string[] = []): Promise<转走项目预览> {
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
    const 同事条件: Prisma.ProjectWhereInput[] = [];
    const 主 = new Map<string, string>();
    for (const c of 换人的) {
      const 主人 = await 公海前负责人(prisma, c.id, c.salesOwnerId);
      主.set(c.id, 主人);
      条件.push({ customerId: c.id, pooledAt: { not: null } }, { customerId: c.id, pooledAt: null, ownerId: 主人 });
      if (!c.pool) 条件.push({ customerId: c.id, pooledAt: null, awaitAssignAt: { not: null } });
      同事条件.push(同事在推的项目(c.id, 主人, 新));
    }
    const 没选中 = 除了.length ? [{ id: { notIn: 除了 } }] : [];
    // 新 是空串 = 接手人还没挑（批量自动分配）；线索公海里的 ownerId 也是空串，不能拿它排除
    const where: Prisma.ProjectWhereInput = { AND: [{ OR: 条件 }, ...(新 ? [{ ownerId: { not: 新 } }] : []), ...没选中] };
    const 同事where: Prisma.ProjectWhereInput = { AND: [{ OR: 同事条件 }, ...没选中] };
    const 列 = { orderBy: { createdAt: "asc" as const }, take: 预览列几个 };
    const [列名的数, 们, 同事数] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({ where, ...列, select: { name: true, ownerId: true, pooledAt: true, customerId: true, customer: { select: { name: true } } } }),
      prisma.project.count({ where: 同事where }),
    ]);
    const 预: 转走项目预览 = {
      项目数: 列名的数 + 同事数,
      项目: 们.map((p) => {
        // 客户负责人自己的不用写；公海里的写「线索公海」，同事占着、待分配的写「待分配」（P-转-07：转之前列清楚）
        const 负责人 = p.pooledAt ? "线索公海" : p.ownerId && p.ownerId !== 主.get(p.customerId) ? "待分配" : "";
        return { name: p.name, 客户: p.customer.name, ...(负责人 ? { 负责人 } : {}) };
      }),
    };
    // 同事在推的只给个数，不回名字和负责人（Even C4，见 同事项目几个话）
    return 同事数 ? { ...预, 同事: { 项目数: 同事数 } } : 预;
  });
}

/**
 * 转 / 领这几位客户时，会新进 新 手上、算持有的项目有几个（M-公海-18 拦持有上限用，算法同 持有数：线索 / 商机阶段、没结局、不在公海、不在待分配）。
 * 条件同真转（带走一位、带走公海项目），哪几样算由调用方挑：
 *   公海：名下在线索公海里的（领 / 分公海客户、转客户都带走）；
 *   自己的：原负责人（公海里的客户：进公海前负责人）自己的，含他自己占着待分配的（跟着客户转并清待分配，P-转-20；直接转原来就不拦，只有确认交接、离职交接算）；
 *   同事待分配：不在公海的客户上别人占着、正在待分配的（转客户时随客户给 新 并清待分配，= 接待分配；新 自己占着的清了也开始算）；
 *   停用同事：不在公海的客户上已停用同事负责、不在待分配的（离职交接随客户给接手人，P-转-18）；
 *   同事在推：不在公海的客户上同事在推的（同事在推的项目；转客户随客户给 新，P-转-07 Even 口径，确认交接算）。
 * 除了：不数的项目（分项目给时手上这个另按 1 个算）。db：事务里调传 tx（事务占着唯一连接），默认全局连接。
 * 不是企业版回 0
 */
export async function 数进手的持有项目(
  ids: string[],
  新: string,
  算: { 公海?: boolean; 自己的?: boolean; 同事待分配?: boolean; 停用同事?: boolean; 同事在推?: boolean; 除了?: string[] },
  db: Pick<Prisma.TransactionClient, "customer" | "project" | "customerOwnerLog" | "user"> = prisma,
): Promise<number> {
  if (!企业版() || !ids.length) return 0;
  return 看全部(async () => {
    const 们 = await db.customer.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
    const 条件: Prisma.ProjectWhereInput[] = [];
    const 停用 = 算.停用同事 ? await 停用的同事(db, [新]) : [];
    for (const c of 们) {
      if (算.公海) 条件.push({ customerId: c.id, pooledAt: { not: null } });
      if (c.salesOwnerId === 新 || !(算.自己的 || 算.同事待分配 || 算.同事在推 || 停用.length)) continue;
      const 主人 = await 公海前负责人(db, c.id, c.salesOwnerId);
      if (算.自己的 && 主人 !== 新) 条件.push({ customerId: c.id, pooledAt: null, ownerId: 主人 });
      if (算.同事待分配 && !c.pool) 条件.push({ customerId: c.id, pooledAt: null, awaitAssignAt: { not: null }, ownerId: { notIn: [主人, ""] } });
      if (算.同事在推 && !c.pool) 条件.push(同事在推的项目(c.id, 主人, 新));
      const 别的停用 = 停用.filter((u) => u !== 主人);
      if (别的停用.length && !c.pool) 条件.push({ customerId: c.id, pooledAt: null, awaitAssignAt: null, ownerId: { in: 别的停用 } });
    }
    if (!条件.length) return 0;
    const 除了 = 算.除了?.length ? [{ id: { notIn: 算.除了 } }] : [];
    return db.project.count({ where: { AND: [{ OR: 条件 }, 算持有的项目, ...除了] } });
  });
}

/**
 * 市场首次分给销售（X-18）之前要不要先说一句（P-转-07）：这几位客户里，名下有会一起转走的同事项目的（不是客户负责人、不是接手人、不是本次选中的、不在公海、没结局），
 * 才列他们会一起转走的项目（同客户页的预览，除了本次选中的；同事在推的只给个数）；都没有 = 0 个，不弹。接手人没挑（批量自动分配）传空串。调用方先判好 X-18、放开范围
 */
export async function 分配带走的同事项目(客户们: { id: string; salesOwnerId: string }[], 接手人: string, 选中: string[]): Promise<转走项目预览> {
  if (!客户们.length) return { 项目数: 0, 项目: [] };
  const 有同事的 = await prisma.project.findMany({
    where: { id: { notIn: 选中 }, OR: 客户们.map((c) => ({ customerId: c.id, pooledAt: null, result: null, ownerId: { notIn: ["", c.salesOwnerId, ...(接手人 ? [接手人] : [])] } })) },
    distinct: ["customerId"], select: { customerId: true },
  });
  return 数转走的项目(有同事的.map((p) => p.customerId), 接手人, 选中);
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
  await tx.project.updateMany({ where: { id: { in: ids } }, data: { ...换负责人(新), ...(企业版() ? {} : { nextStepAt: null, nextStepText: null }) } });
  for (const p of 们) await 将回收提醒跟着换人(tx, p, p.ownerId || null, 新);
  await tx.projectNodeLog.createMany({ data: 们.map((p) => 转让痕(p, 操作人, p.ownerId, 新, "transfer", 痕说明)) });
  if (卡点跟着) for (const p of 们) if (p.ownerId) await 卡点随项目换人(tx, p.id, p.ownerId, 新, 操作人, 转让接手理由);
  return ids;
}

/**
 * 撤销时把带过来的项目还回去：只还「还在这位客户下、还归现负责人、没进公海」的。
 * 同事负责、正在待分配的也会被带走，所以各还各的：按这个项目最近一行「转给现负责人」的转让痕还给当时的负责人，
 * 找不到痕的（老数据）还给客户原负责人。
 * 企业版按原样回滚（P-撤销-01）：被撤的那行转让痕删掉，不另记一行；卡点认领行照样还回去
 */
export async function 还项目(tx: Prisma.TransactionClient, ids: string[] | undefined, customerId: string | string[], 现: string, 原: string, 操作人: string) {
  if (!ids?.length) return;
  const 客户 = typeof customerId === "string" ? [customerId] : customerId;
  const 们 = await tx.project.findMany({ where: { id: { in: ids }, customerId: { in: 客户 }, ownerId: 现, pooledAt: null }, select: { id: true, phase: true, node: true, result: true } });
  if (!们.length) return;
  // 转让痕一次查齐，每个项目取最近那行；项目按还给谁分组一次改（原来逐个查、逐个改，一批 N 位客户 × M 个项目）
  const 痕们 = await tx.projectNodeLog.findMany({ where: { projectId: { in: 们.map((p) => p.id) }, kind: "transfer", toOwnerId: 现 }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { id: true, projectId: true, fromOwnerId: true } });
  const 痕of = new Map<string, (typeof 痕们)[number]>();
  for (const l of 痕们) if (!痕of.has(l.projectId)) 痕of.set(l.projectId, l);
  const 组 = new Map<string, typeof 们>();
  for (const p of 们) {
    const 还给 = 痕of.get(p.id)?.fromOwnerId ?? 原;
    if (还给 !== 现) 组.set(还给, [...(组.get(还给) ?? []), p]);
  }
  for (const [还给, ps] of 组) {
    await tx.project.updateMany({ where: { id: { in: ps.map((p) => p.id) } }, data: 还负责人(还给) });
    if (企业版()) for (const p of ps) await 卡点随项目换人(tx, p.id, 现, 还给, 操作人, 转让接手理由);
    else for (const p of ps) await 记转让(tx, p, 操作人, 现, 还给);
  }
  if (企业版()) {
    const 删 = [...组.values()].flat().flatMap((p) => { const l = 痕of.get(p.id); return l ? [l.id] : []; });
    if (删.length) await tx.projectNodeLog.deleteMany({ where: { id: { in: 删 } } });
  }
}

/**
 * 企业版撤销转客户之前核对（P-撤销-01 按原样回滚，不半撤）：带过来的每一条都还得是转过去时的样子——
 * 还在这几位客户下、还归 新：计划 / 待办没做完，商机还在谈，项目没进公海；市场转给销售清掉的待分配还空着、补上的分配方式还是那一格。
 * 被删了、被人改走了、做完了都算对不上。回对不上几条；0 = 都对得上
 */
export async function 带过来对不上(tx: Prisma.TransactionClient, 带过来: 带走的, customerIds: string[], 新: string): Promise<number> {
  const 客户 = { in: customerIds };
  const 数 = async (ids: string[] | undefined, 查: (ids: string[]) => Promise<number>) => {
    const 去重 = [...new Set((ids ?? []).filter((x) => typeof x === "string"))];
    return 去重.length ? 去重.length - (await 查(去重)) : 0;
  };
  const 差 = await Promise.all([
    数(带过来.计划, (ids) => tx.followPlan.count({ where: { id: { in: ids }, customerId: 客户, ownerId: 新, done: false } })),
    数(带过来.待办, (ids) => tx.task.count({ where: { id: { in: ids }, customerId: 客户, ownerId: 新, done: false } })),
    数(带过来.商机, (ids) => tx.opportunity.count({ where: { id: { in: ids }, customerId: 客户, ownerId: 新, status: "OPEN" } })),
    数([...(带过来.项目 ?? []), ...(带过来.公海项目 ?? [])], (ids) => tx.project.count({ where: { id: { in: ids }, customerId: 客户, ownerId: 新, pooledAt: null } })),
    数(带过来.清待分配?.map((x) => x.id), (ids) => tx.project.count({ where: { id: { in: ids }, customerId: 客户, ownerId: 新, pooledAt: null, result: null, awaitAssignAt: null } })),
    数(带过来.补方式, (ids) => tx.project.count({ where: { id: { in: ids }, customerId: 客户, ownerId: 新, assignMode: 客户层分配方式 } })),
  ]);
  return 差.reduce((a, b) => a + b, 0);
}

/** 转走的是哪几条（撤销时只还这几条，不碰「转之前就归新负责人」的那些——0.46.15 公海复查）。项目可能没有：老版本撤销条上带回来的没这一项 */
export type 带走的 = {
  计划: string[]; 待办: string[]; 商机: string[]; 项目?: string[]; 公海项目?: string[];
  /** 市场转给销售时清掉的待分配（项目 id、原来的时刻）、补上分配方式的项目：撤销按原样还 */
  清待分配?: { id: string; at: string }[]; 补方式?: string[];
};

/**
 * 同 带走没做完的，另外返回转走的那几条的 id。操作人记在项目的转让痕上，不给就记新负责人。
 * 同一个事务里记一行换负责人（kind 分得出是改负责人、公海领取还是公海分配，见 owner-log-db.ts）
 * kind = assign 是客户层转让（批量转、确认交接、客户页改负责人）：企业版里算市场转客户的走 市场转一位，
 * 结果和项目分配入口一样，待办、计划不搬（X-45 / P-转-10），别的照旧带活。要在换负责人之前就定好的只有 旧，由调用方传。
 * 调用方是先改负责人、再调这里，两步不在一笔事务：市场转客户这一段进事务后再核对客户还归 新，
 * 中间被别人改走（或进了公海）的什么都不动、不记撤销数据，算没转成，id 回在 没转成、个数回在 数.没转成，调用方别按转成了通知和计数。
 * 留下：真按市场转客户转成的那几位，待办、计划还在原负责人名下，分配 / 交接通知据此写条数（P-转-10）；只给通知用，不回浏览器
 */
export async function 带走并记下(换: { customerId: string; 旧: string }[], 新: string, 操作人: string = 新, kind: 换负责人种类 = "assign"): Promise<{ 数: 带走数; 记下: 带走的; 没转成: string[]; 留下: 留下的活[] }> {
  const 攒 = 新攒();
  // 事务外读：事务占着库的唯一连接，事务里读组织会等到超时
  const org = kind === "assign" && 换.length ? await 权限组织() : null;
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
    攒进(攒, customerId, 旧, await 看全部(() => prisma.$transaction((tx) => 带走一位分市场(tx, customerId, 旧, 新, 操作人, kind, org))));
  }
  // 转客户带走了同事的项目（待分配的、在推的）：告诉这位同事（P-转-19）。事务都提交了才发，发不出去不影响转让
  if (攒.同事待分配.length) await 同事待分配随客户通知(操作人, 新, 攒.同事待分配);
  return { 数: 攒.数, 记下: 攒.记下, 没转成: 攒.没转成, 留下: 攒.留下 };
}

/**
 * 同 带走并记下，但在调用方的事务里一次做完：持有上限整批核要和改负责人在同一个事务里（M-公海-18，11-10 公海领取 / 分配；
 * 11-11 起确认转让交接、直接转客户也走这里）。客户负责人调用方已经在这个事务里改成 新。
 * kind = assign（转客户）要算市场转客户的，org 由调用方在事务外读好传进来（事务里读组织会等到超时）；没传 = 不走市场转客户那一支。
 * 不发通知：同事待分配 回给调用方，事务提交了再发（同事待分配随客户通知），回滚了就不发
 */
export async function 带走并记下在事务里(
  tx: Prisma.TransactionClient, 换: { customerId: string; 旧: string }[], 新: string, 操作人: string, kind: 换负责人种类, org: 组织 | null = null,
): Promise<{ 数: 带走数; 记下: 带走的; 没转成: string[]; 留下: 留下的活[]; 同事待分配: 同事待分配条[] }> {
  const 攒 = 新攒();
  for (const { customerId, 旧 } of 换) {
    if (旧 === 新) continue;
    攒进(攒, customerId, 旧, await 看全部(() => 带走一位分市场(tx, customerId, 旧, 新, 操作人, kind, kind === "assign" ? org : null)));
  }
  return 攒;
}

type 这位带走的 = 带走的 & { 项目: string[]; 公海项目: string[]; 留在原负责人?: boolean; 同事待分配?: 同事待分配条[] };

/**
 * 一位客户（已经归 新）名下的活跟着走。kind = assign 时企业版里算市场转客户的走 市场转一位（结果和项目分配入口一样，待办、计划不搬，X-45 / P-转-10），
 * 进来先核对客户还归 新：中间被别人改走（或进了公海）的什么都不动，回 null = 没转成
 */
async function 带走一位分市场(tx: Prisma.TransactionClient, customerId: string, 旧: string, 新: string, 操作人: string, kind: 换负责人种类, org: 组织 | null): Promise<这位带走的 | null> {
  if (org && 算市场转客户(org, { salesOwnerId: 旧, pool: null }, 新)) {
    const 现在 = await tx.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    if (现在?.salesOwnerId !== 新) return null;
    if (!现在.pool) return { ...(await 市场转一位(tx, customerId, 旧, 新, 操作人, 客户层分配方式)), 留在原负责人: true };
  }
  return 带走一位(tx, customerId, 旧, 新, 操作人, kind);
}

type 攒着 = { 数: 带走数; 记下: 带走的; 没转成: string[]; 留下: 留下的活[]; 同事待分配: 同事待分配条[] };

function 新攒(): 攒着 {
  return { 数: { 计划和待办: 0, 商机: 0, 项目: 0 }, 记下: { 计划: [], 待办: [], 商机: [], 项目: [], 公海项目: [] }, 没转成: [], 留下: [], 同事待分配: [] };
}

function 攒进(攒: 攒着, customerId: string, 旧: string, 这位: 这位带走的 | null): void {
  const { 数, 记下 } = 攒;
  if (!这位) {
    攒.没转成.push(customerId);
    数.没转成 = 攒.没转成.length;
    return;
  }
  if (这位.留在原负责人) 攒.留下.push({ customerId, 原: 旧 });
  攒.同事待分配.push(...(这位.同事待分配 ?? []));
  if (这位.清待分配?.length) (记下.清待分配 ??= []).push(...这位.清待分配);
  if (这位.补方式?.length) (记下.补方式 ??= []).push(...这位.补方式);
  数.计划和待办 += 这位.计划.length + 这位.待办.length;
  数.商机 += 这位.商机.length;
  数.项目 = (数.项目 ?? 0) + 这位.项目.length + 这位.公海项目.length;
  记下.项目!.push(...这位.项目);
  记下.公海项目!.push(...这位.公海项目);
  记下.计划.push(...这位.计划);
  记下.待办.push(...这位.待办);
  记下.商机.push(...这位.商机);
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
 *   都带原负责人自己的；
 *   kind = assign（转客户，含市场首次分给销售）：再加线索公海里的，和同事在推的（同事在推的项目：没结局、不在待分配；P-转-07 Even 口径，
 *     用户 11-10 定统一按 Even），撤销按转让痕还回各自的同事；已有结局的同事项目不动；
 *   assign、deactivate（离职转交）：再加同事负责、正在待分配的（建的人只是占着那一格），随客户给接手人并清待分配，撤销按 清待分配 还；
 *     原负责人自己占着待分配的，跟着转后同样清待分配（P-转-20），撤销同样按 清待分配 还；
 *   deactivate：再加已停用同事负责、没结局的（P-转-18，11-09 定），接手人再定继续还是放回公海；
 *   claim / pool-assign（从客户公海领 / 分）：线索公海里的由调用方 领客户带走公海项目 带（M-公海-05）；
 * 留下待办计划（只有市场转给销售传，X-18 / X-45 / P-转-10）：原负责人的待办、计划不搬、不关，还归他；
 * 客户负责人、项目、公海项目、联系人（跟客户走）、进行中的商机照走。别的入口不传，照旧带活
 * 项目痕（同样只有市场转给销售传）：被带走的项目那行转让痕记这一句，「我分出去的」按它认
 * 记录种类（同样只有市场转给销售传 market-assign）：换负责人记录记成「分配」、不算转客户（P-转-03、P-公海-11）；带什么照 kind
 */
export async function 带走一位(tx: Prisma.TransactionClient, customerId: string, 旧: string, 新: string, 操作人: string, kind: 换负责人种类, 带项目 = true, 选项: { 留下待办计划?: boolean; 项目痕?: string; 记录种类?: 换负责人种类 } = {}) {
  const 实际旧 = 企业版() ? await 公海前负责人(tx, customerId, 旧) : 旧;
  const 留下 = 选项.留下待办计划 === true;
  const 计划 = 留下 ? [] : (await tx.followPlan.findMany({ where: { customerId, ownerId: 实际旧, done: false }, select: { id: true } })).map((x) => x.id);
  const 待办 = 留下 ? [] : (await tx.task.findMany({ where: { customerId, ownerId: 实际旧, done: false, AND: 不跟着转的提醒(kind) }, select: { id: true } })).map((x) => x.id);
  const 商机 = (await tx.opportunity.findMany({ where: { customerId, ownerId: 实际旧, status: "OPEN" }, select: { id: true } })).map((x) => x.id);
  if (计划.length) await tx.followPlan.updateMany({ where: { id: { in: 计划 } }, data: { ownerId: 新 } });
  if (待办.length) await tx.task.updateMany({ where: { id: { in: 待办 } }, data: { ownerId: 新 } });
  if (商机.length) await 转交商机(tx, { id: { in: 商机 } }, 新);
  const 转客户 = 企业版() && kind === "assign";
  const 项目痕 = 选项.项目痕 ?? null;
  // 同事负责、正在待分配的（用户 11-09 定）：先查（原负责人自己的转完也归 新，不能混进来）；转项目 跳过接手人自己占着的，那些只清状态
  const 待分配 = 带项目 && 企业版() && (kind === "assign" || kind === "deactivate")
    ? await tx.project.findMany({ where: { customerId, pooledAt: null, awaitAssignAt: { not: null }, ownerId: { notIn: [实际旧, ""] } }, select: { id: true, awaitAssignAt: true, ownerId: true } })
    : [];
  // 同事在推的（转客户才带）：先查出各自负责人，事务提交后通知（P-转-19）
  const 在推 = 带项目 && 转客户 ? await tx.project.findMany({ where: 同事在推的项目(customerId, 实际旧, 新), select: { id: true, ownerId: true } }) : [];
  // 原负责人自己占着、正在待分配的（P-转-20、X-68 / X-84）：转项目 之前查（转完负责人就是 新 了），跟着下面一起转，转了的清待分配；
  // 不发同事通知（是他自己的），撤销按 清待分配 还。有结局的不碰（撤销核对和 还待分配状态 只认没结局的）
  const 自己待分配 = 带项目 && 企业版() && (kind === "assign" || kind === "deactivate") && 实际旧 && 实际旧 !== 新
    ? await tx.project.findMany({ where: { customerId, pooledAt: null, result: null, awaitAssignAt: { not: null }, ownerId: 实际旧 }, select: { id: true, awaitAssignAt: true } })
    : [];
  // 带项目=false：没开项目模式的离职交接只交客户，不改项目（11-03 B7-2）
  const 项目 = 带项目 ? await 转项目(tx, 跟着客户转的项目(customerId, 实际旧), 新, 操作人, true, 项目痕) : [];
  // 转项目 换负责人时已清待分配（owner-write.ts 换负责人，P-转-21）；这里只记下转了哪几个、原来的时刻，撤销按 清待分配 还
  const 清自己的 = 自己待分配.filter((p) => 项目.includes(p.id));
  const 同事在推 = 在推.length ? await 转项目(tx, { id: { in: 在推.map((p) => p.id) } }, 新, 操作人, true, 项目痕) : [];
  const 公海项目 = 带项目 && 转客户 ? await 带走公海项目(tx, [customerId], 新, 操作人, undefined, 项目痕) : [];
  const 同事待分配 = 待分配.length ? await 转项目(tx, { id: { in: 待分配.map((p) => p.id) } }, 新, 操作人, true, 项目痕) : [];
  if (待分配.length) await tx.project.updateMany({ where: { id: { in: 待分配.map((p) => p.id) } }, data: { awaitAssignAt: null } });
  const 停用 = 带项目 && 企业版() && kind === "deactivate" ? await 停用的同事(tx, [实际旧, 新]) : [];
  const 停用同事 = 停用.length
    ? await 转项目(tx, { customerId, pooledAt: null, result: null, awaitAssignAt: null, ownerId: { in: 停用 } }, 新, 操作人, true, 项目痕)
    : [];
  await 记换负责人(tx, [{ customerId, from: 旧, to: 新 }], 操作人, 选项.记录种类 ?? kind);
  return {
    计划, 待办, 商机, 项目: [...项目, ...同事待分配, ...同事在推, ...停用同事], 公海项目, 清待分配: [...待分配, ...清自己的].map((p) => ({ id: p.id, at: p.awaitAssignAt!.toISOString() })),
    // 随客户换了负责人的同事项目（待分配的 + 在推的）：事务提交后通知各自的同事（P-转-19）；接手人自己占着的只清了状态，不算
    同事待分配: [
      ...待分配.filter((p) => p.ownerId !== 新).map((p): 同事待分配条 => ({ id: p.id, 原: p.ownerId, customerId })),
      ...在推.filter((p) => 同事在推.includes(p.id)).map((p): 同事待分配条 => ({ id: p.id, 原: p.ownerId, customerId, 在推: true })),
    ],
  };
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
  await tx.project.updateMany({ where: { id: { in: ids } }, data: { ...换负责人(新), pooledAt: null, nextStepAt: null, nextStepText: null } });
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
