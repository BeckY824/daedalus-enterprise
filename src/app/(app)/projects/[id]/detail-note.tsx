"use client";
/**
 * 项目详情的就地回执（原型 g.save / g.notice「不弹顶部提示」）：页面上做的事（改进程、领取、勾交付……）成没成，
 * 写在详情正文底部一条贴边的小条里，跟着页面走、过一会儿自己收；出错 role=alert、停得久一点（要读原因）。
 * 弹框里做的事不走这里：原因写在框里（跑 的 报错），框不关。能按钮内反馈（SaveButton）、能撤销（showUndo）的优先用那两个。
 * 同设置页的 useSettingsNote（settings/InlineNote.tsx），样式类名换成 pd-note（settings.css 只在设置页加载）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type 调 = "成" | "错" | "提醒";
type 一条 = { 话: ReactNode; 调: 调; 序: number };

/** 成功停 2.4 秒、出错 / 提醒停 6 秒 */
const 停 = { 成: 2400, 错: 6000, 提醒: 6000 } as const;

export type 就地回执 = { success: (话: ReactNode) => void; error: (话: ReactNode) => void; warning: (话: ReactNode) => void; info: (话: ReactNode) => void };

export function useDetailNote(): [就地回执, ReactNode] {
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
    <div key={条.序} className="pd-note" data-tone={条.调} role={条.调 === "错" ? "alert" : "status"}>
      <span className="pd-note-i" aria-hidden>{条.调 === "成" ? "✓" : "!"}</span>
      <span className="pd-note-t">{条.话}</span>
      <button type="button" className="pd-note-x" aria-label="收起" onClick={() => set条(null)}>×</button>
    </div>
  ) : null;
  return [api, 节点];
}

/** 弹框里的原因：写在框底、确定键上面（role=alert） */
export function 框里原因({ 话 }: { 话: string | null }) {
  return 话 ? <div className="pd-modal-err" role="alert">{话}</div> : null;
}

/**
 * 项目详情的 跑（ProjectDetail 定义，传给项目组卡、提成卡、线索验证、编辑框、沟通框）：成了 = 就地回执那句；
 * 选.报错：没成的原因交给它（弹框里写在框里），开跑前会先用 null 清一次；没给就写在详情底部的就地小条上
 */
export type 跑法 = (
  /** 提示：成了但有一句要说的（改项目沟通 下一步没同步，低-6），接在「成了」那句后面 */
  f: () => Promise<{ ok: boolean; error?: string | null; 自动推到?: string[]; 提示?: string }>,
  成了?: string,
  选?: { 报错?: (话: string | null) => void },
) => Promise<boolean>;

/**
 * 给按钮内反馈（SaveButton / InlineConfirm / 后果框）用的 跑：没成的原因不写就地小条，交回组件自己显示（按钮上方 / 问句旁 / 框里）。
 * 成了照 跑 的规矩刷新页面；成了 那句一般不给（按钮自己会变「已保存」），自动推进那句照样写在就地小条
 */
export async function 跑给按钮(跑: 跑法, f: Parameters<跑法>[0], 成了?: string): Promise<{ ok: boolean; error?: string | null }> {
  let 错: string | null = null;
  const ok = await 跑(f, 成了, { 报错: (话) => { if (话) 错 = 话; } });
  return ok ? { ok: true } : { ok: false, error: 错 };
}
