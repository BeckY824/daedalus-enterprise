import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 项目页, type 项目页参数 } from "./board-page";

export const dynamic = "force-dynamic";

/** 项目模式关着时这一页不存在（404），侧栏也没有入口。见 设计-团队版项目模式1a 第三节。取数和画法在 board-page.tsx（企业版客户页的看板视图同一份） */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<项目页参数> }) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  return 项目页(me, await searchParams);
}
