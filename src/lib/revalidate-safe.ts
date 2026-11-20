/**
 * 刷新页面缓存（revalidatePath），没有请求上下文时不抛（11-17，定时分配 PR3）：后台钟上（instrumentation 起的定时任务）调写库的函数时，
 * Next 的 revalidatePath 会抛「static generation store missing」——库已经写完了，不能因为刷新缓存这一步把整件事当失败。
 * 请求里调照常刷新。
 *
 * 不刷新页面(fn)：fn 里（含它 await 的一切）调 刷新页面 一律跳过（32H 主动放弃，3703 实操 r22）。
 * server action 里只要 revalidate 过一次（不论哪个路径），Next 就在动作的回包里把当前页整个重画一遍发回去；
 * 放弃以后线索已经转走、放弃人看不到这一页了，重画就落到「没有找到这条记录」，提示条也被冲掉。
 * 动作里一次都不 revalidate，回包只带返回值、不带新页面，页上的「已转给 X」留得住；列表页下次进去现读，不靠这次刷新
 */
import { revalidatePath } from "next/cache";
import { 全进程上下文 } from "./process-als";

const 跳过刷新 = 全进程上下文<true>("skip-revalidate");

export function 不刷新页面<T>(fn: () => Promise<T>): Promise<T> {
  return 跳过刷新.run(true, fn);
}

export function 刷新页面(...路径们: string[]): void {
  if (跳过刷新.getStore()) return;
  for (const 路径 of 路径们) {
    try {
      revalidatePath(路径);
    } catch (e) {
      if (!(e instanceof Error && /static generation store missing/.test(e.message))) throw e;
    }
  }
}
