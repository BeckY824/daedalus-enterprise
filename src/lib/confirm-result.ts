/**
 * 确认与反馈组件（后果框、就地确认、长按确认、撤销条、保存按钮）共用的「做完了没有」。
 *
 * 各处的 server action 回的是 `{ ok: true } | { ok: false, error }`，也有直接 throw 的、什么都不回的。
 * 组件只关心一件事：成了，还是没成、为什么没成。这里把三种写法收成一个判断。
 */
import { 是旧版本动作错, 动作出错话 } from "@/lib/stale-deploy";

export type 做的结果 = void | undefined | { ok: boolean; error?: string | null };

/** 没成的话，给人看的那句原因 */
export const 没说原因 = "没做成，请稍后再试";

/** 跑一下 fn：成了回 null，没成回原因（回了 ok:false 或者抛错都算没成） */
export async function 跑出原因(fn: () => 做的结果 | Promise<做的结果>): Promise<string | null> {
  try {
    const r = await fn();
    if (r && typeof r === "object" && "ok" in r && !r.ok) return r.error?.trim() || 没说原因;
    return null;
  } catch (e) {
    // 发版后老页面交的动作（lib/stale-deploy.ts）：Next 抛的是英文，换成「系统刚更新了，请刷新页面后再提交」
    if (是旧版本动作错(e)) return 动作出错话(e, 没说原因);
    const 话 = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    return 话.trim() || 没说原因;
  }
}
