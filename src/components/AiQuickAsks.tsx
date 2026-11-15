"use client";
/**
 * AI 浮窗空屏里的快捷项（原型 dt.ai：客户页带「客户 · 名字」时，输入框下面三颗）。
 * 一项要么是「问」——把问句交给输入框直接发出去，走现有对话；要么是「动作」——比如打开原来的智能总结抽屉（lib/ai-float.ts）。
 * HomeChat 窄模式空屏里摆它，问 = Composer 的 问()；它自己不碰对话。
 */
export type 快捷项 = { label: string; 问?: string; 动作?: () => void };

export default function AiQuickAsks({ 项, 问 }: { 项: readonly 快捷项[]; 问: (q: string) => void }) {
  if (项.length === 0) return null;
  return (
    <div className="cli-quick" role="group" aria-label="快捷提问">
      {项.map((x) => (
        <button key={x.label} type="button" className="cli-quick-i" onClick={() => (x.动作 ? x.动作() : x.问 && 问(x.问))}>
          {x.label}
        </button>
      ))}
    </div>
  );
}
