"use client";

/**
 * 发过版了、这一页还是老的（lib/stale-deploy.ts）：顶上一条细横幅「系统刚更新了，刷新一下再继续」+「刷新」。
 * 不挡操作（浮在顶上正中，同切换视图那条的样子），可以先收起；收起后再撞上老版本动作还会亮。
 *
 * 什么时候问 /api/version：切回这个窗口（focus）、切回这个标签页（visibilitychange → visible）、开着不动每 5 分钟；
 * 两次之间至少隔 30 秒，标签页在后台不问。**打开页面那一下不问**：编号是这一次渲染时服务端给的，刚拿到不可能不一样，
 * 计时从打开那刻算起，打开后马上来的 focus 也不问。
 * 载入时的编号只认第一次（useRef）：之后 router.refresh() 带回来的是新服务端的编号，拿它比就永远「一样」了。
 * 载入时没有编号（读不到 BUILD_ID）就整个不问，只听「撞上老版本动作」那一声。
 * 认出换了版本之后不再问（多进程升级途中别来回闪）。
 */
import { useEffect, useRef, useState } from "react";
import { 有新版本话, 旧版本事件, 存好再刷新, 版本变了, 最短间隔毫秒, 定时毫秒 } from "@/lib/stale-deploy";

export default function UpdateBanner({ 载入时 }: { 载入时: string | null }) {
  const 起 = useRef(载入时);
  const [亮, set亮] = useState(false);
  const [收起, set收起] = useState(false);

  useEffect(() => {
    const 点亮 = () => {
      set亮(true);
      set收起(false);
    };
    window.addEventListener(旧版本事件, 点亮);
    const 初 = 起.current;
    if (!初) return () => window.removeEventListener(旧版本事件, 点亮);

    let 上次 = Date.now();
    let 问着 = false;
    let 认出了 = false;
    const 问 = async (到点: boolean) => {
      if (认出了 || 问着 || document.visibilityState === "hidden") return;
      if (!到点 && Date.now() - 上次 < 最短间隔毫秒) return;
      上次 = Date.now();
      问着 = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) return;
        if (版本变了(初, await r.json())) {
          认出了 = true;
          点亮();
        }
      } catch {
        /* 断网、重启途中：这次不算，下次再问 */
      } finally {
        问着 = false;
      }
    };
    const 切回窗口 = () => void 问(false);
    const 切回标签 = () => {
      if (document.visibilityState === "visible") void 问(false);
    };
    window.addEventListener("focus", 切回窗口);
    document.addEventListener("visibilitychange", 切回标签);
    const 钟 = window.setInterval(() => void 问(true), 定时毫秒);
    return () => {
      window.removeEventListener(旧版本事件, 点亮);
      window.removeEventListener("focus", 切回窗口);
      document.removeEventListener("visibilitychange", 切回标签);
      window.clearInterval(钟);
    };
  }, []);

  if (!亮 || 收起) return null;
  return (
    <div className="update-bar" role="status" data-testid="update-bar">
      <span className="update-bar-text">{有新版本话}</span>
      <button type="button" className="update-bar-go" onClick={存好再刷新}>
        刷新
      </button>
      <button type="button" className="update-bar-x" aria-label="先收起" onClick={() => set收起(true)}>
        ×
      </button>
    </div>
  );
}
