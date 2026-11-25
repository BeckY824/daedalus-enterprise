import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 只读角色 } from "@/lib/enterprise/permissions";
import { 待我审批的挂靠, 我的挂靠申请 } from "@/lib/enterprise/attach-approval";
import { 读待补建栏 } from "@/lib/enterprise/repeat-unbuilt";
import AttachView from "./AttachView";

export const dynamic = "force-dynamic";

/**
 * 「项目 → 挂靠申请」（P-挂靠-02 / P-看-13）：上面是等我审批的（我是客户负责人，或 24 小时没处理转给我的上级），批准 / 拒绝；
 * 下面是我申请过的，批准了的点开这家客户的只读卡。只在企业版有；只读管理员没有这一页。
 * 入口是挂靠的站内通知（申请、转上级、批准结果都链到这里）。
 * 再下面是「重复咨询待补建」（P-公海-15 后半，repeat-unbuilt.ts）：这条线的销售管理、总管理、系统管理员看全部内容、补建 / 不补建；
 * 交的市场同事只看自己交的几条和处理结果（只有客户编号）；别人这一栏不出现。出口 C 没建的那条通知点进来落在这一栏
 */
export default async function AttachPage() {
  const me = await requireUser();
  if (!企业版()) notFound();
  const org = await 权限组织();
  if (!org || 只读角色(me, org)) notFound();
  const [待批, 我的, 待补建] = await Promise.all([待我审批的挂靠(me), 我的挂靠申请(me), 读待补建栏(me)]);
  return <AttachView 待批={待批} 我的={我的} 待补建={待补建} />;
}
