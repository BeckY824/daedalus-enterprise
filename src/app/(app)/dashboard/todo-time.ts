/**
 * 首页顶部待办里的时间（设计语言 H-A，11-21，H-新13）：全站同一套 smartTime（今天 15:16 · 明天 09:00 · 昨天 · 3 天前 · 11 月 18 日）。
 * 「待分配新线索」「待回复客户」的时间是服务端按北京墙钟写好的短串（lib/project/time-fields.ts 短时刻：今年「MM-DD HH:mm」、
 * 别的年「YYYY-MM-DD HH:mm」；指定回复文字：「A – B」「A 前后」「B 前」）——数据来源不动，这里把串认回瞬间再走 smartTime。
 * 认不出的原样摆（不丢字）。只在现状主题用；换皮主题照旧摆原串
 */
import { smartTime } from "@/lib/utils";

const 北京偏移毫秒 = 480 * 60_000;
const 钟点 = /^\d{2}:\d{2}$/;

/** 「11-21 20:46」「2025-12-31 23:00」（北京墙钟）→ 那一刻。缺年份按「今」在北京的年份补；认不出 = null */
export function 墙钟串转时刻(串: string, 今: Date = new Date()): Date | null {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(串.trim());
  if (!m) return null;
  const 年 = m[1] ?? String(new Date(今.getTime() + 北京偏移毫秒).getUTCFullYear());
  const t = Date.parse(`${年}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
  return Number.isNaN(t) ? null : new Date(t);
}

/** 一个墙钟短串 → smartTime；认不出原样 */
export function 墙钟smart(串: string, 今?: Date): string {
  const t = 墙钟串转时刻(串, 今);
  return t ? smartTime(t) : 串;
}

/**
 * 指定回复时段（指定回复文字 的输出）→ smartTime 写法：
 *   「11-21 21:00 – 22:00」→「今天 21:00 – 22:00」（同一天、开始带钟点时结束只写钟点；开始已是「昨天」「3 天前」这类不带钟点的，只写开始）
 *   「11-21 21:00 – 11-22 09:00」→「今天 21:00 – 明天 09:00」；「A 前后」「B 前」照写；「—」等认不出的原样
 */
export function 时段smart(串: string, 今?: Date): string {
  const s = 串.trim();
  const 段 = /^(.+?) – (.+)$/.exec(s);
  if (段) {
    const a = 墙钟smart(段[1], 今);
    if (a === 段[1]) return s;
    if (钟点.test(段[2])) return a.includes(":") ? `${a} – ${段[2]}` : a;
    return `${a} – ${墙钟smart(段[2], 今)}`;
  }
  const 前后 = /^(.+) 前后$/.exec(s);
  if (前后) return `${墙钟smart(前后[1], 今)} 前后`;
  const 前 = /^(.+) 前$/.exec(s);
  if (前) return `${墙钟smart(前[1], 今)} 前`;
  return 墙钟smart(s, 今);
}
