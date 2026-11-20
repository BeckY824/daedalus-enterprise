/**
 * 企业版建档的全公司号码查重（lib/enterprise/contact-dedupe.ts + customers/number-actions.ts 查号码 +
 * saveCustomer 的 企业号码，测试清单 B5 / B8）：不分谁名下、客户上和联系人上都比；撞到好几条认首条（建档最早）；
 * 旺旺 ID 记进联系方式子表 ContactMethod、换个大小写空格也撞；回收站里的号也拦（客户 11-05（X-10））。开关关着：没有号码类型、保存不认 企业号码、查重照旧
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { saveCustomer, checkDuplicate, saveCustomerNumbers, type CustomerInput } from "@/app/(app)/customers/actions";
import { 查号码, 从回收站捞回 } from "@/app/(app)/customers/number-actions";
import { 全公司查号, 撞号结论, 回收站里有提示, 联系人查重, 联系人回收站撞, 一行号全公司查, 一行号回收站查, 跨类键, 跨类SQL } from "@/lib/enterprise/contact-dedupe";
import { 号键索引名, 号键SQL } from "@/lib/phone-dedupe";
import fs from "node:fs";
import path from "node:path";
import { 档案格索引名 } from "@/lib/email-dedupe";
import { AI建档查重, AI建档查重详 } from "@/lib/enterprise/ai-lead-dedupe";
import { 查重提示 } from "@/lib/enterprise/contact-format";
import { invalidateSettingsCache } from "@/lib/settings";

let 甲: string;
let 乙: string;

const 客户 = (补: Partial<CustomerInput> = {}): CustomerInput => ({
  name: "新客户", phone: "", school: null, grade: null, major: null,
  followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
  salesOwnerId: 甲, channelId: null, referrerCustomerId: null,
  // 客户业务线必填（M-必填-13）：没另给按内贸
  企业资料: { bizLine: "内贸" }, ...补,
});
const 建 = (name: string, salesOwnerId: string, 补: Record<string, unknown> = {}) =>
  prisma.customer.create({ data: { name, phone: "", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId, ...补 } });
const 当 = (id: string) => { mocks.user = { ...mocks.user, id }; };

afterEach(() => { vi.unstubAllEnvs(); });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 甲, bizRole: "director" }, { userId: 乙, bizRole: "sales" }] });
  当(甲);
});

describe("企业版开着", () => {
  beforeEach(() => { vi.stubEnv("CRM_ENTERPRISE", "1"); });

  it("首次录入：全公司都没有", async () => {
    expect(await 查号码("手机号", "+86 139 0000 0101")).toMatchObject({ ok: true, 状态: "首次录入", 提示: 查重提示.首次录入, 值: "13900000101" });
  });

  it("格式不对当场说，不去查", async () => {
    expect(await 查号码("手机号", "1390000")).toMatchObject({ ok: false, 状态: "格式错误", 提示: "⚠️手机号格式错误" });
    expect(await 查号码("旺旺ID", "***")).toMatchObject({ ok: false, 状态: "无法识别" });
    expect(await 查号码("", "13900000101")).toMatchObject({ ok: false, 状态: "未选类型" });
  });

  it("撞到别人名下的：号码重复，可与 负责人 沟通核实（客户电话写法不同也撞）", async () => {
    await 建("乙的客户", 乙, { phone: "+86 13900000101" });
    expect(await 查号码("手机号", "13900000101")).toMatchObject({ ok: true, 状态: "重复", 提示: "号码重复：客户「乙的客户」已有此号码，本次录入已拦截，可与 乙 沟通核实", 撞: { salesOwnerName: "乙" } });
  });

  it("撞到我名下的：我的通讯录已有；在公海的：公海待捞", async () => {
    const 我的 = await 建("甲的客户", 甲, { phone: "13900000101" });
    expect(await 查号码("手机号", "13900000101")).toMatchObject({ 状态: "我的通讯录已有", 提示: 查重提示.我的通讯录已有 });
    await prisma.customerPool.create({ data: { customerId: 我的.id } });
    expect(await 查号码("手机号", "13900000101")).toMatchObject({ 状态: "公海待捞", 提示: 查重提示.公海待捞 });
  });

  it("联系人上的电话 / 邮箱 / 微信也比（不分大小写）", async () => {
    const c = await 建("乙的客户", 乙);
    await prisma.contact.create({ data: { customerId: c.id, name: "王经理", phone: "139-0000-0102", email: "Wang@Corp.com", wechat: "WangLi_88" } });
    expect(await 查号码("手机号", "+8613900000102")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("邮箱", "wang@corp.COM")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "wangli_88")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "wangli_99")).toMatchObject({ 状态: "首次录入" });
  });

  it("客户档案上的邮箱 / 微信（CustomerExtra）也比", async () => {
    const c = await 建("乙的客户", 乙);
    await prisma.customerExtra.create({ data: { customerId: c.id, email: "boss@corp.com", wechat: "bossWx01" } });
    expect(await 查号码("邮箱", "BOSS@corp.com")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "bosswx01")).toMatchObject({ 状态: "重复" });
  });

  it("看不到的那位：只说负责人，不给 id / 名字", async () => {
    const c = await 建("乙的客户", 乙, { phone: "13900000101" });
    const r = await 撞号结论(prisma, [c.id], 甲, 甲);
    expect(r).toMatchObject({ 状态: "重复", 撞: { id: null, name: null, school: null, createdAt: null, salesOwnerName: "乙" } });
    expect((await 撞号结论(prisma, [c.id], 甲, null)).撞).toMatchObject({ id: c.id, name: "乙的客户" });
  });

  it("重复的提示（10-27 批注）：看得到的带客户名 + 本次录入已拦截；看不到的不说名字；公海的也说已拦截、不说名字", async () => {
    const c = await 建("乙的客户", 乙, { phone: "13900000101" });
    expect((await 撞号结论(prisma, [c.id], 甲, null)).提示).toBe("号码重复：客户「乙的客户」已有此号码，本次录入已拦截，可与 乙 沟通核实");
    const 看不到 = (await 撞号结论(prisma, [c.id], 甲, 甲)).提示;
    expect(看不到).toBe("号码重复：同事名下的客户已有此号码，本次录入已拦截，可与 乙 沟通核实");
    expect(看不到).not.toContain("乙的客户");
    await prisma.customerPool.create({ data: { customerId: c.id } });
    const 公海 = (await 撞号结论(prisma, [c.id], 甲, null)).提示;
    expect(公海).toBe("这个号码的客户在公海，本次录入已拦截，可去公海领取");
    expect(公海).not.toContain("乙的客户");
  });

  it("旺旺 ID：保存时存一行；别人换大小写、空格再建就挡下；子账号是另一个号", async () => {
    当(乙);
    const r = await saveCustomer(客户({ name: "旺旺客户", salesOwnerId: 乙, 企业号码: { 类型: "旺旺ID", 值: "My Shop:kefu01" } }));
    expect(r).toMatchObject({ ok: true });
    const 行 = await prisma.contactMethod.findMany();
    expect(行).toMatchObject([{ kind: "wangwang", value: "MyShop:kefu01", numberKey: "myshop:kefu01", contactId: null, formatStatus: "ok", region: null }]);
    当(甲);
    expect(await 查号码("旺旺ID", "myshop:KEFU01")).toMatchObject({ 状态: "重复", 提示: "号码重复：客户「旺旺客户」已有此号码，本次录入已拦截，可与 乙 沟通核实" });
    const 再建 = await saveCustomer(客户({ name: "又一个", 企业号码: { 类型: "旺旺ID", 值: "MYSHOP : kefu01" } }));
    // 11-03 有负责人在跟的撞号走同号协同：不新建，记录写给负责人（same-number-collab）
    expect(再建).toMatchObject({ ok: false, 同号协同: true });
    expect(!再建.ok && 再建.error).toContain("乙");
    expect(await 查号码("旺旺ID", "MyShop")).toMatchObject({ 状态: "首次录入" });
    expect(await 查号码("旺旺ID", "MyShop:kefu02")).toMatchObject({ 状态: "首次录入" });
    expect(await prisma.customer.count()).toBe(1);
  });

  it("保存：选邮箱 / 微信不要电话，号码记进客户档案；格式不对挡下", async () => {
    const r = await saveCustomer(客户({ name: "邮箱客户", 企业号码: { 类型: "邮箱", 值: " Li@Corp.com " } }));
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.customerExtra.findFirst({ select: { email: true } })).toEqual({ email: "Li@Corp.com" });
    expect(await saveCustomer(客户({ name: "坏号", 企业号码: { 类型: "微信", 值: "1abc" } }))).toEqual({ ok: false, error: "⚠️微信号格式错误" });
    const 手 = await saveCustomer(客户({ name: "手机客户", phone: "", 企业号码: { 类型: "手机号", 值: "+86 139-0000-0103" } }));
    expect(手).toMatchObject({ ok: true });
    expect(await prisma.customer.findFirst({ where: { name: "手机客户" }, select: { phone: true } })).toEqual({ phone: "13900000103" });
    // 子表一行一号，老列照写；手机号带归属地
    expect(await prisma.contactMethod.findMany({ orderBy: { kind: "asc" }, select: { kind: true, value: true, numberKey: true, region: true } })).toEqual([
      { kind: "email", value: "Li@Corp.com", numberKey: "li@corp.com", region: null },
      { kind: "phone", value: "13900000103", numberKey: "13900000103", region: expect.stringContaining("新疆") },
    ]);
  });

  it("保存：撞到另一位负责人联系人上的电话也不新建（走同号协同）", async () => {
    const c = await 建("乙的客户", 乙);
    await prisma.contact.create({ data: { customerId: c.id, name: "王经理", phone: "13900000104" } });
    expect(await saveCustomer(客户({ name: "撞了", 企业号码: { 类型: "手机号", 值: "13900000104" } }))).toMatchObject({ ok: false, 同号协同: true });
    expect(await prisma.customer.count({ where: { name: "撞了" } })).toBe(0);
  });

  it("全公司查号在事务里也能用（查完再写那一步）", async () => {
    const c = await 建("乙的客户", 乙, { phone: "13900000105" });
    const ids = await prisma.$transaction((tx) => 全公司查号(tx, "手机号", "13900000105", "13900000105"));
    expect(ids).toEqual([c.id]);
  });

  it("只在子表里的号也撞：手机号 / 邮箱 / 微信 / 旺旺 四种都比", async () => {
    const c = await 建("乙的客户", 乙);
    await prisma.contactMethod.createMany({ data: [
      { customerId: c.id, kind: "phone", value: "13900000106", numberKey: "13900000106" },
      { customerId: c.id, kind: "email", value: "Sub@Corp.com", numberKey: "sub@corp.com" },
      { customerId: c.id, kind: "wechat", value: "SubWx_01", numberKey: "subwx_01" },
      { customerId: c.id, kind: "wangwang", value: "SubShop:kf01", numberKey: "subshop:kf01" },
    ] });
    expect(await 查号码("手机号", "139 0000 0106")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("邮箱", "SUB@corp.com")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "subwx_01")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("旺旺ID", "SUBSHOP : kf01")).toMatchObject({ 状态: "重复" });
    // 不分类型（11-20 全局查重）：同一串记成微信，拿去查旺旺也撞
    expect(await 查号码("旺旺ID", "SubWx_01")).toMatchObject({ 状态: "重复" });
  });

  it("回收站里的号（客户 11-05（X-10））：查重、保存、AI 建档都拦下，叫人找系统管理员恢复；在用的也撞了照在用的说", async () => {
    const 删 = new Date();
    const c = await 建("删了的客户", 乙, { phone: "13900000301", deletedAt: 删 });
    await prisma.contactMethod.create({ data: { customerId: c.id, kind: "wangwang", value: "DelShop", numberKey: "delshop" } });
    const 活 = await 建("在用的客户", 乙);
    await prisma.contact.create({ data: { customerId: 活.id, name: "删了的联系人", email: "gone@corp.com", deletedAt: 删 } });
    const 拦 = { ok: true, 状态: "回收站里有", 提示: 回收站里有提示, 撞: { id: null, name: null, salesOwnerName: "系统管理员" } };
    expect(await 查号码("手机号", "13900000301")).toMatchObject(拦);
    expect(await 查号码("旺旺ID", "delshop")).toMatchObject(拦);
    expect(await 查号码("邮箱", "GONE@corp.com")).toMatchObject(拦);
    expect(await 查号码("手机号", "13900000302")).toMatchObject({ 状态: "首次录入" });
    expect(await saveCustomer(客户({ name: "同号重建", 企业号码: { 类型: "手机号", 值: "13900000301" } }))).toMatchObject({ ok: false, error: 回收站里有提示 });
    expect(await saveCustomer(客户({ name: "同号重建", 企业号码: { 类型: "旺旺ID", 值: "DelShop" } }))).toMatchObject({ ok: false, error: 回收站里有提示 });
    expect(await prisma.customer.count({ where: { name: "同号重建" } })).toBe(0);
    expect(await AI建档查重([{ 类型: "邮箱", 值: "gone@corp.com", 键: "gone@corp.com" }], { id: 甲, name: "甲" })).toBe(回收站里有提示);
    // AI 建档卡片要摆「从回收站捞回」：带上撞的是哪个号（客户 11-05）
    expect(await AI建档查重详([{ 类型: "邮箱", 值: "gone@corp.com", 键: "gone@corp.com" }], { id: 甲, name: "甲" })).toEqual({ 话: 回收站里有提示, 回收站: { 类型: "邮箱", 值: "gone@corp.com", 键: "gone@corp.com" } });
    expect(await prisma.task.count()).toBe(0);
    // 在用的也有这个号：照在用的说
    await 建("乙的新客户", 乙, { phone: "13900000301" });
    expect(await 查号码("手机号", "13900000301")).toMatchObject({ 状态: "重复", 提示: "号码重复：客户「乙的新客户」已有此号码，本次录入已拦截，可与 乙 沟通核实" });
    expect(await AI建档查重详([{ 类型: "手机号", 值: "13900000301", 键: "13900000301" }], { id: 甲, name: "甲" })).not.toHaveProperty("回收站");
  });

  it("撞到好几条认首条（建档最早）：先建的是同事 → 提示同事；首条在公海 → 公海待捞", async () => {
    const 早 = await 建("乙的老客户", 乙, { phone: "13900000107", createdAt: new Date("2026-01-01") });
    await 建("甲的新客户", 甲, { phone: "13900000107", createdAt: new Date("2026-06-01") });
    expect(await 查号码("手机号", "13900000107")).toMatchObject({ 状态: "重复", 提示: "号码重复：客户「乙的老客户」已有此号码，本次录入已拦截，可与 乙 沟通核实" });
    await prisma.customerPool.create({ data: { customerId: 早.id } });
    expect(await 查号码("手机号", "13900000107")).toMatchObject({ 状态: "公海待捞", 提示: 查重提示.公海待捞 });
  });
});

describe("跨类型全局查重（11-20：号码不分类型，全公司唯一）", () => {
  beforeEach(() => { vi.stubEnv("CRM_ENTERPRISE", "1"); });

  it("跨类键：像电话的按手机号键规整（+86 / 0086 / 空格横杠去掉），别的去空格小写", () => {
    expect(跨类键("+86 189-2505-7449")).toEqual({ 键: "18925057449", 电话: true });
    expect(跨类键("0086 18925057449")).toEqual({ 键: "18925057449", 电话: true });
    expect(跨类键("+44 20 7946 0958")).toEqual({ 键: "442079460958", 电话: true });
    expect(跨类键(" WangLi_88 ")).toEqual({ 键: "wangli_88", 电话: false });
    expect(跨类键("Boss@Corp.com")).toEqual({ 键: "boss@corp.com", 电话: false });
    expect(跨类键("1234")).toEqual({ 键: "1234", 电话: false });
    // 全角数字、字母、＋、．、＠ 都转半角；Telegram 用户名开头的 @ 去掉
    expect(跨类键("＋８６ １３９ ００００ ０４０１")).toEqual({ 键: "13900000401", 电话: true });
    expect(跨类键("ＷａｎｇＬｉ＿８８")).toEqual({ 键: "wangli_88", 电话: false });
    expect(跨类键("ｂｏｓｓ＠ｃｏｒｐ．ｃｏｍ")).toEqual({ 键: "boss@corp.com", 电话: false });
    expect(跨类键("@Shi_Li01")).toEqual({ 键: "shi_li01", 电话: false });
  });

  it("跨类型那几句裸 SQL 走索引（不在 SQL 里加回收站条件，查出来再滤）", async () => {
    const 计划 = async (sql: string, n: number) => (await prisma.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${sql}`, ...Array.from({ length: n }, (_, i) => `k${i}`))).map((x) => x.detail).join(" | ");
    expect(await 计划(跨类SQL.客户电话(2), 2)).toContain(号键索引名);
    const 档 = await 计划(跨类SQL.档案原样(2), 6);
    // 阿里国际站ID 那句不硬钉（库里全空时 ANALYZE 的统计会让它整表扫）；邮箱、微信两句必须走索引
    expect(档).toContain(档案格索引名.email);
    expect(档).toContain(档案格索引名.wechat);
    const 号 = await 计划(跨类SQL.档案号键(2), 4);
    expect(号).toContain("CustomerExtra_wechatPhoneKey_idx");
    expect(号).toContain("CustomerExtra_whatsappPhoneKey_idx");
    expect(await 计划(跨类SQL.联系人号键(2, 2), 6)).toContain("Contact_phoneKey_idx");
    // 156 的索引式子和 号键SQL 原样一致（不一致查询计划就不认）
    const 迁移 = fs.readFileSync(path.resolve(__dirname, "../migrations/156-cross-kind-phone-keys.sql"), "utf8");
    expect(迁移).toContain(`ON "CustomerExtra"(${号键SQL('"wechat"')});`);
    expect(迁移).toContain(`ON "CustomerExtra"(${号键SQL('"whatsapp"')});`);
  });

  it("全角数字照样撞；两边同一个规整：自定类型「ab-cde1」和微信「ab-cde1」互相查得到，和「abcde1」互相都不算", async () => {
    await 建("手机客户", 乙, { phone: "13900000412" });
    expect(await 查号码("微信", "１３９０００００４１２")).toMatchObject({ 状态: "重复" });
    const 自 = await 建("自定客户", 乙);
    await prisma.contactMethod.create({ data: { customerId: 自.id, kind: "custom:QQ", value: "AB-cde1", numberKey: "abcde1" } });
    const 微 = await 建("微信客户", 乙);
    await prisma.contactMethod.create({ data: { customerId: 微.id, kind: "wechat", value: "Ab-Cde2", numberKey: "ab-cde2" } });
    expect(await 一行号全公司查(prisma, { kind: "wechat", value: "ab-cde1", numberKey: "ab-cde1" })).toEqual([自.id]);
    expect(await 一行号全公司查(prisma, { kind: "wechat", value: "abcde1", numberKey: "abcde1" })).toEqual([]);
    expect(await 一行号全公司查(prisma, { kind: "custom:QQ", value: "ab-cde2", numberKey: "abcde2" })).toEqual([微.id]);
    expect(await 一行号全公司查(prisma, { kind: "custom:QQ", value: "abcde2", numberKey: "abcde2" })).toEqual([]);
    // Telegram 用户名带 @ 的和微信号同一串
    await prisma.contactMethod.create({ data: { customerId: 自.id, kind: "telegram", value: "@Shi_Li01", numberKey: "shi_li01" } });
    expect(await 查号码("微信", "shi_li01")).toMatchObject({ 状态: "重复" });
  });

  it("销售撞到看不到的同事客户（跨类型）：只说负责人，不给客户名、id", async () => {
    const c = await 建("甲的大客户", 甲);
    await prisma.contactMethod.create({ data: { customerId: c.id, kind: "wechat", value: "13900000413", numberKey: "13900000413" } });
    // 销售乙的范围只有自己名下（读的我 = 乙）
    const r = await 撞号结论(prisma, await 全公司查号(prisma, "手机号", "13900000413", "13900000413"), 乙, 乙);
    expect(r).toMatchObject({ 状态: "重复", 提示: "号码重复：同事名下的客户已有此号码，本次录入已拦截，可与 甲 沟通核实", 撞: { id: null, name: null } });
    expect(JSON.stringify(r)).not.toContain("甲的大客户");
  });

  it("客户号码几行（saveCustomerNumbers）跨类型整条走通：撞了在用的说重复，撞了回收站说回收站，别的类型也拦", async () => {
    const 别家 = await 建("别家", 乙);
    await prisma.contactMethod.create({ data: { customerId: 别家.id, kind: "wechat", value: "13900000430", numberKey: "13900000430" } });
    const 删 = await 建("删了的", 乙, { deletedAt: new Date() });
    await prisma.contactMethod.create({ data: { customerId: 删.id, kind: "wechat", value: "13900000431", numberKey: "13900000431" } });
    await prisma.contactMethod.create({ data: { customerId: 删.id, kind: "wechat", value: "wx_gone_01", numberKey: "wx_gone_01" } });
    const 我的 = await 建("我的客户", 甲, { phone: "13900000439" });
    const 存 = (kind: string, value: string) => saveCustomerNumbers(我的.id, [{ kind, value }]);
    const 撞 = await 存("landline", "139 0000 0430");
    expect(撞).toMatchObject({ ok: false });
    expect(!撞.ok && 撞.error).toContain("号码重复：客户「别家」已有此号码");
    expect(await 存("fax", "13900000431")).toMatchObject({ ok: false, error: expect.stringContaining(回收站里有提示) });
    expect(await 存("telegram", "@wx_gone_01")).toMatchObject({ ok: false, error: expect.stringContaining(回收站里有提示) });
    expect(await 联系人回收站撞(prisma, [{ kind: "telegram", value: "@wx_gone_01", numberKey: "wx_gone_01" }])).toEqual({ 类型: "微信", 值: "wx_gone_01" });
    expect(await prisma.contactMethod.count({ where: { customerId: 我的.id } })).toBe(0);
    expect(await 存("landline", "010-6600 0439")).toMatchObject({ ok: true });
  });

  it("先把手机号填在微信，再在手机格建同号：拦下", async () => {
    当(乙);
    expect(await saveCustomer(客户({ name: "微信登记的", salesOwnerId: 乙, 企业号码: { 类型: "微信", 值: "18925057449" } }))).toMatchObject({ ok: true });
    当(甲);
    expect(await 查号码("手机号", "18925057449")).toMatchObject({ 状态: "重复", 提示: "号码重复：客户「微信登记的」已有此号码，本次录入已拦截，可与 乙 沟通核实" });
    expect(await 查号码("手机号", "+86 189 2505 7449")).toMatchObject({ 状态: "重复" });
    const 再建 = await saveCustomer(客户({ name: "手机登记的", 企业号码: { 类型: "手机号", 值: "18925057449" } }));
    expect(再建.ok).toBe(false);
    expect(await prisma.customer.count({ where: { name: "手机登记的" } })).toBe(0);
  });

  it("先有手机号，再在微信格填同号（带 +86 / 0086 / 空格）：拦下", async () => {
    await 建("手机客户", 乙, { phone: "13900000401" });
    expect(await 查号码("微信", "13900000401")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "+86 139 0000 0401")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "0086-139-0000-0401")).toMatchObject({ 状态: "重复" });
    expect(await saveCustomer(客户({ name: "微信撞手机", 企业号码: { 类型: "微信", 值: "13900000401" } }))).toMatchObject({ ok: false });
    expect(await prisma.customer.count({ where: { name: "微信撞手机" } })).toBe(0);
  });

  it("老列里别的类型也比：联系人微信格存的手机号、档案 WhatsApp、档案微信格里的邮箱、档案邮箱格里的微信号", async () => {
    const c = await 建("老数据客户", 乙);
    await prisma.contact.create({ data: { customerId: c.id, name: "王经理", wechat: "+86 139-0000-0402" } });
    await prisma.customerExtra.create({ data: { customerId: c.id, whatsapp: "+86 139 0000 0403", wechat: "Old@Corp.com", email: "OldWx_88" } });
    expect(await 查号码("手机号", "13900000402")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "13900000403")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("邮箱", "old@corp.COM")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("微信", "oldwx_88")).toMatchObject({ 状态: "重复" });
    expect(await 查号码("旺旺ID", "OLDWX_88")).toMatchObject({ 状态: "重复" });
  });

  it("不同号不误拦：差一位、别的串、短号", async () => {
    await 建("手机客户", 乙, { phone: "13900000408" });
    const c = await 建("微信客户", 乙);
    await prisma.contactMethod.create({ data: { customerId: c.id, kind: "wechat", value: "wxid_keep01", numberKey: "wxid_keep01" } });
    expect(await 查号码("微信", "13900000409")).toMatchObject({ 状态: "首次录入" });
    expect(await 查号码("手机号", "13900000409")).toMatchObject({ 状态: "首次录入" });
    expect(await 查号码("旺旺ID", "wxid_keep02")).toMatchObject({ 状态: "首次录入" });
    expect(await 查号码("邮箱", "wxid_keep01@corp.com")).toMatchObject({ 状态: "首次录入" });
    // 只是前几位一样的 QQ 样微信号不算（整串比，不做前缀 / 后缀模糊）
    expect(await 查号码("微信", "139000004")).toMatchObject({ 状态: "首次录入" });
  });

  it("联系人加号码：微信格填了别人联系人的手机号、别的客户本身的号，都算撞", async () => {
    const 甲客 = await 建("甲客户", 乙);
    const 人 = await prisma.contact.create({ data: { customerId: 甲客.id, name: "张经理", phone: "13900000406" } });
    const 乙客 = await 建("乙客户", 乙);
    await prisma.contactMethod.create({ data: { customerId: 乙客.id, kind: "wechat", value: "13900000410", numberKey: "13900000410" } });
    expect((await 联系人查重(prisma, [{ kind: "wechat", value: "13900000406", numberKey: "13900000406" }], null)).map((x) => x.contactId)).toEqual([人.id]);
    expect(await 联系人查重(prisma, [{ kind: "phone", value: "13900000410", numberKey: "13900000410" }], null)).toMatchObject([{ customerId: 乙客.id, 客户本身: true }]);
    // 自己这位客户本身的号不算
    expect(await 联系人查重(prisma, [{ kind: "phone", value: "13900000410", numberKey: "13900000410" }], null, undefined, 乙客.id)).toEqual([]);
    expect(await 联系人查重(prisma, [{ kind: "wechat", value: "13900000411", numberKey: "13900000411" }], null)).toEqual([]);
  });

  it("别的类型的行（传真、自己加的）也和手机、微信互比", async () => {
    const c = await 建("微信客户", 乙);
    await prisma.contactMethod.create({ data: { customerId: c.id, kind: "wechat", value: "13900000407", numberKey: "13900000407" } });
    expect(await 一行号全公司查(prisma, { kind: "fax", value: "139 0000 0407", numberKey: "13900000407" })).toEqual([c.id]);
    expect(await 一行号全公司查(prisma, { kind: "landline", value: "+86 139 0000 0407", numberKey: "13900000407" })).toEqual([c.id]);
    expect(await 一行号全公司查(prisma, { kind: "custom:QQ", value: "13900000407", numberKey: "13900000407" }, c.id)).toEqual([]);
  });

  it("回收站里的也跨类型：删了的客户微信是这个号，手机格查到回收站里有；联系人表单也拦；能捞回", async () => {
    const 删 = new Date();
    const c = await 建("删了的客户", 乙, { deletedAt: 删 });
    await prisma.contactMethod.create({ data: { customerId: c.id, kind: "wechat", value: "13900000404", numberKey: "13900000404" } });
    const 拦 = { ok: true, 状态: "回收站里有", 提示: 回收站里有提示 };
    expect(await 查号码("手机号", "13900000404")).toMatchObject(拦);
    expect(await saveCustomer(客户({ name: "同号重建", 企业号码: { 类型: "手机号", 值: "13900000404" } }))).toMatchObject({ ok: false, error: 回收站里有提示 });
    expect(await 联系人回收站撞(prisma, [{ kind: "phone", value: "13900000404", numberKey: "13900000404" }])).toEqual({ 类型: "手机号", 值: "13900000404" });
    expect(await 一行号回收站查(prisma, { kind: "landline", value: "13900000404", numberKey: "13900000404" })).toEqual([c.id]);
    // 客户还在、联系人删了：联系人微信格存的是手机号
    const 活 = await 建("在用的客户", 乙);
    const 人 = await prisma.contact.create({ data: { customerId: 活.id, name: "删了的联系人", wechat: "13900000405", deletedAt: 删 } });
    expect(await 查号码("手机号", "+86 13900000405")).toMatchObject(拦);
    expect(await 从回收站捞回("手机号", "13900000405")).toMatchObject({ ok: true });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 人.id }, select: { deletedAt: true } })).toEqual({ deletedAt: null });
    expect(await 从回收站捞回("手机号", "13900000404")).toMatchObject({ ok: true });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, select: { deletedAt: true } })).toEqual({ deletedAt: null });
  });
});

describe("开关关着照旧", () => {
  it("查号码不认；保存不认 企业号码（电话照样必填、不写旺旺行）；只在联系人上的电话不挡（老查重）", async () => {
    expect(await 查号码("旺旺ID", "MyShop")).toMatchObject({ ok: false, 状态: "没开" });
    const 没电话 = await saveCustomer(客户({ name: "旺旺客户", 企业号码: { 类型: "旺旺ID", 值: "MyShop" } }));
    expect(没电话.ok).toBe(false);
    expect(await prisma.contactMethod.count()).toBe(0);
    const 有电话 = await saveCustomer(客户({ name: "旺旺客户", phone: "13900000201", 企业号码: { 类型: "旺旺ID", 值: "MyShop" } }));
    expect(有电话).toMatchObject({ ok: true });
    expect(await prisma.contactMethod.count()).toBe(0);

    const c = await 建("乙的客户", 乙);
    await prisma.contact.create({ data: { customerId: c.id, name: "王经理", phone: "13900000202" } });
    expect(await checkDuplicate("13900000202")).toBeNull();
    expect(await saveCustomer(客户({ name: "照旧能建", phone: "13900000202" }))).toMatchObject({ ok: true });
  });
});
