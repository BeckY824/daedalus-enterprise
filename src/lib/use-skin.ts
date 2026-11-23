"use client";

import { useSyncExternalStore } from "react";

/**
 * 当前主题（<html data-skin>，设置 → 外观 → 主题）。设计语言改版只动「现状」主题，结构上的改动
 * （比如联系人从手风琴改成每人一组）按它分开渲染：现状走新结构，换皮主题保持原样（用户 11-21「不动」）。
 * 设置里换主题时 data-skin 一变就跟着重画，不用刷新。服务端一律按默认（现状）渲染，水合后再对上。
 * 不从 lib/appearance.ts 引默认值：客户页一大串组件都引这里，引了 appearance 会让改它时 CI 牵连几十份 UI 用例
 * （tests/ci-related-tests.test.ts「只改一个叶子文件」）；两边一致由 tests/skins.test.ts 对
 */
export const 现状主题 = "now";
function 订阅(变了: () => void) {
  const 看 = new MutationObserver(变了);
  看.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
  return () => 看.disconnect();
}
const 读 = () => document.documentElement.dataset.skin || 现状主题;
const 服务端读 = () => 现状主题;

export function useSkin(): string {
  return useSyncExternalStore(订阅, 读, 服务端读);
}

/** 现状主题（默认）：设计语言 D 系列的新结构只在这里出 */
export function useIsNowSkin(): boolean {
  return useSkin() === 现状主题;
}

/**
 * 底色（<html data-paper>，设置 → 外观 → 底色）：「原底」= 浅灰地面 + 白卡（默认，11-23 切回），「白底」= D-2 方案 A 的一张纸。
 * 卡片改进（11-23 原型-卡片改进）有几处要挪结构（沟通卡「本项目 / 这位客户全部」从卡头挪进卡身、右栏标题不再重复项目名），
 * 只在现状主题 + 原底下挪；白底、换皮主题照旧。服务端按默认（原底）渲染，水合后再对上；默认值和 lib/appearance.ts 一致由 tests/skins.test.ts 对
 */
export const 原底 = "tone";
function 订阅底色(变了: () => void) {
  const 看 = new MutationObserver(变了);
  看.observe(document.documentElement, { attributes: true, attributeFilter: ["data-paper"] });
  return () => 看.disconnect();
}
const 读底色 = () => document.documentElement.dataset.paper || 原底;
const 服务端读底色 = () => 原底;

/** 现状主题 + 原底（卡片）：卡片改进的结构只在这里出 */
export function useIsToneCards(): boolean {
  const 现状 = useIsNowSkin();
  const 底 = useSyncExternalStore(订阅底色, 读底色, 服务端读底色);
  return 现状 && 底 === 原底;
}
