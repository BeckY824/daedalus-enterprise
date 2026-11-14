import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { createCache, extractStyle, StyleProvider } from "@ant-design/cssinjs";
import { Button, Card, ConfigProvider, Input, Select, Table, Tag } from "antd";
import zhCN from "antd/locale/zh_CN";
import { themeConfig } from "@/lib/theme";
import { 本次请求缓存, 抽一批 } from "@/components/AntdRegistry";
import { 取样式, 记样式, 记多少批, 样式号, 号的样子 } from "@/lib/antd-css-store";

type Entity = ReturnType<typeof createCache>;

const 页面A = () => [h(Button, { key: 1, type: "primary" }, "保存"), h(Input, { key: 2 }), h(Tag, { key: 3 }, "A")];
const 页面B = () => [h(Card, { key: 1, title: "卡" }, "x"), h(Select, { key: 2, options: [] }), h(Table, { key: 3, dataSource: [], columns: [] })];

/* 模拟一次 HTML 请求：分两批渲染、每批后 once 抽一次（流式里 useServerInsertedHTML 分批调用就是这样） */
function 一次请求(cache: Entity, 批次: (() => ReactNode)[]) {
  return 批次.map((内容) => {
    renderToStaticMarkup(h(StyleProvider, { cache }, h(ConfigProvider, { locale: zhCN, theme: themeConfig }, 内容())));
    return extractStyle(cache, { plain: true, once: true });
  });
}

it("跨请求复用的样式缓存吐出的 <style> 和每次新建缓存逐字相同", () => {
  const 原版 = 一次请求(createCache(), [页面A, 页面B]);
  expect(原版[0].length).toBeGreaterThan(1000);

  // 先跑一个别的页面，把进程里共用的缓存填上一些本页不用的 key
  一次请求(new 本次请求缓存() as unknown as Entity, [页面B]);
  // 第一次（部分 key 已算过）和第二次（全部命中共用）都要和原版一样，且不带别的页面的样式
  expect(一次请求(new 本次请求缓存() as unknown as Entity, [页面A, 页面B])).toEqual(原版);
  expect(一次请求(new 本次请求缓存() as unknown as Entity, [页面A, 页面B])).toEqual(原版);
  expect(一次请求(new 本次请求缓存() as unknown as Entity, [页面A])).toEqual(一次请求(createCache(), [页面A]));
});

/* 11-15 外链：每批记一个号，号对应的正文和原版那批逐字相同；同一批第二次来不再跑 extractStyle，号不变 */
function 一次外链请求(批次: (() => ReactNode)[]) {
  const cache = new 本次请求缓存();
  return 批次.map((内容) => {
    renderToStaticMarkup(h(StyleProvider, { cache: cache as unknown as Entity }, h(ConfigProvider, { locale: zhCN, theme: themeConfig }, 内容())));
    return 抽一批(cache);
  });
}

it("外链样式：号取回的正文 = 原版内联那段；再来一次号相同；没新样式的批不吐", () => {
  const 原版 = 一次请求(createCache(), [页面A, 页面B]);
  const 号们 = 一次外链请求([页面A, 页面B]);
  expect(号们.every(Boolean)).toBe(true);
  expect(号们.map((x) => 取样式(x!))).toEqual(原版);
  // 第二次（命中号）：号相同、正文仍是原版；第三批什么新组件都没有 = null，同原版返回 null
  expect(一次外链请求([页面A, 页面B, 页面A])).toEqual([...号们, null]);
  // 先 B 后 A：批次内容不同，号不同，正文照样对得上各自的原版
  const 反过来 = 一次外链请求([页面B, 页面A]);
  expect(反过来[0]).not.toBe(号们[0]);
  expect(反过来.map((x) => 取样式(x!))).toEqual(一次请求(createCache(), [页面B, 页面A]));
});

it("外链样式：店里最多记 记多少批，超了丢最早的；号的样子只认小写字母数字", () => {
  for (let i = 0; i < 记多少批 + 3; i++) 记样式(`t${i}xxxxx`, `a{b:${i}}`);
  expect(取样式("t0xxxxx")).toBeUndefined();
  expect(取样式(`t${记多少批 + 2}xxxxx`)).toBe(`a{b:${记多少批 + 2}}`);
  expect(号的样子.test(样式号("x"))).toBe(true);
  expect(号的样子.test("../etc")).toBe(false);
});
