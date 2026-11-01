/**
 * 客户看板按「客户属性」分列（U-客户-06 / A-17，10-31 会议）。纯算，服务端、客户端都能用。
 * 列的顺序：
 * 1. 字典里启用着的项，按字典顺序；没客户也摆（管理员在字典里新加的也在这）。
 * 2. 客户身上存着、但字典里已停用或没有的值（旧属性）：有客户才摆，标「停用」；按字典位置，字典里没有的按出现先后。
 * 3. 「—」：没填客户属性的；没客户就不摆。导入时拿 "-" 占位的也算没填，和空值并在这一列（11-01 用户：
 *    「客户属性目前由于导入的时候没有相关值都填 -」「其余地方没有填写的信息都用 — 表示」，lib/empty-value.ts）。
 */
import { 去空, 空值符 } from "@/lib/empty-value";

export type 看板列<T> = { key: string | null; 名: string; 停用: boolean; 行们: T[] };

/** 没填那一列的列名：和全站没填的显示一样写「—」 */
export const 未设置名 = 空值符;

export function 客户看板分列<T>(行们: readonly T[], 取值: (行: T) => string | null | undefined, 字典: readonly { name: string; active: boolean }[]): 看板列<T>[] {
  const 按值 = new Map<string, T[]>();
  const 先后: string[] = [];
  const 未设: T[] = [];
  for (const 行 of 行们) {
    const v = 去空(取值(行));
    if (!v) {
      未设.push(行);
      continue;
    }
    if (!按值.has(v)) {
      按值.set(v, []);
      先后.push(v);
    }
    按值.get(v)!.push(行);
  }
  const 列们: 看板列<T>[] = [];
  const 摆了 = new Set<string>();
  for (const d of 字典) {
    if (!d.active || 摆了.has(d.name)) continue;
    摆了.add(d.name);
    列们.push({ key: d.name, 名: d.name, 停用: false, 行们: 按值.get(d.name) ?? [] });
  }
  const 字典位 = new Map(字典.map((d, i) => [d.name, i] as const));
  const 旧值们 = 先后
    .filter((v) => !摆了.has(v))
    .sort((a, b) => (字典位.get(a) ?? Infinity) - (字典位.get(b) ?? Infinity) || 先后.indexOf(a) - 先后.indexOf(b));
  for (const v of 旧值们) 列们.push({ key: v, 名: v, 停用: true, 行们: 按值.get(v)! });
  if (未设.length) 列们.push({ key: null, 名: 未设置名, 停用: false, 行们: 未设 });
  return 列们;
}
