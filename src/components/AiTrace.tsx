"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { StepEvent } from "@/lib/ai-steps";
import { useMotionTheme } from "@/components/MotionTheme";

/**
 * AI 工作流的过程条，样式照 Claude Code / Codex 那类命令行的"思考轨迹"：
 * 一行一步，前面一个点（跑着的时候呼吸，做完变成实心），后面是灰字的结果摘要。
 * 跑完以后折成一行摘要（「读了 6 条跟进 · 2 段原文 · 8.2s」），点开还能看每一步。
 */
export default function AiTrace({ steps, done, ms, compact = false }: { steps: StepEvent[]; done: boolean; ms?: number; compact?: boolean }) {
  const { 曲线, 时长 } = useMotionTheme();
  const [open, setOpen] = useState(false);
  if (steps.length === 0 && !done) {
    return (
      <div className="trace">
        <div className="trace-row">
          <span className="trace-dot trace-dot-run" />
          <span className="trace-label">开始</span>
        </div>
      </div>
    );
  }
  const details = steps.filter((s) => s.detail).map((s) => s.detail as string);
  const summary = [...details, ms ? `${(ms / 1000).toFixed(1)}s` : null].filter(Boolean).join(" · ");

  if (done && !open) {
    return (
      <button type="button" className={`trace trace-summary${compact ? " trace-compact" : ""}`} onClick={() => setOpen(true)} aria-label="展开过程">
        <span className="trace-dot trace-dot-done" />
        <span className="trace-sum">{summary || `${steps.length} 步`}</span>
        <span className="trace-caret">›</span>
      </button>
    );
  }

  return (
    <div
      className={`trace${compact ? " trace-compact" : ""}`}
      onClick={() => done && setOpen(false)}
      /* 展开后整块点一下收起；里面是一行行块级的步骤，所以还是 div，但补上键盘：Tab 能到、回车/空格收起 */
      role={done ? "button" : undefined}
      tabIndex={done ? 0 : undefined}
      aria-label={done ? "收起过程" : undefined}
      onKeyDown={(e) => {
        if (done && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      <AnimatePresence initial={false}>
        {steps.map((s) => (
          <motion.div key={s.id} className="trace-row" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 时长.base, ease: 曲线.ease }}>
            <span className={`trace-dot ${s.status === "running" ? "trace-dot-run" : s.status === "error" ? "trace-dot-err" : "trace-dot-done"}`} />
            <span className="trace-label">{s.label}</span>
            {s.detail && <span className="trace-detail">{s.detail}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
      {done && ms ? <div className="trace-row trace-ms">{(ms / 1000).toFixed(1)}s</div> : null}
    </div>
  );
}
