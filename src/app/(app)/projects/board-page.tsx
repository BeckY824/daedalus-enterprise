import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { 看板分列 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";
import { 读项目列表 } from "@/lib/project/list";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我的卡点, 卡点给界面 } from "@/lib/project/blocker";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 读组织 } from "@/lib/enterprise/org";
import { 能管公海 } from "@/lib/enterprise/permissions";
import { 能分配 } from "@/lib/enterprise/lead-assign";
import { 离职交接入口 } from "@/lib/enterprise/offboard-handover";
import ProjectsView from "./ProjectsView";

/** 项目页（看板 / 列表）认的地址栏参数 */
export type 项目页参数 = { keyword?: string; ownerId?: string; pool?: string; recycled?: string; f?: string; phase?: string; node?: string; creator?: string; channelId?: string; level?: string; createdFrom?: string; createdTo?: string; phone?: string; page?: string; pageSize?: string; sort?: string; q?: string; hl?: string };

/** 项目看板认的参数名：客户页（看板视图）地址栏只带这些时才画看板，带了客户列表自己的（new、batch、salesOwnerId…）照旧画客户列表 */
export const 项目页参数名 = ["keyword", "ownerId", "recycled", "f", "phase", "node", "creator", "channelId", "level", "createdFrom", "createdTo", "phone", "page", "pageSize", "sort"] as const;

/**
 * 项目页的取数和画法：/projects 和企业版客户页的「看板」视图（11-12 客户详情合并第 3 批）共用这一份，取数、可见范围、
 * 批量分配、页头的离职交接、项目组邀请、线索复核、我的卡点都一样；客户页 = true 时页头叫客户、「列表 / 看板」切的是客户列表和这块看板
 */
export async function 项目页(me: SessionUser, 原: 项目页参数, 客户页 = false) {
  // q / hl：进不了详情转过来的（projects/[id]/page.tsx 市场挡，客户 11-05）——q 当搜索词预填，hl 是要指出的那一行。
  // 搜索框照旧认 keyword，q 只在没带 keyword 时顶上；之后再搜就只剩 keyword，hl 也跟着没了
  const { q, hl, ...其余 } = 原;
  const sp = { ...其余, keyword: 其余.keyword ?? q };
  // 企业版：项目公海统一在 /pool（P7），?pool=1 的老链接（含页签、带 recycled 收回次数筛的）转过去，关键词带上
  if (企业版() && sp.pool === "1") redirect(sp.keyword ? `/pool?${new URLSearchParams({ keyword: sp.keyword })}` : "/pool");
  // 先读列表（里面先跑超时回收），再取「我的卡点」，看到的是收完的样子
  const d = await 读项目列表(me, sp);
  const 卡点们 = 企业版() ? await 我的卡点(me) : [];
  // 企业版阶段筛到「线索」：分配入口也摆在项目列表（11-01 会议 §5），谁能分照新线索页（leads/page.tsx）同一个口径
  const 筛线索 = 企业版() && sp.phase === "线索";
  const 线索分配开着 = 筛线索 && (await 规则开着("线索分配"));
  const 能自动分配 = 线索分配开着 && 能分配(await 读组织(), me);
  return <ProjectsView {...d} 列={看板分列(d.行, 企业版() ? 字典of(true, d.出口叫法) : undefined, sp.phase, d.看板合计)} 卡点们={卡点们.map(卡点给界面)} 线索分配开着={线索分配开着} 能自动分配={能自动分配} 能分公海客户项目={能自动分配 && 能管公海(me, await 读组织())} 待交接={企业版() ? await 离职交接入口(me) : null} 高亮={typeof hl === "string" && hl ? hl : undefined} 客户页={客户页} />;
}
