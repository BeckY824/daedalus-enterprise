import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 只读角色 } from "@/lib/enterprise/permissions";
import { 当前是共享区 } from "@/lib/shared-ws/current";
import { 待我审批的挂靠, 我的挂靠申请 } from "@/lib/enterprise/attach-approval";
import AttachView from "./AttachView";

export const dynamic = "force-dynamic";

/**
 * 「项目 → 挂靠申请」（P-挂靠-02 / P-看-13）：上面是等我审批的（我是客户负责人，或 24 小时没处理转给我的上级），批准 / 拒绝；
 * 下面是我申请过的，批准了的点开这家客户的只读卡。只在企业版有；只读管理员、共享区没有这一页。
 * 入口是挂靠的站内通知（申请、转上级、批准结果都链到这里）
 */
export default async function AttachPage() {
  const me = await requireUser();
  if (!企业版()) notFound();
  const org = await 权限组织();
  if (!org || 只读角色(me, org) || (await 当前是共享区())) notFound();
  const [待批, 我的] = await Promise.all([待我审批的挂靠(me), 我的挂靠申请(me)]);
  return <AttachView 待批={待批} 我的={我的} />;
}
