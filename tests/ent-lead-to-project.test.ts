/**
 * 企业版老线索批量转成线索阶段的项目（src/lib/enterprise/lead-to-project.ts）。
 *
 *   还在推的线索各建一个线索阶段的项目，来源线索记它；已转化 / 已放弃的不转；已经有来源项目的跳过
 *   客户：连着的用它、唯一同号的挂它、都没有新建（有联系人名字顺手建主要联系人）
 *   线索没负责人跟最早的管理员；Lead 行不动
 *   跑第二次不动（记号）；不是企业版、或没开项目模式一行不建
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
import { getSetting, invalidateSettingsCache } from "@/lib/settings";
import { 老线索转项目, 转项目一次, 转项目记号键, 忘掉转项目 } from "@/lib/enterprise/lead-to-project";
import { 第一个节点 } from "@/lib/project/nodes";

let 管理员 = "";
let 张伟 = "";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉转项目();
  mocks.开 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  管理员 = (await prisma.user.create({ data: { email: "a@x", name: "管理员", title: "管理员", role: "ADMIN", password: "x" } })).id;
  张伟 = (await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } })).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

const 线索 = (d: { name: string; status?: string; phone?: string; contact?: string; ownerId?: string | null; customerId?: string }) =>
  prisma.lead.create({ data: { status: "待跟进", ...d } });

describe("老线索转项目", () => {
  it("还在推的各建一个线索阶段项目；已转化 / 已放弃不转；Lead 行不动", async () => {
    const a = await 线索({ name: "甲公司", phone: "13800000001", contact: "王经理", ownerId: 张伟 });
    const b = await 线索({ name: "乙公司", status: "跟进中", ownerId: 张伟 });
    await 线索({ name: "丙公司", status: "已转化", ownerId: 张伟 });
    await 线索({ name: "丁公司", status: "已放弃", ownerId: 张伟 });

    expect(await 老线索转项目()).toEqual({ 项目: 2, 新客户: 2, 新联系人: 1 });

    const 项目们 = await prisma.project.findMany({ include: { customer: true, contact: true }, orderBy: { name: "asc" } });
    expect(项目们.map((p) => p.sourceLeadId).sort()).toEqual([a.id, b.id].sort());
    for (const p of 项目们) {
      expect([p.phase, p.node]).toEqual([第一个节点.phase, 第一个节点.node]);
      expect(p.ownerId).toBe(张伟);
      expect(p.nextStepAt).toBeNull();
    }
    const 甲 = 项目们.find((p) => p.sourceLeadId === a.id)!;
    expect(甲.customer).toMatchObject({ name: "甲公司", phone: "13800000001", salesOwnerId: 张伟 });
    expect(甲.contact).toMatchObject({ name: "王经理", isPrimary: true, customerId: 甲.customerId });
    expect(项目们.find((p) => p.sourceLeadId === b.id)!.contactId).toBeNull();
    expect(await prisma.projectNodeLog.count()).toBe(2);
    expect(await prisma.followUp.count()).toBe(0);
    const 甲行 = await prisma.lead.findUniqueOrThrow({ where: { id: a.id } });
    expect([甲行.status, 甲行.customerId]).toEqual(["待跟进", null]);
    expect(await getSetting<boolean>(转项目记号键)).toBe(true);
  });

  it("客户：连着的用它；唯一同号的挂它（不新建联系人，挂主要联系人）；同号两位就新建", async () => {
    const 连着 = await prisma.customer.create({ data: { name: "老客户", phone: "13900000000", salesOwnerId: 张伟 } });
    const 同号 = await prisma.customer.create({ data: { name: "同号客户", phone: "13800000002", salesOwnerId: 张伟 } });
    const 主联 = await prisma.contact.create({ data: { name: "主联系人", isPrimary: true, customerId: 同号.id } });
    await prisma.customer.create({ data: { name: "重号一", phone: "13800000003", salesOwnerId: 张伟 } });
    await prisma.customer.create({ data: { name: "重号二", phone: "13800000003", salesOwnerId: 张伟 } });
    const x = await 线索({ name: "连着的", customerId: 连着.id, ownerId: 张伟 });
    const y = await 线索({ name: "同号的", phone: "138 0000 0002", contact: "不建", ownerId: 张伟 });
    const z = await 线索({ name: "重号的", phone: "13800000003", ownerId: 张伟 });

    expect(await 老线索转项目()).toEqual({ 项目: 3, 新客户: 1, 新联系人: 0 });
    const 按 = async (id: string) => prisma.project.findFirstOrThrow({ where: { sourceLeadId: id } });
    expect((await 按(x.id)).customerId).toBe(连着.id);
    expect(await 按(y.id)).toMatchObject({ customerId: 同号.id, contactId: 主联.id });
    const zc = await prisma.customer.findUniqueOrThrow({ where: { id: (await 按(z.id)).customerId } });
    expect(zc.name).toBe("重号的");
  });

  it("没负责人跟最早的管理员；已有来源项目的跳过；第二次不动", async () => {
    const 无主 = await 线索({ name: "无主", ownerId: null });
    const 转过 = await 线索({ name: "转过", ownerId: 张伟 });
    const c = await prisma.customer.create({ data: { name: "转过", phone: "", salesOwnerId: 张伟 } });
    await prisma.project.create({
      data: { name: "转过", customerId: c.id, ownerId: 张伟, creatorId: 张伟, amount: 0, phase: 第一个节点.phase, node: 第一个节点.node, sourceLeadId: 转过.id },
    });

    expect(await 转项目一次()).toEqual({ 项目: 1, 新客户: 1, 新联系人: 0 });
    expect((await prisma.project.findFirstOrThrow({ where: { sourceLeadId: 无主.id } })).ownerId).toBe(管理员);

    await 线索({ name: "后来的", ownerId: 张伟 });
    忘掉转项目();
    expect(await 转项目一次()).toBeNull();
    expect(await prisma.project.count()).toBe(2);
  });

  it("不是企业版、或没开项目模式：一行不建、不记记号", async () => {
    await 线索({ name: "甲", ownerId: 张伟 });
    mocks.开 = false;
    expect(await 老线索转项目()).toBeNull();
    vi.stubEnv("CRM_ENTERPRISE", "");
    mocks.开 = true;
    expect(await 老线索转项目()).toBeNull();
    expect(await prisma.project.count()).toBe(0);
    expect(await getSetting<boolean>(转项目记号键)).toBeFalsy();
  });
});
