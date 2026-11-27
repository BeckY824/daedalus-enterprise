import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我的异议 } from "@/lib/enterprise/objection";
import { 异议期天数, 异议理由上限 } from "@/lib/enterprise/objection-core";
import ObjectionsView from "./ObjectionsView";

export const dynamic = "force-dynamic";

/**
 * 「转让异议」（12-22 第 2 阶段 A 段，判定页 #18）：能提异议的通知列表（30 天内）+ 我提的异议。
 * 铃铛里转让通知的「提异议」链到这里（?o= 直接打开那一条）；每个人只看到自己的，没有的人进来是空列表
 */
export default async function ObjectionsPage({ searchParams }: { searchParams: Promise<{ o?: string }> }) {
  const me = await requireUser();
  if (!企业版()) notFound();
  const { o } = await searchParams;
  const { 能提, 已提 } = await 我的异议(me.id);
  return <ObjectionsView 能提={能提} 已提={已提} 打开={typeof o === "string" ? o : null} 天数={异议期天数} 上限={异议理由上限} />;
}
