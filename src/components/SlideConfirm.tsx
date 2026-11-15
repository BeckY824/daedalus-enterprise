"use client";
/**
 * 原来的滑动确认，2026-11 起换成长按确认（components/HoldConfirm.tsx，原型 g.confirm3「改后」：滑动改成按住 1.2 秒）。
 *
 * 留着这个名字只为不动现有调用处：props 一样（话 / 忙 / 做）。
 * 原来的话写的是「滑到右边清除」「滑动以确认」，按住的按钮上不能再这么写——去掉前面「滑…」那半截，
 * 剩下的动作交给 HoldConfirm，按钮上读作「按住 清除」。新代码直接用 HoldConfirm，话写那件事本身（「清除演示数据」）。
 */
import HoldConfirm from "./HoldConfirm";
import type { 做的结果 } from "@/lib/confirm-result";

/** 「滑到右边清除」→「清除」，「滑动以确认」→「确认」；不是「滑」开头的原样留着 */
export function 去掉滑(话: string): string {
  const 剩 = 话.replace(/^滑(?:到右边|到右侧|动以|动)?\s*/, "").trim();
  return 剩 || "确认";
}

export default function SlideConfirm({
  话 = "滑动以确认",
  忙 = false,
  做,
}: {
  话?: string;
  忙?: boolean;
  做: () => 做的结果 | Promise<做的结果>;
}) {
  return <HoldConfirm 话={去掉滑(话)} 忙={忙} 做={做} />;
}
