/**
 * 企业版导入的负责人只认业务角色（11-03 完成度 D7-1）：
 *   报告侧（试跑）按业务角色认人，写入侧原来按账号角色（排除账号 ADMIN）——
 *   账号 ADMIN、业务是销售的人试跑显示认出来了，写进去却是「无负责人」、项目进了公海。
 *   现在写入和试跑同一口径；没设业务角色的、只读管理员照旧当不了（报告里要提醒）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑, 重新试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import type { 读出的表 } from "@/lib/enterprise-import/excel";

const 我 = { id: "tester-id", name: "测试员" };
let 王总 = "", 只读 = "";

function 线索表(行: string[][]): 读出的表 {
  return { 名: "线索.xlsx", 实体: "lead", 表头: ["线索ID", "线索名称", "联系人", "电话", "负责人", "线索状态"], 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  王总 = (await prisma.user.create({ data: { email: "w@x", name: "王总", title: "", role: "ADMIN", password: "x" } })).id;
  只读 = (await prisma.user.create({ data: { email: "r@x", name: "只读", title: "", role: "ADMIN", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 王总, bizRole: "sales" }, { userId: 只读, bizRole: "admin" }] });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("企业版导入负责人只认业务角色", () => {
  it("账号 ADMIN、业务是销售：客户、项目都写给他，不进公海", async () => {
    const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: [线索表([["L1", "温州小厂", "陈总", "13600000001", "王总", "待跟进"]])], 建议器: null });
    await 定这批业务线(批次Id, "外贸");
    expect((await 写一批(批次Id, 我)).完了).toBe(true);
    const 项目 = await prisma.project.findFirstOrThrow();
    expect(项目).toMatchObject({ ownerId: 王总, pooledAt: null });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 项目.customerId } })).salesOwnerId).toBe(王总);
  });

  it("手动把负责人映射到只读管理员：报告提醒当不了负责人", async () => {
    const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: [线索表([["L1", "温州小厂", "陈总", "13600000001", "老刘", "待跟进"]])], 建议器: null });
    const out = await 重新试跑(批次Id, { 负责人: { 老刘: 只读 } }, 我.id);
    expect(out.报告.提醒.join("\n")).toMatch(/只读.*当不了负责人|当不了负责人.*只读/);
  });
});
