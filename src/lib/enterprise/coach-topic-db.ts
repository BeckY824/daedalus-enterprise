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
  发起通知谁, 回复通知谁, 关闭通知谁, 主题标题上限, 主题内容上限, type 主题项目, type 发起身份, type 主题状态,
} from "./coach-topic";
import { 能看项目, 权限项目选, 是教练, type 谁 } from "./permissions";
import { 打码还原, 还原超长话, 有对不上的码, 内容变了话, 版本变了, 通知文字打码 } from "./notice-mask";
import { 录音点评开着, 录音可用, 我的录音草稿, 没开放话, 删主题的录音文件, type 录音给界面 } from "./coach-rec-db";
import { 能听原声, 给人看的文字 } from "./coach-rec";
import { 夹页, 复盘列表每页, type 主题范围, type 主题状态筛, type 复盘主题 } from "@/lib/project/review-tabs";

type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** 判主题要的项目字段（不过限定、不滤回收站：冻结要看 deletedAt） */
const 项目选 = { id: true, name: true, node: true, ...权限项目选 } as const;
type 项目行 = {
  id: string; name: string; ownerId: string; creatorId: string | null; pooledAt: Date | null; bizLine: string | null; deletedAt: Date | null; result: string | null; node: string; members: { userId: string }[];
  phase: string; awaitAssignAt: Date | null; scheduledAssignAt: Date | null;
};
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
  /**
   * 录音点评发出的（PR5，EntCoachRecording.topicId 指回这条；开关关着不给，页面和原来一样）：时长、能不能听原声（发起人、项目负责人）、
   * 转写全文（能看这条主题的都给；销售教练看到的号码打码，正文同样）、音频过了保留期删掉没有
   */
  录音?: { id: string; 时长毫秒: number | null; 能听: boolean; 转写: string | null; 音频没了: boolean };
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
  /**
   * 录音点评（11-22 PR2，lib/enterprise/coach-rec-db.ts）：开关开着、我能发时才有——「传录音文件」入口和我自己没传完 / 待提交的录音草稿。
   * 开关关着 = 没有这一格，页面和原来一样。
   * 可录（PR4）= 录音可用（开关 + 密钥 + ffmpeg 自检）：false 时不出「传录音文件」、待提交卡「提交整理」灰着，已有的草稿照样显示
   */
  录音?: { 草稿们: 录音给界面[]; 可录: boolean };
};

/** 人的叫法：主业务角色（教练写「销售教练」，兼了总管理的写总管理）。署名不直接用它，见 署名身份 */
const 角色叫法 = (org: 组织, id: string): string => {
  const r = org.成员.get(id)?.bizRole as 业务角色 | null | undefined;
  return r ? 角色名[r] : "—";
};

const 发起身份们: ReadonlySet<string> = new Set<发起身份>(["销售教练", "系统管理员", "条线总管理", "实线上级", "虚线上级"]);

/**
 * 主题署名的身份（11-23 用户：写点评框、发出后的沟通卡、复盘列表三处都按发起身份）：
 * 存了发起身份（authorRole，迁移 167 起发起时写）→ 用存的；老主题没存 → 按现在的组织照 发起身份of 推断（填写人现在还能对这个项目发主题时的身份）；
 * 推不出（人停用了、项目转给了他本人、关系变了）→ 退回主业务角色
 */
export function 署名身份(t: { authorId: string; authorRole?: string | null }, 作者账号: string | null | undefined, 判: 主题项目, org: 组织 | null): string {
  if (t.authorRole && 发起身份们.has(t.authorRole)) return t.authorRole;
  if (!org) return "—";
  return 发起身份of({ id: t.authorId, role: 作者账号 ?? null }, 判, org) ?? 角色叫法(org, t.authorId);
}

type 主题库行 = { id: string; projectId: string; node: string; title: string; body: string; authorId: string; authorRole: string | null; status: string; closedById: string | null; closedAt: Date | null; deletedAt: Date | null; createdAt: Date; replies: { id: string; userId: string; body: string; createdAt: Date }[] };

/** 库里的行 → 界面（只给看得到的；先过滤再调） */
async function 给界面(me: 谁, 行们: 主题库行[], p: 项目行, 判: 主题项目, org: 组织 | null): Promise<{ 们: 主题给界面[]; 叫: (id: string | null | undefined) => string }> {
  const 人id = new Set<string>([p.ownerId, me.id]);
  for (const t of 行们) {
    人id.add(t.authorId);
    if (t.closedById) 人id.add(t.closedById);
    for (const r of t.replies) 人id.add(r.userId);
  }
  const 账号们 = await defaultClient.user.findMany({ where: { id: { in: [...人id].filter(Boolean) } }, select: { id: true, name: true, role: true } });
  const 名 = new Map(账号们.map((u) => [u.id, u.name]));
  const 账号 = new Map(账号们.map((u) => [u.id, u.role]));
  const 叫 = (id: string | null | undefined) => (id ? 名.get(id) ?? "已不在的成员" : "—");
  const 能删 = 能删主题(me, org);
  // 录音点评发出的主题：录音行的 topicId 指回来（开关关着不查，页面和原来一样）
  const 录音们 = 行们.length && (await 录音点评开着())
    ? new Map((await defaultClient.entCoachRecording.findMany({
        where: { topicId: { in: 行们.map((t) => t.id) }, status: "已发出" },
        select: { id: true, topicId: true, authorId: true, status: true, projectId: true, durationMs: true, transcript: true, deletedAt: true, audioPurgedAt: true },
      })).map((r) => [r.topicId!, r]))
    : new Map();
  const 们: 主题给界面[] = 行们.map((t) => {
    const 录 = 录音们.get(t.id);
    return {
    // 录音点评发出的主题：标题、正文都按看的人打码（销售教练看到号码打码，PR5 审查：标题也要）
    id: t.id, node: t.node, title: 录 ? 给人看的文字(t.title, me, org) ?? "" : t.title, body: 录 ? 给人看的文字(t.body, me, org) ?? "" : t.body, status: t.status as 主题状态,
    createdAt: t.createdAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null,
    作者: { id: t.authorId, name: 叫(t.authorId), 身份: 署名身份(t, 账号.get(t.authorId), 判, org) },
    关的人: t.closedById ? 叫(t.closedById) : null,
    回复们: t.replies.map((r) => ({ id: r.id, name: 叫(r.userId), body: r.body, createdAt: r.createdAt.toISOString(), 是负责人: r.userId === p.ownerId })),
    能回: 能回主题(me, t, 判, org), 能关: 能关主题(me, t, 判, org), 能删,
    ...(录 ? { 录音: { id: 录.id, 时长毫秒: 录.durationMs, 能听: 能听原声(me, 录, 判, org), 转写: 给人看的文字(录.transcript, me, org), 音频没了: !!录.audioPurgedAt } } : {}),
    };
  });
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
    ...(能发主题(me, 判, org) && (await 录音点评开着()) ? { 录音: { 草稿们: await 我的录音草稿(me, p.id), 可录: await 录音可用() } } : {}),
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
  return 发起(me, projectId, 输入, null);
}

const 录音变了 = "这条录音刚变了（可能在别的窗口发出或删掉了），刷新看看";

/**
 * 发起 = 写一条主题（+ 录音点评：同一个事务里把录音改成已发出、记上主题编号；录音不是待确认 / 整理失败了就整个不写）。
 * 权限、输入、留痕、通知同一套（P-教练-21：负责人收到的仍是主题通知，标题 + 去哪看，不带录音、转写）
 */
async function 发起(me: 人, projectId: string, 输入: { title?: unknown; body?: unknown }, 录音id: string | null, 录音版本?: Date): Promise<结果<{ id: string }>> {
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
  let t: { id: string };
  try {
    t = await 主题写(() => prisma.$transaction(async (tx) => {
      const 新 = await tx.entCoachTopic.create({ data: { projectId: p.id, node: p.node, title, body, authorId: me.id, authorRole: 身份 }, select: { id: true } });
      if (录音id) {
        const 改 = await tx.entCoachRecording.updateMany({
          // 录音版本（#428 审查）：只在库里还是还原时读到的那一版才发，不然整个事务回滚（主题不建）
          where: { id: 录音id, authorId: me.id, projectId: p.id, status: { in: ["待确认", "整理失败"] }, deletedAt: null, ...(录音版本 ? { updatedAt: 录音版本 } : {}) },
          data: { status: "已发出", topicId: 新.id, draftTitle: title, draftBody: body, error: null },
        });
        if (改.count !== 1) throw new Error(录音变了);
      }
      return 新;
    }));
  } catch (e) {
    if (e instanceof Error && e.message === 录音变了) return { ok: false, error: 录音变了 };
    throw e;
  }
  // 留痕里的主题名过打码（跟进 11-22：录音点评的主题常带客户号码，库里存原文；留痕只给管理员看也不放原号码）
  await recordAudit({ user: me, action: "create", entity: "EntCoachTopic", entityId: t.id, summary: `${身份}发起主题「${通知文字打码(title)}」（项目「${p.name}」${录音id ? "，录音点评" : ""}）` });
  const { 主题通知 } = await import("./notice-sources");
  await 主题通知(me, "发起", { id: t.id, title, projectId: p.id, 项目名: p.name }, 发起通知谁(me.id, p));
  return { ok: true, id: t.id };
}

/**
 * 发出录音点评（POST /api/coach-rec/:id/send，PR5）：只有录的人；待确认、整理失败（自己写主题要点也能发）的才能发。
 * 走发主题同一套（权限按现在、P-教练-11/12/13；输入同写点评的上限）；前端不能指定别人的录音（只认录的人自己的这一条）
 */
export async function 发录音点评(me: 人, 录音id: unknown, 输入: { title?: unknown; body?: unknown; 版本?: unknown }): Promise<结果<{ id: string }> | { ok: false; error: string; 状态: number }> {
  if (!(await 录音点评开着())) return { ok: false, error: 没开放话, 状态: 404 };
  if (typeof 录音id !== "string" || !/^[\w-]{1,64}$/.test(录音id)) return { ok: false, error: "找不到这条录音", 状态: 404 };
  const r = await defaultClient.entCoachRecording.findUnique({ where: { id: 录音id }, select: { id: true, authorId: true, projectId: true, status: true, deletedAt: true } });
  if (!r || r.authorId !== me.id || r.deletedAt) return { ok: false, error: "找不到这条录音", 状态: 404 };
  if (r.status === "已发出") return { ok: false, error: "这条录音点评已经发出了", 状态: 409 };
  if (r.status !== "待确认" && r.status !== "整理失败") return { ok: false, error: "这条录音还没整理好", 状态: 409 };
  // 销售教练提交的是打过码的字：没改动的打码段按原文换回原号码再存（PR5 审查：库里存原文，负责人看到原号码）
  const 原 = await defaultClient.entCoachRecording.findUnique({ where: { id: r.id }, select: { draftTitle: true, draftBody: true, transcript: true, updatedAt: true } });
  const 原文们 = [原?.draftTitle, 原?.draftBody, 原?.transcript];
  const 还原 = (x: unknown) => (typeof x === "string" ? 打码还原(x, 原文们) : x);
  const 教练 = 是教练(me, await 读组织());
  const 改后 = 教练 ? { title: 还原(输入.title), body: 还原(输入.body) } : { title: 输入.title, body: 输入.body };
  // 确认框开着时这条在别处重新整理过、原号码没了：打码段换不回去，拒发（3703 实操跟进）
  if (教练 && (!原 || 版本变了(输入.版本, 原.updatedAt)) && (有对不上的码(改后.title, 原文们) || 有对不上的码(改后.body, 原文们))) return { ok: false, error: 内容变了话, 状态: 412 };
  // 还原后变长超了上限（带分隔的号码）：给清楚的话，不回笼统的「最多 N 字」（PR5 审查）
  const 超 = 教练 ? 还原超长话(输入.title, 改后.title, 主题标题上限, "主题") ?? 还原超长话(输入.body, 改后.body, 主题内容上限, "要点") : null;
  if (超) return { ok: false, error: 超, 状态: 400 };
  // 带了版本的：按还原时读到的那一版写（读完到写之间别处又整理了 → 回 412，和上面同一句，#428 审查）
  const 带版本 = typeof 输入.版本 === "string" && !!原;
  const x = await 发起(me, r.projectId, 改后, r.id, 带版本 ? 原!.updatedAt : undefined);
  if (x.ok) return x;
  if (带版本 && x.error === 录音变了) {
    const 现 = await defaultClient.entCoachRecording.findUnique({ where: { id: r.id }, select: { status: true, deletedAt: true } });
    if (现 && !现.deletedAt && (现.status === "待确认" || 现.status === "整理失败")) return { ok: false, error: 内容变了话, 状态: 412 };
  }
  return { ...x, 状态: x.error === 录音变了 ? 409 : /最多|要写/.test(x.error) ? 400 : /不在了/.test(x.error) ? 404 : 403 };
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
  await recordAudit({ user: me, action: "reply", entity: "EntCoachTopic", entityId: x.t.id, summary: `回复主题「${通知文字打码(x.t.title)}」（项目「${x.p.name}」）` });
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
  await recordAudit({ user: me, action: "close", entity: "EntCoachTopic", entityId: x.t.id, summary: `关闭主题「${通知文字打码(x.t.title)}」（项目「${x.p.name}」）` });
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
  // 录音点评（PR6）：系统管理员删主题，这个主题的录音文件连带删（转写、要点留在行上，主题删了谁也看不到）
  const 删了 = await 删主题的录音文件(x.t.id).catch((e) => { console.warn(`[录音清理] 删主题的录音文件出错：${e instanceof Error ? e.message.slice(0, 200) : e}`); return 0; });
  await recordAudit({ user: me, action: "delete", entity: "EntCoachTopic", entityId: x.t.id, summary: `删除主题「${通知文字打码(x.t.title)}」（项目「${x.p.name}」）${删了 ? "，连带删了录音文件" : ""}` });
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

/** 复盘「沟通」页签「主题」一档最多翻这么多条（主题量小，判完可见再分页；多出来的不列） */
const 复盘主题上限 = 1000;

/**
 * 复盘「沟通」页签里的「主题」一档（PR3b）：我发起的 / 待我回复 / 全部（这一圈负责的项目上的；谁 = undefined 不限人），可按状态筛。
 * 每条都过 能看主题（先判能看项目）：两张表不在限定层里，这里自己挡。项目进了回收站的不列（点进去也打不开）
 */
export async function 复盘主题of(
  me: 谁,
  圈: readonly string[] | undefined,
  q: { 范围: 主题范围; 状态?: 主题状态筛 | ""; 页?: number; 每页?: number },
): Promise<复盘主题> {
  const 每页 = q.每页 ?? 复盘列表每页;
  if (!企业版()) return { 总数: 0, 页: 1, 行: [] };
  const 状态 = q.范围 === "wait" ? "待回复" : q.状态 || undefined;
  const 行们 = await defaultClient.entCoachTopic.findMany({
    where: {
      deletedAt: null,
      ...(状态 ? { status: 状态 } : {}),
      ...(q.范围 === "mine"
        ? { authorId: me.id, project: { deletedAt: null } }
        : q.范围 === "wait"
          ? { project: { ownerId: me.id, pooledAt: null, deletedAt: null } }
          : { project: { deletedAt: null, ...(圈 ? { ownerId: { in: [...圈] } } : {}) } }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 复盘主题上限,
    select: { id: true, node: true, title: true, status: true, authorId: true, authorRole: true, createdAt: true, deletedAt: true, project: { select: 项目选 }, _count: { select: { replies: true } } },
  });
  const org = await 读组织();
  const 看得到 = 行们.filter((t) => 能看主题(me, t, 判项目(t.project as 项目行), org));
  const 总数 = 看得到.length;
  const 页 = 夹页(q.页 ?? 1, 总数, 每页);
  const 这页 = 看得到.slice((页 - 1) * 每页, 页 * 每页);
  const 账号们 = await defaultClient.user.findMany({ where: { id: { in: [...new Set(这页.map((t) => t.authorId))] } }, select: { id: true, name: true, role: true } });
  const 名 = new Map(账号们.map((u) => [u.id, u.name]));
  const 账号 = new Map(账号们.map((u) => [u.id, u.role]));
  // 录音点评发出的主题：销售教练看到的标题号码打码（PR5 审查，同沟通卡）
  const 录音的 = 这页.length && (await 录音点评开着())
    ? new Set((await defaultClient.entCoachRecording.findMany({ where: { topicId: { in: 这页.map((t) => t.id) }, status: "已发出" }, select: { topicId: true } })).map((r) => r.topicId))
    : new Set<string | null>();
  return {
    总数,
    页,
    行: 这页.map((t) => ({
      id: t.id, 时间: t.createdAt.toISOString(), projectId: t.project.id, 项目: t.project.name, 节点: t.node || "—",
      状态: t.status as 主题状态筛, 标题: 录音的.has(t.id) ? 给人看的文字(t.title, me, org) ?? "" : t.title, 发起人: 名.get(t.authorId) ?? "已不在的成员", 身份: 署名身份(t, 账号.get(t.authorId), 判项目(t.project as 项目行), org), 回复数: t._count.replies,
    })),
  };
}
