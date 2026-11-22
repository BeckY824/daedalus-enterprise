"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownOutlined } from "@ant-design/icons";

/** 离底部多远就算「往上翻了」：小于这个当作还在底上（滚轮最后一下常常差几像素） */
const 算在底 = 40;

/**
 * 首页对话框里「↓ 回到最新」（设计语言 HC-1，用户 11-22 选 C12-A；只现状主题首页问过之后，对话在框里滚时才摆）。
 *
 * 往上翻（离底部超过 40）时输入框上方出一颗圆钮；这时下面又出了新字、或答完了，钮上带一个蓝点；点了滚回最新。
 * 顺手给框头那条细线报信：对话滚过顶，框头下沿出 --line-soft 线（.cli-frame[data-scrolled]）。
 *
 * 一打开一段老对话（或换了一段）先落在最底下——那是最近说到的地方。刚发的那一问由 TurnView 自己顶到框顶，
 * 它的效果先跑（子组件的 effect 先于这里），这里只在「不是刚发」时才去底。
 */
export default function ToLatest({ 刚发: 刚发的 }: { 刚发: boolean }) {
  const 钮 = useRef<HTMLButtonElement>(null);
  const [露, set露] = useState(false);
  const [新, set新] = useState(false);
  const 露着 = useRef(false);
  useEffect(() => {
    const 框 = 钮.current?.closest<HTMLElement>(".cli-frame");
    const log = 框?.querySelector<HTMLElement>(".cli-log");
    if (!框 || !log) return;
    if (!刚发的) log.scrollTop = log.scrollHeight;
    const 看 = () => {
      const 上翻 = log.scrollHeight - log.scrollTop - log.clientHeight > 算在底;
      露着.current = 上翻;
      set露(上翻);
      if (!上翻) set新(false);
      框.toggleAttribute("data-scrolled", log.scrollTop > 0);
    };
    看();
    log.addEventListener("scroll", 看, { passive: true });
    /*
      下面长出新字（流式、答完、新的一轮）：往上翻着的话钮上亮个点。
      步骤条上的秒数每秒在变、回答时间那行也会刷新——那不是新内容（3704 实操 #410：还在查数据、正文一个字没出蓝点就亮了），
      所以只认步骤条（.ais）和时间（.cli-bar-t）以外的变化
    */
    const 不算 = (n: Node) => !!(n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(".ais, .cli-bar-t");
    const mo = new MutationObserver((记录) => {
      if (露着.current && 记录.some((r) => !不算(r.target))) set新(true);
      看();
    });
    mo.observe(log, { childList: true, subtree: true, characterData: true });
    return () => {
      log.removeEventListener("scroll", 看);
      mo.disconnect();
      框.removeAttribute("data-scrolled");
    };
    // 只在挂上时认一次 log：换对话由上面 key 重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
