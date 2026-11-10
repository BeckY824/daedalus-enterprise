/**
 * 企业版渠道两层（2026-11-08）：主渠道 + 子渠道。纯函数，客户端组件也 import；读写库在 channel-main.ts。
 *
 * - 主渠道一张表（EntChannelMain）：名字、可设子渠道、支持自拓、分类、启用。两个开关互不相关。
 *   分类存的就是中文大类名（11-08 主渠道清单的大类，如「三方平台」「自有阵地」「转介绍」），主渠道表里只显示、不在页面上改。
 * - 原来的每个渠道（Channel）算一个子渠道，挂在主渠道下（Channel.mainId）。Channel.platform 存主渠道名，
 *   Channel.name 仍是全称「主渠道|子渠道」；子渠道留空（单一入口）时全称就是主渠道名。
 *   客户、项目、统计、导入照旧认 Channel，不用改。
 * - 子渠道命名：平台账号类写账号名，展会写「年份+展会名」，单一入口留空（表单里的提示）。
 * - 运营策略（Channel.strategies）：字典 channelStrategy 里多选，存 JSON 数组。
 */
import { 拆来源 } from "@/lib/enterprise/channel-stats";

/** 主渠道名最多几个字（全称上限 80 里要给子渠道留地方） */
export const 主渠道名上限 = 40;

/** 子渠道名的写法提示，表单和导入都用这一句 */
export const 子渠道提示 = "平台账号写账号名；展会写「年份+展会名」，如 2026广交会；单一入口留空";

/** 老渠道名拆主 / 子：按第一个「|」或全角「｜」拆，拆不开整段当主渠道 */
export function 拆主子(全称: string): { 主: string; 子: string } {
  const s = (全称 ?? "").trim();
  const m = s.match(/^(.*?)\s*[|｜]\s*(.*)$/);
  if (!m || !m[1].trim()) return { 主: s, 子: "" };
  return { 主: m[1].trim(), 子: m[2].trim() };
}

/** 从全称和主渠道名取子渠道名：全称就是主渠道名 = 没有子渠道（留空） */
export function 子渠道名(全称: string, 主渠道: string | null | undefined): string {
  const a = (主渠道 ?? "").trim();
  if (!a) return 拆主子(全称).子;
  const 全 = (全称 ?? "").trim();
  if (全 === a) return "";
  for (const 分 of ["|", "｜"]) if (全.startsWith(a + 分)) return 全.slice(a.length + 1).trim();
  return 拆来源(全, a);
}

/** 库里的运营策略（JSON 数组文字）读成数组；坏的、空的给 [] */
export function 读策略(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  } catch {
    return [];
  }
}

/** 运营策略数组写回库：去空、去重；空数组存 null */
export function 写策略(们: readonly string[] | null | undefined): string | null {
  const 净 = [...new Set((们 ?? []).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
  return 净.length ? JSON.stringify(净) : null;
}

export type 主渠道行 = {
  id: string;
  name: string;
  allowSub: boolean;
  selfDev: boolean;
  category: string | null;
  active: boolean;
  sort: number;
};

/** 主渠道表「分类」那一格：存的就是中文大类名，原样显示；没分类写「—」 */
export function 分类文字(category: string | null | undefined): string {
  return category?.trim() || "—";
}
