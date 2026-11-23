"use client";
/**
 * 首页待办「待分配新线索 N 条 · 最早 … · 去分配 ›」（11-21 改版，替原来顶上一条一张的黄色「没自动分出去」大卡）。
 * 样式、写法照「待回复客户 / 待回复主题」那一行（同一种首页待办，P-转-35 合成一行带条数）；条数服务端现数（list.ts 数待分配），
 * 分走了自动少，没有了整行不画，不能关。点了去新线索页只列这几条（/leads?f=await-assign，同一个条件，行数 = 条数）。
 * 只画一行、高度固定（home-cth-todo-one 不换行，放不下省略），塞进首页左卡不把卡撑高。
 * 设计语言 H-A（11-21，H-新13 / 新14）：拿服务端多传的 最早At（ISO）走 smartTime（今天 20:46 · 昨天 · 3 天前，企业版业务钟 = 北京），
 * 窄屏放不下就折行、时间不截（globals.css）；没有 最早At 时照摆服务端写好的短串
 */
import Link from "next/link";
import { 待分配链接, 待分配筛名, type 待分配数 } from "@/lib/enterprise/await-assign-core";
import { smartTime } from "@/lib/utils";

export default function AwaitAssignTodo({ 数据 }: { 数据: 待分配数 | null | undefined }) {
  if (!数据?.条数) return null;
  return (
    <div className="home-cth-todo home-cth-todo-one" role="status" data-testid="home-await-assign">
      <span className="home-cth-todo-t">{待分配筛名} {数据.条数} 条</span>
      {数据.最早 ? <span className="home-cth-todo-s">最早 <span className="home-cth-todo-time">{数据.最早At ? smartTime(数据.最早At) : 数据.最早}</span></span> : null}
      <Link className="link-strong home-cth-todo-a" href={待分配链接}>去分配 ›</Link>
    </div>
  );
}
