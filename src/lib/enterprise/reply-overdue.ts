/**
 * 企业版「超时未跟进自动转」（11-17，客户确认的规则；指定回复时间的后续）：线索阶段、填了指定回复时间的项目，负责人一直没记有效沟通，
 * 先提醒、再自动收回分给下一位销售，接手人同样计时，不限次数。
 *
 * 规则（客户原意）：
 *   1. 时间线：指定回复时间前 30 分钟提醒（已有，reply-notice.ts）→ 过了 1 小时还没记有效沟通 = 超时提醒（站内 + 飞书 + 首页待办）
 *      → 再过 30 分钟还没记 = 自动转给下一位销售。接手人同样：接手 1 小时提醒，再 30 分钟没记再转；每人最多 1.5 小时。
 *      北京时间 22:00–08:00 什么都不执行，顺延到 08:00。
 *   2. 原负责人收一条「超时未跟进已自动收回并分配给其他成员」（站内 + 飞书）。
 *   3. 客户跟着线索给接手人。唯一例外：原负责人手上还有这位客户别的进行中项目 → 客户留在原负责人名下，接手人在项目页看到「该客户在 XXX 名下」。
 *      这是 P-转-04（项目层动作不动客户）的例外，只在这条自动转里。
 *
 * 规则没说、按默认做的（集中在本文件，改口径只改这里）：
 *   - 超时基准 = 指定回复时间的结束，没填结束用开始（一个时间点就是它；一段时间按段尾）
 *   - 有效沟通 = 和指定回复提醒同一个判定：提醒时刻（开始 ?? 结束 − 30 分钟）以后挂在这条项目上、有内容的沟通（谁记的都算）。
 *     任何时候记了，这条链就停下（这一位不再提醒、不再转）
 *   - 每一步按上一步「实际执行」的时刻往后算：超时提醒顺延到 08:00 → 08:30 转；21:50 接手 → 22:50 该提醒 → 08:00 提醒 → 08:30 转
 *   - 下一位 = 现成的自动分配挑人（assign-actions.ts 超时转出：同一条线 / 市场成员建的按客户区域、参与状态、本月分得最少、并列最早进池，
 *     配额照查），排除现负责人和这一轮超时过的人；人人都轮过一遍 → 开新一轮（仍不给现负责人）。挑不到 = 不转、留在现负责人手上，
 *     只记日志，下一分钟再试（不通知上级）
 *   - 转出算接手人的一次分配（占本月分配数）、清待分配、接手人照常收「分给你」；项目留痕记一行转让，原因「超时未跟进自动转」，操作人「系统」
 *   - 自动轮转不重置超时回收日（Even 11-19 第 14 题 B）：项目超时回收的起点不认上面那行（timeout.ts 是超时自动转痕），
 *     客户跟着转的那行（overdue-assign）三态钟也不归零（tri-state-transfer.ts 换人方式 不收它）；手动转让、领取照旧归零。
 *     本文件的接手时刻照旧认那行（接手人的 1.5 小时从轮转那刻算）
 *   - 只管：线索阶段、没结局、不在公海（项目和客户都不在）、不在回收站、不在待分配、填了指定回复时间的
 *   - 只转「分出去」的线索（11-18 客户定第 1 题 B）：负责人是别人分给他的（负责人不是建的人，或有一行把它分给现负责人的分配记录）才转；
 *     自留的（市场成员建了暂不分配、负责人就是自己）、销售「个人自持」的（自己建给自己）到点只发超时提醒给本人、首页待办标超时，不自动转。
 *     以后有人把它分给别人了，按新负责人从接手那刻重新计时，到点照转
 *   - 别人手动换了负责人：按新负责人从他接手那刻重新计时（这一轮超时过的人照记）
 *   - 出了范围（进公海、有结局、转商机、客户进公海、进回收站）的链就此停下，领回来 / 恢复了也不再接着转
 *   - 起链只往回看 起链往回看天 天（老数据上线不一口气全转）；停过机的按状态补：一遍只走一步，超时提醒补发了再等 30 分钟才转，不连环转
 *   - 客户随线索换人时，原负责人在这位客户上没做完的计划、待办一起给接手人；已结束的项目照留原负责人名下当历史
 *
 * 挂在夜扫那个每分钟的钟上（lib/project/nightly.ts，多进程只一个进程跑），排在定时分配、指定回复提醒后面。
 * 一条只发一次靠 EntNotice 的 (userId, dedupeKey) 唯一键；链走到哪一步记在 EntReplyOverdue（迁移 150）。任何一步出错只记日志，从不往外抛
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 查完再写 } from "@/lib/check-then-write";
import { 带走一位 } from "@/lib/carry-over-db";
import { 系统, 超时自动转理由 } from "@/lib/project/timeout";
import { 指定回复文字, 短时刻, 客户在谁名下话 } from "@/lib/project/time-fields";
import { 超时转出 } from "@/app/(app)/leads/assign-actions";
import { notify } from "./notify";
import { 分配通知 } from "./notice-sources";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";
import { 已回复的 } from "./reply-notice";
import { 系统操作人 } from "./scheduled-assign";
import { 超时转令牌 } from "./scheduled-assign-token";
import { 规则开着 } from "./rules";

/**
 * 总开关 = 组织规则「超时未跟进自动转」（rules-table.ts，设置 → 组织架构里系统管理员拨，默认开）。
 * 关着 = 只留 30 分钟前那条提醒，不做超时提醒和自动转、首页待办不标超时；已经转出去的不回滚，链停在原处不动。
 * 再打开时在计时的链从打开那刻重新起算（超时转重新起算），不会一打开就把关着期间早该转的一口气转走
 */
export const 超时自动转开着 = (): Promise<boolean> => 规则开着("超时自动转");
/** 计时起点（指定回复时间 / 接手）往后多少分钟发超时提醒 */
export const 超时提醒分钟 = 60;
/** 超时提醒实际发出后再过多少分钟自动转 */
export const 超时转出分钟 = 30;
/** 北京时间夜里不执行：[起, 止) 点，顺延到 止 点 */
export const 夜里 = { 起: 22, 止: 8 } as const;
/** 起链最多往回看几天的超时基准（上线、停机很久时老数据不一口气全转） */
export const 起链往回看天 = 3;
/** 给原负责人的那句（客户原话） */
export const 收回话 = "超时未跟进已自动收回并分配给其他成员";
/**
 * 项目留痕、分配通知里的原因。留痕那行（操作人 系统）不重置项目超时回收日（Even 11-19 第 14 题 B）：
 * 回收起点靠这几个字认出它（timeout.ts 是超时自动转痕），改字要一起改那边
 */
export const 超时转理由 = 超时自动转理由;
/** 通知种类（铃铛里的来源） */
export const 超时通知种类 = "超时未跟进";

const 分 = 60_000;
const 天 = 86_400_000;
const 京偏 = 8 * 3_600_000;

/** 北京时间夜里（22:00–08:00）没有 */
export function 在夜里(t: Date): boolean {
  const h = new Date(t.getTime() + 京偏).getUTCHours();
  return h >= 夜里.起 || h < 夜里.止;
}

/** 落在夜里的顺延到（北京）早上 08:00；白天的原样 */
export function 顺延到白天(t: Date): Date {
  if (!在夜里(t)) return t;
  const 京 = new Date(t.getTime() + 京偏);
  const 那天零点 = Date.UTC(京.getUTCFullYear(), 京.getUTCMonth(), 京.getUTCDate());
  const 哪天 = 京.getUTCHours() >= 夜里.起 ? 那天零点 + 天 : 那天零点;
  return new Date(哪天 + 夜里.止 * 3_600_000 - 京偏);
}

type 两格 = { replyStartAt: Date | null; replyEndAt: Date | null };

/** 超时基准：结束，没填结束用开始；都没填 = null */
export const 超时基准 = (p: 两格): Date | null => p.replyEndAt ?? p.replyStartAt;
/** 计时起点 → 超时提醒该发的时刻（夜里顺延） */
export const 超时提醒到期 = (起点: Date): Date => 顺延到白天(new Date(起点.getTime() + 超时提醒分钟 * 分));
/** 超时提醒实际发出的时刻 → 自动转该执行的时刻（夜里顺延） */
export const 超时转出到期 = (提醒于: Date): Date => 顺延到白天(new Date(提醒于.getTime() + 超时转出分钟 * 分));

/** 现在该走哪一步：夜里什么都不做；没发超时提醒 → 到期就提醒；发过 → 到期就转 */
export function 该做(s: { since: Date; overdueAt: Date | null }, 现在: Date): "提醒" | "转" | null {
  if (在夜里(现在)) return null;
  if (!s.overdueAt) return 现在.getTime() >= 超时提醒到期(s.since).getTime() ? "提醒" : null;
  return 现在.getTime() >= 超时转出到期(s.overdueAt).getTime() ? "转" : null;
}

/** 库里存的「这一轮超时过的人」 */
export function 读试过(json: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

/** 这一轮挑人时排除谁：超时过的 + 现负责人 */
export const 本轮排除 = (试过: readonly string[], 现负责人: string): string[] => [...new Set([...试过, 现负责人])];

/** 规则 3：客户怎么办。客户在公海 / 已归接手人 / 归别人（不是原负责人）= 不动 */
export type 客户去向 = "跟着走" | "留给原负责人" | "不动";
export function 客户怎么办(客户: { salesOwnerId: string; 在公海: boolean }, 原: string, 新: string, 原手上别的进行中: number): 客户去向 {
  if (客户.在公海 || 客户.salesOwnerId === 新 || 客户.salesOwnerId !== 原) return "不动";
  return 原手上别的进行中 > 0 ? "留给原负责人" : "跟着走";
}

/** 项目页那句提示（规则 3 的例外）：客户不归这条项目的负责人时；文字在 time-fields.ts（浏览器也用） */
export { 客户在谁名下话 };

export type 超时转明细 = { 提醒: number; 转出: number; 没转成: number; 停: number };

/**
 * 是不是分出去的（第 1 题 B，见文件头）：负责人不是建的人 = 别人给他的（指定、自动、定时、超时转、转让）；
 * 负责人就是建的人，但有一行把它分给他的分配记录（比如分出去又分回来）也算。都不是 = 自留 / 个人自持
 */
export const 是分来的 = (p: { ownerId: string; creatorId: string }, 有分给他的记录: boolean): boolean => p.ownerId !== p.creatorId || 有分给他的记录;

async function 分来的of(p: { id: string; ownerId: string; creatorId: string }): Promise<boolean> {
  if (p.ownerId !== p.creatorId) return true;
  return 是分来的(p, !!(await prisma.entLeadAssign.findFirst({ where: { projectId: p.id, toUserId: p.ownerId }, select: { id: true } })));
}

/** 自留、自持的超时提醒那句（不说会自动收回） */
export const 自留超时话 = "这条是你自己留着跟的，不会自动转走，请尽快联系客户并记一条有效沟通";

const 链上列 = {
  id: true, name: true, ownerId: true, creatorId: true, customerId: true, replyStartAt: true, replyEndAt: true,
  replyOverdue: { select: { anchorAt: true, holderId: true, since: true, overdueAt: true, tried: true, transfers: true, stoppedAt: true } },
} as const;
type 链项目 = {
  id: string; name: string; ownerId: string; creatorId: string; customerId: string; replyStartAt: Date | null; replyEndAt: Date | null;
  replyOverdue: { anchorAt: Date; holderId: string; since: Date; overdueAt: Date | null; tried: string; transfers: number; stoppedAt: Date | null } | null;
};

/**
 * 该看的项目：在管的范围里，且（链还在走，或超时基准过了 1 小时、在往回看的天数里还没起链 / 链停了但指定回复时间改过 = 新的一次约定，整条重来）
 */
async function 链上的(现在: Date): Promise<链项目[]> {
  const 早 = new Date(现在.getTime() - 起链往回看天 * 天);
  const 晚 = new Date(现在.getTime() - 超时提醒分钟 * 分);
  const 没在走 = { OR: [{ replyOverdue: { is: null } }, { replyOverdue: { is: { stoppedAt: { not: null } } } }] };
  const 们 = await prisma.project.findMany({
    where: {
      phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null },
      OR: [
        { replyOverdue: { is: { stoppedAt: null } } },
        { AND: [没在走, { replyEndAt: { gte: 早, lte: 晚 } }] },
        { AND: [没在走, { replyEndAt: null, replyStartAt: { gte: 早, lte: 晚 } }] },
      ],
    },
    orderBy: { id: "asc" },
    select: 链上列,
  });
  // 停了的链：时间没改过的不再看
  return 们.filter((p) => {
    const 基 = 超时基准(p);
    if (!基) return false;
    const 行 = p.replyOverdue;
    return !行?.stoppedAt || 行.anchorAt.getTime() !== 基.getTime();
  });
}

/**
 * 出了管的范围（进公海、有结局、转了商机、客户进公海、进回收站、清了指定回复时间）的链就此停下：以后领回来、恢复了也不接着转，
 * 不然公海里放了几天的线索一被领走就 1.5 小时后又转走
 */
async function 停掉出圈的(现在: Date): Promise<void> {
  await prisma.entReplyOverdue.updateMany({
    where: {
      stoppedAt: null,
      project: { OR: [{ pooledAt: { not: null } }, { result: { not: null } }, { phase: { not: "线索" } }, { customer: { pool: { isNot: null } } }, { replyStartAt: null, replyEndAt: null }] },
    },
    data: { stoppedAt: 现在 },
  });
  await 看已删(() => prisma.entReplyOverdue.updateMany({ where: { stoppedAt: null, project: { deletedAt: { not: null } } }, data: { stoppedAt: 现在 } }));
}

/** 这位负责人什么时候接手的：最近一行把项目转给他的留痕；没有 = null */
async function 接手时刻(projectId: string, ownerId: string): Promise<Date | null> {
  const r = await prisma.projectNodeLog.findFirst({
    where: { projectId, kind: { in: ["transfer", "pool-claim"] }, toOwnerId: ownerId },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  return r?.at ?? null;
}

/** 链写回去：一个项目一行 */
async function 记链(projectId: string, data: { anchorAt: Date; holderId: string; since: Date; overdueAt: Date | null; tried?: string[]; transfers?: number; stoppedAt?: Date | null }) {
  const { tried, ...别的 } = data;
  const 行 = { ...别的, ...(tried ? { tried: JSON.stringify(tried) } : {}) };
  await prisma.entReplyOverdue.upsert({ where: { projectId }, create: { projectId, ...行 }, update: 行 });
}

/** 同一条同一个原因的「没转成」日志只记一次（钟一分钟一遍，别刷屏） */
const 记过没转成 = new Map<string, string>();
function 记没转成(projectId: string, 为什么: string) {
  if (记过没转成.get(projectId) === 为什么) return;
  记过没转成.set(projectId, 为什么);
  console.warn(`[超时自动转] ${projectId} 这次没转成，留在现负责人手上，下一遍再试：${为什么}`);
}

/** 扫一遍，回各做了几样。从不抛 */
export async function 超时转扫一遍(现在: Date = new Date()): Promise<超时转明细> {
  const 明细: 超时转明细 = { 提醒: 0, 转出: 0, 没转成: 0, 停: 0 };
  if (!企业版() || 在夜里(现在)) return 明细;
  try {
    if (!(await 超时自动转开着())) return 明细;
    if (await 视图中跳过()) return 明细;
    await 看全部(async () => {
      await 停掉出圈的(现在);
      const 们 = await 链上的(现在);
      if (!们.length) return;
      const 回了 = await 已回复的(们);
      for (const p of 们) {
        try {
          await 走一步(p, 回了.has(p.id), 现在, 明细);
        } catch (e) {
          明细.没转成++;
          console.error(`[超时自动转] ${p.id} 出错，下一遍再试`, e);
        }
      }
    });
  } catch (e) {
    console.error("[超时自动转] 这一遍没扫成，下一遍再试", e);
  }
  return 明细;
}

/** 钟上调的（每分钟一遍）：同上 */
export const 钟上超时自动转 = 超时转扫一遍;

/**
 * 开关从关拨到开时调（settings/org-actions.ts 设规则）：还在走的链（没停、没转成的那一位）从现在重新计时、超时提醒清掉重发。
 * 关着期间钟不走，不重算的话打开那一分钟就会把早该转的一口气转走，负责人连句新提醒都没有。
 * 只动链的计时，不动项目、负责人；回改了几条。出错只记日志、回 0，不挡开关本身
 */
export async function 超时转重新起算(现在: Date = new Date()): Promise<number> {
  try {
    return (await 看全部(() => prisma.entReplyOverdue.updateMany({ where: { stoppedAt: null }, data: { since: 现在, overdueAt: null } }))).count;
  } catch (e) {
    console.error("[超时自动转] 重新打开时没重新计时", e);
    return 0;
  }
}

async function 走一步(p: 链项目, 回了: boolean, 现在: Date, 明细: 超时转明细): Promise<void> {
  const 基 = 超时基准(p);
  if (!基) return;
  let 行 = p.replyOverdue;
  // 改过指定回复时间（含停了的链）：整行重来（按新时间算，还没到的这一遍不动）
  if (行 && 行.anchorAt.getTime() !== 基.getTime()) {
    await prisma.entReplyOverdue.deleteMany({ where: { projectId: p.id } });
    行 = null;
    if (基.getTime() < 现在.getTime() - 起链往回看天 * 天 || 基.getTime() > 现在.getTime() - 超时提醒分钟 * 分) return;
  }
  if (回了) {
    await 记链(p.id, { anchorAt: 基, holderId: p.ownerId, since: 行?.since ?? 基, overdueAt: 行?.overdueAt ?? null, stoppedAt: 现在 });
    明细.停++;
    return;
  }
  // 眼下这一位从什么时候算
  let since: Date, overdueAt: Date | null, 试过: string[], transfers: number;
  if (!行) {
    const 接 = await 接手时刻(p.id, p.ownerId);
    since = 接 && 接.getTime() > 基.getTime() ? 接 : 基;
    overdueAt = null; 试过 = []; transfers = 0;
  } else if (行.holderId !== p.ownerId) {
    // 别人手动换了负责人：从新负责人接手那刻重新计时
    since = (await 接手时刻(p.id, p.ownerId)) ?? 现在;
    overdueAt = null; 试过 = 读试过(行.tried); transfers = 行.transfers;
    await 记链(p.id, { anchorAt: 基, holderId: p.ownerId, since, overdueAt: null });
  } else {
    since = 行.since; overdueAt = 行.overdueAt; 试过 = 读试过(行.tried); transfers = 行.transfers;
  }
  const 步 = 该做({ since, overdueAt }, 现在);
  if (!步) return;
  // 自留、自持的只提醒本人、不转（第 1 题 B）：链留着（首页待办照标超时），换了负责人再按新的人算
  const 分来 = await 分来的of(p);
  if (步 === "提醒") {
    await 发超时提醒(p, since, since.getTime() !== 基.getTime(), 现在, 分来);
    await 记链(p.id, { anchorAt: 基, holderId: p.ownerId, since, overdueAt: 现在, tried: 试过, transfers });
    明细.提醒++;
  } else if (步 === "转" && 分来) {
    if (await 转出去(p, 基, 试过, transfers, 现在)) 明细.转出++;
    else 明细.没转成++;
  }
}

/** 超时提醒（站内 + 飞书；首页待办见 reply-notice.ts 待回复客户of）。接手的 = 不是按指定回复时间起算的那一位 */
async function 发超时提醒(p: 链项目, since: Date, 接手的: boolean, 现在: Date, 分来 = true) {
  const 转时 = 短时刻(超时转出到期(现在), 现在);
  const 头 = 接手的 ? `接手已满 ${超时提醒分钟 / 60} 小时还没记有效沟通` : `指定回复时间 ${指定回复文字(p.replyStartAt, p.replyEndAt, 现在)} 已过，还没记有效沟通`;
  await notify([p.ownerId], {
    kind: 超时通知种类,
    title: `超时未跟进：${p.name}`,
    body: 分来 ? `${头}。${转时} 前还没记，这条线索会自动收回、分给其他成员` : `${头}。${自留超时话}`,
    link: `/projects/${encodeURIComponent(p.id)}`,
    key: `reply-overdue:${p.id}:${p.ownerId}:${since.toISOString()}`,
  });
}

/** 自动转一次；转成了回 true */
async function 转出去(p: 链项目, 基: Date, 试过: string[], transfers: number, 现在: Date): Promise<boolean> {
  const 原 = p.ownerId;
  const 原名 = (await prisma.user.findUnique({ where: { id: 原 }, select: { name: true } }))?.name ?? "原负责人";
  const 附 = `${超时转理由}（原负责人 ${原名} 超时没记有效沟通）`;
  let 排除 = 本轮排除(试过, 原);
  let 新一轮 = false;
  let r = await 超时转出(超时转令牌, 系统操作人, p.id, 原, 排除, 附);
  // 这一轮人人都超时过了：开新一轮，仍不给现负责人
  if (!r.ok && r.挑不到 && 排除.length > 1) {
    新一轮 = true;
    排除 = [原];
    r = await 超时转出(超时转令牌, 系统操作人, p.id, 原, 排除, 附);
  }
  if (!r.ok) {
    记没转成(p.id, r.error);
    return false;
  }
  记过没转成.delete(p.id);
  const 新 = r.接手人Id;
  // 链先记上（接手人从现在起算），客户、通知出错也不会再转一次
  await 记链(p.id, { anchorAt: 基, holderId: 新, since: 现在, overdueAt: null, tried: 新一轮 ? [原] : 排除, transfers: transfers + 1, stoppedAt: null });
  const 客户 = await 客户随线索(p.id, p.customerId, 原, 新).catch((e) => {
    console.error(`[超时自动转] ${p.id} 客户没跟过去`, e);
    return { 去向: "不动" as 客户去向, 在谁名下: null };
  });
  const 客户名下 = 客户.在谁名下 && 客户.在谁名下 !== 新
    ? (await prisma.user.findUnique({ where: { id: 客户.在谁名下 }, select: { name: true } }))?.name ?? null
    : null;
  await 分配通知(系统操作人, [{ projectId: p.id, toUserId: 新, ...(r.留下 ? { 留下: r.留下 } : {}) }], true, 客户名下 ? `${附}；${客户在谁名下话(客户名下)}` : 附);
  const 客户话 = 客户.去向 === "留给原负责人" ? "；你手上还有这位客户别的项目，客户还在你名下" : 客户.去向 === "跟着走" ? "；客户一起给了接手人" : "";
  await notify([原], {
    kind: 超时通知种类,
    title: `${收回话}：${p.name}`,
    body: `指定回复时间 ${指定回复文字(p.replyStartAt, p.replyEndAt, 现在)} 过后一直没记有效沟通，系统已自动收回，分给了 ${r.接手人}${客户话}`,
    key: `reply-overdue-out:${p.id}:${原}:${现在.toISOString()}`,
  });
  return true;
}

/**
 * 规则 3：客户跟着线索给接手人；原负责人手上还有这位客户别的进行中项目（没结局、不在公海、不在待分配）就留给原负责人。
 * 跟着走时原负责人在这位客户上没做完的计划、待办一起给接手人，记一行换负责人（overdue-assign，算分配、不算转客户、三态钟不归零）。
 * 回去向和客户现在在谁名下
 */
export async function 客户随线索(projectId: string, customerId: string, 原: string, 新: string): Promise<{ 去向: 客户去向; 在谁名下: string | null }> {
  return 看全部(() => 查完再写(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    if (!c) return { 去向: "不动" as const, 在谁名下: null };
    const 别的 = c.salesOwnerId === 原
      ? await tx.project.count({ where: { customerId, ownerId: 原, id: { not: projectId }, result: null, pooledAt: null, awaitAssignAt: null } })
      : 0;
    const 去向 = 客户怎么办({ salesOwnerId: c.salesOwnerId, 在公海: !!c.pool }, 原, 新, 别的);
    if (去向 !== "跟着走") return { 去向, 在谁名下: c.pool ? null : c.salesOwnerId };
    const 改 = await tx.customer.updateMany({ where: { id: customerId, salesOwnerId: 原 }, data: { salesOwnerId: 新 } });
    if (改.count !== 1) return { 去向: "不动" as const, 在谁名下: null };
    await 带走一位(tx, customerId, 原, 新, 系统.id, "overdue-assign", false);
    return { 去向, 在谁名下: 新 };
  }));
}

/**
 * 项目页提示「该客户在 XXX 名下」：这条项目自动转过、客户不归项目负责人（规则 3 的例外，或客户本来就在别人名下）、客户不在公海。
 * 回 XXX 的名字；不用提示 = null
 */
export async function 客户在谁名下(p: { id: string; ownerId: string; customer: { salesOwnerId: string; pool: unknown } }): Promise<string | null> {
  if (!企业版() || !p.ownerId || p.customer.pool || p.customer.salesOwnerId === p.ownerId) return null;
  const 链 = await prisma.entReplyOverdue.findUnique({ where: { projectId: p.id }, select: { transfers: true } });
  if (!链?.transfers) return null;
  return (await prisma.user.findUnique({ where: { id: p.customer.salesOwnerId }, select: { name: true } }))?.name ?? null;
}

/** 首页待办：我手上发过超时提醒、还没记有效沟通的（链还在走） */
export async function 我超时未跟进的(userId: string): Promise<{ id: string; name: string; replyStartAt: Date | null; replyEndAt: Date | null }[]> {
  if (!企业版() || !(await 超时自动转开着())) return [];
  const 们 = await prisma.project.findMany({
    where: {
      ownerId: userId, phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null },
      replyOverdue: { is: { holderId: userId, overdueAt: { not: null }, stoppedAt: null } },
      OR: [{ replyStartAt: { not: null } }, { replyEndAt: { not: null } }],
    },
    select: { id: true, name: true, replyStartAt: true, replyEndAt: true },
  });
  if (!们.length) return [];
  const 回了 = await 已回复的(们);
  return 们.filter((p) => !回了.has(p.id));
}
