"use client";
/**
 * 首页一行「自动分配：按现在的数，前面约 N 条轮到你」（11-18 客户定第 1 题 A）：只给参加自动分配的销售画，别的人（null）不画。
 * 数在 lib/enterprise/assign-eta.ts 我的轮到（首页加载时现算）；系统里还没有一条分配记录时写「暂无法估算」。
 * 旁边注明是估算（指定分配、有人暂停或新同事加入都会让它变）。样式借首页待办那一行（home-cth-todo）
 *
 * 设计语言 H-A（11-21，H-新8）：现状主题不再整句加粗——粗的只有「自动分配：前面约 N 条轮到你」这一截（和别的待办「待回复客户 N 条」一样短），
 * 待补、估算说明挪到后面那截灰字；换皮主题照旧
 */
import type { 轮到 } from "@/lib/enterprise/assign-eta";
import { 待补来源话 } from "@/lib/enterprise/lead-giveup-core";
import { useIsNowSkin } from "@/lib/use-skin";

/** 和 assign-eta.ts 估算说明 同一句（那边连着库，这里不 import 值） */
const 说明 = "这是估算：指定分配、有人暂停或新同事加入都会让它变";

export default function AssignEtaLine({ 轮到 }: { 轮到: 轮到 | null | undefined }) {
  const 现状 = useIsNowSkin();
  if (!轮到) return null;
  if (现状) {
    const 头 = 轮到 === "暂无法估算" ? "暂无法估算" : 轮到.数 === 0 ? "下一条就轮到你" : `前面约 ${轮到.数} 条轮到你`;
    const 尾 = [
      轮到 === "暂无法估算" ? "还没有分配记录" : 轮到.待补 ? `${待补来源话(轮到.待补, 轮到.放弃待补)}，优先补给你` : "",
      说明,
    ].filter(Boolean).join(" · ");
    return (
      <div className="home-cth-todo" role="status" data-testid="home-assign-eta">
        <span className="home-cth-todo-t home-eta-t">自动分配：{头}</span>
        <span className="home-cth-todo-s home-eta-note" title={尾}>{尾}</span>
      </div>
    );
  }
  const 话 = 轮到 === "暂无法估算"
    ? "暂无法估算（还没有分配记录）"
    : `按现在的数，${轮到.数 === 0 ? "下一条就轮到你" : `前面约 ${轮到.数} 条轮到你`}${轮到.待补 ? `（${待补来源话(轮到.待补, 轮到.放弃待补)}，优先补给你）` : ""}`;
  return (
    <div className="home-cth-todo" role="status" data-testid="home-assign-eta">
      <span className="home-cth-todo-t home-eta-t">自动分配：{话}</span>
      <span className="home-cth-todo-s home-eta-note" title={说明}>{说明}</span>
    </div>
  );
}
