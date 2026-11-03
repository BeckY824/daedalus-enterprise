import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 带走一位, 转项目 } from "@/lib/carry-over-db";
import { 看全部 } from "@/lib/team-scope";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 停用分拣 } from "@/lib/offboard-db";
import { 离职转给接手人 } from "@/lib/offboard-move";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 离职交接中 } from "@/lib/enterprise/handover-db";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能改后台设置, 只读角色, 公海分不给话, type 谁 } from "@/lib/enterprise/permissions";

/**
 * 离职交接看板（11-03 B7-2）：办离职时名下客户、项目原地不动（负责人仍是他，C4-4），
 * 之后由他的直属上级（手填的 managerId）或系统管理员在「项目 → 离职交接」里一条条、或一键全部交给接手人。
 *
 * - 直属上级读 EntMember.managerId：组织表（读组织）只有在职的人，离职的人在里面找不到上级
 * - 接手人候选同公海分配（B2-7，公海分不给话）：在职、有业务角色、不是只读；条线的上级只能交给同线的
 * - 单条交走现有改负责人的逻辑（带走一位：没做完的活跟着走、项目跟着客户、记历史负责人 kind=deactivate；
 *   项目走 转项目，记转让痕、卡点认领跟着）；一键全部交给 = 原来办离职时的「全部转交」（停用分拣 + 离职转给接手人），
 *   线索、渠道也一起给
 * - 没开项目模式：只列客户，不动项目（单条不带项目，一键时项目那份清空）
 * - 查的、改的都包 看全部：按组织看客户开着时，上级的范围里不一定有离职下属的客户
 */

export type 交接客户 = { id: string; name: string; 项目数: number };
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
  /** 一键全部交给时才一起走的：线索、渠道、挂在别人客户上的待办 */
  其余: { 线索: number; 渠道: number; 待办: number };
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
  const 下属 = 全部 ? null : (await prisma.entMember.findMany({ where: { managerId: me.id }, select: { userId: true } })).map((m) => m.userId);
  const 们 = await prisma.user.findMany({
    where: { active: false, email: { not: 无负责人占位邮箱 }, ...(下属 ? { id: { in: 下属 } } : {}) },
    select: { id: true },
  });
  return 们.map((u) => u.id);
}

const 项目模式 = async () => (await getBusiness()).projectMode === true;

/** 看板的数据：只列名下还有东西（客户、项目、线索、渠道、待办）的人 */
export async function 读离职交接(me: 谁): Promise<离职待交接[]> {
  const ids = await 我管的离职(me);
  if (!ids.length) return [];
  const 带项目 = await 项目模式();
  return 看全部(async () => {
    const 人们 = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const 上级of = new Map((await prisma.entMember.findMany({ where: { userId: { in: ids } }, select: { userId: true, managerId: true } })).map((m) => [m.userId, m.managerId]));
    const 上级ids = [...new Set([...上级of.values()].filter((x): x is string => !!x))];
    const 上级名 = new Map((await prisma.user.findMany({ where: { id: { in: 上级ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 结果: 离职待交接[] = [];
    for (const u of 人们) {
      // 同 停用分拣：在公海里的不算他的（谁领谁接）
      const 客户们 = await prisma.customer.findMany({
        where: { salesOwnerId: u.id, pool: { is: null } },
        select: { id: true, name: true, ...(带项目 ? { _count: { select: { projects: { where: { pooledAt: null } } } } } : {}) },
        orderBy: { name: "asc" },
      });
      const 项目们 = 带项目
        ? await prisma.project.findMany({
            where: { ownerId: u.id, pooledAt: null, result: null, customer: { salesOwnerId: { not: u.id } } },
            select: { id: true, name: true, customer: { select: { name: true } } },
            orderBy: { name: "asc" },
          })
        : [];
      const [线索, 渠道, 待办] = await Promise.all([
        prisma.lead.count({ where: { ownerId: u.id } }),
        prisma.channel.count({ where: { channelOwnerId: u.id } }),
        // 同 停用分拣：他名下客户上的待办跟着客户走（在公海里的谁领谁带），这里数挂在别人客户上的
        prisma.task.count({ where: { ownerId: u.id, done: false, customer: { salesOwnerId: { not: u.id } } } }),
      ]);
      if (!客户们.length && !项目们.length && !线索 && !渠道 && !待办) continue;
      结果.push({
        id: u.id,
        name: u.name,
        上级: 上级of.get(u.id) ? 上级名.get(上级of.get(u.id)!) ?? null : null,
        交接中: !!(await 离职交接中(u.id)),
        客户: 客户们.map((c) => ({ id: c.id, name: c.name, 项目数: "_count" in c ? (c._count as { projects: number }).projects : 0 })),
        项目: 项目们.map((p) => ({ id: p.id, name: p.name, 客户: p.customer.name })),
        其余: { 线索, 渠道, 待办 },
      });
    }
    return 结果;
  });
}

/** 页头入口上的数：我能处理、名下还有东西的离职成员几位 */
export async function 待交接人数(me: 谁): Promise<number> {
  const ids = await 我管的离职(me);
  if (!ids.length) return 0;
  const 带项目 = await 项目模式();
  return 看全部(async () => {
    let n = 0;
    for (const id of ids) {
      const 有 = (await prisma.customer.count({ where: { salesOwnerId: id, pool: { is: null } } }))
        || (带项目 && (await prisma.project.count({ where: { ownerId: id, pooledAt: null, result: null, customer: { salesOwnerId: { not: id } } } })))
        || (await prisma.lead.count({ where: { ownerId: id } }))
        || (await prisma.channel.count({ where: { channelOwnerId: id } }));
      if (有) n++;
    }
    return n;
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
  const 下属 = (await prisma.entMember.findMany({ where: { managerId: me.id }, select: { userId: true } })).map((m) => m.userId).filter((id) => id !== me.id);
  const 有下属 = 下属.length ? await prisma.user.count({ where: { active: true, id: { in: 下属 } } }) : 0;
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

/** 交一位客户：负责人还是他、不在公海才交；没做完的活跟着走，开了项目模式项目跟着客户走 */
export async function 交一位客户(me: 谁, fromId: string, customerId: string, toId: string): Promise<boolean> {
  const 带项目 = await 项目模式();
  await 钉住老签约();
  return 看全部(() => prisma.$transaction(async (tx) => {
    const 改 = await tx.customer.updateMany({ where: { id: customerId, salesOwnerId: fromId, pool: { is: null } }, data: { salesOwnerId: toId } });
    if (!改.count) return false;
    await 带走一位(tx, customerId, fromId, toId, me.id, "deactivate", 带项目);
    return true;
  }));
}

/** 交一个项目（项目模式才有）：还是他负责、没进公海、没结局才交 */
export async function 交一个项目(me: 谁, fromId: string, projectId: string, toId: string): Promise<boolean> {
  if (!(await 项目模式())) return false;
  const ids = await 看全部(() => prisma.$transaction((tx) => 转项目(tx, { id: projectId, ownerId: fromId, pooledAt: null, result: null }, toId, me.id)));
  return ids.length > 0;
}

/** 一键全部交给一个人：同原来办离职的「全部转交」，客户、商机、待办计划、线索、渠道，开了项目模式再加项目 */
export async function 全部交给(me: 谁, fromId: string, toId: string) {
  const 带项目 = await 项目模式();
  await 钉住老签约();
  const 记分配 = await 规则开着("线索分配");
  return 看全部(() => prisma.$transaction(async (tx) => {
    const 分 = await 停用分拣(tx, fromId, "转交", true);
    if (!带项目) 分.项目 = [];
    const 项目 = await 离职转给接手人(tx, 分, fromId, toId, me.id, 记分配);
    return { 客户: 分.客户, 商机: 分.商机, 待办: 分.待办, 计划: 分.计划, 线索: 分.线索, 渠道: 分.渠道, 项目 };
  }, { timeout: 30_000 }));
}
