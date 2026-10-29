import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 看板分列 } from "@/lib/project/board";
import { 读项目列表 } from "@/lib/project/list";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我的卡点, 卡点给界面 } from "@/lib/project/blocker";
import ProjectsView from "./ProjectsView";

export const dynamic = "force-dynamic";

/** 项目模式关着时这一页不存在（404），侧栏也没有入口。见 设计-团队版项目模式1a 第三节 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ keyword?: string; ownerId?: string; pool?: string; recycled?: string; f?: string }> }) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  const sp = await searchParams;
  // 企业版：项目公海统一在 /pool（P7），?pool=1 的老链接（含页签、带 recycled 收回次数筛的）转过去，关键词带上
  if (企业版() && sp.pool === "1") redirect(sp.keyword ? `/pool?${new URLSearchParams({ keyword: sp.keyword })}` : "/pool");
  // 先读列表（里面先跑超时回收），再取「我的卡点」，看到的是收完的样子
  const d = await 读项目列表(me, sp);
  const 卡点们 = 企业版() ? await 我的卡点(me) : [];
  return <ProjectsView {...d} 列={看板分列(d.行)} 卡点们={卡点们.map(卡点给界面)} />;
}
