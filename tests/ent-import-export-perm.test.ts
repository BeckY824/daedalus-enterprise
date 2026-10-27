/**
 * 企业版导入导出、新建客户给谁（10-27 会议，lib/enterprise/import-perm.ts）。
 * 钉的是：导入、导出只给老板和总管理员（服务端动作也拦，不只是藏按钮）；
 * 普通销售（不是老板、也没有管理员类别）新建客户负责人只能是自己，传别人也存成自己；编辑照旧；
 * 销售管理能指定别人；企业版导入放给总管理员；不是企业版一律不管。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { 最高管理, 能导入导出, 新建只给自己, 不能导入导出 } from "@/lib/enterprise/import-perm";
import { 预览导入, 执行导入 } from "@/app/(app)/customers/import-actions";
import { 导出客户, 开始完整导出 } from "@/app/(app)/customers/export-action";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { 企业版导入概况 } from "@/app/(app)/settings/enterprise-import-actions";

let 老板: string, 总管: string, 销售经理: string, 市场: string, 销售: string, 另一销售: string, 没角色: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 表头 = ["姓名", "手机"];
const 方案 = (数据: string[][]) => ({ 表头, 数据, 映射: 猜列(表头, 字段表(DEFAULT_BUSINESS)), 重复行: "跳过" as const });
const 新客户 = (name: string, phone: string, salesOwnerId: string, id?: string) => ({
  ...(id ? { id } : {}), name, phone, school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中",
  expectedSignAt: null, remark: null, salesOwnerId, channelId: null, referrerCustomerId: null,
});

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.企业版 = true;
  const 人 = async (email: string, name: string, role = "SALES") => (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
  老板 = await 人("boss", "老板", "ADMIN");
  总管 = await 人("dir", "总管");
  销售经理 = await 人("smgr", "销售经理");
  市场 = await 人("mkt", "市场小李");
  销售 = await 人("s1", "小王");
  另一销售 = await 人("s2", "小张");
  没角色 = await 人("m1", "经理账号", "MANAGER");
  await prisma.entMember.createMany({
    data: [
      { userId: 总管, bizRole: "director" },
      { userId: 销售经理, bizRole: "sales_mgr" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 销售, bizRole: "sales", managerId: 销售经理 },
      { userId: 另一销售, bizRole: "sales", managerId: 销售经理 },
      { userId: 没角色, bizRole: "sales" },
    ],
  });
  当(老板, "ADMIN");
});

describe("谁算什么", () => {
  it("老板、总管理员能导入导出；销售管理、市场管理、销售不能", async () => {
    const 问 = (id: string, role = "SALES") => 能导入导出({ id, role });
    expect(await 问(老板, "ADMIN")).toBe(true);
    expect(await 问(总管)).toBe(true);
    expect(await 最高管理({ id: 总管, role: "SALES" })).toBe(true);
    expect(await 问(销售经理)).toBe(false);
    expect(await 问(市场)).toBe(false);
    expect(await 问(销售)).toBe(false);
  });
  it("新建只给自己：普通销售是（账号角色是经理、业务角色是销售也算）；老板、各类管理员不是", async () => {
    const 问 = (id: string, role = "SALES") => 新建只给自己({ id, role });
    expect(await 问(销售)).toBe(true);
    expect(await 问(没角色, "MANAGER")).toBe(true);
    expect(await 问(老板, "ADMIN")).toBe(false);
    expect(await 问(总管)).toBe(false);
    expect(await 问(销售经理)).toBe(false);
    expect(await 问(市场)).toBe(false);
  });
});

describe("服务端拦（不只是藏按钮）", () => {
  it("销售调预览导入、执行导入、导出客户、开始完整导出都被拒，库里不多客户", async () => {
    当(销售);
    expect(await 预览导入(方案([["甲", "13800000001"]]))).toEqual({ ok: false, error: 不能导入导出 });
    expect(await 执行导入(方案([["甲", "13800000001"]]), "a.xlsx")).toEqual({ ok: false, error: 不能导入导出 });
    expect(await 导出客户({})).toEqual({ ok: false, error: 不能导入导出 });
    await expect(开始完整导出({})).rejects.toThrow(不能导入导出);
    expect(await prisma.customer.count()).toBe(0);
  });
  it("销售经理也被拒", async () => {
    当(销售经理);
    expect(await 预览导入(方案([["甲", "13800000001"]]))).toEqual({ ok: false, error: 不能导入导出 });
    expect(await 导出客户({})).toEqual({ ok: false, error: 不能导入导出 });
  });
  it("老板、总管理员照常导入导出", async () => {
    for (const [id, role, 号] of [[老板, "ADMIN", "13800000001"], [总管, "SALES", "13800000002"]] as const) {
      当(id, role);
      const r = await 执行导入(方案([[`客户${号}`, 号]]), "a.xlsx");
      if (!r.ok) throw new Error(r.error);
      expect(r.新建).toBe(1);
      const 出 = await 导出客户({});
      expect(出.ok).toBe(true);
    }
    expect(await prisma.customer.count()).toBe(2);
  });
  it("企业版导入：总管理员能进，销售经理进不了", async () => {
    当(总管);
    await expect(企业版导入概况()).resolves.toBeTruthy();
    当(销售经理);
    await expect(企业版导入概况()).rejects.toThrow("只有老板和总管理员能做企业版导入");
  });
});

describe("新建客户的负责人", () => {
  it("销售新建时传别人当负责人，存下来是自己", async () => {
    当(销售);
    const r = await saveCustomer(新客户("自拓甲", "13900000001", 另一销售));
    expect(r.ok).toBe(true);
    expect((await prisma.customer.findFirstOrThrow({ where: { name: "自拓甲" } })).salesOwnerId).toBe(销售);
  });
  it("编辑走原来的路：老板分给销售的客户，销售照常能改", async () => {
    const 行 = await prisma.customer.create({ data: { name: "公共乙", phone: "13900000002", salesOwnerId: 销售 } });
    当(销售);
    const base = 新客户("公共乙", "13900000002", 销售);
    const r = await saveCustomer({ ...base, id: 行.id, updatedAt: 行.updatedAt.toISOString(), base, name: "公共乙改名" } as Parameters<typeof saveCustomer>[0]);
    expect(r).toMatchObject({ ok: true });
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: 行.id } });
    expect([后.name, 后.salesOwnerId]).toEqual(["公共乙改名", 销售]);
  });
  it("销售经理、老板新建能指定别人", async () => {
    当(销售经理);
    await saveCustomer(新客户("经理建", "13900000003", 销售));
    当(老板, "ADMIN");
    await saveCustomer(新客户("老板建", "13900000004", 另一销售));
    expect((await prisma.customer.findFirstOrThrow({ where: { name: "经理建" } })).salesOwnerId).toBe(销售);
    expect((await prisma.customer.findFirstOrThrow({ where: { name: "老板建" } })).salesOwnerId).toBe(另一销售);
  });
});

describe("开关关闭", () => {
  beforeEach(() => { mocks.企业版 = false; });
  it("谁都能导入导出，新建负责人照传入的存", async () => {
    当(销售);
    expect(await 能导入导出({ id: 销售, role: "SALES" })).toBe(true);
    expect(await 新建只给自己({ id: 销售, role: "SALES" })).toBe(false);
    const r = await 执行导入(方案([["甲", "13800000009"]]), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect((await 导出客户({})).ok).toBe(true);
    await saveCustomer(新客户("个人版建", "13900000009", 另一销售));
    expect((await prisma.customer.findFirstOrThrow({ where: { name: "个人版建" } })).salesOwnerId).toBe(另一销售);
  });
});
