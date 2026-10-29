/**
 * 企业版渠道统计（2026-10-29）：渠道列表那一排数全在这一个函数里算，口径改了只改这里。
 *
 * 纯数据和纯函数，客户端组件也 import（类型、开关、全称拼法）；读库的在 channel-stats-db.ts。
 *
 * 现在的口径：
 * - 项目归哪个渠道：看**项目来源**（Project.channelId，迁移 077）；老项目没填项目来源的，退回去看客户来源
 *   （Customer.channelId）。规矩写在 项目算哪个渠道() 里，读库的 channel-stats-db.ts 照它取数。
 * - 关联线索：这个渠道的项目里，眼下还在「线索」阶段的；有效线索 = 关联线索里 是有效线索() 的。
 *   现在没有标无效的字段，是有效线索() 一律算有效——等有了「判无效」记号，只改那一个函数。
 * - 关联商机 / 关联订单：眼下在「商机」/「订单」阶段的；关联项目：全部阶段。
 * - 累计成交：「订单」阶段、结果不是「异常状态」的项目金额，按币种合计、不换汇。
 * - 当前投入：渠道投入按币种合计。
 * - 总投入产出比 = 累计成交 ÷ 投入。投入和成交都只有同一种币种（成交可以是 0）才算；混了币种、或还没录投入，给 null 和一句为什么。
 * - 累计运营天数：创建日期（当地日历天）到结束日期，没填结束日期就到今天；不算头尾两天里的那一天（同一天 = 0 天）。
 */

/**
 * 项目算哪个渠道的（2026-10-29 定稿：客户来源记第一次的渠道、不再改，每个项目各记各的）：
 * - 项目自己填了来源（Project.channelId）→ 就算这个渠道，哪怕和客户来源不一样；
 * - 没填（P6 之前建的老项目，或建的时候客户也没来源）→ 退回去用客户来源；
 * - 两个都空 → null，不进任何渠道的统计。
 * 关联项目数、累计成交（成交数和金额）都按它分渠道。
 */
export function 项目算哪个渠道(项目来源: string | null | undefined, 客户来源: string | null | undefined): string | null {
  return 项目来源 || 客户来源 || null;
}

/** 产出比的平均 / 最高 / 最低三列：对方还没定口径，先不摆。定了把这个改成 true，列和算法已经留好 */
export const 显示产出比分布 = false;

export type 币种合计 = { 币种: string; 合计: number };

export type 统计用项目 = {
  /** 这个项目算哪个渠道的，见文件头「项目归哪个渠道」 */
  channelId: string | null;
  phase: string;
  result: string | null;
  amount: number;
  currency: string;
};
export type 统计用投入 = { channelId: string; amount: number; currency: string };
export type 统计用渠道 = { id: string; createdAt: Date; endDate: Date | null };

export type 渠道统计 = {
  关联线索: number;
  有效线索: number;
  关联商机: number;
  关联订单: number;
  关联项目: number;
  累计成交: 币种合计[];
  当前投入: 币种合计[];
  /** 总投入产出比；算不了是 null，原因见 产出比说明 */
  产出比: number | null;
  产出比说明: string | null;
  累计运营天数: number;
};

/** 有效线索的口子：现在没有标无效的字段，全算有效。有了「判无效」记号只改这里 */
export function 是有效线索(_p: 统计用项目): boolean {
  return true;
}

/** 算不算进累计成交 */
export function 算成交(p: 统计用项目): boolean {
  return p.phase === "订单" && p.result !== "异常状态";
}

const 一天 = 86_400_000;
/** 当地日历天的序号：时区按进程的（生产和单测都是 Asia/Shanghai） */
const 第几天 = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 一天);

export function 运营天数(创建: Date, 结束: Date | null, 今天: Date): number {
  return Math.max(0, 第几天(结束 ?? 今天) - 第几天(创建));
}

const 分 = (x: number) => Math.round(x * 100) / 100;

function 合计(行: { amount: number; currency: string }[]): 币种合计[] {
  const m = new Map<string, number>();
  for (const r of 行) {
    const v = Number(r.amount) || 0;
    if (v === 0) continue;
    m.set(r.currency, (m.get(r.currency) ?? 0) + v);
  }
  return [...m.entries()].map(([币种, 合]) => ({ 币种, 合计: 分(合) })).sort((a, b) => b.合计 - a.合计);
}

/** 总投入产出比，两位小数 */
export function 算产出比(成交: 币种合计[], 投入: 币种合计[]): { 产出比: number | null; 产出比说明: string | null } {
  const 投 = 投入.filter((x) => x.合计 !== 0);
  if (投.length === 0) return { 产出比: null, 产出比说明: "还没录投入" };
  if (投.length > 1) return { 产出比: null, 产出比说明: "投入有几种币种，不换汇，算不了" };
  const 币 = 投[0].币种;
  if (成交.some((x) => x.币种 !== 币)) return { 产出比: null, 产出比说明: `成交里有${币}以外的币种，不换汇，算不了` };
  const 成 = 成交.reduce((s, x) => s + x.合计, 0);
  return { 产出比: 分(成 / 投[0].合计), 产出比说明: null };
}

export function 算渠道统计(渠道们: 统计用渠道[], 项目们: 统计用项目[], 投入们: 统计用投入[], 今天: Date = new Date()): Record<string, 渠道统计> {
  const 项目按渠道 = new Map<string, 统计用项目[]>();
  for (const p of 项目们) {
    if (!p.channelId) continue;
    (项目按渠道.get(p.channelId) ?? 项目按渠道.set(p.channelId, []).get(p.channelId)!).push(p);
  }
  const 投入按渠道 = new Map<string, 统计用投入[]>();
  for (const x of 投入们) (投入按渠道.get(x.channelId) ?? 投入按渠道.set(x.channelId, []).get(x.channelId)!).push(x);

  const out: Record<string, 渠道统计> = {};
  for (const c of 渠道们) {
    const 项 = 项目按渠道.get(c.id) ?? [];
    const 线索 = 项.filter((p) => p.phase === "线索");
    const 累计成交 = 合计(项.filter(算成交));
    const 当前投入 = 合计(投入按渠道.get(c.id) ?? []);
    out[c.id] = {
      关联线索: 线索.length,
      有效线索: 线索.filter(是有效线索).length,
      关联商机: 项.filter((p) => p.phase === "商机").length,
      关联订单: 项.filter((p) => p.phase === "订单").length,
      关联项目: 项.length,
      累计成交,
      当前投入,
      ...算产出比(累计成交, 当前投入),
      累计运营天数: 运营天数(c.createdAt, c.endDate, 今天),
    };
  }
  return out;
}

/**
 * 产出比分布（显示产出比分布 打开才用）：一组渠道的产出比平均 / 最高 / 最低，算不了的渠道不进。
 * 留着是因为对方的表里有这三列，口径（按渠道平均还是加权）还没定
 */
export function 产出比分布(统计们: 渠道统计[]): { 平均: number; 最高: number; 最低: number } | null {
  const 比 = 统计们.map((s) => s.产出比).filter((x): x is number => x !== null);
  if (比.length === 0) return null;
  return { 平均: 分(比.reduce((s, x) => s + x, 0) / 比.length), 最高: Math.max(...比), 最低: Math.min(...比) };
}

/** 渠道全称上限，和 name 原来的长度一样不设库约束，表单和导入都按这个挡 */
export const 全称上限 = 80;
export const 全称分隔 = "|";

/** 渠道全称 =「渠道名称|来源」；来源和渠道名称一样时只写渠道名称 */
export function 拼全称(渠道名称: string | null | undefined, 来源: string | null | undefined): string {
  const a = (渠道名称 ?? "").trim();
  const b = (来源 ?? "").trim();
  if (!a) return b;
  if (!b || a === b) return a;
  return `${a}${全称分隔}${b}`;
}

/** 反过来：从全称里拆出来源（编辑老渠道时回填表单）。渠道名称对不上前缀就整段当来源 */
export function 拆来源(全称: string, 渠道名称: string | null | undefined): string {
  const a = (渠道名称 ?? "").trim();
  if (!a) return 全称;
  if (全称 === a) return a;
  const 前缀 = `${a}${全称分隔}`;
  return 全称.startsWith(前缀) ? 全称.slice(前缀.length) : 全称;
}
