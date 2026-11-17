/**
 * 企业版新建线索的两格时间（11-17 客户新需求，方案页「企业版-指定时间两字段」）：
 *   - 要求回复时间：客户要求什么时候联系，开始、结束两格，填一个也行，精确到分钟；存在项目上（Project.replyStartAt / replyEndAt）
 *   - 指定分配时间：现在分配 / 指定时间（PR3）
 *
 * 纯函数，界面和服务端共用，不碰 prisma。
 *
 * 待客户方确认：问题 3（时区）。现在按建议答案做：一律按北京时间录入和显示，库里存 UTC 时刻，不存时区字段。
 * 要改成「可选客户时区」，只改这里的 录入时区偏移分 / 北京墙钟转时刻 / 时刻转北京墙钟，并另加一列存时区（已存的时刻不用动）。
 *
 * 待客户方确认：问题 2（时间段一次性还是重复）。现在按建议答案做：只做一次性的具体日期时间段（开始、结束两个时刻）；
 * 「每天上午」这类重复时段写项目备注。要做重复时段时另加列，已存的不动。
 */
import { 空值符 } from "@/lib/empty-value";

/** 待客户方确认：问题 3。录入、显示都按北京时间（UTC+8），不跟浏览器、服务器的时区走 */
export const 录入时区偏移分 = 480;
export const 录入时区叫法 = "北京时间";

/** 墙钟写法：YYYY-MM-DD HH:mm（中间也认 T），秒可带可不带，只认到分钟 */
const 墙钟式 = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/;

/** 「YYYY-MM-DD HH:mm」（北京墙钟）→ 那一刻；格式不对、日子不存在（2 月 30 日）= null */
export function 北京墙钟转时刻(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = 墙钟式.exec(s.trim());
  if (!m) return null;
  const [年, 月, 日, 时, 分] = m.slice(1).map(Number);
  if (月 < 1 || 月 > 12 || 时 > 23 || 分 > 59) return null;
  const 墙 = Date.UTC(年, 月 - 1, 日, 时, 分);
  const d = new Date(墙);
  if (d.getUTCFullYear() !== 年 || d.getUTCMonth() !== 月 - 1 || d.getUTCDate() !== 日) return null;
  return new Date(墙 - 录入时区偏移分 * 60_000);
}

/** 那一刻 → 「YYYY-MM-DD HH:mm」（北京墙钟）；空 = null */
export function 时刻转北京墙钟(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + 录入时区偏移分 * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

/** 显示用的短写：今年的不写年（11-20 15:00），别的年份写全 */
export function 短时刻(d: Date | string | null | undefined, 今 = new Date()): string | null {
  const 墙 = 时刻转北京墙钟(d);
  if (!墙) return null;
  const 今年 = 时刻转北京墙钟(今)!.slice(0, 4);
  return 墙.startsWith(今年) ? 墙.slice(5) : 墙;
}

export type 要求回复 = { replyStartAt: Date | null; replyEndAt: Date | null };
/** 项目上这两列的列名（编辑项目比较改没改、留痕叫法用） */
export const 回复键们 = ["replyStartAt", "replyEndAt"] as const;

/**
 * 交上来的两格规整一遍：都可空（选填）；填了的要认得出；都填时结束不能早于开始。
 * 不拦「早于现在」：补录过去约好的时间也让存（到点提醒只看没过的）
 */
export function 规整要求回复(开始: unknown, 结束: unknown): { ok: true; 值: 要求回复 } | { ok: false; error: string } {
  const 空 = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());
  const 始 = 空(开始) ? null : 北京墙钟转时刻(开始);
  if (!空(开始) && !始) return { ok: false, error: "要求回复时间的开始格式不对，请选日期和时刻" };
  const 终 = 空(结束) ? null : 北京墙钟转时刻(结束);
  if (!空(结束) && !终) return { ok: false, error: "要求回复时间的结束格式不对，请选日期和时刻" };
  if (始 && 终 && 终.getTime() < 始.getTime()) return { ok: false, error: "要求回复时间的结束不能早于开始" };
  return { ok: true, 值: { replyStartAt: 始, replyEndAt: 终 } };
}

/**
 * 列表、资料卡上那一格：都没填「—」；都填「11-20 15:00 – 17:00」（跨天写全）；只填开始「11-20 15:00 前后」；只填结束「11-20 17:00 前」
 */
export function 要求回复文字(始: Date | string | null | undefined, 终: Date | string | null | undefined, 今 = new Date()): string {
  const a = 短时刻(始, 今), b = 短时刻(终, 今);
  if (a && b) {
    const 同天 = 时刻转北京墙钟(始)!.slice(0, 10) === 时刻转北京墙钟(终)!.slice(0, 10);
    return `${a} – ${同天 ? b.slice(-5) : b}`;
  }
  if (a) return `${a} 前后`;
  if (b) return `${b} 前`;
  return 空值符;
}

/**
 * 要求回复的时间（开始，没填用结束）落在这条线索预计回收那天或以后：录入时黄条提示，不拦（方案第五节「计时」：要求回复时间不写进下一步时间、
 * 不改超时回收日、不顺延）。回收日 = YYYY-MM-DD（项目详情的回收日；新建时按下一步时间那天过完估，lib/project/timeout.ts）
 */
export function 回复晚于回收(始: Date | null | undefined, 终: Date | null | undefined, 回收日: string | null | undefined): string | null {
  const 先 = 始 ?? 终;
  if (!先 || !回收日) return null;
  const 日 = 时刻转北京墙钟(先)!.slice(0, 10);
  return 日 >= 回收日 ? `这条会在 ${回收日} 先回收（要求回复时间不顺延回收），记得在那之前跟进一次` : null;
}
