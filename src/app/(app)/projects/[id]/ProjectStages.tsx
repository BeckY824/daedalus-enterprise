"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CheckOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import { categorical, palette } from "@/lib/palette";
import { 阶段们 } from "@/lib/project/nodes";
import type { 阶段字典 } from "@/lib/project/stage-dict";

/** 三大阶段的颜色，和数据页项目统计（overview/ProjectStatsView.tsx）同一套 */
const 阶段色: Record<string, string> = { 线索: categorical.cyan, 商机: palette.brand, 订单: categorical.green };

/**
 * 企业版项目详情节点卡里的阶段页签（10-31 改版 R5）：线索 / 商机 / 订单三个页签，默认选项目所在的阶段；
 * 面板只列选中那个阶段的进程（按字典，不写死），走过的打勾、当前的标「当前」带一圈、没走到的空心。结局不当阶段摆，跟在当前进程后面。
 * 看别的阶段只能看，不能动。
 * 「完成节点 ▼」「新增沟通」摆在页签那一行右边（M-节点-04 / U-项目-06）：按钮由父组件给，
 * 这里只告诉它现在看的是不是所在阶段——不是就灰掉，写「只能在当前阶段操作」（设计稿 §7.3）。推不了的原因跟在下面。
 * F-项目-19：不再挂「当前阶段」小标，不在的阶段页签字灰着（还能点开看）。
 * A-12：线索列表末尾挂「已转商机」、商机列表末尾挂「商机赢单」（叫法按字典 出口们），走过了打勾
 * 父组件用 key={所在阶段} 挂：阶段变了，页签跟着回到新的所在阶段
 */
export default function ProjectStages({ 字典, 所在阶段, 所在进程, 结局, 结局色, 成功交付, 动作, 提示 }: {
  字典: 阶段字典;
  所在阶段: string;
  所在进程: string;
  结局: string | null;
  结局色?: string;
  成功交付: boolean;
  /** 参数是「看的不是所在阶段」时的灰掉原因，看的是所在阶段时为 undefined */
  动作?: (不在当前: string | undefined) => ReactNode;
  提示?: string;
}) {
  const [看, set看] = useState(所在阶段);
  const 签们 = useRef<(HTMLButtonElement | null)[]>([]);
  const 所在序 = 阶段们.indexOf(所在阶段 as never);
  const 看序 = 阶段们.indexOf(看 as never);
  const 节点们 = 字典.节点们[看 as (typeof 阶段们)[number]] ?? [];
  const 当前序 = 看 === 所在阶段 ? 节点们.indexOf(所在进程) : -1;
  const 态 = (i: number): "done" | "cur" | "todo" =>
    看序 < 所在序 || (看 === 所在阶段 && (成功交付 || i < 当前序)) ? "done" : 看 === 所在阶段 && i === 当前序 ? "cur" : "todo";
  // A-12：线索、商机走成的那个出口（已转商机 / 商机赢单）挂在节点列表末尾；项目已经到了后面的阶段 = 走过了
  const 出口 = 看 === "线索" || 看 === "商机" ? 字典.出口们[看][0].叫法 : null;
  const 出口走过 = 看序 < 所在序;
  // 页签键盘：左右键换、Home / End 到头（WAI-ARIA tabs）
  const 按键 = (e: KeyboardEvent, i: number) => {
    const 到 = e.key === "ArrowRight" ? (i + 1) % 阶段们.length : e.key === "ArrowLeft" ? (i + 阶段们.length - 1) % 阶段们.length : e.key === "Home" ? 0 : e.key === "End" ? 阶段们.length - 1 : -1;
    if (到 < 0) return;
    e.preventDefault();
    set看(阶段们[到]);
    签们.current[到]?.focus();
  };
  return (
    <div className="proj-stages">
      <div className="proj-stage-bar">
        <div className="proj-stage-tabs" role="tablist" aria-label="项目阶段">
          {阶段们.map((s, i) => (
            <button
              key={s}
              ref={(el) => { 签们.current[i] = el; }}
              type="button"
              role="tab"
              id={`proj-stage-tab-${i}`}
              aria-selected={看 === s}
              aria-controls="proj-stage-panel"
              tabIndex={看 === s ? 0 : -1}
              className={`proj-stage-tab${看 === s ? " is-on" : ""}${s === 所在阶段 ? " is-here" : " is-away"}`}
              style={{ ["--stage-c" as string]: 阶段色[s] }}
              onClick={() => set看(s)}
              onKeyDown={(e) => 按键(e, i)}
            >
              <span className="proj-stage-dot" aria-hidden />
              {s}
            </button>
          ))}
        </div>
        {动作 && <div className="proj-stage-acts">{动作(看 === 所在阶段 ? undefined : "只能在当前阶段操作")}</div>}
      </div>
      {提示 && <div className="proj-stage-note proj-stage-why">{提示}</div>}
      <div id="proj-stage-panel" role="tabpanel" aria-labelledby={`proj-stage-tab-${看序}`} className="proj-stage-panel" style={{ ["--stage-c" as string]: 阶段色[看] }}>
        {看 !== 所在阶段 && (
          <div className="proj-stage-note">{看序 < 所在序 ? `「${看}」阶段已经走完` : `还没到「${看}」阶段`}，只能看，不能改</div>
        )}
        <ol className="proj-stage-nodes">
          {节点们.map((n, i) => {
            const t = 态(i);
            return (
              <li key={n} className={`proj-stage-node is-${t}`} aria-current={t === "cur" ? "step" : undefined}>
                <span className="proj-stage-mark" aria-hidden>{t === "done" && <CheckOutlined />}</span>
                <span className="proj-stage-name" title={n}>{n}</span>
                {t === "cur" && <span className="proj-stage-cur">当前</span>}
                {t === "cur" && 结局 && <Tag color={结局色} style={{ marginInlineEnd: 0 }}>{结局}</Tag>}
              </li>
            );
          })}
          {出口 && (
            <li className={`proj-stage-exit is-${出口走过 ? "done" : "todo"}`}>
              <span className="proj-stage-mark" aria-hidden>{出口走过 && <CheckOutlined />}</span>
              <span className="proj-stage-name">{出口}</span>
            </li>
          )}
        </ol>
        {成功交付 && 看 === 所在阶段 && 结局 && <div className="proj-stage-note"><Tag color={结局色}>{结局}</Tag></div>}
      </div>
    </div>
  );
}
