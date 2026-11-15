"use client";
/**
 * 企业版项目模式右下角的 AI 浮标（定稿 #13：首页以外的根目录，右下角圆形 Agent 浮标，风格类似 Siri）。
 *
 * 它只是个**入口**：点了打开的是壳里现有的那块 AI 面板（AiDock，定稿 #14），对话、按页的范围
 * （ai-context-page.ts、scope = 当前页）都照旧，这里不碰对话逻辑。哪些页显示见 lib/enterprise/ai-fab.ts。
 *
 * 样子：一圈柔和的渐变光晕在呼吸，里面一层慢慢转，中间一点高光——全是现有的颜色变量，暗色主题下自己跟着变。
 * 动效都是环境节拍（infinite），开了「减弱动态」就停住、不转不缩（globals.css 的 .ai-fab 那段）。
 */
import { useState } from "react";
import { Tooltip } from "antd";
import { useModifierKey } from "./Shortcut";
import { usePageUnderOverlay } from "@/lib/page-under-overlay";
import { useThread } from "@/lib/home-thread";
import { useRunningKey } from "@/lib/ai-jobs";

/*
  P-界面-39 后台在做（原型 ai.bg / ai.minimize）：浮窗「−」收起后对话还在这一页里——
    在跑    球外圈转一圈（is-working）；减弱动态下不转，只明暗呼吸
    跑完    绿光一闪（ai-fab-done，只在「在跑 → 跑完」那一下挂上，刷新、换页不闪）
    有对话  球右上角留一个小点：点开对话原样回来
  范围和 AiDock 同一个：底下那页（usePageUnderOverlay），一页一屏
*/
export default function AiFab({ onClick }: { onClick: () => void }) {
  const modifier = useModifierKey();
  const scope = usePageUnderOverlay();
  const 这屏 = useThread(scope);
  const 在跑 = useRunningKey(这屏.map((t) => `home:${t.id}`)) != null;
  const [上次在跑, set上次在跑] = useState(在跑);
  const [闪, set闪] = useState(0);
  if (上次在跑 !== 在跑) {
    set上次在跑(在跑);
    if (!在跑) set闪((n) => n + 1);
  }
  return (
    <Tooltip title={`问一句（${modifier}J）`} placement="left">
      <button type="button" className={`ai-fab${在跑 ? " is-working" : ""}`} aria-label={在跑 ? "AI 正在做，打开对话" : "打开 AI 对话"} onClick={onClick}>
        <span className="ai-fab-halo" aria-hidden="true" />
        <span className="ai-fab-swirl" aria-hidden="true" />
        <span className="ai-fab-core" aria-hidden="true" />
        {在跑 && <span className="ai-fab-ring" aria-hidden="true" />}
        {闪 > 0 && <span key={闪} className="ai-fab-done" aria-hidden="true" />}
        {这屏.length > 0 && !在跑 && <span className="ai-fab-dot" aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
