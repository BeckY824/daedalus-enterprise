import type { Prisma } from "@/generated/prisma";
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
import { 待确认, 了结, 读ids, 离职范围of, 离职盖住的客户, 离职盖住的项目, 离职段 } from "@/lib/enterprise/handover-db";

export { 离职段 };
import { 权限组织 } from "@/lib/enterprise/org";
import { 能改后台设置, 只读角色, 公海分不给话, 是总管理, type 谁 } from "@/lib/enterprise/permissions";
import { 待交接理由 } from "@/lib/enterprise/tri-state-quota";
import { 差天, 工作日数, 交接挂起超了 } from "@/lib/enterprise/tri-state";
import { beijingDay } from "@/lib/business-clock";

/**
 * 离职交接看板（11-03 B7-2）：办离职时名下客户、项目原地不动（负责人仍是他，C4-4），
 * 之后由他的直属上级（手填的 managerId）或系统管理员在「项目 → 离职交接」里一条条、或一键全部交给接手人。
 *
 * - 直属上级读 EntMember.managerId：组织表（读组织）只有在职的人，离职的人在里面找不到上级
 * - 接手人候选同公海分配（公海分不给话）：在职、有业务角色、不是只读；不限业务线（P-转-08，覆盖 11-03 B2-7）
 * - 11-13 起（客户原话「离职交接也必须接手人点确认才生效」「避免悄悄转过去没人知道」，不做开关）：交一位客户、交一个项目、全部交给
 *   都只记一行待确认交接（EntHandover kind=离职，way = 客户 / 项目 / 全部，发起交一位客户 等），数据留在他名下，接手人在客户页
 *   「等你确认的交接」里确认了才转（确认离职交接）；接手人可拒收，发起人和总管理可撤回、可改接手人（customers/handover-actions.ts）。
 *   同一位客户、同一个项目不能同时交两笔（撞了）。离职交接不作废：挂满 7 天在看板上标「已等 N 天」
 * - 确认时照原来当场交的老规矩：单条客户走 带走一位（没做完的活跟着走、项目跟着客户、记历史负责人 kind=deactivate）；
 *   项目走 转项目（记转让痕、卡点认领跟着）；全部 = 原来办离职时的「全部转交」（停用分拣 + 离职转给接手人），
 *   线索、渠道（连他当负责人的主渠道，迁移 118）也一起给；被别的路径动过的（进了公海、换了人、结束了）跳过
 * - 没开项目模式：只列客户，不动项目（单条不带项目，一键时项目那份清空）
 * - 交过去的客户备注末尾留一行「日期 离职交接：原负责人 → 接手人（操作人）」（客户 11-13，留交接备注）：确认当天、操作人是发起人；只交项目的不写
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
  交接中?: 等确认;
};
/**
 * 一笔还在等接手人确认的离职交接（看板上这一行 / 这张卡显示「等 X 确认」，不能再交）：
 * 挂起天数从发起那天算；满 7 天看板上标「已等 N 天」提醒发起人（离职交接不作废）；我能撤回 = 我是发起人或总管理（同 了结）
 */
export type 等确认 = {
  id: string; 起日: string; 接手人: string | null; 接手人id: string; 挂起天数: number; 挂起工作日: number; 超期: boolean; 我能撤回: boolean;
};
export type 交接项目 = { id: string; name: string; 客户: string; 交接中?: 等确认 };
export type 离职待交接 = {
  id: string;
  name: string;
  /** 他的直属上级（手填的）叫什么；没填 = null */
  上级: string | null;
  /** 有一笔「全部交给」（或办离职时发起的老行）在等接手人确认：整张卡都不让再交，等确认或撤回 */
  交接中: boolean;
  /** 那笔「全部」的明细（交接中 = true 时有） */
  整包?: 等确认;
  /** 单条交客户 / 交项目还在等确认的笔数：有的时候「全部交给」先不让点 */
  单条等确认: number;
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

/** 我能处理的离职成员 id：系统管理员 = 全部离职的；上级 = 手填直属上级是我的。顺手带回读到的组织（看板判「我能撤回」用，不再读一遍） */
async function 我管的离职of(me: 谁): Promise<{ ids: string[]; org: Awaited<ReturnType<typeof 权限组织>> }> {
  const org = await 权限组织();
  return { ids: await 我管的离职于(me, org), org };
}
const 我管的离职 = async (me: 谁) => (await 我管的离职of(me)).ids;

async function 我管的离职于(me: 谁, org: Awaited<ReturnType<typeof 权限组织>>): Promise<string[]> {
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

/**
 * 看板的数据：只列名下还有东西（客户、项目、线索、渠道、待办）的人。
 * 所有离职成员一起查、内存里按人分（代码体检 5.2 N+1 第 3 条）：查库次数不随人数涨（过 一批人 位才多一轮），每位的数和原来逐位查的一样
 */
export async function 读离职交接(me: 谁): Promise<离职待交接[]> {
  const { ids, org } = await 我管的离职of(me);
  if (!ids.length) return [];
  const 带项目 = await 项目模式();
  return 看全部(async () => {
    const 人们 = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const 上级of = new Map((await prisma.entMember.findMany({ where: { userId: { in: ids } }, select: { userId: true, managerId: true } })).map((m) => [m.userId, m.managerId]));
    // 还在等接手人确认的离职交接：先读出来，接手人的名字和上级的名字一句取（不另查）；同一位有几笔的，几笔清点的客户合起来算（同 tri-state-db.ts 离职交接中的）
    const 交接们: { id: string; fromUserId: string; toUserId: string; byUserId: string; createdAt: Date; customerIds: string; projectIds: string; way: string | null }[] = [];
    for (const 批 of 分批(ids)) {
      交接们.push(...(await prisma.entHandover.findMany({
        where: { kind: "离职", fromUserId: { in: 批 }, status: 待确认 },
        select: { id: true, fromUserId: true, toUserId: true, byUserId: true, createdAt: true, customerIds: true, projectIds: true, way: true },
        orderBy: { createdAt: "asc" },
      })));
    }
    // 撤回别人发起的：总管理（同 了结 / 能撤回别人的交接），组织上面已经读过
    const 管 = !!org && 是总管理(me, org);
    const 交接of = new Map<string, (typeof 交接们)[number][]>();
    for (const h of 交接们) 交接of.set(h.fromUserId, [...(交接of.get(h.fromUserId) ?? []), h]);
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
      // 离职交接等确认：单条交客户的算列的那几位、单条交项目的算列的项目，全部的（老行没清点的）算他名下的都在等（handover-db.ts 离职盖住的客户）；
      // 几笔的合起来，一位客户落在几笔里按最早发起那笔算挂起
      const 这几笔 = (交接of.get(u.id) ?? []).map((h) => {
        const 起日 = beijingDay(h.createdAt);
        const 挂: 等确认 = {
          id: h.id, 起日, 接手人: 上级名.get(h.toUserId) ?? null, 接手人id: h.toUserId,
          挂起天数: 差天(起日, 今天), 挂起工作日: 工作日数(起日, 今天), 超期: 交接挂起超了(起日, 今天), 我能撤回: 管 || h.byUserId === me.id,
        };
        return { 整包: 离职范围of(h.way) === "全部", 客户: 离职盖住的客户(h), 项目: 离职盖住的项目(h), 挂 };
      });
      const 挂of = (cid: string) => 这几笔.find((x) => !x.客户 || x.客户.has(cid))?.挂;
      const 项目挂of = (pid: string) => 这几笔.find((x) => !x.项目 || x.项目.has(pid))?.挂;
      const 整包 = 这几笔.find((x) => x.整包)?.挂;
      结果.push({
        id: u.id,
        name: u.name,
        上级: 上级of.get(u.id) ? 上级名.get(上级of.get(u.id)!) ?? null : null,
        交接中: !!整包,
        ...(整包 ? { 整包 } : {}),
        单条等确认: 这几笔.filter((x) => !x.整包).length,
        客户: 客户们.map((c) => {
          const 标 = 标日.get(`${u.id}|${c.id}`);
          return { id: c.id, name: c.name, 项目数: (客户上的项目of.get(c.id) ?? []).filter(算项目).length, ...(挂of(c.id) ? { 交接中: 挂of(c.id)! } : {}), ...(标 ? { 待交接日: 标, 挂起天数: 差天(标, 今天), 挂起工作日: 工作日数(标, 今天), 超期: 交接挂起超了(标, 今天) } : {}) };
        }),
        项目: 项目们.map((p) => ({ id: p.id, name: p.name, 客户: p.customer.name, ...(项目挂of(p.id) ? { 交接中: 项目挂of(p.id)! } : {}) })),
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

/** 交之前的共同检查：能处理这个人、接手人能接。不行返回那句话。和已有待确认交接撞没撞在发起的事务里查（发起交接） */
export async function 交接挡(me: 谁, fromId: string, toId: string): Promise<string | null> {
  if (!(await 能交接(me, fromId))) return "FORBIDDEN";
  if (typeof toId !== "string" || !toId || toId === fromId) return "先选接手人";
  const org = await 权限组织();
  return 公海分不给话(me, org, toId);
}

/** 离职交接转完留在客户备注里的那一行（客户 11-13：别「悄悄转过去没人知道」）。日期是上海日 */
export function 交接备注行(日: string, 原负责人: string, 接手人: string, 操作人: string): string {
  return `${日} 离职交接：原负责人 ${原负责人} → 接手人 ${接手人}（操作人 ${操作人}）`;
}

/** 备注末尾追加一行：原有内容不动，只把末尾空白规整掉再换行接上；同一行已经有了 = null（不用写） */
export function 追加备注行(原: string | null, 行: string): string | null {
  const 留 = (原 ?? "").trimEnd();
  if (留.split("\n").some((l) => l.trim() === 行)) return null;
  return 留 ? `${留}\n${行}` : 行;
}

/**
 * 交过去的客户每位备注末尾留一行「日期 离职交接：原负责人 → 接手人（操作人）」，和换负责人同一个事务。
 * 11-13 起在接手人确认那一刻写：日期是确认当天，操作人是发起的那位。只改 remark：不碰最近跟进；updatedAt 跟着换负责人那一下本来就会刷
 */
export async function 留交接备注(tx: Prisma.TransactionClient, 客户: readonly string[], fromId: string, toId: string, 操作人: string): Promise<void> {
  if (!客户.length) return;
  const 名of = new Map((await tx.user.findMany({ where: { id: { in: [...new Set([fromId, toId, 操作人])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const 行 = 交接备注行(beijingDay(new Date()), 名of.get(fromId) ?? fromId, 名of.get(toId) ?? toId, 名of.get(操作人) ?? 操作人);
  for (const c of await tx.customer.findMany({ where: { id: { in: [...客户] } }, select: { id: true, remark: true } })) {
    const 新 = 追加备注行(c.remark, 行);
    if (新 !== null) await tx.customer.update({ where: { id: c.id }, data: { remark: 新 } });
  }
}

/* ───────────── 发起：只记一行待确认（客户 11-13「离职交接也必须接手人点确认才生效」，不做开关） ───────────── */

type 待确认行 = { id: string; way: string | null; toUserId: string; customerIds: string; projectIds: string };

/**
 * 和这位离职成员已有的待确认交接撞没撞（同一位客户、同一个项目不能同时交给两个人，P-转-05 / X-38 的「不能重复交」）：
 *   已有「全部」（含办离职时发起的老行）在等 = 什么都不能再发起；要发起「全部」时还有单条在等 = 先等确认或撤回；
 *   单条交客户 / 交项目撞上同一位 / 同一个 = 不让。返回那句话，没撞 = null
 */
async function 撞了(tx: Prisma.TransactionClient, fromId: string, 要: { 范围: "客户"; id: string } | { 范围: "项目"; id: string } | { 范围: "全部" }): Promise<string | null> {
  const 行们: 待确认行[] = await tx.entHandover.findMany({ where: { kind: "离职", fromUserId: fromId, status: 待确认 }, select: { id: true, way: true, toUserId: true, customerIds: true, projectIds: true } });
  if (!行们.length) return null;
  const 名 = async (id: string) => (await tx.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "接手人";
  const 整包 = 行们.find((h) => 离职范围of(h.way) === "全部");
  if (整包) return `TA 名下的已经全部交给 ${await 名(整包.toUserId)}、在等确认：先撤回这笔，或等对方确认`;
  if (要.范围 === "全部") return `TA 还有 ${行们.length} 笔单条交接在等接手人确认：等对方确认或撤回后再全部交给`;
  const 撞 = 行们.find((h) => (要.范围 === "客户" ? 离职盖住的客户(h) : 离职盖住的项目(h))?.has(要.id));
  return 撞 ? `${要.范围 === "客户" ? "这位客户" : "这个项目"}已经交给 ${await 名(撞.toUserId)}、在等确认，不能重复交` : null;
}

export type 发起结果 = { ok: true; 交接: string; 客户: string[]; 项目: string[]; 段: string } | { ok: false; error: string };

/** 交一位客户（发起）：负责人还是他、不在公海才能发起；客户先不换负责人，等接手人确认 */
export async function 发起交一位客户(me: 谁, fromId: string, customerId: string, toId: string): Promise<发起结果> {
  return 看全部(() => 查完再写(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, salesOwnerId: fromId, pool: { is: null } }, select: { id: true } });
    if (!c) return { ok: false as const, error: "这位客户已不在 TA 名下，刷新看看" };
    const 话 = await 撞了(tx, fromId, { 范围: "客户", id: customerId });
    if (话) return { ok: false as const, error: 话 };
    const 个数 = { 客户: 1 };
    const h = await tx.entHandover.create({ data: { kind: "离职", way: "客户", fromUserId: fromId, toUserId: toId, byUserId: me.id, customerIds: JSON.stringify([customerId]), counts: JSON.stringify(个数) } });
    return { ok: true as const, 交接: h.id, 客户: [customerId], 项目: [], 段: 离职段(个数) };
  }));
}

/** 交一个项目（发起，项目模式才有）：还是他负责、没进公海、没结局才能发起 */
export async function 发起交一个项目(me: 谁, fromId: string, projectId: string, toId: string): Promise<发起结果> {
  if (!(await 项目模式())) return { ok: false, error: "这个项目已不在 TA 名下，刷新看看" };
  return 看全部(() => 查完再写(async (tx) => {
    const p = await tx.project.findFirst({ where: { id: projectId, ownerId: fromId, pooledAt: null, result: null }, select: { id: true } });
    if (!p) return { ok: false as const, error: "这个项目已不在 TA 名下，刷新看看" };
    const 话 = await 撞了(tx, fromId, { 范围: "项目", id: projectId });
    if (话) return { ok: false as const, error: 话 };
    const 个数 = { 项目: 1 };
    const h = await tx.entHandover.create({ data: { kind: "离职", way: "项目", fromUserId: fromId, toUserId: toId, byUserId: me.id, projectIds: JSON.stringify([projectId]), counts: JSON.stringify(个数) } });
    return { ok: true as const, 交接: h.id, 客户: [], 项目: [projectId], 段: 离职段(个数) };
  }));
}

/**
 * 一键全部交给（发起）：按此刻分拣清点一遍（同原来的「全部转交」），记下客户和个数给接手人看；确认时再按那时候重新分拣。
 * 一样都没有 = 不建交接（段为空，交接 = ""）
 */
export async function 发起全部交给(me: 谁, fromId: string, toId: string): Promise<发起结果> {
  const 带项目 = await 项目模式();
  return 看全部(() => 查完再写(async (tx) => {
    const 话 = await 撞了(tx, fromId, { 范围: "全部" });
    if (话) return { ok: false as const, error: 话 };
    const 分 = await 停用分拣(tx, fromId, "转交", true);
    if (!带项目) 分.项目 = [];
    const 个数 = { 客户: 分.客户.length, 项目: 分.项目.length, 计划和待办: 分.计划.length + 分.待办.length, 线索: 分.线索.length, 渠道: 分.渠道.length, 主渠道: 分.主渠道.length };
    const 段 = 离职段(个数);
    if (!段) return { ok: true as const, 交接: "", 客户: [], 项目: [], 段: "" };
    const h = await tx.entHandover.create({ data: { kind: "离职", way: "全部", fromUserId: fromId, toUserId: toId, byUserId: me.id, customerIds: JSON.stringify(分.客户), counts: JSON.stringify(个数) } });
    return { ok: true as const, 交接: h.id, 客户: 分.客户, 项目: 分.项目, 段 };
  }, { timeout: 30_000 }));
}

/* ───────────── 确认：接手人点了确认才真转（照原来当场交的老规矩） ───────────── */

/**
 * 持有上限（M-公海-18，11-09 拦；11-11 起核和交在同一个事务里；11-13 起核在确认那一刻）：确认前记下接手人名下原有几个，转完再数，
 * 比原来多了又超了上限就抛 整批超上限、整个事务回滚，一个都没转、交接还是待确认（调用方用 整批或不做 接住回那句话）；并发的两次后到的那次整批失败。
 * 拦的范围照旧：交一位客户 = 跟着客户走的他自己的（含待分配的）+ 同事待分配的 + 已停用同事进行中的（带走一位 deactivate）；
 * 交一个项目 = 这一个（待分配的交过去清掉，也算）；全部交给 = 此刻分拣给接手人的。没开项目模式不动项目，数出来不会多，自然不拦
 */
export const 确认超上限尾 = "这笔交接没有确认、还在等你确认；先推进或放回一些再确认，或者请发起人撤回后换人";

export type 离职确认 = {
  客户: string[];
  项目: string[];
  /** 实际转过去的「N 位客户、M 个项目…」；一样没转成为空 */
  段: string;
  /** 转不了跳过的（交接期间被放回公海、换了人、结束了、删了）：几位客户、几个项目，没有为空 */
  跳过: string;
  /** 全部那种的分拣明细（留痕用） */
  分?: Awaited<ReturnType<typeof 停用分拣>>;
};

/**
 * 接手人确认一笔 11-13 起发起的离职交接（way = 客户 / 项目 / 全部），一个事务：先把「待确认 → 已确认」带条件改了（和撤回、拒收同时点只成一个），
 * 再按此刻的数据转（被别的路径动过的跳过），核持有上限（超了抛 整批超上限、整笔回滚，交接还是待确认），交过去的客户备注留一行。
 * 操作人记发起的那位（是他定的交给谁），备注日期是确认当天。改不成（已被处理）返回 null。调用方用 整批或不做 接住
 */
export async function 确认离职交接(me: { id: string; role: string }, h: { id: string; way: string | null; fromUserId: string; byUserId: string; customerIds: string; projectIds: string }): Promise<离职确认 | null> {
  const 范围 = 离职范围of(h.way);
  const 带项目 = await 项目模式();
  const 规则 = await 生效组织规则();
  await 钉住老签约();
  const 记分配 = 范围 === "全部" ? await 规则开着("线索分配") : false;
  const from = h.fromUserId, to = me.id, 操作人 = h.byUserId;
  return 看全部(() => 查完再写(async (tx) => {
    if (!(await 了结(tx, h.id, "已确认", me))) return null;
    const 起 = await 持有上限起点(tx, 规则, to);
    if (范围 === "客户") {
      const 要 = 读ids(h.customerIds);
      const 转了: string[] = [];
      for (const cid of 要) {
        const 改 = await tx.customer.updateMany({ where: { id: cid, salesOwnerId: from, pool: { is: null } }, data: { salesOwnerId: to } });
        if (!改.count) continue;
        await 带走一位(tx, cid, from, to, 操作人, "deactivate", 带项目);
        转了.push(cid);
      }
      await 整批核上限(tx, 起, "交接", 确认超上限尾);
      await 留交接备注(tx, 转了, from, to, 操作人);
      const 跳 = 要.length - 转了.length;
      return { 客户: 转了, 项目: [], 段: 离职段({ 客户: 转了.length }), 跳过: 跳 ? `${跳} 位客户` : "" };
    }
    if (范围 === "项目") {
      const 要 = 读ids(h.projectIds);
      // 没开项目模式了：项目不动，按转不了跳过
      const 转了 = 带项目 && 要.length ? await 转项目(tx, { id: { in: 要 }, ownerId: from, pooledAt: null, result: null }, to, 操作人) : [];
      // 他自己占着待分配的，交过去清待分配（P-转-20、X-84）
      if (转了.length) await tx.project.updateMany({ where: { id: { in: 转了 }, awaitAssignAt: { not: null } }, data: { awaitAssignAt: null } });
      await 整批核上限(tx, 起, "交接", 确认超上限尾);
      const 跳 = 要.length - 转了.length;
      return { 客户: [], 项目: 转了, 段: 离职段({ 项目: 转了.length }), 跳过: 跳 ? `${跳} 个项目` : "" };
    }
    // 全部：按此刻重新分拣（发起之后他名下又多出、少了的都对得上；进了公海的不转，谁领谁接）
    const 分 = await 停用分拣(tx, from, "转交", true);
    if (!带项目) 分.项目 = [];
    const 项目 = await 离职转给接手人(tx, 分, from, to, 操作人, 记分配);
    await 整批核上限(tx, 起, "交接", 确认超上限尾);
    await 留交接备注(tx, 分.客户, from, to, 操作人);
    const 原 = 读ids(h.customerIds);
    const 现 = new Set(分.客户);
    const 跳 = 原.filter((id) => !现.has(id)).length;
    return {
      客户: 分.客户, 项目, 分,
      段: 离职段({ 客户: 分.客户.length, 项目: 项目.length, 计划和待办: 分.计划.length + 分.待办.length, 线索: 分.线索.length, 渠道: 分.渠道.length, 主渠道: 分.主渠道.length }),
      跳过: 跳 ? `${跳} 位客户` : "",
    };
  }, { timeout: 30_000 }));
}
