/**
 * 按「导入批次」（Project.importBatch）挑出 / 排掉一批项目（11-19：数据页的新建数、线索池数、漏斗要能按批次挑出来，留得下痕迹，不手改数）。
 * 这里只有纯函数和常量、不碰 prisma：数据页、项目列表、新线索、公海页（服务端）和界面（客户端）都引它。
 *
 * 地址栏 batch=：
 *   batch=<批次号>   只看这一批
 *   batch=-<批次号>  排掉这一批（importBatch 为空的项目照旧留着，见 批次条件）
 *   不带 / 认不出    全部（和没有这个功能时一样）
 * 数据页上的「导入批次」下拉、卡片点进列表带过去的、列表上那枚「导入批次：… ×」标签都是这一个参数。
 *
 * 和补建的关系：补建批次（system-created.ts 补建批次）在「新建」类的数里本来就排掉，选「只看 补建批次」时新建数还是 0，那条不变。
 */
import type { Prisma } from "@/generated/prisma";

export type 批次筛 = { 批: string; 排: boolean };

/** 批次号的样子：字母数字和 . _ : -，最长 80（库里写的都是 xxx-yyyymmdd 这类）；不像的当没给 */
const 批次号样 = /^[A-Za-z0-9._:-]{1,80}$/;

/** 读地址栏的 batch=：只看 / 排掉 / null（全部） */
export function 读批次(v: unknown): 批次筛 | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const 排 = s.startsWith("-");
  const 批 = 排 ? s.slice(1) : s;
  return 批次号样.test(批) && !批.startsWith("-") ? { 批, 排 } : null;
}

/** 写回地址栏的值（读批次 的反面）；null = ""（不带） */
export function 批次参数(b: 批次筛 | null | undefined): string {
  return b ? `${b.排 ? "-" : ""}${b.批}` : "";
}

/**
 * 库里的条件。只看 = importBatch 等于这一批；排掉 = importBatch 为空或不是这一批
 * （SQL 里 importBatch <> 'x' 会把 NULL 也排掉，所以写成 OR）。外面包一层 AND，展开进别的 where 不和那边的 OR 撞键
 */
export function 批次条件(b: 批次筛 | null | undefined): Prisma.ProjectWhereInput | undefined {
  if (!b) return undefined;
  if (!b.排) return { importBatch: b.批 };
  return { AND: [{ OR: [{ importBatch: null }, { importBatch: { not: b.批 } }] }] };
}

/** 批次号 → 界面上的叫法；表里没有的显示原值。不写客户名 */
export const 批次显示名: Readonly<Record<string, string>> = {
  "xbm-incr-20261119": "销帮帮增量 11-19",
  "xbm-incr-20261119-pool": "销帮帮增量 11-19 · 公海客户项目",
  "fill-nurture-20261117": "补建潜客培育 11-17",
};
export function 批次名(批: string): string {
  return 批次显示名[批] ?? 批;
}

/** 下拉、标签上的一句：「只看 某批」/「排掉 某批」 */
export function 批次说法(b: 批次筛): string {
  return `${b.排 ? "排掉" : "只看"} ${批次名(b.批)}`;
}

/** 数据页「导入批次」下拉的选项：全部 + 每一批的只看 / 排掉（批次们 = 库里有项目的那些，已排好序） */
export function 批次下拉项(批次们: readonly string[]): { value: string; label: string }[] {
  return [
    { value: "", label: "全部批次" },
    ...批次们.flatMap((批) => [
      { value: 批, label: 批次说法({ 批, 排: false }) },
      { value: `-${批}`, label: 批次说法({ 批, 排: true }) },
    ]),
  ];
}

/** 在一条站内链接上带上批次（数据页卡片点进列表）；没在筛 = 原样 */
export function 带批次(href: string, 批次: string | undefined): string {
  if (!批次) return href;
  return `${href}${href.includes("?") ? "&" : "?"}batch=${encodeURIComponent(批次)}`;
}
