"use client";
/**
 * 全局 AI 面板。任何页面 ⌘J 拉出来，或者点右上角那枚常驻按钮。
 *
 * **形不是新发明的**：客户记录页早就是一个 `Drawer placement="right"`（380 宽），
 * 这里只是把它提到全局，并且把三种入口（首页整页 / 记录页常驻 + 抽屉 / 其余九页没有）
 * 收成一种。参考「Day844｜嵌入式 AI 对话界面动效」里右侧那一列 AI Inbox。
 *
 * 四条规矩：
 *   1. **导航稳定**——左栏一格不动。面板从右边推进来，正文收窄，不遮挡。
 *   2. **上下文看得见、点得掉**——顶上一行写明它带了什么，旁边一个 ×。
 *      一个隐形的上下文，答歪了没人解释得清为什么。
 *   3. 首页不出现它：首页本身就是宽模式的同一块东西，两处同时画会共用同一条对话、互相打架。
 *   4. 动效只用四档时长；减弱动态时不位移（globals.css 里 .dock 那几条）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { usePageUnderOverlay } from "@/lib/page-under-overlay";
import { CloseOutlined, MinusOutlined } from "@ant-design/icons";
import WidthHandle, { 面板把手 } from "./WidthHandle";
import DockThreads from "./DockThreads";
import HomeChat, { type Suggestion } from "@/app/(app)/dashboard/HomeChat";
import type { ModelOption } from "@/lib/llm";
import { useBusiness } from "@/lib/business-client";
import { 认页面 } from "@/lib/ai-context-page";
import { 订阅页面行, 读页面行, 读详情名 } from "@/lib/page-rows";
import { useThread } from "@/lib/home-thread";
import { useRunningKey } from "@/lib/ai-jobs";
import { 登记打开AI浮窗, 订阅智能总结, 有智能总结, 打开智能总结 } from "@/lib/ai-float";
import type { 快捷项 } from "./AiQuickAsks";

/** 服务端快照。固定一个引用，useSyncExternalStore 才不会每次都当成变了 */
const 空名单: string[] = [];

export default function AiDock({
  userName,
  models,
  开着,
  set开着,
  企业版 = false,
  浮窗 = false,
}: {
  userName: string;
  models: ModelOption[];
  /**
   * 开合状态**由壳持有**，不在这儿。因为正文宽度跟着它变，壳要据此调响应式断点
   * （见 globals.css 的 .shell-dock-open）。放在这儿再用 effect 往上报的话，
   * 就成了「effect 里同步 setState」——级联渲染，eslint 直接报错。
   */
  开着: boolean;
  set开着: (开: boolean) => void;
  /** 企业版（经 AppShell 传下来）：回答里提到的客户不摆「起草转介绍邀请」 */
  企业版?: boolean;
  /**
   * 浮窗模式（P-界面-39，企业版项目模式）：不占右边一栏，点右下角浮标在页面中下方长出毛玻璃对话框，
   * 右上角「−」收起回球。收起时不卸载（只藏起来、inert），正在跑的那一问接着跑，再点球原样回来
   */
  浮窗?: boolean;
}) {
  /*
    不是地址栏：设置浮层开着时地址栏是 /settings，而底下还是刚才那页。
    照地址栏判断的话，从首页开设置，这块面板会在浮层后面冒出来（首页本来不出现它），
    上下文和对话范围也会跳到「设置」上。见 lib/page-under-overlay.ts
  */
  const pathname = usePageUnderOverlay();
  const params = useSearchParams();
  /**
   * 用户在**哪一页**把上下文点掉了。存页面而不是存布尔值：
   * 换一页就自动重新带上（那是新的一页，不是他刚才拒绝的那个），
   * 不需要一个「pathname 变了就 setState」的 effect。
   */
  const [不带上下文的页, set不带上下文的页] = useState<string | null>(null);
  const 不带上下文 = 不带上下文的页 === pathname;
  /**
   * 浮窗：这一页打开过没有。没开过不挂 HomeChat（每页都挂一份没必要）；开过之后「−」只藏不卸。
   * 用「渲染时按上一次的值调整」的写法（React 文档那一种），不是 effect 里 setState
   */
  const [开过的页, set开过的页] = useState<string | null>(null);
  if (浮窗 && 开着 && 开过的页 !== pathname) set开过的页(pathname);
  /** 浮窗：点了页面别处，对话缩成一行摘要压在输入框上（ai.away）；点「展开」或再问一句就恢复 */
  const [收拢, set收拢] = useState(false);
  const 这屏 = useThread(pathname);
  const 在跑 = useRunningKey(这屏.map((t) => `home:${t.id}`)) != null;
  const [上次轮数, set上次轮数] = useState(这屏.length);
  if (上次轮数 !== 这屏.length) {
    set上次轮数(这屏.length);
    if (收拢) set收拢(false); // 又问了一句：对话长回来
  }
  const 有对话 = 这屏.length > 0;

  /*
    浮窗开着时把它的实际高写到 <html> 的 --ai-float-h：正文底下按这个高让位（globals.css 的 .dock-float 段），
    滚到底的分页、最后一行按钮停在浮窗上面。输入框态、缩成一行、长成对话三种高不一样，所以量，不写死
  */
  const 浮窗框 = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = 浮窗框.current;
    if (!浮窗 || !开着 || !el) return;
    const 根 = document.documentElement.style;
    const 量 = () => 根.setProperty("--ai-float-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    量();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(量);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      根.removeProperty("--ai-float-h");
    };
  }, [浮窗, 开着, 开过的页]);

  // 页里的按钮（客户页页头「AI」）叫浮窗出来，见 lib/ai-float.ts
  useEffect(() => (浮窗 ? 登记打开AI浮窗(() => set开着(true)) : undefined), [浮窗, set开着]);

  // 点页面别处（正文、左栏）：对话缩成一行。弹层（下拉、确认框）挂在 body 上，不在正文里，点它们不算「别处」
  useEffect(() => {
    if (!浮窗 || !开着 || 收拢 || !有对话) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".main, .rail")) set收拢(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [浮窗, 开着, 收拢, 有对话]);

  /*
    ⌘J / Ctrl+J 开关。在输入框里也认——它开的是另一块地方，不抢当前输入。

    **Esc 不关面板**（2026-09-19 用户要求，而且它本来就是个 bug）：
    面板是常驻的一栏，不是弹层——弹层按 Esc 关，一栏不该。
    更硬的理由是 Esc 在面板里**已经有主人**：答案正在流的时候它是「打断」
    （HomeChat 里那句 `Escape && running → cancelStream`，输入框下面也写着「Esc 打断」）。
    两个处理器听同一个键，于是想按 Esc 停下一个跑偏的回答，会连面板一起收掉——
    人失去的不只是那一栏，还有刚才那半截回答的上下文。
    要关有两条路：⌘J，或者面板右上角那个 ×。两条都是明确说「我要关它」。
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        set开着(!开着);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [开着, set开着]);

  // 这一页上列着的名字（DataList 登记的）。Hook 要在早退之前调，顺序每次一样
  const b = useBusiness();
  const 可见行 = useSyncExternalStore(订阅页面行, 读页面行, () => 空名单);
  // 记录页上这条记录叫什么（RecordView 登记的）
  const 详情名 = useSyncExternalStore(订阅页面行, 读详情名, () => null);

  /** 客户页挂着「生成智能总结」的原抽屉没有（lib/ai-float.ts）：有才摆「总结这位客户」 */
  const 能总结 = useSyncExternalStore(订阅智能总结, 有智能总结, () => false);

  // 首页就是宽模式的它，不在那儿再开一块
  if (pathname === "/dashboard") return null;

  const 上下文 = 认页面(pathname, params, 详情名, 可见行, b);

  /*
    收起时这里什么都不画：入口在左栏底部那一行「问一句 ⌘J」（AppShell）。
    第一版是 position:fixed 的药丸，正好压在每个列表页右上角的「新建」上；
    第二版改成右边 44px 的窄边，不压东西了，可 13、14 寸笔记本上它把每张表格挤掉最右一列
    （1120 宽时客户表的负责人、跟进表的时间，2026-09-28 核对教程时看到）。放进左栏两头都不占。
  */
  if (浮窗) {
    if (!开着 && 开过的页 !== pathname) return null;
    const 收起 = () => {
      set收拢(false);
      set开着(false);
    };
    const 上一问 = 这屏[这屏.length - 1]?.question ?? "";
    /*
      客户页（dt.ai）空屏三颗快捷项。「总结这位客户」= 原来的「生成智能总结」：打开客户页那个抽屉，
      扣额度、确认都在 AiPanel 里照旧，浮窗不另起一次；另两颗把问句交给输入框直接发
    */
    const 客户页 = /^\/customers\/[^/]+$/.test(pathname) && 详情名 ? 详情名 : null;
    const 快捷: 快捷项[] | undefined = 客户页
      ? [
          // 抽屉从右边出来，浮窗先收回球，不叠在一起
          ...(能总结 ? [{ label: "总结这位客户", 动作: () => { if (打开智能总结()) 收起(); } }] : []),
          { label: "起草跟进话术", 问: `给${客户页}起草一段跟进话术` },
          { label: "现在卡在哪", 问: `${客户页}现在卡在哪？` },
        ]
      : undefined;
    return (
      <aside
        ref={浮窗框}
        className={`dock dock-float${开着 ? "" : " is-min"}${收拢 && 有对话 ? " is-folded" : ""}${有对话 ? " has-turns" : ""}`}
        aria-label="AI 对话"
        aria-hidden={!开着}
        inert={!开着}
        onKeyDown={(e) => {
          // Esc：答案在流时归 HomeChat（打断）；没在跑才缩成一行
          if (e.key === "Escape" && !在跑 && 有对话 && !e.defaultPrevented) set收拢(true);
        }}
      >
        <div className="dock-h dock-float-h">
          {上下文 && !不带上下文 ? (
            <span className="dock-float-ctx" key={上下文.标签}>
              <span className="dock-ctx-n">{上下文.标签}</span>
              <button type="button" className="dock-ctx-x" onClick={() => set不带上下文的页(pathname)} aria-label="不带这一页的上下文">
                <CloseOutlined />
              </button>
            </span>
          ) : (
            <b>问一句</b>
          )}
          <span className="dock-float-sp" />
          <DockThreads scope={pathname} />
          <button type="button" className="dock-x dock-float-min" onClick={收起} aria-label="收起 AI 对话" title="收起">
            <MinusOutlined />
          </button>
        </div>
        {收拢 && 有对话 && (
          <button type="button" className="dock-float-peek" onClick={() => set收拢(false)} aria-label="展开对话">
            <span className="dock-float-peek-dot" aria-hidden="true" />
            <span className="dock-float-peek-t">{上一问}</span>
            <span className="dock-float-peek-go">展开</span>
          </button>
        )}
        <div className="dock-body">
          <HomeChat
            模式="窄"
            上下文提示={上下文 && !不带上下文 ? 上下文.提示 : undefined}
            上下文范围={上下文 && !不带上下文 ? 上下文.范围 : undefined}
            scope={pathname}
            标题前缀={上下文?.名}
            会话={null}
            userName={userName}
            suggestions={[] as Suggestion[]}
            context=""
            models={models}
            空库={false}
            企业版={企业版}
            空屏快捷={快捷}
          />
        </div>
      </aside>
    );
  }

  if (!开着) return null;

  return (
    <aside className="dock" aria-label="AI 面板">
      {/* 左边那条能拖的缝。和左栏同一个组件，只是往左拖才变宽——它贴着窗口右缘 */}
      <WidthHandle 规格={面板把手} />
      <div className="dock-h">
        <b>问一句</b>
        {/*
          新对话 / 历史。面板那一屏是纯内存的，重开应用就没了——而首页有中栏
          那条列表可以翻，面板没有：在这一页问过的话，换一次页就再也找不回来，
          尽管它一直好好地躺在库里。历史只列**在这一页**问过的（scope）。
        */}
        <DockThreads scope={pathname} />
        <button type="button" className="dock-x" onClick={() => set开着(false)} aria-label="关闭 AI 面板">
          <CloseOutlined />
        </button>
      </div>
      {/* 上下文条：它带了什么，写出来；不想带就点掉 */}
      {上下文 && !不带上下文 && (
        <div className="dock-ctx">
          <span className="dock-ctx-n">{上下文.标签}</span>
          <button type="button" className="dock-ctx-x" onClick={() => set不带上下文的页(pathname)} aria-label="不带这一页的上下文">
            <CloseOutlined />
          </button>
        </div>
      )}
      <div className="dock-body">
        <HomeChat
          模式="窄"
          上下文提示={上下文 && !不带上下文 ? 上下文.提示 : undefined}
          上下文范围={上下文 && !不带上下文 ? 上下文.范围 : undefined}
          /*
            **一页一屏，不是全局一份。** 2026-09-19 报上来的：在线索页问一句，
            换到客户页、回到首页，那一问那一答跟着到处走——因为这个组件在每一页
            都渲染同一个 HomeChat，而 home-thread 原来就一份 `let turns`。
            scope 给 pathname：各页各一屏，互不相干；落库仍走同一张表，
            所以首页那条列表照样看得到在哪一页问过什么。
          */
          scope={pathname}
          标题前缀={上下文?.名}
          会话={null}
          userName={userName}
          suggestions={[] as Suggestion[]}
          context=""
          models={models}
          空库={false}
          企业版={企业版}
        />
      </div>
    </aside>
  );
}
