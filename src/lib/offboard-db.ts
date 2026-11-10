import type { Prisma } from "@/generated/prisma";
import { 不掉公海的状态, 无负责人占位邮箱 } from "@/lib/pool";
import { 能进公海的阶段, 算持有的项目 } from "@/lib/project/db";
import { 有同事在推的客户 } from "@/lib/enterprise/colleague-projects";
import { 公海客户原负责人是 } from "@/lib/owner-log-db";

/**
 * 停用成员（离职交接，企业版 D-36，2026-10-24）：他名下的东西怎么分。停用前的清点、停用本身都按这一处分，
 * 界面上说「会转走几位、放进公海几位」和真做的对得上。
 *
 * 两种方式，默认「转交」（和原来一样，不选就不变）：
 *   转交 —— 客户、进行中的商机、没做完的计划待办、线索、渠道全给接手人；客户名下的项目跟着走
 *           （企业版只带他负责的；在职同事负责的留在同事名下，同事待分配的随客户给接手人，同 P-转-07，11-09）
 *   公海 —— 客户放进客户公海（负责人清空、他记历史，M-公海-03，谁领了谁接，领的时候他没做完的活跟着领的人走，同手动放公海），
 *           他自己负责的线索 / 商机项目一起进线索公海（离职放进公海）；他负责、挂在别人客户上的线索 / 商机阶段项目放回线索公海；
 *           线索、渠道、不在这些客户上的活照样给接手人
 *
 * 公海方式下仍然给接手人的客户：
 *   - 已签约、已流失（不掉公海的状态，同自动掉公海）
 *   - 名下有订单阶段项目的：订单阶段的项目不能放公海，只能给接手人（D-36），
 *     客户进了公海、别人一领就会把这个项目整体带走，所以客户也跟着项目给接手人
 *   - 名下有同事负责、还没结束的项目的（M-公海-02 例外二，11-05）：这类客户不进公海
 *
 * 不管哪种方式，他负责、挂在别人客户上的项目也一起处理（原来不动，要老板一个个手动转）——
 * 一次处理完一个人名下全部。只动没结局的；有结局的是历史，同赢单丢单的商机，留在他名下
 *
 * 这两样（公海方式、别处的项目）只企业版有：企业 = false 时只按原来的转交分（项目只跟着转走的客户走），
 * 调用方传 企业版()，这里不读环境变量，方便测
 */
export type 停用方式 = "转交" | "公海";
export const 停用方式们: readonly 停用方式[] = ["转交", "公海"];

export const 停用进公海理由 = "成员停用，放进公海";
export const 停用项目进公海理由 = "成员停用，放回项目公海";
/** P-删-06：从回收站恢复（或查重捞回）客户时原负责人已停用，没有接手人，清空负责人进客户公海；名下他自己的线索 / 商机项目的 pool-release 也记这句 */
export const 恢复进公海理由 = "成员停用，从回收站恢复时放进公海";

export type 停用分拣结果 = {
  /** 负责人改成接手人的客户 */
  客户: string[];
  /** 新放进客户公海的（公海方式） */
  进公海客户: string[];
  /** 本来就在公海里、这次不动的（企业版两种方式都算：负责人是他的老数据 + 最近一次进公海时负责人是他的） */
  本来在公海: string[];
  商机: string[];
  待办: string[];
  计划: string[];
  线索: string[];
  渠道: string[];
  /** 转给接手人的项目：转走的客户上他负责的（企业版；同事负责的留下，待分配的除外）+ 他负责、挂在别处、没结局的 */
  项目: string[];
  /** 项目 里同事负责、正在待分配的（用户 11-09 定）：随客户给接手人并清待分配 */
  清待分配: string[];
  /** 项目 里已停用同事负责、没结局、不在待分配的（P-转-18，11-09 定）：随客户给接手人，接手人再定继续还是放回公海 */
  停用同事: string[];
  /** 放回项目公海的（公海方式） */
  进公海项目: string[];
  /** 公海方式下因为订单阶段只能给接手人的项目数（界面提示用；转交方式为 0） */
  订单项目: number;
};

type 读库 = Pick<Prisma.TransactionClient, "customer" | "opportunity" | "task" | "followPlan" | "lead" | "channel" | "project" | "user" | "customerOwnerLog">;

/**
 * 已停用的同事（不含占位账号、不含 除了 里的人）：他们负责、挂在要转走的客户上的进行中项目随客户给接手人（P-转-18，11-09 定），
 * 不然项目留在停用账号名下没人管。有结局的是历史，不动
 */
export async function 停用的同事(db: Pick<Prisma.TransactionClient, "user">, 除了: string[]): Promise<string[]> {
  return (await db.user.findMany({ where: { active: false, id: { notIn: 除了 }, email: { not: 无负责人占位邮箱 } }, select: { id: true } })).map((u) => u.id);
}

export async function 停用分拣(db: 读库, id: string, 方式: 停用方式, 企业: boolean): Promise<停用分拣结果> {
  const 公海 = 企业 && 方式 === "公海";
  const [客户们, 商机们, 待办们, 计划们, 线索们, 渠道们, 他的项目] = await Promise.all([
    db.customer.findMany({ where: { salesOwnerId: id }, select: { id: true, followStatus: true, pool: { select: { customerId: true } } } }),
    db.opportunity.findMany({ where: { ownerId: id, status: "OPEN" }, select: { id: true, customerId: true } }),
    db.task.findMany({ where: { ownerId: id, done: false }, select: { id: true, customerId: true } }),
    db.followPlan.findMany({ where: { ownerId: id, done: false }, select: { id: true, customerId: true } }),
    db.lead.findMany({ where: { ownerId: id }, select: { id: true } }),
    db.channel.findMany({ where: { channelOwnerId: id }, select: { id: true } }),
    企业 ? db.project.findMany({ where: { ownerId: id, pooledAt: null, result: null }, select: { id: true, customerId: true, phase: true } }) : [],
  ]);
  const 可进公海阶段 = 能进公海的阶段 as readonly string[];

  // 本来就在公海里的（企业版两种方式都一样）：不给接手人、不重复放，
  // 挂在上面的活也留着，谁领谁带走。原来转交方式把这些也改到接手人名下，公海那行还在，接手人看不到也领不到（11-03 完成度 C4-1）。
  // M-公海-03 起进公海负责人清空，客户不在他名下了，按「最近一次进公海时的负责人是他」认（活还挂在他名下）
  const 放走的 = 企业 ? await 公海客户原负责人是(db, [id]) : new Map<string, string>();
  const 本来在公海 = 企业 ? 客户们.filter((c) => c.pool) : [];
  const 不在公海 = 企业 ? 客户们.filter((c) => !c.pool) : 客户们;
  let 留给接手人 = 不在公海;
  let 去公海: typeof 客户们 = [];
  if (公海 && 不在公海.length) {
    const 有订单 = new Set((await db.project.findMany({
      where: { customerId: { in: 不在公海.map((c) => c.id) }, pooledAt: null, result: null, phase: { notIn: [...可进公海阶段] } },
      select: { customerId: true },
    })).map((p) => p.customerId));
    const 同事在推 = await 有同事在推的客户(db, 不在公海.map((c) => ({ id: c.id, salesOwnerId: id })));
    const 留 = (c: (typeof 客户们)[number]) => 不掉公海的状态.includes(c.followStatus) || 有订单.has(c.id) || 同事在推.has(c.id);
    留给接手人 = 不在公海.filter(留);
    去公海 = 不在公海.filter((c) => !留(c));
  }
  const 本来在公海们 = [...new Set([...本来在公海.map((c) => c.id), ...放走的.keys()])];
  const 去公海的 = new Set([...去公海.map((c) => c.id), ...本来在公海们]);
  const 转走的客户 = new Set(留给接手人.map((c) => c.id));
  // 挂在进公海、本来在公海客户上的活留在他名下，谁领客户谁带走（同手动放公海）
  const 给接手人 = (rows: { id: string; customerId: string | null }[]) => rows.filter((r) => !r.customerId || !去公海的.has(r.customerId)).map((r) => r.id);

  // 企业版：他自己的 + 同事待分配的 + 已停用同事进行中的（P-转-18）
  const 停用 = 企业 && 转走的客户.size ? await 停用的同事(db, [id]) : [];
  const 跟客户走的项目 = 转走的客户.size
    ? await db.project.findMany({
        where: {
          customerId: { in: [...转走的客户] }, pooledAt: null,
          ...(企业 ? { OR: [{ ownerId: id }, { awaitAssignAt: { not: null }, ownerId: { not: "" } }, ...(停用.length ? [{ ownerId: { in: 停用 }, result: null }] : [])] } : {}),
        },
        select: { id: true, ownerId: true, awaitAssignAt: true },
      })
    : [];
  const 跟客户走 = 跟客户走的项目.map((p) => p.id);
  // 进公海客户上他自己负责的线索 / 商机项目由 离职放进公海 一起放进线索公海（客户名下在推项目进公海），这里不重复算；
  // 本来在公海的客户上，还归他的（没进线索公海的）留着，谁领客户谁带走
  const 别处的 = 他的项目.filter((p) => !转走的客户.has(p.customerId) && !去公海的.has(p.customerId));
  const 进公海项目 = 公海 ? 别处的.filter((p) => 可进公海阶段.includes(p.phase)).map((p) => p.id) : [];
  const 进公海项目集 = new Set(进公海项目);
  const 项目 = [...new Set([...跟客户走, ...别处的.filter((p) => !进公海项目集.has(p.id)).map((p) => p.id)])];

  return {
    客户: [...转走的客户],
    进公海客户: 去公海.map((c) => c.id),
    本来在公海: 本来在公海们,
    商机: 给接手人(商机们),
    待办: 给接手人(待办们),
    计划: 给接手人(计划们),
    线索: 线索们.map((r) => r.id),
    渠道: 渠道们.map((r) => r.id),
    项目,
    清待分配: 企业 ? 跟客户走的项目.filter((p) => p.ownerId !== id && p.awaitAssignAt).map((p) => p.id) : [],
    停用同事: 企业 ? 跟客户走的项目.filter((p) => p.ownerId !== id && !p.awaitAssignAt).map((p) => p.id) : [],
    进公海项目,
    订单项目: 公海 ? 他的项目.filter((p) => !可进公海阶段.includes(p.phase)).length : 0,
  };
}

/**
 * 离职的这一份此刻交给 接手人，会新进他手上几个算持有的项目（M-公海-18 拦持有上限用；确认离职交接、离职交接看板「全部交给」共用）：
 * 按此刻重新分拣，给接手人的项目里算持有的——离职的人自己的（含他自己占着待分配的）、挂在别处的，同事待分配的清了也算；接手人自己本来就负责的不算新进。
 * 调用方放开范围（看全部）
 */
export async function 离职进手的持有项目(db: 读库, fromId: string, 方式: 停用方式, 接手人: string): Promise<number> {
  const 分 = await 停用分拣(db, fromId, 方式, true);
  if (!分.项目.length) return 0;
  return db.project.count({
    // 离职的人自己的（含他自己占着待分配的，交过去清待分配，P-转-20）、同事待分配的、已停用同事进行中的
    where: { AND: [算持有的项目, { id: { in: 分.项目 }, pooledAt: null }, { OR: [{ id: { in: 分.清待分配 } }, { ownerId: fromId }, { awaitAssignAt: null, ownerId: { not: 接手人 } }] }] },
  });
}
