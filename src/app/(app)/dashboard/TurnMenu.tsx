"use client";

import { Dropdown, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined, EllipsisOutlined, MessageOutlined } from "@ant-design/icons";
import { useRef, type RefObject } from "react";
import { useCopy } from "@/lib/clipboard";

/** 「引用到新问题」：从这一轮往上冒到对话根（.cli），Composer 在那儿接住、把引用填进输入框 */
export const 引用事件 = "cli:quote";

/** 输入框开头已有的「关于「…」：」引用（「引用到新问题」填的；连着几层一起认） */
const 已有引用 = /^(?:关于「[\s\S]*?」：)+/;

/** 把引用填到输入框最前面：连着引用两次不叠成两层「关于「…」：关于「…」：」——先去掉开头已有的引用，再加这一次的（#420 审查） */
export const 加引用 = (原: string, 片段: string) => `关于「${片段}」：` + 原.replace(已有引用, "");

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

/** 这一轮回答里选中的字（选区不在这一轮里 = 没选） */
function 选中的字(根: HTMLElement | null): string {
  const 选 = typeof window !== "undefined" ? window.getSelection() : null;
  const 字 = 选?.toString().replace(/\s+/g, " ").trim() ?? "";
  if (!字 || !根 || !选 || 选.rangeCount === 0 || !根.contains(选.getRangeAt(0).commonAncestorContainer)) return "";
  return 字.length > 120 ? `${字.slice(0, 120)}…` : 字;
}

/** 引用哪一段：人在这一轮回答里选了字就引用选中的（按下 ⋯ / 菜单打开那一刻存下的），没选就引用这一问 */
function 引用片段(选中: string, 问句: string): string {
  if (选中) return 选中;
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
  /*
    选区要在按下 ⋯ / 菜单打开那一刻存下来（#420 审查）：点菜单项时焦点已到菜单、点击也可能把选区收掉，
    那时再读 getSelection 常常是空的，「引用选中的字」就退成引用问句了
  */
  const 选中 = useRef("");
  const 记选区 = () => {
    选中.current = 选中的字(根.current);
  };
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
      autoFocus
      onOpenChange={(开) => {
        // 键盘打开（回车 / 空格）没有按下那一下；按下时已存过的，这里只在还读得到选区时再补
        if (!开) return;
        const 字 = 选中的字(根.current);
        if (字) 选中.current = 字;
      }}
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === "table") void 复制(表格转文本(根.current), "已复制表格");
          else if (key === "quote") 根.current?.dispatchEvent(new CustomEvent(引用事件, { bubbles: true, detail: 引用片段(选中.current, 问句) }));
          else if (key === "remove") on移除();
        },
      }}
    >
      <Tooltip title="更多" trigger={["hover", "focus"]}>
        <button type="button" className="cli-ic" aria-label="这一轮的更多操作" onPointerDown={记选区} onKeyDown={记选区}>
          <EllipsisOutlined />
        </button>
      </Tooltip>
    </Dropdown>
  );
}
