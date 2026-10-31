/**
 * 企业版客户与联系人第二轮（2026-10-29 P13）：
 *   - 联系人挂多位客户（迁移 090）：新建记一行主客户挂靠；挂到别的客户、改说明、解除（主客户那行解不掉）、换主客户（号码跟着走、原主客户留作挂靠）；
 *     客户页 客户的联系人们 / 联系人页 联系人另挂；启动回填只补缺的、重跑不多
 *   - 联系方式全部查重：各种类型（含自己加的）同类型 + 规整值算撞，+86 / 0086、大小写、分隔符不算不同；saveContact 撞了不存、照存放行、
 *     编辑只查新出现的号；导入照写 + 提醒「号码重复」（本批前后、和我们这边已有的）
 *   - 客户类型（迁移 092，字典 custType）：保存 / 单格改只收启用的、原值停用了原样交回也认；导入认得上才落，对不上进备注
 *     10-30 换了一套默认（贸易商→中间贸易商、代理商→国家代理商、经销商默认停用、加专业运营商 / 一般客户），老库第一次读时改名、补项、换顺序；
 *     同日第二轮：一般客户改叫暂不确认（旧默认第二轮，上一轮的库、更老的库都改到）；
 *     导入原表的客户类型先过对照表（一般客户、空着、意向客户这类阶段写法都落暂不确认，意向客户顺带补 B 级）
 *   - 客户状态 / 客户类型下拉的释义：按默认 id 认，改了名的带着、自己加的没有、级别没有
 *   - 号码类型加了传真、Telegram：传真同座机只比数字，Telegram 用户名去 @ 不分大小写，都参与查重
 *   - 级别星级：S/A/B/C = 4/3/2/1 颗，一个映射一处显示
 * 只读同事客户、看不到的客户这两种权限在 ent-contact-link-scope.test.ts（真组织架构）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 可选项, 字典定义, 企业字典, 页面释义 } from "@/lib/enterprise/dict";
import { 字典项释义 } from "@/lib/enterprise/dict-kinds";
import { 级别显示, 级别选项, 级别星数, 满星, 联系人号查重键, 自定号码键 } from "@/lib/enterprise/customer-v2";
import { 客户的联系人们, 联系人另挂, 联系人挂靠回填 } from "@/lib/enterprise/customer-v2-db";
import { 联系人查重, 联系人撞号话 } from "@/lib/enterprise/contact-dedupe";
import { 清洗, 空索引, type 已有联系人 } from "@/lib/enterprise-import/clean";
import { 客户类型对照, 对客户类型, 客户类型等级 } from "@/lib/enterprise-import/mapping";
import { 读本地索引 } from "@/lib/enterprise-import/report";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { 挂到客户, 改挂靠说明, 解除挂靠, 换主客户 } from "@/app/(app)/customers/[id]/contact-link-actions";

let 销售: string;
let 序 = 0;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  销售 = (await prisma.user.create({ data: { email: "s@t", name: "销售", role: "SALES", password: "x" } })).id;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const 新建 = (改: Record<string, unknown> = {}) =>
  saveCustomer({
    name: `测试客户${++序}`, phone: `1380000${String(1000 + 序).slice(-4)}`, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: 销售, channelId: null, referrerCustomerId: null,
    ...改,
  } as Parameters<typeof saveCustomer>[0]);

async function 新建id(改: Record<string, unknown> = {}) {
  const r = await 新建(改);
  if (!r.ok) throw new Error(r.error);
  return (await prisma.customer.findFirstOrThrow({ orderBy: { createdAt: "desc" }, select: { id: true } })).id;
}

/** 建一位联系人（企业版号码几行），回 id */
async function 建联系人(customerId: string, name: string, 号码们: { kind: string; value: string }[] = [], 改: Record<string, unknown> = {}) {
  const r = await saveContact({ customerId, name, isPrimary: false, 企业: { 号码们 }, ...改 });
  if (!r.ok) throw new Error(r.error);
  return (await prisma.contact.findFirstOrThrow({ where: { name }, orderBy: { createdAt: "desc" }, select: { id: true } })).id;
}
const 挂靠们 = async (contactId: string) =>
  (await prisma.contactCustomer.findMany({ where: { contactId }, select: { customerId: true, note: true } })).map((x) => [x.customerId, x.note]).sort();

describe("纯函数：级别星级、查重键", () => {
  it("S/A/B/C 档位 4/3/2/1（只排序用）；显示只给字母和说明、不带星（F-客户-01）；认不出的不显示", () => {
    expect(级别星数).toEqual({ S: 4, A: 3, B: 2, C: 1 });
    expect(满星).toBe(4);
    expect(级别显示("A")).toMatchObject({ 级: "A", 星数: 3, 亮: "★★★", 暗: "★", 说明: "A 重点" });
    expect(级别显示("D")).toMatchObject({ 级: "C", 星数: 1 });
    expect(级别显示("S")!.读法).toBe("S 战略");
    expect([级别显示(null), 级别显示("X")]).toEqual([null, null]);
    expect(级别选项()).toEqual([
      { value: "S", label: "S 战略" },
      { value: "A", label: "A 重点" },
      { value: "B", label: "B 常规" },
      { value: "C", label: "C 培育" },
    ]);
  });

  it("查重键：手机去分隔符和 +86 / 0086，邮箱微信不分大小写，座机只留数字，自己加的去分隔符", () => {
    for (const v of ["139 0000 0001", "+86 139-0000-0001", "0086(139)00000001", "13900000001"]) expect(联系人号查重键("phone", v)).toBe("13900000001");
    expect(联系人号查重键("email", " Zhang@X.com ")).toBe("zhang@x.com");
    expect(联系人号查重键("wechat", "Zhang_San")).toBe("zhang_san");
    expect(联系人号查重键("landline", "021-1234 5678")).toBe("02112345678");
    expect(联系人号查重键("landline", "12-3")).toBe("");
    expect(联系人号查重键("custom:QQ", "Ab-C (1)")).toBe(联系人号查重键("custom:QQ", "abc1"));
    expect([联系人号查重键("custom:QQ", "---"), 联系人号查重键("phone", "  ")]).toEqual(["", ""]);
    expect(自定号码键("A-B")).toBe("ab");
    // 传真同座机只留数字；Telegram 用户名去 @ 不分大小写，+ 开头的同手机
    expect(联系人号查重键("fax", "+86 21-1234 5678")).toBe("862112345678");
    expect(联系人号查重键("fax", "12-3")).toBe("");
    expect(联系人号查重键("telegram", " @Shi_Li01 ")).toBe("shi_li01");
    expect(联系人号查重键("telegram", "shi_li01")).toBe("shi_li01");
    expect(联系人号查重键("telegram", "+86 139-0000-0001")).toBe("13900000001");
    expect(联系人号查重键("telegram", "＋44 7911 123456")).toBe("447911123456");
    expect(联系人号查重键("telegram", "shi li")).toBe("");
  });

  it("客户状态默认顺序：流失排在丢单前面（id 不动）", async () => {
    expect(字典定义.custStatus.默认顺序).toEqual(["潜在", "意向", "成交", "交付", "复购", "忠诚", "流失", "丢单", "异常"]);
    expect(await 可选项("custStatus")).toEqual(字典定义.custStatus.默认顺序);
    expect((await prisma.entDictItem.findUniqueOrThrow({ where: { id: "dict-custStatus-6" } })).name).toBe("丢单");
  });

  it("客户状态老库：没动过的才按新顺序排，人挪过的整类不动", async () => {
    for (const [i, name] of 字典定义.custStatus.默认.entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-custStatus-${i}`, kind: "custStatus", name, sort: i } });
    }
    await prisma.setting.create({ data: { key: "entDict.defaultRenamed.custStatus", value: "true" } });
    expect((await 可选项("custStatus")).slice(6, 8)).toEqual(["流失", "丢单"]);

    await prisma.entDictItem.deleteMany();
    await prisma.setting.deleteMany({ where: { key: "entDict.defaultOrder.custStatus" } });
    for (const [i, name] of 字典定义.custStatus.默认.entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-custStatus-${i}`, kind: "custStatus", name: name === "流失" ? "流失客户" : name, sort: i } });
    }
    expect((await 可选项("custStatus")).slice(6, 8)).toEqual(["丢单", "流失客户"]);
  });

  it("客户类型新库：按默认顺序排，经销商建出来就停着", async () => {
    expect(await 可选项("custType")).toEqual(["个人买家", "中间贸易商", "国家代理商", "专业运营商", "暂不确认"]);
    const 全 = await 企业字典("custType");
    expect(全.map((x) => [x.name, x.active])).toEqual([
      ["个人买家", true], ["中间贸易商", true], ["国家代理商", true], ["专业运营商", true], ["暂不确认", true], ["经销商", false],
    ]);
    expect(全.map((x) => x.id)).toEqual([0, 1, 2, 4, 5, 3].map((i) => `dict-custType-${i}`));
  });

  it("客户类型老库（只有旧四项 + 自己加的）：改名、经销商停用、补两项、换顺序，自己加的排最后；再读不变；客户上存的旧名不跟着改", async () => {
    for (const [i, name] of ["个人买家", "贸易商", "代理商", "经销商"].entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-custType-${i}`, kind: "custType", name, sort: i } });
    }
    await prisma.entDictItem.create({ data: { kind: "custType", name: "示例类型", sort: 4 } });
    // 老客户在改名前就存了「贸易商」（直接写库，模拟改名前的数据）
    const 老客户 = await 新建id();
    await prisma.customer.update({ where: { id: 老客户 }, data: { customerType: "贸易商" } });
    const 看 = async () => (await 企业字典("custType")).map((x) => [x.id, x.name, x.active]);
    const 期望 = [
      ["dict-custType-0", "个人买家", true],
      ["dict-custType-1", "中间贸易商", true],
      ["dict-custType-2", "国家代理商", true],
      ["dict-custType-4", "专业运营商", true],
      ["dict-custType-5", "暂不确认", true],
      ["dict-custType-3", "经销商", false],
      [expect.any(String), "示例类型", true],
    ];
    expect(await 看()).toEqual(期望);
    expect(await 看()).toEqual(期望);
    expect(await 可选项("custType")).toEqual(["个人买家", "中间贸易商", "国家代理商", "专业运营商", "暂不确认", "示例类型"]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 老客户 } })).customerType).toBe("贸易商");
  });

  it("客户类型老库：人改过名的旧默认不动；新项的名字已被自己加的占了不重建", async () => {
    for (const [i, name] of ["个人买家", "批发商", "代理商", "经销商"].entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-custType-${i}`, kind: "custType", name, sort: i } });
    }
    await prisma.entDictItem.create({ data: { kind: "custType", name: "暂不确认", sort: 4 } });
    const 全 = await 企业字典("custType");
    expect(全.filter((x) => x.name === "暂不确认")).toHaveLength(1);
    expect(全.some((x) => x.id === "dict-custType-5")).toBe(false);
    expect(全.find((x) => x.id === "dict-custType-1")?.name).toBe("批发商");
    expect(全.find((x) => x.id === "dict-custType-2")?.name).toBe("国家代理商");
    expect(全.find((x) => x.id === "dict-custType-4")?.name).toBe("专业运营商");
    // 暂不确认（-5）没建，补换顺序看到缺项整类不挪：新补的专业运营商排在序号 4 上，自己加的往后让
    expect(全.map((x) => x.name)).toEqual(["个人买家", "批发商", "国家代理商", "经销商", "专业运营商", "暂不确认"]);
  });

  /** 上一轮（10-30 第一套）新库的样子：六项、经销商停着、按那时的默认顺序排、三个记号都记过 */
  async function 上一轮客户类型库(改: Record<number, string> = {}) {
    const 名 = ["个人买家", "中间贸易商", "国家代理商", "经销商", "专业运营商", "一般客户"];
    const 序号 = [0, 1, 2, 5, 3, 4];
    for (const [i, name] of 名.entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-custType-${i}`, kind: "custType", name: 改[i] ?? name, sort: 序号[i], active: i !== 3 } });
    }
    for (const k of ["entDict.defaultRenamed.custType", "entDict.defaultAdded.custType", "entDict.defaultOrder.custType", "entDict.defaultOff.custType"]) {
      await prisma.setting.create({ data: { key: k, value: "true" } });
    }
  }

  it("客户类型上一轮的库：一般客户改叫暂不确认，位置不变、记下第二轮记号；再读不变；客户上存的一般客户不跟着改（总控另跑脚本）", async () => {
    await 上一轮客户类型库();
    const 老客户 = await 新建id();
    await prisma.customer.update({ where: { id: 老客户 }, data: { customerType: "一般客户" } });
    const 看 = async () => (await 企业字典("custType")).map((x) => [x.id, x.name, x.active]);
    const 期望 = [
      ["dict-custType-0", "个人买家", true],
      ["dict-custType-1", "中间贸易商", true],
      ["dict-custType-2", "国家代理商", true],
      ["dict-custType-4", "专业运营商", true],
      ["dict-custType-5", "暂不确认", true],
      ["dict-custType-3", "经销商", false],
    ];
    expect(await 看()).toEqual(期望);
    expect(await prisma.setting.findUnique({ where: { key: "entDict.defaultRenamed.custType.2" } })).not.toBeNull();
    expect(await 看()).toEqual(期望);
    expect(await 可选项("custType")).toEqual(["个人买家", "中间贸易商", "国家代理商", "专业运营商", "暂不确认"]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 老客户 } })).customerType).toBe("一般客户");
  });

  it("客户类型上一轮的库：管理员已把一般客户改了名的不动；第二轮记号记过就不再改（之后管理员改回一般客户也不动）", async () => {
    await 上一轮客户类型库({ 5: "待定客户" });
    expect((await 企业字典("custType")).find((x) => x.id === "dict-custType-5")?.name).toBe("待定客户");
    await prisma.entDictItem.update({ where: { id: "dict-custType-5" }, data: { name: "一般客户" } });
    expect((await 企业字典("custType")).find((x) => x.id === "dict-custType-5")?.name).toBe("一般客户");
  });

  it("客户类型上一轮的库：自己加过「暂不确认」，第 6 项的一般客户不改名（不撞名）", async () => {
    await 上一轮客户类型库();
    await prisma.entDictItem.create({ data: { kind: "custType", name: "暂不确认", sort: 6 } });
    const 全 = await 企业字典("custType");
    expect(全.find((x) => x.id === "dict-custType-5")?.name).toBe("一般客户");
    expect(全.filter((x) => x.name === "暂不确认")).toHaveLength(1);
  });

  it("客户类型最老的库（贸易商那四项）连着两轮改：第一轮改名 / 补项，第二轮没有一般客户可改，两个记号都记下", async () => {
    for (const [i, name] of ["个人买家", "贸易商", "代理商", "经销商"].entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-custType-${i}`, kind: "custType", name, sort: i } });
    }
    expect(await 可选项("custType")).toEqual(["个人买家", "中间贸易商", "国家代理商", "专业运营商", "暂不确认"]);
    const 记号 = (await prisma.setting.findMany({ where: { key: { startsWith: "entDict.defaultRenamed.custType" } } })).map((x) => x.key).sort();
    expect(记号).toEqual(["entDict.defaultRenamed.custType", "entDict.defaultRenamed.custType.2"]);
  });

  it("下拉释义：按默认 id 认，管理员改了名的带着原释义、自己加的没有、经销商没有（级别不是字典，不带释义）", async () => {
    await 上一轮客户类型库({ 1: "转卖商" });
    await prisma.entDictItem.create({ data: { kind: "custType", name: "示例类型", sort: 6 } });
    const 类型 = await 页面释义("custType");
    expect(类型["转卖商"]).toBe(字典定义.custType.释义![1]);
    expect(类型["暂不确认"]).toContain("还没判断出");
    expect(类型["示例类型"]).toBeUndefined();
    expect(类型["经销商"]).toBeUndefined();
    const 状态 = await 页面释义("custStatus");
    expect(Object.keys(状态)).toHaveLength(9);
    expect(状态["复购"]).toContain("2 个项目");
    expect(字典项释义("custType", "dict-custStatus-1")).toBeNull();
    expect(字典项释义("custStatus", "dict-custStatus-9")).toBeNull();
    expect(字典项释义("custStatus", "自己加的id")).toBeNull();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 页面释义("custType")).toEqual({});
  });

  it("号码类型老库（只有前六项 + 自己加的）：补上传真、Telegram，自己加的排在后面；Telegram 被自己加的占了名就不重建", async () => {
    for (const [i, name] of 字典定义.contactKind.默认.slice(0, 6).entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-contactKind-${i}`, kind: "contactKind", name, sort: i } });
    }
    await prisma.entDictItem.create({ data: { kind: "contactKind", name: "QQ", sort: 6 } });
    const 全 = await 企业字典("contactKind");
    expect(全.map((x) => x.name)).toEqual([...字典定义.contactKind.默认, "QQ"]);
    expect(全.slice(6, 8).map((x) => x.id)).toEqual(["dict-contactKind-6", "dict-contactKind-7"]);
    expect(await 企业字典("contactKind")).toHaveLength(9);

    await prisma.entDictItem.deleteMany();
    await prisma.setting.deleteMany({ where: { key: "entDict.defaultAdded.contactKind" } });
    for (const [i, name] of 字典定义.contactKind.默认.slice(0, 6).entries()) {
      await prisma.entDictItem.create({ data: { id: `dict-contactKind-${i}`, kind: "contactKind", name, sort: i } });
    }
    await prisma.entDictItem.create({ data: { kind: "contactKind", name: "Telegram", sort: 6 } });
    const 再 = await 企业字典("contactKind");
    expect(再.map((x) => x.name)).toEqual(["手机", "座机", "微信", "邮箱", "WhatsApp", "阿里国际站ID", "传真", "Telegram"]);
    expect(再.some((x) => x.id === "dict-contactKind-7")).toBe(false);
  });
});

describe("联系人挂多位客户", () => {
  it("新建联系人在主客户上记一行挂靠；挂到别的客户、改说明、解除；主客户那行解不掉", async () => {
    const 甲 = await 新建id();
    const 乙 = await 新建id();
    const 人 = await 建联系人(甲, "王五");
    expect(await 挂靠们(人)).toEqual([[甲, null]]);

    expect(await 挂到客户(人, 乙, "  采购   对接 ")).toEqual({ ok: true });
    expect(await 挂靠们(人)).toEqual([[甲, null], [乙, "采购 对接"]].sort());
    expect(await 挂到客户(人, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("已经挂在") });
    expect(await 挂到客户(人, 甲)).toMatchObject({ ok: false, error: expect.stringContaining("就是") });
    expect(await 挂到客户(人, 乙, "字".repeat(41))).toMatchObject({ ok: false });
    expect(await 挂到客户("没有这个人", 乙)).toMatchObject({ ok: false });

    const 乙行 = await prisma.contactCustomer.findFirstOrThrow({ where: { contactId: 人, customerId: 乙 } });
    expect(await 改挂靠说明(乙行.id, "老板")).toEqual({ ok: true });
    expect((await prisma.contactCustomer.findUniqueOrThrow({ where: { id: 乙行.id } })).note).toBe("老板");

    const 主行 = await prisma.contactCustomer.findFirstOrThrow({ where: { contactId: 人, customerId: 甲 } });
    expect(await 解除挂靠(主行.id)).toEqual({ ok: false, error: "主客户不能解除，只能换成别的客户" });
    expect(await 解除挂靠(乙行.id)).toEqual({ ok: true });
    expect(await 挂靠们(人)).toEqual([[甲, null]]);
    expect(await prisma.contact.count({ where: { id: 人 } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entity: "Customer", summary: { contains: "王五" } } })).toBeGreaterThanOrEqual(3);
  });

  it("换主客户：号码跟着去新主客户、主要联系人摘掉、原主客户留作挂靠", async () => {
    const 甲 = await 新建id();
    const 乙 = await 新建id();
    const r = await saveContact({ customerId: 甲, name: "赵六", isPrimary: true, 企业: { 号码们: [{ kind: "phone", value: "13900000011" }] } });
    expect(r.ok).toBe(true);
    const 人 = (await prisma.contact.findFirstOrThrow({ where: { name: "赵六" } })).id;
    expect(await 换主客户(人, 甲)).toMatchObject({ ok: false, error: expect.stringContaining("已经是主客户") });
    expect(await 换主客户(人, 乙)).toEqual({ ok: true });
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: 人 }, include: { contactMethods: true } });
    expect([c.customerId, c.isPrimary]).toEqual([乙, false]);
    expect(c.contactMethods.map((x) => x.customerId)).toEqual([乙]);
    expect(await 挂靠们(人)).toEqual([[甲, null], [乙, null]].sort());
    // 原主客户那行现在是挂靠，能解除了
    const 甲行 = await prisma.contactCustomer.findFirstOrThrow({ where: { contactId: 人, customerId: 甲 } });
    expect(await 解除挂靠(甲行.id)).toEqual({ ok: true });
  });

  it("客户的联系人们只列主客户是别人的；联系人另挂只列主客户以外的", async () => {
    const 甲 = await 新建id();
    const 乙 = await 新建id();
    const 丙 = await 新建id();
    const 人 = await 建联系人(甲, "钱七");
    await 挂到客户(人, 乙, "顾问");
    await 挂到客户(人, 丙);
    expect(await 客户的联系人们(甲)).toEqual([]);
    const 乙的 = await 客户的联系人们(乙);
    expect(乙的.map((x) => [x.contact.name, x.note, x.主客户.id, x.主客户.看得到, x.主客户.能改])).toEqual([["钱七", "顾问", 甲, true, true]]);
    const 另 = await 联系人另挂([人]);
    expect(另[人].map((x) => x.id).sort()).toEqual([乙, 丙].sort());
    expect(另[人].every((x) => x.看得到)).toBe(true);

    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 客户的联系人们(乙)).toEqual([]);
    expect(await 联系人另挂([人])).toEqual({});
    expect(await 挂到客户(人, 甲)).toMatchObject({ ok: false, error: "这个版本没有联系人挂靠" });
  });

  it("从挂靠的那位客户页上编辑：主客户、主要联系人照原样", async () => {
    const 甲 = await 新建id();
    const 乙 = await 新建id();
    const r = await saveContact({ customerId: 甲, name: "孙八", isPrimary: true, 企业: { 号码们: [] } });
    expect(r.ok).toBe(true);
    const 人 = await prisma.contact.findFirstOrThrow({ where: { name: "孙八" } });
    await 挂到客户(人.id, 乙);
    const 再 = await saveContact({ id: 人.id, customerId: 乙, name: "孙八", isPrimary: false, position: "总监", 企业: { 号码们: [] }, 版本: 人.updatedAt.toISOString() });
    expect(再.ok).toBe(true);
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: 人.id } });
    expect([c.customerId, c.isPrimary, c.position]).toEqual([甲, true, "总监"]);
  });

  it("启动回填：没有挂靠行的联系人补一行主客户，重跑不多；开关关着不动", async () => {
    const 甲 = await 新建id();
    const 老 = await prisma.contact.create({ data: { customerId: 甲, name: "老联系人" } });
    expect(await prisma.contactCustomer.count()).toBe(0);
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 联系人挂靠回填()).toBe(0);
    vi.stubEnv("CRM_ENTERPRISE", "1");
    expect(await 联系人挂靠回填()).toBe(1);
    expect(await 联系人挂靠回填()).toBe(0);
    expect(await 挂靠们(老.id)).toEqual([[甲, null]]);
  });
});

describe("联系方式查重", () => {
  it("各种类型都比：手机 +86、邮箱大小写、自己加的类型分隔符；不同类型同号不算", async () => {
    const 甲 = await 新建id();
    await 企业字典("contactKind");
    await prisma.entDictItem.create({ data: { kind: "contactKind", name: "QQ", sort: 99 } });
    await 建联系人(甲, "张一", [
      { kind: "phone", value: "13900000021" },
      { kind: "email", value: "Zhang@X.com" },
      { kind: "landline", value: "021-12345678" },
      { kind: "custom:QQ", value: "Ab-C 1" },
    ]);
    const 查 = (kind: string, value: string, numberKey: string) => 联系人查重(prisma, [{ kind, value, numberKey }], null);
    expect((await 查("phone", "+86 139 0000 0021", "13900000021")).map((x) => x.name)).toEqual(["张一"]);
    expect((await 查("email", "zhang@x.com", "zhang@x.com")).map((x) => x.kind)).toEqual(["email"]);
    expect(await 查("landline", "02112345678", "02112345678")).toHaveLength(1);
    expect(await 查("custom:QQ", "abc1", 联系人号查重键("custom:QQ", "abc1"))).toHaveLength(1);
    expect(await 查("custom:微博", "abc1", "abc1")).toEqual([]);
    expect(await 查("wechat", "13900000021", "13900000021")).toEqual([]);
    // 子表回填之前的老三格也比
    await prisma.contact.create({ data: { customerId: 甲, name: "老三格", wechat: " LaoWX " } });
    expect((await 查("wechat", "laowx", "laowx")).map((x) => x.name)).toEqual(["老三格"]);
  });

  it("saveContact 撞了不存、回撞到的那位；照存放行；编辑时原来就有的号不再查", async () => {
    const 甲 = await 新建id();
    const 乙 = await 新建id();
    const 张 = await 建联系人(甲, "张二", [{ kind: "phone", value: "13900000031" }]);
    const 撞 = await saveContact({ customerId: 乙, name: "李二", isPrimary: false, 企业: { 号码们: [{ kind: "phone", value: "+86 139-0000-0031" }] } });
    expect(撞).toMatchObject({ ok: false, 撞了: [{ contactId: 张, name: "张二", customerId: 甲, kind: "phone" }] });
    if (!撞.ok && "撞了" in 撞) expect(撞.error).toContain("张二");
    expect(await prisma.contact.count({ where: { name: "李二" } })).toBe(0);

    const 照 = await saveContact({ customerId: 乙, name: "李二", isPrimary: false, 照存: true, 企业: { 号码们: [{ kind: "phone", value: "13900000031" }] } });
    expect(照.ok).toBe(true);
    // 李二改个职位：号是原来就有的，不再拦
    const 李 = await prisma.contact.findFirstOrThrow({ where: { name: "李二" } });
    const 改 = await saveContact({ id: 李.id, customerId: 乙, name: "李二", isPrimary: false, position: "经理", 企业: { 号码们: [{ kind: "phone", value: "13900000031" }] }, 版本: 李.updatedAt.toISOString() });
    expect(改.ok).toBe(true);
    // 编辑自己不算撞自己
    const 张本 = await prisma.contact.findUniqueOrThrow({ where: { id: 张 } });
    expect((await saveContact({ id: 张, customerId: 甲, name: "张二", isPrimary: false, 企业: { 号码们: [{ kind: "phone", value: "13900000031" }, { kind: "email", value: "z2@x.com" }] }, 版本: 张本.updatedAt.toISOString() })).ok).toBe(true);
  });

  it("传真、Telegram 也查重：传真只比数字，Telegram 用户名去 @ 不分大小写；saveContact 撞了不存", async () => {
    const 甲 = await 新建id();
    const 乙 = await 新建id();
    const 张 = await 建联系人(甲, "张三示例", [{ kind: "fax", value: "021-1234 5678" }, { kind: "telegram", value: "@Shi_Li01" }]);
    const 存 = (号: { kind: string; value: string }) => saveContact({ customerId: 乙, name: "李四示例", isPrimary: false, 企业: { 号码们: [号] } });
    expect(await 存({ kind: "fax", value: "(021) 12345678" })).toMatchObject({ ok: false, 撞了: [{ contactId: 张, kind: "fax" }] });
    expect(await 存({ kind: "telegram", value: "shi_li01" })).toMatchObject({ ok: false, 撞了: [{ contactId: 张, kind: "telegram" }] });
    // 同一个号换了类型不算撞
    expect((await 存({ kind: "landline", value: "021-12345678" })).ok).toBe(true);
    expect(await prisma.contactMethod.findMany({ where: { contactId: 张 }, select: { kind: true, numberKey: true }, orderBy: { kind: "asc" } }))
      .toEqual([{ kind: "fax", numberKey: "02112345678" }, { kind: "telegram", numberKey: "shi_li01" }]);
    // Telegram 写号码的，和手机一样去 +86
    await 建联系人(甲, "王五示例", [{ kind: "telegram", value: "+86 139 0000 0051" }]);
    expect(await 存({ kind: "telegram", value: "13900000051" })).toMatchObject({ ok: false });
  });

  it("撞号那一句：看得到说名字和客户，看不到只说负责人", () => {
    const 叫 = (k: string) => (k === "phone" ? "手机" : k);
    const 见 = { contactId: "c1", name: "张三", customerId: "u1", customerName: "某客户", 同事: "销售", kind: "phone", value: "139" };
    expect(联系人撞号话([见], 叫)).toContain("「张三」（某客户）");
    expect(联系人撞号话([{ ...见, contactId: null, name: null, customerId: null, customerName: null }, 见], 叫)).toContain("销售名下的一位联系人身上等 2 位");
  });
});

describe("客户类型", () => {
  it("新建 / 整表改只收字典里启用的；单格改同样；原值停用了原样交回也认", async () => {
    expect(await 新建({ 企业资料: { customerType: "乱写" } })).toMatchObject({ ok: false, error: expect.stringContaining("客户类型「乱写」") });
    const id = await 新建id({ 企业资料: { customerType: "中间贸易商" } });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).customerType).toBe("中间贸易商");
    expect((await patchCustomer(id, "customerType", "国家代理商")).ok).toBe(true);
    expect((await patchCustomer(id, "customerType", "乱写")).ok).toBe(false);
    // 经销商默认停用：不能新选
    expect((await patchCustomer(id, "customerType", "经销商")).ok).toBe(false);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).customerType).toBe("国家代理商");
    await prisma.entDictItem.updateMany({ where: { kind: "custType", name: "国家代理商" }, data: { active: false } });
    expect((await patchCustomer(id, "customerType", "国家代理商")).ok).toBe(true);
    expect((await patchCustomer(id, "customerType", "")).ok).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id } })).customerType).toBeNull();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await patchCustomer(id, "customerType", "中间贸易商")).toMatchObject({ ok: false });
  });
});

describe("导入", () => {
  function 映射样(): 映射 {
    return {
      列: {
        customer: { 外部: "id", 名称: "name", 电话: "phone", 负责人: "owner", 类型: "customerType" },
        contact: { 外部: "id", 客户ID: "customerRef", 姓名: "name", 手机: "phone", 邮箱: "email" },
      },
      负责人: { 张伟: "u-zhang" },
      值: {},
      默认负责人Id: "u-default",
    } as unknown as 映射;
  }
  let 行 = 0;
  const 条 = (实体: 原始记录["实体"], 字段: Record<string, string>): 原始记录 => ({ 实体, 外部ID: 字段.外部, 字段, 行号: ++行 + 1, 出处: "测试.xlsx" });

  it("客户类型：和字典一字不差才落，对不上进备注提醒；没认出不带这一格", () => {
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "c1", 名称: "甲公司", 电话: "13800000001", 负责人: "张伟", 类型: "中间贸易商" }),
        条("customer", { 外部: "c2", 名称: "乙公司", 电话: "13800000002", 负责人: "张伟", 类型: "批发" }),
      ],
      映射样(),
      { ...空索引(), 客户类型: ["中间贸易商", "国家代理商"] },
    );
    expect(待写[0].值.customerType).toBe("中间贸易商");
    expect("customerType" in 待写[1].值).toBe(false);
    expect(待写[1].值.remark).toContain("客户类型：批发");
    expect(问题.some((p) => p.外部ID === "c2" && p.说明.includes("客户类型「批发」"))).toBe(true);
  });

  it("客户类型对照表：原表写法换成我们的；一般客户、阶段写法都落暂不确认（不进备注、不提醒）；表外的照老规矩", () => {
    expect(客户类型对照).toEqual({
      终端客户: "专业运营商", 一般客户: "暂不确认", 经销商: "中间贸易商", 贸易商: "中间贸易商",
      代理: "国家代理商", 代理商: "国家代理商", "代理(采购商)": "国家代理商",
      意向客户: "暂不确认", 成交客户: "暂不确认", 新客户: "暂不确认",
    });
    expect([对客户类型(" 代理（采购商） "), 对客户类型("代理 (采购商)"), 对客户类型("个人买家"), 对客户类型(""), 对客户类型(null)])
      .toEqual(["国家代理商", "国家代理商", undefined, undefined, undefined]);
    expect([客户类型等级(" 意向客户 "), 客户类型等级("成交客户"), 客户类型等级(undefined)]).toEqual(["B", undefined, undefined]);

    const 原值们 = ["终端客户", "一般客户", "经销商", "贸易商", "代理", "代理商", "代理（采购商）", "意向客户", "成交客户", "新客户", "个人买家", "批发", ""];
    const { 待写, 问题 } = 清洗(
      原值们.map((类型, i) => 条("customer", { 外部: `t${i}`, 名称: `示例公司${i}`, 电话: `1380000${String(2000 + i)}`, 负责人: "张伟", 类型 })),
      映射样(),
      { ...空索引(), 客户类型: ["个人买家", "中间贸易商", "国家代理商", "专业运营商", "暂不确认"] },
    );
    expect(待写.map((w) => w.值.customerType ?? null)).toEqual([
      "专业运营商", "暂不确认", "中间贸易商", "中间贸易商", "国家代理商", "国家代理商", "国家代理商", "暂不确认", "暂不确认", "暂不确认", "个人买家", null, "暂不确认",
    ]);
    for (const i of [1, 7, 8, 9, 12]) expect(String(待写[i].值.remark ?? "")).not.toContain("客户类型");
    expect(String(待写[11].值.remark)).toContain("客户类型：批发");
    expect(问题.filter((p) => p.说明.includes("客户类型")).map((p) => p.外部ID)).toEqual(["t11"]);
    // 只有意向客户顺带补 B 级；别的（一般客户、成交客户、空着）级别照旧空着
    expect(待写.map((w) => w.值.level ?? null)).toEqual(原值们.map((x) => (x === "意向客户" ? "B" : null)));
  });

  it("客户类型空着 / 意向客户：暂不确认被停用了就不落也不提醒；级别那格给了的照给的，不被意向客户的 B 盖掉", () => {
    const 映 = 映射样();
    (映.列 as Record<string, Record<string, string>>).customer.级别 = "level";
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "e1", 名称: "示例甲", 电话: "13800003001", 负责人: "张伟", 类型: "" }),
        条("customer", { 外部: "e2", 名称: "示例乙", 电话: "13800003002", 负责人: "张伟", 类型: "意向客户", 级别: "A级" }),
        条("customer", { 外部: "e3", 名称: "示例丙", 电话: "13800003003", 负责人: "张伟", 类型: "意向客户", 级别: "" }),
        条("customer", { 外部: "e4", 名称: "示例丁", 电话: "13800003004", 负责人: "张伟", 类型: "一般客户" }),
      ],
      映,
      { ...空索引(), 客户类型: ["个人买家"] },
    );
    for (const w of 待写) expect("customerType" in w.值).toBe(false);
    for (const w of 待写) expect(String(w.值.remark ?? "")).not.toContain("客户类型");
    expect(问题.filter((p) => p.说明.includes("客户类型"))).toEqual([]);
    expect(待写.map((w) => w.值.level ?? null)).toEqual([null, "A", "B", null]);
  });

  it("同号并成一条：暂不确认当空的看，后一条有真类型就换上；后一条是暂不确认的不进备注", () => {
    const 索引 = { ...空索引(), 客户类型: ["个人买家", "中间贸易商", "暂不确认"] };
    const { 待写 } = 清洗(
      [
        条("customer", { 外部: "m1", 名称: "示例甲", 电话: "13800004001", 负责人: "张伟", 类型: "" }),
        条("customer", { 外部: "m2", 名称: "示例甲", 电话: "13800004001", 负责人: "张伟", 类型: "个人买家" }),
        条("customer", { 外部: "m3", 名称: "示例乙", 电话: "13800004002", 负责人: "张伟", 类型: "贸易商" }),
        条("customer", { 外部: "m4", 名称: "示例乙", 电话: "13800004002", 负责人: "张伟", 类型: "意向客户" }),
      ],
      映射样(),
      索引,
    );
    const 甲 = 待写.find((w) => w.外部ID === "m1")!;
    const 乙 = 待写.find((w) => w.外部ID === "m3")!;
    expect(甲.值.customerType).toBe("个人买家");
    expect(String(甲.值.remark ?? "")).not.toContain("客户类型");
    expect(乙.值.customerType).toBe("中间贸易商");
    expect(String(乙.值.remark ?? "")).not.toContain("客户类型");
  });

  it("客户类型对照到的那一项被停用了：照老规矩，原值进备注", () => {
    const { 待写 } = 清洗([条("customer", { 外部: "c1", 名称: "示例公司", 电话: "13800000009", 负责人: "张伟", 类型: "终端客户" })], 映射样(), { ...空索引(), 客户类型: ["个人买家"] });
    expect("customerType" in 待写[0].值).toBe(false);
    expect(待写[0].值.remark).toContain("客户类型：终端客户");
  });

  it("联系人号码：本批前后撞、和我们这边已有的撞都提醒「号码重复」，照写不并", () => {
    const 已有 = new Map<string, 已有联系人[]>([["email|old@x.com", [{ id: "ct1", name: "老王", customerId: "cu1", customerName: "老客户" }]]]);
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "c1", 名称: "甲公司", 电话: "13800000001", 负责人: "张伟" }),
        条("contact", { 外部: "p1", 客户ID: "c1", 姓名: "张三", 手机: "139 0000 0001" }),
        条("contact", { 外部: "p2", 客户ID: "c1", 姓名: "李四", 手机: "+8613900000001", 邮箱: "OLD@x.com" }),
      ],
      映射样(),
      { ...空索引(), 联系人号: 已有 },
    );
    expect(待写.filter((w) => w.实体 === "contact")).toHaveLength(2);
    const 重 = 问题.filter((p) => p.类别 === "号码重复");
    expect(重.map((p) => p.外部ID)).toEqual(["p2", "p2"]);
    expect(重.find((p) => p.说明.includes("老王"))?.链接).toEqual([{ 名: "老王（老客户）", 客户Id: "cu1" }]);
  });

  it("读本地索引：联系人老三格 + 子表的号都进索引，同一位只记一次", async () => {
    const 甲 = await 新建id();
    const 人 = await 建联系人(甲, "周九", [{ kind: "phone", value: "13900000041" }, { kind: "email", value: "Zhou@X.com" }]);
    const 索引 = await 读本地索引("excel");
    expect(索引.联系人号?.get("phone|13900000041")).toEqual([{ id: 人, name: "周九", customerId: 甲, customerName: expect.any(String) }]);
    expect(索引.联系人号?.get("email|zhou@x.com")).toHaveLength(1);
    expect(索引.客户类型).toEqual(["个人买家", "中间贸易商", "国家代理商", "专业运营商", "暂不确认"]);
  });
});
