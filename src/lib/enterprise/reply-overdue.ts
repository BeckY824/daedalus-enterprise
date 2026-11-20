/**
 * 企业版「超时未跟进自动转」（11-17，客户确认的规则；指定回复时间的后续）：线索阶段、分给销售的项目，负责人一直没记有效沟通，
 * 先提醒、再自动收回分给下一位销售，接手人同样计时，不限次数。
 * 两种起算（11-20 用户定「选1」：没填指定回复时间的，从分配给销售那一刻起算 1.5 小时）：
 *   - 填了指定回复时间的 = 按指定回复时间（按时）：下面规则 1 原样
 *   - 没填指定回复时间、市场分给销售的 = 按分配时刻（按分配）：分给现负责人那一刻 + 1 小时没记有效沟通 = 超时提醒，再 30 分钟 = 自动转，
 *     后面和按时的一样（接手人同样计时、夜里顺延、一遍只走一步）
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
 *   - 超时基准：按时 = 指定回复时间的结束，没填结束用开始（一个时间点就是它；一段时间按段尾）；
 *     按分配 = 分配基准()：最近一次「别人把这条线索分给他」的时刻。起算的只有这几种留痕（算起算()）：
 *     只有「别人把这条项目分给他」起算，靠留痕原因的开头认（carry-tasks.ts 那几句，写痕的入口各自带上），不靠时间：
 *       · 分配入口（自动分配、指定分配、定时分配到点，assign-actions.ts 分项目给）：转让留痕，原因以「分配方式：」开头
 *       · 手动转让（改项目，含改公海里项目的负责人）：转让留痕，原因是 待办痕（「原负责人没做完的待办…」），没碰待办的记「手动转让」
 *       · 管理从线索公海分项目（分配公海项目，pool-assign-projects.ts）：pool-claim，原因以「从线索公海分配」开头
 *         （客户还在市场手里、跟着市场转给他的也算，P-公海-11）
 *       · 管理从客户公海分客户带出的线索公海项目（客户公海分配、分项目时整包出公海）：pool-claim，原因以「从客户公海分配」开头
 *       · 市场新建时直接给销售（没有转让留痕，只有一条分配记录；含查重领取新建的那条）：按那条分配记录的时刻
 *     不起算（总控 11-20 定，P-转-28「只转市场分给销售的」：跟着客户带过去的、自己拿的不是「分给他」）：
 *       · 操作人就是接手人的（ProjectNodeLog.userId = toOwnerId；分配记录 byUserId = toUserId）：自己去公海领、自己分给自己、
 *         从客户公海领客户顺带过来的公海项目、导入出公海
 *       · 跟着客户带过去的：客户转让、管理分客户、查重领取（含带出线索公海的旧项目），原因「跟着客户转过来」开头；
 *         离职交接（交客户、只交项目、全部交给里的其余和同事两组），原因「离职交接」开头；市场转客户带项目，原因「随客户转走」开头
 *       · 原因空的转让留痕（没带开头的转项目调用、改项目没碰待办）、别的原因：从回收站恢复跟客户现负责人（「从回收站恢复…」，
 *         已停的链也不重启）、数据脚本（如「客户合并：随…并入」）
 *       · 11-20 以前写的老留痕没有这几个开头：pool-claim 按同一个客户、相差不到 随客户秒 秒、换给同一人的客户换负责人记录认——
 *         那行是管理分客户公海（kind pool-assign）= 起算（11-14 那批），别的种类（转让、离职、市场转、领取）= 不起算，没有那行 = 分线索公海项目、起算
 *         （老的分线索公海项目、客户跟着市场转的那种认不出来，按市场转不起算）；
 *         原因空的转让留痕一律不起算（老的离职交接只交项目也是这样）。老的查重领取带出的项目客户换人记录也是 pool-assign，认不出来，
 *         照起算（上线时往回 7 天里一条都没有）
 *       · 超时自动转那几行跳过（链上第一位的分配时刻不随轮转挪）；没留痕就换了负责人的（导入改负责人）= 不知道什么时候到他手上
 *     还得是「分来的」（是分来的()）：自留、自持的没填指定回复时间不进链
 *   - 有效沟通：按时 = 和指定回复提醒同一个判定：提醒时刻（开始 ?? 结束 − 30 分钟）以后挂在这条项目上、有内容的沟通（谁记的都算）；
 *     按分配 = 分配那一刻之后（createdAt 严格晚于基准）挂在这条项目上、有内容的沟通（谁记的都算），建的人建档那一刻随手记的
 *     （建的人记的、和项目建档相差不到 建档随手记秒 秒；含查重领取时市场成员记的那条）不算——例：市场建档记了一条沟通、
 *     同一分钟自动分给销售，销售之后没记 → 照样进链。
 *     两种都是：同号再次录入的系统留痕（节点 同号节点）不算，客户又来问不等于负责人回了（reply-notice.ts 已回复的）。
 *     任何时候记了，这条链就停下（这一位不再提醒、不再转）
 *   - 每一步按上一步「实际执行」的时刻往后算：超时提醒顺延到 08:00 → 08:30 转；21:50 接手 → 22:50 该提醒 → 08:00 提醒 → 08:30 转
 *   - 下一位 = 现成的自动分配挑人（assign-actions.ts 超时转出：同一条线 / 市场成员建的按客户区域、参与状态、本月分得最少、并列最早进池，
 *     配额照查），排除现负责人和这一轮超时过的人；人人都轮过一遍 → 开新一轮（仍不给现负责人）。挑不到 = 不转、留在现负责人手上，
 *     只记日志，下一分钟再试（不通知上级）
 *   - 转出算接手人的一次分配（占本月分配数）、清待分配、接手人照常收「分给你」；项目留痕记一行转让，原因「超时未跟进自动转」，操作人「系统」
 *   - 自动轮转不重置超时回收日（客户 11-19 第 14 题 B）：项目超时回收的起点不认上面那行（timeout.ts 是超时自动转痕），
 *     客户跟着转的那行（overdue-assign）三态钟也不归零（tri-state-transfer.ts 换人方式 不收它）；手动转让、领取照旧归零。
 *     本文件的接手时刻照旧认那行（接手人的 1.5 小时从轮转那刻算）
 *   - 只管：线索阶段、没结局、不在公海（项目和客户都不在）、不在回收站、不在待分配；填了指定回复时间的，或没填、有分配基准的
 *   - 只转「分出去」的线索（11-18 客户定第 1 题 B）：负责人是别人分给他的（负责人不是建的人，或有一行把它分给现负责人的分配记录，
 *     或别人从线索公海分给他的 pool-claim 留痕，11-20）才转；
 *     自留的（市场成员建了暂不分配、负责人就是自己）、销售「个人自持」的（自己建给自己）填了指定回复时间的到点只发超时提醒给本人、
 *     首页待办标超时，不自动转；没填的不进链。以后有人把它分给别人了，按新负责人从接手那刻重新计时，到点照转
 *   - 别人手动换了负责人：按新负责人从他接手那刻重新计时（这一轮超时过的人照记）。按分配的链还在走时同样（基准钉在起链那一刻）；
 *     按分配的链已经停了（记过有效沟通）再被转让 / 分给别人 = 新的一次分配，整条重来，接手人从那一刻起算
 *   - 出了范围（进公海、有结局、转商机、客户进公海、进回收站）的链就此停下，领回来 / 恢复了也不再接着转
 *   - 改指定回复时间 = 基准对不上 = 整行重来：改了时间按新时间；从空填上 = 改按时（按新填的时间，往回 3 天）；
 *     清空 = 改按分配（分配在往回 7 天里、分配后没记有效沟通的照进链，上线后一样先提醒、30 分钟后才转）；清空了又没有分配基准 = 链停下
 *   - 起链只往回看：按时 起链往回看天 天、按分配 分配起链往回看天 天（老数据上线不一口气全转；更早的由超时回收 / 三态兜底）；
 *     停过机、刚上线的按状态补：一遍只走一步，超时提醒补发了再等 30 分钟才转，不连环转
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
import { 系统, 超时自动转理由, 是超时自动转痕 } from "@/lib/project/timeout";
import { 指定回复文字, 短时刻, 客户在谁名下话, 分配后未跟进话 } from "@/lib/project/time-fields";
import { 超时转出 } from "@/app/(app)/leads/assign-actions";
import { notify } from "./notify";
import { 分配通知 } from "./notice-sources";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";
import { 已回复的 } from "./reply-notice";
import { 系统操作人 } from "./scheduled-assign";
import { 超时转令牌 } from "./scheduled-assign-token";
import { 规则开着 } from "./rules";
import { 待办痕头, 公海分配痕, 线索公海分配痕, 手动转让痕 } from "@/lib/project/carry-tasks";
import { 有内容的沟通 } from "./tri-state-quota";
import { 同号节点 } from "./same-number-collab";
import { 读占位词 } from "./tri-state-db";

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
/** 起链最多往回看几天的超时基准（上线、停机很久时老数据不一口气全转）：填了指定回复时间的（按时） */
export const 起链往回看天 = 3;
/** 没填指定回复时间、按分配时刻起算的（11-20 用户定）：分配时刻在这几天里的才起链，更早的由超时回收 / 三态兜底 */
export const 分配起链往回看天 = 7;
/** 建的人建档那一刻随手记的沟通（按分配时不算有效沟通）：建的人记的、和项目建档相差不到这几秒 */
export const 建档随手记秒 = 60;
/** 给原负责人的那句（客户原话） */
export const 收回话 = "超时未跟进已自动收回并分配给其他成员";
/**
 * 项目留痕、分配通知里的原因。留痕那行（操作人 系统）不重置项目超时回收日（客户 11-19 第 14 题 B）：
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

/** 超时基准（按时）：结束，没填结束用开始；都没填 = null（没填的按 分配基准） */
export const 超时基准 = (p: 两格): Date | null => p.replyEndAt ?? p.replyStartAt;

/** 分配基准 要看的换人留痕几列（ProjectNodeLog kind transfer / pool-claim） */
export type 换人痕 = { kind: string; userId: string; reason: string | null; fromOwnerId: string | null; toOwnerId: string | null; at: Date };
/** 分配基准 要看的分配记录几列（EntLeadAssign） */
export type 分配行 = { toUserId: string; byUserId: string; createdAt: Date };
/** 分配基准 要看的客户换负责人记录几列（CustomerOwnerLog）：认「跟着客户带过去」的项目 */
export type 客户换人 = { toOwnerId: string | null; at: Date; kind: string; userId: string };

/** 分配入口（assign-actions.ts 分项目给）那行转让留痕原因的开头 */
export const 分配方式痕头 = "分配方式：";
/** 老留痕：项目换人痕和客户换人记录相差不到这几秒、给的是同一个人 = 同一个事务里写的（看那行客户换人是哪种） */
const 随客户秒 = 5;

/**
 * 这一行换人留痕算不算「别人把它分给他」（按分配起算，见文件头）。客户换人们 = 这条项目的客户的换负责人记录
 */
export function 算起算(l: 换人痕, 客户换人们: readonly 客户换人[]): boolean {
  if (!l.toOwnerId || l.userId === l.toOwnerId) return false;
  if (l.kind !== "transfer" && l.kind !== "pool-claim") return false;
  const 因 = l.reason ?? "";
  if ([分配方式痕头, 公海分配痕, 线索公海分配痕, 手动转让痕].some((头) => 因.startsWith(头))) return true;
  // 别的原因都不是分给他：跟着客户转过来、离职交接、随客户转走（carry-tasks.ts）、从回收站恢复、数据脚本……
  if (因 && !因.startsWith(待办痕头)) return false;
  // 只剩待办痕或空。转让：待办痕 = 手动转让（改项目；没碰待办的新留痕记 手动转让痕，上面）；空 = 没带开头的转项目调用（老的离职交接只交项目等），不起算
  if (l.kind === "transfer") return !!因;
  // pool-claim：11-20 以前写的老留痕（那时分线索公海项目、带出公海的都没开头），看同一刻的客户换人
  const 同刻 = 客户换人们.find((c) => c.toOwnerId === l.toOwnerId && Math.abs(c.at.getTime() - l.at.getTime()) <= 随客户秒 * 1000);
  return !同刻 || (同刻.kind === "pool-assign" && 同刻.userId !== l.toOwnerId);
}

/**
 * 超时基准（按分配，11-20 用户定，见文件头）：现负责人这条线是哪一刻分出来的；不算 / 不知道 = null。
 *   - 最近一行不是超时自动转的转让留痕（自动分配、指定分配、定时分配到点、手动转让都记这一行）的时刻；轮转那几行跳过，链上第一位的分配时刻不挪
 *   - 那一行不算起算（算起算()：自己拿的、跟着客户带过去的、回收站恢复、数据脚本，见文件头）= null
 *   - 一行转让都没有（市场新建时直接给了销售）= 最早那条分配记录的时刻
 *   - 最近一行换人留痕不是给现负责人的（没留痕就换了人，比如导入改负责人）、不是分来的（自留、自持）= null
 * 两张表的行都是这条项目的、顺序不限
 */
export function 分配基准(p: { ownerId: string; creatorId: string }, 痕们: readonly 换人痕[], 分配们: readonly 分配行[], 客户换人们: readonly 客户换人[] = []): Date | null {
  if (!p.ownerId || !是分来的(p, 分配们.some((a) => a.toUserId === p.ownerId) || 痕们.some((l) => 公海分给他(l, p.ownerId)))) return null;
  const 痕 = 痕们.filter((l) => l.kind === "transfer" || l.kind === "pool-claim").sort((a, b) => b.at.getTime() - a.at.getTime());
  if (痕.length && 痕[0].toOwnerId !== p.ownerId) return null;
  const 那次 = 痕.find((l) => !是超时自动转痕(l));
  if (那次) return 算起算(那次, 客户换人们) ? 那次.at : null;
  const 最早 = [...分配们].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  if (!最早 || 最早.byUserId === 最早.toUserId || (!痕.length && 最早.toUserId !== p.ownerId)) return null;
  return 最早.createdAt;
}

/** 这个时刻是不是这条项目的某次换人 / 分配（按分配起的链，anchorAt 就是其中一行的时刻；指定回复时间只到分钟，对不上） */
const 是分配时刻 = (t: Date, 痕们: readonly 换人痕[], 分配们: readonly 分配行[]): boolean =>
  痕们.some((l) => l.at.getTime() === t.getTime()) || 分配们.some((a) => a.createdAt.getTime() === t.getTime());

/** 起链窗口：基准在往回看的天数里（按时 3 天、按分配 7 天）、且过了 1 小时 */
export function 在起链窗口(基: Date, 按分配: boolean, 现在: Date): boolean {
  const 天数 = 按分配 ? 分配起链往回看天 : 起链往回看天;
  return 基.getTime() >= 现在.getTime() - 天数 * 天 && 基.getTime() <= 现在.getTime() - 超时提醒分钟 * 分;
}

/** 建的人建档那一刻随手记的那条（按分配时不算有效沟通）：建的人记的、和项目建档相差不到 建档随手记秒 秒 */
export const 建档随手记 = (f: { ownerId: string; createdAt: Date }, p: { creatorId: string; createdAt: Date }): boolean =>
  f.ownerId === p.creatorId && Math.abs(f.createdAt.getTime() - p.createdAt.getTime()) < 建档随手记秒 * 1000;
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
 * 负责人就是建的人，但有一行把它分给他的分配记录（比如分出去又分回来）也算；别人从线索公海分给他的（pool-claim 留痕、操作人不是他，
 * 管理从公海分配不写分配记录，总控 11-20 定「管理从线索公海分配给销售要起算」）也算。都不是 = 自留 / 个人自持
 */
export const 是分来的 = (p: { ownerId: string; creatorId: string }, 有分给他的记录: boolean): boolean => p.ownerId !== p.creatorId || 有分给他的记录;

/** 别人从公海分给他的那行（pool-claim、到 = 他、操作人不是他） */
const 公海分给他 = (l: { kind: string; userId: string; toOwnerId: string | null }, 他: string): boolean => l.kind === "pool-claim" && l.toOwnerId === 他 && l.userId !== 他;

async function 分来的of(p: { id: string; ownerId: string; creatorId: string }): Promise<boolean> {
  if (p.ownerId !== p.creatorId) return true;
  const [分, 公海] = await Promise.all([
    prisma.entLeadAssign.findFirst({ where: { projectId: p.id, toUserId: p.ownerId }, select: { id: true } }),
    prisma.projectNodeLog.findFirst({ where: { projectId: p.id, kind: "pool-claim", toOwnerId: p.ownerId, userId: { not: p.ownerId } }, select: { id: true } }),
  ]);
  return 是分来的(p, !!分 || !!公海);
}

/** 自留、自持的超时提醒那句（不说会自动收回） */
export const 自留超时话 = "这条是你自己留着跟的，不会自动转走，请尽快联系客户并记一条有效沟通";

const 链上列 = {
  id: true, name: true, ownerId: true, creatorId: true, customerId: true, createdAt: true, replyStartAt: true, replyEndAt: true,
  replyOverdue: { select: { anchorAt: true, holderId: true, since: true, overdueAt: true, tried: true, transfers: true, stoppedAt: true } },
} as const;
type 链行 = {
  id: string; name: string; ownerId: string; creatorId: string; customerId: string; createdAt: Date; replyStartAt: Date | null; replyEndAt: Date | null;
  replyOverdue: { anchorAt: Date; holderId: string; since: Date; overdueAt: Date | null; tried: string; transfers: number; stoppedAt: Date | null } | null;
};
/** 链上的一条：算好的超时基准；按分配 = 没填指定回复时间、按分配时刻起算的那种 */
type 链项目 = 链行 & { 基: Date; 按分配: boolean };

type 换人记录 = { 痕of: Map<string, 换人痕[]>; 分配of: Map<string, 分配行[]>; 客户换人of: Map<string, 客户换人[]> };
/** 一组项目的换人留痕、分配记录（按项目分好），和它们客户的换负责人记录（按客户分好，只要 从 以后的：认跟着客户带过去的那几行） */
async function 换人记录of(们: readonly { id: string; customerId: string }[], 从: Date): Promise<换人记录> {
  const 痕of = new Map<string, 换人痕[]>(), 分配of = new Map<string, 分配行[]>(), 客户换人of = new Map<string, 客户换人[]>();
  if (!们.length) return { 痕of, 分配of, 客户换人of };
  const ids = 们.map((p) => p.id);
  const [痕们, 分配们, 客户们] = await Promise.all([
    prisma.projectNodeLog.findMany({
      where: { projectId: { in: [...ids] }, kind: { in: ["transfer", "pool-claim"] } },
      select: { projectId: true, kind: true, userId: true, reason: true, fromOwnerId: true, toOwnerId: true, at: true },
    }),
    prisma.entLeadAssign.findMany({ where: { projectId: { in: [...ids] } }, select: { projectId: true, toUserId: true, byUserId: true, createdAt: true } }),
    prisma.customerOwnerLog.findMany({ where: { customerId: { in: [...new Set(们.map((p) => p.customerId))] }, at: { gte: 从 } }, select: { customerId: true, toOwnerId: true, at: true, kind: true, userId: true } }),
  ]);
  for (const { projectId, ...l } of 痕们) 痕of.set(projectId, [...(痕of.get(projectId) ?? []), l]);
  for (const { projectId, ...a } of 分配们) if (projectId) 分配of.set(projectId, [...(分配of.get(projectId) ?? []), a]);
  for (const { customerId, ...c } of 客户们) 客户换人of.set(customerId, [...(客户换人of.get(customerId) ?? []), c]);
  return { 痕of, 分配of, 客户换人of };
}

/**
 * 该看的项目：在管的范围里，且（链还在走，或超时基准在起链窗口里、还没起链 / 链停了但基准变了 = 新的一次约定或新的一次分配，整条重来）。
 * 没基准的 = 还在走、但现在算不出基准的链（清了指定回复时间、又没有分配基准），调用方停掉
 */
async function 链上的(现在: Date): Promise<{ 们: 链项目[]; 没基准的: string[] }> {
  const 早 = new Date(现在.getTime() - 起链往回看天 * 天);
  const 晚 = new Date(现在.getTime() - 超时提醒分钟 * 分);
  const 分配早 = new Date(现在.getTime() - 分配起链往回看天 * 天);
  const 没在走 = { OR: [{ replyOverdue: { is: null } }, { replyOverdue: { is: { stoppedAt: { not: null } } } }] };
  const 行们: 链行[] = await prisma.project.findMany({
    where: {
      phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null },
      OR: [
        { replyOverdue: { is: { stoppedAt: null } } },
        { AND: [没在走, { replyEndAt: { gte: 早, lte: 晚 } }] },
        { AND: [没在走, { replyEndAt: null, replyStartAt: { gte: 早, lte: 晚 } }] },
        // 没填指定回复时间（按分配）：这几天里有过转让 / 公海分配留痕、或这几天里建的（新建时直接给销售只有分配记录）；准的下面按 分配基准 再判
        {
          AND: [没在走, { replyEndAt: null, replyStartAt: null }, {
            OR: [{ logs: { some: { kind: { in: ["transfer", "pool-claim"] }, at: { gte: 分配早, lte: 晚 } } } }, { createdAt: { gte: new Date(分配早.getTime() - 分), lte: 晚 } }],
          }],
        },
      ],
    },
    orderBy: { id: "asc" },
    select: 链上列,
  });
  const { 痕of, 分配of, 客户换人of } = await 换人记录of(行们.filter((p) => !超时基准(p)), new Date(分配早.getTime() - 天));
  const 们: 链项目[] = [], 没基准的: string[] = [];
  for (const p of 行们) {
    const 行 = p.replyOverdue;
    const 在走 = !!行 && !行.stoppedAt;
    let 基 = 超时基准(p);
    const 按分配 = !基;
    if (!基) {
      const 痕 = 痕of.get(p.id) ?? [], 分 = 分配of.get(p.id) ?? [];
      // 还在走、按分配起的链：基准钉在起链那一刻，中途手动换人不重来（走一步 按新负责人接手那刻接着算）
      基 = 行 && 在走 && 是分配时刻(行.anchorAt, 痕, 分) ? 行.anchorAt : 分配基准(p, 痕, 分, 客户换人of.get(p.customerId) ?? []);
    }
    if (!基) {
      if (在走) 没基准的.push(p.id);
      continue;
    }
    // 停了的链：基准没变的不再看；没在走的都得在起链窗口里
    if (!在走 && ((行 && 行.anchorAt.getTime() === 基.getTime()) || !在起链窗口(基, 按分配, 现在))) continue;
    们.push({ ...p, 基, 按分配 });
  }
  return { 们, 没基准的 };
}

/**
 * 出了管的范围（进公海、有结局、转了商机、客户进公海、进回收站）的链就此停下：以后领回来、恢复了也不接着转，
 * 不然公海里放了几天的线索一被领走就 1.5 小时后又转走。清了指定回复时间的不在这里停：改按分配（11-20），
 * 算不出分配基准的才停（链上的 没基准的）
 */
async function 停掉出圈的(现在: Date): Promise<void> {
  await prisma.entReplyOverdue.updateMany({
    where: {
      stoppedAt: null,
      project: { OR: [{ pooledAt: { not: null } }, { result: { not: null } }, { phase: { not: "线索" } }, { customer: { pool: { isNot: null } } }] },
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
      const { 们, 没基准的 } = await 链上的(现在);
      if (没基准的.length) await prisma.entReplyOverdue.updateMany({ where: { projectId: { in: 没基准的 }, stoppedAt: null }, data: { stoppedAt: 现在 } });
      if (!们.length) return;
      const 回了 = await 记过有效沟通的(们);
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

/** 盘点一条（只读）：下一遍扫到它会做什么。分来 = 是不是分出去的（不是 = 到点只提醒、不转） */
export type 盘点行 = { id: string; ownerId: string; 按分配: boolean; 基: Date; since: Date; 回了: boolean; 分来: boolean; 起链: boolean; 下一步: "提醒" | "转" | null };

/**
 * 只读盘点（上线前数影响面、3703 实操核对用）：现在这一刻在链上的项目、各自基准、记没记过有效沟通、下一遍会走哪一步。
 * 不写库、不发通知；夜里、开关关着照样算（下一步按白天算）。起链 = 还没有在走的链（这一遍会新起）
 */
export async function 盘点超时链(现在: Date = new Date()): Promise<盘点行[]> {
  return 看全部(async () => {
    const { 们 } = await 链上的(现在);
    const 回了 = await 记过有效沟通的(们);
    const 白天 = 顺延到白天(现在);
    const 行们: 盘点行[] = [];
    for (const p of 们) {
      // 同 走一步：基准对不上 = 整行重来；负责人和链上的对不上 = 别人手动换了人，从他接手那刻算
      const 行 = p.replyOverdue && p.replyOverdue.anchorAt.getTime() === p.基.getTime() && !p.replyOverdue.stoppedAt ? p.replyOverdue : null;
      let since: Date, overdueAt: Date | null = null;
      if (!行) {
        const 接 = await 接手时刻(p.id, p.ownerId);
        since = 接 && 接.getTime() > p.基.getTime() ? 接 : p.基;
      } else if (行.holderId !== p.ownerId) {
        since = (await 接手时刻(p.id, p.ownerId)) ?? 现在;
      } else {
        since = 行.since; overdueAt = 行.overdueAt;
      }
      const 分来 = await 分来的of(p);
      const 步 = 回了.has(p.id) ? null : 该做({ since, overdueAt }, 白天);
      行们.push({ id: p.id, ownerId: p.ownerId, 按分配: p.按分配, 基: p.基, since, 回了: 回了.has(p.id), 分来, 起链: !行, 下一步: 步 === "转" && !分来 ? null : 步 });
    }
    return 行们;
  });
}

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
  const 基 = p.基;
  let 行 = p.replyOverdue;
  // 基准变了（改过指定回复时间、从空填上 / 清空换了起算方式、停了的按分配链又分了一次，含停了的链）：整行重来（按新基准算，还没到的这一遍不动）
  if (行 && 行.anchorAt.getTime() !== 基.getTime()) {
    await prisma.entReplyOverdue.deleteMany({ where: { projectId: p.id } });
    行 = null;
    if (!在起链窗口(基, p.按分配, 现在)) return;
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

/**
 * 超时提醒（站内 + 飞书；首页待办见 reply-notice.ts 待回复客户of）。接手的 = 不是按超时基准起算的那一位（中途接手的）。
 * 按分配的不写「指定回复时间」（11-20）
 */
async function 发超时提醒(p: 链项目, since: Date, 接手的: boolean, 现在: Date, 分来 = true) {
  const 转时 = 短时刻(超时转出到期(现在), 现在);
  const 头 = 接手的 ? `接手已满 ${超时提醒分钟 / 60} 小时还没记有效沟通`
    : p.按分配 ? `${分配后未跟进话(超时提醒分钟)}（${短时刻(p.基, 现在)} 分给你），还没记有效沟通`
    : `指定回复时间 ${指定回复文字(p.replyStartAt, p.replyEndAt, 现在)} 已过，还没记有效沟通`;
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
    body: `${p.按分配 ? "分到你手上以后" : `指定回复时间 ${指定回复文字(p.replyStartAt, p.replyEndAt, 现在)} 过后`}一直没记有效沟通，系统已自动收回，分给了 ${r.接手人}${客户话}`,
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

/**
 * 这几条里哪些已经记过有效沟通（见文件头「有效沟通」）：按时的照 reply-notice.ts 已回复的（提醒时刻以后记的），
 * 按分配的照 分配后沟通过的（分配那一刻之后记的、建的人建档时随手记的不算）
 */
export async function 记过有效沟通的(
  们: readonly (两格 & { id: string; creatorId: string; createdAt: Date; 基: Date; 按分配: boolean })[],
): Promise<Set<string>> {
  const [按时, 按分配] = await Promise.all([已回复的(们.filter((p) => !p.按分配)), 分配后沟通过的(们.filter((p) => p.按分配))]);
  return new Set([...按时, ...按分配]);
}

/** 按分配的有效沟通：基准之后（严格晚于）挂在这条项目上、有内容、不是同号留痕、不是建的人建档时随手记的 */
export async function 分配后沟通过的(们: readonly { id: string; creatorId: string; createdAt: Date; 基: Date }[]): Promise<Set<string>> {
  if (!们.length) return new Set();
  const 最早 = new Date(Math.min(...们.map((p) => p.基.getTime())));
  const [挂的, 词] = await Promise.all([
    prisma.followUpProject.findMany({
      where: { projectId: { in: 们.map((p) => p.id) }, node: { not: 同号节点 }, followUp: { createdAt: { gt: 最早 }, deletedAt: null } },
      select: { projectId: true, followUp: { select: { content: true, createdAt: true, ownerId: true } } },
    }),
    读占位词(),
  ]);
  const 项目of = new Map(们.map((p) => [p.id, p]));
  return new Set(挂的.filter(({ projectId, followUp: f }) => {
    const p = 项目of.get(projectId);
    return !!p && f.createdAt.getTime() > p.基.getTime() && !建档随手记(f, p) && 有内容的沟通(f.content, { 占位词: 词 });
  }).map((f) => f.projectId));
}

/** 首页待办的一条超时：按分配 = 没填指定回复时间的（分配于 = 链上这一位的计时起点：第一位是分配时刻，轮转来的是他接手那刻），文案不写「指定回复时间」 */
export type 我超时的 = { id: string; name: string; replyStartAt: Date | null; replyEndAt: Date | null; 按分配: boolean; 分配于: Date | null };

/** 首页待办：我手上发过超时提醒、还没记有效沟通的（链还在走） */
export async function 我超时未跟进的(userId: string): Promise<我超时的[]> {
  if (!企业版() || !(await 超时自动转开着())) return [];
  const 们 = await prisma.project.findMany({
    where: {
      ownerId: userId, phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null },
      replyOverdue: { is: { holderId: userId, overdueAt: { not: null }, stoppedAt: null } },
    },
    select: { id: true, name: true, creatorId: true, createdAt: true, replyStartAt: true, replyEndAt: true, replyOverdue: { select: { anchorAt: true, since: true } } },
  });
  if (!们.length) return [];
  // 填了指定回复时间的按它；没填的按链上记的基准（分配时刻）
  const 带基 = 们.map((p) => {
    const 定 = 超时基准(p);
    return { ...p, 基: 定 ?? p.replyOverdue!.anchorAt, 按分配: !定 };
  });
  const 回了 = await 记过有效沟通的(带基);
  return 带基.filter((p) => !回了.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, replyStartAt: p.replyStartAt, replyEndAt: p.replyEndAt, 按分配: p.按分配, 分配于: p.按分配 ? p.replyOverdue!.since : null }));
}
