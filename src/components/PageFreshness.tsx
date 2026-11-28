"use client";

/**
 * 先出缓存、后台更新（跳转优化 PR-D，lib/page-fresh.ts）。
 *
 * 客户端路由缓存调到 300 秒后，切回刚看过的页直接出缓存。这里补「别拿老数据当新的」：
 *   1. 切到客户详情 / 项目详情 / 客户列表、或切回标签页：问 /api/page-version（一个短哈希），和「这页渲染时服务端下发的版本」
 *      （components/RenderedVersion）比，不同 → router.refresh() 后台换新；相同不动，不清别页缓存。
 *      预取 / 预热进来的页、缓存里放了几分钟的页，都照样比得出来（不再用客户端的「取于」猜缓存年龄）。
 *   2. 没纳入的页（公海、看板、首页、跟进计划、项目列表、线索……）：保持以前 60 秒缓存的效果——按路径记上次取的时刻，
 *      回来距上次超过 60 秒（没到 300 秒，到了 Next 自己重取）就 router.refresh()；60 秒内不刷。
 *   3. 收到数据失效事件（通知铃铛发现来了新通知：分到我 / 转走 / 权限变了）：后台换新当前页（router.refresh 同时清掉别页缓存，
 *      下次切过去等新数据）。被转走的客户换新后由服务端那页判，走原来的「无权」卡，前端不判权限。
 *      兜底前先看导航是不是刚带来新数据（Next 对过期缓存条目自己重取过一次非预取 RSC）：是就不再补刷，回 A 只出 1 个请求；
 *      版本不同、数据失效事件照刷，不看这条。
 *   4. 弹层开着、输入框有焦点、有未提交录入、有请求没回完（swap-guard 现在忙）：不刷，每 5 秒再看一次，最多等 2 分钟，
 *      等不到就放弃这次（人下次切页时还会再判）。
 * 问版本失败（断网、登出、没基线）一律当没变，不报错。在飞按页面键记（A 页的请求没回时切到 B 页，B 照样查）。
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { 版本地址, 认页面, 页面键, 数据失效事件, 该后台刷新, 该兜底刷新, 该合并跳过, 该走兜底, 清旧记录, 取渲染版, 缓存秒, 导航已取新, 取导航取, 装取数记录 } from "@/lib/page-fresh";
import { 现在忙 } from "@/lib/swap-guard";

const 重试毫秒 = 5000;
const 最多等毫秒 = 2 * 60_000;

export default function PageFreshness() {
  const router = useRouter();
  const 路径 = usePathname();
  const 查询 = useSearchParams().toString();
  /** 上一次 effect 跑时的路径（查询变、路径没变 = 点筛选：只记不刷） */
  const 上路径 = useRef<string | null>(null);
  /** 没纳入的页：路径+查询 → 上次取这页的时刻（到过就记，刷过重记；60 秒内回来不动，不更新，才贴近「缓存取于」） */
  const 到过们 = useRef(new Map<string, number>());
  /** 正在问版本的页（按页面键，切页不拦新页的检查） */
  const 在飞 = useRef(new Set<string>());
  const 待刷钟 = useRef(0);
  /** 上次真刷新的时刻（几路同时要刷、两份铃铛各发一次，2 秒内只刷一次） */
  const 上次刷 = useRef(0);
  const 路由 = useRef(router);
  useEffect(() => {
    路由.current = router;
  }, [router]);

  /** 能刷就刷，忙就隔 5 秒再看，最多等 2 分钟 */
  const 空了刷 = useRef((起: number, 页记键?: string) => {
    window.clearTimeout(待刷钟.current);
    // 兜底刷新（页记键 = 路径?查询）：导航刚带来新数据（Next 重取过期条目）就不再补一次；判忙推迟后再看一遍
    if (页记键 !== undefined && 导航已取新(取导航取(页记键), 起)) return;
    if (!现在忙()) {
      if (该合并跳过(上次刷.current, Date.now())) return;
      上次刷.current = Date.now();
      路由.current.refresh();
      return;
    }
    if (Date.now() - 起 >= 最多等毫秒) return;
    待刷钟.current = window.setTimeout(() => 空了刷.current(起, 页记键), 重试毫秒);
  });

  useEffect(() => {
    装取数记录();
    const 现在 = Date.now();
    const 同路径换查询 = 上路径.current === 路径;
    // 路径变了：上次刷的合并窗口清掉，新页的检查不被上一页的刷新挡住
    if (!同路径换查询) 上次刷.current = 0;
    上路径.current = 路径;
    const 页 = 认页面(路径, 查询);
    // 到过的记录：键 = 路径+查询（点筛选换查询是另一页）。返回「上次到的时刻」，同时按规矩记新的
    const 记到过 = (): number | undefined => {
      const 们 = 到过们.current;
      清旧记录(们, 现在);
      const 记键 = `${路径}?${查询}`;
      const 上次 = 们.get(记键);
      if (上次 === undefined || 现在 - 上次 >= 缓存秒 * 1000) 们.set(记键, 现在);
      return 上次;
    };
    const 兜底 = (上次: number | undefined, 现 = Date.now()) => {
      if (该兜底刷新(上次, 现)) {
        到过们.current.set(`${路径}?${查询}`, 现);
        空了刷.current(现, `${路径}?${查询}`);
      }
    };
    if (!页) {
      // 没纳入的页：兜底，保持 60 秒缓存的效果；第一次去的「路径+查询」没记录，不会刷
      const 上次 = 记到过();
      兜底(上次, 现在);
      return;
    }
    // 纳入的页也记到过：渲染版和现版都是 gone（没有可比的基线）时走 60 秒兜底
    记到过();
    const 键 = 页面键(页);
    let 还在 = true;
    const 问 = async () => {
      if (在飞.current.has(键) || document.visibilityState !== "visible") return;
      在飞.current.add(键);
      try {
        const r = await fetch(版本地址(页), { cache: "no-store", headers: { accept: "application/json" } });
        if (!r.ok || !(r.headers.get("content-type") ?? "").includes("application/json")) return;
        const 现版 = ((await r.json()) as { v?: string | null }).v ?? null;
        if (!还在 || !现版) return;
        const 渲染版 = 取渲染版(键);
        if (该后台刷新(渲染版, 现版)) 空了刷.current(Date.now());
        else if (该走兜底(渲染版, 现版)) 兜底(到过们.current.get(`${路径}?${查询}`));
      } catch {
        // 断网、登出：当没变
      } finally {
        在飞.current.delete(键);
      }
    };
    void 问();
    const 回来 = () => {
      if (document.visibilityState === "visible") void 问();
    };
    document.addEventListener("visibilitychange", 回来);
    return () => {
      还在 = false;
      document.removeEventListener("visibilitychange", 回来);
    };
  }, [路径, 查询]);

  useEffect(() => {
    const 失效 = () => {
      // 缓存里的页都不可信了：到过的记录清掉，换新后重新记
      到过们.current.clear();
      空了刷.current(Date.now());
    };
    window.addEventListener(数据失效事件, 失效);
    return () => {
      window.removeEventListener(数据失效事件, 失效);
      window.clearTimeout(待刷钟.current);
    };
  }, []);

  return null;
}
