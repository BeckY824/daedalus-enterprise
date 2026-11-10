/**
 * 企业版导入查重把回收站里的号码算进去（P-删-08 续，2026-11-05）。
 * 导入认人照旧（手机号；企业版锁通用模版，外贸那套按邮箱 / 微信 / 阿里 ID 认的在企业版里走不到，代码一并照顾），在用的认不到、回收站里认到了：
 * 这一行不新建、不补空、不改回收站里那位，预览和结果里单独标出「号码在回收站」，让人去新建客户查重时捞回。
 * 在用的和回收站里同号：照旧按在用的那位走。撤销整批不受影响（回收站那几行没写导入记录）。
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

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { getBusiness } from "@/lib/business";
import { deleteCustomers } from "@/app/(app)/customers/actions";
import { 预览导入, 执行导入, 分段导入, 撤销批次 } from "@/app/(app)/customers/import-actions";
import { 看已删 } from "@/lib/enterprise/soft-delete";
import { 字段表, 猜列 } from "@/lib/import/fields";

let 老板: string, 张三: string, 李四: string;
const 表头 = ["姓名", "手机号", "备注"];
const 方案 = async (数据: string[][], 重复行: "跳过" | "补空" = "补空") => ({ 表头, 数据, 映射: 猜列(表头, 字段表(await getBusiness())), 重复行 });
const 连回收站 = <T,>(f: () => Promise<T>) => 看已删(f);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.企业版 = true;
  老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 老板, bizRole: "director" } });
  mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
  张三 = (await prisma.customer.create({ data: { name: "张三", phone: "13800000001", salesOwnerId: 老板 } })).id;
  李四 = (await prisma.customer.create({ data: { name: "李四", phone: "13800000002", salesOwnerId: 老板 } })).id;
  expect(await deleteCustomers([张三])).toMatchObject({ ok: true, deleted: 1 });
});

afterAll(async () => { await prisma.$disconnect(); });

const 三行 = [
  ["张三新写法", "13800000001", "表里的备注"], // 第 2 行：号码在回收站
  ["李四", "13800000002", "补一格备注"], // 第 3 行：在用的，撞上已有客户跳过（M-导入-29 起企业版不补空）
  ["王五", "13800000009", ""], // 第 4 行：新建
];

describe("导入撞上回收站里的号码", () => {
  it("预览：单独数出来、标行号，算进跳过，不算新建", async () => {
    const r = await 预览导入(await 方案(三行));
    if (!r.ok) throw new Error(r.error);
    expect(r.预览).toMatchObject({ 新建: 1, 已在库里: 1, 补空: 0, 回收站里: 1, 回收站行号: [2], 跳过: 2 });
  });

  it("执行：不新建、不补空、回收站里那位一个字不动；结果里报出几条；撤销整批照旧", async () => {
    const r = await 执行导入(await 方案(三行), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 1, 补空: 0, 跳过: 2, 回收站里: 1 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 李四 } })).remark).toBeNull();
    // 在用的只有李四、王五；回收站里还是那一位张三
    expect((await prisma.customer.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((c) => c.name).sort()).toEqual(["李四", "王五"].sort());
    const 回收站里的 = await 连回收站(() => prisma.customer.findMany({ where: { phone: "13800000001" } }));
    expect(回收站里的).toHaveLength(1);
    expect(回收站里的[0]).toMatchObject({ id: 张三, name: "张三", remark: null });
    expect(回收站里的[0].deletedAt).not.toBeNull();
    expect(await prisma.importRow.count({ where: { customerId: 张三 } })).toBe(0);

    const 撤 = await 撤销批次(r.batchId);
    expect(撤).toMatchObject({ ok: true });
    expect((await prisma.customer.findMany({ select: { id: true } })).map((c) => c.id)).toEqual([李四]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 李四 } })).remark).toBeNull();
    const 还在回收站 = await 连回收站(() => prisma.customer.findUniqueOrThrow({ where: { id: 张三 } }));
    expect(还在回收站.deletedAt).not.toBeNull();
  });

  it("分段导入一样报出回收站里几条", async () => {
    const r = await 分段导入(await 方案(三行), "a.xlsx", { 起: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 1, 回收站里: 1 });
    expect(await prisma.customer.count()).toBe(2);
  });

  it("在用的和回收站里同号：照旧按在用的那位算（撞上已有、跳过），不算回收站", async () => {
    await prisma.customer.create({ data: { name: "张三另一位", phone: "13800000001", salesOwnerId: 老板 } });
    const 看 = await 预览导入(await 方案([三行[0]]));
    if (!看.ok) throw new Error(看.error);
    expect(看.预览).toMatchObject({ 新建: 0, 已在库里: 1, 回收站里: 0, 回收站行号: [] });
    const r = await 执行导入(await 方案([三行[0]]), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 0, 补空: 0, 跳过: 1, 回收站里: 0 });
    expect((await 连回收站(() => prisma.customer.findUniqueOrThrow({ where: { id: 张三 } }))).remark).toBeNull();
  });

  it("号码换个写法（+86、空格、横杠）也认得出在回收站", async () => {
    const 换写法 = [["张三", "+86 138-0000-0001", ""]];
    const 看 = await 预览导入(await 方案(换写法));
    if (!看.ok) throw new Error(看.error);
    expect(看.预览).toMatchObject({ 新建: 0, 回收站里: 1, 回收站行号: [2] });
    const r = await 执行导入(await 方案(换写法), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 0, 回收站里: 1 });
    expect(await prisma.customer.count({ where: { name: "张三" } })).toBe(0);
  });
});
