"use client";
/**
 * 就地确认。**这个按钮自己变成问句**，不弹框（原型 g.confirm1「改后」）。
 *
 * 形状参考 bencho.dev 的 Inline confirm（MIT，见 licenses/bencho-MIT.txt），
 * 结构和数值按我们的 token 重写过。
 *
 * 什么时候用它、什么时候还是弹框——这条线不能含糊（机制总表 P-界面-40 列了哪些归哪类）：
 *   就地确认 —— 一件事、一行后果说得完、删了还能再写一条（删沟通 / 附件 / 待办 / 跟进计划、领取、撤回交接……）
 *   后果框   —— 后果要分几条解释（退回公海、删客户、转让、批量……），用 components/ConsequenceDialog
 *   一步完成 —— 能一次做完的不加确认（勾完成、记沟通……），可逆的配底部撤销条（components/UndoBar）
 * 弹框的价值在那段解释，不在"多点一下"。把有解释的那些也改成就地确认，等于把解释扔了。
 *
 * 展开后：[一行后果] [确认键（实心）] [取消]。后果那行用危险色（删除这类）或灰（中性的事）；
 * 确认键是这一行唯一的实心块，眼睛直接落在它上面。
 * 3 秒没动静自己收回去（原型「3 秒不点自动复原」）：人多半是点错了然后走开了，一直张着嘴的确认条很吵。
 * 但鼠标停在上面、焦点在里面、或者确认已经发出去在等结果时**不收**——读到一半被收走等于没问。
 * 确认成了之后这一行怎么收（高度收起、不弹提示）是调用方的事：组件只负责问。
 *
 * 展开时右边的两个键会把原来那行挤开，所以它只放在末尾一列。
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionTheme } from "@/components/MotionTheme";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";

export default function InlineConfirm({
  问,
  做,
  children,
  是 = "删除",
  中性 = false,
  毫秒 = 3000,
  开: 外开,
  set开: 外set开,
}: {
  /** 一行后果 / 问句。一句话，不带句号——它和两个键在同一行（「删了进回收站，30 天内可恢复」「删除这条？」） */
  问: string;
  /** 确认之后做的事。抛错或回 { ok:false } 时问句留着（可以再点或取消），原因由调用方提示 */
  做: () => 做的结果 | Promise<做的结果>;
  /** 平时那颗键。展开之后它会被问句替掉 */
  children: React.ReactNode;
  /** 确认键上的字。默认「删除」；不是删除的事（比如解除、领取）要写成那件事本身 */
  是?: string;
  /** 不是删除这类的事（改主客户、领取……）：确认键用主色、后果用灰字，不用红 */
  中性?: boolean;
  /** 多久不动自己收回，默认 3000 */
  毫秒?: number;
  /**
   * 受控：由外面决定什么时候展开（比如从「更多」菜单里点进来）。
   * 受控时点平时那颗键**不会**展开——那颗键可能是一整排别的按钮。
   */
  开?: boolean;
  set开?: (v: boolean) => void;
}) {
  const { 曲线, 时长 } = useMotionTheme();
  const [内开, set内开] = useState(false);
  const 开 = 外开 ?? 内开;
  const set开 = 外set开 ?? set内开;
  const [忙, set忙] = useState(false);
  /** 鼠标停在上面 / 焦点在里面：不自动收 */
  const [停, set停] = useState(false);
  const 壳 = useRef<HTMLSpanElement>(null);
  const 取消键 = useRef<HTMLButtonElement>(null);
  // 外面传进来的 set开 多半是每次渲染新建的箭头函数；放进依赖里，计时会被每次重渲重置
  const 收起 = useRef(set开);
  useEffect(() => {
    收起.current = set开;
  });

  useEffect(() => {
    if (!开 || 停 || 忙) return;
    const t = setTimeout(() => 收起.current(false), 毫秒);
    return () => clearTimeout(t);
  }, [开, 停, 忙, 毫秒]);

  // 展开那一下焦点在平时那颗键上（键盘点开的）：挪到「取消」——回车再按一下是退出，不是删除
  const 焦点在里面 = useRef(false);
  // 收回之后「停」清掉，下次展开重新计时。渲染时比上一次的 开，不用 effect
  const [上次开, set上次开] = useState(开);
  if (开 !== 上次开) {
    set上次开(开);
    if (!开) set停(false);
  }
  useEffect(() => {
    if (!开) {
      // 收回时焦点原来在问句里：还给平时那颗键，不让它掉回 <body>
      if (焦点在里面.current) {
        焦点在里面.current = false;
        requestAnimationFrame(() => 壳.current?.querySelector<HTMLElement>("button, [href], [tabindex]")?.focus());
      }
      return;
    }
    // 只认键盘点开的（:focus-visible）。鼠标点开的不挪：焦点停在问句里会让它一直不收
    const 现在 = document.activeElement;
    if (现在 && 壳.current?.contains(现在) && 现在.matches(":focus-visible")) 取消键.current?.focus();
  }, [开]);

  async function 确认() {
    if (忙) return;
    set忙(true);
    const 因 = await 跑出原因(做);
    set忙(false);
    if (!因) {
      焦点在里面.current = false;
      set开(false);
    }
  }

  function 取消() {
    焦点在里面.current = !!壳.current?.contains(document.activeElement);
    set开(false);
  }

  return (
    <span
      className="inlc"
      ref={壳}
      onKeyDown={(e) => {
        if (e.key === "Escape" && 开) {
          e.stopPropagation();
          取消();
        }
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {开 ? (
          <motion.span
            key="ask"
            className="inlc-ask"
            data-tone={中性 ? "neutral" : "danger"}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 时长.base, ease: 曲线.spring }}
            onMouseEnter={() => set停(true)}
            onMouseLeave={() => set停(壳.current?.contains(document.activeElement) ?? false)}
            onFocus={() => {
              焦点在里面.current = true;
              set停(true);
            }}
            onBlur={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              焦点在里面.current = false;
              set停(false);
            }}
          >
            <span className="inlc-q">{问}</span>
            <button type="button" className="inlc-yes" disabled={忙} aria-busy={忙 || undefined} onClick={() => void 确认()}>
              {是}
            </button>
            <button type="button" className="inlc-no" ref={取消键} onClick={取消}>
              取消
            </button>
          </motion.span>
        ) : (
          <motion.span
            key="btn"
            className="inlc-btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 时长.fast, ease: 曲线.ease }}
            onClick={外开 === undefined ? () => set开(true) : undefined}
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
