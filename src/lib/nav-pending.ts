"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * 跳转等待（跳转优化 PR-A，11-24）：点了一条去别的页 / 换一位客户，新内容还没回来的那段时间。
 *
 * 换客户、列表进详情不再先换成骨架（customers/[id] 那层 loading.tsx 撤了）：旧内容留到新内容就绪，
 * 中间要给人一个「点到了、在开」的信号——顶上一根 2px 的条（components/NavProgress.tsx，慢于 150ms 才出），
 * 加上点的那一行立刻高亮。条只认一个数：此刻有几处在等。
 *
 * 谁在等：
 *   - <Link>：链接里摆一个 <LinkPending />（next/link 的 useLinkStatus），RowLink、左栏都挂了
 *   - router.push / replace：用 useNavGo() 包一层 useTransition，isPending 一直亮到新页提交
 */
let 在等 = 0;
const 听的 = new Set<() => void>();
const 订 = (f: () => void) => {
  听的.add(f);
  return () => void 听的.delete(f);
};

/** 这一处在等（pending 为 true）的时候算一处；卸掉或不等了就减掉 */
export function useReportNavPending(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    在等 += 1;
    听的.forEach((f) => f());
    return () => {
      在等 -= 1;
      听的.forEach((f) => f());
    };
  }, [pending]);
}

/** 此刻有几处在等跳转（服务端渲染时是 0） */
export function useNavPendingCount() {
  return useSyncExternalStore(订, () => 在等, () => 0);
}

/**
 * router.push / replace 换成它：同一个 transition 包着，pending 一直到新页提交，顶上的条跟着亮。
 * `pending` 也给组件自己用（比如表格里点的那一行先高亮）
 */
export function useNavGo() {
  const router = useRouter();
  const [pending, 开始] = useTransition();
  useReportNavPending(pending);
  return useMemo(
    () => ({
      pending,
      push: (href: string, o?: { scroll?: boolean }) => 开始(() => router.push(href, o)),
      replace: (href: string, o?: { scroll?: boolean }) => 开始(() => router.replace(href, o)),
    }),
    [pending, router],
  );
}

type 跳转 = ReturnType<typeof useNavGo>;
const 壳里的 = createContext<跳转 | null>(null);

/**
 * 壳（AppShell）里挂一份一直不卸的 useNavGo（审查补）。弹窗、抽屉、撤销条里发起的跳转用 useShellNavGo：
 * 自己那份 useNavGo 的 pending 挂在弹窗组件上，弹窗一关（关() 在 push 前后都一样，destroyOnHidden / 条件渲染）组件就卸了，
 * 计数跟着减掉，等待条在新页提交之前就没了。壳里这份要到新页提交才撤
 */
export function NavGoProvider({ children }: { children: ReactNode }) {
  const 跳 = useNavGo();
  return createElement(壳里的.Provider, { value: 跳 }, children);
}

/** 弹窗 / 抽屉 / 撤销条里跳页用这个：有壳用壳里那份，没有（单测里单独挂的组件）退回自己的 */
export function useShellNavGo(): 跳转 {
  const 壳 = useContext(壳里的);
  const 自己 = useNavGo();
  return 壳 ?? 自己;
}
