/**
 * 企业版「交接中」（2026-10-26，测试清单 D10：转出去的数据，交接完成前接手人看不到）：
 *   - 离职：11-03 起企业版办离职只停用、名下原地不动，不再发起离职交接（交接到「项目 → 离职交接」，
 *     见 ent-offboard-handover.test.ts）。升级前发起、还没了结的老离职交接照旧：接手人确认了才转，转完看得到、有留痕；
 *     撤回（发起人 / 管理员）、拒收（接手人）什么都不转；没了结不能再办离职；成员恢复启用，没确认的作废
 *   - 转让（负责人本人发起的走申请）：给别人的先不换负责人；重复发起不重复记；确认时只转还归原负责人的，名下的活和换负责人记录一起走
 *   - 批量转让同单条（P-转-16，11-10）：不看「交接要确认」开关，负责人本人的走申请；实线上级、系统管理员直接转
 *   - 两个人同时了结同一笔只成一个；转给自己照旧当场换
 *   - 不建交接：企业版（库里留着老开关也一样）、不是企业版，离职 / 转让和原来一样当场转，一行交接都不写；不是企业版确认回错、列表回空
 *   - 单条换负责人（P-转-16，11-10）：客户编辑页整表保存、详情页就地改负责人不看规则开关——负责人本人发起的走申请移交、负责人不换、
 *     别的格照存；实线上级、系统管理员直接转；转给自己当场换
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { deactivateUser, reactivateUser, 停用清点 } from "@/app/(app)/settings/actions";
import { assignSalesOwner, patchCustomer, saveCustomer, deleteCustomers } from "@/app/(app)/customers/actions";
import { 待确认的交接, 确认交接, 撤回交接, 拒收交接 } from "@/app/(app)/customers/handover-actions";
import { 了结 } from "@/lib/enterprise/handover-db";
import { 以谁的身份 } from "@/lib/enterprise/visibility";
import { 可选项 } from "@/lib/enterprise/dict";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";
import { 放回公海 } from "@/lib/project/db";
import { 交接全部 } from "@/app/(app)/projects/handover/actions";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 销售: 人, 接手: 人;
let 号 = 0;

async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = (salesOwnerId: string, followStatus = "待跟进") =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1380000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 接手看得到 = () => 以谁的身份(接手.id, () => prisma.customer.findMany({ select: { id: true } }));
const 一笔 = () => prisma.entHandover.findFirstOrThrow();
/** 升级前（11-03 C4-4 之前）发起、还没了结的离职交接：人已停用，名下留着，记一行待确认 */
async function 老离职交接(way = "转交") {
  await prisma.user.update({ where: { id: 销售.id }, data: { active: false } });
  const ids = (await prisma.customer.findMany({ where: { salesOwnerId: 销售.id }, select: { id: true } })).map((c) => c.id);
  return prisma.entHandover.create({ data: { kind: "离职", way, fromUserId: 销售.id, toUserId: 接手.id, byUserId: 老板.id, customerIds: JSON.stringify(ids), counts: JSON.stringify({ 客户: ids.length }) } });
}

beforeEach(async () => {
  await resetDb();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales", "SALES");
  接手 = await 建("taker", "SALES");
  await prisma.entMember.createMany({
    // 11-01 权限只认业务角色：老板要有总管理才能办离职，业务员要有销售
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 销售.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 接手.id, managerId: 组长.id, bizRole: "sales" },
    ],
  });
  当(老板);
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("离职交接中（升级前留下的）", () => {
  it("转交：确认前留在原负责人名下、接手人看不到；确认后转过去、看得到、有留痕；重复确认回错", async () => {
    const c = await 客户(销售.id);
    const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 销售.id } });
    await 老离职交接();
    expect(await 接手看得到()).toEqual([]);

    当(接手);
    const 列 = await 待确认的交接();
    expect(列.等我确认).toHaveLength(1);
    expect(列.等我确认[0]).toMatchObject({ kind: "离职", way: "转交", 客户: [c.name], 客户总数: 1, 我能确认: true, 我能撤回: false });
    expect(列.我发起的).toEqual([]);

    expect(await 确认交接(列.等我确认[0].id)).toEqual({ ok: true, 客户: 1 });
    expect(await 归谁(c.id)).toBe(接手.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(接手.id);
    expect((await 接手看得到()).map((x) => x.id)).toEqual([c.id]);
    expect(await 一笔()).toMatchObject({ status: "已确认", doneById: 接手.id });
    expect(await prisma.customerOwnerLog.findFirstOrThrow({ where: { customerId: c.id } })).toMatchObject({ fromOwnerId: 销售.id, toOwnerId: 接手.id, kind: "deactivate", userId: 老板.id });

    expect(await 确认交接(列.等我确认[0].id)).toMatchObject({ ok: false });
    expect((await 待确认的交接()).等我确认).toEqual([]);
  });

  it("撤回、拒收：什么都不转；别人撤不了；了结之后确认回错", async () => {
    const c = await 客户(销售.id);
    const h = await 老离职交接();

    当(组长);
    // 11-01 权限只认业务角色：报错说「总管理」，不再说「管理员」
    expect(await 撤回交接(h.id)).toEqual({ ok: false, error: "只有发起人或总管理能撤回" });
    当(接手);
    expect(await 撤回交接(h.id)).toMatchObject({ ok: false });
    当(老板);
    expect(await 拒收交接(h.id)).toEqual({ ok: false, error: "只有接手人自己能拒收" });
    expect(await 撤回交接(h.id)).toEqual({ ok: true, 客户: 0 });
    expect(await 一笔()).toMatchObject({ status: "已撤回", doneById: 老板.id });
    当(接手);
    expect(await 确认交接(h.id)).toMatchObject({ ok: false });
    expect(await 归谁(c.id)).toBe(销售.id);

    // 另一笔老的，这次接手人拒收
    const h2 = await 老离职交接();
    当(接手);
    expect(await 拒收交接(h2.id)).toEqual({ ok: true, 客户: 0 });
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: h2.id } })).status).toBe("已拒收");
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await prisma.auditLog.count({ where: { summary: { contains: "数据留在原负责人名下" } } })).toBe(2);
  });

  it("没了结不能再办；恢复启用把没确认的离职交接作废", async () => {
    await 客户(销售.id);
    await 老离职交接();
    // 人已停用，再办一次走不到交接；这里直接看守卫：恢复前再发起会被挡
    await prisma.user.update({ where: { id: 销售.id }, data: { active: true } });
    expect(await deactivateUser(销售.id, "")).toMatchObject({ ok: false, error: expect.stringContaining("还在等接手人确认") });
    await prisma.user.update({ where: { id: 销售.id }, data: { active: false } });

    expect(await reactivateUser(销售.id)).toMatchObject({ ok: true });
    expect(await 一笔()).toMatchObject({ status: "已撤回", doneById: 老板.id });
    当(接手);
    expect(await 确认交接((await 一笔()).id)).toMatchObject({ ok: false });
  });
});

describe("办离职不再发起交接（11-03 C4-4）", () => {
  it("名下有没有东西都当场停用、原地不动：不建交接、不发「等你确认」；公海方式回错", async () => {
    const c = await 客户(销售.id);
    expect(await deactivateUser(销售.id, 接手.id, "转交")).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 销售.id } })).active).toBe(false);
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await prisma.entHandover.count()).toBe(0);
    expect(await prisma.entNotice.count({ where: { userId: 接手.id } })).toBe(0);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "deactivate", entityId: 销售.id } })).toMatchObject({ summary: expect.stringContaining("原地不动") });

    const 组员 = await 建("s3", "SALES");
    await prisma.entMember.create({ data: { userId: 组员.id, managerId: 组长.id, bizRole: "sales" } });
    await 客户(组员.id);
    expect(await deactivateUser(组员.id, 接手.id, "公海")).toMatchObject({ ok: false, error: expect.stringContaining("不再放进公海") });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 组员.id } })).active).toBe(true);
    expect(await prisma.customerPool.count()).toBe(0);
  });
});

describe("转让交接中", () => {
  it("给别人先不换；重复发起不重复记；确认时只转还归原负责人的，活和换负责人记录一起走", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    const t = await prisma.task.create({ data: { title: "回电", customerId: a.id, ownerId: 销售.id } });

    当(销售);
    expect(await assignSalesOwner([a.id, b.id], 接手.id)).toMatchObject({ ok: true, updated: 0, 交接中: 2, 交接已在路上: 0 });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([销售.id, 销售.id]);
    expect(await 接手看得到()).toEqual([]);
    expect(await assignSalesOwner([a.id, b.id], 接手.id)).toMatchObject({ ok: true, 交接中: 0, 交接已在路上: 2 });
    expect(await prisma.entHandover.count()).toBe(1);

    expect((await 待确认的交接()).我发起的).toHaveLength(1);
    // 交接期间 b 被直接改给了组长（自己转给自己，不走交接）
    当(组长);
    await prisma.customer.update({ where: { id: b.id }, data: { salesOwnerId: 组长.id } });

    当(接手);
    expect(await 确认交接((await 一笔()).id)).toEqual({ ok: true, 客户: 1 });
    expect(await 归谁(a.id)).toBe(接手.id);
    expect(await 归谁(b.id)).toBe(组长.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(接手.id);
    expect(await prisma.customerOwnerLog.findFirstOrThrow({ where: { customerId: a.id } })).toMatchObject({ fromOwnerId: 销售.id, toOwnerId: 接手.id, kind: "assign" });
    expect(await prisma.customerOwnerLog.count({ where: { customerId: b.id } })).toBe(0);
  });

  it("转让原因（10-27 字典接下拉）：存在这笔交接上、列表里带着、留痕里有；不在字典里回错、一笔都不发", async () => {
    const a = await 客户(销售.id);
    const [原因] = await 可选项("transfer");
    当(销售);
    expect(await assignSalesOwner([a.id], 接手.id, "随便写的")).toMatchObject({ ok: false, error: expect.stringContaining("不在") });
    expect(await prisma.entHandover.count()).toBe(0);
    expect(await assignSalesOwner([a.id], 接手.id, 原因)).toMatchObject({ ok: true, 交接中: 1 });
    expect((await 一笔()).reason).toBe(原因);
    当(接手);
    expect((await 待确认的交接()).等我确认[0]).toMatchObject({ reason: 原因 });
    expect(await prisma.auditLog.count({ where: { summary: { contains: `（${原因}）` } } })).toBeGreaterThan(0);
  });

  it("多位原负责人：一人一笔（组长把自己的连同下属的一起转，整批走申请）", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(组长.id);
    当(组长);
    expect(await assignSalesOwner([a.id, b.id], 接手.id)).toMatchObject({ ok: true, 交接中: 2 });
    expect(await prisma.entHandover.count()).toBe(2);
  });

  it("实线上级、系统管理员批量转：直接转，不写交接（P-转-16 同单条，11-10）", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    当(组长);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
    当(老板);
    expect(await assignSalesOwner([b.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([接手.id, 接手.id]);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("转给自己：当场换", async () => {
    const a = await 客户(销售.id);
    当(组长);
    expect(await assignSalesOwner([a.id], 组长.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(a.id)).toBe(组长.id);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("两个人同时了结同一笔：只成一个", async () => {
    await 客户(销售.id);
    当(销售);
    await assignSalesOwner([(await prisma.customer.findFirstOrThrow()).id], 接手.id);
    const h = await 一笔();
    const 成 = await Promise.all([了结(prisma, h.id, "已确认", 接手), 了结(prisma, h.id, "已撤回", 老板)]);
    expect(成.filter(Boolean)).toHaveLength(1);
  });
});

describe("转让交接中放公海（11-03 完成度 C3-2）", () => {
  // 原来：交接待确认时原负责人能把客户放进公海，接手人确认后客户归他、公海那行还在，他看不到也领不到
  it("交接中的客户放不进公海（客户、只这一个项目的项目都拦）；万一已在公海，确认时不改负责人", async () => {
    const a = await 客户(销售.id);
    const p = (await prisma.project.create({ data: { name: "项目a", customerId: a.id, ownerId: 销售.id, creatorId: 销售.id, phase: "线索" } })).id;
    当(销售);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, 交接中: 1 });

    expect(await 放进公海([a.id])).toMatchObject({ ok: false, error: expect.stringContaining("交接") });
    expect(await 放回公海(销售, p)).toMatchObject({ ok: false, error: expect.stringContaining("交接") });
    expect(await prisma.customerPool.count()).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).toBeNull();

    // 老数据：交接期间已经进了公海
    await prisma.customerPool.create({ data: { customerId: a.id, userId: 销售.id, reason: "手动" } });
    当(接手);
    expect(await 确认交接((await 一笔()).id)).toEqual({ ok: true, 客户: 0 });
    expect(await 归谁(a.id)).toBe(销售.id);
  });
});

describe("交接中的客户不能删（P-删-10）", () => {
  it("转让交接待确认时删不掉（单删、批量里夹着都拦）；撤回后能删", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    当(销售);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, 交接中: 1 });
    当(老板);
    expect(await deleteCustomers([a.id])).toMatchObject({ ok: false, error: expect.stringContaining("交接") });
    expect(await deleteCustomers([a.id, b.id])).toMatchObject({ ok: false, error: expect.stringContaining(a.name) });
    expect(await prisma.customer.count()).toBe(2);
    expect(await 撤回交接((await 一笔()).id)).toMatchObject({ ok: true });
    expect(await deleteCustomers([a.id])).toMatchObject({ ok: true });
  });
});

describe("离职交接时本来在公海的客户（11-03 完成度 C4-1）", () => {
  // 原来：转交把公海里的也改到接手人名下，公海那行还在，接手人成了「原负责人」，看不到也领不到
  it("老的离职交接确认时、离职交接看板全部交给时：在公海的都不转；清点不算公海里的", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    await prisma.customerPool.create({ data: { customerId: b.id, userId: 销售.id, reason: "手动" } });
    const pb = (await prisma.project.create({ data: { name: "公海客户的项目", customerId: b.id, ownerId: 销售.id, creatorId: 销售.id, phase: "线索" } })).id;
    const tb = await prisma.task.create({ data: { title: "回电", customerId: b.id, ownerId: 销售.id } });
    const 不动 = async () => {
      expect(await 归谁(b.id)).toBe(销售.id);
      expect(await prisma.customerPool.count({ where: { customerId: b.id } })).toBe(1);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: pb } })).ownerId).toBe(销售.id);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: tb.id } })).ownerId).toBe(销售.id);
    };

    expect(await 停用清点(销售.id)).toMatchObject({ ok: true, 原地: { 客户: 1 } });
    await 老离职交接();
    当(接手);
    expect(await 确认交接((await 一笔()).id)).toEqual({ ok: true, 客户: 1 });
    expect(await 归谁(a.id)).toBe(接手.id);
    await 不动();

    // 看板：把 a 退回原负责人名下再走一遍「全部交给」
    await prisma.customer.update({ where: { id: a.id }, data: { salesOwnerId: 销售.id } });
    当(老板);
    expect((await 交接全部(销售.id, 接手.id)).ok).toBe(true);
    expect(await 归谁(a.id)).toBe(接手.id);
    await 不动();
  });
});

describe("单条换负责人（P-转-16，客户 11-09 回执 X4 / 11-10 答复稿 B12）：负责人本人发起的走申请移交，接手人确认后生效；上级、系统管理员直接转", () => {
  const 编辑 = async (id: string, patch: object) => {
    const r = await prisma.customer.findUniqueOrThrow({ where: { id } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
    return saveCustomer({ id, updatedAt: r.updatedAt.toISOString(), base, ...base, ...patch } as Parameters<typeof saveCustomer>[0]);
  };
  const 备注 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).remark;

  it("编辑页负责人本人换负责人：先发起申请移交、负责人不换、别的格照存；接手人确认后才换", async () => {
    const c = await 客户(销售.id);
    当(销售);
    expect(await 编辑(c.id, { salesOwnerId: 接手.id, remark: "改个备注" })).toMatchObject({ ok: true, id: c.id, 交接中: 1, 申请移交: true });
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await 备注(c.id)).toBe("改个备注");
    expect(await 一笔()).toMatchObject({ kind: "转让", fromUserId: 销售.id, toUserId: 接手.id, byUserId: 销售.id, status: "待确认" });
    expect(await prisma.customerOwnerLog.count()).toBe(0);
    expect(await 接手看得到()).toEqual([]);

    当(接手);
    const 列 = await 待确认的交接();
    expect(await 确认交接(列.等我确认[0].id)).toMatchObject({ ok: true, 客户: 1 });
    expect(await 归谁(c.id)).toBe(接手.id);
  });

  it("编辑页只换负责人、表单打开后别人改过别的格（合并那条路）：一样发起交接", async () => {
    const c = await 客户(销售.id);
    const r = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
    await prisma.customer.update({ where: { id: c.id }, data: { remark: "同事刚改的", updatedAt: new Date(r.updatedAt.getTime() + 5) } });
    当(销售);
    const res = await saveCustomer({ id: c.id, updatedAt: r.updatedAt.toISOString(), base, ...base, salesOwnerId: 接手.id } as Parameters<typeof saveCustomer>[0]);
    expect(res).toMatchObject({ ok: true, 交接中: 1 });
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await 备注(c.id)).toBe("同事刚改的");
    expect(await prisma.entHandover.count()).toBe(1);
  });

  it("就地改负责人（负责人本人）：发起申请移交、不换；已在路上的不再发起", async () => {
    const c = await 客户(销售.id);
    当(销售);
    expect(await patchCustomer(c.id, "salesOwnerId", 接手.id)).toEqual({ ok: true, 交接中: 1, 交接已在路上: 0, 申请移交: true });
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await patchCustomer(c.id, "salesOwnerId", 接手.id)).toMatchObject({ ok: true, 交接中: 0, 交接已在路上: 1 });
    expect(await 编辑(c.id, { salesOwnerId: 接手.id })).toMatchObject({ ok: true, 交接中: 0, 交接已在路上: 1 });
    expect(await prisma.entHandover.count()).toBe(1);
  });

  it("实线上级、系统管理员单条换负责人：编辑页、就地改都直接转，不写交接（照 P-转-01 ②④）", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    const c = await 客户(销售.id);
    // 上级不能改客户资料（编辑页挡），只就地改负责人
    当(组长);
    expect(await patchCustomer(a.id, "salesOwnerId", 接手.id)).not.toHaveProperty("交接中");
    当(老板);
    expect(await 编辑(b.id, { salesOwnerId: 接手.id })).toMatchObject({ ok: true });
    expect(await patchCustomer(c.id, "salesOwnerId", 接手.id)).not.toHaveProperty("交接中");
    expect([await 归谁(a.id), await 归谁(b.id), await 归谁(c.id)]).toEqual([接手.id, 接手.id, 接手.id]);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("转给自己：当场换，不写交接（同批量）", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    当(老板);
    expect(await 编辑(a.id, { salesOwnerId: 老板.id })).toMatchObject({ ok: true });
    expect(await patchCustomer(b.id, "salesOwnerId", 老板.id)).toMatchObject({ ok: true });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([老板.id, 老板.id]);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("客户在市场成员手里、转给销售（P-转-17）：编辑页、就地改都不走确认，当场换，只发分给你通知；看客户负责人，不看谁点的", async () => {
    const 市场 = await 建("mkt", "SALES");
    await prisma.entMember.create({ data: { userId: 市场.id, bizRole: "marketing_mgr" } });
    const a = await 客户(市场.id);
    const b = await 客户(市场.id);
    expect(await 编辑(a.id, { salesOwnerId: 接手.id })).toMatchObject({ ok: true });
    当(市场);
    expect(await patchCustomer(b.id, "salesOwnerId", 接手.id)).toMatchObject({ ok: true });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([接手.id, 接手.id]);
    expect(await prisma.entHandover.count()).toBe(0);
    const 通知 = await prisma.entNotice.findMany({ where: { userId: 接手.id }, orderBy: { createdAt: "asc" } });
    expect(通知.map((n) => n.kind)).toEqual(["分配", "分配"]);
    expect(通知.map((n) => n.title)).toEqual([`${老板.id} 把客户分给你：${a.name}`, `${市场.id} 把客户分给你：${b.name}`]);
  });

  it("豁免只给市场转销售：负责人兼任市场和销售的、市场转给市场的（负责人本人发起）照旧走确认", async () => {
    const 兼任 = await 建("dual", "SALES");
    const 市场乙 = await 建("mkt2", "SALES");
    await prisma.entMember.createMany({ data: [{ userId: 兼任.id, bizRole: "marketing_mgr,sales" }, { userId: 市场乙.id, bizRole: "marketing_mgr" }] });
    const a = await 客户(兼任.id);
    当(兼任);
    expect(await patchCustomer(a.id, "salesOwnerId", 接手.id)).toMatchObject({ ok: true, 交接中: 1 });
    const 市场 = await 建("mkt", "SALES");
    await prisma.entMember.create({ data: { userId: 市场.id, bizRole: "marketing_mgr" } });
    const b = await 客户(市场.id);
    当(市场);
    expect(await patchCustomer(b.id, "salesOwnerId", 市场乙.id)).toMatchObject({ ok: true, 交接中: 1 });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([兼任.id, 市场.id]);
  });

  it("系统管理员编辑页、就地改照旧当场换，一行交接都不写", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    const ra = await 编辑(a.id, { salesOwnerId: 接手.id });
    expect(ra).toMatchObject({ ok: true });
    expect(ra).not.toHaveProperty("交接中");
    expect(await patchCustomer(b.id, "salesOwnerId", 接手.id)).toMatchObject({ ok: true });
    expect([await 归谁(a.id), await 归谁(b.id)]).toEqual([接手.id, 接手.id]);
    expect(await prisma.entHandover.count()).toBe(0);
  });
});

// 规则「交接要接手人确认」11-13 拿掉（企业版办离职原地不动、不读它）：库里还留着这一行开着也不影响
describe("办离职、上级转让都不建交接", () => {
  for (const 情形 of ["企业版", "不是企业版"] as const) {
    it(`${情形}：离职、转让当场转，一行交接都不写`, async () => {
      if (情形 === "企业版") await setSetting("enterprise.rule.handover_confirm", true);
      else vi.stubEnv("CRM_ENTERPRISE", "");
      const a = await 客户(销售.id);
      const b = await 客户(组长.id);

      expect(await deactivateUser(销售.id, 接手.id)).toEqual({ ok: true });
      // 企业版办离职原地不动（11-03 C4-4），不是企业版照旧当场转
      expect(await 归谁(a.id)).toBe(情形 === "企业版" ? 销售.id : 接手.id);
      expect(await assignSalesOwner([b.id], 接手.id)).toMatchObject({ ok: true, updated: 1 });
      expect(await 归谁(b.id)).toBe(接手.id);
      expect(await prisma.entHandover.count()).toBe(0);

      if (情形 === "不是企业版") {
        当(接手);
        expect(await 待确认的交接()).toEqual({ 等我确认: [], 我发起的: [] });
        // 库里有一行（比如企业版时留下的）也不认
        const h = await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 组长.id, toUserId: 接手.id, byUserId: 老板.id, customerIds: "[]", counts: "{}" } });
        expect(await 确认交接(h.id)).toMatchObject({ ok: false });
        expect(await 撤回交接(h.id)).toMatchObject({ ok: false });
      }
    });
  }
});

describe("交接通知（11-03 C3-3 / C3-5 / C4-7 / C8-1）", () => {
  const 通知 = (userId: string, 事件: string, hid: string) => prisma.entNotice.findFirst({ where: { userId, dedupeKey: `handover:${hid}:${事件}` } });
  /**
   * 发起人和原负责人不是同一位的转让交接：P-转-16（11-10）起上级批量转下属的直接转，所以组长把自己名下一位连同下属的一起转，
   * 整批走申请、按原负责人一人一笔；回销售那一笔
   */
  const 组长连下属一起转 = async (ids: string[]) => {
    const 自己的 = await 客户(组长.id);
    当(组长);
    expect(await assignSalesOwner([...ids, 自己的.id], 接手.id)).toMatchObject({ ok: true, 交接中: ids.length + 1 });
    return prisma.entHandover.findFirstOrThrow({ where: { fromUserId: 销售.id } });
  };

  it("P-删-10 确认后的通知按实际转成的个数和客户名写，交接期间换了人的不算", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    const h = await 组长连下属一起转([a.id, b.id]);
    await prisma.customer.update({ where: { id: b.id }, data: { salesOwnerId: 组长.id } });
    当(接手);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
    const 给发起人 = (await 通知(组长.id, "已确认", h.id))?.title ?? "";
    expect(给发起人).toContain("1 位客户");
    expect(给发起人).toContain(a.name);
    expect(给发起人).not.toContain(b.name);
    const 给原负责人 = (await 通知(销售.id, "已确认", h.id))?.title ?? "";
    expect(给原负责人).toContain("1 位客户");
    expect(给原负责人).not.toContain(b.name);
  });

  it("P-删-10 一位都没转成：通知照实说没转", async () => {
    const a = await 客户(销售.id);
    const h = await 组长连下属一起转([a.id]);
    await prisma.customer.update({ where: { id: a.id }, data: { salesOwnerId: 组长.id } });
    当(接手);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 0 });
    const t = (await 通知(组长.id, "已确认", h.id))?.title ?? "";
    expect(t).toContain("没有转");
    expect(t).not.toContain("1 位客户");
    expect(await 通知(销售.id, "已确认", h.id)).toBeNull();
  });

  it("确认后：接手人那条「等你确认」标成已读；发起人和原负责人都收到，标题带客户名", async () => {
    const a = await 客户(销售.id);
    const h = await 组长连下属一起转([a.id]);
    expect((await 通知(接手.id, "发起", h.id))?.readAt).toBeNull();

    当(接手);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
    expect((await 通知(接手.id, "发起", h.id))?.readAt).not.toBeNull();
    expect((await 通知(组长.id, "已确认", h.id))?.title).toContain(a.name);
    const 给原负责人 = await 通知(销售.id, "已确认", h.id);
    expect(给原负责人?.title).toContain(a.name);
    expect(给原负责人?.readAt).toBeNull();
  });

  it("总管理撤回别人发起的：接手人旧通知已读、收到「已撤回」；发起人也收到", async () => {
    const a = await 客户(销售.id);
    当(销售);
    expect(await assignSalesOwner([a.id], 接手.id)).toMatchObject({ ok: true, 交接中: 1 });
    const h = await 一笔();
    // C3-4：发起人转的是自己名下的，横幅据此写「自己名下」
    当(接手);
    expect((await 待确认的交接()).等我确认[0]).toMatchObject({ 自己的: true });

    当(老板);
    expect(await 撤回交接(h.id)).toEqual({ ok: true, 客户: 0 });
    expect((await 通知(接手.id, "发起", h.id))?.readAt).not.toBeNull();
    expect(await 通知(接手.id, "已撤回", h.id)).not.toBeNull();
    expect((await 通知(销售.id, "已撤回", h.id))?.title).toContain("撤回");
  });

  it("离职交接拒收：旧通知已读；停用的原负责人不收", async () => {
    await 客户(销售.id);
    const h = await 老离职交接();
    await prisma.entNotice.create({ data: { userId: 接手.id, kind: "交接", title: "等你确认", dedupeKey: `handover:${h.id}:发起` } });
    当(接手);
    expect(await 拒收交接(h.id)).toEqual({ ok: true, 客户: 0 });
    expect((await 通知(接手.id, "发起", h.id))?.readAt).not.toBeNull();
    expect(await 通知(老板.id, "已拒收", h.id)).not.toBeNull();
    expect(await prisma.entNotice.count({ where: { userId: 销售.id } })).toBe(0);
  });

  it("转给自己当场换：原负责人收到一条，写着客户名", async () => {
    const a = await 客户(销售.id);
    当(组长);
    expect(await assignSalesOwner([a.id], 组长.id)).toMatchObject({ ok: true, updated: 1 });
    const 收到 = await prisma.entNotice.findMany({ where: { userId: 销售.id } });
    expect(收到).toHaveLength(1);
    expect(收到[0].title).toContain(a.name);
    expect(await prisma.entNotice.count({ where: { userId: 组长.id } })).toBe(0);
  });
});

describe("最后一位总管理（11-03 C4-6）：企业版只认业务角色", () => {
  it("唯一的总管理账号是 SALES，也不能停用自己", async () => {
    await prisma.user.update({ where: { id: 老板.id }, data: { role: "SALES" } });
    当({ ...老板, role: "SALES" });
    const r = await deactivateUser(老板.id, 接手.id, "转交");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("最后一位能管设置的总管理");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 老板.id } })).active).toBe(true);
  });

  it("账号 ADMIN 但业务角色是销售，不算最后一位管理员，照常停用", async () => {
    await prisma.user.update({ where: { id: 老板.id }, data: { role: "SALES" } });
    当({ ...老板, role: "SALES" });
    const 号管 = await 建("acct-admin", "ADMIN");
    await prisma.entMember.create({ data: { userId: 号管.id, bizRole: "sales" } });
    expect((await deactivateUser(号管.id, 接手.id, "转交")).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 号管.id } })).active).toBe(false);
  });

  it("另有一位勾了「不管设置」的总管理，不算能管设置，还是拦", async () => {
    const 二 = await 建("boss2", "ADMIN");
    await prisma.entMember.create({ data: { userId: 二.id, bizRole: "director", noSettings: true } });
    const r = await deactivateUser(老板.id, 接手.id, "转交");
    expect(r.ok).toBe(false);
  });
});
