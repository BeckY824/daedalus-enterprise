"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 中栏名单在后台换新（跳转优化 PR-A 审查补）。
 *
 * 名单挪进 @pane/{customers,projects}/(detail)/layout.tsx 以后，换一位客户只换 [id]，名单不重挂也不重查——
 * 好处是不闪、搜的字和滚动都在；代价是名单只在进详情、router.refresh 时才查，开着一下午就旧了
 * （别人新跟进的、刚分给我的不在上面）。这里补两种时机，名单自己去拉一份新的（/api/roster/…，和服务端同一个函数）：
 *   1. 切回这个标签页（visibilitychange → visible）：人离开过，什么都可能变了
 *   2. 距上次查名单超过 60 秒、又换了一位：连着翻的时候不打扰（60 秒内换人一律不拉）
 * 不用 router.refresh：它会清掉整个路由缓存（预取的页、后退要用的都没了，next/dist/client/components/router-reducer/reducers/refresh-reducer.js），
 * 为一条名单不值得。拉回来之前照旧显示手上那份；拉失败（断网、登出）就留着旧的，不报错。
 * 服务端又给了新的一份（保存后 router.refresh、整页重进）就以服务端那份为准，计时从头算
 */
export const 名单过期毫秒 = 60_000;

export function useFreshRoster<T>(服务端给的: T, 地址: string, 当前那位: string): T {
  const [拉来的, set拉来的] = useState<{ 基于: T; 是: T } | null>(null);
  const 上次 = useRef(0);
  const 在拉 = useRef(false);
  const 最新给的 = useRef(服务端给的);
  useEffect(() => {
    最新给的.current = 服务端给的;
    上次.current = Date.now();
  }, [服务端给的]);

  const 拉 = useCallback(async () => {
    if (在拉.current) return;
    在拉.current = true;
    const 基于 = 最新给的.current;
    try {
      const r = await fetch(地址, { cache: "no-store", headers: { accept: "application/json" } });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("application/json")) return;
      const 是 = (await r.json()) as T;
      上次.current = Date.now();
      // 拉的这段时间里服务端又给了新的（router.refresh）：那份更新，这份不要
      if (最新给的.current === 基于) set拉来的({ 基于, 是 });
    } catch {
      // 断网、登出：留着手上那份
    } finally {
      在拉.current = false;
    }
  }, [地址]);

  useEffect(() => {
    const 回来 = () => {
      if (document.visibilityState === "visible") void 拉();
    };
    document.addEventListener("visibilitychange", 回来);
    return () => document.removeEventListener("visibilitychange", 回来);
  }, [拉]);

  const 上一位 = useRef(当前那位);
  useEffect(() => {
    if (上一位.current === 当前那位) return;
    上一位.current = 当前那位;
    if (Date.now() - 上次.current > 名单过期毫秒) void 拉();
  }, [当前那位, 拉]);

  return 拉来的 && 拉来的.基于 === 服务端给的 ? 拉来的.是 : 服务端给的;
}
