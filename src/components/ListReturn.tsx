"use client";

/**
 * 列表记住位置（员工反馈 1A，规矩见 lib/list-return.ts）：
 *   - ListMemory：挂在外壳上（AppShell），看着地址栏。在客户列表 / 公海 / 项目页上就记地址、记滚动；
 *     从详情页（或浏览器后退）回到记住的那个地址时滚回去。列表页本身一行不改
 *   - useRailHref：从详情页点左栏「客户」「公海」也回记住的地址（在列表上点照旧回第 1 页、清筛选）
 * 详情页页头那颗「← 回到客户列表（第 N 页）」在 components/BackToList.tsx（不读地址栏，详情页不用多拉 useSearchParams）
 */
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRememberedLists } from "@/components/BackToList";
import { 列表种of, 左栏列表种, 是详情页, 读滚动, 记地址, 记滚动 } from "@/lib/list-return";

/** 当前地址（路径 + 查询串），和 记地址 存的同一个写法 */
function useHereHref() {
  const pathname = usePathname() ?? "";
  const q = useSearchParams()?.toString() ?? "";
  return { pathname, href: q ? `${pathname}?${q}` : pathname };
}

const 现在滚到 = () => window.scrollY || document.scrollingElement?.scrollTop || 0;

/** 地址栏现在的地址，按 useHereHref 的写法规整（空格 %20 / + 这类写法差别不算换了地址） */
function 地址栏() {
  const q = new URLSearchParams(location.search).toString();
  return q ? `${location.pathname}?${q}` : location.pathname;
}

/**
 * 滚回 y：列表的数据可能还在路上（loading 骨架先出来），页面不够高就等，最多 3 秒；
 * 人自己动了（滚轮、触摸、按键、按下鼠标）立刻停，不跟人抢
 */
function 滚回(y: number, 完了: () => void): () => void {
  let 停 = false;
  let 够到了 = 0;
  const 开始 = performance.now();
  const 人动了 = () => (停 = true);
  const 事件 = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  for (const e of 事件) window.addEventListener(e, 人动了, { passive: true, capture: true });
  const 收 = () => {
    for (const e of 事件) window.removeEventListener(e, 人动了, { capture: true });
    完了();
  };
  let 帧 = 0;
  const 一步 = () => {
    if (停 || performance.now() - 开始 > 3000) return 收();
    const 最多 = (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight;
    if (最多 >= y - 1) {
      window.scrollTo(0, y);
      // 到了再看两帧：Next 换页、表格撑开时可能又被顶回去
      if (Math.abs(现在滚到() - y) <= 2 && ++够到了 >= 3) return 收();
    }
    帧 = requestAnimationFrame(一步);
  };
  帧 = requestAnimationFrame(一步);
  return () => {
    停 = true;
    cancelAnimationFrame(帧);
    收();
  };
}

export function ListMemory() {
  const { pathname, href } = useHereHref();
  const 上一页 = useRef<string | null>(null);
  const 后退来的 = useRef(false);
  const 滚回中 = useRef(false);

  useEffect(() => {
    const 记后退 = () => (后退来的.current = true);
    window.addEventListener("popstate", 记后退);
    return () => window.removeEventListener("popstate", 记后退);
  }, []);

  useEffect(() => {
    const 从哪来 = 上一页.current;
    上一页.current = pathname;
    const 后退 = 后退来的.current;
    后退来的.current = false;
    const 种 = 列表种of(pathname);
    if (!种) return;
    记地址(种, href);
    const 老 = 读滚动(种);
    let 取消: (() => void) | undefined;
    if (老 && 老.href === href && 老.y > 0 && (是详情页(从哪来) || 后退)) {
      滚回中.current = true;
      取消 = 滚回(老.y, () => (滚回中.current = false));
    } else {
      记滚动(种, href, 现在滚到());
    }
    // 滚动时记位置（隔 150ms 写一次）。地址已经换走（点进详情那一下页面会被顶回顶上）、正在滚回时不记
    let 定时: number | undefined;
    const 记 = () => {
      if (滚回中.current || 定时 !== undefined) return;
      定时 = window.setTimeout(() => {
        定时 = undefined;
        if (滚回中.current || 地址栏() !== href) return;
        记滚动(种, href, 现在滚到());
      }, 150);
    };
    window.addEventListener("scroll", 记, { passive: true });
    return () => {
      window.removeEventListener("scroll", 记);
      if (定时 !== undefined) window.clearTimeout(定时);
      取消?.();
      滚回中.current = false;
    };
  }, [pathname, href]);

  return null;
}

/** 左栏一项的链接：在详情页上、这种列表记过地址 → 回记住的地址；别的情况照旧 */
export function useRailHref(): (key: string) => string {
  const 地址们 = useRememberedLists();
  const pathname = usePathname();
  const 在详情 = 是详情页(pathname);
  return (key: string) => {
    const 种 = 左栏列表种(key);
    return (在详情 && 种 && 地址们[种]) || key;
  };
}
