"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { StepEvent } from "@/lib/ai-steps";
import { 一步人话, 是工具步 } from "@/lib/agent/step-summary";
import { useMotionTheme } from "@/components/MotionTheme";

/**
 * 一条回答一个状态条（2026-11-15，照前端改版交互原型「AI 助手 · 改后」）。
 *
 * 原来是每调一次工具铺一行 `get_customer(张三)` 等宽字：人看见的是工具名和参数，不是「它在干什么」。
 * 现在：
 *   头部  状态点 + 当前在做的事（人话）+「第 N 步 · X 秒」
 *   下面  最多露最近 3 步，更早的收起成「前面还有 K 步」
 *   做完  收成一行「用了 X 秒 · N 步」，点开看每一步：人话 + detail，原始调用串只在这里以灰色小字出现，thought 再折一层
 *   出错  「停在第 N 步：原因」，前面做完的步骤照样留着；给了 onRetry 才有「重试」
 *   打断  照原来的规矩：跑着的那步算完成、detail 写「被打断」（调用方映射好），头部写「已打断」
 *   等你确认  回答里还有没处理的建议卡：头部换成「等你确认 N 项」
 *
 * 首页 / 全局面板（TurnView）和客户页 AI 面板（AiPanel）共用这一个；原来的 AiTrace 和 .cli-step 那两套并进来了。
 *
 * 设计语言 HC-2a（用户 11-22 选 C7-A / C11-A）：
 *   四种状态同一行、不带框：圆点 + 人话 +「第 N 步 · X 秒」+ ›；跑着也收成一行，点 › 才竖排最近 3 步
 *   打断写「已停下 · 第 N 步」（灰点）+「重新回答」；超时写「等了 N 秒没回来」；「Esc 打断」不写在条上（停止在输入框）
 */
export type AiStatus态 = "running" | "wait" | "done" | "error" | "interrupted";

/** 平时露几步：再多头部就被挤到屏外，人反而找不到「现在在做什么」 */
const 露几步 = 3;

const 秒数 = (ms: number) => Math.max(1, Math.round(ms / 1000));

export default function AiStatus({
  steps,
  态,
  起,
  ms,
  客户,
  原因,
  超时 = false,
  写着 = false,
  等确认 = 0,
  附注,
  onRetry,
  compact = false,
}: {
  steps: StepEvent[];
  态: AiStatus态;
  /** 这一轮几点开始的（ai-jobs 的 startedAt）：跑着时按它数秒 */
  起?: number;
  /** 跑完的总耗时（服务端给的）；没有就用最后一步的时间估。出错时 = 从起到停（超时写「等了 N 秒」用） */
  ms?: number;
  /** 这家对客户的叫法 */
  客户: string;
  /** 出错时的那句原因 */
  原因?: string;
  /** 这次出错是不是超时：服务端结果事件带 code = timeout（lib/ai-stream-codes.ts）才算，不看原因文案。是才写「等了 N 秒没回来」 */
  超时?: boolean;
  /** 工具都跑完了、正在写回答 */
  写着?: boolean;
  /** 还没处理的建议卡几张（态 = wait 时用） */
  等确认?: number;
  /** 跑着时头部右边多一句，如「Esc 打断」 */
  附注?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { 曲线, 时长 } = useMotionTheme();
  const [展开, set展开] = useState(false);
  const [全露, set全露] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const 跑着 = 态 === "running";
  useEffect(() => {
    if (!跑着) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [跑着]);

  const 步们 = steps.filter((s) => s.id !== "answer");
  const 当前 = 跑着 ? 步们.find((s) => s.status === "running") : undefined;
  const 出错步 = 步们.findIndex((s) => s.status === "error");
  const 开始 = 起 ?? 步们[0]?.at;
  const 用时 = ms ?? (开始 && 步们.length ? Math.max(...步们.map((s) => s.at)) - 开始 : undefined);
  const 用了 = [用时 !== undefined && 用时 > 0 ? `用了 ${秒数(用时)} 秒` : null, 步们.length ? `${步们.length} 步` : "没查数据"].filter(Boolean).join(" · ");

  let 标题: string;
  let 尾: string | null = null;
  if (跑着) {
    // 「正在想下一步」：做完的那几步之后，下一步还没定是哪个工具——它已经是第 len + 1 步了
    标题 = 当前 ? `${一步人话(当前, true, 客户)}…` : 写着 ? "正在写回答…" : 步们.length ? "正在想下一步…" : "正在想…";
    尾 = [`第 ${当前 || 写着 ? Math.max(1, 步们.length) : 步们.length + 1} 步`, `${秒数(now - (开始 ?? now))} 秒`, 附注].filter(Boolean).join(" · ");
  } else if (态 === "error") {
    /* 超时（服务端带 code = timeout）：说等了多久——调用方给了 ms（起到停）就用它，没给就数到现在 */
    const 等了 = ms !== undefined ? 秒数(ms) : 开始 !== undefined ? 秒数(now - 开始) : undefined;
    标题 =
      超时 && 等了 !== undefined && 等了 > 1
        ? `等了 ${等了} 秒没回来`
        : 出错步 >= 0
          ? `停在第 ${出错步 + 1} 步：${原因 || "出错了"}`
          : `出错了：${原因 || "没有拿到回答"}`;
  } else if (态 === "interrupted") {
    标题 = 步们.length ? `已停下 · 第 ${步们.length} 步` : "已停下";
  } else if (态 === "wait") {
    标题 = `等你确认 ${等确认} 项`;
    尾 = 用了;
  } else {
    标题 = 用了;
  }

  /*
    收着的时候露哪几步（HC-2a）：哪种状态都收成一行，点 › 才露——跑着时露最近 3 步（更早的「前面还有 K 步」），停了露全部
  */
  const 能展开 = 步们.length > 0;
  const 可露 = 展开 ? 步们 : [];
  const 限三步 = 跑着;
  const 露的 = 全露 || !限三步 ? 可露 : 可露.slice(-露几步);
  const 藏了 = 可露.length - 露的.length;

  const 头 = (
    <>
      <span className="ais-dot" aria-hidden />
      <span className="ais-tt" title={标题}>
        {标题}
      </span>
      {尾 && <span className="ais-mt">{尾}</span>}
      {能展开 && <span className="ais-chev" aria-hidden>›</span>}
    </>
  );

  return (
    <div className={`ais ais-${态 === "interrupted" ? "stopped" : 态}${compact ? " ais-compact" : ""}`} data-state={态}>
      <div className="ais-hd" role={跑着 ? "status" : undefined} aria-live={跑着 ? "polite" : undefined}>
        {能展开 ? (
          <button type="button" className="ais-hd-b" aria-expanded={展开} onClick={() => set展开((v) => !v)}>
            {头}
          </button>
        ) : (
          <div className="ais-hd-b">{头}</div>
        )}
        {(态 === "error" || 态 === "interrupted") && onRetry && (
          <button type="button" className="cli-link ais-retry" onClick={onRetry}>
            {态 === "interrupted" ? "重新回答" : "重试"}
          </button>
        )}
      </div>
      {(露的.length > 0 || 藏了 > 0) && (
        <div className="ais-bd">
          {藏了 > 0 && (
            <button type="button" className="ais-more" onClick={() => set全露(true)}>
              前面还有 {藏了} 步
            </button>
          )}
          {露的.map((s) => (
            <motion.div key={s.id} className={`ais-row ais-row-${s.status === "error" || s.detail === "工具出错" ? "error" : s.status}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 时长.base, ease: 曲线.ease }}>
              <StepLine s={s} 客户={客户} 细={展开 && !跑着} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 一步：人话 · detail；展开时下面再垫一行原始调用串（只有工具步才有），thought 折在「它的打算」里 */
function StepLine({ s, 客户, 细 }: { s: StepEvent; 客户: string; 细: boolean }) {
  const 话 = 一步人话(s, s.status === "running", 客户);
  const 一行 = s.detail ? `${话} · ${s.detail}` : 话;
  return (
    <>
      <div className="ais-line" title={一行}>
        <span className="ais-mark" aria-hidden>
          {s.status === "error" ? "✕" : s.status === "running" ? "·" : "✓"}
        </span>
        {一行}
      </div>
      {细 && 是工具步(s) && (
        <div className="ais-raw" title={s.label}>
          {s.label}
        </div>
      )}
      {细 && s.thought && (
        <details className="ais-thought">
          <summary>它的打算</summary>
          <div title={s.thought}>{s.thought}</div>
        </details>
      )}
    </>
  );
}
