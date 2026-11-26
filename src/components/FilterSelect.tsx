"use client";

import { useState } from "react";
import { Grid, Select, type SelectProps } from "antd";
import type { BaseOptionType, DefaultOptionType } from "antd/es/select";
import { 少选项上限, 没有匹配, 选项个数, 选项匹配 } from "@/lib/filter-search";

/**
 * 列表页筛选下拉（F-050）：除了点选，也能打字即时过滤选项。各列表页、复盘页的筛选行统一用它，不在各页各写一套 showSearch。
 *
 *   出不出输入框：showSearch 给 false 一律不出；桌面宽（md 及以上，≥768）一律出；手机宽（md === false，<768，同 PoolView 的判法）
 *   才看选项数，多于 6 个（不算「全部 X」，lib/filter-search.ts 少选项上限）或页面显式给了 showSearch（true / 对象：选项点开才取的，
 *   取到之前数不准）才出，少的不出，免得一点开就弹键盘
 *   断点首次渲染还没值（useBreakpoint 先给 {}，md 是 undefined）按桌面算：antd 在 useLayoutEffect 里补上真值、重画在上屏之前，
 *   手机上不会先出输入框再收起；服务端渲染那一份也按桌面，收着的选择框有没有输入框看起来一样
 *   比法：包含、忽略大小写和首尾空格，比看得见的字（选项匹配）；页面自己给了 filterOption（showSearch 对象里或顶层）的照它
 *   顶层的 filterOption / onSearch / optionFilterProp 并进 showSearch 对象再给 antd：antd 6 拿 showSearch 对象盖顶层，不并就被静默吃掉
 *   打了字没对上：写「没有匹配的选项」；没打字时照页面原来的 notFoundContent
 *   键盘（上下键挑、回车选、Esc 关）、点开即聚焦到输入框、清空输入恢复全部，都是 antd Select 自带的
 *   别的属性原样给 antd Select：筛选的值、地址栏参数、服务端查询都不变
 */
// 值类型默认 any，和 antd Select 一样：各页 onChange 原来按 Select 写的，换成这个不用逐个补类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function FilterSelect<V = any, O extends BaseOptionType | DefaultOptionType = DefaultOptionType>(props: SelectProps<V, O>) {
  const { showSearch, notFoundContent, onOpenChange, filterOption, onSearch, optionFilterProp, ...rest } = props;
  const [词, set词] = useState("");
  const 手机 = Grid.useBreakpoint().md === false;
  const 要搜 = showSearch === false ? false
    : !手机 ? true
    : showSearch !== undefined ? true
    : 选项个数(rest.options as never) > 少选项上限;
  const 页面给的 = typeof showSearch === "object" ? showSearch : {};
  const 搜: SelectProps<V, O>["showSearch"] = 要搜
    ? {
        ...页面给的,
        filterOption: 页面给的.filterOption ?? filterOption ?? ((输入, o) => 选项匹配(输入, o as never)),
        optionFilterProp: 页面给的.optionFilterProp ?? optionFilterProp,
        onSearch: (v) => { set词(v); 页面给的.onSearch?.(v); onSearch?.(v); },
      }
    : false;
  return (
    <Select<V, O>
      {...rest}
      showSearch={搜}
      notFoundContent={要搜 && 词.trim() ? 没有匹配 : notFoundContent}
      onOpenChange={(开) => { if (!开) set词(""); onOpenChange?.(开); }}
    />
  );
}
