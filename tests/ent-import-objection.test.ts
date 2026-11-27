/**
 * 12-22 审查 M5：导入（同步）要给客户换负责人，碰上这位客户有转让异议在「待裁定」：整行跳过、不写，原因进批次「没写进去的」明细；
 * 裁定后再导照常改。没有异议的客户照常改。人名、客户名都是编造的。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 写一批 } from "@/lib/enterprise-import/apply";
import { 换适配器, 现成适配器 } from "@/lib/enterprise-import/adapter";
import { 同步一次, 拉全量试跑 } from "@/lib/enterprise-import/sync";
import type { 原始记录 } from "@/lib/enterprise-import/types";

const 我 = { id: "tester-id", name: "测试员" };
const 客户 = (id: string, 名称: string, 电话: string, 负责人: string): 原始记录 => ({ 实体: "customer", 外部ID: id, 字段: { 客户名称: 名称, 手机号码: 电话, 客户负责人: 负责人, 备注: "" } });
let 飞书: 原始记录[] = [];

const 张 = () => prisma.user.findFirstOrThrow({ where: { name: "张伟" } });
const 李 = () => prisma.user.findFirstOrThrow({ where: { name: "李娜" } });
const 归谁 = async (名: string) => (await prisma.customer.findFirstOrThrow({ where: { name: 名 } })).salesOwnerId;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } });
  await prisma.user.create({ data: { email: "ln@x", name: "李娜", title: "销售", role: "SALES", password: "x" } });
  for (const u of await prisma.user.findMany({ where: { role: "SALES" } })) await prisma.entMember.create({ data: { userId: u.id, bizRole: "sales", line: "内贸" } });
  飞书 = [客户("fs-1", "杭州云帆科技有限公司", "13800000001", "张伟"), 客户("fs-2", "宁波海川贸易", "13800000002", "张伟"), 客户("fs-3", "温州小厂", "13800000003", "李娜")];
  换适配器("feishu", new 现成适配器("feishu", () => 飞书.map((r) => ({ ...r, 字段: { ...r.字段 } }))));
});
afterEach(() => { 换适配器("feishu", null); delete process.env.CRM_ENTERPRISE; });
afterAll(async () => { await prisma.$disconnect(); });

describe("导入改客户负责人碰上待裁定异议", () => {
  it("命中的客户不换负责人、原因进明细；没命中的照换；裁定后再同步才换", async () => {
    const { 批次Id } = await 拉全量试跑("feishu", 我.id);
    expect((await 写一批(批次Id, 我)).完了).toBe(true);
    process.env.CRM_ENTERPRISE = "1";
    const 云帆 = await prisma.customer.findFirstOrThrow({ where: { name: "杭州云帆科技有限公司" } });
    const 异议 = await prisma.entTransferObjection.create({
      data: { ownerLogId: "log1", customerId: 云帆.id, kind: "客户", targetKey: "customer", targetName: "云帆", objectorUserId: (await 张()).id, operatorUserId: 我.id, toOwnerId: (await 李()).id, status: "待裁定", expiresAt: new Date(Date.now() + 86_400_000) },
    });
    飞书 = [客户("fs-1", "杭州云帆科技有限公司", "13800000001", "李娜"), 客户("fs-2", "宁波海川贸易", "13800000002", "李娜"), 客户("fs-3", "温州小厂", "13800000003", "李娜")];
    const r = await 同步一次("feishu", { 用户: 我 });
    expect(r.结果).toBe("成功");
    expect(await 归谁("杭州云帆科技有限公司")).toBe((await 张()).id);
    expect(await 归谁("宁波海川贸易")).toBe((await 李()).id);
    const 批 = await prisma.entImportBatch.findUniqueOrThrow({ where: { id: r.批次Id! } });
    expect(批.note).toContain("这条有异议还没裁定");
    // 裁定后再导：照常改
    await prisma.entTransferObjection.update({ where: { id: 异议.id }, data: { status: "维持" } });
    expect((await 同步一次("feishu", { 用户: 我, 现在: new Date(Date.now() + 3_600_000) })).结果).toBe("成功");
    expect(await 归谁("杭州云帆科技有限公司")).toBe((await 李()).id);
  });
});
