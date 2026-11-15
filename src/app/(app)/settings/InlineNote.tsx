"use client";
/**
 * 设置各页签的就地提示（原型 g.save「不弹顶部提示」）：成没成写在这一页签底部一条贴边的小条里，跟着页签走、过一会儿自己收。
 * 用法和 antd 的 message 一样顺手（变量各处叫「就地」，免得和顶部提示混）：const [就地, 提示条] = useSettingsNote(); … 就地.success("已保存") … {提示条}
 * 能做成按钮内反馈的（SaveButton）、能撤销的（showUndo）优先用那两个；这里接住其余零散的「已改好 / 没改成」。
 * 读屏：role=status（出错 role=alert），一条覆盖上一条
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type 调 = "成" | "错" | "提醒";
type 一条 = { 话: ReactNode; 调: 调; 序: number };

/** 成功停 2.4 秒、出错 / 提醒停 5 秒（要读原因） */
const 停 = { 成: 2400, 错: 5000, 提醒: 5000 } as const;

export function useSettingsNote(): [{ success: (话: ReactNode) => void; error: (话: ReactNode) => void; warning: (话: ReactNode) => void; info: (话: ReactNode) => void }, ReactNode] {
  const [条, set条] = useState<一条 | null>(null);
  const 计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 序 = useRef(0);
  useEffect(() => () => { if (计时.current) clearTimeout(计时.current); }, []);
  const 说 = useCallback((话: ReactNode, 调: 调) => {
    if (计时.current) clearTimeout(计时.current);
    序.current += 1;
    set条({ 话, 调, 序: 序.current });
    计时.current = setTimeout(() => set条(null), 停[调]);
  }, []);
  const api = useMemo(() => ({
    success: (话: ReactNode) => 说(话, "成"),
    error: (话: ReactNode) => 说(话, "错"),
    warning: (话: ReactNode) => 说(话, "提醒"),
    info: (话: ReactNode) => 说(话, "提醒"),
  }), [说]);
  const 节点 = 条 ? (
    <div key={条.序} className="set-note" data-tone={条.调} role={条.调 === "错" ? "alert" : "status"}>
      <span className="set-note-i" aria-hidden>{条.调 === "成" ? "✓" : "!"}</span>
      <span className="set-note-t">{条.话}</span>
    </div>
  ) : null;
  return [api, 节点];
}
