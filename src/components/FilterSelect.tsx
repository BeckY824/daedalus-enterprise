"use client";

import { useState } from "react";
import { Select, type SelectProps } from "antd";
import type { BaseOptionType, DefaultOptionType } from "antd/es/select";
import { 少选项上限, 没有匹配, 选项个数, 选项匹配 } from "@/lib/filter-search";

/**
 * 列表页筛选下拉（F-050）：除了点选，也能打字即时过滤选项。各列表页、复盘页的筛选行统一用它，不在各页各写一套 showSearch。
 *
 *   选项多于 6 个（不算「全部 X」）才出输入框（lib/filter-search.ts 少选项上限）；showSearch 显式给 true / 对象就一律出
 *   （选项点开才取的，取到之前数不准），给 false 就一律不出
 *   比法：包含、忽略大小写和首尾空格，比看得见的字（选项匹配）；页面自己给了 filterOption 的照它
 *   打了字没对上：写「没有匹配的选项」；没打字时照页面原来的 notFoundContent
 *   键盘（上下键挑、回车选、Esc 关）、点开即聚焦到输入框、清空输入恢复全部，都是 antd Select 自带的
 *   别的属性原样给 antd Select：筛选的值、地址栏参数、服务端查询都不变
 */
// 值类型默认 any，和 antd Select 一样：各页 onChange 原来按 Select 写的，换成这个不用逐个补类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function FilterSelect<V = any, O extends BaseOptionType | DefaultOptionType = DefaultOptionType>(props: SelectProps<V, O>) {
  const { showSearch, notFoundContent, onOpenChange, ...rest } = props;
  const [词, set词] = useState("");
  const 要搜 = showSearch === false ? false : showSearch !== undefined ? true : 选项个数(rest.options as never) > 少选项上限;
  const 页面给的 = typeof showSearch === "object" ? showSearch : {};
  const 搜: SelectProps<V, O>["showSearch"] = 要搜
    ? {
        ...页面给的,
        filterOption: 页面给的.filterOption ?? ((输入, o) => 选项匹配(输入, o as never)),
        onSearch: (v) => { set词(v); 页面给的.onSearch?.(v); },
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
