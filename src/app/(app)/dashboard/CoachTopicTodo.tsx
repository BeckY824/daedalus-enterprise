"use client";
/**
 * 首页待办「待回复主题」（销售教练角色 PR3b，11-17）：项目负责人看到，自己负责、没进公海 / 回收站的项目上还有几条教练主题等他回。
 * 数据在 lib/enterprise/coach-topic-db.ts 待回复主题of；一条都没有不画。点了去最早那条所在的项目（主题钉在沟通卡最上面）
 * 设计语言 H-A（11-21，H-新13）：现状主题时间走 smartTime；换皮主题照旧 2026-11-21 20:47
 */
import Link from "next/link";
import { fmtDateTime, smartTime } from "@/lib/utils";
import { useIsNowSkin } from "@/lib/use-skin";

export type 待回复主题数 = { 条数: number; 最早: { at: string; projectId: string; title: string } | null };

export default function CoachTopicTodo({ 数据 }: { 数据: 待回复主题数 | null | undefined }) {
  const 现状 = useIsNowSkin();
  if (!数据?.条数 || !数据.最早) return null;
  return (
    <div className="home-cth-todo" role="status" data-testid="home-coach-topics">
      <span className="home-cth-todo-t">待回复主题 {数据.条数} 条</span>
      <span className="home-cth-todo-s" title={数据.最早.title}>最早 <span className="home-cth-todo-time">{现状 ? smartTime(数据.最早.at) : fmtDateTime(数据.最早.at)}</span> · {数据.最早.title}</span>
      <Link className="link-strong home-cth-todo-a" href={`/projects/${encodeURIComponent(数据.最早.projectId)}`}>去回复 ›</Link>
    </div>
  );
}
