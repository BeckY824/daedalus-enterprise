/**
 * 企业版「指定回复时间」到点提醒（11-17，两字段方案 PR2）：客户要求的联系时间快到了，提醒这条项目当时的负责人。
 *
 * 待客户方确认：问题 1（提醒做到哪档）。现在按建议答案 B 做：只提醒、不标超时、不通知上级——
 *   - 开始前 回复提前分钟 分钟（只填结束 = 结束前），站内铃铛 + 飞书（notify 顺带推，只到已绑飞书的账号）+ 首页待办「待回复客户 N」
 *   - 过了截止不另外处理（超时标签、次日通知上级是可选加项 C，没做）
 * 选 A（不提醒）把 回复提醒开 改成 false；选 C 在这里加一段「过截止没记沟通」，口径都集中在这个文件。
 *
 * 规则：
 *   - 提醒时刻 = (开始 ?? 结束) - 30 分钟；截止 = 结束；只填开始的，截止 = 开始那天（北京）过完
 *   - 提醒谁：这条项目「到点时」的负责人；还在待分配（定时分配没到点 / 没分出去）= 能分配的人（市场管理、销售管理、总管理员），
 *     提醒里写明还在待分配。停用的人不收
 *   - 已回复 = 提醒时刻以后这条项目上记了一条有内容的沟通（空的、占位式的不算，M-公海-42 同一个判定 有内容的沟通）：首页待办那一行消失。
 *     同号再次录入的系统留痕（挂项目时节点写 同号节点，same-number-collab.ts，导入撞号 同号只记备注 同样）不算：那是别人又录了这个号、客户又来问了，
 *     不是负责人回了客户；算了的话客户越催，待回复、超时提醒和超时自动转反而全停
 *   - 到截止首页待办那一行消失；进公海、进回收站、有结局的不提醒、不进待办；被领走 / 分走后新负责人照常收（时间过了的不补）
 *   - 改了时间重新算：去重键带提醒时刻，换了时刻是新的一条
 *
 * 挂在夜扫那个每分钟的钟上（lib/project/nightly.ts，多进程只一个进程跑）。停机补跑按状态判：开机那遍把「提醒时刻已过、截止没到」的照常提醒，
 * 过了截止的不补；一条只发一次靠 EntNotice 的 (userId, dedupeKey) 唯一键。不碰到期提醒的水位。任何一步出错只记日志，从不往外抛
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { notify } from "./notify";
import { 读组织 } from "./org";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";
import { 能分配的人们 } from "./await-assign";
import { 有内容的沟通 } from "./tri-state-quota";
import { 同号节点 } from "./same-number-collab";
import { 读占位词 } from "./tri-state-db";
import { 北京墙钟转时刻, 时刻转北京墙钟, 指定回复文字, 短时刻, 分配后未跟进话 } from "@/lib/project/time-fields";
import { 空值符 } from "@/lib/empty-value";
import { 我超时未跟进的, 超时提醒分钟 } from "./reply-overdue";

/** 待客户方确认：问题 1。true = 到点提醒（建议答案 B）；客户选 A（只存不提醒）改 false */
export const 回复提醒开 = true;
/** 待客户方确认：问题 1。开始前多少分钟提醒 */
export const 回复提前分钟 = 30;
/** 停机补跑最多往回看几天的开始时刻（只填开始、截止 = 那天过完，往回一天就够；留余量给很长的时间段） */
const 往回看天 = 7;

type 两格 = { replyStartAt: Date | null; replyEndAt: Date | null };

/** 提醒时刻：(开始 ?? 结束) 前 回复提前分钟 分钟；都没填 = null */
export function 回复提醒时刻(p: 两格): Date | null {
  const 先 = p.replyStartAt ?? p.replyEndAt;
  return 先 ? new Date(先.getTime() - 回复提前分钟 * 60_000) : null;
}

/** 截止：结束；只填开始 = 开始那天（北京）过完（次日 00:00）；都没填 = null */
export function 回复截止(p: 两格): Date | null {
  if (p.replyEndAt) return p.replyEndAt;
  if (!p.replyStartAt) return null;
  const 日 = 时刻转北京墙钟(p.replyStartAt)!.slice(0, 10);
  return new Date(北京墙钟转时刻(`${日} 00:00`)!.getTime() + 86_400_000);
}

/** 现在该不该提醒 / 算待回复：提醒时刻到了、截止没到 */
export function 在提醒窗口(p: 两格, 现在: Date): boolean {
  const 提 = 回复提醒时刻(p), 止 = 回复截止(p);
  return !!提 && !!止 && 提.getTime() <= 现在.getTime() && 现在.getTime() < 止.getTime();
}

/** 去重键：项目 + 提醒时刻（改了时间是新的一条） */
export const 回复提醒键 = (projectId: string, 提: Date) => `reply-due:${projectId}:${提.toISOString()}`;

const 项目列 = { id: true, name: true, ownerId: true, awaitAssignAt: true, replyStartAt: true, replyEndAt: true } as const;
type 行 = { id: string; name: string; ownerId: string; awaitAssignAt: Date | null; replyStartAt: Date | null; replyEndAt: Date | null };

/** 在提醒窗口里的项目（进行中、不在公海、客户不在公海、没删；软删由 prisma 限定层滤掉）。ownerId 传了 = 只看这个人负责的、不在待分配的 */
async function 窗口里的(现在: Date, ownerId?: string): Promise<行[]> {
  const 晚 = new Date(现在.getTime() + 回复提前分钟 * 60_000);
  const 早 = new Date(现在.getTime() - 往回看天 * 86_400_000);
  const 们 = await prisma.project.findMany({
    where: {
      result: null, pooledAt: null, customer: { pool: null },
      ...(ownerId ? { ownerId, awaitAssignAt: null } : {}),
      OR: [{ replyStartAt: { gte: 早, lte: 晚 } }, { replyStartAt: null, replyEndAt: { gte: 现在, lte: 晚 } }],
    },
    select: 项目列,
  });
  return 们.filter((p) => 在提醒窗口(p, 现在));
}

/**
 * 这几条里哪些已经回复了：提醒时刻以后记的、挂在这条项目上、有内容的沟通（谁记的都算）。
 * 同号再次录入的系统留痕（节点 = 同号节点）不算回复，见文件头。
 * 只认负责人 = 只算记录人是这条项目现负责人（传进来的 ownerId）的：超时未跟进自动转 reply-overdue.ts 按时那一支用（11-20 用户定），
 * 本文件自己的提醒、首页待办不传，照旧谁记的都算
 */
export async function 已回复的(们: readonly (两格 & { id: string; ownerId?: string })[], 只认负责人 = false): Promise<Set<string>> {
  if (!们.length) return new Set();
  const 最早 = new Date(Math.min(...们.map((p) => 回复提醒时刻(p)!.getTime())));
  const [挂的, 词] = await Promise.all([
    prisma.followUpProject.findMany({
      where: { projectId: { in: 们.map((p) => p.id) }, node: { not: 同号节点 }, followUp: { createdAt: { gte: 最早 }, deletedAt: null } },
      select: { projectId: true, followUp: { select: { content: true, createdAt: true, ownerId: true } } },
    }),
    读占位词(),
  ]);
  const 提of = new Map(们.map((p) => [p.id, 回复提醒时刻(p)!.getTime()]));
  const 负责人of = new Map(们.map((p) => [p.id, p.ownerId]));
  return new Set(挂的.filter((f) => f.followUp.createdAt.getTime() >= (提of.get(f.projectId) ?? Infinity)
    && (!只认负责人 || (!!负责人of.get(f.projectId) && f.followUp.ownerId === 负责人of.get(f.projectId)))
    && 有内容的沟通(f.followUp.content, { 占位词: 词 })).map((f) => f.projectId));
}

/** 扫一遍，回新记了几条通知。从不抛 */
export async function 指定回复提醒扫一遍(现在: Date = new Date()): Promise<number> {
  if (!企业版() || !回复提醒开) return 0;
  try {
    if (await 视图中跳过()) return 0;
    return await 看全部(async () => {
      const 们 = await 窗口里的(现在);
      if (!们.length) return 0;
      const 回了 = await 已回复的(们);
      const 要发 = 们.filter((p) => !回了.has(p.id));
      if (!要发.length) return 0;
      const 待分配 = 要发.some((p) => p.awaitAssignAt);
      const 分配人 = 待分配 ? 能分配的人们(await 读组织()) : [];
      const 条们 = 要发.map((p) => ({ p, 人们: p.awaitAssignAt ? 分配人 : [p.ownerId], key: 回复提醒键(p.id, 回复提醒时刻(p)!) }));
      const 涉及 = [...new Set(条们.flatMap((t) => t.人们))];
      const [在职们, 记过们] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: 涉及 }, active: true }, select: { id: true } }),
        prisma.entNotice.findMany({ where: { dedupeKey: { in: 条们.map((t) => t.key) } }, select: { userId: true, dedupeKey: true } }),
      ]);
      const 在职 = new Set(在职们.map((u) => u.id));
      const 记过 = new Set(记过们.map((r) => `${r.userId}\n${r.dedupeKey}`));
      let 数 = 0;
      for (const { p, 人们, key } of 条们) {
        const 发给 = 人们.filter((u) => 在职.has(u) && !记过.has(`${u}\n${key}`));
        if (!发给.length) continue;
        const 时 = 指定回复文字(p.replyStartAt, p.replyEndAt, 现在);
        数 += await notify(发给, {
          kind: "指定回复",
          title: `指定回复时间 ${时}：${p.name}`,
          body: p.awaitAssignAt ? `这条新线索还在待分配，指定回复时间 ${时}：先分给负责人，或者先联系一次` : `指定回复时间快到了（${时}），联系后在项目上记一条沟通`,
          link: `/projects/${encodeURIComponent(p.id)}`,
          key,
        });
      }
      return 数;
    });
  } catch (e) {
    console.error("[指定回复提醒] 这一遍没扫成，下一遍再试", e);
    return 0;
  }
}

/** 钟上调的（每分钟一遍）：同上 */
export const 钟上指定回复提醒 = 指定回复提醒扫一遍;

/**
 * 首页待办「待回复客户 N」：我负责的（不在待分配）、在提醒窗口里、还没回复的；最早截止的那条给链接。一条都没有 = null。
 * 超时 = 其中已经发过超时提醒、还没记沟通的（超时未跟进自动转 reply-overdue.ts，过了截止也留在这里，直到记了沟通或被转走）；
 * 有超时的先链到超时那条。没填指定回复时间、按分配时刻起算的超时（11-20）：时 = 这一位的计时起点（分配 / 接手那刻），分配话 = 「分配后 1 小时未跟进」，首页那行不写「指定回复」
 */
export type 待回复客户数 = { 条数: number; 超时?: number; 最早: { projectId: string; name: string; 时: string; 超时?: true; 分配话?: string } | null };
export async function 待回复客户of(userId: string, 现在: Date = new Date()): Promise<待回复客户数 | null> {
  if (!企业版() || !回复提醒开) return null;
  try {
    const [们, 超时们] = await Promise.all([窗口里的(现在, userId), 我超时未跟进的(userId)]);
    if (!们.length && !超时们.length) return null;
    const 回了 = await 已回复的(们);
    const 超时ids = new Set(超时们.map((p) => p.id));
    const 剩 = 们.filter((p) => !回了.has(p.id) && !超时ids.has(p.id)).sort((a, b) => 回复截止(a)!.getTime() - 回复截止(b)!.getTime());
    if (!剩.length && !超时们.length) return null;
    const 时of = (p: 两格) => 指定回复文字(p.replyStartAt, p.replyEndAt, 现在);
    const 超 = 超时们[0];
    const 最早 = 超
      ? 超.按分配
        ? { projectId: 超.id, name: 超.name, 时: 短时刻(超.分配于, 现在) || 空值符, 超时: true as const, 分配话: 分配后未跟进话(超时提醒分钟) }
        : { projectId: 超.id, name: 超.name, 时: 时of(超), 超时: true as const }
      : { projectId: 剩[0].id, name: 剩[0].name, 时: 时of(剩[0]) };
    return { 条数: 剩.length + 超时们.length, ...(超时们.length ? { 超时: 超时们.length } : {}), 最早 };
  } catch (e) {
    console.error("[指定回复提醒] 首页待办没取到", e);
    return null;
  }
}
