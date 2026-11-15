"use client";
import { useEffect, useState } from "react";
import Shortcut, { useModifierKey } from "@/components/Shortcut";

/**
 * 快捷键一览。**只读**——列的是代码里真接了的那几个，不是愿望清单。
 *
 * 为什么值得有一栏：这些键散在四处（⌘K 在 CommandBar、Enter / 斜杠在输入框、
 * ⌘1–9 在桌面端的「前往」菜单），不打开源码没人知道它们存在。
 * 首页输入框下面那行提示只说得下三个，剩下的等于不存在。
 *
 * 加新快捷键时**记得回来加一行**：一份对不上的清单比没有清单更坏。
 */
const 组: { 名: string; 项: { 键: string[]; 说明: string }[] }[] = [
  {
    名: "到处走",
    项: [
      { 键: ["⌘", "K"], 说明: "跳到任意一页；已经在有输入框的页面上时，光标回到输入框" },
      { 键: ["⌘", "N"], 说明: "在当前页新建——它点的就是页头右上角那个主按钮" },
      // 原型 st.keys：补上漏的两个（AiDock.tsx ⌘J、lib/middle-pane.ts ⌘\）。⌘, 是桌面端菜单，企业版网页没有，不列
      { 键: ["⌘", "J"], 说明: "打开 / 收起右边的 AI 栏" },
      { 键: ["⌘", "\\"], 说明: "收起 / 放出中间那一栏（名单）" },
    ],
  },
  {
    名: "问一句的时候",
    项: [
      { 键: ["Enter"], 说明: "发送" },
      { 键: ["Shift", "Enter"], 说明: "换行" },
      { 键: ["/"], 说明: "在空输入框里打斜杠，出命令单" },
      { 键: ["Esc"], 说明: "打断正在答的那一问（页面任何地方按都行）" },
      { 键: ["Ctrl", "C"], 说明: "也能打断——光标在输入框里、又没选中文字时" },
    ],
  },
];

/** 这一下按的是不是这一行（⌘ 认 Meta 或 Ctrl） */
function 按中(键: string[], e: KeyboardEvent): boolean {
  const 要命令 = 键.includes("⌘") || 键.includes("Ctrl");
  if (要命令 !== (e.metaKey || e.ctrlKey)) return false;
  if (键.includes("Shift") !== e.shiftKey) return false;
  const 主 = 键[键.length - 1];
  return 主.length === 1 ? e.key.toLowerCase() === 主.toLowerCase() || (主 === "\\" && e.code === "Backslash") : e.key === 主;
}

export default function KeymapTab() {
  const modifier = useModifierKey();
  // 原型 st.keys：按下时对应那一行亮一下（不拦按键，照常生效）
  const [亮, set亮] = useState<{ 行: string; 次: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const 中 = 组.flatMap((g) => g.项).find((x) => 按中(x.键, e));
      if (中) set亮((p) => ({ 行: 中.键.join("+") + 中.说明, 次: (p?.次 ?? 0) + 1 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="set-body">
      {组.map((g) => {
        const 项 = g.项;
        return (
          <div key={g.名} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{g.名}</div>
            <div className="keymap">
              {项.map((x) => (
                <div
                  key={x.键.join("+") + x.说明 + (亮?.行 === x.键.join("+") + x.说明 ? 亮.次 : "")}
                  className={`keymap-row${亮?.行 === x.键.join("+") + x.说明 ? " keymap-hit" : ""}`}
                >
                  <div className="keymap-keys">
                    {x.键.map((k) => (
                      <kbd key={k}>{k === "⌘" ? modifier.replace("+", "") : k}</kbd>
                    ))}
                  </div>
                  <span><Shortcut>{x.说明}</Shortcut></span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        {modifier === "⌘" ? "⌘ 是 Command 键。" : "Ctrl 是 Control 键。"}
      </p>
    </div>
  );
}
