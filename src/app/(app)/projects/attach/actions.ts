"use server";

/**
 * 「挂靠申请」页的三颗键（P-挂靠-02 / P-看-13，lib/enterprise/attach-approval.ts）：审批人批准、拒绝；批准后申请人打开只读卡。
 * 批准 / 拒绝和别的改数据同一道挡：没业务角色、只读管理员不行。只读卡只在点开时取，卡内容不进页面数据
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 不在了 } from "@/lib/not-there";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 没设业务角色, 只读角色, 只读角色话 } from "@/lib/enterprise/permissions";
import { 审批挂靠, 读挂靠只读卡, 挂靠页 } from "@/lib/enterprise/attach-approval";
import type { 客户只读卡 } from "@/lib/enterprise/customer-readonly-card";

type 结果 = { ok: true } | { ok: false; error: string };

async function 审批(撞号id: string, 批: boolean): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: "企业版才有挂靠审批" };
    const org = await 权限组织();
    if (!org || 没设业务角色(org, me.id)) return { ok: false, error: "你还没有业务角色，不能改数据，请找总管理设置" };
    if (只读角色(me, org)) return { ok: false, error: 只读角色话 };
    const r = await 审批挂靠(me, String(撞号id ?? ""), 批);
    if (r.ok) revalidatePath(挂靠页);
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 批准挂靠(撞号id: string): Promise<结果> {
  return 审批(撞号id, true);
}

export async function 拒绝挂靠(撞号id: string): Promise<结果> {
  return 审批(撞号id, false);
}

export async function 打开挂靠只读卡(撞号id: string): Promise<{ ok: true; 卡: 客户只读卡 } | { ok: false; error: string }> {
  const me = await requireUser();
  const 卡 = await 读挂靠只读卡(me, String(撞号id ?? ""));
  return 卡 ? { ok: true, 卡 } : { ok: false, error: "这张客户卡现在打不开了，刷新页面看看" };
}
