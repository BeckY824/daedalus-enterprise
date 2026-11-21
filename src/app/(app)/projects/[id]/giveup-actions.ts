"use server";
import { requireUser } from "@/lib/auth";
import { 放弃线索, 放弃资格明细, type 放弃结果 } from "@/lib/enterprise/lead-giveup";

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

/**
 * 从通知点「放弃（豁免）」打开项目页（?giveup=1，11-21），页上又没有能点的入口：问一句为什么不能放弃（只读）。
 * 此刻其实能放弃（页面是旧的）= 可 true，页面提示刷新
 */
export async function 放弃说明Action(projectId: string): Promise<{ 可: true } | { 可: false; 话: string }> {
  const me = await requireUser();
  const r = await 放弃资格明细(me, String(projectId ?? ""));
  if ("不给" in r) return { 可: false, 话: r.不给 };
  return r.资格.可 ? { 可: true } : { 可: false, 话: r.资格.为什么 ?? "这条线索现在不能放弃" };
}
