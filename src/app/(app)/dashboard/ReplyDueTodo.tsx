"use client";
/**
 * 首页待办「待回复客户」（指定回复时间 PR2，11-17）：我负责的项目里，客户要求的联系时间快到了（开始前 30 分钟起）、还没记有内容的沟通的。
 * 数据在 lib/enterprise/reply-notice.ts 待回复客户of；到截止或记了沟通就不算。一条都没有不画。点了去截止最早的那条项目。
 * 超时未跟进（reply-overdue.ts，11-17）：发过超时提醒、还没记沟通的也算在里面，标「（超时 N）」，先链到超时那条。
 * 没填指定回复时间、按分配时刻起算的超时（11-20）：那行写「分配后 1 小时未跟进」，不写「指定回复」
 * 样式借「待回复主题」那一行（同一种首页待办）
 */
import Link from "next/link";
import type { 待回复客户数 } from "@/lib/enterprise/reply-notice";

export default function ReplyDueTodo({ 数据 }: { 数据: 待回复客户数 | null | undefined }) {
  if (!数据?.条数 || !数据.最早) return null;
  const 早 = 数据.最早;
  const 说 = 早.分配话 ? `${早.name} · ${早.时} 分配 · ${早.分配话}` : `${早.name} · 指定回复 ${早.时}${早.超时 ? " · 超时未跟进" : ""}`;
  return (
    <div className="home-cth-todo" role="status" data-testid="home-reply-due">
      <span className="home-cth-todo-t">待回复客户 {数据.条数}{数据.超时 ? <span data-testid="home-reply-overdue" className="home-cth-todo-warn">（超时 {数据.超时}）</span> : null}</span>
      <span className="home-cth-todo-s" title={说}>{说}</span>
      <Link className="link-strong home-cth-todo-a" href={`/projects/${encodeURIComponent(早.projectId)}`}>去联系 ›</Link>
    </div>
  );
}
