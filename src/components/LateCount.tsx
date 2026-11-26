"use client";
import { Suspense, use, useEffect, useMemo, useState, type ReactNode } from "react";

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
 * router.refresh() / 动作后重渲 layout 会换一个新 Promise：客户端已经拿到过数（useLate 有值）时不再走 Suspense，
 * 旧数留着直到新数到，不闪回占位。别给这几个 Suspense 加 key——那样换 Promise 就是新边界，会先闪回占位。
 *
 * 传的是普通值（单测、桌面端旧调用）时照旧同步画，和原来一样。
 */
export type 或晚到<T> = T | Promise<T>;

function 是晚到<T>(x: 或晚到<T>): x is Promise<T> {
  return typeof (x as { then?: unknown } | null)?.then === "function";
}

/**
 * 只包数的那一小块，别把钮、链接包进来（11-26 审查）：硬刷新时数没到，这块是服务端吐的兜底，
 * 在数到之前**不水合**——包在里面的钮要等人去点，React 才放弃等服务端、整块改客户端重画。钮放外面，只把角上的数交给这里。
 *
 * 兜底挂着（没水合）的时候，外面重画（点了钮、开了菜单……）不许往这块里送新 props：
 * React 收到更新就放弃等服务端、把这块改成客户端重画（流里随后到的那份作废，要等浏览器这边的 Promise 到了才出数）。
 * 所以 Suspense 那块按 值 记住（children 每次是新函数，不跟着换）；客户端这边数到了（useLate）就不再走 Suspense，
 * 直接按到的值画——那时外面重画照常跟着变。换了新的、还没到的 Promise（refresh）时 useLate 留着旧值，照旧不闪回占位。
 */
function LateSlot<T>({ 值, 占, children }: { 值: 或晚到<T>; 占: T; children: (v: T) => ReactNode }) {
  const 到的 = useLate(值);
  const 等着 = useMemo(
    () => (是晚到(值) ? (
      <Suspense fallback={children(占)}>
        <LateArrived p={值}>{children}</LateArrived>
      </Suspense>
    ) : null),
    // 故意只认 值：见上（兜底没水合时不往里送更新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [值],
  );
  if (!是晚到(值)) return <>{children(值)}</>;
  if (到的 !== null) return <>{children(到的)}</>;
  return 等着;
}
/** 用的时候叫 <晚到>（组件本体用大写英文名，hooks 规则认它是组件） */
export { LateSlot as 晚到 };

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
