"use client";

import * as 链 from "next/link";
import { useLayoutEffect, useEffect, useRef } from "react";
import { useNavPendingCount, useReportNavPending } from "@/lib/nav-pending";
import { 时长, 曲线CSS } from "@/lib/motion";

/**
 * 顶上那根 2px 的跳转等待条（跳转优化 PR-A）：有一处在等跳转就挂上，CSS 晚 150ms 才淡出来（--nav-wait-delay），
 * 快的跳转一眼都看不见它。一段亮条来回扫（环境动画）；减弱动态时不扫，只淡出一整条（globals.css .nav-prog）
 */
export default function NavProgress() {
  const n = useNavPendingCount();
  if (n === 0) return null;
  return <div className="nav-prog" role="progressbar" aria-label="正在打开" aria-busy="true" data-testid="nav-progress" />;
}

type 链状态 = { pending: boolean };
const 不等: () => 链状态 = () => ({ pending: false });
/*
  测试里 next/link 是一百多份各自的桩（只有 default 导出），具名导入 useLinkStatus 会让 esbuild 打包直接失败；
  命名空间取一次，桩里没有就当永远不在等。真 Next 里一定有（16.x）
*/
const useLinkStatus: () => 链状态 = (链 as unknown as { useLinkStatus?: () => 链状态 }).useLinkStatus ?? 不等;

/**
 * 放在 <Link> 里面：这条链接点了、新页还没到时，顶上的条亮起来，链接里多一个隐藏的 .nav-pend——
 * 名单行、表格行用 `:has(> .nav-pend)` 立刻高亮点的那一行（globals.css）。不等的时候什么都不画
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  useReportNavPending(pending);
  return pending ? <span className="nav-pend" hidden /> : null;
}

/** 服务端没有 layout 阶段，退回 useEffect（只为不报警告） */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 换页时正文淡进来（180ms，只淡不移，减弱动态时一样）。
 *
 * 原来是 `<motion.div key={底下那页}>`：地址一变整块正文按新 key **重挂**——底下的 Suspense 边界跟着新挂，
 * 新挂的边界在 transition 里照样先出骨架，旧内容立刻没了；而且正文里的状态也跟着丢。
 * 现在外框不重挂，只在「底下那页」变了的那一帧（新内容已经提交、还没画出来）给外框补一段透明度动画；
 * 第一次挂上不淡（服务端渲染好的页面不要水合时先变透明再出来）
 */
export function PageFade({ 页, className, style, children }: { 页: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const 框 = useRef<HTMLDivElement>(null);
  const 上次 = useRef(页);
  useIsoLayoutEffect(() => {
    if (上次.current === 页) return;
    上次.current = 页;
    const el = 框.current;
    if (!el || typeof el.animate !== "function") return;
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 时长.base * 1000, easing: 曲线CSS.ease });
    return () => a.cancel();
  }, [页]);
  return (
    <div ref={框} className={className ? `page-fade ${className}` : "page-fade"} style={style} data-page={页}>
      {children}
    </div>
  );
}
