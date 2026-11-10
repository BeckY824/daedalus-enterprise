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
import { 拆来源, 合并统计, type 渠道统计 } from "@/lib/enterprise/channel-stats";

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

/**
 * 「历史渠道」组（P-渠道-06，11-10）：主渠道的分类写成这四个字 = 已启用、只承载历史客户，新数据不得选。
 * 不另加字段：分类本来就存中文大类名，主渠道表「分类」列照样显示「历史渠道」。
 * 历史渠道照常启用（老客户、老项目照样显示、统计、筛选），只是新建表单、AI 新线索、导入模板的可选清单里不列，服务端新建线索也拒。
 */
export const 历史渠道分类 = "历史渠道";

/** 这个主渠道分类是不是「历史渠道」组（前后空格不算） */
export function 是历史渠道(category: string | null | undefined): boolean {
  return (category ?? "").trim() === 历史渠道分类;
}

/** 新数据选了历史渠道时的报错（表单、导入、服务端同一句） */
export function 历史渠道报错(全称: string): string {
  return `「${全称}」是历史渠道，只承载历史客户，新数据不能选`;
}

/**
 * 来源列只显示主渠道（P-渠道-01，11-10）：有 platform（两层后 = 主渠道名）用它，老数据没有就按竖线拆全称取前半段。
 * 不带「|」「｜」；全称为空给空串
 */
export function 主渠道显示名(全称: string | null | undefined, platform?: string | null): string {
  return platform?.trim() || 拆主子(全称 ?? "").主;
}

/**
 * 全称显示规整（P-渠道-01）：没子渠道、或子渠道和主渠道同名时只显示主渠道，不留尾巴上的「|」；
 * 有子渠道的统一显示成「主|子」（半角，和库里拼的一样）
 */
export function 渠道显示名(全称: string | null | undefined): string {
  const { 主, 子 } = 拆主子(全称 ?? "");
  return !子 || 子 === 主 ? 主 : `${主}|${子}`;
}

/** 渠道页「按主渠道」看时的一行（P-渠道-01 附.5 统计按两层） */
export type 主渠道汇总 = {
  /** 行键：挂了主渠道的是主渠道 id，还没补挂的老渠道按主渠道名归一组 */
  id: string;
  name: string;
  mainId: string | null;
  子渠道数: number;
  /** 主渠道启用着（没补挂的：底下有一个启用的子渠道就算） */
  active: boolean;
  历史: boolean;
  统计: 渠道统计;
};

/**
 * 把（已经筛过的）子渠道行按主渠道并成一行：统计用 合并统计；没补挂主渠道的老渠道按全称前半段归组。
 * 顺序跟着行里第一次出现的顺序走
 */
export function 按主渠道汇总(
  行们: readonly { name: string; platform: string | null; mainId?: string | null; active: boolean; 统计?: 渠道统计 }[],
  主渠道们: readonly 主渠道行[],
): 主渠道汇总[] {
  const 主表 = new Map(主渠道们.map((m) => [m.id, m]));
  const 组 = new Map<string, { 名: string; mainId: string | null; 启用: boolean; 统计们: 渠道统计[]; 数: number }>();
  for (const r of 行们) {
    const m = r.mainId ? 主表.get(r.mainId) : undefined;
    const 名 = m?.name ?? 主渠道显示名(r.name, r.platform);
    const 键 = m ? m.id : `名:${名}`;
    const g = 组.get(键) ?? 组.set(键, { 名, mainId: m?.id ?? null, 启用: false, 统计们: [], 数: 0 }).get(键)!;
    g.数 += 1;
    if (r.统计) g.统计们.push(r.统计);
    if (!m && r.active) g.启用 = true;
  }
  return [...组.entries()].map(([键, g]) => {
    const m = g.mainId ? 主表.get(g.mainId) : undefined;
    return { id: 键, name: g.名, mainId: g.mainId, 子渠道数: g.数, active: m ? m.active : g.启用, 历史: 是历史渠道(m?.category), 统计: 合并统计(g.统计们) };
  });
}
