"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EditOutlined } from "@ant-design/icons";
import Shortcut from "@/components/Shortcut";
import { useViewAs } from "@/components/ViewAsContext";
import { useFormDraft, useDraftScope } from "@/components/FormDraft";
import { 动作出错话 } from "@/lib/stale-deploy";

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
 * - 钱格敲了认不出的字（AmountInput 交 NaN）：「改没改」用 串 比（NaN ≠ 空），照样交给 存 说为什么；草稿里 NaN 换回原值（11-20 审查）
 * - 转交（11-25 审查）：这次的值这一格自己存不了、要先填另一格（物流状态选「运输中」而单号空着）——不发请求，这一格回到原值收起，
 *   外面去开那一格；打开 = 外面让这一格打开的信号（每加一次开一次，输入框自己 autoFocus）；附言 = 编辑态多写的一行（为什么被带过来）
 * - 败后还原（下拉格用）：服务端拒了，格子回到原值、原因照样写在下面，不留着一个存不上的选项
 *
 * 客户页的 InlineField 绑死了 patchCustomer，不能复用，这里只借它的按键习惯
 */
/**
 * 比「改没改」、记「哪份草稿没存上」用的串。NaN（金额框敲了认不出的字）JSON 会写成 null：
 * 原值空着时「约5万」的草稿 {数: NaN} 和 {数: null} 一个串，提交会当没改直接收起、字丢了也没一句话（审查 11-20）。这里 NaN 单独记
 */
function 串(v: unknown): string {
  return JSON.stringify(v, (_, x) => (typeof x === "number" && Number.isNaN(x) ? "\u0000NaN" : x)) ?? "";
}

/**
 * 留草稿用的值：一格里认不出的金额（NaN）换回打开时的值——JSON 存不了 NaN，存成 null 带回再保存就把原金额清掉了（审查 11-20）。
 * 认不出的那几个字本来就要人重敲，草稿里只留别的（比如改过的币种）
 */
function 去认不出<T>(草稿: T, 原: T): T {
  if (typeof 草稿 === "number" && Number.isNaN(草稿)) return 原;
  if (!草稿 || typeof 草稿 !== "object" || Array.isArray(草稿)) return 草稿;
  const 原格 = (原 && typeof 原 === "object" ? 原 : {}) as Record<string, unknown>;
  let 改了 = false;
  const 出: Record<string, unknown> = { ...(草稿 as Record<string, unknown>) };
  for (const [k, x] of Object.entries(出)) {
    if (typeof x === "number" && Number.isNaN(x)) {
      出[k] = 原格[k] ?? null;
      改了 = true;
    }
  }
  return 改了 ? (出 as T) : 草稿;
}

/** 钱格（lib/project/inline-edit 的 钱格值）：{ 数, 币 } */
function 钱格样(v: unknown): v is { 数: unknown; 币: unknown } {
  return !!v && typeof v === "object" && "数" in v && "币" in v;
}

export default function ProjectInlineField<T>({ 名, 值, 显示, 编辑器, 存, 能改, 多行 = false, 一行显示 = false, 回车存 = false, 规整, 转交, 打开, 附言, 收起时, 败后还原 = false }: {
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
  /** 返回 true = 这个值交给外面处理（不发请求）：这一格回到原值收起，焦点不抢回笔上（外面会开另一格） */
  转交?: (v: T) => boolean;
  /** 外面让这一格打开：数变了（且 > 0）就打开 */
  打开?: number;
  /** 编辑态多写的一行 */
  附言?: ReactNode;
  /** 收起了（存上、Esc、没改失焦、转交）都调 */
  收起时?: () => void;
  /** 存失败时草稿回到原值（下拉格：不留一个存不上的选项），原因照样写 */
  败后还原?: boolean;
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
  /*
    K7（设计语言 E2）：回车 / 选了就存、没存上（金额敲了「约5万」）——存的那一下框是灰的（disabled），焦点掉到页面上：
    Esc 按了没人接（还原不了），金额框的「认不出」浮层也挂着不走。没存上之后把焦点放回这一格的输入框：Esc 照常还原、浮层跟着焦点走。
    失焦存的不抢回焦点（人已经点去别处了）
  */
  const 编辑格 = useRef<HTMLDivElement>(null);
  const [错后回焦, set错后回焦] = useState(0);
  const 回过焦 = useRef(0);

  const 键 = JSON.stringify(值);
  if (乐观 && 乐观.基准 !== 键) set乐观(null);
  const 现 = 乐观 && 乐观.基准 === 键 ? 乐观.值 : 值;
  /*
    打了没存上的字留草稿（11-17，components/FormDraft.tsx）：存失败、刷新、发版后重开这一格接着改。
    键 = 外面包的记录（项目详情给 `项目:<id>`）+ 这一格的名字；没包就不存。存上了 / Esc 还原就删
  */
  const 范围 = useDraftScope();
  const 稿 = useFormDraft({
    键: 范围 ? `${范围}:就地:${名}` : null,
    开: 开着,
    值: { v: 去认不出(草稿, 现) as unknown },
    带回: (x) => {
      if (x.v === undefined) return;
      // 钱格的 数 只带回有限数或 null（清掉）；别的（缺了、字串、NaN 写成的怪值）留现值，不拿去存
      const 带 = x.v as T;
      if (钱格样(带) && 钱格样(现) && 带.数 !== null && !(typeof 带.数 === "number" && Number.isFinite(带.数))) set草稿({ ...带, 数: 现.数 } as T);
      else set草稿(带);
    },
    紧凑: true,
  });

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
    if (忙 || !开着 || 错后回焦 === 回过焦.current) return;
    回过焦.current = 错后回焦;
    编辑格.current?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), [role=combobox]")?.focus();
  }, [忙, 开着, 错后回焦]);

  useEffect(() => {
    if (!刚存) return;
    const t = setTimeout(() => set刚存(0), 1400);
    return () => clearTimeout(t);
  }, [刚存]);

  // 外面让这一格打开（转交过来的）：同 开，只认数变了的那一次；收着才开，已经开着的不动草稿
  const 开过 = useRef(打开 ?? 0);
  useEffect(() => {
    if (!打开 || 打开 === 开过.current) return;
    开过.current = 打开;
    if (!收起了.current) return;
    set草稿(现);
    set错(null);
    失败的.current = null;
    收起了.current = false;
    set开着(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟信号走，现值在开的那一刻取
  }, [打开]);

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
    收起时?.();
  };

  async function 提交(传的?: T, 失焦 = false) {
    if (在存.current || 收起了.current) return;
    const 输入 = 传的 === undefined ? 草稿 : 传的;
    set草稿(输入);
    const v = 规整 ? 规整(输入) : 输入;
    // 用 串 比：认不出的金额（NaN）不能和「空着」算一样，要交给 存 说为什么
    if (串(v) === 串(现)) return 关(!失焦);
    if (失焦 && 失败的.current === 串(输入)) return;
    if (转交?.(v)) {
      稿.丢掉();
      return 关(false);
    }
    在存.current = true;
    set忙(true);
    set错(null);
    try {
      const 话 = await 存(v);
      if (话) {
        失败的.current = 串(输入);
        if (败后还原) set草稿(现);
        if (!失焦) set错后回焦((n) => n + 1);
        return set错(话);
      }
      稿.存好了();
      set乐观({ 基准: 键, 值: v });
      set刚存((n) => n + 1);
      关(!失焦);
    } catch (e) {
      失败的.current = 串(输入);
      if (败后还原) set草稿(现);
      if (!失焦) set错后回焦((n) => n + 1);
      set错(动作出错话(e, "没存上，请稍后再试"));
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
      稿.丢掉();
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
      ref={编辑格}
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
      {附言 && <div className="proj-inline-hint" role="status">{附言}</div>}
      {错 && <div className="proj-inline-err" role="alert">{错}</div>}
      {稿.提示}
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
