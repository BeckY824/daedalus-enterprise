/**
 * 企业版超时回收 · 夜里定时扫（Q-13，2026-10-25）：每天 00:05 扫一次，夜里没人打开页面也照收。
 *
 * 收法和打开项目列表 / 首页时那次是同一个函数（db.ts 公海超时收回）：同一套规则、同一个「今天按这份规则扫过了」的记号，
 * 所以夜里扫过，白天打开页面不再收；同一天跑几遍也只收一次。
 *
 *   - 只在企业版起钟（instrumentation.ts）；项目模式关着不扫
 *   - 每分钟看一眼钟，过了今天 00:05 才扫（服务器停着错过了，开机就补）
 *   - 操作人一律是「系统」（timeout.ts 系统，QA #16）：夜扫不靠哪个账号，权限只认业务角色后找账号老板找不到人也照样扫（11-02）
 *   - 同一个钟顺带清回收站（P9）：删了满 30 天的真删掉，每天一遍，不看项目模式（lib/enterprise/soft-delete.ts 每天清一次）
 *   - 同一个钟顺带发到期提醒（lib/enterprise/due-notice.ts）：北京 09:00 起，跟进计划、项目下一步今天到期的和昨天逾期的
 *   - 同一个钟顺带作废挂满 7 天没人处理的申请移交（lib/enterprise/handover-expire.ts，11-10 新口径）：作废、通知申请人一次，归属不变
 *   - 客户三态（M-公海-16 起，lib/enterprise/tri-state-db.ts）：00:05 那一遍按客户算状态、写钟和留痕，待回收期满的自动进客户公海；
 *     组织规则里三态关着这一段完全不跑。三态开着时项目超时回收不再跑（db.ts 按规则收回 直接返回）
 *
 * 服务停过怎么补（10c，2026-11-10）：这些活都挂在本进程的钟上，服务停着就不跑。
 *   - 起钟时马上跑一遍（不等第一分钟），各自的时点照旧（00:05 / 09:00 没到的那几样等到点）
 *   - 超时回收、回收站清理本来就按「现在该处理谁」判，开机那遍自然补上；回收照现行规则判，豁免不绕
 *   - 到期 / 逾期提醒原来只看今天、昨天，停一整天就漏：现在按 Setting 里的水位从上次扫到的那天补到昨天，最多 7 天（due-notice.ts）
 *   - 停着的那天本该发的「回收前一天」提醒没发出去、回收日已到的（11-10 新口径）：这一遍不收，先补发那条提醒（说明服务停过、提醒晚了、明天收），
 *     宽限一天，次日那遍照常收；只宽限一次（db.ts 按规则收回）
 *   - 起钟那遍写一条日志（各类各几条；申请移交、挂靠审批那两段照原样跑，不进这条日志）；之后哪一遍又补到了停机漏的，再写一条
 */
import { getBusiness } from "../business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 公海超时收回明细, type 超时收回明细 } from "./db";
import { 系统 } from "./timeout";
import { 每天清一次 } from "@/lib/enterprise/soft-delete";
import { 钟上到期提醒明细, type 到期提醒明细 } from "@/lib/enterprise/due-notice";
import { 挂起移交作废 } from "@/lib/enterprise/handover-expire";
import { 挂靠超时转上级 } from "@/lib/enterprise/attach-approval";
import { 三态夜扫, type 三态夜扫明细 } from "@/lib/enterprise/tri-state-db";
import { dayjs } from "../utils";

export const 夜扫时刻 = { 时: 0, 分: 5 } as const;

/** 今天过了 00:05 没（服务器时间） */
export function 过了夜扫时刻(现在: Date): boolean {
  return !dayjs(现在).isBefore(dayjs(现在).startOf("day").hour(夜扫时刻.时).minute(夜扫时刻.分));
}

/** 扫一遍：到点了、企业版、项目模式开着才真收。返回收回了几个 */
export async function 夜里扫超时(现在: Date = new Date()): Promise<number> {
  return (await 夜里扫超时明细(现在))?.收回 ?? 0;
}

/** 同上，带明细；没到点 / 没开 = null */
async function 夜里扫超时明细(现在: Date): Promise<超时收回明细 | null> {
  if (!企业版() || !过了夜扫时刻(现在)) return null;
  if ((await getBusiness()).projectMode !== true) return null;
  return 公海超时收回明细(系统, 现在);
}

/** 钟上一遍各样活各做了多少（出错的那样是 null，下一遍再试）。申请移交、挂靠审批那两段不在这里记数 */
export type 一遍明细 = { 超时: 超时收回明细 | null; 回收站: number | null; 到期: 到期提醒明细 | null; 三态?: 三态夜扫明细 | null };

/** 三态那一段：到了 00:05 才跑；三态没开 / 不是企业版 = null */
export async function 夜里扫三态(现在: Date): Promise<三态夜扫明细 | null> {
  if (!企业版() || !过了夜扫时刻(现在)) return null;
  return 三态夜扫(现在);
}

/** 这一遍补到了停机漏的没有：超时扫隔了整天、或逾期提醒从更早的日子补起 */
export function 补了停机的(r: 一遍明细): boolean {
  return (r.超时?.漏扫天数 ?? 0) > 0 || !!r.到期?.补自;
}

/** 补跑日志那一行：补了哪几类、各几条 */
export function 补跑日志行(r: 一遍明细, 启动: boolean): string {
  const 数 = (n: number | null | undefined, 单位: string) => (n == null ? "没跑成" : `${n} ${单位}`);
  const 超时 = r.超时;
  const 停了 = 超时?.漏扫天数 ? `上次扫超时 ${超时.上次扫}，中间 ${超时.漏扫天数} 天没扫；` : 超时?.上次扫 ? `上次扫超时 ${超时.上次扫}；` : "";
  const 到期 = r.到期;
  return (
    `[定时补跑] ${启动 ? "服务启动补跑一遍" : "补到了停机漏的"}：${停了}` +
    `超时回收 ${数(超时?.收回, "个")}${超时?.补提醒 ? `（另有 ${超时.补提醒} 个停机漏了前一天提醒，已补发、宽限一天）` : ""}、` +
    `将回收提醒 ${数(超时?.将回收提醒, "条")}、` +
    `到期提醒 ${数(到期?.到期, "条")}、逾期提醒 ${数(到期 ? 到期.逾期 + 到期.补逾期 : null, "条")}${到期?.补自 ? `（从 ${到期.补自} 补起，补了 ${到期.补逾期} 条）` : ""}、` +
    `回收站清理 ${数(r.回收站, "条")}` +
    (r.三态 ? `、客户三态算了 ${r.三态.算了} 位（换状态 ${r.三态.换状态}、自动进公海 ${r.三态.进公海.length}）` : "")
  );
}

const g = globalThis as unknown as { __entNightlyTimer?: ReturnType<typeof setInterval>; __entNightlyRun?: Promise<void> };

/** 钟上正在跑的那一遍（测试等它跑完；上一遍没完不叠） */
export function 夜扫在跑(): Promise<void> | undefined {
  return g.__entNightlyRun;
}

/**
 * 起钟（instrumentation.ts 调；开发时热更新重复调只起一个）。起钟时马上跑一遍，把服务停着时漏的补上，之后每分钟一遍。
 * 先等 = 启动时那几件只做一次的老数据活：SQLite 只有一个写锁，起钟那遍等它们做完再跑，别抢锁；最多等一个间隔（原来第一遍也是这时候来）
 */
export function 启动夜扫(间隔毫秒 = 60_000, 先等?: Promise<unknown>): void {
  if (!企业版() || g.__entNightlyTimer) return;
  /** 一遍：几样活各管各的，一样出错不拦别的。启动 = 起钟那一遍（一定写日志） */
  const 跑一遍 = (启动: boolean) => {
    const 现在 = new Date();
    const r: 一遍明细 = { 超时: null, 回收站: null, 到期: null };
    return 夜里扫超时明细(现在)
      .then((x) => { r.超时 = x ?? { 收回: 0, 将回收提醒: 0, 上次扫: null, 漏扫天数: 0, 补提醒: 0 }; })
      .then(() => undefined, (e) => console.error("[超时回收] 夜里扫的时候出错，下一分钟再试", e))
      // 客户三态：和超时回收各管各的（三态开着时超时回收本身不跑）
      .then(() => 夜里扫三态(现在))
      .then((x) => { r.三态 = x; })
      .then(() => undefined, (e) => console.error("[客户三态] 夜里扫的时候出错，下一分钟再试", e))
      // 回收站到期清理：和超时回收各管各的，一边出错不拦另一边
      .then(() => (过了夜扫时刻(现在) ? 每天清一次(现在) : null))
      .then((清) => { r.回收站 = 清 ? Object.values(清).reduce((a, b) => a + b, 0) : 0; })
      .then(() => undefined, (e) => console.error("[回收站] 到期清理出错，下一分钟再试", e))
      // 到期提醒：同样各管各的（自己不抛，这里再兜一道）
      .then(() => 钟上到期提醒明细(现在))
      .then((x) => { r.到期 = x; })
      .then(() => undefined, (e) => console.error("[到期提醒] 出错，下一遍再试", e))
      .then(() => 挂起移交作废(现在))
      .then(() => undefined, (e) => console.error("[移交作废] 出错，下一遍再试", e))
      // 挂靠申请 24 小时没人处理往上转一级，到总管理为止（P-挂靠-02）：自己不抛，这里再兜一道
      .then(() => 挂靠超时转上级(现在))
      .then(() => undefined, (e) => console.error("[挂靠审批] 出错，下一遍再试", e))
      .then(() => { if (启动 || 补了停机的(r)) console.log(补跑日志行(r, 启动)); });
  };
  const 等 = 先等 ? Promise.race([先等.catch(() => null), new Promise((r) => setTimeout(r, 间隔毫秒).unref?.())]) : null;
  const 来一遍 = (启动: boolean) => {
    if (g.__entNightlyRun) return;
    g.__entNightlyRun = (启动 && 等 ? 等 : Promise.resolve())
      .then(() => 跑一遍(启动))
      .catch((e) => console.error("[定时补跑] 这一遍出错，下一分钟再试", e))
      .finally(() => { g.__entNightlyRun = undefined; });
  };
  g.__entNightlyTimer = setInterval(() => 来一遍(false), 间隔毫秒);
  g.__entNightlyTimer.unref?.();
  来一遍(true);
}

/** 停钟（测试用） */
export function 停夜扫(): void {
  if (g.__entNightlyTimer) clearInterval(g.__entNightlyTimer);
  g.__entNightlyTimer = undefined;
}
