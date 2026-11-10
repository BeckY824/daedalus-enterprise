/**
 * M-导入-29：客户页旧导入抽屉（customers/import-actions.ts）企业版查重同归档导入（#207 clean.ts 的 撞已有客户）。
 * 电话 / WhatsApp / 座机任一（含联系人与联系方式子表）或客户名称撞上已有客户 → 整条跳过、报告写明撞的号或名；
 * 号码忽略 +86 / 0086、空格、横杠，不到 10 位不比；名称忽略空白、全半角、大小写。取代原来的「同号补空」
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ user: null as null | { id: string; name: string; role: string; email: string } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, currentUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { resetDb } from "./reset";
import { prisma } from "@/lib/prisma";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 预览导入, 执行导入, 分段导入, 暂存导入表, type 导入方案 } from "@/app/(app)/customers/import-actions";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { getBusiness } from "@/lib/business";
import { 清空暂存 } from "@/lib/import/staging";

const 表头 = ["客户名称", "手机号", "WhatsApp", "座机", "备注"];
const 方案 = async (数据: string[][], 重复行: 导入方案["重复行"] = "跳过"): Promise<导入方案> => ({ 表头, 数据, 映射: 猜列(表头, 字段表(await getBusiness())), 重复行 });

async function 总管() {
  const u = await prisma.user.create({ data: { id: "boss1", email: "boss1@x.test", name: "总管", title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: "director" } });
  mocks.user = { id: u.id, name: u.name, email: u.email, role: "SALES" };
  return u;
}

/** 库里已有：甲（电话）、乙（英文名 + 客户 WhatsApp + 联系人手机 + 子表座机）、丙（不到 10 位的号） */
async function 已有(负责人: string) {
  const 甲 = await prisma.customer.create({ data: { name: "编的客户甲", phone: "13800138000", salesOwnerId: 负责人 } });
  const 乙 = await prisma.customer.create({ data: { name: "Acme Trading", phone: "13900000001", salesOwnerId: 负责人 } });
  await prisma.customerExtra.create({ data: { customerId: 乙.id, whatsapp: "+8613911112222" } });
  await prisma.contact.create({ data: { customerId: 乙.id, name: "编的联系人", phone: "13700000002" } });
  await prisma.contactMethod.create({ data: { customerId: 乙.id, kind: "landline", value: "02188886666", numberKey: "02188886666" } });
  const 丙 = await prisma.customer.create({ data: { name: "编的客户丙", phone: "13900000009", salesOwnerId: 负责人 } });
  await prisma.contactMethod.create({ data: { customerId: 丙.id, kind: "landline", value: "12345", numberKey: "12345" } });
  return { 甲, 乙, 丙 };
}

const 表 = [
  ["新客户一", "+86 137-0000-0002", "", "", ""], // 撞乙的联系人手机
  ["新客户二", "13600000003", "0086 139 1111 2222", "", ""], // 撞乙的 WhatsApp
  ["新客户三", "13600000004", "", "021-8888 6666", ""], // 撞乙子表里的座机
  ["ＡＣＭＥ　 trading", "13600000005", "", "", ""], // 名称全角 + 大小写 + 空白，撞乙
  ["新客户六", "13600000006", "", "12345", ""], // 座机不到 10 位，不比
  ["编的客户甲（新）", "13800138000", "", "", "补一句"], // 电话撞甲，企业版不补空
  ["全新客户", "13600000007", "", "", ""],
];

beforeEach(async () => {
  await resetDb();
  清空暂存();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true } as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.IMPORT_SEGMENT_MS;
});

describe("M-导入-29 旧导入抽屉查重（企业版）", () => {
  it("预览：号 / WhatsApp / 座机 / 联系人 / 子表 / 名称撞上的算跳过，写明撞的号或名；没有补空这一项", async () => {
    const 我 = await 总管();
    await 已有(我.id);
    const r = await 预览导入(await 方案(表, "补空"));
    if (!r.ok) throw new Error(r.error);
    expect(r.预览).toMatchObject({ 新建: 2, 补空: 0, 跳过: 5, 只跳过: true });
    const 原因 = Object.fromEntries((r.预览.撞已有 ?? []).map((x) => [x.行号, x.原因]));
    expect(原因[2]).toMatch(/号码 .*137.*0000.*0002/);
    expect(原因[3]).toContain("0086 139 1111 2222");
    expect(原因[4]).toContain("021-8888 6666");
    expect(原因[5]).toContain("ＡＣＭＥ");
    expect(原因[7]).toContain("13800138000");
    expect(原因[6]).toBeUndefined();
    expect(原因[8]).toBeUndefined();
  });

  it("执行：撞上的整条跳过（选了补空也不补），结果写明撞的号或名；不到 10 位的号不算撞", async () => {
    const 我 = await 总管();
    const { 甲 } = await 已有(我.id);
    const r = await 执行导入(await 方案(表, "补空"), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 2, 补空: 0, 跳过: 5 });
    expect((await prisma.customer.findMany({ where: { name: { in: ["新客户六", "全新客户"] } } })).length).toBe(2);
    expect(await prisma.customer.count()).toBe(5);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 甲.id } })).remark).toBeNull();
    const 原因 = (r.撞已有 ?? []).map((x) => `${x.行号}:${x.原因}`);
    expect(原因).toHaveLength(5);
    expect(原因.find((x) => x.startsWith("5:"))).toContain("ＡＣＭＥ");
    expect(原因.find((x) => x.startsWith("4:"))).toContain("021-8888 6666");
  });

  it("分段导入：前几趟本批建的不算「已有」；同名的一样跳过，每趟回话带撞的原因", async () => {
    const 我 = await 总管();
    await 已有(我.id);
    process.env.IMPORT_SEGMENT_MS = "1";
    const 数据 = Array.from({ length: 450 }, (_, i) => [`批内客户${i}`, `136${String(i).padStart(8, "0")}`, "", "", ""]);
    数据[300] = ["acme trading", "13512345678", "", "", ""];
    const 号 = "dedup-001";
    expect(await 暂存导入表(号, { 起: 0, 数据 }, { 表头, 共: 数据.length })).toMatchObject({ ok: true });
    const p = { ...(await 方案([])), 暂存: 号 };
    let 续: { batchId?: string; 起: number } = { 起: 0 };
    const 撞 = [];
    for (;;) {
      const r = await 分段导入(p, "大表.csv", 续);
      if (!r.ok) throw new Error(r.error);
      撞.push(...(r.撞已有 ?? []));
      if (r.下一个 === null) {
        expect(r).toMatchObject({ 新建: 449, 跳过: 1 });
        break;
      }
      续 = { batchId: r.batchId, 起: r.下一个 };
    }
    expect(撞).toEqual([{ 行号: 302, 原因: expect.stringContaining("acme trading") }]);
  });

  it("电话那格也守 10 位门槛：不到 10 位的号整串相同也不算撞，照建", async () => {
    const 我 = await 总管();
    const 短 = await prisma.customer.create({ data: { name: "编的短号客户", phone: "88886666", salesOwnerId: 我.id } });
    const 看 = await 预览导入(await 方案([["编的另一家", "8888-6666", "", "", "新备注"]], "补空"));
    if (!看.ok) throw new Error(看.error);
    expect(看.预览).toMatchObject({ 新建: 1, 跳过: 0, 已在库里: 0 });
    const r = await 执行导入(await 方案([["编的另一家", "8888-6666", "", "", "新备注"]], "补空"), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 1, 跳过: 0 });
    expect(r.撞已有).toEqual([]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 短.id } })).remark).toBeNull();
    expect(await prisma.customer.count({ where: { name: "编的另一家" } })).toBe(1);
  });

  it("电话撞上有人在跟的客户：整条跳过，不给已有客户的项目记同号备注、不写导入记录", async () => {
    const 我 = await 总管();
    const { 甲 } = await 已有(我.id);
    await prisma.project.create({ data: { name: "编的项目", customerId: 甲.id, ownerId: 我.id, creatorId: 我.id, phase: "线索", node: "潜客培育" } });
    const r = await 执行导入(await 方案([["编的客户甲（新）", "13800138000", "", "", "补一句"]], "补空"), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 0, 补空: 0, 跳过: 1 });
    expect(r.撞已有?.[0]?.原因).toContain("13800138000");
    expect(await prisma.followUp.count({ where: { customerId: 甲.id } })).toBe(0);
    expect(await prisma.importRow.count({ where: { customerId: 甲.id } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 甲.id } })).remark).toBeNull();
  });

  it("同一份表里同号的行照 #207 并一条：后一行的名字记又名、座机 / WhatsApp 不丢；先撞已有客户的那行单独跳过；同名不同号照写两条", async () => {
    const 我 = await 总管();
    await 已有(我.id);
    const r = await 执行导入(
      await 方案([
        ["编的同号客户", "13611112222", "", "", "第一行"],
        ["编的同号客户分号", "136-1111-2222", "+44 7700 900123", "010-6555 7777", "第二行"],
        ["Acme  TRADING", "13611112222", "+44 7700 900999", "", "第三行"],
        ["编的同名客户", "13622223333", "", "", ""],
        ["编的同名客户", "13622224444", "", "", ""],
      ]),
      "a.xlsx",
    );
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 3, 跳过: 1 });
    expect(r.撞已有).toEqual([{ 行号: 4, 原因: expect.stringContaining("Acme  TRADING") }]);
    const 并 = await prisma.customer.findFirstOrThrow({ where: { name: "编的同号客户" }, include: { extra: true } });
    const 全 = `${并.remark ?? ""}\n${并.extra?.whatsapp ?? ""}`;
    expect(并.remark).toContain("又名：编的同号客户分号");
    expect(并.remark).toContain("第二行");
    expect(全).toContain("7700 900123");
    expect(全).toContain("010-6555 7777");
    // 第三行撞了已有客户，整条不导，它的号和备注不并进来
    expect(全).not.toContain("900999");
    expect(并.remark).not.toContain("第三行");
    expect(await prisma.customer.count({ where: { name: "编的同名客户" } })).toBe(2);
  });

  it("同一份表里名字很像、号不同：预览出「疑似重名」提醒（同 #207），照写两条", async () => {
    const 我 = await 总管();
    await 已有(我.id);
    const 数据 = [
      ["编的像名贸易有限公司", "13622223333", "", "", ""],
      ["全新客户", "13600000007", "", "", ""],
      ["编的像名贸易（上海）有限公司", "13622224444", "", "", ""],
      ["编的同名客户", "13633330001", "", "", ""],
      ["编的同名客户", "13633330002", "", "", ""],
    ];
    const 看 = await 预览导入(await 方案(数据));
    if (!看.ok) throw new Error(看.error);
    expect(看.预览.新建).toBe(5);
    expect(看.预览.疑似重名).toEqual([
      { 行号: 4, 像行号: 2, 原因: "和「编的像名贸易有限公司」名字很像、电话不同，照写两条，请人看一眼" },
      { 行号: 6, 像行号: 5, 原因: expect.stringContaining("名字很像、电话不同") },
    ]);
    const r = await 执行导入(await 方案(数据), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ 新建: 5, 跳过: 0 });
    expect(await prisma.customer.count({ where: { name: "编的同名客户" } })).toBe(2);
  });

  it("不是企业版：不出「疑似重名」", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    await 总管();
    mocks.user = { ...mocks.user!, role: "ADMIN" };
    const 看 = await 预览导入(await 方案([["编的同名客户", "13633330001", "", "", ""], ["编的同名客户", "13633330002", "", "", ""]]));
    if (!看.ok) throw new Error(看.error);
    expect(看.预览.疑似重名).toBeUndefined();
  });

  it("不是企业版：照旧同号补空，不按名称 / WhatsApp 查重", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const 我 = await 总管();
    mocks.user = { ...mocks.user!, role: "ADMIN" };
    const { 甲 } = await 已有(我.id);
    const r = await 执行导入(await 方案(表, "补空"), "a.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r.撞已有).toBeUndefined();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 甲.id } })).remark).toBe("补一句");
    expect(r.新建).toBe(6);
  });
});
