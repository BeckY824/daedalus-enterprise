"use client";

/**
 * useState 写的表单、就地改的格子、首页问答框共用的草稿（存取规矩见 lib/form-draft.ts；antd 表单弹窗走 lib/form-guard.tsx，同一套存取）。
 *
 *   const 稿 = useFormDraft({ 键: `项目沟通:${p.id}`, 值: { content, 下一步 }, 带回: (v) => { … set 回去 … }, 附件数: 附件们.length });
 *   …框里摆 {稿.提示}；存上了调 稿.存好了()；人点「取消」调 稿.丢掉()
 *
 * - 打开那一刻（开 变 true、或挂上时就开着）记下各格的起始值；有草稿就悄悄带回，框里一行「已带回上次没提交的内容 · 清空」
 * - 之后每次值变了：和起始值比，打过字（算填过 默认 = 改过的格里有字）就把**改过的那几格**存下来；改回原样 / 全删了就把草稿删掉
 * - 清空 = 各格回到打开时的样子、草稿删掉；存好了 / 丢掉 = 删草稿、这一回不再存
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMe } from "@/lib/me-client";
import { 草稿全名, 读一份, 存草稿, 清草稿, 改过的格, 有字, 带回话 } from "@/lib/form-draft";

/**
 * 就地改的格子在哪条记录上（项目详情包一层 `项目:<id>`）：格子自己不知道记录编号，从这里拿；没包 = 不存草稿
 */
const 草稿范围Ctx = createContext<string | null>(null);
export const 草稿范围 = 草稿范围Ctx.Provider;
export function useDraftScope(): string | null {
  return useContext(草稿范围Ctx);
}

/** 框里那一行：已带回 + 清空 */
export function DraftHint({ 附件 = 0, on清空, 紧凑 = false }: { 附件?: number; on清空: () => void; 紧凑?: boolean }) {
  return (
    <div className={`draft-hint${紧凑 ? " is-compact" : ""}`} role="status">
      <span className="draft-hint-t">{带回话(附件)}</span>
      <button
        type="button"
        className="draft-hint-clear"
        // 就地改的格子失焦就存：点「清空」不能先让输入框失焦把草稿交上去
        onMouseDown={(e) => e.preventDefault()}
        onClick={on清空}
      >
        清空
      </button>
    </div>
  );
}

export type 草稿选项<T extends Record<string, unknown>> = {
  /** 哪张表 + 哪条记录（`项目沟通:<项目id>`、`编辑项目:<id>`）；null = 不存（比如带着别的来源打开的） */
  键: string | null;
  /** 现在开着没有。默认 true（挂上就是开着的框） */
  开?: boolean;
  /** 现在各格的值（第一层是格子名） */
  值: T;
  /** 把草稿里的几格放回去（只给改过的那几格） */
  带回: (v: Partial<T>) => void;
  /** 挂着几个附件 / 文件：存不进来，带回时提示要重选 */
  附件数?: number;
  /** 算不算填过、值得留草稿。默认：改过的格里有打过的字 */
  算填过?: (改过: Partial<T>, 值: T) => boolean;
  /** 提示那一行不带底色（就地改的格子里） */
  紧凑?: boolean;
};

export function useFormDraft<T extends Record<string, unknown>>({ 键, 开 = true, 值, 带回, 附件数 = 0, 算填过, 紧凑 = false }: 草稿选项<T>) {
  const 我 = useMe();
  const 全名 = 键 ? 草稿全名(我?.id, 键) : null;
  const 起 = useRef<T | null>(null);
  const 停 = useRef(false);
  const [带回了, set带回了] = useState<{ 附件: number } | null>(null);
  // 带回 / 算填过 是每次渲染新给的函数：放进 ref，免得 effect 跟着它们重跑
  const 手 = useRef({ 带回, 算填过 });
  const 现值 = useRef(值);
  // 提交后、下面两个 effect 之前更新（layout effect 先于普通 effect）
  useLayoutEffect(() => {
    手.current = { 带回, 算填过 };
    现值.current = 值;
  });

  // 打开那一刻：记起始值，有草稿就带回
  useEffect(() => {
    let 新: { 附件: number } | null = null;
    if (开 && 全名) {
      起.current = 现值.current;
      停.current = false;
      const 稿 = 读一份(全名);
      if (稿 && Object.keys(稿.v).length && 有字(稿.v)) {
        手.current.带回(稿.v as Partial<T>);
        新 = { 附件: 稿.附件 };
      }
    } else 起.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 草稿在 localStorage 里，只有到了浏览器、打开那一刻才读得到
    set带回了(新);
  }, [开, 全名]);

  // 值变了：存改过的那几格，或者删掉（转不成串的（不该有）就不跟）
  let 串 = "";
  try {
    串 = JSON.stringify(值);
  } catch {
    串 = "";
  }
  useEffect(() => {
    if (!开 || !全名 || !起.current) return;
    // 存好了之后一直开着的框（主题回复、就地问答这种交完清空接着用的）：字清空了就从这一刻重新算，下一回打的字照样留草稿
    if (停.current) {
      if (!有字(现值.current)) {
        起.current = 现值.current;
        停.current = false;
      }
      return;
    }
    const 改过 = 改过的格(起.current, 现值.current) as Partial<T>;
    const 填过 = 手.current.算填过 ? 手.current.算填过(改过, 现值.current) : 有字(改过);
    if (Object.keys(改过).length && 填过) 存草稿(全名, 改过, { 附件: 附件数 });
    else 清草稿(全名);
  }, [串, 附件数, 开, 全名]);

  const 存好了 = useCallback(() => {
    停.current = true;
    if (全名) 清草稿(全名);
    set带回了(null);
  }, [全名]);
  /** 人明说不要了（取消、Esc）：和 存好了 一样删掉，只是说法不同 */
  const 丢掉 = 存好了;
  const 清空 = useCallback(() => {
    if (全名) 清草稿(全名);
    if (起.current) 手.current.带回(起.current);
    set带回了(null);
  }, [全名]);

  const 提示: ReactNode = 带回了 ? <DraftHint 附件={带回了.附件} on清空={清空} 紧凑={紧凑} /> : null;
  return { 提示, 带回了: !!带回了, 附件: 带回了?.附件 ?? 0, 存好了, 丢掉, 清空 };
}
