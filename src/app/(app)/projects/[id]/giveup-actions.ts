"use server";
import { requireUser } from "@/lib/auth";
import { 放弃线索, type 放弃结果 } from "@/lib/enterprise/lead-giveup";

/**
 * 项目页「放弃（豁免）」（32H，lib/enterprise/lead-giveup.ts）：负责人本人点，原因必填；能不能点、挑人、扣次数、待补、通知都在 放弃线索 里。
 * 整条路一次都不 revalidate（自己不调；转出走的 分项目给 里那次 刷新页面，放弃线索 包在 不刷新页面 里跳过）：动作里 revalidate 过，
 * Next 回包会把当前页重画一遍，线索已经转走、他看不到了 → 落到「找不到」（3703 实操 r22）。
 * 页面上提示条换成「已转给 X」，点「知道了」再去项目列表（GiveUpBanner）
 */
export async function 放弃线索Action(projectId: string, 原因: string, 补充?: string): Promise<放弃结果> {
  const me = await requireUser();
  return 放弃线索(me, String(projectId ?? ""), 原因, 补充 ?? null);
}
