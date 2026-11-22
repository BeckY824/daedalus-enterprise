/**
 * 首页顶部待办里的时间（设计语言 H-A，11-21，H-新13）：全站同一套 smartTime（今天 15:16 · 明天 09:00 · 昨天 · 3 天前 · 11 月 18 日 · 跨年补年份）。
 * 时间用服务端多传的 ISO 瞬间（待分配数.最早At、待回复客户数.最早.始 / 终），不从「MM-DD HH:mm」短串认回（短串没年份，跨年会认错）。
 * smartTime / dayjs 走企业版业务钟：服务端和浏览器都按北京（app/(app)/layout.tsx 的 BusinessProvider 传 timeZone，lib/business-clock.ts），
 * 人在伦敦打开也和别的页同一个「今天」，不按浏览器本地时区算。没有 ISO（旧数据）时由调用方照摆原短串
 */
import { dayjs, smartTime } from "@/lib/utils";

/**
 * 「待回复客户」这一行专用（H-A 审查 11-21）：回复时限的钟点对员工有用，smartTime 远处只写日期（「11 月 25 日」「3 天前」「昨天」）的，
 * 后面补上钟点：「11 月 25 日 21:00」「3 天前 21:00」「昨天 21:00」；今天 / 明天本来就带钟点，原样。
 * 复盘「任务」页签的待办到期（表格「到期」列、看板卡）也用它（设计语言 R-B，11-22 总控定：到期的钟点对跟进有用，和首页同一写法）
 */
export function 带钟点smart(t: string): string {
  const s = smartTime(t);
  return s.includes(":") ? s : `${s} ${dayjs(t).format("HH:mm")}`;
}

/**
 * 指定回复时段（开始 / 结束两个 ISO 瞬间）→「待回复客户」那一行的写法（带钟点的 smartTime，见 带钟点smart）：
 *   同一天：「今天 21:00 – 22:00」「11 月 25 日 21:00 – 22:00」「3 天前 21:00 – 22:00」
 *   跨天：「今天 21:00 – 明天 09:00」；只有开始：「今天 21:00 前后」；只有结束：「明天 09:00 前」；都没有 = null
 */
export function 时段smart(始: string | null | undefined, 终: string | null | undefined): string | null {
  if (始 && 终) {
    const a = 带钟点smart(始);
    if (!dayjs(始).isSame(dayjs(终), "day")) return `${a} – ${带钟点smart(终)}`;
    return `${a} – ${dayjs(终).format("HH:mm")}`;
  }
  if (始) return `${带钟点smart(始)} 前后`;
  if (终) return `${带钟点smart(终)} 前`;
  return null;
}
