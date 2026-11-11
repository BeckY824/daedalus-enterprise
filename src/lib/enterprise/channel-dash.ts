/**
 * 渠道页的总览看板（11-03）：摆在筛选栏和渠道列表之间，和列表用同一套筛选结果（属性 / 负责人 / 状态 / 关键词）——
 * 列表剩几个渠道，看板就按这几个渠道算。取数在 channel-dash-db.ts，这里只管算。
 *
 * 周期（本月 / 本季 / 全部）：不另建流水表，用现有的时间；边界按北京时间（UTC+8，没有夏令时）的当月 / 当季第一天零点，不看进程时区。
 * - 线索：项目创建时间。「总线索」= 这段时间新建的项目，全部周期 = 列表的「关联项目」。
 * - 商机：节点日志里头一回到「商机」（或直接到「订单」，跳过的也算经过了商机）那条的时间；导入时直接落在商机的，就是建项目那条。
 * - 订单：头一回进「订单」那条的时间。
 * - 成交额：算不算成交照列表（channel-stats.ts 的 算成交：订单阶段、不是异常状态），时间取进订单的时间。
 * - 后来退回去的项目，到过就算到过（同列表转化率 算转化 的「到过」）；没有节点日志的老数据按创建时间和眼下的阶段算。
 * - 投入：投入那笔的日期。
 *
 * MQL 有效率 = 有效线索 ÷ 已判定的线索（EntLeadVerify 的判定）。已判定只数「有效线索」「无效线索」两种落定的：
 * 「初验无效」还在等复核、可能翻回有效，「暂未判定」没判。一条都没判过 → null（界面「—」）。
 *
 * 线索→商机（11-03 用户定 A：和列表 算转化 一个口径）：只看从「线索」起步的项目（起步阶段取建项目那条节点日志，
 * 没有就当线索）——导入时直接落在商机 / 订单的没走过这一步，分子分母都不算，所以导入为主的渠道前期会是 0% 或偏低。
 * 分子 = 其中这段时间头一回到商机的；分母：已判定的不到同期总线索的一半（判够占比）时用这段时间新建的、从线索起步的，
 * 卡片上写明；判够了改按定义用其中的有效线索。判得少时有效线索远少于实际，拿它作分母会算出远超 100% 的数。
 * 全部周期的分子分母 = 列表的线索→商机。
 *
 * 低效渠道预警：同期线索 ≥ 30，并且下面三条占一条——转商机率不到全员的一半、有效率不到全员的一半、转商机是 0%。
 * 「全员」= 看板这批渠道合起来的比例（不是各渠道比例的平均）；渠道的转商机率和全员用同一个分母口径。最多 3 个，线索多的在前。
 */
import type { 币种合计 } from "../currency";
import { beijingDay } from "../business-clock";
import { 合计, 算产出比, 算成交 } from "./channel-stats";

export const 周期们 = ["本月", "本季", "全部"] as const;
export type 周期 = (typeof 周期们)[number];
/**
 * 档位（11-04 P-界面-10）：三个预设之后多一个「自定义」。地址栏 view=自定义&from=&to=，读法、北京日界线、两头都含
 * 用数据页那一份公共件（lib/custom-date-range.ts 读日期段 / 日期段界），这里只收算好的两个瞬间
 */
export const 自定义 = "自定义";
export type 档 = 周期 | typeof 自定义;

/** 已判定占同期总线索到这个比例，线索→商机才改用有效线索作分母 */
export const 判够占比 = 0.5;
/** 低效预警：同期线索至少这么多才看 */
export const 预警线索下限 = 30;
export const 预警最多 = 3;
/** 环形图最多几段（多出来的并成「其他」） */
export const 环最多 = 5;
export const 榜最多 = 5;

const 北京 = 480 * 60_000;

/** 周期从哪一刻起（北京时间当月 / 当季第一天零点）；全部 = null 不限 */
export function 周期起点(周期: 周期, 今: Date): Date | null {
  if (周期 === "全部") return null;
  const 墙 = new Date(今.getTime() + 北京);
  const 月 = 周期 === "本月" ? 墙.getUTCMonth() : Math.floor(墙.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(墙.getUTCFullYear(), 月, 1) - 北京);
}

/** 自定义那一段的真实瞬间：日期段界() 给的 开始日 00:00 到 结束日 23:59:59.999，两头都含 */
export type 看板区间 = { from: Date; to: Date };

export type 看板项目 = {
  /** 已按 项目算哪个渠道() 归好 */
  channelId: string | null;
  phase: string;
  result: string | null;
  amount: number;
  currency: string;
  createdAt: Date;
  /** EntLeadVerify.verdict；没有那一行 = null（当没判） */
  判定: string | null;
  /** 起步阶段：建项目那条节点日志（fromPhase 空）的 toPhase；没有 = 线索（同列表） */
  起步?: string;
  /** 节点日志（kind = node）的到哪、何时，顺序不要紧 */
  节点们: { toPhase: string; at: Date }[];
  /**
   * 看的人点进去在哪看得到（11-11）：项目列表 / 公海页（公海名单条件）/ 两边都不列（null，只能数到）。
   * 读库带了「是谁在看」才有；没有就不拆
   */
  名单?: "列表" | "公海" | null;
};
export type 看板投入 = { channelId: string; amount: number; currency: string; date: Date };

/** 一个渠道一段时间的底数；起线索 / 起有效 / 起转商机 只数从线索起步的，给线索→商机用 */
export type 渠道期数 = {
  线索: number; 已判定: number; 有效: number; 商机: number; 订单: number; 成交: 币种合计[]; 投入: 币种合计[];
  起线索: number; 起有效: number; 起转商机: number;
  /** 项目带了 名单 才有：线索（同期新建）里项目列表 / 公海页各几条；商机、订单里在公海页的几条（只写字，不链） */
  名单?: 期名单;
};
export type 期名单 = { 列表: number; 公海: number; 商机公海: number; 订单公海: number };
/** 自定义 只在网址带了区间时有 */
export type 看板底数 = Record<周期, Record<string, 渠道期数>> & { 自定义?: Record<string, 渠道期数> };

const 空期: 渠道期数 = { 线索: 0, 已判定: 0, 有效: 0, 商机: 0, 订单: 0, 成交: [], 投入: [], 起线索: 0, 起有效: 0, 起转商机: 0 };

const 早 = (ts: Date[]) => (ts.length ? new Date(Math.min(...ts.map((t) => t.getTime()))) : null);

/** 头一回到商机（或直接到订单）的时间；没到过 = null */
export function 商机时间(p: 看板项目): Date | null {
  const t = 早(p.节点们.filter((l) => l.toPhase === "商机" || l.toPhase === "订单").map((l) => l.at));
  return t ?? (p.phase === "商机" || p.phase === "订单" ? p.createdAt : null);
}

/** 头一回进订单的时间；没进过 = null */
export function 订单时间(p: 看板项目): Date | null {
  return 早(p.节点们.filter((l) => l.toPhase === "订单").map((l) => l.at)) ?? (p.phase === "订单" ? p.createdAt : null);
}

/** 落定了的判定才算「已判定」 */
export function 已判定(判定: string | null): boolean {
  return 判定 === "有效线索" || 判定 === "无效线索";
}

/** 几份按币种的合计再加起来（同列表的累计成交、当前投入一个算法） */
const 合 = (份: 币种合计[][]) => 合计(份.flat().map((x) => ({ amount: x.合计, currency: x.币种 })));

/** 各档的 [起, 止]（两头都含）：预设档没有上限；自定义 = 地址栏那一段 */
export function 看板各档(今: Date, 区间?: 看板区间 | null): [档, number, number][] {
  const 预设 = 周期们.map((期): [档, number, number] => [期, 周期起点(期, 今)?.getTime() ?? -Infinity, Infinity]);
  return 区间 ? [...预设, [自定义, 区间.from.getTime(), 区间.to.getTime()]] : 预设;
}

/** 每个渠道 × 每个周期的底数，一次算好交给界面；界面按筛选结果再合。带了区间多算一份 自定义 */
export function 算看板底数(渠道ids: string[], 项目们: 看板项目[], 投入们: 看板投入[], 今: Date = new Date(), 区间?: 看板区间 | null): 看板底数 {
  const out = {} as 看板底数;
  const 带名单 = 项目们.some((p) => p.名单 !== undefined);
  for (const [期, 起, 止] of 看板各档(今, 区间)) {
    const 在 = (t: Date | null) => t !== null && t.getTime() >= 起 && t.getTime() <= 止;
    const 表: Record<string, 渠道期数> = {};
    const 成交行 = new Map<string, 看板项目[]>();
    for (const id of 渠道ids) 表[id] = { ...空期, ...(带名单 ? { 名单: { 列表: 0, 公海: 0, 商机公海: 0, 订单公海: 0 } } : {}) };
    for (const p of 项目们) {
      const 格 = p.channelId ? 表[p.channelId] : undefined;
      if (!格) continue;
      const 线索起步 = (p.起步 ?? "线索") === "线索";
      if (在(p.createdAt)) {
        格.线索++;
        if (格.名单 && p.名单) 格.名单[p.名单]++;
        if (已判定(p.判定)) 格.已判定++;
        if (p.判定 === "有效线索") 格.有效++;
        if (线索起步) {
          格.起线索++;
          if (p.判定 === "有效线索") 格.起有效++;
        }
      }
      if (在(商机时间(p))) {
        格.商机++;
        if (格.名单 && p.名单 === "公海") 格.名单.商机公海++;
        if (线索起步) 格.起转商机++;
      }
      const 进订单 = 订单时间(p);
      if (在(进订单)) {
        格.订单++;
        if (格.名单 && p.名单 === "公海") 格.名单.订单公海++;
        if (算成交(p)) 成交行.set(p.channelId!, [...(成交行.get(p.channelId!) ?? []), p]);
      }
    }
    for (const [id, 行] of 成交行) 表[id].成交 = 合计(行);
    const 投入按渠道 = new Map<string, 看板投入[]>();
    for (const x of 投入们) if (表[x.channelId] && 在(x.date)) 投入按渠道.set(x.channelId, [...(投入按渠道.get(x.channelId) ?? []), x]);
    for (const [id, 行] of 投入按渠道) 表[id].投入 = 合计(行);
    out[期] = 表;
  }
  return out;
}

export type 渠道筛选 = { kw: string; attr: string; ownerId: string; active: string; creator?: string };
type 可筛 = { name: string; platform: string | null; attr: string | null; remark: string | null; channelOwnerId: string; active: boolean; createdByName?: string | null };

/** 渠道列表的筛选（列表和看板都用它，所以两边一定是同一批渠道）：关键词搜全称、名称、属性、备注；属性、负责人精确；状态 on / off */
export function 筛渠道<T extends 可筛>(行: T[], f: 渠道筛选): T[] {
  const k = f.kw.trim().toLowerCase();
  return 行.filter(
    (r) =>
      (!k || [r.name, r.platform, r.attr, r.remark].some((x) => (x ?? "").toLowerCase().includes(k))) &&
      (!f.attr || r.attr === f.attr) &&
      (!f.ownerId || r.channelOwnerId === f.ownerId) &&
      (!f.creator || r.createdByName === f.creator) &&
      (!f.active || (f.active === "on") === r.active),
  );
}

export type 看板渠道 = { id: string; name: string; attr: string | null; channelOwnerName: string; 投入数?: number };
export type 环形 = { 按: "属性" | "负责人"; 段: { 名: string; 数: number }[] };
export type 预警项 = { 指标: string; 值: string };
export type 预警 = { id: string; name: string; 线索: number; 项: 预警项[] };
export type 看板 = {
  渠道数: number;
  线索: number;
  已判定: number;
  有效: number;
  商机: number;
  订单: number;
  成交: 币种合计[];
  投入: 币种合计[];
  /** 有效 ÷ 已判定；一条没判 = null */
  有效率: number | null;
  /** 线索→商机，分母见文件头 */
  转商机: { 比例: number | null; 分母: "总线索" | "有效线索" };
  /** 订单 ÷ 商机 */
  转订单: number | null;
  产出比: number | null;
  产出比说明: string | null;
  /** null = 这一格收起 */
  环: 环形 | null;
  预警: 预警[];
  /** 名单：这一行的线索点进去，项目列表里几条、公海页几条（带了名单才有） */
  榜: { id: string; name: string; 线索: number; 名单?: { 列表: number; 公海: number } }[];
  /** 这批渠道合起来、在公海页的几条（总线索 / 商机 / 订单卡上「其中 M 条在公海」）；没带名单 = undefined */
  公海?: { 线索: number; 商机: number; 订单: number };
  /** 这批渠道里一笔投入都没录过的个数（不分周期），和第一个的 id */
  未录投入: number;
  首个未录: string | null;
};

const 比 = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * 环形图摆什么：筛了负责人 → 收起；这批渠道有两种以上属性 → 按属性；只剩一种属性（属性单选）→ 同一格换成按负责人
 * （只有一个负责人也照样摆一整圈，格子不跳）。段 = 各自的同期线索，多的在前，超过 环最多 的并成「其他」
 */
export function 环形of(渠道们: 看板渠道[], 底: Record<string, 渠道期数>, 筛了负责人: boolean): 环形 | null {
  if (筛了负责人) return null;
  const 按: 环形["按"] = new Set(渠道们.map((c) => c.attr || "未填属性")).size >= 2 ? "属性" : "负责人";
  const m = new Map<string, number>();
  for (const c of 渠道们) {
    const 名 = 按 === "属性" ? c.attr || "未填属性" : c.channelOwnerName;
    m.set(名, (m.get(名) ?? 0) + (底[c.id]?.线索 ?? 0));
  }
  const 段 = [...m.entries()].filter(([, 数]) => 数 > 0).map(([名, 数]) => ({ 名, 数 })).sort((a, b) => b.数 - a.数);
  if (段.length <= 环最多) return { 按, 段 };
  const 其他 = 段.slice(环最多 - 1).reduce((s, x) => s + x.数, 0);
  return { 按, 段: [...段.slice(0, 环最多 - 1), { 名: "其他", 数: 其他 }] };
}

/** 判够了没有：已判定占同期总线索到 判够占比 */
export function 判够(已判定数: number, 线索: number): boolean {
  return 已判定数 > 0 && 已判定数 >= 线索 * 判够占比;
}

/** 低效渠道预警，规则见文件头 */
export function 低效预警(渠道们: 看板渠道[], 底: Record<string, 渠道期数>, 全员: { 有效率: number | null; 转商机: number | null }, 分母: "总线索" | "有效线索"): 预警[] {
  const out: 预警[] = [];
  for (const c of 渠道们) {
    const d = 底[c.id] ?? 空期;
    if (d.线索 < 预警线索下限) continue;
    const 有效率 = 比(d.有效, d.已判定);
    const 转 = 比(d.起转商机, 分母 === "有效线索" ? d.起有效 : d.起线索);
    const 零 = 转 === 0;
    const 转低 = 零 || (全员.转商机 !== null && 转 !== null && 转 < 全员.转商机 / 2);
    const 效低 = 全员.有效率 !== null && 有效率 !== null && 有效率 < 全员.有效率 / 2;
    const 项: 预警项[] = 零
      ? [{ 指标: "转化", 值: "0%" }, ...(效低 ? [{ 指标: "有效率", 值: "低" }] : [])]
      : 转低 && 效低 ? [{ 指标: "有效率/转化", 值: "双低" }]
      : 转低 ? [{ 指标: "转化", 值: "低" }]
      : 效低 ? [{ 指标: "有效率", 值: "低" }]
      : [];
    if (项.length) out.push({ id: c.id, name: c.name, 线索: d.线索, 项 });
  }
  return out.sort((a, b) => b.线索 - a.线索).slice(0, 预警最多);
}

/** 看板这一屏的数：渠道们 = 列表筛出来的那批（同顺序），底 = 选中周期那一份 */
export function 算看板(渠道们: 看板渠道[], 底: Record<string, 渠道期数>, 筛了负责人: boolean): 看板 {
  const 期 = 渠道们.map((c) => 底[c.id] ?? 空期);
  const 加 = (k: "线索" | "已判定" | "有效" | "商机" | "订单" | "起线索" | "起有效" | "起转商机") => 期.reduce((s, d) => s + d[k], 0);
  const 线索 = 加("线索"), 已判定数 = 加("已判定"), 有效 = 加("有效"), 商机 = 加("商机"), 订单 = 加("订单");
  const 成交 = 合(期.map((d) => d.成交));
  const 投入 = 合(期.map((d) => d.投入));
  const 有效率 = 比(有效, 已判定数);
  const 分母 = 判够(已判定数, 线索) ? "有效线索" : "总线索";
  const 转商机 = 比(加("起转商机"), 加(分母 === "有效线索" ? "起有效" : "起线索"));
  const 未录 = 渠道们.filter((c) => !c.投入数);
  const 带名单 = 期.some((d) => d.名单);
  const 名加 = (k: keyof 期名单) => 期.reduce((s, d) => s + (d.名单?.[k] ?? 0), 0);
  return {
    渠道数: 渠道们.length,
    线索, 已判定: 已判定数, 有效, 商机, 订单, 成交, 投入,
    有效率,
    转商机: { 比例: 转商机, 分母 },
    转订单: 比(订单, 商机),
    ...算产出比(成交, 投入),
    环: 环形of(渠道们, 底, 筛了负责人),
    预警: 低效预警(渠道们, 底, { 有效率, 转商机 }, 分母),
    榜: 渠道们
      .map((c) => {
        const 名 = 底[c.id]?.名单;
        return { id: c.id, name: c.name, 线索: 底[c.id]?.线索 ?? 0, ...(名 ? { 名单: { 列表: 名.列表, 公海: 名.公海 } } : {}) };
      })
      .filter((x) => x.线索 > 0)
      .sort((a, b) => b.线索 - a.线索)
      .slice(0, 榜最多),
    未录投入: 未录.length,
    首个未录: 未录[0]?.id ?? null,
    ...(带名单 ? { 公海: { 线索: 名加("公海"), 商机: 名加("商机公海"), 订单: 名加("订单公海") } } : {}),
  };
}

/**
 * TOP5 一行点进去（11-11）：这个渠道 + 同一段创建时间。线索 = 这段时间新建的项目、不分阶段，所以不带阶段。
 * 时间段写成北京日 createdFrom / createdTo（项目列表、公海页同名同读法，custom-date-range.ts 创建时间段）：
 * 本月 / 本季 = 从第一天起、不写止（看板这两档也没有上限，写成「今天」的话页面开过零点就差几条），自定义 = 那一段，全部 = 不带
 */
export type 时段参数 = { createdFrom: string; createdTo?: string };
export function 看板时段(期: 档, 今: Date, 段?: { from: string; to: string } | null): 时段参数 | null {
  if (期 === 自定义) return 段 ? { createdFrom: 段.from, createdTo: 段.to } : null;
  const 起 = 周期起点(期, 今);
  return 起 ? { createdFrom: beijingDay(起) } : null;
}

/** TOP5 的两个去处：项目列表（channelId）/ 公海页渠道名单（projChannel），都带同一段创建时间 */
export function 榜链接(channelId: string, 时段: 时段参数 | null, 去: "列表" | "公海"): string {
  const q = new URLSearchParams(去 === "列表" ? { channelId } : { projChannel: channelId });
  if (时段?.createdFrom) q.set("createdFrom", 时段.createdFrom);
  if (时段?.createdTo) q.set("createdTo", 时段.createdTo);
  return `${去 === "列表" ? "/projects" : "/pool"}?${q}`;
}

/*
 * 进公海（11-04 P-界面-09，只给市场成员 / 市场管理）：每个渠道多一段，读完就懂、不用点进任何一条。
 * - 数什么：项目（= 线索）的进公海留痕（pool-release），一条项目一个档里只算一次，方式和原因认这一档里最近那条。
 *   只数现在还在公海的（客户 11-05（X-10）：被领走、分走、捞回去的不再算）；
 *   导入时没负责人直接落进公海的不算（不是「进」的，是导进来就在）。
 * - 另两种不进公海、也数在这一段里（客户 11-05（X-10）），同样一条项目只算一次：
 *   回收站 = 现在还在回收站里的项目（删的那一刻落档）；验证判无效 = 线索验证最终判了无效、现在还是线索流失的
 *   （终判那一刻落档，没走到终判那段的按复核 / 初判时间）。判无效（还在公海、客户被标无效）和验证判无效分两格，各列各的原因。
 * - 归谁：项目的创建人。市场成员数自己创建的，市场管理数本人 + 实线下属创建的，可按创建人筛（界面上筛，底数按人分好）。
 * - 时间：进公海那一刻落在档里（同看板别的事件按事件时间）；占比 = 进公海条数 ÷ 同档同一批创建人在这个渠道新建的线索，
 *   两边各按各的时间，所以早建晚进的能让占比过 100%，照实写。
 * - 方式：离职交接（成员停用带进来的）/ 超时回收（系统收的）/ 判无效（还在公海、客户被标了无效的，认最近一回进公海）/
 *   其余都是被退回（退回原因 = 留痕里的「回收原因：X」）。判无效、验证判无效的原因取线索验证里写的无效原因，没写不列。
 * - 一条项目同一档里落了好几种（进过公海又删了），认时间最近的那种。
 */
export const 入池方式们 = ["超时回收", "被退回", "回收站", "判无效", "验证判无效", "离职交接"] as const;
export type 入池方式 = (typeof 入池方式们)[number];
/** 原因列几个 */
export const 原因最多 = 3;

export type 看板入池 = { projectId: string; channelId: string | null; creatorId: string; at: Date; 方式: 入池方式; 原因: string | null };
export type 看板线索 = { channelId: string | null; creatorId: string; createdAt: Date };
export type 公海格 = {
  线索: number; 进: number; 方式: Record<入池方式, number>;
  退回因: Record<string, number>; 无效因: Record<string, number>;
  /** 验证判无效的原因（客户 11-05（X-10）：和判无效的分开列） */
  验证无效因: Record<string, number>;
};
/** 档 → 渠道 → 创建人 → 格 */
export type 公海底数 = Partial<Record<档, Record<string, Record<string, 公海格>>>>;

const 空公海格 = (): 公海格 => ({
  线索: 0, 进: 0, 方式: { 超时回收: 0, 被退回: 0, 回收站: 0, 判无效: 0, 验证判无效: 0, 离职交接: 0 }, 退回因: {}, 无效因: {}, 验证无效因: {},
});
/** 哪几种方式列原因、列在哪一格 */
const 因格: Partial<Record<入池方式, "退回因" | "无效因" | "验证无效因">> = { 被退回: "退回因", 判无效: "无效因", 验证判无效: "验证无效因" };

export function 算公海底数(渠道ids: string[], 入池们: 看板入池[], 线索们: 看板线索[], 今: Date = new Date(), 区间?: 看板区间 | null): 公海底数 {
  const 有 = new Set(渠道ids);
  const out: 公海底数 = {};
  for (const [期, 起, 止] of 看板各档(今, 区间)) {
    const 在 = (t: Date) => t.getTime() >= 起 && t.getTime() <= 止;
    const 表: Record<string, Record<string, 公海格>> = {};
    const 格of = (ch: string, who: string) => ((表[ch] ??= {})[who] ??= 空公海格());
    for (const l of 线索们) if (l.channelId && 有.has(l.channelId) && 在(l.createdAt)) 格of(l.channelId, l.creatorId).线索++;
    const 最近 = new Map<string, 看板入池>();
    for (const x of 入池们) {
      if (!x.channelId || !有.has(x.channelId) || !在(x.at)) continue;
      const 旧 = 最近.get(x.projectId);
      if (!旧 || x.at.getTime() > 旧.at.getTime()) 最近.set(x.projectId, x);
    }
    for (const x of 最近.values()) {
      const g = 格of(x.channelId!, x.creatorId);
      g.进++;
      g.方式[x.方式]++;
      const 格 = 因格[x.方式];
      if (格 && x.原因) g[格][x.原因] = (g[格][x.原因] ?? 0) + 1;
    }
    out[期] = 表;
  }
  return out;
}

/** 交给界面的那一包：底数 + 谁在看（市场管理多一个创建人筛选，创建人们 = 本人 + 实线下属） */
export type 看板公海 = { 底: 公海底数; 视角: "市场成员" | "市场管理"; 创建人们: { id: string; name: string }[] };

export type 进公海段 = { 方式: 入池方式; 数: number; 因: { 名: string; 数: number }[] };
export type 进公海行 = { id: string; name: string; 进: number; 线索: number; 占: number | null; 段: 进公海段[] };

const 前几 = (m: Record<string, number>) =>
  Object.entries(m).map(([名, 数]) => ({ 名, 数 })).sort((a, b) => b.数 - a.数 || a.名.localeCompare(b.名, "zh")).slice(0, 原因最多);

/** 看板上的进公海那一段：渠道们 = 列表筛出来的那批；创建人 = 市场管理筛的那位（空 = 圈里全部）。只列进过公海的，多的在前 */
export function 算进公海(渠道们: { id: string; name: string }[], 底: Record<string, Record<string, 公海格>> | undefined, 创建人 = ""): 进公海行[] {
  const out: 进公海行[] = [];
  for (const c of 渠道们) {
    const 合 = 空公海格();
    for (const [who, g] of Object.entries(底?.[c.id] ?? {})) {
      if (创建人 && who !== 创建人) continue;
      合.线索 += g.线索;
      合.进 += g.进;
      for (const k of 入池方式们) 合.方式[k] += g.方式[k] ?? 0;
      for (const 格 of ["退回因", "无效因", "验证无效因"] as const) {
        for (const [n, v] of Object.entries(g[格] ?? {})) 合[格][n] = (合[格][n] ?? 0) + v;
      }
    }
    if (!合.进) continue;
    out.push({
      id: c.id, name: c.name, 进: 合.进, 线索: 合.线索, 占: 比(合.进, 合.线索),
      段: 入池方式们.filter((k) => 合.方式[k] > 0).map((k) => ({
        方式: k, 数: 合.方式[k], 因: 因格[k] ? 前几(合[因格[k]!]) : [],
      })),
    });
  }
  return out.sort((a, b) => b.进 - a.进);
}

/** 一行的明细文字：「超时回收 3；被退回 8：预算不足 5 · 联系不上 3；回收站 1；判无效 1；验证判无效 2：空号 2；离职交接 2」 */
export function 进公海明细(r: Pick<进公海行, "段">): string {
  return r.段.map((d) => `${d.方式} ${d.数}${d.因.length ? `：${d.因.map((x) => `${x.名} ${x.数}`).join(" · ")}` : ""}`).join("；");
}
