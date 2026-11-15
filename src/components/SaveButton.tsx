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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Tooltip, type ButtonProps } from "antd";
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
  type?: ButtonProps["type"];
}) {
  const [态, set态] = useState<态>("闲");
  const [因, set因] = useState("");
  const 键 = useRef<HTMLButtonElement>(null);
  const 里 = useRef<HTMLSpanElement>(null);
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
    钉(Math.max((里.current?.scrollWidth ?? 0) + 边, el.offsetHeight));
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

  const 读屏 = 态 === "存着" ? "正在保存" : 态 === "成了" ? 已保存 : 态 === "没成" ? `${没保存}：${因}` : "";

  return (
    <>
      <Tooltip open={态 === "没成" && !!因} title={因} placement="top" color="var(--danger)">
        <Button
          {...rest}
          ref={键}
          type={type}
          disabled={disabled}
          aria-busy={态 === "存着" || undefined}
          aria-label={态 === "存着" ? "正在保存" : undefined}
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
      </Tooltip>
      <span className="sr-only" role="status" aria-live="polite">
        {读屏}
      </span>
    </>
  );
}
