import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 带走一位, 转项目 } from "@/lib/carry-over-db";
import { 看全部 } from "@/lib/team-scope";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 停用分拣, 停用的同事 } from "@/lib/offboard-db";
import { 持有上限起点, 整批核上限 } from "@/lib/project/db";
import { 查完再写 } from "@/lib/check-then-write";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 公海客户原负责人是 } from "@/lib/owner-log-db";
import { 离职转给接手人 } from "@/lib/offboard-move";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 离职交接中, 待确认 } from "@/lib/enterprise/handover-db";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能改后台设置, 只读角色, 公海分不给话, type 谁 } from "@/lib/enterprise/permissions";
import { 待交接理由 } from "@/lib/enterprise/tri-state-quota";
import { 差天, 工作日数, 交接挂起超了 } from "@/lib/enterprise/tri-state";
import { beijingDay } from "@/lib/business-clock";

/**
 * 离职交接看板（11-03 B7-2）：办离职时名下客户、项目原地不动（负责人仍是他，C4-4），
 * 之后由他的直属上级（手填的 managerId）或系统管理员在「项目 → 离职交接」里一条条、或一键全部交给接手人。
 *
 * - 直属上级读 EntMember.managerId：组织表（读组织）只有在职的人，离职的人在里面找不到上级
 * - 接手人候选同公海分配（公海分不给话）：在职、有业务角色、不是只读；不限业务线（P-转-08，覆盖 11-03 B2-7）
 * - 单条交走现有改负责人的逻辑（带走一位：没做完的活跟着走、项目跟着客户、记历史负责人 kind=deactivate；
 *   项目走 转项目，记转让痕、卡点认领跟着）；一键全部交给 = 原来办离职时的「全部转交」（停用分拣 + 离职转给接手人），
 *   线索、渠道（连他当负责人的主渠道，迁移 118）也一起给
 * - 没开项目模式：只列客户，不动项目（单条不带项目，一键时项目那份清空）
 * - 查的、改的都包 看全部：按组织看客户开着时，上级的范围里不一定有离职下属的客户
 */

/**
 * 待交接日 / 挂起天数（三态 T12，客户 11-12 第二轮答复列为上线前置）：三态夜扫给这位客户标「待交接」的那天（上海日）、到今天挂了几个自然日；
 * 没标过（三态关着、或已在离职交接待确认里）不带。原负责人 = 这一组的人，原直属上级 = 这一组的 上级
 */
export type 交接客户 = {
  id: string; name: string; 项目数: number; 待交接日?: string; 挂起天数?: number;
  /** 挂了几个工作日（周一到周五，不扣节假日，tri-state.ts 工作日数）；超期 = 超过 15 个工作日或 30 个自然日（先到者，交接挂起超了，M-公海-49 / 50） */
  挂起工作日?: number; 超期?: boolean;
  /**
   * 离职交接还在等接手人确认（M-公海-49 挂起；三态界面 B 组，用户 11-12 定并进待交接表）：从发起那天算的挂起天数、工作日、超没超期，等谁确认。
   * 哪些客户算：发起时清点了客户的按清点的，没清点的按「还在他名下」（同 tri-state-db.ts 离职交接中的）
   */
  交接中?: { 起日: string; 接手人: string | null; 挂起天数: number; 挂起工作日: number; 超期: boolean };
};
export type 交接项目 = { id: string; name: string; 客户: string };
export type 离职待交接 = {
  id: string;
  name: string;
  /** 他的直属上级（手填的）叫什么；没填 = null */
  上级: string | null;
  /** 还有一笔老的「等接手人确认」的离职交接：先在客户页撤回或等确认，这里不让动 */
  交接中: boolean;
  客户: 交接客户[];
  /** 他负责、不跟着他名下客户走的项目（项目模式才有） */
  项目: 交接项目[];
  /** 一键全部交给时才一起走的：线索、渠道、他当负责人的主渠道（迁移 118）、挂在别人客户上的待办 */
  其余: { 线索: number; 渠道: number; 主渠道: number; 待办: number };
};

/** 我能不能处理这位离职成员：系统管理员都能；别人只能处理手填直属上级是自己的。只读管理员一律不能 */
export async function 能交接(me: 谁, fromId: string): Promise<boolean> {
  const org = await 权限组织();
  if (!org || 只读角色(me, org)) return false;
  if (typeof fromId !== "string" || !fromId) return false;
  const u = await prisma.user.findUnique({ where: { id: fromId }, select: { active: true, email: true } });
  if (!u || u.active || u.email === 无负责人占位邮箱) return false;
  if (能改后台设置(me, org)) return true;
  const m = await prisma.entMember.findUnique({ where: { userId: fromId }, select: { managerId: true } });
  return !!m?.managerId && m.managerId === me.id;
}

/** 我能处理的离职成员 id：系统管理员 = 全部离职的；上级 = 手填直属上级是我的 */
async function 我管的离职(me: 谁): Promise<string[]> {
  const org = await 权限组织();
  if (!org || 只读角色(me, org)) return [];
  const 全部 = 能改后台设置(me, org);
  // 下属里停用了的：组织里记着（离职上级 = 停用的人手填的直属上级），不再另查一遍 EntMember（11-12 客户页页头摆入口，省查询）
  const 下属 = 全部 ? null : org.离职上级
    ? [...org.离职上级].filter(([, 上]) => 上 === me.id).map(([id]) => id)
    : (await prisma.entMember.findMany({ where: { managerId: me.id }, select: { userId: true } })).map((m) => m.userId);
  if (下属 && !下属.length) return [];
  const 们 = await prisma.user.findMany({
    where: { active: false, email: { not: 无负责人占位邮箱 }, ...(下属 ? { id: { in: 下属 } } : {}) },
    select: { id: true },
  });
  return 们.map((u) => u.id);
}

const 项目模式 = async () => (await getBusiness()).projectMode === true;

/** 一句里最多点名这么多位离职成员（每位要拼一段「负责人是他、客户不归他」的条件；再多就分几句） */
const 一批人 = 200;
/** 数客户上的项目时，客户不超过这么多位就按 id 点名 */
const 一批客户 = 400;
const 分批 = <T,>(们: readonly T[]): T[][] => Array.from({ length: Math.ceil(们.length / 一批人) }, (_, i) => 们.slice(i * 一批人, (i + 1) * 一批人));
/** 「负责人是他、挂的客户不归他」：每位离职成员一段，拼成一句（原来是每位各查一遍） */
const 挂在别人客户上 = (ids: readonly string[]) => ids.map((id) => ({ ownerId: id, customer: { salesOwnerId: { not: id } } }));
const 按人分 = <T,>(们: readonly T[], 谁: (x: T) => string | null): Map<string, T[]> => {
  const 出 = new Map<string, T[]>();
  for (const x of 们) {
    const k = 谁(x);
    if (k === null) continue;
    const 有 = 出.get(k);
    if (有) 有.push(x);
    else 出.set(k, [x]);
  }
  return 出;
};

/** 离职交接发起时清点的客户（JSON 数组）；没清点 / 坏了 = null（按还在他名下的都算） */
function 清点的客户(raw: string): Set<string> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.length ? new Set(v.filter((x): x is string => typeof x === "string")) : null;
  } catch {
    return null;
  }
}

/**
 * 看板的数据：只列名下还有东西（客户、项目、线索、渠道、待办）的人。
 * 所有离职成员一起查、内存里按人分（代码体检 5.2 N+1 第 3 条）：查库次数不随人数涨（过 一批人 位才多一轮），每位的数和原来逐位查的一样
 */
export async function 读离职交接(me: 谁): Promise<离职待交接[]> {
  const ids = await 我管的离职(me);
  if (!ids.length) return [];
  const 带项目 = await 项目模式();
  return 看全部(async () => {
    const 人们 = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const 上级of = new Map((await prisma.entMember.findMany({ where: { userId: { in: ids } }, select: { userId: true, managerId: true } })).map((m) => [m.userId, m.managerId]));
    // 还在等接手人确认的离职交接：先读出来，接手人的名字和上级的名字一句取（不另查）；同一位有几笔的，几笔清点的客户合起来算（同 tri-state-db.ts 离职交接中的）
    const 交接们: { fromUserId: string; toUserId: string; createdAt: Date; customerIds: string }[] = [];
    for (const 批 of 分批(ids)) {
      交接们.push(...(await prisma.entHandover.findMany({ where: { kind: "离职", fromUserId: { in: 批 }, status: 待确认 }, select: { fromUserId: true, toUserId: true, createdAt: true, customerIds: true }, orderBy: { createdAt: "asc" } })));
    }
    const 交接of = new Map<string, (typeof 交接们)[number][]>();
    for (const h of 交接们) 交接of.set(h.fromUserId, [...(交接of.get(h.fromUserId) ?? []), h]);
    const 交接中 = new Set(交接of.keys());
    const 上级ids = [...new Set([...上级of.values(), ...交接们.map((h) => h.toUserId)].filter((x): x is string => !!x))];
    const 上级名 = new Map((await prisma.user.findMany({ where: { id: { in: 上级ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    // 同 停用分拣：客户上已停用同事进行中的项目随客户交（P-转-18），项目数算上
    const 停用 = new Set(带项目 ? await 停用的同事(prisma, []) : []);
    // M-公海-03 起进公海负责人清空：最近一次进公海时负责人是他的，客户不在他名下了，上面的活还是谁领谁带（同 停用分拣）
    const 放走的of = new Map<string, Set<string>>();
    for (const [客户id, 人] of await 公海客户原负责人是(prisma, ids)) {
      const 有 = 放走的of.get(人);
      if (有) 有.add(客户id);
      else 放走的of.set(人, new Set([客户id]));
    }
    const 没放走 = (x: { ownerId: string; customerId: string }) => !放走的of.get(x.ownerId)?.has(x.customerId);
    const 客户们of = new Map<string, { id: string; name: string; salesOwnerId: string }[]>();
    const 客户上的项目of = new Map<string, { ownerId: string; awaitAssignAt: Date | null; result: string | null }[]>();
    const 项目们of = new Map<string, { id: string; name: string; ownerId: string; customerId: string; customer: { name: string } }[]>();
    const 数 = { 线索: new Map<string, number>(), 渠道: new Map<string, number>(), 主渠道: new Map<string, number>(), 待办: new Map<string, number>() };
    for (const 批 of 分批(ids)) {
      const 人 = { in: 批 };
      // 同 停用分拣：在公海里的不算他的（谁领谁接）
      const 他的客户 = { salesOwnerId: 人, pool: { is: null } };
      const [客户们, 项目们, 线索, 渠道, 主渠道, 待办们] = await Promise.all([
        prisma.customer.findMany({ where: 他的客户, select: { id: true, name: true, salesOwnerId: true }, orderBy: { name: "asc" } }),
        带项目
          ? prisma.project.findMany({
              where: { ownerId: 人, pooledAt: null, result: null, OR: 挂在别人客户上(批) },
              select: { id: true, name: true, ownerId: true, customerId: true, customer: { select: { name: true } } },
              orderBy: { name: "asc" },
            })
          : [],
        prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: 人 }, _count: { _all: true } }),
        prisma.channel.groupBy({ by: ["channelOwnerId"], where: { channelOwnerId: 人 }, _count: { _all: true } }),
        prisma.entChannelMain.groupBy({ by: ["ownerId"], where: { ownerId: 人 }, _count: { _all: true } }),
        // 同 停用分拣：他名下客户上的待办跟着客户走（在公海里的谁领谁带），这里数挂在别人客户上的
        prisma.task.findMany({ where: { ownerId: 人, done: false, OR: 挂在别人客户上(批) }, select: { ownerId: true, customerId: true } }),
      ]);
      // 每位客户的项目数：取这些客户上没进公海的项目，下面按「他自己的、待分配的、别的停用同事进行中的」数。
      // 客户不多就点名（走客户 id 的索引），多了按「他的客户」框，不拼过长的名单
      const 客户上的项目 = 带项目 && 客户们.length
        ? await prisma.project.findMany({
            where: { pooledAt: null, ...(客户们.length <= 一批客户 ? { customerId: { in: 客户们.map((c) => c.id) } } : { customer: 他的客户 }) },
            select: { customerId: true, ownerId: true, awaitAssignAt: true, result: true },
          })
        : [];
      for (const [k, v] of 按人分(客户们, (c) => c.salesOwnerId)) 客户们of.set(k, v);
      for (const [k, v] of 按人分(客户上的项目, (p) => p.customerId)) 客户上的项目of.set(k, v);
      for (const [k, v] of 按人分(项目们.filter(没放走), (p) => p.ownerId)) 项目们of.set(k, v);
      for (const g of 线索) if (g.ownerId) 数.线索.set(g.ownerId, g._count._all);
      for (const g of 渠道) if (g.channelOwnerId) 数.渠道.set(g.channelOwnerId, g._count._all);
      for (const g of 主渠道) if (g.ownerId) 数.主渠道.set(g.ownerId, g._count._all);
      for (const [k, v] of 按人分(待办们.filter(没放走), (t) => t.ownerId)) 数.待办.set(k, v.length);
    }
    // 三态 T12 标的待交接：每位客户最早那次（这位离职成员名下的）
    const 今天 = beijingDay(new Date());
    const 标日 = new Map<string, string>();
    for (const 批 of 分批(ids)) {
      for (const x of await prisma.entCustomerStateLog.findMany({ where: { reason: 待交接理由, fromOwnerId: { in: 批 } }, select: { customerId: true, fromOwnerId: true, at: true }, orderBy: { at: "asc" } })) {
        const k = `${x.fromOwnerId}|${x.customerId}`;
        if (!标日.has(k)) 标日.set(k, beijingDay(x.at));
      }
    }
    const 结果: 离职待交接[] = [];
    for (const u of 人们) {
      const 客户们 = 客户们of.get(u.id) ?? [];
      const 项目们 = 项目们of.get(u.id) ?? [];
      const [线索, 渠道, 主渠道, 待办] = [数.线索.get(u.id) ?? 0, 数.渠道.get(u.id) ?? 0, 数.主渠道.get(u.id) ?? 0, 数.待办.get(u.id) ?? 0];
      if (!客户们.length && !项目们.length && !线索 && !渠道 && !主渠道 && !待办) continue;
      // 他自己的、待分配的、别的已停用同事进行中的
      const 算项目 = (p: { ownerId: string; awaitAssignAt: Date | null; result: string | null }) =>
        p.ownerId === u.id || p.awaitAssignAt !== null || (停用.has(p.ownerId) && p.result === null);
      // 离职交接等确认：清点了客户的只算清点的；几笔的合起来，一位客户落在几笔里按最早发起那笔算挂起
      const 这几笔 = (交接of.get(u.id) ?? []).map((h) => {
        const 起日 = beijingDay(h.createdAt);
        return { 清点: 清点的客户(h.customerIds), 挂: { 起日, 接手人: 上级名.get(h.toUserId) ?? null, 挂起天数: 差天(起日, 今天), 挂起工作日: 工作日数(起日, 今天), 超期: 交接挂起超了(起日, 今天) } };
      });
      const 挂of = (cid: string) => 这几笔.find((x) => !x.清点 || x.清点.has(cid))?.挂;
      结果.push({
        id: u.id,
        name: u.name,
        上级: 上级of.get(u.id) ? 上级名.get(上级of.get(u.id)!) ?? null : null,
        交接中: 交接中.has(u.id),
        客户: 客户们.map((c) => {
          const 标 = 标日.get(`${u.id}|${c.id}`);
          return { id: c.id, name: c.name, 项目数: (客户上的项目of.get(c.id) ?? []).filter(算项目).length, ...(挂of(c.id) ? { 交接中: 挂of(c.id)! } : {}), ...(标 ? { 待交接日: 标, 挂起天数: 差天(标, 今天), 挂起工作日: 工作日数(标, 今天), 超期: 交接挂起超了(标, 今天) } : {}) };
        }),
        项目: 项目们.map((p) => ({ id: p.id, name: p.name, 客户: p.customer.name })),
        其余: { 线索, 渠道, 主渠道, 待办 },
      });
    }
    return 结果;
  });
}

/**
 * 页头入口上的数：我能处理、名下还有东西的离职成员几位。
 * 客户页每次加载都调：原来每位离职成员最多 5 条 count，现在每样东西一句 groupBy（代码体检 5.2 N+1 第 1 条），查库次数不随人数涨
 */
export async function 待交接人数(me: 谁): Promise<number> {
  const ids = await 我管的离职(me);
  if (!ids.length) return 0;
  const 带项目 = await 项目模式();
  return 看全部(async () => {
    const 有 = new Set<string>();
    for (const 批 of 分批(ids)) {
      const 人 = { in: 批 };
      const [客户, 项目, 线索, 渠道, 主渠道] = await Promise.all([
        prisma.customer.groupBy({ by: ["salesOwnerId"], where: { salesOwnerId: 人, pool: { is: null } } }),
        带项目 ? prisma.project.groupBy({ by: ["ownerId"], where: { ownerId: 人, pooledAt: null, result: null, OR: 挂在别人客户上(批) } }) : [],
        prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: 人 } }),
        prisma.channel.groupBy({ by: ["channelOwnerId"], where: { channelOwnerId: 人 } }),
        prisma.entChannelMain.groupBy({ by: ["ownerId"], where: { ownerId: 人 } }),
      ]);
      for (const g of 客户) 有.add(g.salesOwnerId);
      for (const g of 项目) 有.add(g.ownerId);
      for (const g of 线索) if (g.ownerId) 有.add(g.ownerId);
      for (const g of 渠道) if (g.channelOwnerId) 有.add(g.channelOwnerId);
      for (const g of 主渠道) if (g.ownerId) 有.add(g.ownerId);
    }
    return 有.size;
  });
}

/**
 * 页头「离职交接」入口：null = 不摆；数字 = 摆，>0 时带上待交接人数。
 * 有待交接的就摆；没有待交接、但我是谁的手填直属上级（在这一页给下属办离职）也摆，数是 0
 */
export async function 离职交接入口(me: 谁): Promise<number | null> {
  const org = await 权限组织();
  if (!org || 只读角色(me, org)) return null;
  const n = await 待交接人数(me);
  if (n > 0) return n;
  if (能改后台设置(me, org)) return null;
  // 有在职的直属下属：组织里只收在职的人、managerId 是手填的直属上级，和原来查 EntMember + 数在职同一个口径，不再另查
  const 有下属 = [...org.成员.values()].some((m) => m.managerId === me.id && m.userId !== me.id);
  return 有下属 ? 0 : null;
}

/** 交之前的共同检查：能处理这个人、没有老的交接中、接手人能接。不行返回那句话 */
export async function 交接挡(me: 谁, fromId: string, toId: string): Promise<string | null> {
  if (!(await 能交接(me, fromId))) return "FORBIDDEN";
  if (await 离职交接中(fromId)) return "这位成员还有一笔离职交接在等接手人确认：先在客户页「交接中」里撤回";
  if (typeof toId !== "string" || !toId || toId === fromId) return "先选接手人";
  const org = await 权限组织();
  return 公海分不给话(me, org, toId);
}

/**
 * 持有上限（M-公海-18，11-09 拦；11-11 起核和交在同一个事务里）：交一位客户 / 交一个项目 / 全部交给，动手前记下接手人名下原有几个，
 * 交完再数，比原来多了又超了上限就抛 整批超上限、整个事务回滚，一个都没交（调用方用 整批或不做 接住回那句话）；并发的两次后到的那次整批失败。
 * 拦的范围照旧：交一位客户 = 跟着客户走的他自己的（含待分配的）+ 同事待分配的 + 已停用同事进行中的（带走一位 deactivate）；
 * 交一个项目 = 这一个（待分配的交过去清掉，也算）；全部交给 = 此刻分拣给接手人的。都是真进接手人手上的，写完再数就是原来先数的那个数。
 * 没开项目模式不动项目，数出来不会多，自然不拦
 */
const 交接超上限尾 = "这次一个都没交；先让接手人推进或放回一些，或者换一位接手人";

/** 交一位客户：负责人还是他、不在公海才交；没做完的活跟着走，开了项目模式项目跟着客户走 */
export async function 交一位客户(me: 谁, fromId: string, customerId: string, toId: string): Promise<boolean> {
  const 带项目 = await 项目模式();
  const 规则 = await 生效组织规则();
  await 钉住老签约();
  return 看全部(() => 查完再写(async (tx) => {
    const 起 = await 持有上限起点(tx, 规则, toId);
    const 改 = await tx.customer.updateMany({ where: { id: customerId, salesOwnerId: fromId, pool: { is: null } }, data: { salesOwnerId: toId } });
    if (!改.count) return false;
    await 带走一位(tx, customerId, fromId, toId, me.id, "deactivate", 带项目);
    await 整批核上限(tx, 起, "交接", 交接超上限尾);
    return true;
  }));
}

/** 交一个项目（项目模式才有）：还是他负责、没进公海、没结局才交 */
export async function 交一个项目(me: 谁, fromId: string, projectId: string, toId: string): Promise<boolean> {
  if (!(await 项目模式())) return false;
  const 规则 = await 生效组织规则();
  const ids = await 看全部(() => 查完再写(async (tx) => {
    const 起 = await 持有上限起点(tx, 规则, toId);
    const 转了 = await 转项目(tx, { id: projectId, ownerId: fromId, pooledAt: null, result: null }, toId, me.id);
    // 他自己占着待分配的，交过去清待分配（P-转-20、X-84）
    if (转了.length) await tx.project.updateMany({ where: { id: { in: 转了 }, awaitAssignAt: { not: null } }, data: { awaitAssignAt: null } });
    await 整批核上限(tx, 起, "交接", 交接超上限尾);
    return 转了;
  }));
  return ids.length > 0;
}

/** 一键全部交给一个人：同原来办离职的「全部转交」，客户、商机、待办计划、线索、渠道（连他当负责人的主渠道），开了项目模式再加项目 */
export async function 全部交给(me: 谁, fromId: string, toId: string) {
  const 带项目 = await 项目模式();
  const 规则 = await 生效组织规则();
  await 钉住老签约();
  const 记分配 = await 规则开着("线索分配");
  return 看全部(() => 查完再写(async (tx) => {
    const 起 = await 持有上限起点(tx, 规则, toId);
    const 分 = await 停用分拣(tx, fromId, "转交", true);
    if (!带项目) 分.项目 = [];
    const 项目 = await 离职转给接手人(tx, 分, fromId, toId, me.id, 记分配);
    await 整批核上限(tx, 起, "交接", 交接超上限尾);
    return { 客户: 分.客户, 商机: 分.商机, 待办: 分.待办, 计划: 分.计划, 线索: 分.线索, 渠道: 分.渠道, 主渠道: 分.主渠道, 项目 };
  }, { timeout: 30_000 }));
}
