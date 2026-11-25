"use client";
/**
 * 保存按钮：保存中 / 已保存 / 没保存上，**都显示在这颗按钮里**，不弹顶部提示（原型 g.save「改后」）。
 *
 *   点一下 → 收成一颗小圆、里面转圈 → 成了：变绿、对勾 +「已保存」，停一下回到原样
 *                                    → 没成：变红「没保存上」，原因浮在按钮正上方（不是顶部提示），停一会儿回原样，可以再点
 *
 * 保存中按钮不收第二下（防连点：网慢时点三下建出三条，见 tests/modal-double-submit.test.ts 的来由）。
 * 宽度在几个具体 px 之间过渡（auto 过渡不了）：原宽 → 圆 → 内容宽 → 原宽，再放开成 auto。
 * 过渡的时长曲线在 globals.css（.save-btn，--t / --ease-spring），这里不写数；开了减弱动态直接到位。
 * 读屏：三态各说一句（aria-live），失败原因也读出来。
 *
 * 和 antd Button 一样摆：type、size、danger、disabled、className 都透传。默认 type="primary"。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonProps } from "antd";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";

type 态 = "闲" | "存着" | "成了" | "没成";

/** 「已保存」停多久；「没保存上」停多久（要读原因，长一点） */
const 成了留 = 1400;
const 没成留 = 4000;
/** 长回原宽之后放开成 auto：等 transitionend；万一没有过渡（被别的样式关了），这么久之后也放开 */
const 放开兜底 = 600;

export default function SaveButton({
  做,
  children = "保存",
  已保存 = "已保存",
  没保存 = "没保存上",
  成了,
  收错,
  type = "primary",
  disabled,
  className,
  ...rest
}: Omit<ButtonProps, "onClick" | "loading" | "children" | "type"> & {
  /** 保存本身。回 { ok:false, error } 或抛错 = 没保存上，error 就是给人看的原因 */
  做: () => 做的结果 | Promise<做的结果>;
  /** 平时的字，默认「保存」 */
  children?: React.ReactNode;
  /** 成了那一下的字，默认「已保存」 */
  已保存?: string;
  /** 没成那一下的字，默认「没保存上」 */
  没保存?: string;
  /** 「已保存」放完之后（比如关弹框）。对勾放完才调，人先看见成了 */
  成了?: () => void;
  /**
   * 交一个 ref 进来，这里把「收掉没保存上」挂在 .current 上：原因挂着时调一下，原因收掉、按钮回原样（没挂着时调了不动）。
   * 11-26：记沟通被拦「太短」后改成能存的内容，旧原因还挂着像是新内容也不行——表单那格一改就调它
   */
  收错?: React.MutableRefObject<(() => void) | null>;
  type?: ButtonProps["type"];
}) {
  const [态, set态] = useState<态>("闲");
  const [因, set因] = useState("");
  const 键 = useRef<HTMLButtonElement>(null);
  const 里 = useRef<HTMLSpanElement>(null);
  /** 没成时浮在按钮正上方的那句原因 */
  const 签 = useRef<HTMLDivElement>(null);
  const 签id = useId();
  const 原宽 = useRef(0);
  const 计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 活着 = useRef(true);
  const 成了回调 = useRef(成了);
  useEffect(() => {
    成了回调.current = 成了;
  });
  useEffect(() => {
    活着.current = true;
    return () => {
      活着.current = false;
      if (计时.current) clearTimeout(计时.current);
    };
  }, []);

  const 钉 = (px: number) => {
    const el = 键.current;
    if (!el) return;
    el.style.setProperty("--save-w", `${Math.round(px)}px`);
    el.setAttribute("data-fixed", "");
  };
  const 放 = () => {
    const el = 键.current;
    if (!el) return;
    el.style.removeProperty("--save-w");
    el.removeAttribute("data-fixed");
  };

  // 成了 / 没成：量里面那一截字要多宽（它不换行，按钮窄着它也是自然宽），从圆长过去
  useLayoutEffect(() => {
    const el = 键.current;
    if (!el || (态 !== "成了" && 态 !== "没成")) return;
    const cs = getComputedStyle(el);
    const 边 = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((n, k) => n + (parseFloat(cs[k as "paddingLeft"]) || 0), 0);
    const 宽 = Math.max((里.current?.scrollWidth ?? 0) + 边, el.offsetHeight);
    钉(宽);
    // 原因对准按钮长完之后的正中（宽在过渡，按终点算）
    const s = 签.current;
    if (s) {
      const r = el.getBoundingClientRect();
      // 按钮贴着窗口右边（弹框底栏的保存键多半在右边）：整句收回窗口里，两边留 8
      const 半 = s.offsetWidth / 2;
      s.style.left = `${Math.round(Math.min(Math.max(r.left + 宽 / 2, 8 + 半), window.innerWidth - 8 - 半))}px`;
      s.style.top = `${Math.max(8, Math.round(r.top - 6))}px`;
    }
  }, [态]);

  async function 存() {
    if (态 === "存着" || disabled) return;
    if (计时.current) clearTimeout(计时.current);
    const el = 键.current;
    if (el) {
      // 先钉住现在的宽、逼浏览器算一遍，再收成圆：过渡要有个具体的起点
      if (态 === "闲") 原宽.current = el.offsetWidth;
      钉(el.offsetWidth);
      void el.offsetWidth;
      钉(el.offsetHeight);
    }
    set因("");
    set态("存着");
    const 原因 = await 跑出原因(做);
    if (!活着.current) return;
    if (原因) {
      set因(原因);
      set态("没成");
      计时.current = setTimeout(() => 活着.current && 回去(), 没成留);
    } else {
      set态("成了");
      计时.current = setTimeout(() => {
        if (!活着.current) return;
        回去();
        成了回调.current?.();
      }, 成了留);
    }
  }

  function 回去() {
    const el = 键.current;
    set态("闲");
    if (!el || !原宽.current) return 放();
    钉(原宽.current);
    let 放了 = false;
    const 放开 = () => {
      if (放了) return;
      放了 = true;
      el.removeEventListener("transitionend", 放开);
      if (活着.current) 放();
    };
    el.addEventListener("transitionend", 放开);
    setTimeout(放开, 放开兜底);
  }

  /** 收错：只在「没成」时动；读的是最新的态（ref），表单改动的回调里随时调 */
  const 态r = useRef(态);
  useEffect(() => {
    态r.current = 态;
  });
  function 收起原因() {
    if (态r.current !== "没成") return;
    if (计时.current) clearTimeout(计时.current);
    态r.current = "闲";
    set因("");
    回去();
  }
  useEffect(() => {
    if (!收错) return;
    收错.current = 收起原因;
    return () => {
      收错.current = null;
    };
  });

  const 读屏 = 态 === "存着" ? "正在保存" : 态 === "成了" ? 已保存 : 态 === "没成" ? `${没保存}：${因}` : "";

  return (
    <>
      {/*
        原因不用 antd Tooltip：强制打开的 Tooltip 进了弹层的 Esc 栈顶，「没保存上」那 4 秒里按 Esc 关不掉弹框（b 核对时踩到）。
        改成一块普通的浮签（React 自己的 portal，不进 antd 的 Esc 栈），样子同复制那句（.copy-tip）
      */}
      {态 === "没成" &&
        因 &&
        typeof document !== "undefined" &&
        createPortal(
          <div ref={签} id={签id} role="tooltip" className="copy-tip is-bad save-why">
            {因}
          </div>,
          document.body,
        )}
      <Button
        {...rest}
        ref={键}
        type={type}
        disabled={disabled}
        aria-busy={态 === "存着" || undefined}
        aria-label={态 === "存着" ? "正在保存" : undefined}
        aria-describedby={态 === "没成" && 因 ? 签id : undefined}
        className={["save-btn", className].filter(Boolean).join(" ")}
        data-state={态}
        onClick={() => void 存()}
      >
        <span className="save-in" ref={里}>
          {态 === "存着" ? (
            <span className="save-spin" aria-hidden />
          ) : 态 === "成了" ? (
            <>
              <svg className="save-tick" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M2 6.5l2.6 2.5L10 3.5" />
              </svg>
              {已保存}
            </>
          ) : 态 === "没成" ? (
            没保存
          ) : (
            children
          )}
        </span>
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {读屏}
      </span>
    </>
  );
}
