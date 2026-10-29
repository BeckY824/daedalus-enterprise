/**
 * 企业版清掉用不到的老数据（src/lib/enterprise/legacy-cleanup.ts）。
 *
 *   开关开：商机 / 合同连子表删干净，挂商机 / 老订单（orderId 那格还在，订单表 066 已删）的附件连文件删；
 *          客户、项目、跟进、联系人、线索一条不少，跟进只是不再挂商机
 *   跑第二次不动（记号）；不是企业版一行不动（个人版 / 团队版行为不变）
 *   数据接入对照行只删指向商机的
 *   清过之后：冲突处理「本地已删 · 采用原系统」也不建回商机
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 开: true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { getSetting, invalidateSettingsCache } from "@/lib/settings";
import { 附件文件 } from "@/lib/attachments";
import { 清理老数据, 清理一次, 清理记号键, 忘掉清理 } from "@/lib/enterprise/legacy-cleanup";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批 } from "@/lib/enterprise-import/apply";
import { 定冲突 } from "@/lib/enterprise-import/resolve";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

const 我 = { id: "tester-id", name: "测试员" };
let 目录 = "";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉清理();
  mocks.开 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  目录 = fs.mkdtempSync(path.join(os.tmpdir(), "ent-clean-"));
  vi.stubEnv("CRM_DATA_DIR", 目录);
  fs.mkdirSync(path.join(目录, "attachments"));
  await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
  await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } });
});

afterEach(() => {
  fs.rmSync(目录, { recursive: true, force: true });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

async function 附件(挂: { opportunityId?: string; orderId?: string; leadId?: string; contactId?: string }) {
  const a = await prisma.attachment.create({ data: { ...挂, name: "a.pdf", mime: "application/pdf", size: 3, sha256: "x" } });
  fs.writeFileSync(附件文件(a.id), "abc");
  return a.id;
}

/** 一整套：客户、联系人、线索、项目、两条跟进（一条挂商机）、商机 + 成交、合同、附件（含只挂老订单 id 的）、对照行 */
async function 种一套() {
  const c = await prisma.customer.create({ data: { name: "测试客户甲", phone: "13900000001", salesOwnerId: 我.id } });
  const 联系人 = await prisma.contact.create({ data: { name: "联系人甲", customerId: c.id, isPrimary: true } });
  const 线索 = await prisma.lead.create({ data: { name: "线索甲" } });
  const 项目 = await prisma.project.create({ data: { name: "项目甲", customerId: c.id, ownerId: 我.id, creatorId: 我.id } });
  const 商机 = await prisma.opportunity.create({ data: { name: "商机甲", customerId: c.id, ownerId: 我.id } });
  await prisma.opportunityClose.create({ data: { opportunityId: 商机.id } });
  await prisma.contract.create({ data: { customerId: c.id, amount: 1000, signedAt: new Date("2026-01-01") } });
  const 挂商机跟进 = await prisma.followUp.create({
    data: { type: "PHONE", title: "电话", content: "聊了", customerId: c.id, ownerId: 我.id, opportunityId: 商机.id },
  });
  await prisma.followUp.create({ data: { type: "VISIT", title: "拜访", content: "上门", customerId: c.id, ownerId: 我.id } });

  const 附件们 = {
    商机: await 附件({ opportunityId: 商机.id }),
    // 订单表删了，orderId 那一格没外键约束（041），老库里还可能留着这种附件
    订单: await 附件({ orderId: "old-order-id" }),
    线索: await 附件({ leadId: 线索.id }),
    联系人: await 附件({ contactId: 联系人.id }),
    商机兼线索: await 附件({ opportunityId: 商机.id, leadId: 线索.id }),
  };
  const 对照 = (entity: string, externalId: string, targetId: string) =>
    prisma.entExternalRef.create({ data: { source: "excel", entity, externalId, targetId, fingerprint: "f", written: "{}", raw: "{}" } });
  await 对照("opportunity", "O1", 商机.id);
  await 对照("opportunity", "O2", 项目.id); // 项目模式下 opportunity 这一类指向项目：不动
  await 对照("customer", "C1", c.id);
  await 对照("lead", "L1", 线索.id);
  return { c, 项目, 挂商机跟进, 附件们 };
}

const 留着的 = async () => ({
  客户: await prisma.customer.count(),
  项目: await prisma.project.count(),
  跟进: await prisma.followUp.count(),
  联系人: await prisma.contact.count(),
  线索: await prisma.lead.count(),
});
const 老表 = async () => ({
  商机: await prisma.opportunity.count(),
  成交: await prisma.opportunityClose.count(),
  合同: await prisma.contract.count(),
  附件: await prisma.attachment.count(),
  对照: await prisma.entExternalRef.count(),
});

describe("企业版清老数据", () => {
  it("开关开：老表删干净，客户 / 项目 / 跟进 / 联系人 / 线索一条不少，只删指向商机的对照行", async () => {
    const { 挂商机跟进, 附件们 } = await 种一套();
    const 之前 = await 留着的();
    const 日志 = vi.spyOn(console, "log").mockImplementation(() => {});

    const r = await 清理老数据();
    expect(r).toEqual({ 附件: 2, 合同: 1, 商机: 1, 对照: 1, 跟进解挂: 1 });
    expect(await 留着的()).toEqual(之前);
    expect(await 老表()).toEqual({ 商机: 0, 成交: 0, 合同: 0, 附件: 3, 对照: 3 });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: 挂商机跟进.id } })).opportunityId).toBeNull();
    expect((await prisma.entExternalRef.findMany({ select: { externalId: true }, orderBy: { externalId: "asc" } })).map((x) => x.externalId)).toEqual(["C1", "L1", "O2"]);
    // 文件：挂商机 / 订单的删了，挂线索 / 联系人的（含既挂商机又挂线索的）留着
    expect(fs.existsSync(附件文件(附件们.商机))).toBe(false);
    expect(fs.existsSync(附件文件(附件们.订单))).toBe(false);
    expect(fs.existsSync(附件文件(附件们.线索))).toBe(true);
    expect(fs.existsSync(附件文件(附件们.联系人))).toBe(true);
    expect(fs.existsSync(附件文件(附件们.商机兼线索))).toBe(true);
    expect(await getSetting<boolean>(清理记号键)).toBe(true);
    // 一行计数日志，不带客户数据
    expect(日志).toHaveBeenCalledTimes(1);
    const 行 = String(日志.mock.calls[0][0]);
    expect(行).toContain("[老数据清理]");
    expect(行).not.toContain("测试客户甲");
    日志.mockRestore();
  });

  it("跑第二次不动：有记号就返回 null；同一进程 清理一次 只跑一遍", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await 种一套();
    expect(await 清理一次()).not.toBeNull();
    // 清过之后又冒出来的商机（比如恢复了一批老导入）：记号在，不再删
    const c = await prisma.customer.findFirstOrThrow();
    await prisma.opportunity.create({ data: { name: "后来的", customerId: c.id, ownerId: 我.id } });
    expect(await 清理一次()).not.toBeNull(); // 同一进程：还是第一次的结果
    忘掉清理();
    expect(await 清理一次()).toBeNull();
    expect(await 清理老数据()).toBeNull();
    expect(await prisma.opportunity.count()).toBe(1);
    vi.restoreAllMocks();
  });

  it("不是企业版：一行不动，也不记记号（个人版 / 团队版照旧）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const { 附件们 } = await 种一套();
    const 之前 = { ...(await 留着的()), ...(await 老表()) };
    expect(await 清理老数据()).toBeNull();
    expect(await 清理一次()).toBeNull();
    expect({ ...(await 留着的()), ...(await 老表()) }).toEqual(之前);
    expect(fs.existsSync(附件文件(附件们.商机))).toBe(true);
    expect(await getSetting<boolean>(清理记号键)).toBeFalsy();
  });

  it("清空的库也照样记记号，计数全 0", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await 清理老数据()).toEqual({ 附件: 0, 合同: 0, 商机: 0, 对照: 0, 跟进解挂: 0 });
    expect(await getSetting<boolean>(清理记号键)).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("同步不会把商机建回来", () => {
  function 表(名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 {
    return { 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
  }
  const 客户表 = () => 表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人"], [["C1", "测试客户乙", "13800000001", "张伟"]]);
  const 商机表 = (阶段: string) => 表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段"], [["O1", "C1", "老商机", 阶段]]);
  async function 导(表们: 读出的表[]) {
    const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
    expect((await 写一批(批次Id, 我)).完了).toBe(true);
  }
  /** 改成项目之前（开关关）导进来的商机，本地删了，原系统又改了：记下一笔「本地已删」 */
  async function 老商机删了又改() {
    mocks.开 = false;
    await 导([客户表(), 商机表("初步接洽")]);
    expect(await prisma.opportunity.count()).toBe(1);
    await prisma.opportunity.deleteMany({});
    await 导([客户表(), 商机表("需求确认")]);
    const 冲 = await prisma.entConflict.findFirstOrThrow({ where: { entity: "opportunity" } });
    expect(冲.localDeleted).toBe(true);
    mocks.开 = true;
    return 冲;
  }

  it("改成项目之前记下的商机冲突：采用原系统不建回商机", async () => {
    const 冲 = await 老商机删了又改();
    const r = await 定冲突([冲.id], "采用原系统", 我);
    expect(r.定了).toBe(0);
    expect(r.没定[0].原因).toContain("不再建回商机");
    expect(await prisma.opportunity.count()).toBe(0);
    expect(await prisma.entConflict.findUniqueOrThrow({ where: { id: 冲.id } })).toMatchObject({ status: "待定" });
  });

  it("清理之后这笔冲突还在：采用原系统照样不建回商机", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const 冲 = await 老商机删了又改();
    await 清理老数据(); // 商机本地早删了，对照行指的 id 不在被删的商机里，留着
    const r = await 定冲突([冲.id], "采用原系统", 我);
    expect(r.定了).toBe(0);
    expect(r.没定[0].原因).toContain("不再建回商机");
    expect(await prisma.opportunity.count()).toBe(0);
    vi.restoreAllMocks();
  });

  it("清理之后再同步同一条商机：建成项目，不建商机", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.开 = false;
    await 导([客户表(), 商机表("初步接洽")]);
    mocks.开 = true;
    await 清理老数据();
    expect(await prisma.opportunity.count()).toBe(0);
    await 导([客户表(), 商机表("需求确认")]);
    expect(await prisma.opportunity.count()).toBe(0);
    expect(await prisma.project.count()).toBe(1);
    vi.restoreAllMocks();
  });
});
