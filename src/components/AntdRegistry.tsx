"use client";

/* 替代 @ant-design/nextjs-registry 的 AntdRegistry。原版每个请求 new 一份 cssinjs 缓存，
   页面上每个 antd 组件的样式（token 推导 + 样式对象 + stylis 编译）每次请求都从头算一遍——
   客户列表页一次 HTML 请求里这块占三成 CPU，30 人并发时全排在主线程上。

   主题只有一套（lib/theme.ts，cssVar 固定），同一个 key 算出来的样式每次都一样，
   所以服务端把算好的值存在进程里跨请求复用；每个请求另记「本次用到了哪些 key、按什么先后」，
   吐出来的 <style> 和原版逐字相同（同样的 key、同样的先后、同样分批 once）。
   浏览器端照旧每次挂载 createCache()，和原版一样。

   11-15 起吐的不是内联 <style> 而是外链（lib/antd-css-store.ts）：正文还是逐字相同的那段，
   按「这一批哪些 key、什么先后」记号存在进程里，页面只带 <link>，浏览器按号长期缓存。 */
import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import { useServerInsertedHTML } from "next/navigation";
import { useState } from "react";
import { 取样式, 记样式, 样式号 } from "@/lib/antd-css-store";

type Entity = ReturnType<typeof createCache>;
type Value = [number, unknown];

/* 进程里共用的「key → 算好的值」。key 由组件 + 主题 hash 组成，单主题下是有限的几千个；
   万一主题变多撑大了就整个清掉重算，不至于一直涨 */
const 共用 = new Map<string, Value>();
const 共用上限 = 20000;

/* 一个请求一份：取值先看本次、再看进程共用；写入同时记本次的先后（extractStyle 按它排同 order 的样式），
   字段和 cssinjs 的 Cache 实体同名，hooks 和 extractStyle 只用到这几样 */
export class 本次请求缓存 {
  instanceId = Math.random().toString(12).slice(2);
  cache = new Map<string, Value>();
  updateTimes = new Map<string, number>();
  extracted = new Set<string>();
  #次序 = 0;

  get(keys: (string | number)[]) {
    return this.opGet(keys.join("%"));
  }
  opGet(key: string) {
    return this.cache.get(key) || null;
  }
  update(keys: (string | number)[], valueFn: (prev?: Value) => Value | null) {
    this.opUpdate(keys.join("%"), valueFn);
  }
  opUpdate(key: string, valueFn: (prev?: Value) => Value | null) {
    const next = valueFn(this.cache.get(key) ?? 共用.get(key));
    if (next === null) {
      this.cache.delete(key);
      this.updateTimes.delete(key);
      return;
    }
    this.cache.set(key, next);
    this.updateTimes.set(key, this.#次序++);
    if (共用.size >= 共用上限) 共用.clear();
    共用.set(key, next);
  }
}

/* extractStyle 只抽这三类 key（cssinjs extractStyle 的 types 默认值） */
const 抽的前缀 = /^(style|token|cssVar)%/;
const 空批 = '.data-ant-cssinjs-cache-path{content:"";}';

/**
 * 抽这一批（once：上一批抽过的不再抽）的样式，返回存好的号；这一批什么都没有 = null（同原版不吐）。
 * 同一批 key、同样先后的样式逐字相同，号记过就不再跑 extractStyle，只把这批 key 记成抽过（和 extractStyle 自己记的一样）
 */
export function 抽一批(cache: 本次请求缓存): string | null {
  const 这批 = [...cache.updateTimes.entries()]
    .filter(([k]) => 抽的前缀.test(k) && !cache.extracted.has(k))
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k);
  if (!这批.length) return null;
  const 号 = 样式号(这批.join("\n"));
  const 有 = 取样式(号);
  if (有 !== undefined) {
    for (const k of 这批) cache.extracted.add(k);
    return 有 === "" ? null : 号;
  }
  const styleText = extractStyle(cache as unknown as Entity, { plain: true, once: true });
  const 空 = styleText.includes(空批);
  记样式(号, 空 ? "" : styleText);
  return 空 ? null : 号;
}

export default function AntdRegistry({ children }: { children: React.ReactNode }) {
  const [cache] = useState<Entity>(() =>
    typeof window === "undefined" ? (new 本次请求缓存() as unknown as Entity) : createCache(),
  );
  useServerInsertedHTML(() => {
    const 号 = 抽一批(cache as unknown as 本次请求缓存);
    if (!号) return null;
    return (
      <>
        {/* 位置和原来那段内联样式一样（head 里 Next 的 CSS 之后；后面几批在正文里，换进来的内联脚本等它下完才跑） */}
        <link rel="stylesheet" href={`/api/antd-css/${号}`} />
        {/* 空的占位：antd 浏览器端后插的样式（rc-util 只认 <style>）照旧排在它后面，和原来排在那段内联样式后面一样 */}
        <style id="antd-cssinjs" data-rc-order="prepend" data-rc-priority="-1000" />
      </>
    );
  });
  return <StyleProvider cache={cache}>{children}</StyleProvider>;
}
