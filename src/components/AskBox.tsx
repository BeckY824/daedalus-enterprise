"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { 登记页内占用 } from "@/lib/roster";
import { ArrowUpOutlined } from "@ant-design/icons";

/**
 * 问一句的那个输入框。**首页和「数据」页用的是同一个。**
 *
 * 原来两处各写一个：首页是带命令、排队、建议卡的对话框，数据页是 antd 的
 * Input.Search。边框、字号、快捷键、占位文案全都不一样——用的人会以为那是两种能力，
 * 而它们问的是同一个后端。
 *
 * 这里只管**框本身**：外形、自适应高度、Enter 发送 / Shift+Enter 换行。
 * ⌘K 不在这儿——它由 components/CommandBar 一个人管：有框的页面把光标放回框里，
 * 没框的页面弹跳转单。两边各写一份的话，迟早在某一页上打架。
 * 上面要不要挂命令单、下面要不要挂提示和建议、发送键点了干什么，
 * 都由用的那一页自己给——两页要答的东西不一样，答案怎么画本来就该各管各的。
 */
export default function AskBox({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  onPaste,
  placeholder,
  disabled,
  maxLength = 1000,
  发送,
  上方,
  底部,
  栏左,
  栏右,
  引用,
  on拖文件,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** 先给这一页自己处理；调了 preventDefault 就不再走默认的 Enter 发送 */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /**
   * 粘进来了什么。**框里那份可能是截断过的**（textarea 有 maxLength），
   * 要全文得从 `e.clipboardData` 里拿——首页靠它认出「这是一段聊天记录」。
   */
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  disabled?: boolean;
  maxLength?: number;
  /** 右边那个键。不给就用默认的发送箭头 */
  发送?: React.ReactNode;
  上方?: React.ReactNode;
  底部?: React.ReactNode;
  /**
   * 框**里面**那一条：左边放动作（加文件），右边放选择（模型），发送键永远在最右。
   * 照 Claude Code / Codex 那个形状——动作和输入在同一个框里，不是散在框外的一行提示。
   * 不给就还是原来那样：一行，提示符 + 输入 + 发送键。
   */
  栏左?: React.ReactNode;
  栏右?: React.ReactNode;
  引用?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * 拖文件进框（home.ask）：给了才认拖放——拖进来框亮起、说「松开即带上文件」，松开把第一个文件交给它（和回形针选文件走同一个函数）。
   * 不给 = 这个入口不收附件，拖进来不亮、浏览器照默认处理
   */
  on拖文件?: (f: File) => void;
}) {
  const 自己的 = useRef<HTMLTextAreaElement>(null);
  const ta = 引用 ?? 自己的;
  const [拖着, set拖着] = useState(false);
  /** 拖的是文件（不是选中的一段字）才接 */
  const 是文件 = (e: React.DragEvent) => !!on拖文件 && Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const 拖放 = on拖文件
    ? {
        onDragEnter: (e: React.DragEvent) => { if (!是文件(e)) return; e.preventDefault(); set拖着(true); },
        onDragOver: (e: React.DragEvent) => { if (!是文件(e)) return; e.preventDefault(); if (!拖着) set拖着(true); },
        // 移到框里的子元素上也会发 dragleave：只有真的出了这个框才收
        onDragLeave: (e: React.DragEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set拖着(false); },
        onDrop: (e: React.DragEvent) => {
          if (!是文件(e)) return;
          e.preventDefault();
          set拖着(false);
          const f = e.dataTransfer.files?.[0];
          if (f) on拖文件(f);
        },
      }
    : {};

  /**
   * 自适应高度。**跟着 value 走，不是跟着 onChange 走**——
   * 填进来的字不一定来自敲键盘：点命令补全、点建议、恢复草稿、发完清空都是直接改 value，
   * 挂在 onChange 上的那版对这些一概不长高（也不缩回去）。
   * 上限在 CSS 的 max-height，超过了框内自己滚。
   */
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    // 藏着的时候量不出东西（scrollHeight 是 0），别把 0px 写死在上面——
    // 等它显出来那一下就是个压扁的框，而那时候 value 没变、这个 effect 不会再跑
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [value, ta]);

  /* 页内的问答框占着 ⌘K（CommandBar 先把光标给它），左栏的搜索框就不写「⌘K」。右边面板里那个不算，见 lib/roster.ts */
  useEffect(() => {
    if (ta.current?.closest(".dock")) return;
    return 登记页内占用();
  }, [ta]);

  return (
    <>
      {上方}
      <div className={`cli-input${栏左 || 栏右 ? " cli-input-rich" : ""}${拖着 ? " is-drop" : ""}`} {...拖放}>
        {拖着 && <div className="cli-drop-hint" aria-live="polite">松开即带上文件</div>}
        {!(栏左 || 栏右) && <span className="cli-prompt">›</span>}
        <textarea
          ref={ta}
          value={value}
          rows={1}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {栏左 || 栏右 ? (
          <div className="cli-bar2">
            <div className="cli-bar2-l">{栏左}</div>
            <div className="cli-bar2-r">
              {栏右}
              {发送 ?? (
                <button type="button" className="cli-send" onClick={onSubmit} disabled={!value.trim()} aria-label="问">
                  <ArrowUpOutlined />
                </button>
              )}
            </div>
          </div>
        ) : (
          发送 ?? (
            <button type="button" className="cli-send" onClick={onSubmit} disabled={!value.trim()} aria-label="问">
              <ArrowUpOutlined />
            </button>
          )
        )}
      </div>
      {底部}
    </>
  );
}
