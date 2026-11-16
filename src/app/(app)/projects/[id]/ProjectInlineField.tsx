"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EditOutlined } from "@ant-design/icons";
import Shortcut from "@/components/Shortcut";
import { useViewAs } from "@/components/ViewAsContext";

/** 编辑器拿到的：草稿、改草稿、提交（下拉、日期选了就存，传选中的值，不等 setState）、在不在存 */
export type 编辑器参数<T> = { 草稿: T; set草稿: (v: T) => void; 提交: (v?: T) => void; 忙: boolean };

/**
 * 项目详情卡片上就地改一格（11-02）。保存走外面给的 存（编辑项目 / 改项目沟通，服务端照旧判权限、留痕），这里不写库。
 *
 * - 没权限（能改 = false）、切换视图中只渲染 显示，DOM 里没有入口
 * - 点这一格或那颗小笔进入编辑；选中文字时不进（方便复制）
 * - 原型 dt.field（11-15）：和客户卡同一口径——**失焦即存**，单行 Enter 存（回车存），多行 ⌘↵ / Ctrl+↵ 存，Esc 还原并收起；
 *   不再摆「保存 / 取消」两颗键（原来 11-03 自测 A8-2「失焦不存也不提示」是我们自己测出来的毛病，不是客户定的口径，
 *   当时补了「还没保存」提示，这次按原型改成失焦就存）。中文输入法选字时的回车、Esc 不算
 * - 失焦认的是焦点真离开这一格：点进这一格自己的下拉 / 日期面板（挂在 body 上）不算；Esc、选了就存收起之后浏览器补发的那次失焦不存
 * - 编辑态下面一行写怎么存（回车 / ⌘↵ / 点别处 · Esc 还原），打开时滚进可视区（1024×768 下右栏多行备注常落在屏幕外）
 * - 存失败（存 返回一句话、或抛错）：留在编辑态、输入不丢、行内写原因；同一份草稿再失焦不重复交，改了字再失焦才再交
 * - 存成功先显示新值，旁边一个 ✓ 停一下淡掉；等 router.refresh 带回新 props 就听服务端的（值变了清掉乐观值，渲染时比，不用 effect）
 * - 失焦存的不把焦点抢回笔上（人已经点到别处了）；回车 / ⌘↵ / Esc 收起时焦点回到笔上
 *
 * 客户页的 InlineField 绑死了 patchCustomer，不能复用，这里只借它的按键习惯
 */
export default function ProjectInlineField<T>({ 名, 值, 显示, 编辑器, 存, 能改, 多行 = false, 一行显示 = false, 回车存 = false, 规整 }: {
  名: string;
  值: T;
  显示: (v: T) => ReactNode;
  编辑器: (a: 编辑器参数<T>) => ReactNode;
  /** 返回 null = 存上了，字符串 = 没存上的原因 */
  存: (v: T) => Promise<string | null>;
  能改: boolean;
  多行?: boolean;
  /** 多行编辑、平时一行显示（放不下打省略号，悬停看全文）。11-04 用户：一行规矩没覆盖的待定处「都按照优化来进行」 */
  一行显示?: boolean;
  回车存?: boolean;
  /** 存之前规整（文字去首尾空白）：只多打了空格不发请求，乐观显示和服务端存的一样；草稿不动，存失败时输入原样留着 */
  规整?: (v: T) => T;
}) {
  const 视图中 = useViewAs();
  const [开着, set开着] = useState(false);
  const [草稿, set草稿] = useState(值);
  const [错, set错] = useState<string | null>(null);
  const [忙, set忙] = useState(false);
  const [乐观, set乐观] = useState<{ 基准: string; 值: T } | null>(null);
  /** 刚存上：值旁边的 ✓ 停一下淡掉（dt.field） */
  const [刚存, set刚存] = useState(0);
  /** 收起之后（Esc、选了就存、存上了）浏览器补发的失焦不算 */
  const 收起了 = useRef(true);
  /** 上次没存上的那份草稿：没改字再失焦不重复交 */
  const 失败的 = useRef<string | null>(null);
  // 连按两下回车 / 双击保存：setState 还没生效时第二下也拦得住
  const 在存 = useRef(false);
  const 笔 = useRef<HTMLButtonElement>(null);
  const 回焦 = useRef(false);
  const 按钮排 = useRef<HTMLDivElement>(null);

  const 键 = JSON.stringify(值);
  if (乐观 && 乐观.基准 !== 键) set乐观(null);
  const 现 = 乐观 && 乐观.基准 === 键 ? 乐观.值 : 值;

  // 收起后焦点回到这一格的笔上（键盘用户不用从头 Tab）
  useEffect(() => {
    if (!开着 && 回焦.current) {
      回焦.current = false;
      笔.current?.focus();
    }
  }, [开着]);

  // 打开后下面那行「怎么存」也要看得见：滚到最近的可视位置，已经在屏幕里就不动
  useEffect(() => {
    if (开着) 按钮排.current?.scrollIntoView?.({ block: "nearest" });
  }, [开着]);

  useEffect(() => {
    if (!刚存) return;
    const t = setTimeout(() => set刚存(0), 1400);
    return () => clearTimeout(t);
  }, [刚存]);

  if (!能改 || 视图中) return <>{显示(现)}</>;

  const 开 = () => {
    set草稿(现);
    set错(null);
    失败的.current = null;
    收起了.current = false;
    set开着(true);
  };
  /** 收起。焦点回不回笔上：失焦存的不抢焦点 */
  const 关 = (回笔 = true) => {
    收起了.current = true;
    回焦.current = 回笔;
    set开着(false);
    set错(null);
  };

  async function 提交(传的?: T, 失焦 = false) {
    if (在存.current || 收起了.current) return;
    const 输入 = 传的 === undefined ? 草稿 : 传的;
    set草稿(输入);
    const v = 规整 ? 规整(输入) : 输入;
    if (JSON.stringify(v) === JSON.stringify(现)) return 关(!失焦);
    if (失焦 && 失败的.current === JSON.stringify(输入)) return;
    在存.current = true;
    set忙(true);
    set错(null);
    try {
      const 话 = await 存(v);
      if (话) {
        失败的.current = JSON.stringify(输入);
        return set错(话);
      }
      set乐观({ 基准: 键, 值: v });
      set刚存((n) => n + 1);
      关(!失焦);
    } catch {
      失败的.current = JSON.stringify(输入);
      set错("没存上，请稍后再试");
    } finally {
      在存.current = false;
      set忙(false);
    }
  }

  if (!开着) {
    return (
      <div
        className="proj-inline"
        data-inline-field={名}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) return;
          if (window.getSelection()?.toString()) return;
          开();
        }}
      >
        <div className={`proj-inline-val${多行 && !一行显示 ? " is-multi" : ""}`}>{显示(现)}</div>
        {刚存 > 0 && <span key={刚存} className="pd-inline-ok" role="status" aria-label={`${名}已保存`}>✓</span>}
        <button
          ref={笔}
          type="button"
          className="proj-inline-pen"
          aria-label={`改${名}`}
          title={`改${名}`}
          onClick={(e) => {
            e.stopPropagation();
            开();
          }}
        >
          <EditOutlined aria-hidden />
        </button>
      </div>
    );
  }

  const 按键 = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      return 关(true);
    }
    if (e.key !== "Enter") return;
    // 下拉框里的回车是选项用的，这里不抢
    if ((e.target as HTMLElement).getAttribute("role") === "combobox") return;
    if (多行 ? e.metaKey || e.ctrlKey : 回车存) {
      e.preventDefault();
      void 提交();
    }
  };

  return (
    <div
      className="proj-inline-edit"
      data-inline-field={名}
      aria-busy={忙 || undefined}
      onKeyDown={按键}
      // 失焦即存（dt.field）：焦点真离开这一格才存——点进这一格自己的下拉 / 日期面板（挂在 body 上）不算，等一拍看焦点落到哪
      onBlur={(e) => {
        const 格 = e.currentTarget;
        if (格.contains(e.relatedTarget as Node | null)) return;
        window.setTimeout(() => {
          const 活 = document.activeElement;
          if (活 && 活 !== document.body && (格.contains(活) || 活.closest(".ant-select-dropdown, .ant-picker-dropdown, .ant-cascader-dropdown, .ant-popover, .ant-dropdown"))) return;
          void 提交(undefined, true);
        }, 0);
      }}
    >
      <编辑区 编辑器={编辑器} 草稿={草稿} set草稿={set草稿} 提交={(v) => void 提交(v)} 忙={忙} />
      {错 && <div className="proj-inline-err" role="alert">{错}</div>}
      <div className="proj-inline-acts" ref={按钮排}>
        <span className="proj-inline-hint" role={忙 ? "status" : undefined}>
          {忙 ? "存着…" : 多行 ? <><Shortcut>⌘↵</Shortcut> 或点别处保存 · Esc 还原</> : 回车存 ? "回车或点别处保存 · Esc 还原" : "点别处保存 · Esc 还原"}
        </span>
      </div>
    </div>
  );
}

/** 编辑器是外面传的渲染函数（每次渲染都是新函数），只调用、不当组件挂，不然每打一个字输入框就重建一次 */
function 编辑区<T>({ 编辑器, ...参数 }: 编辑器参数<T> & { 编辑器: (a: 编辑器参数<T>) => ReactNode }) {
  return <>{编辑器(参数)}</>;
}
