/**
 * 企业版教练主题 · 读写库（11-17，销售教练角色 PR2）。判定全在 coach-topic.ts，这里只负责「读出来 → 判 → 写 → 留痕 → 通知」。
 *
 * - 写只走 主题写()（lib/team-scope.ts）：只读角色（销售教练）的写在 team-scope 统一拦，唯独包在 主题写 里、判定过的这两张表放行；
 *   直接拿 prisma 写这两张表照样被拦（测试钉着）。切换视图期间照样拦（视图拦 在前）。
 * - 填写人 = 当前登录的人（Q5），动作不收 authorId。
 * - 不碰沟通记录、三态、冷项目、额度、下一步计划、节点（Q1 选 B）。
 * - 读：两张表不在 scope-policy.ts 的范围父表里，限定层管不到；每个读入口先判「能看项目」（coach-topic.ts 能看主题 第一句），再按 Q6。
 * - 通知：notice-sources.ts 主题通知（站内铃铛 + 飞书只推已绑定的、只推标题），不带手机号、不带正文。
 * - 第一版主题不进 AI、导出、全局搜索（那几处都不认这两张表）。
 */
import { prisma, defaultClient } from "@/lib/prisma";
import { 主题写 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { 企业版 } from "./switch";
import { 读组织, type 组织 } from "./org";
import { 角色名, type 业务角色 } from "@/lib/sync/dept-policy";
import {
  发起身份of, 能发主题, 不能发主题话, 能看主题, 能回主题, 能关主题, 能删主题, 冻结了, 回复后状态, 主题输入问题, 回复输入问题,
  发起通知谁, 回复通知谁, 关闭通知谁, type 主题项目, type 发起身份, type 主题状态,
} from "./coach-topic";
import { 能看项目, type 谁 } from "./permissions";

type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** 判主题要的项目字段（不过限定、不滤回收站：冻结要看 deletedAt） */
const 项目选 = { id: true, name: true, ownerId: true, creatorId: true, pooledAt: true, bizLine: true, deletedAt: true, result: true, node: true, members: { where: { inviteStatus: "JOINED" }, select: { userId: true } } } as const;
type 项目行 = { id: string; name: string; ownerId: string; creatorId: string | null; pooledAt: Date | null; bizLine: string | null; deletedAt: Date | null; result: string | null; node: string; members: { userId: string }[] };
const 判项目 = (p: 项目行): 主题项目 & { id: string } => ({ ...p, 已加入: p.members.map((m) => m.userId) });

async function 读项目(projectId: string): Promise<项目行 | null> {
  if (typeof projectId !== "string" || !projectId) return null;
  return defaultClient.project.findUnique({ where: { id: projectId }, select: 项目选 }) as Promise<项目行 | null>;
}

export type 主题人 = { id: string; name: string; 身份: string };
export type 主题回复给界面 = { id: string; name: string; body: string; createdAt: string; 是负责人: boolean };
export type 主题给界面 = {
  id: string; node: string; title: string; body: string; status: 主题状态; createdAt: string; closedAt: string | null;
  /** 关的人；已关闭又是 null = 项目进公海时系统自动关的 */
  作者: 主题人; 关的人: string | null; 回复们: 主题回复给界面[]; 能回: boolean; 能关: boolean; 能删: boolean;
};
export type 项目主题们 = {
  们: 主题给界面[];
  /** 能不能发：项目没冻结、我有发起身份 */
  能发: boolean;
  /** 发起时锁定的填写人（Q5）、身份 */
  填写人: 主题人 | null;
  /** 会通知谁（Q11）：项目负责人 */
  负责人: { id: string; name: string } | null;
  项目名: string;
  当前节点: string;
  待回复数: number;
  /** 公海、回收站：只读 */
  冻结: boolean;
};

/** 人的叫法：主业务角色（教练写「销售教练」，兼了总管理的写总管理）；发主题时按发起身份写 */
const 角色叫法 = (org: 组织, id: string): string => {
  const r = org.成员.get(id)?.bizRole as 业务角色 | null | undefined;
  return r ? 角色名[r] : "—";
};

type 主题库行 = { id: string; projectId: string; node: string; title: string; body: string; authorId: string; status: string; closedById: string | null; closedAt: Date | null; deletedAt: Date | null; createdAt: Date; replies: { id: string; userId: string; body: string; createdAt: Date }[] };

/** 库里的行 → 界面（只给看得到的；先过滤再调） */
async function 给界面(me: 谁, 行们: 主题库行[], p: 项目行, 判: 主题项目, org: 组织 | null): Promise<{ 们: 主题给界面[]; 叫: (id: string | null | undefined) => string }> {
  const 人id = new Set<string>([p.ownerId, me.id]);
  for (const t of 行们) {
    人id.add(t.authorId);
    if (t.closedById) 人id.add(t.closedById);
    for (const r of t.replies) 人id.add(r.userId);
  }
  const 名 = new Map((await defaultClient.user.findMany({ where: { id: { in: [...人id].filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const 叫 = (id: string | null | undefined) => (id ? 名.get(id) ?? "已不在的成员" : "—");
  const 能删 = 能删主题(me, org);
  const 们: 主题给界面[] = 行们.map((t) => ({
    id: t.id, node: t.node, title: t.title, body: t.body, status: t.status as 主题状态,
    createdAt: t.createdAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null,
    作者: { id: t.authorId, name: 叫(t.authorId), 身份: org ? 角色叫法(org, t.authorId) : "—" },
    关的人: t.closedById ? 叫(t.closedById) : null,
    回复们: t.replies.map((r) => ({ id: r.id, name: 叫(r.userId), body: r.body, createdAt: r.createdAt.toISOString(), 是负责人: r.userId === p.ownerId })),
    能回: 能回主题(me, t, 判, org), 能关: 能关主题(me, t, 判, org), 能删,
  }));
  return { 们, 叫 };
}

/**
 * 项目详情沟通卡里的主题（看得到的才给）。不是企业版、项目不在了、看不到这个项目 = null。
 * 没关的（待回复、已回复）排前面钉在沟通卡顶上，不混进沟通记录的分页
 */
export async function 读项目主题(me: 谁, projectId: string): Promise<项目主题们 | null> {
  if (!企业版()) return null;
  const p = await 读项目(projectId);
  if (!p) return null;
  const org = await 读组织();
  const 判 = 判项目(p);
  if (!能看项目(me, 判, org)) return null;
  const 行们 = await defaultClient.entCoachTopic.findMany({
    where: { projectId: p.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { replies: { orderBy: { createdAt: "asc" } } },
  });
  const 看得到 = 行们.filter((t) => 能看主题(me, t, 判, org));
  const 身份 = 发起身份of(me, 判, org);
  if (!看得到.length && !能发主题(me, 判, org)) {
    // 什么都没有、也发不了：不给这一块（组员、市场成员、没身份的人）
    return { 们: [], 能发: false, 填写人: null, 负责人: null, 项目名: p.name, 当前节点: p.node, 待回复数: 0, 冻结: 冻结了(判) };
  }
  const { 们, 叫 } = await 给界面(me, 看得到, p, 判, org);
  // 没关的排前面（待回复最前），同一档新的在前
  const 档 = (x: 主题状态) => (x === "待回复" ? 0 : x === "已回复" ? 1 : 2);
  们.sort((a, b) => 档(a.status) - 档(b.status) || b.createdAt.localeCompare(a.createdAt));
  return {
    们,
    能发: 能发主题(me, 判, org),
    填写人: 身份 ? { id: me.id, name: 叫(me.id), 身份 } : null,
    负责人: p.ownerId && !p.pooledAt ? { id: p.ownerId, name: 叫(p.ownerId) } : null,
    项目名: p.name,
    当前节点: p.node,
    待回复数: 们.filter((t) => t.status === "待回复").length,
    冻结: 冻结了(判),
  };
}

/** 按编号取一条（通知跳转、回复后刷新用）：看不到项目、看不到这条、删了的 = null */
export async function 读一条主题(me: 谁, topicId: string): Promise<主题给界面 | null> {
  if (!企业版() || typeof topicId !== "string" || !topicId) return null;
  const t = await defaultClient.entCoachTopic.findUnique({ where: { id: topicId }, include: { replies: { orderBy: { createdAt: "asc" } } } });
  if (!t || t.deletedAt) return null;
  const p = await 读项目(t.projectId);
  if (!p) return null;
  const org = await 读组织();
  const 判 = 判项目(p);
  if (!能看主题(me, t, 判, org)) return null;
  return (await 给界面(me, [t], p, 判, org)).们[0] ?? null;
}

/** 读主题 + 它的项目（主题删了、项目真删了 = null） */
async function 读主题(topicId: string) {
  if (typeof topicId !== "string" || !topicId) return null;
  const t = await defaultClient.entCoachTopic.findUnique({ where: { id: topicId } });
  if (!t) return null;
  const p = await 读项目(t.projectId);
  return p ? { t, p } : null;
}

const 主题没了 = { ok: false as const, error: "这个主题已经不在了，刷新看看" };
type 人 = { id: string; name: string; role: string };

/**
 * 发起主题（Q1–Q5、Q7）：填写人 = me（不收别的人）；节点 = 项目这会儿的节点；状态 = 待回复。
 * 不写沟通记录、不碰三态 / 冷项目 / 额度 / 下一步计划
 */
export async function 发主题(me: 人, projectId: string, 输入: { title?: unknown; body?: unknown }): Promise<结果<{ id: string }>> {
  if (!企业版()) return { ok: false, error: "教练主题只在企业版里有" };
  const p = await 读项目(projectId);
  if (!p) return { ok: false, error: "项目不在了，刷新看看" };
  const org = await 读组织();
  const 判 = 判项目(p);
  const 不能 = 不能发主题话(me, 判, org);
  if (不能) return { ok: false, error: 不能 };
  const 问题 = 主题输入问题(输入);
  if (问题) return { ok: false, error: 问题 };
  const 身份 = 发起身份of(me, 判, org) as 发起身份;
  const title = String(输入.title).trim();
  const body = String(输入.body).trim();
  const t = await 主题写(() => prisma.entCoachTopic.create({
    data: { projectId: p.id, node: p.node, title, body, authorId: me.id },
    select: { id: true },
  }));
  await recordAudit({ user: me, action: "create", entity: "EntCoachTopic", entityId: t.id, summary: `${身份}发起主题「${title}」（项目「${p.name}」）` });
  const { 主题通知 } = await import("./notice-sources");
  await 主题通知(me, "发起", { id: t.id, title, projectId: p.id, 项目名: p.name }, 发起通知谁(me.id, p));
  return { ok: true, id: t.id };
}

/** 回复（Q7）：负责人回 → 已回复；发起人追问 → 待回复；第三方回不改状态（回复后状态）。关了、冻结了的不能回 */
export async function 回复主题(me: 人, topicId: string, body: unknown): Promise<结果<{ status: 主题状态 }>> {
  if (!企业版()) return { ok: false, error: "教练主题只在企业版里有" };
  const x = await 读主题(topicId);
  if (!x || x.t.deletedAt) return 主题没了;
  const org = await 读组织();
  const 判 = 判项目(x.p);
  if (!能回主题(me, x.t, 判, org)) {
    return { ok: false, error: x.t.status === "已关闭" ? "这个主题已经关闭了" : 冻结了(判) ? "项目在公海或回收站里，主题只能看" : "你不能回复这个主题" };
  }
  const 问题 = 回复输入问题(body);
  if (问题) return { ok: false, error: 问题 };
  const 文 = String(body).trim();
  const status = 回复后状态(me.id, x.t, x.p);
  const 回 = await 主题写(() => prisma.$transaction(async (tx) => {
    const r = await tx.entCoachReply.create({ data: { topicId: x.t.id, userId: me.id, body: 文 }, select: { id: true } });
    // 只在没关的时候改状态：并发里别人刚关掉的不翻回来。第三方回复状态不变，也照样碰一下 updatedAt
    await tx.entCoachTopic.updateMany({ where: { id: x.t.id, status: { not: "已关闭" }, deletedAt: null }, data: { status } });
    return r;
  }));
  await recordAudit({ user: me, action: "reply", entity: "EntCoachTopic", entityId: x.t.id, summary: `回复主题「${x.t.title}」（项目「${x.p.name}」）` });
  const { 主题通知 } = await import("./notice-sources");
  const 事件 = me.id === x.p.ownerId ? "回复" : me.id === x.t.authorId ? "追问" : "回复";
  // 通知键带回复编号：同一主题第二次追问、第二次回复不被「人 + 键」去重吞掉
  await 主题通知(me, 事件, { id: x.t.id, title: x.t.title, projectId: x.p.id, 项目名: x.p.name }, 回复通知谁(me.id, x.t, x.p), 回.id);
  return { ok: true, status };
}

/** 关闭（Q7）：发起人或系统管理员；关了只读、留痕 */
export async function 关闭主题(me: 人, topicId: string): Promise<结果> {
  if (!企业版()) return { ok: false, error: "教练主题只在企业版里有" };
  const x = await 读主题(topicId);
  if (!x || x.t.deletedAt) return 主题没了;
  const org = await 读组织();
  if (!能关主题(me, x.t, 判项目(x.p), org)) return { ok: false, error: x.t.status === "已关闭" ? "这个主题已经关闭了" : "只有发起人或系统管理员能关闭（发起人停用后负责人也能关）" };
  await 主题写(() => prisma.entCoachTopic.updateMany({ where: { id: x.t.id, status: { not: "已关闭" } }, data: { status: "已关闭", closedById: me.id, closedAt: new Date() } }));
  await recordAudit({ user: me, action: "close", entity: "EntCoachTopic", entityId: x.t.id, summary: `关闭主题「${x.t.title}」（项目「${x.p.name}」）` });
  const { 主题通知 } = await import("./notice-sources");
  await 主题通知(me, "关闭", { id: x.t.id, title: x.t.title, projectId: x.p.id, 项目名: x.p.name }, 关闭通知谁(me.id, x.p));
  return { ok: true };
}

/** 软删（Q8）：只有系统管理员；第一版只在 deletedAt 打记号（主题进回收站 = false），不进回收站、不能恢复 */
export async function 删主题(me: 人, topicId: string): Promise<结果> {
  if (!企业版()) return { ok: false, error: "教练主题只在企业版里有" };
  const x = await 读主题(topicId);
  if (!x || x.t.deletedAt) return 主题没了;
  if (!能删主题(me, await 读组织())) return { ok: false, error: "主题发出后不能删，只有系统管理员能删" };
  await 主题写(() => prisma.entCoachTopic.updateMany({ where: { id: x.t.id, deletedAt: null }, data: { deletedAt: new Date() } }));
  await recordAudit({ user: me, action: "delete", entity: "EntCoachTopic", entityId: x.t.id, summary: `删除主题「${x.t.title}」（项目「${x.p.name}」）` });
  return { ok: true };
}

/**
 * 首页待办「待回复主题」（负责人看到）：我负责、没冻结（不在公海、没进回收站）的项目上待回复的主题，几条、最早一条在哪。
 * 回复人 = 当时的项目负责人（不另存）：转让、交接之后自动跟到新负责人名下；进公海时没关的已自动关（进公海关主题），领走的人不背。
 * 从状态出发连项目（索引 status + projectId）
 */
export async function 待回复主题of(userId: string): Promise<{ 条数: number; 最早: { at: string; projectId: string; title: string } | null }> {
  if (!企业版() || !userId) return { 条数: 0, 最早: null };
  const where = { status: "待回复", deletedAt: null, project: { ownerId: userId, pooledAt: null, deletedAt: null } };
  const [条数, 最早] = await Promise.all([
    defaultClient.entCoachTopic.count({ where }),
    defaultClient.entCoachTopic.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true, projectId: true, title: true } }),
  ]);
  return { 条数, 最早: 最早 ? { at: 最早.createdAt.toISOString(), projectId: 最早.projectId, title: 最早.title } : null };
}
