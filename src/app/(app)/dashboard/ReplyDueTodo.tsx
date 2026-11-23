"use client";
/**
 * 首页待办「待回复客户」（指定回复时间 PR2，11-17）：我负责的项目里，客户要求的联系时间快到了（开始前 30 分钟起）、还没记有内容的沟通的。
 * 数据在 lib/enterprise/reply-notice.ts 待回复客户of；到截止或记了沟通就不算。一条都没有不画。点了去截止最早的那条项目。
 * 超时未跟进（reply-overdue.ts，11-17）：发过超时提醒、还没记沟通的也算在里面，标「（超时 N）」，先链到超时那条。
 * 没填指定回复时间、按分配时刻起算的超时（11-20）：那行写「分配后 1 小时未跟进」，不写「指定回复」
 * 样式借「待回复主题」那一行（同一种首页待办）
 * 设计语言 H-A（11-21，H-新13 / 新14）：量词写「N 条」、时间走 smartTime、时间挪到名字前面（窄屏名字长也不把时间挤掉）
 */
import Link from "next/link";
import type { 待回复客户数 } from "@/lib/enterprise/reply-notice";
import { 时段smart, 带钟点smart } from "./todo-time";

export default function ReplyDueTodo({ 数据 }: { 数据: 待回复客户数 | null | undefined }) {
  if (!数据?.条数 || !数据.最早) return null;
  const 早 = 数据.最早;
  // 时间在前（「指定回复 今天 21:00 – 22:00 · 名字」），名字再长也不把时间挤出去
  // 时间用服务端多传的 ISO（始 / 终）走 smartTime，远处也补钟点（回复时限的钟点对员工有用，H-A 审查 11-21）；旧数据没有就照摆服务端写好的短串
  const 时 = 早.分配话 ? `${早.始 ? 带钟点smart(早.始) : 早.时} 分配` : `指定回复 ${时段smart(早.始, 早.终) ?? 早.时}`;
  const 后 = [早.name, 早.分配话 ?? (早.超时 ? "超时未跟进" : "")].filter(Boolean).join(" · ");
  return (
    <div className="home-cth-todo" role="status" data-testid="home-reply-due">
      <span className="home-cth-todo-t">待回复客户 {数据.条数} 条{数据.超时 ? <span data-testid="home-reply-overdue" className="home-cth-todo-warn">（超时 {数据.超时} 条）</span> : null}</span>
      <span className="home-cth-todo-s" title={`${时} · ${后}`}><span className="home-cth-todo-time">{时}</span> · {后}</span>
      <Link className="link-strong home-cth-todo-a" href={`/projects/${encodeURIComponent(早.projectId)}`}>去联系 ›</Link>
    </div>
  );
}
