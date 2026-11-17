"use client";
/**
 * 首页待办「待回复客户」（要求回复时间 PR2，11-17）：我负责的项目里，客户要求的联系时间快到了（开始前 30 分钟起）、还没记有内容的沟通的。
 * 数据在 lib/enterprise/reply-notice.ts 待回复客户of；到截止或记了沟通就不算。一条都没有不画。点了去截止最早的那条项目。
 * 样式借「待回复主题」那一行（同一种首页待办）
 */
import Link from "next/link";
import type { 待回复客户数 } from "@/lib/enterprise/reply-notice";

export default function ReplyDueTodo({ 数据 }: { 数据: 待回复客户数 | null | undefined }) {
  if (!数据?.条数 || !数据.最早) return null;
  return (
    <div className="home-cth-todo" role="status" data-testid="home-reply-due">
      <span className="home-cth-todo-t">待回复客户 {数据.条数}</span>
      <span className="home-cth-todo-s" title={`${数据.最早.name} · 客户要求 ${数据.最早.时} 联系`}>{数据.最早.name} · 客户要求 {数据.最早.时} 联系</span>
      <Link className="link-strong home-cth-todo-a" href={`/projects/${encodeURIComponent(数据.最早.projectId)}`}>去联系 ›</Link>
    </div>
  );
}
