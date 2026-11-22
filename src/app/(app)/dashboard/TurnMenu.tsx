"use client";

import { Dropdown } from "antd";
import { CopyOutlined, DeleteOutlined, EllipsisOutlined, MessageOutlined } from "@ant-design/icons";
import type { RefObject } from "react";
import { useCopy } from "@/lib/clipboard";

/** 「引用到新问题」：从这一轮往上冒到对话根（.cli），Composer 在那儿接住、把引用填进输入框 */
export const 引用事件 = "cli:quote";

/** 回答里有没有表格（markdown 以 | 开头的行） */
export const 有表格 = (text: string) => /^\s*\|.*\|/m.test(text);

/**
 * 把这一轮回答里画出来的表格转成制表符分隔的文本（贴进 Excel / 表格软件就是一格一格的）。
 * 读画好的表格而不是重新切 markdown：切格（「|」在名字里）只在 Markdown.tsx 一处认。
 */
export function 表格转文本(根: HTMLElement | null): string {
  if (!根) return "";
  const 表们 = [...根.querySelectorAll<HTMLTableElement>(".cli-a .md-table")];
  return 表们
    .map((t) =>
      [...t.rows]
        .map((r) => [...r.cells].map((c) => (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim()).join("\t"))
        .join("\n"),
    )
    .join("\n\n");
}

/** 引用哪一段：人在这一轮回答里选了字就引用选中的，没选就引用这一问 */
function 引用片段(根: HTMLElement | null, 问句: string): string {
  const 选 = typeof window !== "undefined" ? window.getSelection() : null;
  const 字 = 选?.toString().replace(/\s+/g, " ").trim() ?? "";
  if (字 && 根 && 选 && 选.rangeCount > 0 && 根.contains(选.getRangeAt(0).commonAncestorContainer)) {
    return 字.length > 120 ? `${字.slice(0, 120)}…` : 字;
  }
  const q = 问句.replace(/\s+/g, " ").trim();
  return q.length > 40 ? `${q.slice(0, 40)}…` : q;
}

/**
 * 回答下操作行的 ⋯（设计语言 HC-2a，用户 11-22 选 C8-A；只现状主题）：
 *   复制为表格（回答里有表格才出）· 引用到新问题 · ── · 移除这一轮（红字）
 * 往上弹（对话在框里滚，往下弹会被输入框挡住）；浮层挂在 body 上，不被消息区裁掉。
 * 移除照旧原地收成「已移除… 撤销」，不另弹确认。
 */
export default function TurnMenu({ 根, 问句, 表格, on移除 }: {
  根: RefObject<HTMLDivElement | null>;
  问句: string;
  /** 回答里有表格：多一项「复制为表格」 */
  表格: boolean;
  on移除: () => void;
}) {
  const 复制 = useCopy();
  const items = [
    ...(表格 ? [{ key: "table", icon: <CopyOutlined />, label: "复制为表格" }] : []),
    { key: "quote", icon: <MessageOutlined />, label: "引用到新问题" },
    { type: "divider" as const },
    { key: "remove", icon: <DeleteOutlined />, label: "移除这一轮", danger: true },
  ];
  return (
    <Dropdown
      trigger={["click"]}
      placement="topRight"
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === "table") void 复制(表格转文本(根.current), "已复制表格");
          else if (key === "quote") 根.current?.dispatchEvent(new CustomEvent(引用事件, { bubbles: true, detail: 引用片段(根.current, 问句) }));
          else if (key === "remove") on移除();
        },
      }}
    >
      <button type="button" className="cli-ic" aria-label="这一轮的更多操作">
        <EllipsisOutlined />
      </button>
    </Dropdown>
  );
}
