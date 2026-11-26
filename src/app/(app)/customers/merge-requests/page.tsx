import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 只读角色, 只看的人, 是教练 } from "@/lib/enterprise/permissions";
import { 等我同意的合并申请, 我发起的合并申请 } from "../merge-actions";
import { 只读管理员话, 教练只读话, 看别人视角话 } from "../merge-request-words";
import MergeRequestsView from "./MergeRequestsView";

export const dynamic = "force-dynamic";

/**
 * 「合并申请」页（合并客户第二批 2b-3，方案第 9 节「合并申请页」）：上面等我同意的，下面我发起的（撤回申请）。
 * 照挂靠申请页（projects/attach）的样子。只在企业版有。
 * 入口：合并客户框发出申请后撤销条上的「看进度」；合并申请的 7 种站内通知、飞书（merge-request.ts「通知」一节）都链到这里。
 * 只读身份（只读管理员、销售教练、设了「只看某人」；切换视图在看别人由界面按 useViewAs 判）：列表照常、按钮置灰写原因（P-界面-67），
 * 服务端 merge-request.ts 只读身份 本来就拦
 */
export default async function MergeRequestsPage() {
  const me = await requireUser();
  if (!企业版()) notFound();
  const org = await 权限组织();
  if (!org) notFound();
  const 只读原因 = 只读角色(me, org) ? (是教练(me, org) ? 教练只读话 : 只读管理员话) : 只看的人(org, me.id) ? 看别人视角话 : null;
  const [等我, 我发起] = await Promise.all([等我同意的合并申请(), 我发起的合并申请()]);
  return <MergeRequestsView 等我={等我} 我发起={我发起} 我={me.id} 只读原因={只读原因} />;
}
