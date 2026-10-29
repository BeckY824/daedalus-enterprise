/**
 * 企业版软删与回收站（P9，2026-10-29，lib/enterprise/soft-delete*.ts、settings/trash-actions.ts）。
 * 钉的是：删了的从列表 / 详情 / 统计里消失（Prisma 扩展统一滤 + 裸 SQL 各自带条件）；客户连带联系人、项目、沟通记录
 * 同一时刻进回收站、一起回来；单独删的所属客户还在回收站里先不让恢复；30 天到期真删、线索退回；
 * 老板 / 主管 / 管理员能看能恢复，只有老板和总管理员能彻底删除，业务员都不行；查重不算回收站里的；不是企业版照旧真删。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { deleteCustomers, 删除前清点, checkDuplicate } from "@/app/(app)/customers/actions";
import { deleteContact, deleteFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 关键词分页 } from "@/app/(app)/customers/query";
import { 删项目 } from "@/lib/project/db";
import { 看得到的客户数, 看得到的跟进数 } from "@/lib/scope-sql";
import { 全公司查号 } from "@/lib/enterprise/contact-dedupe";
import { 回收站列表, 恢复, 彻底删除, 清过期, 每天清一次, 看已删, 能管回收站, 能彻底删除 } from "@/lib/enterprise/soft-delete";
import { 回收站列表动作, 恢复回收站, 彻底删除回收站 } from "@/app/(app)/settings/trash-actions";

let 老板: string, 总管: string, 销售经理: string, 市场: string, 销售: string, 主管: string;
let 张三: string, 李四: string, 联系人: string, 记录: string, 项目: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 天 = 86_400_000;

beforeEach(async () => {
  await resetDb();
  mocks.企业版 = true;
  const 人 = async (email: string, name: string, role = "SALES") => (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
  老板 = await 人("boss", "老板", "ADMIN");
  总管 = await 人("dir", "总管");
  销售经理 = await 人("smgr", "销售经理");
  市场 = await 人("mkt", "市场小李");
  销售 = await 人("s1", "小王");
  主管 = await 人("m1", "主管账号", "MANAGER");
  await prisma.entMember.createMany({
    data: [
      { userId: 总管, bizRole: "director" },
      { userId: 销售经理, bizRole: "sales_mgr" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 销售, bizRole: "sales", managerId: 销售经理 },
      { userId: 主管, bizRole: "sales" },
    ],
  });
  当(老板, "ADMIN");
  张三 = (await prisma.customer.create({ data: { name: "张三", phone: "13800000001", salesOwnerId: 销售 } })).id;
  李四 = (await prisma.customer.create({ data: { name: "李四", phone: "13800000002", salesOwnerId: 销售 } })).id;
  联系人 = (await prisma.contact.create({ data: { customerId: 张三, name: "张妈妈", phone: "13900000001", email: "z@x.com", isPrimary: true } })).id;
  记录 = (await prisma.followUp.create({ data: { customerId: 张三, ownerId: 销售, type: "CALL", title: "电话", content: "聊了", status: "已完成", occurredAt: new Date(Date.now() - 天) } })).id;
  项目 = (await prisma.project.create({ data: { customerId: 张三, ownerId: 销售, creatorId: 销售, name: "官网改版", phase: "售前", node: "初步接洽" } })).id;
  await prisma.lead.create({ data: { name: "张三线索", phone: "13800000001", ownerId: 销售, customerId: 张三, status: "已转化", convertedAt: new Date() } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("删客户进回收站：列表 / 详情 / 统计里都没了", () => {
  it("客户和名下的联系人、项目、沟通记录同一时刻软删，Prisma 读的都滤掉，行还在库里", async () => {
    expect(await 删除前清点([张三])).toMatchObject({ 进回收站: true, 项目: 1, 联系人: 1, 跟进: 1 });
    expect(await deleteCustomers([张三])).toMatchObject({ ok: true, deleted: 1, 留下联系人: 0 });

    // 列表、详情、统计
    expect((await prisma.customer.findMany({ select: { id: true } })).map((c) => c.id)).toEqual([李四]);
    expect(await prisma.customer.findUnique({ where: { id: 张三 } })).toBeNull();
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.project.findFirst({ where: { id: 项目 } })).toBeNull();
    const 分组 = await prisma.followUp.groupBy({ by: ["ownerId"], _count: { _all: true } });
    expect(分组).toEqual([]);
    // 线索还是线索（客户进回收站，线索页照旧在）
    expect(await prisma.lead.count()).toBe(1);
    // 裸 SQL 那几句（范围计数、关键词列表）
    expect(await 看得到的客户数()).toBe(1);
    expect(await 看得到的跟进数({})).toBe(0);
    expect((await 关键词分页({ keyword: "张三" }, 1, 20))?.total ?? 0).toBe(0);

    // 库里还在，四张表同一个 deletedAt；没有搬进未归属
    const c = await raw.customer.findUniqueOrThrow({ where: { id: 张三 } });
    expect(c.deletedAt).not.toBeNull();
    const t = c.deletedAt!.getTime();
    expect((await raw.contact.findUniqueOrThrow({ where: { id: 联系人 } })).deletedAt?.getTime()).toBe(t);
    expect((await raw.project.findUniqueOrThrow({ where: { id: 项目 } })).deletedAt?.getTime()).toBe(t);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: 记录 } })).deletedAt?.getTime()).toBe(t);
    expect(await raw.unassignedContact.count()).toBe(0);
    // 看已删() 里看得到
    expect(await 看已删(() => prisma.customer.count())).toBe(2);
  });

  it("带出来的关联和 _count 也滤：李四名下单独删的沟通记录不算", async () => {
    const f = await prisma.followUp.create({ data: { customerId: 李四, ownerId: 销售, type: "CALL", title: "", content: "要删的", status: "已完成", occurredAt: new Date() } });
    await prisma.followUp.create({ data: { customerId: 李四, ownerId: 销售, type: "CALL", title: "", content: "留着的", status: "已完成", occurredAt: new Date() } });
    expect((await deleteFollowUp(f.id, 李四)).ok).toBe(true);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: 李四 }, include: { followUps: true, _count: { select: { followUps: true } } } });
    expect(c.followUps.map((x) => x.content)).toEqual(["留着的"]);
    expect(c._count.followUps).toBe(1);
    expect(await prisma.customer.count({ where: { followUps: { some: { content: "要删的" } } } })).toBe(0);
  });
});

describe("回收站列表与恢复", () => {
  it("随客户一起删的不单列，算在客户的连带里；恢复客户一起回来", async () => {
    await deleteCustomers([张三]);
    const 列 = await 回收站列表({ id: 老板, role: "ADMIN" });
    expect(列).toHaveLength(1);
    expect(列[0]).toMatchObject({ 表: "Customer", id: 张三, 名称: "张三", 客户: null, 连带: { 联系人: 1, 项目: 1, 沟通记录: 1 } });
    expect(列[0].剩几天).toBe(30);

    expect(await 恢复({ id: 老板, role: "ADMIN" }, "Customer", 张三)).toMatchObject({ ok: true, 连带: 3 });
    expect(await prisma.customer.count()).toBe(2);
    expect(await prisma.contact.count()).toBe(1);
    expect(await prisma.project.count()).toBe(1);
    expect(await prisma.followUp.count()).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 张三 } })).lastFollowAt).not.toBeNull();
    expect(await 回收站列表({ id: 老板, role: "ADMIN" })).toEqual([]);
  });

  it("早些时候单独删的那条，恢复客户时照旧留在回收站；客户在回收站里时子项不让单独恢复", async () => {
    expect((await deleteContact(联系人)).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await deleteCustomers([张三]);
    const 列 = await 回收站列表({ id: 老板, role: "ADMIN" });
    expect(列.map((r) => r.表).sort()).toEqual(["Contact", "Customer"]);
    expect(列.find((r) => r.表 === "Contact")).toMatchObject({ 名称: "张妈妈", 客户: { id: 张三, 也删了: true } });
    expect(列.find((r) => r.表 === "Customer")?.连带).toEqual({ 联系人: 0, 项目: 1, 沟通记录: 1 });

    const 不让 = await 恢复({ id: 老板, role: "ADMIN" }, "Contact", 联系人);
    expect(不让).toMatchObject({ ok: false });
    expect(!不让.ok && 不让.error).toContain("先恢复客户");

    expect(await 恢复({ id: 老板, role: "ADMIN" }, "Customer", 张三)).toMatchObject({ ok: true, 连带: 2 });
    expect(await prisma.contact.count()).toBe(0);
    expect(await 恢复({ id: 老板, role: "ADMIN" }, "Contact", 联系人)).toMatchObject({ ok: true, 连带: 0 });
    expect(await prisma.contact.count()).toBe(1);
  });

  it("单独删的项目、沟通记录各自进回收站，各自恢复", async () => {
    expect(await 删项目({ id: 老板, role: "ADMIN" }, 项目)).toMatchObject({ ok: true });
    expect((await deleteFollowUp(记录, 张三)).ok).toBe(true);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.followUp.count()).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 张三 } })).lastFollowAt).toBeNull();
    expect(await raw.project.count()).toBe(1);
    const 列 = await 回收站列表({ id: 老板, role: "ADMIN" });
    expect(列.map((r) => r.表).sort()).toEqual(["FollowUp", "Project"]);

    expect(await 恢复({ id: 老板, role: "ADMIN" }, "Project", 项目)).toMatchObject({ ok: true });
    expect(await 恢复({ id: 老板, role: "ADMIN" }, "FollowUp", 记录)).toMatchObject({ ok: true });
    expect(await prisma.project.count()).toBe(1);
    expect(await prisma.followUp.count()).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 张三 } })).lastFollowAt).not.toBeNull();
  });

  it("回收站里的行改不到（update / updateMany 只碰没删的）", async () => {
    await deleteCustomers([张三]);
    expect((await prisma.customer.updateMany({ where: { id: 张三 }, data: { name: "改了" } })).count).toBe(0);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: 张三 } })).name).toBe("张三");
  });
});

describe("30 天到期清理", () => {
  it("满 30 天的真删：客户连同名下的没了，线索退回跟进中；没满的留着", async () => {
    await deleteCustomers([张三]);
    expect((await deleteFollowUp((await prisma.followUp.create({ data: { customerId: 李四, ownerId: 销售, type: "CALL", title: "", content: "x", status: "已完成", occurredAt: new Date() } })).id, 李四)).ok).toBe(true);

    expect(await 清过期(new Date(Date.now() + 29 * 天))).toEqual({ FollowUp: 0, Contact: 0, Project: 0, Customer: 0 });
    expect(await 看已删(() => prisma.customer.count())).toBe(2);

    const r = await 清过期(new Date(Date.now() + 31 * 天));
    expect(r).toMatchObject({ Customer: 1, FollowUp: 2, Contact: 1, Project: 1 });
    expect(await raw.customer.count()).toBe(1);
    expect(await raw.contact.count()).toBe(0);
    expect(await raw.project.count()).toBe(0);
    expect(await raw.followUp.count()).toBe(0);
    expect(await raw.lead.findFirstOrThrow()).toMatchObject({ customerId: null, status: "跟进中", convertedAt: null });
  });

  it("每天清一次：同一天只清一遍，第二天再清", async () => {
    await deleteCustomers([张三]);
    const 后 = new Date(Date.now() + 40 * 天);
    expect(await 每天清一次(后)).toMatchObject({ Customer: 1 });
    await prisma.followUp.update({ where: { id: (await prisma.followUp.create({ data: { customerId: 李四, ownerId: 销售, type: "CALL", title: "", content: "y", status: "已完成", occurredAt: new Date() } })).id }, data: { deletedAt: new Date(Date.now() - 31 * 天) } });
    expect(await 每天清一次(后)).toBeNull();
    expect(await raw.followUp.count()).toBe(1);
    expect(await 每天清一次(new Date(后.getTime() + 天))).toMatchObject({ FollowUp: 1 });
    expect(await raw.followUp.count()).toBe(0);
  });
});

describe("谁能看、恢复、彻底删除", () => {
  it("能看能恢复：老板、主管、销售管理、市场管理、总管理员；业务员不行。彻底删除只有老板和总管理员", async () => {
    const 看 = async (id: string, role = "SALES") => [await 能管回收站({ id, role }), await 能彻底删除({ id, role })];
    expect(await 看(老板, "ADMIN")).toEqual([true, true]);
    expect(await 看(总管)).toEqual([true, true]);
    expect(await 看(主管, "MANAGER")).toEqual([true, false]);
    expect(await 看(销售经理)).toEqual([true, false]);
    expect(await 看(市场)).toEqual([true, false]);
    expect(await 看(销售)).toEqual([false, false]);
  });

  it("服务端动作也拦：业务员看不了、恢复不了；销售管理能恢复但不能彻底删除；总管理员能彻底删除", async () => {
    await deleteCustomers([张三]);
    当(销售);
    expect(await 回收站列表动作()).toEqual({ ok: false, error: "只有老板和管理员能看回收站" });
    expect(await 恢复回收站("Customer", 张三)).toEqual({ ok: false, error: "只有老板和管理员能恢复" });
    expect(await 彻底删除回收站("Customer", 张三)).toEqual({ ok: false, error: "只有老板和总管理员能彻底删除" });

    当(主管, "MANAGER");
    expect(await 彻底删除回收站("Customer", 张三)).toEqual({ ok: false, error: "只有老板和总管理员能彻底删除" });
    当(销售经理);
    const 列 = await 回收站列表动作();
    expect(列).toMatchObject({ ok: true, 能彻底删除: false });
    expect(await 彻底删除回收站("Customer", 张三)).toEqual({ ok: false, error: "只有老板和总管理员能彻底删除" });
    expect(await raw.customer.count()).toBe(2);
    expect(await 恢复回收站("Customer", 张三)).toMatchObject({ ok: true, 连带: 3 });
    expect(await prisma.auditLog.count({ where: { action: "restore", entityId: 张三 } })).toBe(1);

    await deleteCustomers([张三]);
    当(总管);
    expect(await 回收站列表动作()).toMatchObject({ ok: true, 能彻底删除: true });
    expect(await 彻底删除回收站("Customer", 张三)).toEqual({ ok: true });
    expect(await raw.customer.count()).toBe(1);
    expect(await raw.contact.count()).toBe(0);
    expect(await raw.lead.findFirstOrThrow()).toMatchObject({ customerId: null, status: "跟进中" });
    expect(await prisma.auditLog.count({ where: { action: "purge", entityId: 张三 } })).toBe(1);
  });

  it("不在回收站里的不能彻底删除（拿 id 绕不过去）", async () => {
    expect(await 彻底删除({ id: 老板, role: "ADMIN" }, "Customer", 李四)).toMatchObject({ ok: false });
    expect(await raw.customer.count()).toBe(2);
  });
});

describe("查重不算回收站里的", () => {
  it("同号 checkDuplicate、全公司查号：删了的客户、联系人的号能再录", async () => {
    expect(await checkDuplicate("13800000001")).toMatchObject({ name: "张三" });
    expect(await 全公司查号(prisma, "手机号", "13900000001", "13900000001")).toEqual([张三]);
    await deleteCustomers([张三]);
    expect(await checkDuplicate("13800000001")).toBeNull();
    expect(await 全公司查号(prisma, "手机号", "13800000001", "13800000001")).toEqual([]);
    expect(await 全公司查号(prisma, "手机号", "13900000001", "13900000001")).toEqual([]);
    expect(await 全公司查号(prisma, "邮箱", "z@x.com", "z@x.com")).toEqual([]);
    // 没删的照旧查得到
    expect(await checkDuplicate("13800000002")).toMatchObject({ name: "李四" });
  });
});

describe("不是企业版：照旧真删", () => {
  it("deleteCustomers 真删、联系人进未归属，清点不说回收站", async () => {
    mocks.企业版 = false;
    expect(await 删除前清点([李四])).toMatchObject({ 进回收站: false, 项目: 0 });
    expect(await deleteCustomers([李四])).toMatchObject({ ok: true, deleted: 1 });
    expect(await raw.customer.count()).toBe(1);
    expect(await 回收站列表动作()).toMatchObject({ ok: false });
    expect(await 能管回收站({ id: 老板, role: "ADMIN" })).toBe(false);
  });
});
