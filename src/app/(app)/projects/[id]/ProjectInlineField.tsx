"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EditOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Shortcut from "@/components/Shortcut";
import { useViewAs } from "@/components/ViewAsContext";

/** 编辑器拿到的：草稿、改草稿、提交（下拉、日期选了就存，传选中的值，不等 setState）、在不在存 */
export type 编辑器参数<T> = { 草稿: T; set草稿: (v: T) => void; 提交: (v?: T) => void; 忙: boolean };

/**
 * 项目详情卡片上就地改一格（11-02）。保存走外面给的 存（编辑项目 / 改项目沟通，服务端照旧判权限、留痕），这里不写库。
 *
 * - 没权限（能改 = false）、切换视图中只渲染 显示，DOM 里没有入口
 * - 点这一格或那颗小笔进入编辑；选中文字时不进（方便复制）
 * - 单行 Enter 存（回车存），多行 ⌘↵ / Ctrl+↵ 存，Esc 放弃；中文输入法选字时的回车、Esc 不算
 * - 不做失焦自动存：点到别处不会悄悄改掉，也不会丢（输入留着，还开着）；改了字点到别处，行内提示「还没保存」（A8-2）
 * - 打开时把「保存」那排滚进可视区（1024×768 下右栏多行备注的按钮常落在屏幕外，A8-2）
 * - 存失败（存 返回一句话、或抛错）：留在编辑态、输入不丢、行内写原因
 * - 存成功先显示新值，等 router.refresh 带回新 props 就听服务端的（值变了清掉乐观值，渲染时比，不用 effect）
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
  const [没存, set没存] = useState(false);
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

  // 打开后「保存 / 取消」也要看得见：滚到最近的可视位置，已经在屏幕里就不动
  useEffect(() => {
    if (开着) 按钮排.current?.scrollIntoView?.({ block: "nearest" });
  }, [开着]);

  if (!能改 || 视图中) return <>{显示(现)}</>;

  const 开 = () => {
    set草稿(现);
    set错(null);
    set没存(false);
    set开着(true);
  };
  const 关 = () => {
    回焦.current = true;
    set开着(false);
    set错(null);
    set没存(false);
  };

  async function 提交(传的?: T) {
    if (在存.current) return;
    const 输入 = 传的 === undefined ? 草稿 : 传的;
    set草稿(输入);
    const v = 规整 ? 规整(输入) : 输入;
    if (JSON.stringify(v) === JSON.stringify(现)) return 关();
    在存.current = true;
    set忙(true);
    set错(null);
    try {
      const 话 = await 存(v);
      if (话) return set错(话);
      set乐观({ 基准: 键, 值: v });
      关();
    } catch {
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
      return 关();
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
      onKeyDown={按键}
      onFocus={() => set没存(false)}
      // 焦点离开这一格（点到页面别处）且改过：提示还没存，输入照留
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        const v = 规整 ? 规整(草稿) : 草稿;
        if (JSON.stringify(v) !== JSON.stringify(现)) set没存(true);
      }}
    >
      <编辑区 编辑器={编辑器} 草稿={草稿} set草稿={set草稿} 提交={(v) => void 提交(v)} 忙={忙} />
      {错 && <div className="proj-inline-err" role="alert">{错}</div>}
      {!错 && 没存 && <div className="proj-inline-err" role="status">还没保存：点「保存」存下，或「取消」放弃</div>}
      <div className="proj-inline-acts" ref={按钮排}>
        <Button size="small" type="primary" loading={忙} onClick={() => void 提交()}>保存</Button>
        <Button size="small" disabled={忙} onClick={关}>取消</Button>
        {多行 && <span className="proj-inline-hint"><Shortcut>⌘↵</Shortcut> 保存 · Esc 放弃</span>}
      </div>
    </div>
  );
}

/** 编辑器是外面传的渲染函数（每次渲染都是新函数），只调用、不当组件挂，不然每打一个字输入框就重建一次 */
function 编辑区<T>({ 编辑器, ...参数 }: 编辑器参数<T> & { 编辑器: (a: 编辑器参数<T>) => ReactNode }) {
  return <>{编辑器(参数)}</>;
}
