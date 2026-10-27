/**
 * 项目模式下「阶段」这一格的值：只依赖 nodes，mapping 也用（project-target 连着 apply，mapping 直接引它会绕成一圈）。
 */
import { 阶段们, 节点们, 结局们, 是结局, 结局所在阶段, type 阶段 } from "../project/nodes";

/** 项目模式下「阶段」这一格能填的值：三阶段的节点 + 四个结局 */
export const 项目阶段值: readonly string[] = [...阶段们.flatMap((s) => 节点们[s]), ...结局们];

/** 1.0 叫法 → 2.0 节点 / 结局（10-27 会上对方确认；tests/ent-import-node-names 钉着整张表） */
const 旧名: Record<string, string> = {
  市场验证: "潜客培育",
  市场培育: "潜客培育",
  线索分配: "潜客培育",
  市场复审: "线索验证",
  线索培育: "线索推进",
  已转商机: "明确需求",
  正式立项: "明确需求",
  流失回访: "线索流失",
  解决方案: "共识方案",
  商机赢单: "生产备货",
  赢单: "生产备货",
  赢单成交: "生产备货",
  商机丢单: "丢单",
  项目丢单: "丢单",
  丢单回访: "丢单",
  输单: "丢单",
  备货安装: "生产备货",
  交付验收: "验收交付",
  项目交付: "成功交付",
  后售培育: "成功交付",
};

/** 原系统的一格 → 项目节点或结局；认不出 = null */
export function 项目节点对值(原值: string): string | null {
  const s = 原值.trim();
  if (项目阶段值.includes(s)) return s;
  return 旧名[s] ?? null;
}

export function 节点所在阶段(node: string): 阶段 | null {
  return 阶段们.find((s) => 节点们[s].includes(node)) ?? null;
}

/** 有结局时项目停在哪个节点：成功交付停在最后一个节点，别的停在所在阶段的第一个 */
export function 结局默认节点(r: string): string {
  if (!是结局(r)) throw new Error(`「${r}」不是项目的结局`);
  if (r === "成功交付") return 节点们.订单[节点们.订单.length - 1];
  return 节点们[结局所在阶段(r)][0];
}
