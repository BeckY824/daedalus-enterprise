"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * 整页预取（10-27，企业版要上云服务器）。
 *
 * 服务端出页只要十几到几十毫秒，慢的是来回：本机看不出，放到云上每点一下都要等一趟网络。
 * Link 默认的预取只取到 loading.tsx 那层骨架，点进去还要再跑一趟拿数据；整页预取把数据也一起取回来，
 * 点下去直接从本地出页。取回的页按 next.config 的 staleTimes.static（60 秒）算新鲜，过了照常再问服务器。
 *
 * 只在人「要点了」的时候取：悬停停住一小会儿（扫过去的不算）、左栏空闲时预热那几项。
 * 列表一屏几十行，不能一进视口就全取（见 ui.tsx RowLink）。
 */
export const 整页 = PrefetchKind.FULL;

/** 悬停多久算「要点了」：鼠标从表格上扫过去，每行只停十几毫秒 */
const 停住 = 70;

/** 系统开了省流量就不预取：省下的是对方的流量，不该替人花 */
export function 省流量() {
  if (typeof navigator === "undefined") return true;
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

/**
 * 整页取一个地址。取不到不报错：预取只是提速，失败了点下去照常走服务器；
 * 测试里假的 router 也没有 prefetch
 */
export function 整页预取(router: ReturnType<typeof useRouter>, href: string) {
  if (typeof router.prefetch !== "function") return;
  try {
    router.prefetch(href, { kind: 整页 });
  } catch {
    // 同上：不碍事
  }
}

/** 悬停预取：进 = onMouseEnter / onFocus，出 = onMouseLeave / onBlur */
export function useHoverPrefetch() {
  const router = useRouter();
  const 等 = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(等.current), []);
  const 进 = useCallback(
    (href: string | null | undefined) => {
      clearTimeout(等.current);
      if (!href || 省流量()) return;
      等.current = setTimeout(() => 整页预取(router, href), 停住);
    },
    [router],
  );
  const 出 = useCallback(() => clearTimeout(等.current), []);
  return { 进, 出 };
}
