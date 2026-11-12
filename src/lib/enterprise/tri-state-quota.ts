/**
 * 客户三态 · 继续持有额度和留痕的换算（M-公海-19、M-公海-23、M-公海-27、M-公海-38）：纯函数，不碰库、不读时钟。
 * 夜扫（tri-state-db.ts）和继续持有按钮（customers/tri-state-actions.ts）共用。
 *
 *   - 有效沟通（T1 / T2）：拨钟和回满额度同一个判定（有内容的沟通），见下面
 *   - 额度挂在客户钟上、不在负责人上：换负责人不动；本人点、上级代选都扣；暂缓回收不扣
 *   - 额度回满（M-公海-38）：不在各处写沟通的地方挂钩，读的时候判——最近一条有内容的沟通（上海日）晚于「额度上次重置日」就回满、记下这天；
 *     同一天再记沟通不再回满。真正算剩几次以 算三态() 为准（它只认最近一次有内容沟通以后的推后），钟上的次数 / 天数是给界面看的缓存
 *   - 留痕 → 推后记录：本人 / 上级代选、带顺延天数的那几行是继续持有；总管理裁决里理由以「暂缓回收」开头的是暂缓回收
 */
import type { 推后记录 } from "./tri-state";
import { beijingDay } from "@/lib/business-clock";

/**
 * 沟通生效日（M-公海-54，客户 11-12 定）：一条沟通算哪天的动静，取「沟通日期」（occurredAt）和「记录写入时间」（createdAt）里较早的那个；
 * 沟通日期为空时用写入时间。补录三个月前的沟通只算到三个月前那天，填了未来日期的按写入时间算。
 * 一把尺管三处：客户的钟（tri-state-db.ts 最近沟通日们）、冷项目清冷（tri-state-detail.ts 读冷项目）、额度与暂缓次数重置（从同一个最近沟通日来）。
 * 读库时在 SQL 里排序用 沟通生效时刻SQL，两边必须同一个取法
 */
export function 沟通生效时刻(沟通日期: Date | null | undefined, 写入时间: Date): Date {
  return 沟通日期 && 沟通日期.getTime() < 写入时间.getTime() ? 沟通日期 : 写入时间;
}
/**
 * 生效时刻晚于「现在」多少以内仍算（毫秒）：写入时间是数据库引擎记的，和调用方的「现在」可能差几毫秒，刚存的那条不能被当成未来的。
 * 同保存时「发生时间不能在未来」那 1 分钟的余量
 */
export const 生效时刻余量 = 60_000;
/** 同 沟通生效时刻，SQLite 表达式（表别名.列）：空的沟通日期落到写入时间 */
export const 沟通生效时刻SQL = (表: string) => `MIN(COALESCE(${表}."occurredAt", ${表}."createdAt"), ${表}."createdAt")`;

/** 留痕的方式（EntCustomerStateLog.via） */
export const 留痕方式 = { 自动: "自动", 本人: "本人", 上级代选: "上级代选", 总管理代选: "总管理代选", 总管理裁决: "总管理裁决" } as const;
export type 留痕方式 = (typeof 留痕方式)[keyof typeof 留痕方式];

/** 暂缓回收（M-公海-27）留痕理由的开头：界面和留痕都叫这个名字 */
export const 暂缓回收 = "暂缓回收";
/** 让同事结束项目（M-公海-27 被挡裁决的第二个动作）留痕理由的开头 */
export const 让同事结束项目 = "让同事结束项目";

/**
 * 「有效沟通」判定（客户 11-12 答复 T1 / T2，覆盖 X-102）：只有有效沟通才既拨钟、又回满继续持有额度，两处同源（拨钟的沟通 = 有内容的沟通）。
 *   - 字数（S5 细化 + 客户确认）：中文和英文分别判、任一满足就有效——按空白和标点切开，连续字母串算 1 个单词，英文（以及俄文、希腊文、
 *     阿拉伯文、希伯来文这些按单词书写的文字）≥ 2 个单词；中文（以及日文、韩文等不分词的文字）去掉空白、标点、表情后 ≥ 4 个字；
 *     数字、符号、表情、链接都不算字（纯数字串、纯符号、纯表情、只贴素材链接的都算空；「报价 3 万」只有 3 个中文字，算空）；
 *   - 整条只由占位词拼成的算空（「跟进」「已联系」「1」……，词表存在 Setting 占位词键 里、后台可改，没存用默认词表）；
 *   - AI 起草成功的（这条沟通有速记原文 FollowUpSource）以生成结果判：有字就算有效，不再按字数、占位词卡；
 *   - 同一天几条只算一次：调用方只取最晚那天（上海日）
 */
export const 有效沟通最少字数 = 4;
/** 默认占位词（客户 11-12 答复 T2 原话列的那几个） */
export const 默认占位词: readonly string[] = ["跟进", "已联系", "联系了", "已沟通", "拜访", "回访", "1"];
/** Setting 里占位词表的键：值是字符串数组 */
export const 占位词键 = "entTriPlaceholderWords";
const 链接 = /(?:https?:\/\/|www\.)\S+/giu;
/** 去掉链接、空白、标点、符号、表情（零宽连接、变体选择符一起去），英文转小写 */
export const 去杂 = (s: string): string => s.replace(链接, "").replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}\u200d\ufe0f\u20e3]/gu, "").toLowerCase();
const 字数 = (s: string) => [...s].length;
/** 按单词书写的文字至少几个单词（S5：Met、Call 这种单个单词算空） */
export const 有效沟通最少单词 = 2;
/** 按单词书写（空格分词）的文字：拉丁、西里尔、希腊、阿拉伯、希伯来——和英文同一口径数单词 */
const 分词文字 = "\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{Script=Arabic}\\p{Script=Hebrew}";
/** 一个单词：连续的分词文字字母（附着的变音符号算在词里；空白、标点、数字、符号都切开） */
const 单词 = new RegExp(`(?:(?=[${分词文字}])\\p{L}\\p{M}*)+`, "gu");
const 分词字母 = new RegExp(`(?=[${分词文字}])\\p{L}`, "gu");
/**
 * 单词数（客户 S5 口径）：按空白和标点切开，连续字母串算 1 个单词（`e-mail` 是 2 个）；链接先去掉。
 * 英文、俄文、希腊文、阿拉伯文、希伯来文都这么数
 */
export const 英文单词数 = (s: string): number => (s.replace(链接, " ").match(单词) ?? []).length;
/** 中文字数：不分词的文字（中、日、韩等）的字数——不含分词文字、数字、符号、表情、空白标点；链接先去掉 */
export const 中文字数 = (s: string): number => 字数(s.replace(链接, " ").replace(分词字母, "").replace(/[^\p{L}]/gu, ""));

/** 整条（已去杂）能不能完全拆成占位词（可重复、可连写：「已联系跟进」「11」都算） */
export function 只有占位词(s: string, 词们: readonly string[]): boolean {
  const 词 = [...new Set(词们.map(去杂).filter(Boolean))];
  if (!s || !词.length) return false;
  const 能 = new Array<boolean>(s.length + 1).fill(false);
  能[0] = true;
  for (let i = 0; i < s.length; i++) {
    if (!能[i]) continue;
    for (const w of 词) if (s.startsWith(w, i)) 能[i + w.length] = true;
  }
  return 能[s.length];
}

/** 占位式沟通（M-公海-38「占位式记录不算」）：去杂后整条只由占位词拼成 */
export function 占位式沟通(内容: string, 词们: readonly string[] = 默认占位词): boolean {
  return 只有占位词(去杂(内容), 词们);
}

export type 沟通判定选项 = { 占位词?: readonly string[]; AI生成?: boolean };

/** 算不算有效沟通（T1 / T2）：拨钟、回满额度都用它 */
export function 有内容的沟通(内容: string | null | undefined, 选: 沟通判定选项 = {}): boolean {
  const 原 = (内容 ?? "").trim();
  if (!原) return false;
  const s = 去杂(原);
  if (选.AI生成) return s.length > 0;
  if (中文字数(原) < 有效沟通最少字数 && 英文单词数(原) < 有效沟通最少单词) return false;
  return !只有占位词(s, 选.占位词 ?? 默认占位词);
}

/** 一条沟通为什么不算有效沟通（客户详情保存后那句轻提示 C12 用；和 有内容的沟通 同一套判定，算有效回 null） */
export type 无效沟通原因 = "空" | "只有链接" | "占位词" | "太短";
export function 无效沟通原因of(内容: string | null | undefined, 选: 沟通判定选项 = {}): 无效沟通原因 | null {
  if (有内容的沟通(内容, 选)) return null;
  const 原 = (内容 ?? "").trim();
  if (!原) return "空";
  if (!去杂(原) && /(?:https?:\/\/|www\.)\S+/iu.test(原)) return "只有链接";
  if (中文字数(原) >= 有效沟通最少字数 || 英文单词数(原) >= 有效沟通最少单词) return "占位词";
  return 只有占位词(去杂(原), 选.占位词 ?? 默认占位词) ? "占位词" : "太短";
}

/** 前端那句轻提示（C12）：原因不同措辞略调 */
export const 短沟通话: Record<无效沟通原因, string> = {
  空: "已保存。这条没有文字，不计入有效沟通，不会重置回收倒计时",
  只有链接: "已保存。这条只有链接、没有文字，不计入有效沟通，不会重置回收倒计时",
  占位词: "已保存。这条只有「跟进」「已联系」这类占位词，不计入有效沟通，不会重置回收倒计时",
  太短: "已保存。这条太短，不计入有效沟通，不会重置回收倒计时",
};
/** 保存动作回来的结果里有「短沟通」就给那句话（客户端拿去 message.info），没有回 null */
export const 短沟通话of = (r: unknown): string | null => {
  const k = r && typeof r === "object" && "短沟通" in r ? (r as { 短沟通?: unknown }).短沟通 : null;
  return typeof k === "string" && k in 短沟通话 ? 短沟通话[k as 无效沟通原因] : null;
};

/** 这条沟通拨不拨钟（T1：和回满额度同源，无效沟通对客户状态一律不生效） */
export function 拨钟的沟通(内容: string | null | undefined, 选: 沟通判定选项 = {}): boolean {
  return 有内容的沟通(内容, 选);
}

/** 词表规整：去杂、去重、去空，每个最多 20 字、最多 100 个；不是数组当没存 */
export function 规整占位词(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const 出: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const w = 去杂(x.trim());
    if (w && 字数(w) <= 20 && !出.includes(w)) 出.push(w);
    if (出.length >= 100) break;
  }
  return 出;
}

export type 钟上额度 = { holdCount: number; holdDays: number; quotaResetDay: string | null };

/**
 * 额度回满（M-公海-38）：最近一条有内容的沟通日晚于额度上次重置日 → 次数、合计天数一起清零（回满），重置日记成那天。
 * 没有新的沟通、或同一天已经回满过 → 原样。回满了没有看 回满
 */
export function 额度回满(钟: 钟上额度, 最近有内容沟通日: string | null): 钟上额度 & { 回满: boolean } {
  if (!最近有内容沟通日 || (钟.quotaResetDay !== null && 最近有内容沟通日 <= 钟.quotaResetDay)) return { ...钟, 回满: false };
  return { holdCount: 0, holdDays: 0, quotaResetDay: 最近有内容沟通日, 回满: true };
}

/** 一条有效沟通（额度重置判定用）：生效日（上海日）、写入时刻（最后一次改动的时刻，防「先存无效、后改有效」倒补） */
export type 额度候选沟通 = { 日: string; 写: Date };
/** 钟上的一次动静（不是沟通的：建项目、换节点、算数的换负责人）：上海日、发生时刻（这几样都是当时写的，发生时刻就是写入时刻） */
export type 动静事件 = { 日: string; 时: Date };

/**
 * 继续持有额度、暂缓回收次数按哪天重置（M-公海-54，客户 11-12 更正）：同一位客户当天只重置一次。
 *   - 实时记的有效沟通（生效日和它最后一次改动的时刻是同一个北京日）：重置——不管当天是不是已经有建项目、换节点这些动静；
 *     当天几条有效沟通结果都一样（重置日就是那天），按事实现算天然只算一次。建档向导 / 新建项目 / 线索转项目带出的首条沟通同样按有效沟通判，
 *     占位文案不算有效、不重置；建项目和它带的首条沟通合起来就是那一天的一次
 *   - 补录的旧沟通（生效日早于最后一次改动那天）：生效日严格晚于改动之前的「当前最近动静日」（钟的归零日：起算日、建项目、换节点、
 *     算数的换负责人）才重置，同一天不算。「先存无效、过后改成有效」按改的那一刻算，也走这一条，倒补不了
 *   - 起算日（含）之前的一律不算
 *   - X-109 待客户确认：只建项目、只换节点而没有有效沟通的，不重置额度（只推钟）
 * 按事实算、不存决定：撤销 / 删了那条沟通，下次算就没有它，额度和次数回到没记它时的样子。
 * 候选按生效日倒排，取第一条算数的。更早的有效沟通不必单列：它要是不早于候选又在候选之前写，它自己会先被选中（同一天结果一样），
 * 它要是没算数，挡它的那次动静也挡候选
 */
export function 额度沟通日of(候选们: readonly 额度候选沟通[], 事件们: readonly 动静事件[], 起算日: string): string | null {
  for (const c of 候选们) {
    if (c.日 <= 起算日) return null;
    if (c.日 === beijingDay(c.写)) return c.日;
    if (事件们.some((e) => e.日 >= c.日 && e.时.getTime() < c.写.getTime())) continue;
    return c.日;
  }
  return null;
}

/** 状态留痕的一行（读库时取这几列） */
export type 留痕行 = { 日: string; fromState: string | null; toState: string; via: string; reason: string | null; holdDays: number | null };

/** 留痕里的继续持有（本人点 / 上级代选 / 待回收时条线总管理、系统管理员写理由、带顺延天数、在沉睡或待回收轮） → 算三态() 要的推后记录，按日子先后 */
export function 留痕转推后(行们: readonly 留痕行[]): 推后记录[] {
  return 行们
    .filter((x) => (x.via === 留痕方式.本人 || x.via === 留痕方式.上级代选 || x.via === 留痕方式.总管理代选) && x.holdDays !== null && x.holdDays > 0 && (x.fromState === "沉睡" || x.fromState === "待回收"))
    .map((x) => ({ 日: x.日, 轮: x.fromState as "沉睡" | "待回收", 天数: x.holdDays!, ...(x.via !== 留痕方式.本人 ? { 代选: true } : {}) }))
    .sort((a, b) => a.日.localeCompare(b.日));
}

/** 最近一次「暂缓回收」裁决的日子（算三态() 的 暂缓回收日）；没有 null */
export function 最近暂缓回收日(行们: readonly 留痕行[]): string | null {
  let 最 = null as string | null;
  for (const x of 行们) if (x.via === 留痕方式.总管理裁决 && (x.reason ?? "").startsWith(暂缓回收) && (最 === null || x.日 > 最)) 最 = x.日;
  return 最;
}

/** 这位客户被三态自动收回过几次（留痕 toState = 公海、方式自动），M-公海-28 第 2 次起抄原负责人的直属上级 */
export const 自动收回次数 = (行们: readonly 留痕行[]): number => 行们.filter((x) => x.toState === "公海" && x.via === 留痕方式.自动 && (x.reason ?? "").includes(自动进公海说法)).length;
/** 三态自动进公海那一行理由里一定有的一句（tri-state-db.ts 三态进公海理由）；手动放进公海后夜扫标掉的那行没有它 */
export const 自动进公海说法 = "自动进客户公海";

/** T11：额度上次重置（起，不含那天）以后裁决过几次暂缓回收；起 = null 数全部 */
export const 暂缓回收次数 = (行们: readonly 留痕行[], 起: string | null): number =>
  行们.filter((x) => x.via === 留痕方式.总管理裁决 && (x.reason ?? "").startsWith(暂缓回收) && (起 === null || x.日 > 起)).length;

/** T12：负责人停用、客户还挂在他名下，标「待交接」那一行的理由（进离职交接看板 /projects/handover，超 15 个工作日或 30 天推系统管理员） */
export const 待交接理由 = "负责人账号已停用，客户标待交接、进离职交接队列";
