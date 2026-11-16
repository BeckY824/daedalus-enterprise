/**
 * 导入「先演一遍」放宽限时，给要对「预演数 = 写入数」的裁判用例用：
 *
 *   vi.mock("@/lib/enterprise-import/apply", async (原) => (await import("./import-preview-time")).预演放宽(await 原()));
 *
 * 为什么（11-16 ent-import-judges 两次在 pre-push 红：expected undefined to deeply equal { 新建: 640, … }）：
 * 预演（lib/enterprise-import/apply.ts）限时 3 秒，是产品上「试跑别把库的写锁占太久」的保护——演不完就整个回滚、
 * 报告不带 预演、退回按清洗分类给数，提醒里写一句「没能先演一遍」。这条路由 ent-import-rehearsal.test.ts 专门测着。
 * 样例那份几百条，空闲时一秒多演完；pre-push 全套和 tsc 一起跑、机器满载时过了 3 秒，报告.预演 = null，
 * 裁判拿到 undefined——不是数错了，是没演。裁判要对的是数，不是快慢，这里把限时放宽。
 * 演出错（不是超时）照样回 null + 提醒，断言照样红。调用方自己传了限时的照原样用
 */
import type * as 导入写 from "@/lib/enterprise-import/apply";

export const 裁判预演限时毫秒 = 60_000;

export function 预演放宽(m: typeof 导入写): typeof 导入写 {
  return {
    ...m,
    预演: (源, 映射, 计划, 用户, 限时 = 裁判预演限时毫秒) => m.预演(源, 映射, 计划, 用户, 限时),
  };
}
