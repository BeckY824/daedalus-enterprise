"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownOutlined } from "@ant-design/icons";

/** 离底部多远就算「往上翻了」：小于这个当作还在底上（滚轮最后一下常常差几像素） */
const 算在底 = 40;

/**
 * 首页对话框里「↓ 回到最新」（设计语言 HC-1，用户 11-22 选 C12-A；只现状主题首页问过之后，对话在框里滚时才摆）。
 *
 * 往上翻（离底部超过 40）时输入框上方出一颗圆钮；这时下面又出了新字、或答完了，钮上带一个蓝点；点了滚回最新。
 * 顺手给框头那条细线报信：对话滚过顶，框头下沿出 --line-soft 线（.cli-frame[data-scrolled]）。
 *
 * 一打开一段老对话（或换了一段，HomeChat 按对话 id 换 key 重挂）落在最底下——那是最近说到的地方。
 * **不能只在挂上那一刻落一次**（3703 实操 #410：列表里先点短对话、再点长对话，scrollTop 沿用上一段或停在 0、还冒「↓」带蓝点）：
 * 换对话时新内容是后到的（库里读回来再装进这一屏、卡片 / 表格 / 正文再各自长高），挂上那一刻量到的还是旧内容或空。
 * 所以挂上之后进「贴底」：内容每长一次（MutationObserver 认结构 / 字，ResizeObserver 认高度）就再落一次底，
 * 直到人自己动了——往上翻、在框里点 / 按键（发问、重试、改名都算），或者刚发了一问。贴底期间长出来的不算「下面有新内容」，不亮蓝点。
 *
 * 刚发的那一问由 TurnView 自己顶到框顶（离顶 14），它的效果先跑（子组件的 effect 先于这里），这里「刚发」时不贴底、也不去底；
 * 人往上翻之后流式回答照旧不拽他（首页框里本来就不跟）。
 */
/**
 * ToLatest 的 key：换一段对话就换（重挂、落底），**新对话第一问答完认领上 id 那一下不换**。
 *
 * 认领 = 对话 id 从空变成真 id、屏上还是刚问的那几轮（刚发的那一问还在）。那一下按 id 换 key 会重挂，
 * 人正往上翻着看时「↓」上的蓝点就丢了（HC-1 3703 实操补点）。从一屏新对话（还没认领）直接点列表里另一段，
 * 那几轮整个换掉、刚发的不在了，照样算换对话。
 */
export function useToLatestKey(对话id: string | null, 刚发在屏: boolean): string {
  const [记, set记] = useState<{ id: string | null; n: number; 键: string }>(() => ({ id: 对话id, n: 0, 键: 对话id ?? "new0" }));
  if (记.id === 对话id) return 记.键;
  const 认领 = 记.id === null && 对话id !== null && 刚发在屏;
  const 新记 = { id: 对话id, n: 记.n + 1, 键: 认领 ? 记.键 : (对话id ?? `new${记.n + 1}`) };
  // 渲染中按上一次的值调状态（React 认的写法）：这一次就用新键，不先拿旧键画一遍
  set记(新记);
  return 新记.键;
}

export default function ToLatest({ 刚发: 刚发的 }: { 刚发: boolean }) {
  const 钮 = useRef<HTMLButtonElement>(null);
  const [露, set露] = useState(false);
  const [新, set新] = useState(false);
  const 露着 = useRef(false);
  /** 还在「刚打开、跟着内容落底」：挂上时不是刚发就进，人一动、或刚发了一问就出，出了不再回来（换对话由 key 重挂） */
  const 贴底 = useRef(!刚发的);
  // 用 layout effect：同一次提交里新一轮的 DOM 已经插上，MutationObserver 的回调（微任务）跑之前先把贴底关掉
  useLayoutEffect(() => {
    if (刚发的) 贴底.current = false;
  }, [刚发的]);
  useEffect(() => {
    const 框 = 钮.current?.closest<HTMLElement>(".cli-frame");
    const log = 框?.querySelector<HTMLElement>(".cli-log");
    if (!框 || !log) return;
    const 离底 = () => log.scrollHeight - log.scrollTop - log.clientHeight;
    /** 上一次看见的 scrollTop：贴底时 scrollTop 变小、又不在底上，才是人往上翻（内容长高不动 scrollTop；内容缩短被夹回去时还在底上） */
    let 上次 = log.scrollTop;
    const 落底 = () => {
      if (!贴底.current) return;
      log.scrollTop = log.scrollHeight;
      上次 = log.scrollTop;
    };
    const 看 = () => {
      const 上翻 = 离底() > 算在底;
      露着.current = 上翻;
      set露(上翻);
      if (!上翻) set新(false);
      框.toggleAttribute("data-scrolled", log.scrollTop > 0);
    };
    落底();
    看();
    const 滚 = () => {
      if (贴底.current) {
        if (log.scrollTop < 上次 - 1 && 离底() > 2) 贴底.current = false;
        else 落底();
      }
      上次 = log.scrollTop;
      看();
    };
    log.addEventListener("scroll", 滚, { passive: true });
    /* 人在框里点了 / 按了键（发问、重试、点卡片、改名……）：从此按他的来，不再贴底（流式回答不拽人，C12-A） */
    const 动了 = () => {
      贴底.current = false;
    };
    框.addEventListener("pointerdown", 动了, true);
    框.addEventListener("keydown", 动了, true);
    /* 高度长出来（卡片、表格、图、正文排版后变高）不一定有 DOM 变化：每一轮各看一份高度，框自己变高变矮也看 */
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      落底();
      看();
    });
    ro?.observe(log);
    for (const c of Array.from(log.children)) ro?.observe(c);
    /*
      下面长出新字（流式、答完、新的一轮）：往上翻着的话钮上亮个点。
      步骤条上的秒数每秒在变、回答时间那行也会刷新——那不是新内容（3704 实操 #410：还在查数据、正文一个字没出蓝点就亮了），
      所以只认步骤条（.ais）和时间（.cli-bar-t）以外的变化
    */
    const 不算 = (n: Node) => !!(n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(".ais, .cli-bar-t");
    const mo = new MutationObserver((记录) => {
      for (const r of 记录) {
        if (r.target !== log) continue;
        r.addedNodes.forEach((n) => {
          if (n.nodeType === 1) ro?.observe(n as Element);
        });
      }
      if (贴底.current) 落底();
      else if (露着.current && 记录.some((r) => !不算(r.target))) set新(true);
      看();
    });
    mo.observe(log, { childList: true, subtree: true, characterData: true });
    return () => {
      log.removeEventListener("scroll", 滚);
      框.removeEventListener("pointerdown", 动了, true);
      框.removeEventListener("keydown", 动了, true);
      ro?.disconnect();
      mo.disconnect();
      框.removeAttribute("data-scrolled");
    };
    // 只在挂上时认一次 log：换对话由 HomeChat 按对话 id 换 key 重挂
  }, []);
  return (
    <div className="cli-latest">
      <button
        ref={钮}
        type="button"
        className={`cli-latest-b${新 ? " has-new" : ""}`}
        hidden={!露}
        aria-label={新 ? "回到最新（下面有新内容）" : "回到最新"}
        onClick={() => {
          const log = 钮.current?.closest(".cli-frame")?.querySelector<HTMLElement>(".cli-log");
          log?.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
          set新(false);
        }}
      >
        <ArrowDownOutlined />
      </button>
    </div>
  );
}
