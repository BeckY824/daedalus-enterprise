/**
 * 首页顶部待办里的时间（设计语言 H-A，11-21，H-新13）：全站同一套 smartTime（今天 15:16 · 明天 09:00 · 昨天 · 3 天前 · 11 月 18 日 · 跨年补年份）。
 * 时间用服务端多传的 ISO 瞬间（待分配数.最早At、待回复客户数.最早.始 / 终），不从「MM-DD HH:mm」短串认回（短串没年份，跨年会认错）。
 * smartTime / dayjs 走企业版业务钟：服务端和浏览器都按北京（app/(app)/layout.tsx 的 BusinessProvider 传 timeZone，lib/business-clock.ts），
 * 人在伦敦打开也和别的页同一个「今天」，不按浏览器本地时区算。没有 ISO（旧数据）时由调用方照摆原短串
 */
import { dayjs, smartTime } from "@/lib/utils";

/**
 * 指定回复时段（开始 / 结束两个 ISO 瞬间）→ smartTime 写法：
 *   同一天、开始带钟点：「今天 21:00 – 22:00」；开始已是「昨天」「3 天前」这类不带钟点的：只写开始
 *   跨天：「今天 21:00 – 明天 09:00」；只有开始：「今天 21:00 前后」；只有结束：「明天 09:00 前」；都没有 = null
 */
export function 时段smart(始: string | null | undefined, 终: string | null | undefined): string | null {
  if (始 && 终) {
    const a = smartTime(始);
    if (!dayjs(始).isSame(dayjs(终), "day")) return `${a} – ${smartTime(终)}`;
    return a.includes(":") ? `${a} – ${dayjs(终).format("HH:mm")}` : a;
  }
  if (始) return `${smartTime(始)} 前后`;
  if (终) return `${smartTime(终)} 前`;
  return null;
}
