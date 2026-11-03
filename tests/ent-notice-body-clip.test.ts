/**
 * 铃铛里通知正文只摆个开头（11-03 B6-7）：撞号通知的正文是整段沟通内容，上千字时一条占满抽屉。
 * 完整内容在点进去的项目 / 客户沟通里看。
 */
import { expect, it } from "vitest";

it("长正文截到开头加省略号；短的、空的原样", async () => {
  const { 通知摘要 } = await import("@/components/NoticeBell");
  const 长 = "展会上又聊了一次，".repeat(150);
  const 摘 = 通知摘要(长);
  expect(摘.length).toBeLessThanOrEqual(121);
  expect(摘.endsWith("…")).toBe(true);
  expect(长.startsWith(摘.slice(0, -1))).toBe(true);
  expect(通知摘要("市场小李 点的自动分配，轮到了你。")).toBe("市场小李 点的自动分配，轮到了你。");
  expect(通知摘要("")).toBe("");
});
