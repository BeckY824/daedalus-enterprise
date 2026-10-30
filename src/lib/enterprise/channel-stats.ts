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
 * - 线索→商机 / 商机→订单 两个转化率（10-30 B5）：口径见 算转化()；分母 0 给 null，界面显示「—」。
 * - 谁能录投入：见 能录投入()；谁能新建、编辑、停用、删除渠道：见 能管渠道()。
 * - 统计范围（10-30 B2）：数的是「我看得见的」项目——读库那边走 prisma 的范围扩展，和客户列表「按组织看客户」是同一套，
 *   老板、总管理员看全部，别人只数自己和下属的。这个文件只管算，不管范围。
 */
import { 管理员类别们of, type 组织 } from "./org-core";

/**
 * 渠道投入谁能录、能删（10-29 P16 对方定的）：只有老板（账号管理员）、总管理员、市场管理。
 * 渠道负责人、销售管理、别的角色都只能看。固定写死，不进「后台设置谁能改」那张表；服务端动作和抽屉都从这里取
 */
export function 能录投入(org: 组织, 我: { id: string; role: string }): boolean {
  if (我.role === "ADMIN") return true;
  const 类们 = 管理员类别们of(org, 我.id);
  return 类们.has("总管理员") || 类们.has("市场管理");
}
export const 不能录投入 = "渠道投入只有老板、总管理员、市场管理能录，别的角色只能看";

/**
 * 渠道本身谁能管（10-30 B1）：新建、编辑、停用、删除渠道，和录投入是同三类人——老板（账号管理员）、总管理员、市场管理。
 * 别的角色只读：界面不出按钮，服务端动作也直接挡。只在企业版用，团队版照旧
 */
export function 能管渠道(org: 组织, 我: { id: string; role: string }): boolean {
  return 能录投入(org, 我);
}
export const 不能管渠道 = "新建、编辑、停用、删除渠道只有老板、总管理员、市场管理能做，别的角色只能看";

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

/**
 * 产出比的平均值 / 最高值 / 最低值三列（10-29 P16 打开）：摆在「投入产出比」后面，抽屉统计里也有。
 * 口径见 产出比分布()；要临时收起改成 false，列和抽屉那一项一起不见
 */
export const 显示产出比分布 = true;

export type 币种合计 = { 币种: string; 合计: number };

export type 统计用项目 = {
  /** 这个项目算哪个渠道的，见文件头「项目归哪个渠道」 */
  channelId: string | null;
  phase: string;
  result: string | null;
  amount: number;
  currency: string;
  /** 建项目时落在哪个阶段（建项目那条节点日志的 toPhase）；不给当「线索」——手动建、线索转项目、向导都从线索起 */
  起步阶段?: string;
  /** 节点日志里到过的阶段（每条 toPhase）；不给就只看眼下的 phase */
  到过阶段们?: string[];
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
  /** 线索→商机：分子 / 分母 / 比例（分母 0 时比例 null），口径见 算转化() */
  线索转商机: 转化;
  /** 商机→订单 */
  商机转订单: 转化;
};

export type 转化 = { 分子: number; 分母: number; 比例: number | null };

const 阶段序: Record<string, number> = { 线索: 0, 商机: 1, 订单: 2 };
const 序 = (阶段: string | null | undefined) => 阶段序[阶段 ?? ""] ?? 0;

/** 这个项目走到过的最远阶段（线索 < 商机 < 订单）：眼下的阶段和日志里到过的取最远，退回去的也算到过 */
export function 最远阶段(p: 统计用项目): number {
  return Math.max(序(p.phase), ...(p.到过阶段们 ?? []).map(序));
}

/**
 * 两个转化率（10-30 B5）。「到过」按最远阶段算，不看眼下停在哪：
 * - 眼下在商机 / 订单的当然到过商机；后来退回线索的（导入覆盖、团队版能倒退）日志里到过也算——只看眼下会漏；
 * - 丢单、线索流失这些结果不挪阶段，照它所在阶段算到过。
 * - 线索→商机：分母 = 从「线索」起步的项目；分子 = 其中到过商机（含后来进了订单）的。
 * - 商机→订单：分母 = 到过商机、且不是直接从「订单」起步的；分子 = 其中到过订单的。
 * 导入时直接落在商机 / 订单的项目没经过前一步，不进那一步的分母，这样两个比例都不会超过 100%。
 * 分母 0 → 比例 null（界面「—」）。比例是 0~1 的小数，不取整，显示交给 转化率字()
 */
export function 算转化(项目们: 统计用项目[]): { 线索转商机: 转化; 商机转订单: 转化 } {
  const 比 = (分子: number, 分母: number): 转化 => ({ 分子, 分母, 比例: 分母 > 0 ? 分子 / 分母 : null });
  let 线索起 = 0, 线索到商机 = 0, 商机底 = 0, 商机到订单 = 0;
  for (const p of 项目们) {
    const 起 = 序(p.起步阶段 ?? "线索");
    const 远 = Math.max(最远阶段(p), 起);
    if (起 === 0) {
      线索起++;
      if (远 >= 1) 线索到商机++;
    }
    if (起 <= 1 && 远 >= 1) {
      商机底++;
      if (远 >= 2) 商机到订单++;
    }
  }
  return { 线索转商机: 比(线索到商机, 线索起), 商机转订单: 比(商机到订单, 商机底) };
}

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
      ...算转化(项),
    };
  }
  return out;
}

/**
 * 产出比分布：一组渠道（列表里是同一个「渠道名称」下的各个来源）的投入产出比平均值 / 最高值 / 最低值。
 * - 平均是各来源产出比的简单平均（不按投入加权），保留两位；
 * - 算不了产出比的（没录投入、混了币种）不进，个数 = 进了的几个；一个都算不了给 null。
 * 对方只说要这三个数，没说加权；要改加权只改这里
 */
export function 产出比分布(统计们: 渠道统计[]): { 平均: number; 最高: number; 最低: number; 个数: number } | null {
  const 比 = 统计们.map((s) => s.产出比).filter((x): x is number => x !== null);
  if (比.length === 0) return null;
  return { 平均: 分(比.reduce((s, x) => s + x, 0) / 比.length), 最高: Math.max(...比), 最低: Math.min(...比), 个数: 比.length };
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
