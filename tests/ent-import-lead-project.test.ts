/**
 * 企业版只用项目时，导入的线索行要在「新线索」页（= 项目的线索阶段）看得见（10-28）。
 *
 *   线索行照旧建 Lead 行作锚点，另外建一个线索阶段的项目（来源线索 id 记在项目上）：
 *   有唯一同号客户就挂上去，没有就新建客户 + 主要联系人；已转化 / 已放弃的不建项目
 *   整批撤回：线索、多建的客户 / 联系人 / 项目一起退掉
 *   开关关：照旧只建 Lead
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
import { 撤回一批 } from "@/lib/enterprise-import/revert";
import type { 读出的表 } from "@/lib/enterprise-import/excel";

const 我 = { id: "tester-id", name: "测试员" };

function 线索表(行: string[][]): 读出的表 {
  return { 名: "线索.xlsx", 实体: "lead", 表头: ["线索ID", "线索名称", "联系人", "电话", "负责人", "线索状态"], 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
}
async function 导(表们: 读出的表[]) {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  const r = await 写一批(批次Id, 我);
  expect(r.完了).toBe(true);
  return 批次Id;
}
let 李娜 = "";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.开 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  李娜 = (await prisma.user.create({ data: { email: "ln@x", name: "李娜", title: "销售", role: "SALES", password: "x" } })).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("企业版只用项目：导入线索建线索阶段的项目", () => {
  it("新号：建客户 + 主要联系人 + 线索阶段项目，没有跟进、没有下一步时间", async () => {
    await 导([线索表([["L1", "温州小厂", "陈总", "13600000001", "李娜", "待跟进"]])]);
    const 线索 = await prisma.lead.findFirstOrThrow({ where: { name: "温州小厂" } });
    const 项目 = await prisma.project.findFirstOrThrow({ include: { followUps: true, logs: true } });
    expect(项目).toMatchObject({ name: "温州小厂", phase: "线索", sourceLeadId: 线索.id, ownerId: 李娜, nextStepAt: null });
    expect(项目.followUps).toHaveLength(0);
    expect(项目.logs).toHaveLength(1);
    const 客户 = await prisma.customer.findUniqueOrThrow({ where: { id: 项目.customerId } });
    expect(客户).toMatchObject({ name: "温州小厂", phone: "13600000001", salesOwnerId: 李娜 });
    const 联系人 = await prisma.contact.findFirstOrThrow({ where: { customerId: 客户.id } });
    expect(联系人).toMatchObject({ name: "陈总", phone: "13600000001", isPrimary: true });
    expect(项目.contactId).toBe(联系人.id);
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("有唯一同号客户：挂到已有客户上，不新建客户 / 联系人", async () => {
    const 老 = await prisma.customer.create({ data: { name: "已有客户", phone: "13600000001", salesOwnerId: 我.id } });
    await 导([线索表([["L1", "温州小厂", "陈总", "13600000001", "李娜", ""]])]);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.contact.count()).toBe(0);
    expect((await prisma.project.findFirstOrThrow()).customerId).toBe(老.id);
  });

  it("已转化 / 已放弃的线索不建项目", async () => {
    await 导([
      线索表([
        ["L1", "转化过的", "陈总", "13600000001", "李娜", "已转化"],
        ["L2", "放弃了的", "王总", "13600000002", "李娜", "已放弃"],
        ["L3", "还在跟的", "赵总", "13600000003", "李娜", "跟进中"],
      ]),
    ]);
    expect(await prisma.lead.count()).toBe(3);
    expect((await prisma.project.findMany()).map((p) => p.name)).toEqual(["还在跟的"]);
  });

  it("整批撤回：线索、客户、联系人、项目都退干净", async () => {
    const 批 = await 导([线索表([["L1", "温州小厂", "陈总", "13600000001", "李娜", ""]])]);
    expect(await prisma.project.count()).toBe(1);
    const 撤 = await 撤回一批(批, 我);
    expect(撤).toMatchObject({ 状态: "reverted", 留下数: 0 });
    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.project.count()).toBe(0);
  });

  it("开关关：照旧只建 Lead，不建项目 / 客户", async () => {
    mocks.开 = false;
    await 导([线索表([["L1", "温州小厂", "陈总", "13600000001", "李娜", ""]])]);
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
  });

  it("不是企业版：照旧只建 Lead", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    await 导([线索表([["L1", "温州小厂", "陈总", "13600000001", "李娜", ""]])]);
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.project.count()).toBe(0);
  });
});
