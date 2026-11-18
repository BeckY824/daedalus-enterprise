/**
 * AI 数据查询的「节点记录」（审核 11-18 追加）：换负责人 / 放回公海 / 公海领取那几类行，原节点、新节点照抄当时的（schema.prisma ProjectNodeLog），
 * 按新节点连起来看像「潜客培育 > 潜客培育 > 线索验证」。不过滤，但记录类型标明白：结果和分组里写「换负责人（transfer）……不是节点变化」，
 * 工具说明里也写一句，问节点怎么走的只看改节点（node）的行
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { TOOLS, query_records说明 } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

let 我: { id: string };
const ctx = () => ({ userId: 我.id, userName: "甲", b: DEFAULT_BUSINESS, recordOffset: 0, proposals: [] });
const 查 = TOOLS.find((x) => x.name === "query_records")!;

beforeEach(async () => {
  await resetDb();
  我 = await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } });
  const c = await prisma.customer.create({ data: { name: "客户", phone: "13900000001", salesOwnerId: 我.id } });
  const p = await prisma.project.create({ data: { name: "项目", customerId: c.id, ownerId: 我.id, creatorId: 我.id, phase: "线索", node: "线索验证" } });
  const t = Date.now();
  await prisma.projectNodeLog.createMany({
    data: [
      { projectId: p.id, userId: 我.id, at: new Date(t - 3000), toPhase: "线索", toNode: "潜客培育" },
      { projectId: p.id, userId: 我.id, at: new Date(t - 2000), kind: "transfer", fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "潜客培育", fromOwnerId: 我.id, toOwnerId: 我.id },
      { projectId: p.id, userId: 我.id, at: new Date(t - 1000), fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "线索验证" },
    ],
  });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("节点记录的记录类型标明白", () => {
  it("列出来：换负责人那行写明不是节点变化，改节点那行写改节点", async () => {
    const r = await 查.run({ 表: "节点记录", 条件: [], 排序: { 字段: "时间", 降序: false } }, ctx());
    const 类型们 = (r.data as { 结果: Record<string, unknown>[] }).结果.map((x) => String(x.记录类型));
    expect(类型们).toHaveLength(3);
    expect(类型们[0]).toContain("改节点");
    expect(类型们[1]).toContain("换负责人");
    expect(类型们[1]).toContain("不是节点变化");
    expect(类型们[2]).toContain("改节点");
  });

  it("按记录类型分组：组名也是这套叫法；按原值 transfer 筛照样能筛", async () => {
    const g = await 查.run({ 表: "节点记录", 条件: [], 分组: "记录类型" }, ctx());
    const 组 = (g.data as { 分组: Record<string, unknown>[] }).分组.map((x) => String(x.记录类型));
    expect(组.some((x) => x.startsWith("改节点"))).toBe(true);
    expect(组.some((x) => x.startsWith("换负责人"))).toBe(true);
    const f = await 查.run({ 表: "节点记录", 条件: [{ 字段: "记录类型", 运算: "等于", 值: "transfer" }] }, ctx());
    expect((f.data as { 总数: number }).总数).toBe(1);
  });

  it("工具说明里写明：问节点怎么走只看改节点（node）的行", () => {
    expect(query_records说明(true)).toContain("换负责人");
    expect(query_records说明(true)).toContain("node");
  });
});
