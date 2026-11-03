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

it("要不要给「展开全文」（11-03 B6-6）：两行放得下的不给，长的、带换行的给", async () => {
  const { 通知要展开 } = await import("@/components/NoticeBell");
  expect(通知要展开("市场小李 点的自动分配，轮到了你。")).toBe(false);
  expect(通知要展开("")).toBe(false);
  expect(通知要展开(null)).toBe(false);
  expect(通知要展开("展会上又聊了一次，".repeat(150))).toBe(true);
  expect(通知要展开("第一行\n第二行")).toBe(true);
  expect(通知要展开("  前后空白不算  \n")).toBe(false);
});
