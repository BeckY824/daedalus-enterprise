"use client";
/**
 * 长按确认（原型 g.confirm3「改后」）：**按住 1.2 秒**才算数，替掉原来的滑动确认。
 *
 * 只配给真的回不来、又一下子动很多东西的那一下（现在只有「清除演示数据」）。它照样放在后果框里——
 * 后果先写清楚（防误解），按住这个动作挡手快（防误触）。每多用一处，它就少挡一点。
 *
 * 为什么从「滑」改成「按住」：滑要找把手、要拖准方向，触控板上尤其别扭；按住只要求「这一下是专门做的」，
 * 鼠标、触控板、触屏、键盘（按住空格或回车）都是同一个动作。
 *
 *   按下 → 红色的底从左往右灌满（1.2 秒，匀速——这是计时，不是装饰，减弱动态下也照样灌）
 *   中途松手 / 移出去 / 失焦 → 退回去，按钮轻轻摇一下（减弱动态下不摇）
 *   灌满 → 做；做的时候转圈，成了打勾；没成退回原样，由调用方说原因
 *
 * 动效时长曲线都在 globals.css（.hold-*），灌满那 1.2 秒是规矩不是动效，所以写在这里。
 */
import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useMotionTheme } from "@/components/MotionTheme";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";

type 态 = "闲" | "按着" | "做着" | "成了";

export default function HoldConfirm({
  话,
  忙 = false,
  做,
  毫秒 = 1200,
}: {
  /** 那件事本身，比如「清除演示数据」。按钮上写「按住 清除演示数据」 */
  话: string;
  /** 外面在忙（请求在路上）：按不动 */
  忙?: boolean;
  /** 按满之后做的事。抛错或回 { ok:false } = 没成，按钮退回原样 */
  做: () => 做的结果 | Promise<做的结果>;
  /** 要按多久，默认 1200 */
  毫秒?: number;
}) {
  const { 时长 } = useMotionTheme();
  const 少动 = useReducedMotion();
  /** 中途松手，灌进去的那一截退回去：跟手的那一档（--t-fast）；减弱动态下直接归零 */
  const 退回毫秒 = 少动 ? 0 : 时长.fast * 1000;
  const 说明号 = useId();
  const [态, set态] = useState<态>("闲");
  const [摇, set摇] = useState(0);
  const 键 = useRef<HTMLButtonElement>(null);
  /** 灌到哪了（0~1）。不走 CSS 过渡：全局减弱动态会把过渡压成一帧，进度就看不见了 */
  const 进度 = useRef(0);
  const 帧 = useRef(0);
  const 起 = useRef(0);
  const 活着 = useRef(true);
  const 做的 = useRef(做);
  useEffect(() => {
    做的.current = 做;
  });
  useEffect(() => {
    活着.current = true;
    return () => {
      活着.current = false;
      cancelAnimationFrame(帧.current);
    };
  }, []);

  const 画 = (p: number) => {
    进度.current = p;
    键.current?.style.setProperty("--hold-p", String(p));
  };

  async function 满了() {
    set态("做着");
    const 因 = await 跑出原因(() => 做的.current());
    if (!活着.current) return;
    if (因) {
      画(0);
      set态("闲");
      set摇((n) => n + 1);
    } else set态("成了");
  }

  function 按下() {
    if (态 !== "闲" || 忙) return;
    set态("按着");
    起.current = performance.now() - 进度.current * 毫秒;
    const 走 = (t: number) => {
      const p = Math.min(1, (t - 起.current) / 毫秒);
      画(p);
      if (p >= 1) return void 满了();
      帧.current = requestAnimationFrame(走);
    };
    帧.current = requestAnimationFrame(走);
  }

  function 松开() {
    if (态 !== "按着") return;
    cancelAnimationFrame(帧.current);
    set态("闲");
    set摇((n) => n + 1);
    // 退回去：比灌的时候快得多，回到 0
    const 从 = 进度.current;
    const t0 = performance.now();
    const 退 = (t: number) => {
      const p = 退回毫秒 > 0 ? Math.max(0, 从 - (从 * (t - t0)) / 退回毫秒) : 0;
      画(p);
      if (p > 0) 帧.current = requestAnimationFrame(退);
    };
    帧.current = requestAnimationFrame(退);
  }

  const 能按 = 态 === "闲" || 态 === "按着";
  return (
    <button
      ref={键}
      type="button"
      className="hold-btn"
      data-state={态}
      data-shake={摇 % 2 ? "a" : 摇 ? "b" : undefined}
      disabled={忙 || 态 === "做着" || 态 === "成了"}
      aria-busy={态 === "做着" || undefined}
      aria-label={态 === "闲" || 态 === "按着" ? `按住 ${话}` : undefined}
      aria-describedby={说明号}
      onPointerDown={(e) => {
        if (e.button !== 0 || !能按) return;
        e.preventDefault();
        键.current?.focus();
        按下();
      }}
      onPointerUp={松开}
      onPointerLeave={松开}
      onPointerCancel={松开}
      onBlur={松开}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (!e.repeat) 按下();
      }}
      onKeyUp={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        松开();
      }}
    >
      <i className="hold-fill" aria-hidden />
      <span id={说明号} className="sr-only">
        按住 {(毫秒 / 1000).toFixed(1).replace(/\.0$/, "")} 秒确认；键盘上按住空格或回车
      </span>
      <span className="hold-t">
        {态 === "做着" ? (
          <>
            <span className="hold-spin" aria-hidden />
            正在{话}
          </>
        ) : 态 === "成了" ? (
          <>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 6.5l2.6 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            已{话}
          </>
        ) : (
          <>按住 {话}</>
        )}
      </span>
    </button>
  );
}
