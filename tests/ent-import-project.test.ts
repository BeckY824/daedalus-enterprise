/**
 * 企业版只用项目时，飞书 / Excel 导入的「商机」行建成项目（10-26 用户：「把线索，商机，订单都放到项目里，是三大阶段」）。
 *
 *   阶段对照认项目节点：2.0 节点原样、1.0 叫法按旧名表、别的按同义词；结局（流失 / 丢单 / 交付）落成 result
 *   另一列状态说了输单：线索阶段算线索流失，商机阶段算丢单，订单阶段标异常状态、停在原节点（10-27）
 *   跟进挂到父项目当前节点；撤回整批删项目（连节点日志、挂项目那条），恢复照原 id 建回
 *   开关关：照旧建商机
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 开: true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批 } from "@/lib/enterprise-import/apply";
import { 撤回一批, 恢复一批 } from "@/lib/enterprise-import/revert";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

function 表(名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 {
  return { 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
}
const 客户表 = () =>
  表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人"], [
    ["C1", "杭州云帆科技有限公司", "13800000001", "张伟"],
    ["C2", "宁波海川贸易", "13800000002", "张伟"],
  ]);
const 商机表 = (行: string[][]) => 表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段", "商机状态", "商机金额", "预计成交日期", "成交日期"], 行);
const 跟进表 = () =>
  表("跟进记录.xlsx", "followup", ["跟进ID", "客户ID", "商机ID", "跟进方式", "跟进内容", "跟进时间"], [
    ["F1", "C1", "O1", "电话", "聊了方案", "2025-06-01 10:00"],
    ["F2", "C1", "", "拜访", "上门看样", "2025-07-01 15:00"],
  ]);

const 我 = { id: "tester-id", name: "测试员" };

async function 导(表们: 读出的表[]) {
  const { 批次Id, 报告 } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  const r = await 写一批(批次Id, 我);
  expect(r.完了).toBe(true);
  return { 批次Id, 报告 };
}
const 项目 = (name: string) => prisma.project.findFirstOrThrow({ where: { name }, include: { logs: true, followUps: true } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.开 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("项目模式", () => {
  it("商机行建成项目：节点按 2.0 / 新版叫法 / 同义词认，结局落成 result，不建商机", async () => {
    const { 报告 } = await 导([
      客户表(),
      商机表([
        ["O1", "C1", "服务器采购", "解决方案", "", "12万", "2025-09-01", ""],
        ["O2", "C1", "样品单", "签订合同", "", "3万", "", ""],
        ["O3", "C2", "外贸展会", "需求确认", "", "", "", ""],
        ["O4", "C2", "老客户回访", "流失", "", "", "", "2025-03-05"],
        ["O5", "C2", "去年标书", "备货安装", "输单", "", "", "2025-04-01"],
        ["O6", "C1", "交付完的", "已交付", "", "8万", "", "2025-05-01"],
        ["O7", "C1", "商机里输的", "签订合同", "输单", "", "", "2025-06-01"],
      ]),
    ]);
    expect(报告.映射.项目).toBe(true);
    expect(报告.映射.值.filter((v) => v.名 === "阶段").every((v) => v.叫法 === "项目节点")).toBe(true);
    expect(await prisma.opportunity.count()).toBe(0);
    expect(await prisma.project.count()).toBe(7);

    const 一 = await 项目("服务器采购");
    expect([一.phase, 一.node, 一.result, 一.amount]).toEqual(["商机", "共识方案", null, 120000]);
    expect(一.closedAt).toBeNull();
    // 预计成交日期落项目上（10-27 从客户挪到项目），不再塞备注
    expect(一.expectedDealAt).toEqual(new Date("2025-09-01T00:00:00"));
    expect(一.remark ?? "").not.toContain("预计成交");
    expect(一.logs).toHaveLength(1);
    expect(一.logs[0]).toMatchObject({ toPhase: "商机", toNode: "共识方案", toResult: null });
    expect([(await 项目("样品单")).node, (await 项目("外贸展会")).node]).toEqual(["签订合同", "明确需求"]);

    const 流失 = await 项目("老客户回访");
    expect([流失.phase, 流失.node, 流失.result]).toEqual(["线索", "潜客培育", "线索流失"]);
    expect(流失.closedAt).toEqual(new Date("2025-03-05T00:00:00"));
    // 订单阶段的节点 + 状态列说输单：统一标成异常状态、停在原订单节点，不退回商机；类别留空，导完补
    const 丢 = await 项目("去年标书");
    expect([丢.phase, 丢.node, 丢.result, 丢.exceptionCategoryId]).toEqual(["订单", "生产备货", "异常状态", null]);
    expect(丢.closedAt).toEqual(new Date("2025-04-01T00:00:00"));
    expect(丢.logs[0]).toMatchObject({ toPhase: "订单", toNode: "生产备货", toResult: "异常状态" });
    expect(报告.问题).toContainEqual(expect.objectContaining({ 外部ID: "O5", 级别: "提醒", 说明: expect.stringContaining("异常类别导完") }));
    // 商机阶段的输单照旧是丢单，停在原节点
    const 商机丢 = await 项目("商机里输的");
    expect([商机丢.phase, 商机丢.node, 商机丢.result]).toEqual(["商机", "签订合同", "丢单"]);
    const 交付 = await 项目("交付完的");
    expect([交付.phase, 交付.node, 交付.result]).toEqual(["订单", "尾款结算", "成功交付"]);
  });

  it("跟进挂父项目当前节点；撤回整批删项目和挂件，恢复照原 id 建回", async () => {
    const { 批次Id } = await 导([客户表(), 商机表([["O1", "C1", "服务器采购", "解决方案", "", "12万", "", ""]]), 跟进表()]);
    const p = await 项目("服务器采购");
    expect(p.followUps).toHaveLength(1);
    expect(p.followUps[0].node).toBe("共识方案");
    const F1 = await prisma.followUp.findFirstOrThrow({ where: { content: "聊了方案" } });
    expect(F1.opportunityId).toBeNull();
    expect(p.followUps[0].followUpId).toBe(F1.id);

    const r = await 撤回一批(批次Id, 我);
    expect(r.完了).toBe(true);
    expect(r.留下数).toBe(0);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.projectNodeLog.count()).toBe(0);
    expect(await prisma.followUpProject.count()).toBe(0);
    expect(await prisma.followUp.count()).toBe(0);

    const 回 = await 恢复一批(批次Id, 我);
    expect(回.完了).toBe(true);
    expect(回.留下数).toBe(0);
    const p2 = await 项目("服务器采购");
    expect(p2.id).toBe(p.id);
    expect([p2.node, p2.logs.length]).toEqual(["共识方案", 1]);
    expect(p2.followUps.map((f) => f.followUpId)).toEqual([F1.id]);

    // 恢复后还能再撤
    expect((await 撤回一批(批次Id, 我)).留下数).toBe(0);
    expect(await prisma.project.count()).toBe(0);
  });

  it("导入后项目被人接着用了（拉了成员）：项目留下，原因记下来；挂在上面的那条跟进照撤", async () => {
    const { 批次Id } = await 导([客户表(), 商机表([["O1", "C1", "服务器采购", "解决方案", "", "", "", ""]]), 跟进表()]);
    const p = await 项目("服务器采购");
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 我.id } });
    const r = await 撤回一批(批次Id, 我);
    expect(await prisma.project.count()).toBe(1);
    expect(r.留下.some((x) => x.原因.includes("成员"))).toBe(true);
    expect(await prisma.followUp.count()).toBe(0);
  });
});

it("开关关：照旧建商机，阶段对照叫「商机阶段」", async () => {
  mocks.开 = false;
  const { 报告 } = await 导([客户表(), 商机表([["O1", "C1", "服务器采购", "需求确认", "", "12万", "", ""]])]);
  expect(报告.映射.项目).toBe(false);
  expect(报告.映射.值.find((v) => v.名 === "阶段")?.叫法).toBe("商机阶段");
  expect(await prisma.project.count()).toBe(0);
  expect(await prisma.opportunity.count()).toBe(1);
});
