"use server";
import { requireUser } from "@/lib/auth";
import { 读客户只读卡, type 客户只读卡 } from "@/lib/enterprise/customer-readonly-card";

/** 项目详情点开客户只读卡时才取：卡内容（含联系方式）不进页面数据 */
export async function 打开客户只读卡Action(projectId: string): Promise<{ ok: true; 卡: 客户只读卡 } | { ok: false; error: string }> {
  const me = await requireUser();
  const 卡 = await 读客户只读卡(me, String(projectId ?? ""));
  return 卡 ? { ok: true, 卡 } : { ok: false, error: "这张客户卡现在打不开了，刷新页面看看" };
}
