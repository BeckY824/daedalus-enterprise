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
import { Tooltip } from "antd";
import { useModifierKey } from "./Shortcut";

export default function AiFab({ onClick }: { onClick: () => void }) {
  const modifier = useModifierKey();
  return (
    <Tooltip title={`问一句（${modifier}J）`} placement="left">
      <button type="button" className="ai-fab" aria-label="打开 AI 对话" onClick={onClick}>
        <span className="ai-fab-halo" aria-hidden="true" />
        <span className="ai-fab-swirl" aria-hidden="true" />
        <span className="ai-fab-core" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
