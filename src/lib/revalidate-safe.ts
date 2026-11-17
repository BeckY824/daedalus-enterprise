/**
 * 刷新页面缓存（revalidatePath），没有请求上下文时不抛（11-17，定时分配 PR3）：后台钟上（instrumentation 起的定时任务）调写库的函数时，
 * Next 的 revalidatePath 会抛「static generation store missing」——库已经写完了，不能因为刷新缓存这一步把整件事当失败。
 * 请求里调照常刷新
 */
import { revalidatePath } from "next/cache";

export function 刷新页面(...路径们: string[]): void {
  for (const 路径 of 路径们) {
    try {
      revalidatePath(路径);
    } catch (e) {
      if (!(e instanceof Error && /static generation store missing/.test(e.message))) throw e;
    }
  }
}
