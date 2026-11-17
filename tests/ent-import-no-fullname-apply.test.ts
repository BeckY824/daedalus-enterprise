/**
 * 客户抬头 PR-7（P-抬头-16）写库这一半：没有全称的客户照建（全称落空串、不补名），子表按外部 ID 挂上；
 * 报告里数得出「没有全称」「按名称挂不上」；以前导过的、原系统这次全称空着，不清我们这边的全称、不算冲突。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

function 表(名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 {
  return { 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
}
const 客户表 = (行: string[][]) => 表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人"], 行);
const 联系人表 = (行: string[][]) => 表("联系人.xlsx", "contact", ["联系人ID", "客户ID", "客户名称", "姓名", "手机"], 行);

const 我 = { id: "tester-id", name: "测试员" };

async function 导(表们: 读出的表[]) {
  const { 批次Id, 报告 } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
  await 定这批业务线(批次Id, "外贸");
  return { 报告, r: await 写一批(批次Id, 我) };
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  const 张伟 = (await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 张伟, bizRole: "sales" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("没有全称的客户写进库", () => {
  it("全称落空串、不补名；联系人按客户 ID 挂上；只写客户名称的进报告「按名称挂不上」", async () => {
    const { 报告, r } = await 导([
      客户表([
        ["C1", "", "13800000001", "张伟"],
        ["C2", "宁波海川贸易", "13800000002", "张伟"],
      ]),
      联系人表([
        ["P1", "C1", "", "王经理", "13700000001"],
        ["P2", "", "13800000001", "李经理", "13700000002"],
        ["P3", "", "宁波海川贸易", "赵经理", "13700000003"],
      ]),
    ]);
    expect(报告.问题分类).toContainEqual({ 实体: "customer", 级别: "提醒", 类别: "没有全称", 数: 1 });
    expect(报告.问题分类).toContainEqual({ 实体: "contact", 级别: "跳过", 类别: "按名称挂不上", 数: 1 });
    expect(报告.问题.find((p) => p.外部ID === "P2")).toMatchObject({ 类别: "按名称挂不上", 行号: 3 });
    expect(r).toMatchObject({ 失败: 0 });

    const c1 = await prisma.customer.findFirstOrThrow({ where: { phone: "13800000001" }, include: { contacts: true } });
    expect(c1.name).toBe("");
    expect(c1.contacts.map((c) => c.name)).toEqual(["王经理"]);
    const c2 = await prisma.customer.findFirstOrThrow({ where: { name: "宁波海川贸易" }, include: { contacts: true } });
    // 有全称的老做法不变：按客户名称照挂
    expect(c2.contacts.map((c) => c.name)).toEqual(["赵经理"]);
    expect(await prisma.contact.count({ where: { name: "李经理" } })).toBe(0);
  });

  it("以前导过、这次原系统全称空着：不清我们这边的全称，不记冲突；原系统给了全称照三方比对补上", async () => {
    await 导([客户表([["C1", "杭州云帆科技有限公司", "13800000001", "张伟"], ["C2", "", "13800000002", "张伟"]])]);
    const c1 = await prisma.customer.findFirstOrThrow({ where: { phone: "13800000001" } });
    const c2 = await prisma.customer.findFirstOrThrow({ where: { phone: "13800000002" } });
    expect(c2.name).toBe("");

    const { 报告, r } = await 导([客户表([["C1", "", "13800000001", "张伟"], ["C2", "宁波海川贸易", "13800000002", "张伟"]])]);
    expect(r).toMatchObject({ 冲突: 0, 失败: 0, 新建: 0 });
    // 以前导过的不提「没有全称」
    expect(报告.问题.some((p) => p.类别 === "没有全称")).toBe(false);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c1.id } })).name).toBe("杭州云帆科技有限公司");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c2.id } })).name).toBe("宁波海川贸易");
    expect(await prisma.entConflict.count()).toBe(0);
  });
});
