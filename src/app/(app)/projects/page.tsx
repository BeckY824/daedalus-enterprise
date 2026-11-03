import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 看板分列 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";
import { 读项目列表 } from "@/lib/project/list";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我的卡点, 卡点给界面 } from "@/lib/project/blocker";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 读组织 } from "@/lib/enterprise/org";
import { 能分配 } from "@/lib/enterprise/lead-assign";
import { 当前是共享区 } from "@/lib/shared-ws/current";
import { 离职交接入口 } from "@/lib/enterprise/offboard-handover";
import ProjectsView from "./ProjectsView";

export const dynamic = "force-dynamic";

/** 项目模式关着时这一页不存在（404），侧栏也没有入口。见 设计-团队版项目模式1a 第三节 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ keyword?: string; ownerId?: string; pool?: string; recycled?: string; f?: string; phase?: string; node?: string }> }) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  const sp = await searchParams;
  // 企业版：项目公海统一在 /pool（P7），?pool=1 的老链接（含页签、带 recycled 收回次数筛的）转过去，关键词带上
  if (企业版() && sp.pool === "1") redirect(sp.keyword ? `/pool?${new URLSearchParams({ keyword: sp.keyword })}` : "/pool");
  // 先读列表（里面先跑超时回收），再取「我的卡点」，看到的是收完的样子
  const d = await 读项目列表(me, sp);
  const 卡点们 = 企业版() ? await 我的卡点(me) : [];
  // 企业版阶段筛到「线索」：分配入口也摆在项目列表（11-01 会议 §5），谁能分照新线索页（leads/page.tsx）同一个口径
  const 筛线索 = 企业版() && sp.phase === "线索";
  const 线索分配开着 = 筛线索 && (await 规则开着("线索分配")) && !(await 当前是共享区());
  const 能自动分配 = 线索分配开着 && 能分配(await 读组织(), me);
  return <ProjectsView {...d} 列={看板分列(d.行, 企业版() ? 字典of(true, d.出口叫法) : undefined, sp.phase)} 卡点们={卡点们.map(卡点给界面)} 线索分配开着={线索分配开着} 能自动分配={能自动分配} 待交接={企业版() && !(await 当前是共享区()) ? await 离职交接入口(me) : null} />;
}
