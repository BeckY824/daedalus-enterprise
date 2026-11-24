/**
 * 首页 AI 新线索卡的联系方式能选类型、联系人姓名选填（11-17 员工反馈：市场录入时客户名称、联系人姓名不一定知道；只能填电话，加不了别的联系方式）。
 *
 *   类型：号码类型字典默认八项（V-号码类型，顺序同取值表），工具参数的枚举也是这八项
 *   卡：可多条；模型给了号码类型名、kind 都认，认不出当场拒；空号丢掉；新老格一起给了不丢
 *   只给微信号：号码、微信号、邮箱不进客户名称 / 联系人姓名（P-抬头-13）
 *   必填：联系人姓名不再必填；联系方式全空才拦（M-必填-01，任一类型）
 *   确认后：每一行按类型记进联系人的联系方式子表（和手工加联系人一样的 kind / numberKey），手机 / 邮箱 / 微信 / 阿里国际站ID 照旧全公司查重；
 *          只有座机也能建（客户电话空着）；节点必填「联系方式」认联系人的座机
 *   老卡：只有 phone 那几格的照常确认，电话当手机
 *   联系人姓名没填：存空串（显示「—」）；节点必填「主联系人」看挂没挂 + 这位有没有至少一条联系方式，不看名字
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 查重提示 } from "@/lib/enterprise/contact-format";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { buildProposal, missingFields, 线索号码种类, 线索号码行, 是号码当名字, 线索号码说明, type Proposal } from "@/lib/agent/proposals";
import { SCHEMAS } from "@/lib/agent/schemas";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 读必填数据 } from "@/lib/project/db";
import { 还差 } from "@/lib/project/required";

type 人 = { id: string; name: string };
let 甲: 人, 乙: 人;
const 造人 = async (email: string, name: string, role = "SALES"): Promise<人> => {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name };
};
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };
let 序 = 0;
const 卡 = (补: Record<string, unknown> = {}) => ({
  id: `t${++序}`, kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
  name: "测试科技", contact: "", phone: "", source: "展会", status: "待跟进", remark: "",
  分配方式: 4, 业务线: "内贸", 节点: "潜客培育", ...补,
});
const 企建档 = { 只用项目: true, 要下一步: false, 企业: { 有分配方式: true, 节点们: ["潜客培育", "线索验证"] } } as const;
const 建 = (args: Record<string, unknown>) => buildProposal("x", "add_lead", { id: "", name: "" }, { reason: "测试", ...args }, DEFAULT_BUSINESS);
const 收 = (args: Record<string, unknown>) => {
  const r = 建(args);
  if (!r.ok) throw new Error(r.error);
  return r.proposal as Extract<Proposal, { kind: "add_lead" }>;
};
const 联系人号 = async () => {
  const c = await prisma.contact.findFirstOrThrow({ include: { contactMethods: { orderBy: { createdAt: "asc" } } } });
  return { c, 行们: c.contactMethods.map((m) => [m.kind, m.value, m.numberKey]) };
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true });
  甲 = await 造人("jia", "小甲");
  乙 = await 造人("yi", "小乙");
  const 老板 = await 造人("boss", "老板", "ADMIN");
  await prisma.channel.create({ data: { name: "展会", channelOwnerId: 老板.id } });
  await prisma.entMember.createMany({ data: [{ userId: 甲.id, bizRole: "sales" }, { userId: 乙.id, bizRole: "sales" }, { userId: 老板.id, bizRole: "director" }] });
});

describe("类型：号码类型字典默认八项", () => {
  it("顺序同取值表；工具参数的枚举也是这八项", () => {
    const 八种 = ["手机", "座机", "微信", "邮箱", "WhatsApp", "阿里国际站ID", "传真", "Telegram"];
    expect(线索号码种类.map((x) => x.名)).toEqual(八种);
    expect(线索号码种类.map((x) => x.kind)).toEqual(["phone", "landline", "wechat", "email", "whatsapp", "wangwang", "fax", "telegram"]);
    const numbers = SCHEMAS.propose_lead.properties.numbers as { items: { properties: { type: { enum: string[] } } } };
    expect(numbers.items.properties.type.enum).toEqual(八种);
    // 老的电话 / 微信 / 邮箱 / WhatsApp 格不再给模型（不然两处都填、对不上）
    for (const k of ["phone", "wechat", "email", "whatsapp"]) expect(SCHEMAS.propose_lead.properties).not.toHaveProperty(k);
    expect(线索号码说明).toContain("判断不了就先问");
    expect(线索号码说明).toContain("不要填进 name");
  });
});

describe("卡：收联系方式", () => {
  it("模型给类型名、卡片回传 kind 都认；多条；空号丢掉", () => {
    const p = 收({ name: "", numbers: [{ type: "微信", value: "wx_test01" }, { type: "座机", value: "021-5555 0101" }, { type: "邮箱", value: "" }, { type: "WhatsApp", value: "+44 7700 900101" }] });
    expect(p.联系方式).toEqual([{ kind: "wechat", value: "wx_test01" }, { kind: "landline", value: "021-5555 0101" }, { kind: "whatsapp", value: "+44 7700 900101" }]);
    expect(收({ 联系方式: [{ kind: "telegram", value: "@tg_test01" }, { kind: "fax", value: "021-5555 0102" }] }).联系方式).toEqual([{ kind: "telegram", value: "@tg_test01" }, { kind: "fax", value: "021-5555 0102" }]);
  });
  it("类型认不出：当场拒，说清能用哪几种", () => {
    const r = 建({ numbers: [{ type: "QQ", value: "10001" }] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("手机/座机/微信/邮箱/WhatsApp/阿里国际站ID/传真/Telegram");
  });
  it("新格和老格一起给了：老格多出来的并进来，不丢；最多 20 条", () => {
    expect(收({ phone: "13800000101", numbers: [{ type: "微信", value: "wx_test02" }] }).联系方式).toEqual([{ kind: "wechat", value: "wx_test02" }, { kind: "phone", value: "13800000101" }]);
    const 多 = Array.from({ length: 21 }, (_, i) => ({ type: "手机", value: `1380000${String(i).padStart(4, "0")}` }));
    expect(建({ numbers: 多 })).toEqual({ ok: false, error: "联系方式最多 20 个" });
  });
});

describe("只给了微信号：不进客户名称 / 联系人姓名（P-抬头-13）", () => {
  it("模型把微信号同时填进名称和联系人：收的时候当没填，号码留在联系方式里", () => {
    const p = 收({ name: "wx_Test03", contact: "WX_TEST03", numbers: [{ type: "微信", value: "wx_test03" }] });
    expect([p.name, p.contact]).toEqual(["", ""]);
    expect(p.联系方式).toEqual([{ kind: "wechat", value: "wx_test03" }]);
  });
  it("老卡把电话 / 邮箱填进名称也一样；正常的名字不动", () => {
    expect(收({ name: "138 0000 0102", phone: "13800000102" }).name).toBe("");
    expect(收({ name: "buyer@example.com" }).name).toBe("");
    expect(收({ name: "测试科技", contact: "周经理", numbers: [{ type: "微信", value: "wx_test04" }] })).toMatchObject({ name: "测试科技", contact: "周经理" });
    expect(是号码当名字("Alibaba", [{ kind: "wechat", value: "wx_other" }])).toBe(false);
  });
  it("人在卡上把号填回名称：卡上拦住", () => {
    const p = { ...收({ name: "测试科技" }), name: "wx_test05", 联系方式: [{ kind: "wechat", value: "wx_test05" }] };
    expect(missingFields(p, undefined, 企建档)).toContain("客户名称（不能填号码）");
  });
});

describe("必填：联系人姓名选填，联系方式任一类型", () => {
  it("联系人没填不拦；联系方式全空才拦；只有座机也算", () => {
    const 底 = { ...收({ name: "测试科技" }), 分配方式: 4, ownerId: "u", 业务线: "内贸", 节点: "潜客培育" };
    expect(missingFields(底, undefined, 企建档)).toEqual(["联系方式"]);
    expect(missingFields({ ...底, 联系方式: [{ kind: "phone", value: "  " }] }, undefined, 企建档)).toEqual(["联系方式"]);
    expect(missingFields({ ...底, 联系方式: [{ kind: "landline", value: "021-5555 0103" }] }, undefined, 企建档)).toEqual([]);
    // 老卡只有电话那一格也算
    expect(missingFields({ ...底, phone: "13800000103" }, undefined, 企建档)).toEqual([]);
  });
  it("确认时服务端同样拦：全空不建", async () => {
    当(甲);
    expect(await applyProposal(卡({ 联系方式: [] }) as never)).toEqual({ ok: false, error: "还差联系方式，填好再确认" });
    expect(await prisma.customer.count()).toBe(0);
  });
});

describe("确认后：按类型落库", () => {
  it("只给微信号、不填联系人：建成，微信记进联系人的联系方式，客户企业号码是这个微信；联系人姓名存空串（不拿客户名称顶、不写占位）", async () => {
    当(甲);
    expect(await applyProposal(卡({ 联系方式: [{ kind: "wechat", value: "wx_test06" }] }) as never)).toMatchObject({ ok: true });
    const { c, 行们 } = await 联系人号();
    expect(c).toMatchObject({ name: "", phone: null, wechat: "wx_test06" });
    expect(行们).toEqual([["wechat", "wx_test06", "wx_test06"]]);
    const 客 = await prisma.customer.findFirstOrThrow();
    expect(客.phone).toBe("");
  });

  it("多条、多类型：每行按类型存，和手工加联系人一样的 kind / numberKey；老三格取第一个手机 / 邮箱 / 微信", async () => {
    当(甲);
    const r = await applyProposal(卡({ contact: "周经理", 联系方式: [
      { kind: "landline", value: "021-5555 0104" }, { kind: "phone", value: "+86 138 0000 0104" }, { kind: "phone", value: "13800000105" },
      { kind: "email", value: "Buyer@Example.com" }, { kind: "whatsapp", value: "+44 7700 900104" }, { kind: "wangwang", value: "shop_test04" },
      { kind: "fax", value: "021-5555 0105" }, { kind: "telegram", value: "@TG_test04" },
    ] }) as never);
    expect(r).toMatchObject({ ok: true });
    const { c, 行们 } = await 联系人号();
    expect(c).toMatchObject({ name: "周经理", phone: "13800000104", email: "Buyer@Example.com", wechat: null });
    expect(new Set(行们.map((x) => JSON.stringify(x)))).toEqual(new Set([
      ["landline", "021-5555 0104", "02155550104"], ["phone", "13800000104", "13800000104"], ["phone", "13800000105", "13800000105"],
      ["email", "Buyer@Example.com", "buyer@example.com"], ["whatsapp", "+44 7700 900104", "447700900104"], ["wangwang", "shop_test04", "shop_test04"],
      ["fax", "021-5555 0105", "02155550105"], ["telegram", "@TG_test04", "tg_test04"],
    ].map((x) => JSON.stringify(x))));
    // 都挂在这位联系人身上（退回公海前查联系方式、教练打码都按联系人的这几行看）
    expect(await prisma.contactMethod.count({ where: { contactId: null } })).toBe(0);
    // 企业版客户没有电话（E-260）：客户电话存空串，号只在联系人上
    const 客 = await prisma.customer.findFirstOrThrow();
    expect(客.phone).toBe("");
  });

  it("只有座机：也能建（M-必填-01），客户电话空着；节点必填「联系方式」认联系人的座机", async () => {
    当(甲);
    expect(await applyProposal(卡({ 联系方式: [{ kind: "landline", value: "0755-5555 0106" }] }) as never)).toMatchObject({ ok: true });
    const { 行们 } = await 联系人号();
    expect(行们).toEqual([["landline", "0755-5555 0106", "075555550106"]]);
    const p = await prisma.project.findFirstOrThrow();
    expect((await prisma.customer.findFirstOrThrow()).phone).toBe("");
    const 数据 = await prisma.$transaction((tx) => 读必填数据(tx, p as never));
    // 主联系人：姓名空着也算挂好了（有座机）；同一位一个号都没有就不算
    expect((await prisma.contact.findFirstOrThrow()).name).toBe("");
    const 只要主联系人 = { 节点推进: { 开: true, 必填: { [p.node]: ["主联系人"] } } } as unknown as Parameters<typeof 还差>[0];
    expect(还差(只要主联系人, 数据)).toEqual([]);
    expect(还差(只要主联系人, { ...数据, 联系人们: 数据.联系人们.map((c) => ({ ...c, phone: null, email: null, wechat: null, contactMethods: [] })) })).toEqual(["主联系人"]);
    const 只要联系方式 = { 节点推进: { 开: true, 必填: { [p.node]: ["联系方式"] } } } as unknown as Parameters<typeof 还差>[0];
    expect(还差(只要联系方式, 数据)).toEqual([]);
    // 对照：联系人一个号都没有就差
    expect(还差(只要联系方式, { ...数据, 联系人们: 数据.联系人们.map((c) => ({ ...c, contactMethods: [] })) })).toEqual(["联系方式"]);
  });

  it("格式不对：照联系人表单的提示拦，不建", async () => {
    当(甲);
    const r = await applyProposal(卡({ 联系方式: [{ kind: "wechat", value: "1x" }] }) as never);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("微信");
    expect(await prisma.customer.count()).toBe(0);
  });

  it("手机 / 微信照旧全公司查重：第二位录同一个微信被拦；座机 11-17 起也全公司查重、同一个座机被拦", async () => {
    当(甲);
    expect(await applyProposal(卡({ name: "老客户", 联系方式: [{ kind: "wechat", value: "wx_test07" }, { kind: "landline", value: "021-5555 0107" }] }) as never)).toMatchObject({ ok: true });
    当(乙);
    expect(await applyProposal(卡({ 联系方式: [{ kind: "wechat", value: "WX_test07" }] }) as never)).toEqual({ ok: false, error: 查重提示.AI建档重复("小甲") });
    expect(await applyProposal(卡({ name: "另一家", 联系方式: [{ kind: "landline", value: "021-5555 0107" }] }) as never)).toMatchObject({ ok: false });
    expect(await applyProposal(卡({ name: "另一家", 联系方式: [{ kind: "landline", value: "021-5555 0199" }] }) as never)).toMatchObject({ ok: true });
  });
});

describe("老卡（只有 phone 那几格）照常确认", () => {
  it("电话当手机；微信、WhatsApp 各自那一类", async () => {
    当(甲);
    const 老 = 卡({ contact: "周经理", phone: "13800000108", wechat: "wx_test08", whatsapp: "+1 416 555 0108" });
    expect(线索号码行(老)).toEqual([{ kind: "phone", value: "13800000108" }, { kind: "wechat", value: "wx_test08" }, { kind: "whatsapp", value: "+1 416 555 0108" }]);
    expect(await applyProposal(老 as never)).toMatchObject({ ok: true });
    const { c, 行们 } = await 联系人号();
    expect(c).toMatchObject({ phone: "13800000108", wechat: "wx_test08" });
    expect(行们.map((x) => x[0]).sort()).toEqual(["phone", "wechat", "whatsapp"]);
    // 企业版客户没有电话（E-260）：客户电话存空串，号只在联系人上
    expect((await prisma.customer.findFirstOrThrow()).phone).toBe("");
  });
});
