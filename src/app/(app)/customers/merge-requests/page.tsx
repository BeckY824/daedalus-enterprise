import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 只读角色 } from "@/lib/enterprise/permissions";
import { 等我同意的合并申请, 我发起的合并申请 } from "../merge-actions";
import MergeRequestsView from "./MergeRequestsView";

export const dynamic = "force-dynamic";

/**
 * 「合并申请」页（合并客户第二批 2b-3，方案第 9 节「合并申请页」）：上面等我同意的，下面我发起的（撤回申请）。
 * 照挂靠申请页（projects/attach）的样子。只在企业版有；只读管理员、销售教练没有这一页（他们发不了、也不会被要求同意）。
 * 入口：合并客户框发出申请后撤销条上的「看进度」；第二段再接站内通知、飞书、客户详情横条。
 * 同意 / 拒绝按钮在第二段（按身份出两种确认话术），这一段等我同意的只列出来
 */
export default async function MergeRequestsPage() {
  const me = await requireUser();
  if (!企业版()) notFound();
  const org = await 权限组织();
  if (!org || 只读角色(me, org)) notFound();
  const [等我, 我发起] = await Promise.all([等我同意的合并申请(), 我发起的合并申请()]);
  return <MergeRequestsView 等我={等我} 我发起={我发起} 我={me.id} />;
}
