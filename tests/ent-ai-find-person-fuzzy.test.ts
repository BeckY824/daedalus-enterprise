/**
 * 批次 20a：find_person 查号码、查名字要能命中（报告：120 次里 77 次零结果；查重类提问一半落到「无法据此区分」）。
 *
 * 钉的是：
 * - 号码：去空格、横杠、+86 / 0086 前缀后比，库里存的带格式也认；只给一段（后几位）也命中；
 * - 号码跨联系人：联系人电话、联系人号码子表（ContactMethod）里的号都比，回来带所属客户 id；
 * - 名字模糊：原样找不到时去掉称呼（王总 → 王 开头）、公司后缀（有限公司）再找，标「模糊」；
 * - 可见范围照旧：同事负责的客户 / 联系人，业务员按号码、按名字都找不到；
 * - 电话字段权限照旧：电话「藏」的人不按号码比；
 * - 搜空时的话写明查过什么、下一步怎么确认，口径仍是「当前可访问范围内」；
 * - 只发一个号码的提问直接走 find_person。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 名字变体, 像号码, 没找到话 } from "@/lib/agent/find-name";
import { 认意图 } from "@/lib/agent/intents";
import { 字段权限key } from "@/lib/enterprise/field-perm";

type 人 = { id: string; name: string };
let 经理: 人, 乙: 人, 丙: 人;

async function 造人(email: string, name: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
}
const 跑 = (args: Record<string, unknown>, me: 人) =>
  以谁的身份(me.id, () =>
    TOOLS.find((t) => t.name === "find_person")!.run(args, { userId: me.id, userName: me.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never),
  );
const 串 = (r: { data?: unknown }) => JSON.stringify(r.data);
const 找到 = (r: { data?: unknown }) => (r.data as { 找到?: number }).找到;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  经理 = await 造人("mgr", "经理");
  乙 = await 造人("yi", "乙");
  丙 = await 造人("bing", "丙");
  await prisma.entMember.createMany({
    data: [
      { userId: 经理.id, bizRole: "sales_mgr" },
      { userId: 乙.id, bizRole: "sales", managerId: 经理.id },
      { userId: 丙.id, bizRole: "sales", managerId: 经理.id },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();

  // 乙的客户：电话按老写法带空格存着；名下一位联系人，电话带 +86 和横杠；另一个号只在号码子表里
  const 甲公司 = await prisma.customer.create({ data: { name: "杭州甲乙机械有限公司", phone: "138 0013 8000", salesOwnerId: 乙.id } });
  const 王 = await prisma.contact.create({ data: { customerId: 甲公司.id, name: "王建国", phone: "+86-139-1234-5678" } });
  await prisma.contactMethod.create({ data: { customerId: 甲公司.id, contactId: 王.id, kind: "phone", value: "13711112222", numberKey: "13711112222" } });
  // 丙的客户：乙看不到
  const 丙的 = await prisma.customer.create({ data: { name: "宁波丙丁贸易", phone: "13600006666", salesOwnerId: 丙.id } });
  await prisma.contact.create({ data: { customerId: 丙的.id, name: "王秀英", phone: "13655557777" } });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("按号码找（20a）", () => {
  it("带 +86、空格、横杠的号码，和库里带格式存的号对得上", async () => {
    const r = await 跑({ name: "+86 138-0013-8000" }, 乙);
    expect(找到(r)).toBeGreaterThan(0);
    expect(串(r)).toContain("杭州甲乙机械有限公司");
    expect((r.data as { 按号码?: string }).按号码).toBe("13800138000");
  });

  it("只给后几位也命中", async () => {
    const r = await 跑({ name: "8000" }, 乙);
    expect(串(r)).toContain("杭州甲乙机械有限公司");
  });

  it("跨联系人：联系人电话、联系人号码子表里的号都比，回来带所属客户 id", async () => {
    const 一 = await 跑({ name: "13912345678" }, 乙);
    const 联系人 = (一.data as { 结果: { 表: string; 记录: Record<string, unknown>[] }[] }).结果.find((h) => h.表 === "联系人");
    expect(联系人?.记录[0]).toMatchObject({ 姓名: "王建国", 属于: "杭州甲乙机械有限公司" });
    expect(typeof 联系人?.记录[0].客户id).toBe("string");
    // 客户那一张也按联系人的号找到了这一家
    expect((一.data as { 结果: { 表: string }[] }).结果.some((h) => h.表 === "客户")).toBe(true);

    const 二 = await 跑({ name: "137 1111 2222" }, 乙);
    expect(串(二)).toContain("王建国");
  });

  it("看不到的照样找不到：丙的客户和联系人，乙按号码找不到", async () => {
    const r = await 跑({ name: "13655557777" }, 乙);
    expect(找到(r)).toBe(0);
    expect(串(r)).not.toContain("王秀英");
    expect(串(r)).toContain("当前可访问范围内未找到");
    expect(串(r)).toContain("新建线索时系统会做全公司查重");
    // 丙自己找得到
    expect(串(await 跑({ name: "13655557777" }, 丙))).toContain("王秀英");
  });

  it("电话字段藏着的人不按号码比，也不报「没找到」", async () => {
    await setSetting(规则.字段权限.key, true);
    await setSetting(字段权限key, { 电话: { sales: "藏" } });
    invalidateSettingsCache();
    忘掉企业版范围();
    const r = await 跑({ name: "13800138000" }, 乙);
    expect(串(r)).not.toContain("杭州甲乙机械");
    expect(串(r)).toContain("电话是隐藏的");
    expect(找到(r)).toBeUndefined();
  });
});

describe("按名字模糊找（20a）", () => {
  it("原样就有的不走模糊", async () => {
    const r = await 跑({ name: "王建国" }, 乙);
    expect(串(r)).toContain("王建国");
    expect((r.data as { 模糊?: string }).模糊).toBeUndefined();
  });

  it("「王总」原样找不到 → 按「王」开头找到，标模糊、让用户认", async () => {
    const r = await 跑({ name: "王总" }, 乙);
    expect(串(r)).toContain("王建国");
    expect((r.data as { 模糊?: string }).模糊).toContain("不一定是同一个人");
    // 模糊也守可见范围
    expect(串(r)).not.toContain("王秀英");
  });

  it("公司名带不带「有限公司」都能找到", async () => {
    const r = await 跑({ name: "杭州甲乙机械股份有限公司" }, 乙);
    expect(串(r)).toContain("杭州甲乙机械有限公司");
  });

  it("名字变体：空格、称呼、公司后缀；一个字的姓只按开头", () => {
    expect(名字变体("王 建国").map((v) => v.词)).toContain("王建国");
    expect(名字变体("李老师")).toContainEqual({ 词: "李", 开头: true });
    expect(名字变体("老王")).toContainEqual({ 词: "王", 开头: true });
    expect(名字变体("陈建华经理")).toContainEqual({ 词: "陈建华", 开头: false });
    expect(名字变体("Acme Co., Ltd.").map((v) => v.词)).toContain("Acme");
    expect(名字变体("某某科技有限公司").map((v) => v.词)).toContain("某某科技");
  });

  it("像号码：至少 4 位数字，去掉 +86", () => {
    expect(像号码("+86 138 0013 8000")).toBe("13800138000");
    expect(像号码("0086-13800138000")).toBe("13800138000");
    expect(像号码("123")).toBeNull();
    expect(像号码("王总")).toBeNull();
  });

  it("搜空的话：写明查过哪些，口径是「当前可访问范围内」", () => {
    const s = 没找到话("「某某」", false);
    expect(s).toContain("当前可访问范围内未找到");
    expect(s).toContain("去掉称呼");
    expect(s).not.toContain("不存在。");
  });
});

describe("只发号码的提问直接走 find_person（20a）", () => {
  it.each(["13800138000", "+86 138-0013-8000", "13800138000 查重", "查一下 13800138000", "13800138000是谁的？"])("%s", (q) => {
    expect(认意图(q)).toMatchObject({ 调用: [{ name: "find_person" }] });
  });
  it("短数字、写入请求不算", () => {
    expect(认意图("2026")).toBeNull();
    expect(认意图("给13800138000记一笔跟进")).toBeNull();
  });
});
