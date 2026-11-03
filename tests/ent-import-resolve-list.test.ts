/**
 * 冲突处理批要能在「导入与同步」的批次列表里找到（11-03 完成度 D7-2）。
 *   定冲突「采用原系统」会建一个冲突处理批（kind resolve），撤回、恢复都支持，
 *   但列表只列首次导入和同步，界面上找不到这一批，建回来的客户想撤也撤不了。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "tester-id", name: "测试员", email: "t@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import { 撤回一批 } from "@/lib/enterprise-import/revert";
import { 定冲突 } from "@/lib/enterprise-import/resolve";
import { 企业版导入概况 } from "@/app/(app)/settings/enterprise-import-actions";
import type { 读出的表 } from "@/lib/enterprise-import/excel";

const 我 = { id: "tester-id", name: "测试员" };
const 客户表 = (C2备注: string): 读出的表 => {
  const 行 = [
    ["C1", "杭州云帆科技有限公司", "13800000001", "张伟", "A", "老客户"],
    ["C2", "宁波海川贸易", "13800000002", "李娜", "B", C2备注],
  ];
  return { 名: "客户.xlsx", 实体: "customer", 表头: ["记录ID", "客户名称", "手机号码", "客户负责人", "客户等级", "备注"], 行, 行号: [2, 3], 提醒: [] };
};
async function 导(表: 读出的表) {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: [表], 建议器: null });
  await 定这批业务线(批次Id, "外贸");
  expect((await 写一批(批次Id, 我)).完了).toBe(true);
  return 批次Id;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  await prisma.entMember.create({ data: { userId: 我.id, bizRole: "director" } });
  await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } });
  await prisma.user.create({ data: { email: "ln@x", name: "李娜", title: "销售", role: "SALES", password: "x" } });
});
afterAll(async () => { await prisma.$disconnect(); });

describe("冲突处理批在批次列表里", () => {
  it("本地删了、采用原系统建回来：这一批列在概况里，从列表拿到的 id 撤回能删掉建回来的", async () => {
    await 导(客户表(""));
    await prisma.customer.deleteMany({ where: { name: "宁波海川贸易" } });
    await 导(客户表("原系统补的"));
    const 冲 = await prisma.entConflict.findFirstOrThrow();
    const r = await 定冲突([冲.id], "采用原系统", 我);
    expect(r.定了).toBe(1);

    const 行 = (await 企业版导入概况()).批次们.find((b) => b.id === r.批次Id);
    expect(行).toMatchObject({ 类型: "resolve", 状态: "done", 新建: 1 });

    expect(await 撤回一批(行!.id, 我)).toMatchObject({ 状态: "reverted", 删掉: 1 });
    expect(await prisma.customer.findFirst({ where: { name: "宁波海川贸易" } })).toBeNull();
  });
});
