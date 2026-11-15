import { dayjs } from "@/lib/utils";

/**
 * 复盘「沟通」时间线按天切段（前端改版逐块确认 ov.talk）：今天 / 昨天 / 今年别的日子「M-D」/ 往年「YYYY-M-D」。
 * 行已经按时间倒序（服务端排好），这里只按顺序切段、不重排；万一同一天被隔开也不合并，键带上序号保证唯一。
 */
export function 沟通按天<T extends { 时间: string }>(行: T[], 今天 = dayjs()): { 键: string; 叫法: string; 行: T[] }[] {
  const 组: { 键: string; 叫法: string; 行: T[] }[] = [];
  const 今 = 今天.startOf("day");
  for (const r of 行) {
    const d = dayjs(r.时间).startOf("day");
    const 日 = d.format("YYYY-MM-DD");
    const 末 = 组[组.length - 1];
    if (末 && 末.键.endsWith(日)) {
      末.行.push(r);
      continue;
    }
    const 差 = 今.diff(d, "day");
    const 叫法 = 差 === 0 ? "今天" : 差 === 1 ? "昨天" : d.year() === 今.year() ? d.format("M-D") : d.format("YYYY-M-D");
    组.push({ 键: `${组.length}:${日}`, 叫法, 行: [r] });
  }
  return 组;
}
