"use client";

import { useSyncExternalStore } from "react";
import { 默认外观 } from "@/lib/appearance";

/**
 * 当前主题（<html data-skin>，设置 → 外观 → 主题）。设计语言改版只动「现状」主题，结构上的改动
 * （比如联系人从手风琴改成每人一组）按它分开渲染：现状走新结构，换皮主题保持原样（用户 11-21「不动」）。
 * 设置里换主题时 data-skin 一变就跟着重画，不用刷新。服务端一律按默认（现状）渲染，水合后再对上。
 */
function 订阅(变了: () => void) {
  const 看 = new MutationObserver(变了);
  看.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
  return () => 看.disconnect();
}
const 读 = () => document.documentElement.dataset.skin || 默认外观.skin;
const 服务端读 = () => 默认外观.skin;

export function useSkin(): string {
  return useSyncExternalStore(订阅, 读, 服务端读);
}

/** 现状主题（默认）：设计语言 D 系列的新结构只在这里出 */
export function useIsNowSkin(): boolean {
  return useSkin() === 默认外观.skin;
}
