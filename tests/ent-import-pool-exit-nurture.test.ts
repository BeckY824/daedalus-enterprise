/**
 * 企业版导入里无主客户出入公海时的潜客培育项目（M-公海-14、P-撤销-01，11-17），整条路走一遍：试跑 → 写一批 → 撤回一批 → 恢复一批。
 *   - 后来指定了默认负责人再导：无主客户出公海，整批写完再补潜客培育（负责人 = 默认负责人、创建人 = 导入的人）
 *   - 同一批里商机行给这位建了项目：不再多补
 *   - 撤回这一批（客户回占位、回公海）：补的没动过就删；动过的留在原负责人名下，列进撤回结果
 *   - 恢复撤回的那一批（客户又出公海）：照出公海的规矩再补
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑, 重新试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import { 撤回一批, 恢复一批, 培育留下话 } from "@/lib/enterprise-import/revert";
import { 培育行 } from "@/lib/enterprise-import/nurture-rows";
import { 无主入池理由 } from "@/lib/enterprise-import/project-target";
import { 第一个节点 } from "@/lib/project/nodes";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

const 表 = (名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 => ({ 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] });
const 客户头 = ["记录ID", "客户名称", "手机号码", "客户负责人", "客户等级", "备注"];
const 无主客户表 = () => 表("客户.xlsx", "customer", 客户头, [
  ["C1", "示例空着", "13800006001", "", "", ""],
  ["C2", "示例对不上", "13800006002", "查无此人", "", ""],
]);
const 商机表 = () => 表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段"], [["O1", "C2", "示例商机", "需求确认"]]);

const 我 = { id: "tester-id", name: "测试员" };
let 李娜 = "";

async function 跑(表们: 读出的表[], 默认负责人Id?: string) {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  if (默认负责人Id) await 重新试跑(批次Id, { 默认负责人Id }, 我.id);
  await 定这批业务线(批次Id, "外贸");
  const r = await 写一批(批次Id, 我);
  expect(r).toMatchObject({ 完了: true, 失败: 0 });
  return 批次Id;
}
const 读 = (name: string) => prisma.customer.findFirstOrThrow({ where: { name }, include: { pool: true, projects: true } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  李娜 = (await prisma.user.create({ data: { email: "ln@x", name: "李娜", title: "销售", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 我.id, bizRole: "director" }, { userId: 李娜, bizRole: "sales" }] });
});
afterEach(() => void vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("导入 → 撤回 → 恢复", () => {
  it("后来指定默认负责人再导：出公海的零项目客户整批写完补 1 个；撤回删掉、回零项目；恢复又补上", async () => {
    await 跑([无主客户表()]);
    expect((await 读("示例空着")).pool).toMatchObject({ reason: 无主入池理由 });
    const 二 = await 跑([无主客户表()], 李娜);
    for (const n of ["示例空着", "示例对不上"]) {
      const c = await 读(n);
      expect(c.pool).toBeNull();
      expect(c.projects).toHaveLength(1);
      expect(c.projects[0]).toMatchObject({ ownerId: 李娜, creatorId: 我.id, node: 第一个节点.node });
    }
    expect(await prisma.entImportRow.count({ where: { batchId: 二, entity: 培育行, kind: "create" } })).toBe(2);

    const 撤 = await 撤回一批(二, 我);
    expect(撤.留下数).toBe(0);
    for (const n of ["示例空着", "示例对不上"]) {
      const c = await 读(n);
      expect(c.pool).toMatchObject({ reason: 无主入池理由 });
      expect(c.projects).toHaveLength(0);
    }
    expect(await prisma.entImportRow.count({ where: { batchId: 二, entity: 培育行 } })).toBe(0);

    await 恢复一批(二, 我);
    for (const n of ["示例空着", "示例对不上"]) {
      const c = await 读(n);
      expect(c.pool).toBeNull();
      expect(c.projects).toHaveLength(1);
      expect(c.projects[0]).toMatchObject({ ownerId: 李娜, creatorId: 我.id });
    }
  });

  it("补的项目撤回前有人记了沟通：客户照样回公海，项目留在原负责人名下，撤回结果里列出来", async () => {
    await 跑([无主客户表()]);
    const 二 = await 跑([无主客户表()], 李娜);
    const c = await 读("示例空着");
    const p = c.projects[0];
    const f = await prisma.followUp.create({ data: { customerId: c.id, ownerId: 李娜, type: "PHONE", title: "电话", content: "聊了" } });
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: p.id, node: 第一个节点.node } });

    const 撤 = await 撤回一批(二, 我);
    expect(撤.留下).toEqual([expect.objectContaining({ 实体: "customer", 外部ID: "C1", 名称: p.name, 原因: 培育留下话 })]);
    expect((await 读("示例空着")).pool).toMatchObject({ reason: 无主入池理由 });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ ownerId: 李娜 });
    expect((await 读("示例对不上")).projects).toHaveLength(0);
  });

  it("同一批里商机行给出公海的客户建了项目：不再多补", async () => {
    await 跑([无主客户表()]);
    await 跑([无主客户表(), 商机表()], 李娜);
    const 有商机 = await 读("示例对不上");
    expect(有商机.projects.map((p) => p.name)).toEqual(["示例商机"]);
    expect((await 读("示例空着")).projects).toHaveLength(1);
  });
});
