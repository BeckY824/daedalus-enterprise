/**
 * 客户三态在列表、看板上的标（P-界面-19 ①②，构想页 C2 / C5）：浏览器、服务端共用的叫法和说明，不碰库。
 * 活跃不标；沉睡 / 待回收 / 暂缓回收中各一个小标签（待回收带「N 天后进公海」）；负责人是市场成员的写「不计时」（M-公海-34）。
 * 取数在 tri-state-list.ts（只在服务端用）
 */

/** 列表「全部回收状态」能筛的几个值（地址栏 triState=），同构想页 C2 的下拉 */
export const 三态筛选值们 = ["沉睡", "待回收", "暂缓回收中", "不计时"] as const;
export type 三态筛选值 = (typeof 三态筛选值们)[number];
export const 是三态筛选值 = (v: unknown): v is 三态筛选值 => typeof v === "string" && (三态筛选值们 as readonly string[]).includes(v);

/** 一位客户的标：活跃没有标（不给） */
export type 三态标 = { 态: 三态筛选值; /** 待回收：按钟上的进入日和这位客户适用那套天数，还有几天到进公海那天（≤0 = 到了，等提醒发够） */ 几天后进公海?: number };

/** 标签上的字 */
export function 三态标字(x: 三态标): string {
  if (x.态 !== "待回收") return x.态;
  const n = x.几天后进公海;
  if (n === undefined) return "待回收";
  return n > 0 ? `待回收 · ${n} 天后进公海` : "待回收 · 即将进公海";
}

/** 悬停说明 */
export function 三态标说明(x: 三态标): string {
  switch (x.态) {
    case "沉睡": return "沉睡：很久没有有效沟通，也没有项目推进";
    case "待回收": return x.几天后进公海 !== undefined && x.几天后进公海 > 0
      ? `待回收：再没有有效沟通，${x.几天后进公海} 天后自动进客户公海`
      : "待回收：已到进公海的天数，提醒发够后自动进客户公海";
    case "暂缓回收中": return "暂缓回收中：到期该进公海，名下有同事在推的项目，等条线总管理裁决";
    case "不计时": return "负责人是市场成员，不计回收时间";
  }
}

/** 看板卡片上点不点色点：沉睡、待回收、暂缓回收中点；不计时不点 */
export const 看板要点 = (x: 三态标 | undefined): x is 三态标 => !!x && x.态 !== "不计时";
