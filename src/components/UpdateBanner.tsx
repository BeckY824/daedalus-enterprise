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
 *
 * 顺带做服务器动作报错的全局兜底（25C，lib/action-error.ts）：哪处调动作没接住报错（unhandledrejection），
 * 认得出的（断网、超时、服务端出错）同一个位置亮一条中文「刚才的操作没成功…」，8 秒后自己收；老版本动作照旧亮刷新那条。
 * 认不出的（不是动作这一层的错）不管，照浏览器默认进控制台。原文进控制台，服务端那头 instrumentation.ts 另记一行
 */
import { useEffect, useRef, useState } from "react";
import { 有新版本话, 旧版本事件, 存好再刷新, 版本变了, 最短间隔毫秒, 定时毫秒 } from "@/lib/stale-deploy";
import { 取现场, 听记位, 恢复滚动, 悄悄换, 装请求计数, 能静默换 } from "@/lib/swap-guard";
import { 全局兜底话, 认动作错 } from "@/lib/action-error";

/** 兜底那条亮多久 */
const 兜底亮毫秒 = 8000;
/** 亮着横幅时多久看一次能不能静默换 */
const 静默检查毫秒 = 5000;

export default function UpdateBanner({ 载入时 }: { 载入时: string | null }) {
  const 起 = useRef(载入时);
  const [亮, set亮] = useState(false);
  const [收起, set收起] = useState(false);
  const [兜底, set兜底] = useState<string | null>(null);

  // 没人接住的动作报错：给一句中文，不露英文（老版本动作由 全局兜底话 点亮上面那条）
  useEffect(() => {
    let 钟 = 0;
    const 接 = (ev: PromiseRejectionEvent) => {
      const 话 = 全局兜底话(ev.reason);
      if (!话) return;
      ev.preventDefault();
      console.error("[动作出错] 没人接住，已给人看一句中文。原文：", ev.reason);
      if (认动作错(ev.reason) === "旧版本") return;
      set兜底(话);
      window.clearTimeout(钟);
      钟 = window.setTimeout(() => set兜底(null), 兜底亮毫秒);
    };
    window.addEventListener("unhandledrejection", 接);
    return () => {
      window.removeEventListener("unhandledrejection", 接);
      window.clearTimeout(钟);
    };
  }, []);

  // 发版换页后恢复滚动位置；非 GET 请求（保存、上传、AI 流）没回完算「忙」，静默换版不打断它们
  useEffect(() => {
    装请求计数();
    恢复滚动();
    return 听记位();
  }, []);

  // 静默换版（PR-C）：亮着横幅、而且后台满 45 秒 / 前台空闲 ≥10 分钟、没有进行中的事 / 弹层 / 未提交录入，就自己换
  useEffect(() => {
    if (!亮) return;
    let 动静 = Date.now();
    let 后台起: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const 动了 = () => {
      动静 = Date.now();
    };
    const 可见变 = () => {
      后台起 = document.visibilityState === "hidden" ? Date.now() : null;
      动静 = Date.now();
    };
    const 动静事件 = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const n of 动静事件) window.addEventListener(n, 动了, { passive: true, capture: true });
    document.addEventListener("visibilitychange", 可见变);
    const 钟 = window.setInterval(() => {
      if (能静默换(取现场(后台起, 动静))) 悄悄换();
    }, 静默检查毫秒);
    return () => {
      for (const n of 动静事件) window.removeEventListener(n, 动了, { capture: true });
      document.removeEventListener("visibilitychange", 可见变);
      window.clearInterval(钟);
    };
  }, [亮]);

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

  if (!亮 || 收起) {
    if (!兜底) return null;
    return (
      <div className="update-bar is-error" role="alert" data-testid="action-error-bar">
        <span className="update-bar-text" title={兜底}>{兜底}</span>
        <button type="button" className="update-bar-x" aria-label="收起" onClick={() => set兜底(null)}>
          ×
        </button>
      </div>
    );
  }
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
