"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import { categorical, palette } from "@/lib/palette";
import { 阶段们 } from "@/lib/project/nodes";
import type { 阶段字典 } from "@/lib/project/stage-dict";

/** 三大阶段的颜色，和数据页项目统计（overview/ProjectStatsView.tsx）同一套 */
export const 阶段色: Record<string, string> = { 线索: categorical.cyan, 商机: palette.brand, 订单: categorical.green };

/** 服务端渲染时没有 layout 阶段，退回 useEffect（只是为了不报警告，浮片在浏览器里才量） */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 走过的小勾：一笔描出来（stroke-dashoffset），减弱动态时直接画好 */
const 勾 = <svg className="proj-stage-tick" viewBox="0 0 12 12" aria-hidden focusable="false"><path d="M2.2 6.4l2.5 2.5 5-5.6" /></svg>;

/**
 * 企业版项目详情节点卡里的阶段页签（10-31 改版 R5）：线索 / 商机 / 订单三个页签，默认选项目所在的阶段；
 * 面板只列选中那个阶段的进程（按字典，不写死），走过的打勾、当前的垫一块白浮片带橙点（11-12 分段滑块）、没走到的浅灰字。结局不当阶段摆，跟在当前进程后面。
 * 看别的阶段只能看，不能动。
 * 「完成节点 ▼」「新增沟通」摆在页签那一行右边（M-节点-04 / U-项目-06）：按钮由父组件给，
 * 这里只告诉它现在看的是不是所在阶段——不是就灰掉，写「只能在当前阶段操作」（设计稿 §7.3）。推不了的原因跟在下面。
 * F-项目-19：不再挂「当前阶段」小标，不在的阶段页签字灰着（还能点开看）。
 * A-12：线索列表末尾挂「已转商机」、商机列表末尾挂「商机赢单」、订单列表末尾挂「交付结清」（叫法按字典 出口们），走过了打勾
 * 父组件用 key={所在阶段} 挂：阶段变了，页签跟着回到新的所在阶段
 */
/** 系统开了「减弱动态」：滚动不平滑 */
import { 少动 } from "@/lib/reduced-motion";

export default function ProjectStages({ 字典, 所在阶段, 所在进程, 结局, 结局色, 成功交付, 动作, 提示, 卡头, 不摆阶段页签 = false }: {
  字典: 阶段字典;
  所在阶段: string;
  所在进程: string;
  结局: string | null;
  结局色?: string;
  成功交付: boolean;
  /** 参数是「看的不是所在阶段」时的灰掉原因，看的是所在阶段时为 undefined */
  动作?: (不在当前: string | undefined) => ReactNode;
  提示?: string;
  /** 卡头左边摆的东西（客户详情：项目切换，11-12 方案一）；给了就和右边「完成节点」同一行、不换行 */
  卡头?: ReactNode;
  /**
   * 不摆「线索 / 商机 / 订单」三个阶段页签（11-12 用户：客户详情卡头写了阶段，下面的页签不用显示），只看所在阶段的节点。
   * 页签的状态和逻辑都还在，传 false 就回来；独立项目详情页照旧摆
   */
  不摆阶段页签?: boolean;
}) {
  const [看, set看] = useState(所在阶段);
  const 签们 = useRef<(HTMLButtonElement | null)[]>([]);
  const 所在序 = 阶段们.indexOf(所在阶段 as never);
  const 看序 = 阶段们.indexOf(看 as never);
  const 节点们 = 字典.节点们[看 as (typeof 阶段们)[number]] ?? [];
  const 当前序 = 看 === 所在阶段 ? 节点们.indexOf(所在进程) : -1;
  const 态 = (i: number): "done" | "cur" | "todo" =>
    看序 < 所在序 || (看 === 所在阶段 && (成功交付 || i < 当前序)) ? "done" : 看 === 所在阶段 && i === 当前序 ? "cur" : "todo";
  // A-12：线索、商机走成的那个出口（已转商机 / 商机赢单）挂在节点列表末尾；项目已经到了后面的阶段 = 走过了
  // 11-01 答复 #7：订单也挂走成的出口（企业版 交付结清），交付了才打勾
  const 出口 = 看 === "线索" || 看 === "商机" || 看 === "订单" ? 字典.出口们[看][0].叫法 : null;
  const 出口走过 = 看 === "订单" ? 成功交付 : 看序 < 所在序;

  /* 11-12 分段滑块（参考稿 A）：灰槽里每个进程等宽一格，一块白浮片垫在「当前」下面，当前换了就滑过去。
     一排放不下就横向滚（触控板、滚轮、两头的小箭头）；打开 / 换页签时把「当前」滚到中间。
     浮片位置用 left / width（不用 transform），减弱动态时也在对的位置；没有「当前」（看别的阶段、已交付）就藏起来 */
  const 排 = useRef<HTMLOListElement>(null);
  const 浮片 = useRef<HTMLLIElement>(null);
  const 上次看 = useRef<string | null>(null);
  const [能滚, set能滚] = useState({ 左: false, 右: false });
  const 量滚 = useCallback(() => {
    const ol = 排.current;
    if (!ol) return;
    const 左 = ol.scrollLeft > 1, 右 = ol.scrollLeft + ol.clientWidth < ol.scrollWidth - 1;
    set能滚((o) => (o.左 === 左 && o.右 === 右 ? o : { 左, 右 }));
  }, []);
  /** 动 = 这次换位置要不要滑：首次、换页签、尺寸变了都直接到位（不从 0 滑进来） */
  const 放浮片 = useCallback((动: boolean) => {
    const ol = 排.current, 片 = 浮片.current;
    if (!ol || !片) return;
    const 当前 = ol.querySelector<HTMLElement>("[aria-current=step]");
    if (!当前) { 片.dataset.on = "0"; return; }
    const 直接 = !动 || 片.dataset.on !== "1";
    if (直接) 片.dataset.still = "";
    片.style.left = `${当前.offsetLeft}px`;
    片.style.width = `${当前.offsetWidth}px`;
    片.dataset.on = "1";
    if (直接) { void 片.offsetWidth; delete 片.dataset.still; }
  }, []);
  const 滚一下 = (向: 1 | -1) => 排.current?.scrollBy({ left: 向 * 排.current.clientWidth * 0.7, behavior: 少动() ? "auto" : "smooth" });
  useIsoLayoutEffect(() => {
    const ol = 排.current;
    if (!ol) return;
    const 同页签 = 上次看.current === 看;
    上次看.current = 看;
    放浮片(同页签);
    const 当前 = ol.querySelector<HTMLElement>("[aria-current=step]");
    // 只动这一排的 scrollLeft，不用 scrollIntoView（那会连带整页滚）；同一页签里换了当前才平滑滚，减弱动态时直接到
    const 到 = 当前 ? 当前.offsetLeft - (ol.clientWidth - 当前.offsetWidth) / 2 : 0;
    if (同页签 && 当前 && !少动()) ol.scrollTo({ left: 到, behavior: "smooth" });
    else ol.scrollLeft = 到;
    量滚();
  }, [看, 当前序, 量滚, 放浮片]);
  useEffect(() => {
    const ol = 排.current;
    if (!ol) return;
    // 容器宽窄变了、字体换了（节点宽跟着变）：浮片重新对齐，不滑
    const 看尺寸 = new ResizeObserver(() => { 量滚(); 放浮片(false); });
    看尺寸.observe(ol);
    ol.querySelectorAll(".proj-stage-node").forEach((li) => 看尺寸.observe(li));
    let 还在 = true;
    document.fonts?.ready.then(() => { if (还在) 放浮片(false); });
    return () => { 还在 = false; 看尺寸.disconnect(); };
  }, [看, 节点们.length, 量滚, 放浮片]);
  useEffect(() => {
    const ol = 排.current;
    if (!ol) return;
    // 竖着的滚轮在这排上换成横滚；滚到头了就放给整页
    const 轮 = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const 到头 = e.deltaY < 0 ? ol.scrollLeft <= 0 : ol.scrollLeft + ol.clientWidth >= ol.scrollWidth - 1;
      if (到头) return;
      e.preventDefault();
      ol.scrollLeft += e.deltaY;
    };
    ol.addEventListener("wheel", 轮, { passive: false });
    return () => ol.removeEventListener("wheel", 轮);
  }, []);
  // 页签键盘：左右键换、Home / End 到头（WAI-ARIA tabs）
  const 按键 = (e: KeyboardEvent, i: number) => {
    const 到 = e.key === "ArrowRight" ? (i + 1) % 阶段们.length : e.key === "ArrowLeft" ? (i + 阶段们.length - 1) % 阶段们.length : e.key === "Home" ? 0 : e.key === "End" ? 阶段们.length - 1 : -1;
    if (到 < 0) return;
    e.preventDefault();
    set看(阶段们[到]);
    签们.current[到]?.focus();
  };
  return (
    <div className="proj-stages">
      <div className={`proj-stage-bar${卡头 ? " has-head" : ""}`}>
        {卡头 && <div className="proj-stage-head">{卡头}</div>}
        {!不摆阶段页签 && <div className="proj-stage-tabs" role="tablist" aria-label="项目阶段">
          {阶段们.map((s, i) => (
            <button
              key={s}
              ref={(el) => { 签们.current[i] = el; }}
              type="button"
              role="tab"
              id={`proj-stage-tab-${i}`}
              aria-selected={看 === s}
              aria-controls="proj-stage-panel"
              tabIndex={看 === s ? 0 : -1}
              className={`proj-stage-tab${看 === s ? " is-on" : ""}${s === 所在阶段 ? " is-here" : " is-away"}`}
              style={{ ["--stage-c" as string]: 阶段色[s] }}
              onClick={() => set看(s)}
              onKeyDown={(e) => 按键(e, i)}
            >
              <span className="proj-stage-dot" aria-hidden />
              {s}
            </button>
          ))}
        </div>}
        {动作 && <div className="proj-stage-acts">{动作(看 === 所在阶段 ? undefined : "只能在当前阶段操作")}</div>}
      </div>
      {提示 && <div className="proj-stage-note proj-stage-why">{提示}</div>}
      <div id="proj-stage-panel" role={不摆阶段页签 ? undefined : "tabpanel"} aria-labelledby={不摆阶段页签 ? undefined : `proj-stage-tab-${看序}`} aria-label={不摆阶段页签 ? `${看}阶段的节点` : undefined} className="proj-stage-panel" style={{ ["--stage-c" as string]: 阶段色[看] }}>
        {看 !== 所在阶段 && (
          <div className="proj-stage-note">{看序 < 所在序 ? `「${看}」阶段已经走完` : `还没到「${看}」阶段`}，只能看，不能改</div>
        )}
        <div className="proj-stage-strip">
        {能滚.左 && <button type="button" className="proj-stage-scroll is-l" aria-label="往左看节点" onClick={() => 滚一下(-1)}><LeftOutlined /></button>}
        <ol className="proj-stage-nodes" ref={排} onScroll={量滚}>
          <li className="proj-stage-thumb" ref={浮片} role="presentation" aria-hidden data-on="0" />
          {节点们.map((n, i) => {
            const t = 态(i);
            return (
              <li key={n} className={`proj-stage-node is-${t}`} aria-current={t === "cur" ? "step" : undefined}>
                <span className="proj-stage-mark" aria-hidden>{t === "done" && 勾}</span>
                <span className="proj-stage-name" title={n}>{n}</span>
                {t === "cur" && <span className="sr-only">（当前）</span>}
                {t === "cur" && 结局 && <Tag color={结局色} style={{ marginInlineEnd: 0 }}>{结局}</Tag>}
              </li>
            );
          })}
        </ol>
        {能滚.右 && <button type="button" className="proj-stage-scroll is-r" aria-label="往右看节点" onClick={() => 滚一下(1)}><RightOutlined /></button>}
        {/* 出口（已转商机 / 商机赢单 / 交付结清）不是流程里的一步：放在槽外右边单独一颗描边胶囊，浮片不会落到它上面 */}
        {出口 && (
          <div className={`proj-stage-exit is-${出口走过 ? "done" : "todo"}`} title={出口}>
            <span className="proj-stage-mark" aria-hidden>{出口走过 && 勾}</span>
            <span className="proj-stage-name">{出口}</span>
          </div>
        )}
        </div>
        {成功交付 && 看 === 所在阶段 && 结局 && <div className="proj-stage-note"><Tag color={结局色}>{结局}</Tag></div>}
      </div>
    </div>
  );
}
