import { dayjs } from "@/lib/utils";
import { calendarDaysBetween, isCalendarDate } from "@/lib/schedule-date";

/**
 * 时间预设旁边的「自定义」（V3.5.1 P-界面-10）：人自己挑开始日、结束日，两头都算。
 * 只管读地址栏、算边界，不碰库；服务端（页面取数）和浏览器（RangePicker 回显）都用。
 *
 * 地址栏里永远是 YYYY-MM-DD 两个日历日（不是瞬间）。边界按业务钟算：企业版是北京日界线（lib/business-clock.ts），
 * 跟「本月」「本年」那几档用的同一个 dayjs，人在伦敦打开也是北京的那几天。
 */
export type 日期段 = { from: string; to: string };

/** 年份只认 2000–2099：地址栏手改成 0001 年，按月铺刻度会铺出两万多根 */
const 年份合理 = (v: string) => {
  const y = Number(v.slice(0, 4));
  return y >= 2000 && y <= 2099;
};
export const 是日期 = (v: unknown): v is string => typeof v === "string" && isCalendarDate(v) && 年份合理(v);

/**
 * 读地址栏的两头：两个都是合法日历日才用（倒过来了就换个个儿）；缺一个、写错一个 = 本月 1 号到今天。
 * 我们自己的选择器总是两头一起写，只剩一头多半是手改坏的，猜它想要哪一段不如回到默认
 */
export function 读日期段(from?: string, to?: string, now = dayjs()): 日期段 {
  if (!是日期(from) || !是日期(to)) return { from: now.startOf("month").format("YYYY-MM-DD"), to: now.format("YYYY-MM-DD") };
  return from <= to ? { from, to } : { from: to, to: from };
}

/** 这一段的真实瞬间：开始日零点到结束日 23:59:59.999（同 本月 用 endOf） */
export function 日期段界(段: 日期段): { from: Date; to: Date } {
  return { from: dayjs(段.from).startOf("day").toDate(), to: dayjs(段.to).endOf("day").toDate() };
}

/** 一共几天（两头都算） */
export const 日期段天数 = (段: 日期段): number => calendarDaysBetween(段.from, 段.to) + 1;

/** 走势图按天还是按月铺：62 天以内（两个月）按天，再长按月，不然横轴挤成一条 */
export const 日期段粒度 = (段: 日期段): "day" | "month" => (日期段天数(段) <= 62 ? "day" : "month");

/** 口径 / 标题上的写法 */
export const 日期段叫法 = (段: 日期段): string => `${段.from} 至 ${段.to}`;

/**
 * 列表按「创建时间」筛（11-11 客户、项目列表）：地址栏 createdFrom / createdTo 两个日历日，两头都算，边界按业务钟
 * （企业版北京日：开始日 00:00 到结束日 23:59:59.999，同 日期段界）。和 读日期段 不同：没给 / 写错的那一头不限，
 * 两头都没有就不筛（返回 null）；两头倒过来对调。
 */
export function 创建时间段(from?: string, to?: string): { gte?: Date; lte?: Date } | null {
  const a = 是日期(from) ? from : "";
  const b = 是日期(to) ? to : "";
  if (!a && !b) return null;
  const [起, 止] = a && b && a > b ? [b, a] : [a, b];
  return {
    ...(起 ? { gte: dayjs(起).startOf("day").toDate() } : {}),
    ...(止 ? { lte: dayjs(止).endOf("day").toDate() } : {}),
  };
}
