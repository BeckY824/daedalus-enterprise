import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 看板分列 } from "@/lib/project/board";
import { 读项目列表 } from "@/lib/project/list";
import ProjectsView from "./ProjectsView";

export const dynamic = "force-dynamic";

/** 项目模式关着时这一页不存在（404），侧栏也没有入口。见 设计-团队版项目模式1a 第三节 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ keyword?: string; ownerId?: string; pool?: string }> }) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  const d = await 读项目列表(me, await searchParams);
  return <ProjectsView {...d} 列={看板分列(d.行)} />;
}
