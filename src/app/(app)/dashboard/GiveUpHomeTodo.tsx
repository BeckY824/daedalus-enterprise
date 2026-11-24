"use client";
/**
 * 首页置顶「新分到你的线索，可以放弃（豁免）」（11-21，客户「放到首页之类的，用最短的路径让销售触达」）：
 * 每条此刻能放弃的新分到我的线索一行：线索名 + 离超时还剩多久 +「去跟进」「放弃（豁免）」。数据 lib/enterprise/lead-giveup.ts 我能放弃的
 * （只查本人、一批判，开关关 / 本月用过 / 没资格 = 空，不画）。
 * 「放弃（豁免）」在首页原地弹同一个放弃框（projects/[id]/GiveUpDialog）；成了这一行消失，顶上说一句「已放弃，转给 某某」。
 * 手机 390：放在首页最上面、按钮 40 高、按钮行在名字下面折行，不横滚
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNavGo } from "@/lib/nav-pending";
import { Alert, Button } from "antd";
import type { 我能放弃的线索 } from "@/lib/enterprise/lead-giveup-core";
import GiveUpDialog from "../projects/[id]/GiveUpDialog";

export default function GiveUpHomeTodo({ 们 }: { 们: readonly 我能放弃的线索[] | null | undefined }) {
  const router = useRouter();
  /** 去别的页 / 详情：等新页时顶上的条亮（lib/nav-pending.ts） */
  const 去页 = useNavGo();
  const [走了, set走了] = useState<ReadonlySet<string>>(() => new Set());
  const [开, set开] = useState<string | null>(null);
  const [成, set成] = useState<string | null>(null);
  const 剩 = (们 ?? []).filter((x) => !走了.has(x.projectId));
  if (!剩.length && !成) return null;
  const 正放 = 剩.find((x) => x.projectId === 开);
  return (
    <section className="home-giveup" aria-label="新分到你的线索，可以放弃（豁免）" data-testid="home-giveup">
      {成 && (
        <Alert type="success" showIcon closable className="home-giveup-done" title={成} onClose={() => set成(null)} data-testid="home-giveup-done" />
      )}
      {剩.map((x) => (
        <div className="home-giveup-row" key={x.projectId} data-testid="home-giveup-row">
          <div className="home-giveup-main">
            <div className="home-giveup-t">新分到你：<b className="home-giveup-name">{x.name}</b></div>
            <div className="home-giveup-s" data-testid="home-giveup-left">{x.时限话} · 跟不了可以放弃（豁免），每月 1 次</div>
          </div>
          <div className="home-giveup-a">
            <Button type="primary" size="large" className="home-giveup-btn" onClick={() => 去页.push(x.项目去 ?? `/projects/${encodeURIComponent(x.projectId)}`)} data-testid="home-giveup-go">
              去跟进
            </Button>
            <Button size="large" className="home-giveup-btn" onClick={() => { set成(null); set开(x.projectId); }} data-testid="home-giveup-open">放弃（豁免）</Button>
          </div>
        </div>
      ))}
      {正放 && (
        <GiveUpDialog
          key={正放.projectId}
          projectId={正放.projectId} 开 关={() => set开(null)} 判无效去={正放.项目去 ?? `/projects/${encodeURIComponent(正放.projectId)}`}
          成={(接手人) => {
            set走了((原) => new Set([...原, 正放.projectId]));
            set开(null);
            set成(`已放弃「${正放.name}」，转给 ${接手人}；已给你记 1 条待补`);
            // 首页别的待办（待回复客户、超时）里也有这条：重拉一遍
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
