/**
 * 客户的「历史负责人」怎么摆（企业版 D-36，2026-10-24）。只管排和说，界面也引（不能碰 prisma）；
 * 读库在 owner-log-db.ts 的 历史负责人of
 */
import { 无负责人占位名 } from "./pool";

export type 换负责人记录 = {
  at: string;
  /** 谁转的；人删了是 null */
  操作人: string | null;
  从: string | null;
  到: string | null;
  kind: string;
  /** 客户三态：这次换负责人把钟归零了（转让、离职交接算出来的；没算过 / 不归零 = 没有这一项） */
  三态归零?: true;
  /** 12-22 逐项选：直接转时填的原因、转的那一刻的最近一次跟进（ISO）、重复咨询次数；没有就不带 */
  原因?: string;
  最近跟进?: string | null;
  重复咨询?: number | null;
};

const 种类说法: Record<string, string> = {
  assign: "改负责人",
  "market-assign": "分配",
  "overdue-assign": "超时未跟进自动转",
  claim: "从公海领取",
  "pool-assign": "从公海分配",
  deactivate: "成员停用转交",
  undo: "撤销",
  "pool-release": "进公海",
};
export const 换负责人怎么来的 = (kind: string) => 种类说法[kind] ?? "改负责人";

/**
 * 历史负责人：原负责人们，最近换走的在前，同一个人只出现一次；现任不算（转走又转回来的，眼下就是他）。
 * 记录按时间正序传进来
 */
export function 历史负责人们(记录: 换负责人记录[], 现任: string): string[] {
  const 们: string[] = [];
  for (let i = 记录.length - 1; i >= 0; i--) {
    const 从 = 记录[i].从;
    // 占位账号不是人（进公海清负责人后领走：从 = 占位账号），不列
    if (从 && 从 !== 现任 && 从 !== 无负责人占位名 && !们.includes(从)) 们.push(从);
  }
  return 们;
}

/** 悬停里那一行：「王五 把负责人从 张三 换成 李四（改负责人）」，时间另摆 */
export function 换负责人一句(r: 换负责人记录): string {
  const 头 = `${r.操作人 ?? "已删除的成员"} 把负责人从 ${r.从 ?? "（没有）"} 换成 ${r.到 ?? "（没有）"}（${换负责人怎么来的(r.kind)}）`;
  return r.原因 === undefined ? 头 : `${头}；${转让留痕一句(r)}`;
}

/** 12-22：「原因：…；最近一次跟进：11-18；重复咨询：2 次」，取不到的写「—」（判定页 #9） */
export function 转让留痕一句(r: Pick<换负责人记录, "原因" | "最近跟进" | "重复咨询">): string {
  const 日 = r.最近跟进 ? r.最近跟进.slice(0, 10) : "—";
  return `原因：${r.原因 || "—"}；最近一次跟进：${日}；重复咨询：${r.重复咨询 == null ? "—" : `${r.重复咨询} 次`}`;
}
