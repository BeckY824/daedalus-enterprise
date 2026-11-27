import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我的异议 } from "@/lib/enterprise/objection";
import { 异议期天数, 异议理由上限, 裁定说明上限 } from "@/lib/enterprise/objection-core";
import { 待我裁定, 待手工退回们, 全部待裁定 } from "@/lib/enterprise/objection-judge";
import { 读组织 } from "@/lib/enterprise/org";
import { 系统管理员们 } from "@/lib/enterprise/tri-state-people";
import ObjectionsView from "./ObjectionsView";

export const dynamic = "force-dynamic";

/**
 * 「转让异议」（12-22 第 2 阶段 A 段，判定页 #18）：能提异议的通知列表（30 天内）+ 我提的异议。
 * 铃铛里转让通知的「提异议」链到这里（?o= 直接打开那一条）；每个人只看到自己的，没有的人进来是空列表
 */
export default async function ObjectionsPage({ searchParams }: { searchParams: Promise<{ o?: string; j?: string; tab?: string }> }) {
  const me = await requireUser();
  if (!企业版()) notFound();
  const { o, j, tab } = await searchParams;
  const { 能提, 已提 } = await 我的异议(me.id);
  const 待裁 = await 待我裁定(me.id);
  // 待手工退回只给系统管理员（12-22 先由他们手工退并留痕）
  const 管理员 = (await 读组织().then((org) => org && 系统管理员们(org).includes(me.id)).catch(() => false)) === true;
  const 待手工 = 管理员 ? await 待手工退回们() : [];
  // 全部待裁定同样只给系统管理员（兜底：谁都能裁，不用等裁定人）
  const 全部 = 管理员 ? await 全部待裁定(me.id) : [];
  const 页签 = tab === "hand" && 待手工.length ? "hand" : tab === "all" && 管理员 ? "all" : j || tab === "judge" ? "judge" : "mine";
  return (
    <ObjectionsView
      能提={能提} 已提={已提} 打开={typeof o === "string" ? o : null} 天数={异议期天数} 上限={异议理由上限}
      待裁={待裁} 全部={全部} 待手工={待手工} 管理员={管理员} 裁定上限={裁定说明上限} 首个页签={页签} 打开裁定={typeof j === "string" ? j : null}
    />
  );
}
