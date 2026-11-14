/**
 * 看板卡片版（11-15 列表页瘦身，lib/project/list.ts）：只在看板上的卡片去掉列表才用的几列；卡片要画的字段一个不少。
 * 卡片画什么见 projects/ProjectsView.tsx 看板那段（客户名 / 项目名 / 卡片小字 / 金额 / 负责人 / 公海 / 即将回收 / 只看进度 / 三态点按 customerId）
 */
import { expect, it } from "vitest";
import { 看板卡片版 } from "@/lib/project/list";
import { 卡片小字, type 项目行 } from "@/lib/project/board";

const 全: 项目行 = {
  id: "p1", name: "项目一", customerId: "c1", customerName: "客户一", 进不了客户详情: true, ownerId: "u1", ownerName: "甲",
  phase: "线索", node: "潜客培育", result: "异常状态", exceptionCategory: "联系不上", exceptionReason: "电话空号", pooled: false,
  客户在公海: true, 待分配: true, 即将回收: "2026-11-16", 回收日: "2026-11-16", 下一步时间: "2026-11-20", 收回次数: 2,
  expectedDealAt: "2026-12-01", 已立项天数: 9, 项目来源: "某渠道|某账号", level: "A", 只看进度: true, 验证结果: "有效", 验证全文: "一步",
  amount: 100, currency: "CNY", updatedAt: "2026-11-14T00:00:00.000Z", createdAt: "2026-11-05T00:00:00.000Z",
};

it("卡片版：去掉列表才用的列，卡片画的字段原样", () => {
  const 卡 = 看板卡片版(全);
  for (const k of ["回收日", "下一步时间", "收回次数", "expectedDealAt", "已立项天数", "项目来源", "level", "验证结果", "验证全文", "createdAt"]) expect(k in 卡).toBe(false);
  const 留 = { ...全 } as Record<string, unknown>;
  for (const k of ["回收日", "下一步时间", "收回次数", "expectedDealAt", "已立项天数", "项目来源", "level", "验证结果", "验证全文", "createdAt"]) delete 留[k];
  expect(卡).toEqual(留);
  expect(卡片小字(卡)).toBe(卡片小字(全));
  // 不改原对象（列表页那几行和卡片是同一个对象时照旧给全的）
  expect(全.回收日).toBe("2026-11-16");
});
