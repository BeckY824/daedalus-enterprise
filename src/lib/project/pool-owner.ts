/**
 * 项目公海里的负责人（企业版，11-01 会议 C-01）：项目进公海就清空负责人，原负责人只记在留痕里。
 *   - 清空：Project.ownerId 是非空列、没有外键（迁移只能加不能改约束，见 migrations/README.md），所以写空串 = 没人负责；
 *   - 历史负责人 = 最后一次进公海前的负责人 = 最近一条 pool-release 的 fromOwnerId（放回、超时回收、离职放进公海都记这一行）；
 *   - 历史负责人领不回（pool-rules 原负责人能领回）、看不到（原负责人看得到公海项目），没做完的待办进公海时关掉。
 * 开关都在 lib/enterprise/pool-rules.ts；不是企业版 ownerId 照旧留着放回去的人，历史负责人照样按留痕认（两边一样）
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 公海规则, 进公海关待办尾 } from "@/lib/enterprise/pool-rules";
import { 看全部, 主题写 } from "@/lib/team-scope";
import { 自动删头, 自动删话 } from "@/lib/enterprise/coach-rec";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能看全部, 只读按线, type 谁 } from "@/lib/enterprise/permissions";
import { 在推项目条件 } from "./active";
import { 进公海自动关 } from "@/lib/enterprise/coach-topic";

/** 项目在公海里时 ownerId 写这个 */
export const 公海无负责人 = "";

/** 企业版、且规则要进公海清负责人 */
export function 进公海清负责人(): boolean {
  return 企业版() && 公海规则.进公海清负责人;
}

/** 项目进公海时 ownerId 改成什么：清负责人就是空串，不然照旧留着原来那位 */
export function 进公海后负责人(原: string): string {
  return 进公海清负责人() ? 公海无负责人 : 原;
}

/** 进公海清组员时记下的组员快照：操作日志 AuditLog 一个项目一行，action 是这个，detail 是组员数组 */
export const 清组员快照 = "pool-members";
type 组员快照 = { userId: string; roleId: string | null; inviteStatus: string; invitedById: string | null };

/**
 * 项目进线索公海时清掉组员（X-72、P-组员-01，企业版）：进组的、等回邀请的、拒绝过的都删。放回、超时回收、
 * 客户整体进公海连带、离职放进公海四处同一笔事务里调。领走后新负责人自己再拉组；系统管理员能改公海项目的组员（db.ts 能改组员）。
 * 清之前把组员记进操作日志（一个项目一行，清组员快照），撤销放进公海时按它还原（撤回清掉的组员）
 */
export async function 进公海清组员(tx: Pick<Prisma.TransactionClient, "projectMember" | "auditLog" | "user">, projectIds: string[], 操作人: string): Promise<void> {
  if (!企业版() || !projectIds.length) return;
  for (let i = 0; i < projectIds.length; i += 一批id数) {
    const 这批 = projectIds.slice(i, i + 一批id数);
    const 们 = await 看全部(() => tx.projectMember.findMany({ where: { projectId: { in: 这批 } }, select: { projectId: true, userId: true, roleId: true, inviteStatus: true, invitedById: true } }));
    if (!们.length) continue;
    const 按项目 = new Map<string, 组员快照[]>();
    for (const m of 们) {
      const { projectId, ...快照 } = m;
      按项目.set(projectId, [...(按项目.get(projectId) ?? []), 快照]);
    }
    const 名 = (await tx.user.findUnique({ where: { id: 操作人 }, select: { name: true } }))?.name ?? "系统";
    await tx.auditLog.createMany({ data: [...按项目].map(([projectId, 组员]) => ({
      userId: 操作人, userName: 名, action: 清组员快照, entity: "Project", entityId: projectId,
      summary: `项目进公海，清掉 ${组员.length} 位组员`, detail: JSON.stringify(组员),
    })) });
    await 看全部(() => tx.projectMember.deleteMany({ where: { projectId: { in: 这批 } } }));
  }
}

/** 进公海自动关主题时 AuditLog 的 action（entity = EntCoachTopic，一个主题一行） */
export const 进公海关主题动作 = "pool-close";

/**
 * 项目进线索公海时，没关的教练主题自动关闭（11-17 评估，开关 coach-topic.ts 进公海自动关）：领走的新负责人不背给前任的待回复。
 * closedById 留空 = 系统关的；一个主题一行 AuditLog 留痕。和 进公海清组员 并排：放回、超时回收、客户整体进公海连带、离职放进公海四处同一笔事务里调。
 * 撤销放进公海不重开（关了就关了，发起人要接着说就再发一条）。不是企业版不动
 */
export async function 进公海关主题(tx: Pick<Prisma.TransactionClient, "entCoachTopic" | "entCoachRecording" | "auditLog" | "user">, projectIds: string[], 操作人: string, at: Date = new Date()): Promise<void> {
  if (!企业版() || !projectIds.length) return;
  await 放弃没发出的录音(tx, projectIds, at);
  if (!进公海自动关) return;
  for (let i = 0; i < projectIds.length; i += 一批id数) {
    const 这批 = projectIds.slice(i, i + 一批id数);
    const 们 = await tx.entCoachTopic.findMany({ where: { projectId: { in: 这批 }, status: { not: "已关闭" }, deletedAt: null }, select: { id: true, title: true } });
    if (!们.length) continue;
    await tx.entCoachTopic.updateMany({ where: { id: { in: 们.map((t) => t.id) }, status: { not: "已关闭" } }, data: { status: "已关闭", closedById: null, closedAt: at } });
    const 名 = (await tx.user.findUnique({ where: { id: 操作人 }, select: { name: true } }))?.name ?? "系统";
    await tx.auditLog.createMany({ data: 们.map((t) => ({
      userId: 操作人, userName: 名, action: 进公海关主题动作, entity: "EntCoachTopic", entityId: t.id, summary: `项目进公海，主题「${t.title}」自动关闭`,
    })) });
  }
}

/**
 * 录音点评（PR6）：项目进公海、进回收站时，上面没发出的录音（草稿、转写中、整理中）一起放弃（事务里，只改库）；
 * 删文件、给录的人发通知由清理一轮（coach-rec-housekeep.ts）接着做。不看开关（关着也可能留着以前的草稿）
 */
export async function 放弃没发出的录音(tx: Pick<Prisma.TransactionClient, "entCoachRecording">, projectIds: string[], at: Date = new Date()): Promise<void> {
  if (!企业版() || !projectIds.length) return;
  for (let i = 0; i < projectIds.length; i += 一批id数) {
    await 主题写(() => tx.entCoachRecording.updateMany({
      where: { projectId: { in: projectIds.slice(i, i + 一批id数) }, status: { notIn: ["已发出", "已放弃"] }, deletedAt: null },
      data: { status: "已放弃", deletedAt: at, error: `${自动删头}${自动删话.项目没了}` },
    }));
  }
}

/**
 * 撤销放进公海时把那次清掉的组员还回去（X-72）：认 不早于 那次 pool-release 的最近一条清组员快照；
 * 已停用的、还回去的负责人自己不再进组；快照读不出来就不还。调用方在事务里、看全部 里调
 */
export async function 还原清掉的组员(tx: Pick<Prisma.TransactionClient, "projectMember" | "auditLog" | "user">, projectId: string, 放回时间: Date, 负责人: string): Promise<number> {
  if (!企业版()) return 0;
  const 快照行 = await tx.auditLog.findFirst({ where: { entity: "Project", entityId: projectId, action: 清组员快照, at: { gte: 放回时间 } }, orderBy: { at: "desc" }, select: { detail: true } });
  if (!快照行?.detail) return 0;
  let 组员: 组员快照[];
  try {
    const x = JSON.parse(快照行.detail) as unknown;
    组员 = Array.isArray(x) ? x.filter((m): m is 组员快照 => !!m && typeof m === "object" && typeof (m as 组员快照).userId === "string") : [];
  } catch {
    return 0;
  }
  const 在职 = new Set((await tx.user.findMany({ where: { id: { in: 组员.map((m) => m.userId) }, active: true }, select: { id: true } })).map((u) => u.id));
  const 已在 = new Set((await tx.projectMember.findMany({ where: { projectId }, select: { userId: true } })).map((m) => m.userId));
  const 还 = 组员.filter((m) => 在职.has(m.userId) && m.userId !== 负责人 && !已在.has(m.userId));
  if (!还.length) return 0;
  await tx.projectMember.createMany({ data: 还.map((m) => ({ projectId, userId: m.userId, roleId: m.roleId ?? null, inviteStatus: m.inviteStatus || "JOINED", invitedById: m.invitedById ?? null })) });
  return 还.length;
}

/** 企业版、且规则不让历史负责人看公海里的这个项目 */
export function 原负责人回避(): boolean {
  return 企业版() && !公海规则.原负责人看得到公海项目;
}

type 读痕 = Pick<Prisma.TransactionClient, "projectNodeLog">;

/**
 * 按 id 查的大名单一批多少个：SQLite 一句最多 999 个参数，留足范围层那些条件的位置（11-02）。
 * 过限交给 Prisma 自己拆不靠谱：条件带否定拆不了（P2029），orderBy 字段没 select 拆完合不上（panic「no entry found for key」）
 */
export const 一批id数 = 400;

/** 几个项目各自的历史负责人（最近一条 pool-release 的 fromOwnerId）。没放回过的不在里面 */
export async function 历史负责人们(db: 读痕, projectIds: string[]): Promise<Map<string, string>> {
  const 们 = new Map<string, string>();
  const ids = [...new Set(projectIds)];
  // 同一个项目的留痕都在同一批，每批自己排好序就够。一批一批来：db 可能是事务
  for (let i = 0; i < ids.length; i += 一批id数) {
    const 行 = await 看全部(() => db.projectNodeLog.findMany({
      where: { projectId: { in: ids.slice(i, i + 一批id数) }, kind: "pool-release" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { projectId: true, fromOwnerId: true },
    }));
    const 看过 = new Set<string>();
    for (const l of 行) {
      if (看过.has(l.projectId)) continue;
      看过.add(l.projectId);
      if (l.fromOwnerId) 们.set(l.projectId, l.fromOwnerId);
    }
  }
  return 们;
}

/** 一个项目的历史负责人；没放回过 / 留痕没记人返回 null */
export async function 历史负责人(db: 读痕, projectId: string): Promise<string | null> {
  return (await 历史负责人们(db, [projectId])).get(projectId) ?? null;
}

/**
 * 现在在公海里、历史负责人是这几位之一的项目 id（只认最后一次进公海：放回过、后来被别人领走再放回的不算）。
 * 复盘按人数「退回公海」用（企业版负责人已清空，按 ownerId 数不到了）
 */
export async function 公海里历史负责人是(db: 读痕, 人们: readonly string[]): Promise<string[]> {
  if (!人们.length) return [];
  const 放过 = await 看全部(() => db.projectNodeLog.findMany({
    where: { kind: "pool-release", fromOwnerId: { in: [...人们] }, project: { pooledAt: { not: null }, deletedAt: null } },
    select: { projectId: true },
  }));
  if (!放过.length) return [];
  const 现 = await 历史负责人们(db, 放过.map((l) => l.projectId));
  const 是 = new Set(人们);
  return [...现].filter(([, uid]) => 是.has(uid)).map(([id]) => id);
}

/**
 * 现在在公海里、我是历史负责人的项目 id（原负责人回避开着才算，不然空）。列表、统一公海页用来把这些行剔掉
 */
export async function 我回避的公海项目(db: 读痕, meId: string): Promise<string[]> {
  if (!原负责人回避()) return [];
  return 公海里历史负责人是(db, [meId]);
}

/** 回避条件 里名单（和例外）最多放几个 id：再多 notIn 过 SQLite 参数上限（否定条件 Prisma 拆不了，P2029），退回按关联写的条件。同 enterprise/visibility.ts 回避名单上限 */
const 回避条件名单上限 = 100;

/**
 * 「不是我回避的公海项目」的 where（F-057：原来把 我回避的公海项目 整串塞进 id notIn，退过上千个项目的人一开页面就 P2029）。
 * 名单不过上限：id notIn 名单，同原来。过了上限：退回按关联写——公海里、留痕里有我放回的就算回避；写不出「只认最后一次」，
 * 多挡到的（早先我退、后来别人领走又退）按 id 放出来（例外），例外也过上限就宽挡（多挡不漏），同 visibility.ts 的 X-76。
 * 不论名单多长参数数都有界（≤ 上限）。没有要回避的（回避关着、没放回过）回 null，调用方不加条件。
 * 分页的列表用它代替 notIn：条件在库里算，页数、总数照旧对
 */
export async function 不回避条件(db: Pick<Prisma.TransactionClient, "projectNodeLog" | "project">, meId: string): Promise<Prisma.ProjectWhereInput | null> {
  const 名单 = await 我回避的公海项目(db, meId);
  if (!名单.length) return null;
  if (名单.length <= 回避条件名单上限) return { id: { notIn: 名单 } };
  const 留痕 = { kind: "pool-release", fromOwnerId: meId };
  const 宽 = await 看全部(() => db.project.findMany({ where: { deletedAt: null, pooledAt: { not: null }, logs: { some: 留痕 } }, select: { id: true } }));
  const 是 = new Set(名单);
  const 例外 = 宽.map((r) => r.id).filter((id) => !是.has(id));
  return { OR: [{ pooledAt: null }, { logs: { none: 留痕 } }, ...(例外.length && 例外.length <= 回避条件名单上限 ? [{ id: { in: 例外 } }] : [])] };
}

/**
 * 「现在在公海里、最后一次是这几位放的」项目的 where（F-057 同类：数据页 project-stats 原来把 公海里历史负责人是 整串塞进 id in，
 * 销售只看自己、总管理看全队时 1000+ 个 id 过 SQLite 参数上限，P2029）。口径同 公海里历史负责人是（只认最近一次 pool-release）。
 * 名单不过上限：id in 名单，同原来。过了上限：按关联写——公海里、留痕里有这些人放回的（宽集合），再 NOT id in 例外
 * （例外 = 宽集合 − 名单，早先他们放过、最后一次是别人放的）。例外也过上限时宁可少算不多算：不再列例外，
 * 改成更窄的子集——宽集合里「从来没有别人放过」的（logs none 别人放的 pool-release），它一定是名单的子集，只会漏掉
 * 「别人早先放过、最后一次又是他们放」的，不会把别人最后放的算进来。参数数都有界（≤ 上限 + 人们 个数）。
 * 没有（名单空）回 null，调用方不加条件
 */
export async function 是我放回的公海项目条件(db: Pick<Prisma.TransactionClient, "projectNodeLog" | "project">, 人们: readonly string[]): Promise<Prisma.ProjectWhereInput | null> {
  const 名单 = await 公海里历史负责人是(db, 人们);
  if (!名单.length) return null;
  if (名单.length <= 回避条件名单上限) return { id: { in: 名单 } };
  const 是 = [...人们];
  const 宽条件: Prisma.ProjectWhereInput = { deletedAt: null, pooledAt: { not: null }, logs: { some: { kind: "pool-release", fromOwnerId: { in: 是 } } } };
  const 宽 = await 看全部(() => db.project.findMany({ where: 宽条件, select: { id: true } }));
  const 在名单 = new Set(名单);
  const 例外 = 宽.map((r) => r.id).filter((id) => !在名单.has(id));
  if (例外.length <= 回避条件名单上限) return { AND: [宽条件, ...(例外.length ? [{ NOT: { id: { in: 例外 } } }] : [])] };
  return { AND: [宽条件, { logs: { none: { kind: "pool-release", OR: [{ fromOwnerId: null }, { fromOwnerId: { notIn: 是 } }] } } }] };
}

/**
 * 项目刚进公海（同一笔事务里、单项目客户跟进公海 之后调）：原负责人在这个项目上没做完的待办标成已完成，记录留着。
 * 待办挂在客户上、不挂项目：客户也进了公海或客户本来就不归他，且他在这位客户下没有别的在推项目 → 他在这位客户上没做完的都关；
 * 不然（客户还归他、或他还在推别的项目）→ 只关标题里点了这个项目名的（「项目名」，超时提醒、回收前一天提醒都是这样写的）。
 * 别的项目只数在推的：已结束的、已进公海的不算。一次进公海几个项目的（客户整包、超时回收），前面的只关点名的，轮到最后一个才关其余的，
 * 都是同一刻（at）。这个判断只在这里算一次：领取时按 doneAt 认这一批（carry-tasks.ts 出公海带回待办），不按领取时的状态重算。
 * 标题后面接一句 进公海关待办尾。返回关了几条
 */
export async function 进公海关待办(
  tx: Prisma.TransactionClient,
  p: { id: string; customerId: string; name: string },
  原: string,
  at: Date = new Date(),
): Promise<number> {
  if (!企业版() || !公海规则.进公海关原负责人待办 || !原) return 0;
  return 看全部(async () => {
    const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    const 别的在推 = await tx.project.count({ where: { customerId: p.customerId, ownerId: 原, id: { not: p.id }, deletedAt: null, ...在推项目条件 } });
    const 全关 = (!c || !!c.pool || c.salesOwnerId !== 原) && !别的在推;
    const 们 = await tx.task.findMany({
      where: { customerId: p.customerId, ownerId: 原, done: false, ...(全关 ? {} : { title: { contains: `「${p.name}」` } }) },
      select: { id: true, title: true },
    });
    for (const t of 们) {
      await tx.task.update({
        where: { id: t.id },
        data: { done: true, doneAt: at, ...(t.title.endsWith(进公海关待办尾) ? {} : { title: `${t.title}${进公海关待办尾}` }) },
      });
    }
    return 们.length;
  });
}

/**
 * 回避豁免：只认「能看全部」的业务角色（总管理、管理员），账号 ADMIN / MANAGER 不豁免（11-01 权限只认业务角色，同 PR-E 口径）。
 * 详情页、列表、统一公海、客户沟通流判「历史负责人要不要回避」都调这个
 */
export async function 回避豁免(me: 谁): Promise<boolean> {
  const org = await 权限组织();
  return 能看全部(me, org) || !!只读按线(me, org);
}

/**
 * 这个项目在公海里、我是它的历史负责人、回避开着、我又不是总管理 / 管理员 → 挡（对它没有任何权限，C-01）。
 * 详情页、附件接口等按单个项目认权限的地方用；列表用 我回避的公海项目 一次剔
 */
export async function 原负责人挡着(db: 读痕, me: 谁, p: { id: string; pooledAt?: Date | null }): Promise<boolean> {
  if (!p.pooledAt || !原负责人回避() || (await 回避豁免(me))) return false;
  return (await 历史负责人(db, p.id)) === me.id;
}
