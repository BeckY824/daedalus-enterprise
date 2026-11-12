/**
 * 客户三态 · 继续持有额度和留痕的换算（M-公海-19、M-公海-23、M-公海-27、M-公海-38）：纯函数，不碰库、不读时钟。
 * 夜扫（tri-state-db.ts）和继续持有按钮（customers/tri-state-actions.ts）共用。
 *
 *   - 有内容的沟通：拨钟、回满额度共用一个判定（X-102 定之前占位式的先不判，留口子在 占位式沟通）
 *   - 额度挂在客户钟上、不在负责人上：换负责人不动；本人点、上级代选都扣；暂缓回收不扣
 *   - 额度回满（M-公海-38）：不在各处写沟通的地方挂钩，读的时候判——最近一条有内容的沟通（上海日）晚于「额度上次重置日」就回满、记下这天；
 *     同一天再记沟通不再回满。真正算剩几次以 算三态() 为准（它只认最近一次有内容沟通以后的推后），钟上的次数 / 天数是给界面看的缓存
 *   - 留痕 → 推后记录：本人 / 上级代选、带顺延天数的那几行是继续持有；总管理裁决里理由以「暂缓回收」开头的是暂缓回收
 */
import type { 推后记录 } from "./tri-state";

/** 留痕的方式（EntCustomerStateLog.via） */
export const 留痕方式 = { 自动: "自动", 本人: "本人", 上级代选: "上级代选", 总管理裁决: "总管理裁决" } as const;
export type 留痕方式 = (typeof 留痕方式)[keyof typeof 留痕方式];

/** 暂缓回收（M-公海-27）留痕理由的开头：界面和留痕都叫这个名字 */
export const 暂缓回收 = "暂缓回收";
/** 让同事结束项目（M-公海-27 被挡裁决的第二个动作）留痕理由的开头 */
export const 让同事结束项目 = "让同事结束项目";

/**
 * 占位式沟通（M-公海-38「占位式记录不算」）：标准我方还没出（X-102 待定），现在一律不算占位。
 * 定了只改这里，拨钟和回满额度同时生效
 */
export function 占位式沟通(_内容: string): boolean {
  return false;
}

/** 算不算「有内容」的沟通：去掉空白后还有字、又不是占位式的（M-公海-38） */
export function 有内容的沟通(内容: string | null | undefined): boolean {
  const s = (内容 ?? "").replace(/[\s　]+/g, "");
  return s.length > 0 && !占位式沟通(s);
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

/** 留痕里的继续持有（本人点 / 上级代选、带顺延天数、在沉睡或待回收轮） → 算三态() 要的推后记录，按日子先后 */
export function 留痕转推后(行们: readonly 留痕行[]): 推后记录[] {
  return 行们
    .filter((x) => (x.via === 留痕方式.本人 || x.via === 留痕方式.上级代选) && x.holdDays !== null && x.holdDays > 0 && (x.fromState === "沉睡" || x.fromState === "待回收"))
    .map((x) => ({ 日: x.日, 轮: x.fromState as "沉睡" | "待回收", 天数: x.holdDays!, ...(x.via === 留痕方式.上级代选 ? { 代选: true } : {}) }))
    .sort((a, b) => a.日.localeCompare(b.日));
}

/** 最近一次「暂缓回收」裁决的日子（算三态() 的 暂缓回收日）；没有 null */
export function 最近暂缓回收日(行们: readonly 留痕行[]): string | null {
  let 最 = null as string | null;
  for (const x of 行们) if (x.via === 留痕方式.总管理裁决 && (x.reason ?? "").startsWith(暂缓回收) && (最 === null || x.日 > 最)) 最 = x.日;
  return 最;
}

/** 这位客户被三态自动收回过几次（留痕 toState = 公海、方式自动），M-公海-28 第 2 次起抄原负责人的直属上级 */
export const 自动收回次数 = (行们: readonly 留痕行[]): number => 行们.filter((x) => x.toState === "公海" && x.via === 留痕方式.自动).length;
