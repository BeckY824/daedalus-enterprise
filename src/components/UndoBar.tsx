"use client";
/**
 * 底部撤销条（原型 g.undo / g.confirm2「改后」）。**全站同一时刻只有一条**。
 *
 * 用法：一件事做完（或先在界面上收起、等到点再真做），调一下
 *   showUndo({ 话: "已退回「华东展具」", 撤销: () => 撤回退回(id) })                 // 已经做了，撤销 = 反着做一遍
 *   showUndo({ 话: "已移除这一轮", 撤销: () => 放回来(), 到点: () => 真删(id) })      // 到点才做，撤销 = 不做了
 * 不用挂任何东西：第一次调用时自己在 <body> 底下长出来，不吃页面的 React 树，换页它还在（原型：「撤销条跟到列表」）。
 *
 * 几种情况，定死的行为：
 * - **又来一条**：上一条立刻按「到点」收掉（有 到点 的马上真做），新的一条顶上来。不排队、不叠两条。
 * - **连点撤销**：只认第一下；撤销在路上时按钮转圈、再点没用；到点和撤销谁先到算谁，另一个不再发生。
 * - **撤销被挡**（回了 { ok:false, error } 或抛错，比如没权限、已经被同事领走）：这一条原地变成「撤销不了：原因」，
 *   不再倒计时，5 秒后自己收，也可以点 ✕；不弹别的框。
 * - **到点再做的那一下没做成**：同样在这条上写「没做成：原因」。若此时已经有新的一条在倒计时，等它收了再说，不抢。
 * - **倒计时内离页**（关标签、刷新、跳到站外）：有 到点 的立刻发出去，不等倒计时，也不弹「确定离开？」；
 *   已经做了的那种什么都不用做——撤销的机会随页面一起没了，事情本身已经成了。
 * - **站内换页 / 调用它的组件卸载**：条还在、照常倒计时、照常能撤。所以 撤销 / 到点 里别去改调用方组件的 state，
 *   只发请求、router.refresh()。
 * - **鼠标停在条上 / 焦点在条里**：倒计时暂停，移开再走（读不完就没了的条，等于没给）。
 * - ⌘Z / Ctrl+Z（焦点不在输入框里时）= 点撤销。
 *
 * 动效全走 globals.css 的令牌（--t / --t-fast / --ease / --ease-spring），这里不写数。
 */
import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { createRoot, type Root } from "react-dom/client";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";

export type 撤销参数 = {
  /** 刚做了什么。一句话，带上那条东西的名字：「已退回「华东展具」」 */
  话: string;
  /** 撤销。已经做了的：反着做一遍（发请求）；到点才做的：把界面放回去 */
  撤销: () => 做的结果 | Promise<做的结果>;
  /** 给了 = 到点才真做（撤销了就不做）；不给 = 事情已经做完，倒计时只是撤销的窗口 */
  到点?: () => 做的结果 | Promise<做的结果>;
  /** 倒计时，毫秒。默认 5000（原型 g.undo）；退回公海这类后果重的给 6000 */
  毫秒?: number;
  /**
   * 撤销之外的另一个顺手动作（比如完成计划后「排下一次」）。只在倒计时里出现、排在撤销前面；
   * 点了 = 这件事就这么定了：条按到点收掉（有 到点 的照常做），再调 做
   */
  另一个动作?: { 话: string; 做: () => void };
};

type 态 = "数" | "撤着" | "撤了" | "挡了" | "没成";
type 条 = { id: number; 话: string; 态: 态; 毫秒: number; 停: boolean; 出: boolean; 另?: string };

const 默认毫秒 = 5000;
/** 「已撤销」留多久；「撤销不了 / 没做成」留多久——要读原因，长一点 */
const 撤了留 = 1600;
const 出错留 = 5000;
/** 收起动画（--t-fast）放完会自己拿掉；这是动画没放时的兜底，比任何一档时长都长 */
const 收起兜底 = 600;

let 当前: 条 | null = null;
let 序 = 0;
/** 当前这条的回调和计时，不进快照（快照只放画得出来的东西） */
let 手: { 撤销: 撤销参数["撤销"]; 到点?: 撤销参数["到点"]; 另?: () => void; 计时: ReturnType<typeof setTimeout> | null; 剩: number; 起: number } | null = null;
/** 有新的一条在倒计时时冒出来的错，等它收了再一条条显示 */
const 待显: { 话: string; 态: "挡了" | "没成" }[] = [];
const 听众 = new Set<() => void>();

function 发() {
  for (const f of 听众) f();
}
function 设(x: 条 | null) {
  当前 = x;
  发();
}
function 改(id: number, 部分: Partial<条>) {
  if (当前?.id !== id) return;
  设({ ...当前, ...部分 });
}
function 清计时() {
  if (手?.计时) clearTimeout(手.计时);
  if (手) 手.计时 = null;
}

/** 收起动画放完（或不用放）之后：真正拿掉，有攒着的错就接着显示 */
function 拿掉(id: number) {
  if (当前?.id !== id) return;
  手 = null;
  const 下一条 = 待显.shift();
  if (下一条) 显示错(下一条.话, 下一条.态);
  else 设(null);
}

/** 开始收起：放收起动画，动画放完拿掉；万一动画没放（被别的样式关了），过一会儿也拿掉 */
function 收起(id: number) {
  if (当前?.id !== id || 当前.出) return;
  改(id, { 出: true });
  setTimeout(() => 拿掉(id), 收起兜底);
}

function 显示错(话: string, 态: "挡了" | "没成") {
  // 有一条还在倒计时：不抢它，等它收了再说
  if (当前 && 当前.态 === "数" && !当前.出) return void 待显.push({ 话, 态 });
  const id = ++序;
  清计时();
  手 = { 撤销: () => undefined, 计时: null, 剩: 出错留, 起: Date.now() };
  设({ id, 话, 态, 毫秒: 出错留, 停: false, 出: false });
  手.计时 = setTimeout(() => 收起(id), 出错留);
}

/** 到点（或被新的一条顶掉、或离页）：倒计时那条收掉，有 到点 的现在做 */
function 到点了(id: number, { 立刻拿掉 = false } = {}) {
  if (当前?.id !== id || 当前.态 !== "数" || !手) return;
  /*
    已经在收了（到点那一下已经做过，正在放收起动画）：不再做第二次。收起动画期间又来一条新的、离页、
    鼠标移开重开计时都会再走到这里，原来会把「到点」再调一次（11-15 c 发现）。要立刻拿掉的照拿掉
  */
  if (当前.出) {
    if (立刻拿掉) {
      手 = null;
      设(null);
    }
    return;
  }
  清计时();
  const 做 = 手.到点;
  if (立刻拿掉) {
    手 = null;
    设(null);
  } else 收起(id);
  if (做) void 跑出原因(做).then((因) => 因 && 显示错(`没做成：${因}`, "没成"));
}

async function 撤(id: number) {
  // 在收的那条（已经到点做过了）不能再撤：撤销键还在动画里看得见，点了也不算
  if (当前?.id !== id || 当前.态 !== "数" || 当前.出 || !手) return;
  清计时();
  const 撤销 = 手.撤销;
  改(id, { 态: "撤着" });
  const 因 = await 跑出原因(撤销);
  if (当前?.id !== id) {
    // 撤销在路上时被新的一条顶掉了：成了就算了，没成要让人知道
    if (因) 显示错(`撤销不了：${因}`, "挡了");
    return;
  }
  if (因) {
    改(id, { 态: "挡了", 话: `撤销不了：${因}` });
    if (手) 手.计时 = setTimeout(() => 收起(id), 出错留);
  } else {
    改(id, { 态: "撤了", 话: "已撤销" });
    if (手) 手.计时 = setTimeout(() => 收起(id), 撤了留);
  }
}

function 停表(id: number) {
  if (当前?.id !== id || 当前.停 || 当前.出 || !手) return;
  if (当前.态 === "数" && 手.计时) {
    clearTimeout(手.计时);
    手.计时 = null;
    手.剩 = Math.max(0, 手.剩 - (Date.now() - 手.起));
  }
  改(id, { 停: true });
}
function 走表(id: number) {
  if (当前?.id !== id || !当前.停 || 当前.出 || !手) return;
  if (当前.态 === "数" && !手.计时) {
    手.起 = Date.now();
    手.计时 = setTimeout(() => 到点了(id), 手.剩);
  }
  改(id, { 停: false });
}

/* ---------- 挂到 body 底下 ---------- */
let 根: Root | null = null;
let 听了离页 = false;

function 离页() {
  // 只管「到点才做」的那种：现在就发出去。已经做了的不用管
  if (当前 && 当前.态 === "数") 到点了(当前.id, { 立刻拿掉: true });
}

function 挂() {
  if (!听了离页) {
    听了离页 = true;
    window.addEventListener("pagehide", 离页);
    window.addEventListener("beforeunload", 离页);
  }
  if (根 && document.body.contains(document.getElementById("undo-host"))) return;
  const 壳 = document.createElement("div");
  壳.id = "undo-host";
  document.body.appendChild(壳);
  根 = createRoot(壳);
  根.render(<UndoBarView />);
}

/** 弹一条撤销条。回 { 收 }：调用方想提前结束（比如这件事已经被别的操作盖掉）就调 收()，等于到点 */
export function showUndo(p: 撤销参数): { 收: () => void } {
  if (typeof window === "undefined") return { 收: () => {} };
  挂();
  // 上一条：还在倒计时的立刻按到点收掉（不排队、不叠）
  if (当前 && 当前.态 === "数") 到点了(当前.id, { 立刻拿掉: true });
  else 清计时();
  const id = ++序;
  const 毫秒 = p.毫秒 ?? 默认毫秒;
  手 = { 撤销: p.撤销, 到点: p.到点, 另: p.另一个动作?.做, 计时: null, 剩: 毫秒, 起: Date.now() };
  手.计时 = setTimeout(() => 到点了(id), 毫秒);
  设({ id, 话: p.话, 态: "数", 毫秒, 停: false, 出: false, 另: p.另一个动作?.话 });
  return { 收: () => 到点了(id) };
}

/** 测试和换账号用：有倒计时的按到点收掉，条拿走 */
export function dismissUndo() {
  if (当前 && 当前.态 === "数") 到点了(当前.id, { 立刻拿掉: true });
  清计时();
  手 = null;
  待显.length = 0;
  设(null);
}

const 订 = (f: () => void) => {
  听众.add(f);
  return () => void 听众.delete(f);
};
const 取 = () => 当前;
const 服务端取 = () => null;

function 在输入(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function UndoBarView() {
  const 条 = useSyncExternalStore(订, 取, 服务端取);

  const id = 条?.id;
  const 数着 = 条?.态 === "数";
  useEffect(() => {
    if (id === undefined || !数着) return;
    const 键 = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z" && !在输入(e.target)) {
        e.preventDefault();
        void 撤(id);
      }
    };
    window.addEventListener("keydown", 键);
    return () => window.removeEventListener("keydown", 键);
  }, [id, 数着]);

  if (!条) return null;
  const 错 = 条.态 === "挡了" || 条.态 === "没成";
  const 环 = { "--undo-ms": `${条.毫秒}ms` } as CSSProperties;
  return (
    <div
      key={条.id}
      className="undo-bar"
      role={错 ? "alert" : "status"}
      aria-live={错 ? "assertive" : "polite"}
      data-state={条.态}
      data-out={条.出 ? "" : undefined}
      data-paused={条.停 ? "" : undefined}
      onMouseEnter={() => 停表(条.id)}
      onMouseLeave={() => 走表(条.id)}
      onFocus={() => 停表(条.id)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && 走表(条.id)}
      onAnimationEnd={(e) => 条.出 && e.target === e.currentTarget && 拿掉(条.id)}
    >
      <span className="undo-ic" aria-hidden>
        {错 ? (
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 3.5v4.2M7 10.2v.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 7.4l2.6 2.5L11 4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </span>
      <span className="undo-t" title={条.话}>{条.话}</span>
      {(条.态 === "数" || 条.态 === "撤着") && (
        <>
          {条.另 && 条.态 === "数" && (
            <button
              type="button"
              className="undo-btn undo-btn-alt"
              onClick={() => {
                const 做 = 手?.另;
                到点了(条.id);
                做?.();
              }}
            >
              {条.另}
            </button>
          )}
          <button
            type="button"
            className="undo-btn"
            aria-keyshortcuts="Meta+Z Control+Z"
            aria-busy={条.态 === "撤着" || undefined}
            disabled={条.态 === "撤着"}
            onClick={() => void 撤(条.id)}
          >
            {条.态 === "撤着" ? <span className="undo-spin" aria-hidden /> : null}
            撤销
          </button>
          <svg className="undo-ring" style={环} width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle className="undo-ring-bg" cx="8" cy="8" r="6" />
            <circle className="undo-ring-fg" cx="8" cy="8" r="6" transform="rotate(-90 8 8)" />
          </svg>
        </>
      )}
      {错 && (
        <button type="button" className="undo-x" aria-label="关闭" onClick={() => 收起(条.id)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  );
}
