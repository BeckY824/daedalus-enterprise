/**
 * 企业版「回公海」怎么写给人看（2026-10-30 交互调整 P0-1 / P0-2）。只管文字和预演，不碰 prisma，界面直接引。
 * 回收日本身由服务端算（lib/project/timeout.ts 超时回收日），这里不另起算法：
 *   - 回公海文案：把回收日写成具体日子 + 天数（术语表：「11-06 回公海 · 还剩 7 天」「明天回公海（11-06）」），
 *     3 天内 = 「近」（橙），当天 = 「当天」（红），已过 = 「已过」（红）
 *   - 预演回收日：记沟通时选了下一步时间，回收日会变成哪天。和 超时回收日 同一个算法，只是起点换成「记完这条以后」的起点
 * 项目列表（看板 / 列表）的「即将回收」标签也用 回公海文案 的 短文字
 */
import { dayjs } from "@/lib/utils";

export type 回公海级别 = "常" | "近" | "当天" | "已过";
export type 回公海文案结果 = { 文字: string; 短文字: string; 剩天: number; 级别: 回公海级别 };

/** 剩几天算「近」（标橙）：和首页「3 天内回公海」同一个口径 */
export const 回公海临近天数 = 3;

/** 回收日写成 MM-DD；跨年写全 */
function 日子(回收日: string, 今: Date | string): string {
  const d = dayjs(回收日);
  return d.year() === dayjs(今).year() ? d.format("MM-DD") : d.format("YYYY-MM-DD");
}

/** 回收日（YYYY-MM-DD）→ 给人看的一句。剩天 = 回收日 - 今天（自然日，业务钟） */
export function 回公海文案(回收日: string, 今: Date | string = new Date()): 回公海文案结果 {
  const 剩天 = dayjs(回收日).startOf("day").diff(dayjs(今).startOf("day"), "day");
  const 日 = 日子(回收日, 今);
  if (剩天 < 0) return { 文字: `已过回收日（${日}）`, 短文字: `已过回收日（${日}）`, 剩天, 级别: "已过" };
  if (剩天 === 0) return { 文字: `今天回公海（${日}）`, 短文字: `今天回公海（${日}）`, 剩天, 级别: "当天" };
  const 级别: 回公海级别 = 剩天 <= 回公海临近天数 ? "近" : "常";
  return { 文字: `${日} 回公海 · 还剩 ${剩天} 天`, 短文字: 剩天 === 1 ? `明天回公海（${日}）` : `${日} 回公海`, 剩天, 级别 };
}

/** 级别 → 颜色（用全站的语义色，不另配） */
export const 回公海颜色: Record<回公海级别, string | undefined> = {
  常: undefined, 近: "var(--warning)", 当天: "var(--danger-text)", 已过: "var(--danger-text)",
};

/** 服务端给的预演底子：起点日 = 现在的起点（建项目 / 换进程 / 接手 / 客户最近沟通里最晚的那天），天数 = 这个进程的处理时长 */
export type 回收预演底子 = { 起点日: string; 天数: number };

/**
 * 记完这条沟通，回收日会变成哪天（YYYY-MM-DD）。没选下一步时间、日子不对 = null（界面就不显示这句）。
 * 和 timeout.ts 超时回收日 同一个算法：起点 = max(原起点, 这条沟通的日子)；起点 + 天数；
 * 下一步那天不早于起点 → 下一步那天过完也收，取早的
 */
export function 预演回收日(底子: 回收预演底子 | null | undefined, 沟通日: string | null | undefined, 下一步日: string | null | undefined): string | null {
  if (!底子 || !(底子.天数 > 0) || !下一步日) return null;
  const 原 = dayjs(底子.起点日);
  const 沟 = 沟通日 ? dayjs(沟通日) : null;
  const 下 = dayjs(下一步日);
  if (!原.isValid() || !下.isValid() || (沟 && !沟.isValid())) return null;
  const 起 = (沟 && 沟.isAfter(原) ? 沟 : 原).startOf("day");
  let 日 = 起.add(底子.天数, "day");
  const 下一步 = 下.startOf("day");
  if (!下一步.isBefore(起)) {
    const 过完 = 下一步.add(1, "day");
    if (过完.isBefore(日)) 日 = 过完;
  }
  return 日.format("YYYY-MM-DD");
}
