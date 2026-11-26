"use client";
import { Suspense, use, useEffect, useState, type ReactNode } from "react";

/**
 * 壳上的几个数（左栏要跟角标、手机顶栏日历、铃铛未读、左栏客户数）晚一步到（11-26 客户页提速第三段）。
 *
 * 原来 (app)/layout 把这些数查完才吐壳，整页打开时首字节、骨架都要等它们；现在 layout 不等，
 * 把查询的 Promise 直接传给客户端壳，壳先出、数到了再填进来：
 *   - 看得见的数用 <晚到>：Suspense 包住**只画这个数的那一小块**，兜底是同一块结构、数当 占（0 = 什么都不画）。
 *     数到时 React 在流里把这一小块换掉（不等水合）。这些数都摆在行尾 margin-left:auto 或角上绝对定位，
 *     出不出现都不推动别的东西，所以不用另外留宽度。
 *   - 写进属性的（aria-label）、驱动副作用的（Dock 刷新）用 useLate：先是 null，到了再填。
 *
 * 站内跳转 layout 不重算，这些 Promise 一直是同一个、早到了，不会再回到占位。
 * router.refresh() / 动作后重渲 layout 会换一个新 Promise：那是 transition，已经露出来的 Suspense 不回兜底，
 * React 留着旧数直到新数到（useLate 也是旧值留到新值到）。别给这几个 Suspense 加 key——那样换 Promise 就是新边界，会先闪回占位。
 *
 * 传的是普通值（单测、桌面端旧调用）时照旧同步画，和原来一样。
 */
export type 或晚到<T> = T | Promise<T>;

function 是晚到<T>(x: 或晚到<T>): x is Promise<T> {
  return typeof (x as { then?: unknown } | null)?.then === "function";
}

export function 晚到<T>({ 值, 占, children }: { 值: 或晚到<T>; 占: T; children: (v: T) => ReactNode }) {
  if (!是晚到(值)) return <>{children(值)}</>;
  return (
    <Suspense fallback={children(占)}>
      <LateArrived p={值}>{children}</LateArrived>
    </Suspense>
  );
}

function LateArrived<T>({ p, children }: { p: Promise<T>; children: (v: T) => ReactNode }) {
  return <>{children(use(p))}</>;
}

/** 数到了才有值（之前 null）；换了新 Promise 时旧值留着，等新的到了再换 */
export function useLate<T>(值: 或晚到<T>): T | null {
  const [到的, set到的] = useState<T | null>(null);
  useEffect(() => {
    if (!是晚到(值)) return;
    let 还在 = true;
    值.then((v) => 还在 && set到的(() => v), () => {});
    return () => {
      还在 = false;
    };
  }, [值]);
  return 是晚到(值) ? 到的 : 值;
}
