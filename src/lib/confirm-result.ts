/**
 * 确认与反馈组件（后果框、就地确认、长按确认、撤销条、保存按钮）共用的「做完了没有」。
 *
 * 各处的 server action 回的是 `{ ok: true } | { ok: false, error }`，也有直接 throw 的、什么都不回的。
 * 组件只关心一件事：成了，还是没成、为什么没成。这里把三种写法收成一个判断。
 */
import { 给人看的错 } from "@/lib/action-error";

/** 提示：成了但有一句要说的；有没撤成：撤销成了一部分、有没撤成的（撤销条按出错样式留久一点、悬停停表，UndoBar） */
export type 做的结果 = void | undefined | { ok: boolean; error?: string | null; 提示?: string | null; 有没撤成?: boolean | null };

/** 没成的话，给人看的那句原因 */
export const 没说原因 = "没做成，请稍后再试";

/** 跑一下 fn：成了回 null，没成回原因（回了 ok:false 或者抛错都算没成） */
export async function 跑出原因(fn: () => 做的结果 | Promise<做的结果>): Promise<string | null> {
  try {
    const r = await fn();
    if (r && typeof r === "object" && "ok" in r && !r.ok) return r.error?.trim() || 没说原因;
    return null;
  } catch (e) {
    // 发版后老页面交的动作（lib/stale-deploy.ts）：Next 抛的是英文，换成「系统刚更新了，请刷新页面后再提交」；
    // 别的英文原文（生产构建里服务端出错那句、断网）也不给人看，换成中文、原文进日志（lib/action-error.ts，25C）
    return 给人看的错(e, 没说原因, "保存");
  }
}
