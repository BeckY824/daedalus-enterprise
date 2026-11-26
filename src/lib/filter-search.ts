/**
 * 筛选下拉打字搜（F-050，11-25 员工：「所有筛选项（含客户页）除了点选，也能输入文字自动匹配」）。
 *
 * 比法：按包含，忽略大小写和首尾空格（中文就是包含）；比的是选项看得见的字（label 是节点时取里面的字），
 * 没有字的才比 value。出不出输入框：桌面宽（≥768）一律出；手机宽（<768）选项不多于 少选项上限 个（不算「全部 X」那种
 * value 为空的项）时一眼看完，不出（免得一点开就弹键盘），页面显式给了 showSearch 的照出。
 * 组件见 components/FilterSelect.tsx。
 */
import { isValidElement, type ReactNode } from "react";

/** 手机宽（<768）下不多于这么多个选项就不出输入框：一屏看得完，打字反而多一步还会弹键盘；桌面宽不看这个，一律出 */
export const 少选项上限 = 6;

export const 没有匹配 = "没有匹配的选项";

type 选项 = { value?: unknown; label?: ReactNode; title?: unknown; options?: 选项[]; [k: string]: unknown };

/** 节点里的字：字符串、数字直接拿，元素取 children，数组拼起来 */
export function 节点文字(n: ReactNode): string {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number" || typeof n === "bigint") return String(n);
  if (Array.isArray(n)) return n.map(节点文字).join("");
  if (isValidElement<{ children?: ReactNode }>(n)) return 节点文字(n.props.children);
  return "";
}

/** 一个选项拿来比的字：看得见的 label，取不到字时用 title，再不行用 value */
export function 选项文字(o: 选项): string {
  const 字 = 节点文字(o.label as ReactNode);
  if (字) return 字;
  if (typeof o.title === "string" && o.title) return o.title;
  return o.value === null || o.value === undefined ? "" : String(o.value);
}

/** 给 antd Select 的 filterOption：输入去首尾空格、不分大小写，包含就算对上；只输了空格当没输 */
export function 选项匹配(输入: string, o?: 选项): boolean {
  const 词 = 输入.trim().toLowerCase();
  if (!词) return true;
  return !!o && 选项文字(o).toLowerCase().includes(词);
}

/** 真正可选的有几个：分组只数组里的，value 为空的「全部 X」不算 */
export function 选项个数(options?: readonly 选项[] | null): number {
  if (!options) return 0;
  let n = 0;
  for (const o of options) {
    if (Array.isArray(o.options)) n += 选项个数(o.options);
    else if (o.value !== "" && o.value !== null && o.value !== undefined) n++;
  }
  return n;
}
