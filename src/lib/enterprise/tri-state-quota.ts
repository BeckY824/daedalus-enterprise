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

/** 留痕的方式（EntCustomerStateLog.via） */
export const 留痕方式 = { 自动: "自动", 本人: "本人", 上级代选: "上级代选", 总管理代选: "总管理代选", 总管理裁决: "总管理裁决" } as const;
export type 留痕方式 = (typeof 留痕方式)[keyof typeof 留痕方式];

/** 暂缓回收（M-公海-27）留痕理由的开头：界面和留痕都叫这个名字 */
export const 暂缓回收 = "暂缓回收";
/** 让同事结束项目（M-公海-27 被挡裁决的第二个动作）留痕理由的开头 */
export const 让同事结束项目 = "让同事结束项目";

/**
 * 「有效沟通」判定（客户 11-12 答复 T1 / T2，覆盖 X-102）：只有有效沟通才既拨钟、又回满继续持有额度，两处同源（拨钟的沟通 = 有内容的沟通）。
 *   - 去掉空白、标点、符号、表情和链接以后不足 4 个字的算空（只有素材——录音、截图、纪要链接——没有文字的，就落在这一条里）；
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
  if (字数(s) < 有效沟通最少字数) return false;
  return !只有占位词(s, 选.占位词 ?? 默认占位词);
}

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
