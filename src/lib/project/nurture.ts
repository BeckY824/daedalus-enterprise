/**
 * 新客户至少带 1 个「潜客培育」项目（M-公海-14 / A-15，10-31 会议）：企业版开了项目模式时，客户进系统就不再是零项目客户。
 *
 * saveCustomer 新建那一笔事务的最后调一次：建档向导（接着建）已经建了项目的不再补；
 * 只管新建，老的零项目客户不补（A-15 先问，动客户库要备份 + 点头）。导入、线索转化各有自己建项目的路，不走这里。
 * 项目名用客户名（截到项目名上限），负责人 = 客户负责人，联系人挂主要联系人（有的话），落在第一个节点、记一行节点变更，
 * 金额币种留默认——和线索转化建出来的项目一样（from-lead.ts），到项目里再填。
 * 调用方判断开关：不是企业版、没开项目模式时不进这里，什么都不建。
 */
import type { Prisma } from "@/generated/prisma";
import { 默认币种 } from "../currency";
import { 第一个节点 } from "./nodes";
import { 项目名上限 } from "./wizard";
import { 新项目默认值 } from "./proj-fields";
import { 系统建项目分配方式, type 建给自己记 } from "./self-assign-mode";
import { 看全部 } from "../team-scope";
import { 看已删 } from "../enterprise/soft-delete-core";
import { 历史分析来源 } from "./system-created";

/** 要不要补：企业版且开了项目模式才补（纯判断，方便单测钉住「没开项目模式时不建」） */
export function 要补潜客培育(企业: boolean, 项目模式: boolean | undefined): boolean {
  return 企业 && 项目模式 === true;
}

/**
 * 算「有项目」的项目：已结束的历史分析回填项目不算（11-18，M-公海-14「领走补一个能推进的项目」）——
 * 公海客户名下只挂着回填的线索流失 / 丢单，领走后没有一个能推进的，照零项目客户补一个潜客培育。
 * 历史分析的还在推（没结局）、正常建的（有没有结局都算，同原来）照旧算有
 */
export const 算有项目 = {
  OR: [{ source: null }, { source: { not: 历史分析来源 } }, { result: null }],
} satisfies Prisma.ProjectWhereInput;

/**
 * 这位客户一个项目都没有（已结束的历史分析项目不算，见 算有项目）就建一个潜客培育项目，返回新项目 id；已经有项目（向导刚建的）返回 null。
 * 分配方式（11-18 复盘第 5 类，潜客培育必填清单要看它）：调用方知道怎么来的就传（公海领取 = 公海捞取）；
 * 没传按谁建给谁（self-assign-mode.ts 系统建项目分配方式：建给别人 = 指定分配；建给自己：市场成员 = 暂不分配，别人 = 个人自持）。
 * 项目来源不写：渠道统计回落客户来源，建好有值就锁，系统补的不替人定。记 = 一次事务里补很多位时复用「建给自己」的判定
 */
export async function 补潜客培育(
  tx: Prisma.TransactionClient,
  a: { customerId: string; 客户名: string; ownerId: string; creatorId: string; 分配方式?: string },
  记?: 建给自己记,
): Promise<string | null> {
  if (await tx.project.count({ where: { customerId: a.customerId, ...算有项目 } })) return null;
  const 联系人 = await tx.contact.findFirst({ where: { customerId: a.customerId, isPrimary: true }, select: { id: true } });
  const 项目 = await tx.project.create({
    data: {
      name: a.客户名.trim().slice(0, 项目名上限) || "潜客培育", customerId: a.customerId, contactId: 联系人?.id ?? null,
      ownerId: a.ownerId, creatorId: a.creatorId, amount: 0, currency: 默认币种,
      phase: 第一个节点.phase, node: 第一个节点.node,
      ...新项目默认值(true, { 分配方式: a.分配方式 ?? (await 系统建项目分配方式(tx, a.ownerId, a.creatorId, 记)), 项目来源: null }),
    },
  });
  await tx.projectNodeLog.create({ data: { projectId: 项目.id, userId: a.creatorId, toPhase: 第一个节点.phase, toNode: 第一个节点.node } });
  return 项目.id;
}

/**
 * 客户离开公海 / 回到客户名单时补（M-公海-14 + M-公海-08，11-17）：客户公海里允许零项目客户（显示「线索-潜客培育」），
 * 出来的那一刻起就得带 1 个潜客培育项目。几个口子共用这一个：
 *   - 公海客户出手（领取、分配公海，customers/pool-actions.ts）：和出公海、换负责人同一个事务，在核持有上限之前建，所以 +1 一起算进上限
 *   - 导入 / 同步 / 冲突处理把无主客户换上负责人出公海（enterprise-import/apply.ts 改）
 *   - 回收站恢复客户、查重捞回（enterprise/soft-delete.ts 恢复一条）
 * 客户整包出公海（pool-link.ts）不用：它是领 / 分名下一个项目带出来的，客户本来就有项目。
 * 只补：客户还在、没删、不在客户公海、名下一个项目都没有（回收站里的项目也算有，不补；已结束的历史分析回填项目不算有，见 算有项目——
 * 领到「名下只有回填的线索流失 / 丢单」的公海客户时，这些已结束的随客户一起出公海（M-公海-02 / P-公海-02：客户整体进公海时连带进去的，跟着客户走），另补 1 个能推进的）。负责人 = 客户现在的负责人（调用方先换好），
 * 创建人 = 操作人（空的话记负责人），时间 = 现在。返回 客户 id → 新项目 id（撤销领取 / 分配时按它删，见 潜客培育没动过）。
 * 调用方判断开关（要补潜客培育）：不是企业版、没开项目模式时别调
 */
export async function 零项目客户补潜客培育(
  tx: Prisma.TransactionClient,
  customerIds: readonly string[],
  操作人: string,
  /** 补的项目记哪种分配方式（公海领取传 公海捞取）；不传按谁建给谁（见 补潜客培育） */
  分配方式?: string,
): Promise<Map<string, string>> {
  const 出 = new Map<string, string>();
  const 们 = [...new Set(customerIds.filter(Boolean))];
  if (!们.length) return 出;
  return 看全部(async () => {
    // 回收站里的项目也算有：看已删 里数（带否定条件之外的 in 也 500 个一批，免得过 999 个参数）
    const 有项目 = new Set<string>();
    for (let i = 0; i < 们.length; i += 500) {
      const 这批 = 们.slice(i, i + 500);
      for (const g of await 看已删(() => tx.project.groupBy({ by: ["customerId"], where: { customerId: { in: 这批 }, ...算有项目 } }))) 有项目.add(g.customerId);
    }
    const 没项目 = 们.filter((id) => !有项目.has(id));
    const 记: 建给自己记 = new Map();
    for (let i = 0; i < 没项目.length; i += 500) {
      // 默认读法已经滤掉回收站里的客户（软删扩展）；不在客户公海的才补
      const 客户们 = await tx.customer.findMany({ where: { id: { in: 没项目.slice(i, i + 500) }, pool: null }, select: { id: true, name: true, salesOwnerId: true } });
      for (const c of 客户们) {
        const id = await 补潜客培育(tx, { customerId: c.id, 客户名: c.name, ownerId: c.salesOwnerId, creatorId: 操作人 || c.salesOwnerId, ...(分配方式 ? { 分配方式 } : {}) }, 记);
        if (id) 出.set(c.id, id);
      }
    }
    return 出;
  });
}

/**
 * 沟通必须挂项目（11-17 客户定），可原来要挂的项目找不到了——导入给了项目但项目对不上、导入撤回后恢复时项目已不在（11-18 复盘第 5 类漏网两处）：
 * 挂这位客户的潜客培育项目，不再存成不挂项目的沟通。
 *   - 名下有在推（没结局、不在公海）、停在潜客培育的项目：挂最近动过的那个；
 *   - 名下一个项目都没有（算有项目）：照 补潜客培育 建一个再挂（负责人 = 客户负责人，创建人 = 操作人，没给记负责人）；
 *   - 别的（客户不在了、在客户公海里，或名下有项目但没有在推的潜客培育）：回 null，调用方按「没对上项目」办，不替人猜挂哪个。
 * 调用方判断开关和沟通类型：企业版只用项目、要挂项目的类型（待办 / 提醒不用挂）才调
 */
export async function 沟通挂潜客培育(
  tx: Prisma.TransactionClient,
  customerId: string,
  操作人?: string | null,
): Promise<{ projectId: string; node: string } | null> {
  return 看全部(async () => {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
    if (!c || c.pool) return null;
    const 培育 = await tx.project.findFirst({
      where: { customerId, result: null, pooledAt: null, phase: 第一个节点.phase, node: 第一个节点.node },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, node: true },
    });
    if (培育) return { projectId: 培育.id, node: 培育.node };
    const id = await 补潜客培育(tx, { customerId, 客户名: c.name, ownerId: c.salesOwnerId, creatorId: 操作人 || c.salesOwnerId });
    return id ? { projectId: id, node: 第一个节点.node } : null;
  });
}

/** 动过的判定里「没改过」的宽限：建项目那一笔里 createdAt、updatedAt 各取各的 now，差几毫秒 */
const 没改过宽限毫秒 = 2000;

/**
 * 撤销领取 / 分配时，出公海那一刻补的潜客培育项目还能不能整条删掉（P-撤销-01 按原样回滚）：
 *   没动过：没删、还归 负责人、还是 创建人 建的（不给创建人就不核这一条）、不在公海、没结局、没在待分配、还在第一个节点；
 *           节点留痕只有建的那一行（没换过节点、没换过负责人、没进出过公海）；没挂过沟通、组员、附件、卡点、回款、关联客户 / 联系人、线索验证；
 *           项目本身没编辑过（updatedAt 没往前走）→ 调用方真删
 *   动过：上面哪条不成立 → 调用方不删、这一位客户不撤（不然客户回了公海、名下挂着同事在推的项目，M-公海-02 例外二）
 *   不在了：已经被人删了（真删，或在回收站里）→ 没东西要删，照撤
 */
export async function 潜客培育动没动(
  tx: Pick<Prisma.TransactionClient, "project" | "attachment">,
  projectId: string,
  a: { customerId: string; 负责人: string; 创建人?: string },
): Promise<"没动过" | "动过" | "不在了"> {
  const p = await 看全部(() => 看已删(() => tx.project.findUnique({
    where: { id: projectId },
    select: {
      customerId: true, ownerId: true, creatorId: true, pooledAt: true, result: true, phase: true, node: true, createdAt: true, updatedAt: true, awaitAssignAt: true, deletedAt: true,
      entLeadVerify: { select: { projectId: true } },
      _count: { select: { logs: true, followUps: true, members: true, blockers: true, entPayments: true, customerLinks: true, contactLinks: true, entLeadVerifyLogs: true } },
    },
  })));
  if (!p || p.deletedAt) return "不在了";
  if (p.customerId !== a.customerId || p.ownerId !== a.负责人 || (a.创建人 !== undefined && p.creatorId !== a.创建人)) return "动过";
  if (p.pooledAt || p.result || p.awaitAssignAt || p.entLeadVerify) return "动过";
  if (p.phase !== 第一个节点.phase || p.node !== 第一个节点.node) return "动过";
  const n = p._count;
  if (n.logs !== 1 || n.followUps || n.members || n.blockers || n.entPayments || n.customerLinks || n.contactLinks || n.entLeadVerifyLogs) return "动过";
  if (p.updatedAt.getTime() - p.createdAt.getTime() > 没改过宽限毫秒) return "动过";
  // 附件挂在项目上（Attachment.projectId）：Project 上没有反向关联，另数
  if (await 看全部(() => 看已删(() => tx.attachment.count({ where: { projectId } })))) return "动过";
  return "没动过";
}

/**
 * 撤销领取 / 分配时收回出公海那一刻补的潜客培育项目（P-撤销-01）：培育ids 是前端带回来的（不信），只认这位客户名下的；
 * 全都没动过（或已经被人删了）→ 没动过的真删、回 true；有一个动过 → 一个都不删、回 false，调用方让这一位不撤（整笔回滚）
 */
export async function 撤回补的潜客培育(
  tx: Pick<Prisma.TransactionClient, "project" | "attachment">,
  培育ids: readonly unknown[],
  a: { customerId: string; 负责人: string; 创建人: string },
): Promise<boolean> {
  const ids = [...new Set(培育ids.filter((x): x is string => typeof x === "string" && !!x))];
  if (!ids.length) return true;
  const 这位的 = await 看全部(() => 看已删(() => tx.project.findMany({ where: { id: { in: ids }, customerId: a.customerId }, select: { id: true } })));
  const 删: string[] = [];
  for (const { id } of 这位的) {
    const 状 = await 潜客培育动没动(tx, id, a);
    if (状 === "动过") return false;
    if (状 === "没动过") 删.push(id);
  }
  // 留痕（建项目那一行）跟着级联删
  if (删.length) await 看全部(() => tx.project.deleteMany({ where: { id: { in: 删 } } }));
  return true;
}
