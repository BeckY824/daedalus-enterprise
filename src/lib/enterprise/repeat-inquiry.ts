/**
 * 重复咨询第一步 · 出口 C（客户 11-22 定稿《重复咨询-最终方案》，11-23 确认）：
 * 市场成员（渠道运营、市场管理）查号码撞上同事名下的客户，可以「在客户负责人名下新建线索」——不新建客户、不动号码，
 * 客户的来源、联系人、负责人、旧项目都不改；新线索：客户 = 撞上的那位，负责人 = 客户负责人，创建人 = 市场成员，项目来源 = 这次选的渠道，
 * 从起点节点起，分配方式记「指定分配」、计入负责人本月已分，带「老客户重复咨询」标记（Project.source = 重复咨询来源），
 * 市场分给销售进线索验证；这次的沟通记在新线索上、记录人是市场成员。
 *
 * 这里放判定（出口C可用）和事务里那几步要的小件；动作本身在 customers/repeat-inquiry-actions.ts（建档向导、首页查重框、首页 AI 新线索卡共用）。
 *
 * 谁能用、什么时候出按钮（第一步，客户 11-22 方案第 5 节）：
 *   - 发起人是市场成员（是市场成员of：渠道运营 / 市场管理、不兼销售、没设只看某人；同查重领取）
 *   - 号码首条撞上的客户不在公海、有负责人、负责人不是我
 *   - 客户负责人「能接指定分配」：在职的销售 / 销售管理，规则「线索分配」开着时参与状态还要正常（assign-eta.ts 指定问题，P-转-01）；
 *     接不了的（渠道运营、市场管理、项目组员、暂停 / 禁止参与分配的销售……）这一步先不出按钮，照旧走挂靠或写进现有项目（出口 A），
 *     「交给销售、客户不动」是下一步（PR-A2）。负责人已离职的不给出口 C（原设计）
 *   - 客户不在转让交接中（等接手人确认时客户归谁未定）
 * 新线索的内贸 / 外贸线跟负责人走（E-213 复核：接手人和线索的线对不上时分配会拒，lead-assign.ts 接手问题）：
 *   负责人本人事业部（成员业务线 → 所在部门）→ 判不出按这位客户的分配方向（客户区域 → 项目所在地 → 电话 → 发起人事业部）→ 再判不出内贸
 * 三态动静照现状（客户 11-22 拍板 3）：建新线索、进线索验证、终判、市场成员记的那条沟通都算客户动静；额度只有那条沟通会回满。这里不另写
 */
import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 是市场成员of, type 组织 } from "./org-core";
import { 不能当负责人话 } from "./permissions";
import { 指定问题, 读线部门 } from "./assign-eta";
import { 本人事业部 } from "./customer-region";
import { 客户默认分配方向 } from "./assign-direction-db";
import { 交接中的客户 } from "./handover-db";
import { 全公司查号, 首条撞的, type 验好的号 } from "./contact-dedupe";
import type { 线 } from "./lead-assign";

export const 出口C按钮 = (负责人名: string) => `在 ${负责人名} 名下新建线索`;
export const 不是市场成员出口C话 = "在同事名下新建线索只给市场成员（渠道运营、市场管理）";
export const 出口C作废话 = "这个号码现在撞上的客户不在原来那位负责人名下了（可能刚进公海或换了负责人），这次没建，按最新的查重结果来";
export const 负责人接不了话 = "这位客户的负责人现在接不了指定分配（不是在职的销售、或暂停 / 禁止参与分配），这次不能在他名下新建线索；可以写进现有项目或申请挂靠";
export const 交接中话 = "这位客户正在转让交接中，等接手人确认后再录";
/** 持有上限的那句不带别人名下的数（市场成员看不到同事的持有数）：只说原因和怎么办 */
export const 负责人到上限话 = (负责人名: string) => `${负责人名}名下线索 / 商机阶段的项目已到持有上限，这次没建；可以写进现有项目，或找销售管理`;

/** 事务里发现对不上（客户刚进公海、换了负责人、对接人刚被删）：抛出来整笔回滚，调用方接住说人话 */
export class 出口C作废 extends Error {}

export type 出口C目标 = {
  客户: NonNullable<Awaited<ReturnType<typeof 首条撞的>>>;
  负责人: string;
  负责人名: string;
};

/** 发起人这一关：企业版项目模式、市场成员 */
export async function 出口C发起人问题(org: 组织 | null, meId: string): Promise<string | null> {
  if (!企业版() || (await getBusiness()).projectMode !== true) return "在同事名下新建线索只在企业版项目模式里有";
  if (!org || !是市场成员of(org, meId)) return 不是市场成员出口C话;
  return null;
}

/**
 * 客户负责人这一关：在职真人（不是公海占位）、能接指定分配（指定问题：销售 / 销售管理，参与状态正常）、能当负责人。
 * 返回 null = 能接
 */
export async function 负责人能接(org: 组织, ownerId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { id: ownerId }, select: { active: true, email: true } });
  if (!u || !u.active || u.email === 无负责人占位邮箱) return 负责人接不了话;
  if ((await 指定问题(org, ownerId)) || 不能当负责人话(org, ownerId)) return 负责人接不了话;
  return null;
}

/**
 * 这个号码现在能不能走出口 C：能 = 撞上的客户和它的负责人；不能 = 为什么（给按钮用时只看能不能，交的时候说原因）。
 * 只认号码不认 id（同查重领取）：每次都按号码重查首条撞的那位
 */
export async function 出口C可用(org: 组织 | null, meId: string, 号: 验好的号): Promise<{ ok: true; 目标: 出口C目标 } | { ok: false; error: string }> {
  const 发起 = await 出口C发起人问题(org, meId);
  if (发起) return { ok: false, error: 发起 };
  const 挑 = await 首条撞的(prisma, await 全公司查号(prisma, 号.类型, 号.值, 号.键));
  if (!挑 || 挑.pool || !挑.salesOwnerId || 挑.salesOwnerId === meId) return { ok: false, error: 出口C作废话 };
  const 不能 = await 负责人能接(org!, 挑.salesOwnerId);
  if (不能) return { ok: false, error: 不能 };
  if ((await 交接中的客户([挑.id])).size) return { ok: false, error: 交接中话 };
  const 负责人名 = 挑.salesOwner?.name ?? (await prisma.user.findUnique({ where: { id: 挑.salesOwnerId }, select: { name: true } }))?.name ?? "负责人";
  return { ok: true, 目标: { 客户: 挑, 负责人: 挑.salesOwnerId, 负责人名 } };
}

/** 查号码 / AI 卡摆不摆按钮：能走 = 负责人名字；不能 = null（不出按钮，照旧挂靠 / 出口 A）。出任何错都当不能，不挡查重 */
export async function 出口C按钮给不给(meId: string, 号: 验好的号): Promise<{ 负责人名: string } | null> {
  try {
    const r = await 出口C可用(await 权限组织(), meId, 号);
    return r.ok ? { 负责人名: r.目标.负责人名 } : null;
  } catch (e) {
    console.warn("[出口C] 判定出错，不出按钮：", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 新线索的线（跟负责人走，见文件头）：负责人本人事业部 → 这位客户的分配方向 → 内贸。
 * 负责人设了业务线就一定是它（本人事业部先看成员业务线），分配时 接手问题 不会因为线对不上拒
 */
export async function 出口C的线(org: 组织, 负责人: string, customerId: string, 发起人: string): Promise<线> {
  const 本人 = 本人事业部(org, await 读线部门(), 负责人);
  if (本人) return 本人;
  const 向 = await 客户默认分配方向(org, customerId, 发起人, null);
  return 向.线 ?? "内贸";
}

/** 项目详情「这位客户其他在推的项目」：我负责的给名字（点得进），同事负责的只给个数（P-看-12 / X-49：写项目名 = 越权暴露） */
export type 其他在推 = { 我的: { id: string; name: string }[]; 同事的: number };

/**
 * 带「老客户重复咨询」标记的线索，详情里现算这位客户名下别的在推项目（没结局、不在公海、不是这一条），给负责人判是不是同一需求。
 * 不加「原项目」列（客户 11-22 方案：现算，不用迁移）
 */
export async function 客户其他在推项目(meId: string, projectId: string, customerId: string): Promise<其他在推> {
  const 们 = await 看全部(() => prisma.project.findMany({
    where: { customerId, id: { not: projectId }, result: null, pooledAt: null },
    select: { id: true, name: true, ownerId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }));
  const 我的 = 们.filter((p) => p.ownerId === meId).map((p) => ({ id: p.id, name: p.name }));
  return { 我的, 同事的: 们.length - 我的.length };
}
