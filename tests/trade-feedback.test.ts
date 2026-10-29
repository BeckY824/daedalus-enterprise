/**
 * 外贸客户的建议（2026-10-05，并进 0.46.15）。规划：~/CRM/外贸客户建议-并进0.46.15-规划-2026-10-05.md
 *   - 订单就是一笔签约：外贸模版下「签约」叫「订单」（订单表 2026-10-29 删了，迁移 066，只剩签约本身）
 *   - 商机转为订单：联动只赢这一单
 *   - 客户的外贸档案：国家 / WhatsApp / 微信 / 邮箱 / 来源；线索转客户带来源和邮箱；搜索搜得到联系人
 *   - 导入认这几列，补空只补空的、撤销还原；导出 xlsx 两张表，第一张能原样导回
 *   - 询盘时间 = 商机 createdAt，能改、不许晚于今天
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, requireAdmin: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { BUSINESS_PRESETS, DEFAULT_BUSINESS, 外贸订单, 签约叫, 外贸精简 } from "@/lib/business-config";
import { saveContract, deleteContract, patchCustomer, saveCustomer } from "@/app/(app)/customers/actions";
import { TOOLS } from "@/lib/agent/tools";
import { 文字里号码打码 } from "@/lib/utils";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { saveOpportunity, setOppStatus } from "@/app/(app)/opportunities/actions";
import { 补来源 } from "@/lib/customer-extra-db";
import { saveBusinessSettings } from "@/app/(app)/settings/actions";
import { getBusiness } from "@/lib/business";
import { 改过的档案 } from "@/lib/customer-extra";
import { convertLead } from "@/app/(app)/leads/actions";
import { 执行导入, 撤销批次 } from "@/app/(app)/customers/import-actions";
import { 导出客户 } from "@/app/(app)/customers/export-action";
import { 客户导出表, 跟进导出表 } from "@/app/(app)/customers/export-table";
import { 客户筛选条件 } from "@/app/(app)/customers/query";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { 写xlsx, 列字母 } from "@/lib/xlsx-write";
import { 读xlsx } from "@/lib/import/xlsx";
import { 认国家, 规整外贸格, WhatsApp网址 } from "@/lib/customer-extra";
import { 限定条件 } from "@/lib/team-scope";
import { 订单 } from "@/lib/features";
import { unzipSync, strFromU8 } from "fflate";

let jia: { id: string };

async function 外贸() {
  await setSetting("business", BUSINESS_PRESETS["外贸出口"]);
  invalidateSettingsCache();
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  jia = await prisma.user.create({ data: { email: "jia", name: "甲", title: "销售", role: "ADMIN", password: "x" } });
  mocks.user = { id: jia.id, name: "甲", email: "jia", role: "ADMIN", title: "管理员", avatar: null };
});
afterAll(async () => { await prisma.$disconnect(); });

async function 客户(name = "Timur") {
  return prisma.customer.create({ data: { name, phone: "998901234567", salesOwnerId: jia.id, followStatus: "意向较高" } });
}

describe("开关和叫法", () => {
  it("订单打开；外贸模版下签约叫订单，通用照旧", () => {
    expect(订单).toBe(true);
    expect(外贸订单(BUSINESS_PRESETS["外贸出口"])).toBe(true);
    expect(签约叫(BUSINESS_PRESETS["外贸出口"])).toBe("订单");
    expect(签约叫(DEFAULT_BUSINESS)).toBe("签约");
    expect(外贸精简(DEFAULT_BUSINESS)).toBe(false);
    expect(BUSINESS_PRESETS["外贸出口"].statusLabels["已签约"]).toBe("已下单");
  });
});

describe("外贸下签约就是一笔签约（订单表 2026-10-29 删了，迁移 066）", () => {
  it("外贸模版登记签约：只建签约、推客户状态，日志说的是订单", async () => {
    await 外贸();
    const c = await 客户();
    const r = await saveContract({ customerId: c.id, amount: 3250.5, currency: "USD", signedAt: new Date(2026, 9, 5), remark: "FOB 上海" });
    expect(r.ok).toBe(true);
    const k = await prisma.contract.findFirstOrThrow({ include: { money: true } });
    expect(k.money?.amountExact).toBe(3250.5);
    // 客户推到已签约（外贸显示「已下单」），业绩照签约算
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).followStatus).toBe("已签约");
    expect((await prisma.auditLog.findMany({ where: { entity: "Contract" } })).every((x) => x.summary.includes("订单"))).toBe(true);
  });

  it("商机转为订单：联动只勾这一单，商机赢单", async () => {
    await 外贸();
    const c = await 客户();
    const o = await prisma.opportunity.create({ data: { name: "Chicken breast IQF", customerId: c.id, amount: 28000, stage: "方案报价", probability: 60, ownerId: jia.id } });
    const r = await saveContract({ customerId: c.id, amount: 28000, currency: "USD", signedAt: new Date(), remark: null, 联动: { 赢单: [o.id], 完成计划: [], 完成待办: [] } });
    expect(r.ok).toBe(true);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("WON");
    expect(await prisma.contractWin.count({ where: { opportunityId: o.id } })).toBe(1);
  });

  it("别人家的商机 id 从浏览器塞进来：不挂", async () => {
    await 外贸();
    const c = await 客户();
    const 别人 = await 客户("别人");
    const o = await prisma.opportunity.create({ data: { name: "别人的单", customerId: 别人.id, amount: 1, ownerId: jia.id } });
    await saveContract({ customerId: c.id, amount: 10, currency: "USD", signedAt: new Date(), remark: null, 联动: { 赢单: [o.id], 完成计划: [], 完成待办: [] } });
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("OPEN");
  });
});

describe("客户的外贸档案", () => {
  it("规整：国家认别名、邮箱 / WhatsApp 格式、wa.me 链接", () => {
    expect(认国家("UAE")).toBe("阿联酋");
    expect(认国家("uzbekistan")).toBe("乌兹别克斯坦");
    expect(认国家("火星")).toBe("火星");
    expect(规整外贸格("email", "a@b")).toMatchObject({ ok: false });
    expect(规整外贸格("email", " buyer@acme.com ")).toEqual({ ok: true, v: "buyer@acme.com" });
    expect(规整外贸格("whatsapp", "+998 90 123")).toMatchObject({ ok: true });
    expect(规整外贸格("whatsapp", "abc")).toMatchObject({ ok: false });
    expect(WhatsApp网址("+971 (50) 123-4567")).toBe("https://wa.me/971501234567");
    expect(WhatsApp网址("12")).toBeNull();
    expect(WhatsApp网址("+86****1111")).toBeNull();
  });

  it("新建客户带档案；编辑只改动了的那几格、留一条痕；全清空留一行空的（不删，免得同步时插入冲掉同事的）", async () => {
    await 外贸();
    const base = { name: "Beka", phone: "995555123456", school: "Daily Retail LLC", grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, channelId: null, referrerCustomerId: null };
    const r = await saveCustomer({ ...base, extra: { country: "Georgia", whatsapp: "+995 555 123 456", email: "beka@retail.ge", wechat: null, source: "展会" } });
    if (!r.ok) throw new Error(r.error);
    expect(await prisma.customerExtra.findUniqueOrThrow({ where: { customerId: r.id } })).toMatchObject({ country: "格鲁吉亚", source: "展会", wechat: null });
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: r.id } });
    const r2 = await saveCustomer({ ...base, id: r.id, updatedAt: c.updatedAt.toISOString(), extra: { country: "格鲁吉亚", whatsapp: "+995 555 123 456", email: "new@retail.ge", wechat: null, source: "展会" } });
    expect(r2.ok).toBe(true);
    const 痕 = await prisma.auditLog.findMany({ where: { summary: { contains: "邮箱" } } });
    expect(痕).toHaveLength(1);
    expect(痕[0].summary).not.toContain("国家");
    // 共享区打了码的 WhatsApp 交回来：不碰
    const c2 = await prisma.customer.findUniqueOrThrow({ where: { id: r.id } });
    await saveCustomer({ ...base, id: r.id, updatedAt: c2.updatedAt.toISOString(), extra: { whatsapp: "+995****456" } });
    expect((await prisma.customerExtra.findUniqueOrThrow({ where: { customerId: r.id } })).whatsapp).toBe("+995 555 123 456");
    // 坏邮箱：拦下、说清
    const 坏 = await saveCustomer({ ...base, id: r.id, updatedAt: c2.updatedAt.toISOString(), extra: { email: "nope" } });
    expect(坏).toMatchObject({ ok: false, error: "邮箱格式不对" });
    for (const k of ["country", "whatsapp", "email", "source"] as const) expect((await patchCustomer(r.id, k, null)).ok).toBe(true);
    expect(await prisma.customerExtra.findUniqueOrThrow({ where: { customerId: r.id } })).toMatchObject({ country: null, whatsapp: null, email: null, source: null });
  });

  it("记录页单格改：国家写成统一叫法；邮箱不合格式拦下", async () => {
    await 外贸();
    const c = await 客户();
    expect((await patchCustomer(c.id, "country", "USA")).ok).toBe(true);
    expect((await prisma.customerExtra.findUniqueOrThrow({ where: { customerId: c.id } })).country).toBe("美国");
    expect(await patchCustomer(c.id, "email", "x@")).toMatchObject({ ok: false });
  });

  it("线索转客户（外贸）：来源、邮箱进档案，不再写进备注", async () => {
    await 外贸();
    const l = await prisma.lead.create({ data: { name: "Acme Trading", contact: "John", phone: "+1 415 555 0101", email: "john@acme.com", source: "阿里国际站", ownerId: jia.id } });
    const r = await convertLead(l.id);
    if (!r.ok) throw new Error(r.error);
    const x = await prisma.customerExtra.findUniqueOrThrow({ where: { customerId: r.customerId } });
    expect(x).toMatchObject({ source: "阿里国际站", email: "john@acme.com" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: r.customerId } })).remark ?? "").not.toContain("线索来源");
  });

  it("客户搜索搜得到联系人和档案；按国家 / 来源筛", async () => {
    await 外贸();
    const c = await 客户("Acme");
    await prisma.contact.create({ data: { customerId: c.id, name: "Mohammed Ali", email: "mo@acme.ae" } });
    await patchCustomer(c.id, "country", "阿联酋");
    await patchCustomer(c.id, "source", "展会");
    await 客户("别人");
    const 找 = async (sp: Parameters<typeof 客户筛选条件>[0]) => (await prisma.customer.findMany({ where: await 客户筛选条件(sp), select: { name: true } })).map((x) => x.name);
    expect(await 找({ keyword: "Mohammed" })).toEqual(["Acme"]);
    expect(await 找({ keyword: "mo@acme" })).toEqual(["Acme"]);
    expect(await 找({ country: "阿联酋" })).toEqual(["Acme"]);
    expect(await 找({ source: "展会" })).toEqual(["Acme"]);
    expect(await 找({ country: "美国" })).toEqual([]);
  });
});

describe("询盘时间", () => {
  it("改得了（补录老询盘），不许晚于今天", async () => {
    await 外贸();
    const c = await 客户();
    const 三月 = new Date(2026, 2, 12, 10);
    const r = await saveOpportunity({ name: "鸡胸", customerId: c.id, amount: 0, stage: "初步沟通", status: "OPEN", probability: 20, 询盘时间: 三月.toISOString() });
    expect(r.ok).toBe(true);
    expect((await prisma.opportunity.findFirstOrThrow()).createdAt.getTime()).toBe(三月.getTime());
    const 明年 = new Date();
    明年.setFullYear(明年.getFullYear() + 1);
    expect(await saveOpportunity({ name: "x", customerId: c.id, amount: 0, stage: "初步沟通", status: "OPEN", probability: 20, 询盘时间: 明年.toISOString() })).toMatchObject({ ok: false, error: "询盘时间不能晚于今天" });
  });
});

describe("导入认外贸那几列", () => {
  const 表头 = ["客户名称", "联系电话", "公司", "国家", "WhatsApp", "邮箱", "来源", "微信号"];
  it("外贸模版猜列：来源落来源格（不对渠道）；通用模版不认这几列", async () => {
    await 外贸();
    const 外 = 猜列(表头, 字段表(BUSINESS_PRESETS["外贸出口"]));
    expect(外).toEqual(["name", "phone", "school", "country", "whatsapp", "email", "source", "wechat"]);
    const 通 = 猜列(表头, 字段表(DEFAULT_BUSINESS));
    expect(通.slice(3)).toEqual([null, null, null, "channelName", null]);
  });

  it("新建写档案；补空只补空着的格；整批撤销还原", async () => {
    await 外贸();
    const 映射 = 猜列(表头, 字段表(BUSINESS_PRESETS["外贸出口"]));
    const w = await 执行导入({ 表头, 数据: [["Timur", "+998 90 123 4567", "Technical Business LLC", "Uzbekistan", "+998 90 123 4567", "坏邮箱", "展会", ""]], 映射, 重复行: "跳过" }, "xiaoman.xlsx");
    if (!w.ok) throw new Error(w.error);
    expect(w.新建).toBe(1);
    const c = await prisma.customer.findFirstOrThrow({ include: { extra: true } });
    expect(c.extra).toMatchObject({ country: "乌兹别克斯坦", whatsapp: "+998 90 123 4567", email: null, source: "展会" });
    // 坏邮箱没落进邮箱格，原文并进备注
    expect(c.remark).toContain("坏邮箱");

    // 第二份表补空：国家已有不动，邮箱空着才补
    const w2 = await 执行导入({ 表头, 数据: [["Timur", "+998 90 123 4567", "", "Kazakhstan", "", "timur@tb.uz", "", "timur_wx"]], 映射, 重复行: "补空" }, "补.xlsx");
    if (!w2.ok) throw new Error(w2.error);
    expect(w2.补空).toBe(1);
    expect(await prisma.customerExtra.findFirstOrThrow()).toMatchObject({ country: "乌兹别克斯坦", email: "timur@tb.uz", wechat: "timur_wx" });
    const u = await 撤销批次(w2.batchId);
    expect(u.ok).toBe(true);
    expect(await prisma.customerExtra.findFirstOrThrow()).toMatchObject({ country: "乌兹别克斯坦", email: null, wechat: null });
  });
});

describe("导出：xlsx 两张表，带跟进记录", () => {
  it("写出来的 xlsx 读得回来（第一张表），表名、表头加粗、冻结首行、列字母", () => {
    expect([0, 25, 26, 701, 702].map(列字母)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    const 字节 = 写xlsx([
      { 名: "客户", 表头: ["客户姓名", "联系电话", "备注"], 行: [["张三", "+86 138", "=1+1 & <b>"], ["李四", "0138", ""]] },
      { 名: "跟进记录", 表头: ["客户姓名", "内容"], 行: [["张三", "第一次\n第二行"]] },
    ]);
    expect(读xlsx(字节)).toEqual([["客户姓名", "联系电话", "备注"], ["张三", "+86 138", "=1+1 & <b>"], ["李四", "0138"]]);
    const 文件 = unzipSync(字节);
    const wb = strFromU8(文件["xl/workbook.xml"]);
    expect(wb).toContain('name="客户"');
    expect(wb).toContain('name="跟进记录"');
    expect(strFromU8(文件["xl/worksheets/sheet1.xml"])).toContain('state="frozen"');
  });

  it("导出客户带上这些客户的跟进，按客户、再按时间先后；挂商机的写商机名", async () => {
    await 外贸();
    const a = await 客户("A");
    const b2 = await 客户("B");
    // 两位同一毫秒建出来时列表顺序不定：把 A 的建档时间往前挪，列表（新的在前）就是 B、A
    await prisma.customer.update({ where: { id: a.id }, data: { createdAt: new Date(2026, 0, 1) } });
    const opp = await prisma.opportunity.create({ data: { name: "庭院灯", customerId: a.id, amount: 10, ownerId: jia.id } });
    await saveFollowUp({ customerId: a.id, type: "PHONE", content: "第二次", status: "已完成", occurredAt: new Date(2026, 9, 2).toISOString(), opportunityId: opp.id });
    await saveFollowUp({ customerId: a.id, type: "PHONE", content: "第一次", status: "已完成", occurredAt: new Date(2026, 9, 1).toISOString() });
    await saveFollowUp({ customerId: b2.id, type: "EMAIL", content: "B 的", status: "已完成", occurredAt: new Date(2026, 8, 1).toISOString() });
    await patchCustomer(a.id, "country", "美国");
    const 出 = await 导出客户({});
    if (!出.ok) throw new Error(出.error);
    const b = { ...BUSINESS_PRESETS["外贸出口"] };
    const 客 = 客户导出表(出.rows, b);
    expect(客.head).toContain("国家");
    expect(客.head).not.toContain("推荐人");
    expect(客.head).toContain("订单金额");
    expect(客.body.find((x) => x[0] === "A")?.[客.head.indexOf("国家")]).toBe("美国");
    const 跟 = 跟进导出表(出.跟进, b);
    // 客户顺序同列表（新建的在前：B、A），每位里按时间先后
    expect(跟.body.map((x) => x[5])).toEqual(["B 的", "第一次", "第二次"]);
    expect(跟.body[2][7]).toBe("庭院灯");
    expect(跟.head[7]).toBe("关联商机");
  });

  it("外贸导出的第一张表原样导回来：国家、WhatsApp、邮箱、来源各落各的格，不进备注", async () => {
    await 外贸();
    const c = await 客户("Round");
    for (const [k, v] of [["country", "日本"], ["whatsapp", "+81 90 1234 5678"], ["email", "r@x.jp"], ["source", "独立站询盘"]] as const) await patchCustomer(c.id, k, v);
    const 出 = await 导出客户({});
    if (!出.ok) throw new Error(出.error);
    const t = 客户导出表(出.rows, BUSINESS_PRESETS["外贸出口"]);
    await prisma.customer.deleteMany();
    const w = await 执行导入({ 表头: t.head, 数据: t.body, 映射: 猜列(t.head, 字段表(BUSINESS_PRESETS["外贸出口"])), 重复行: "跳过" }, "导出的.xlsx");
    if (!w.ok) throw new Error(w.error);
    const 回 = await prisma.customer.findFirstOrThrow({ include: { extra: true } });
    expect(回.extra).toMatchObject({ country: "日本", whatsapp: "+81 90 1234 5678", email: "r@x.jp", source: "独立站询盘" });
    expect(回.remark ?? "").not.toContain("日本");
  });
});

describe("团队版：业务员只看自己的外贸档案", () => {
  it("CustomerExtra 按客户限定", () => {
    expect(限定条件("CustomerExtra", "u1")).toMatchObject({ customer: { OR: expect.any(Array) } });
  });
});

describe("复查一轮（10-06）", () => {
  it("G.3 外贸下 AI 拿到的状态是这家的叫法：find_person 说「已下单」不说「已签约」；list_opportunities 说「已转订单」、不给概率", async () => {
    await 外贸();
    const c = await 客户("Ahmed");
    await prisma.customer.update({ where: { id: c.id }, data: { followStatus: "已签约" } });
    await prisma.opportunity.create({ data: { name: "P4 屏", customerId: c.id, amount: 100, stage: "赢单成交", status: "WON", probability: 100, ownerId: jia.id } });
    const ctx = { userId: jia.id, userName: "甲", b: BUSINESS_PRESETS["外贸出口"], recordOffset: 0, proposals: [] };
    const 找 = JSON.stringify((await TOOLS.find((t) => t.name === "find_person")!.run({ name: "Ahmed" }, ctx as never)).data);
    expect(找).toContain("已下单");
    expect(找).not.toContain("已签约");
    const 商机 = JSON.stringify((await TOOLS.find((t) => t.name === "list_opportunities")!.run({ status: "WON" }, ctx as never)).data);
    expect(商机).toContain("已转订单");
    expect(商机).not.toContain("赢单\"");
    expect(商机).not.toContain("成交概率");
    await prisma.opportunity.create({ data: { name: "租赁屏", customerId: c.id, amount: 50, stage: "初步沟通", status: "OPEN", probability: 10, ownerId: jia.id } });
    const 读 = JSON.stringify((await TOOLS.find((t) => t.name === "get_customer")!.run({ id: c.id }, ctx as never)).data);
    expect(读).toContain("租赁屏");
    expect(读, "外贸的阶段叫询盘").toContain("询盘");
    expect(读).not.toContain("初步沟通");
    expect(读).not.toMatch(/\bWON\b/);
    const 数 = await TOOLS.find((t) => t.name === "query_metric")!.run({ metric: "contract_count", groupBy: null, from: null, to: null }, ctx as never);
    expect(数.summary).toContain("订单单数");
    expect(JSON.stringify(数.data)).not.toContain("签约");
  });

  it("撤销导入：人后来手改过档案的那位不动", async () => {
    await 外贸();
    const 表头 = ["客户名称", "联系电话", "国家"];
    const w = await 执行导入({ 表头, 数据: [["Tim", "+998 90 000 1111", "UAE"]], 映射: 猜列(表头, 字段表(BUSINESS_PRESETS["外贸出口"])), 重复行: "跳过" }, "a.xlsx");
    if (!w.ok) throw new Error(w.error);
    const c = await prisma.customer.findFirstOrThrow();
    await new Promise((r) => setTimeout(r, 5));
    await patchCustomer(c.id, "whatsapp", "+998 90 000 1111");
    const u = await 撤销批次(w.batchId);
    if (!u.ok) throw new Error(u.error);
    expect(u.删掉).toBe(0);
    expect(await prisma.customerExtra.findUniqueOrThrow({ where: { customerId: c.id } })).toMatchObject({ country: "阿联酋", whatsapp: "+998 90 000 1111" });
  });

  it("操作日志里「WhatsApp」那一格照电话打码", () => {
    const 打 = 文字里号码打码(JSON.stringify([{ 字段: "WhatsApp", 原值: "（空）", 新值: "971501234567" }]));
    expect(打).not.toContain("971501234567");
  });

  it("xlsx 表名：不分大小写去重、去掉首尾单引号", () => {
    const 包 = unzipSync(写xlsx([{ 名: "Sheet", 表头: ["a"], 行: [] }, { 名: "sheet", 表头: ["a"], 行: [] }, { 名: "'引号'", 表头: ["a"], 行: [] }]));
    const wb = strFromU8(包["xl/workbook.xml"]);
    expect(wb).toContain('name="Sheet"');
    expect(wb).toContain('name="sheet 2"');
    expect(wb).toContain('name="引号"');
  });
});

describe("二审（10-06）", () => {
  it("转过订单的商机（签约联动赢下的）不许直接改回进行中 / 丢单；删了那笔签约就退回进行中", async () => {
    await 外贸();
    const c = await 客户();
    const o = await prisma.opportunity.create({ data: { name: "鸡胸", customerId: c.id, amount: 10, ownerId: jia.id } });
    await saveContract({ customerId: c.id, amount: 10, currency: "USD", signedAt: new Date(), remark: null, 联动: { 赢单: [o.id], 完成计划: [], 完成待办: [] } });
    expect(await setOppStatus(o.id, "OPEN")).toMatchObject({ ok: false, error: expect.stringContaining("已经转成订单") });
    expect(await saveOpportunity({ id: o.id, name: "鸡胸", customerId: c.id, amount: 10, stage: "谈判审核", status: "LOST", probability: 0 })).toMatchObject({ ok: false });
    const k = await prisma.contract.findFirstOrThrow();
    expect((await deleteContract(k.id, c.id, null)).ok).toBe(true);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("OPEN");
  });

  it("切到外贸：给来源空着的老客户从线索 / 渠道补一次来源，已有的不动", async () => {
    const ch = await prisma.channel.create({ data: { name: "广交会", channelOwnerId: jia.id } });
    const a = await prisma.customer.create({ data: { name: "渠道来的", phone: "1", salesOwnerId: jia.id, channelId: ch.id } });
    const b2 = await prisma.customer.create({ data: { name: "线索来的", phone: "2", salesOwnerId: jia.id } });
    await prisma.lead.create({ data: { name: "x", source: "阿里国际站", customerId: b2.id, ownerId: jia.id, status: "已转化" } });
    const c = await prisma.customer.create({ data: { name: "已有来源", phone: "3", salesOwnerId: jia.id, channelId: ch.id, extra: { create: { source: "展会" } } } });
    expect(await 补来源()).toBe(2);
    const 来 = async (id: string) => (await prisma.customerExtra.findUnique({ where: { customerId: id } }))?.source;
    expect([await 来(a.id), await 来(b2.id), await 来(c.id)]).toEqual(["广交会", "阿里国际站", "展会"]);
  });

  it("外贸：电话空着、只有 WhatsApp——表单和导入都拿 WhatsApp 认人", async () => {
    await 外贸();
    const base = { name: "Ali", phone: "", school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, channelId: null, referrerCustomerId: null };
    const r = await saveCustomer({ ...base, extra: { whatsapp: "+971 50 123 4567" } });
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: r.id } })).phone).toMatch(/971501234567/);
    const 表头 = ["客户名称", "WhatsApp", "国家"];
    const w = await 执行导入({ 表头, 数据: [["Omar", "+966 55 765 4321", "KSA"]], 映射: 猜列(表头, 字段表(BUSINESS_PRESETS["外贸出口"])), 重复行: "跳过" }, "x.xlsx");
    if (!w.ok) throw new Error(w.error);
    expect(w.新建).toBe(1);
    expect((await prisma.customer.findFirstOrThrow({ where: { name: "Omar" } })).phone).toMatch(/966557654321/);
  });

});

describe("回归核对补钉（10-06，W-外贸并进）", () => {
  it("W-013 / W-014 询盘时间：服务器按 UTC 算时，东八区「今天」也收；改了进日志", async () => {
    await 外贸();
    const c = await 客户();
    const 明早 = new Date(Date.now() + 12 * 3600_000);
    const r = await saveOpportunity({ name: "x", customerId: c.id, amount: 0, stage: "初步沟通", status: "OPEN", probability: 20, 询盘时间: 明早.toISOString() });
    expect(r.ok).toBe(true);
    const o = await prisma.opportunity.findFirstOrThrow();
    await saveOpportunity({ id: o.id, name: "x", customerId: c.id, amount: 0, stage: "初步沟通", status: "OPEN", probability: 20, 询盘时间: new Date(2026, 2, 12).toISOString() });
    const 痕 = await prisma.auditLog.findFirstOrThrow({ where: { entity: "Opportunity", action: "update" } });
    expect(痕.detail).toContain("询盘时间");
  });

  it("W-021 WhatsApp、联系人电话按原样的写法也搜得到", async () => {
    await 外贸();
    const c = await 客户("Acme");
    await patchCustomer(c.id, "whatsapp", "+86 138 0000 1111");
    await prisma.contact.create({ data: { customerId: c.id, name: "Li", phone: "+1 (415) 555-0101" } });
    await 客户("别人");
    const 找 = async (k: string) => (await prisma.customer.findMany({ where: await 客户筛选条件({ keyword: k }), select: { name: true } })).map((x) => x.name);
    expect(await 找("138 0000")).toEqual(["Acme"]);
    expect(await 找("(415) 555")).toEqual(["Acme"]);
  });

  it("W-024 编辑框只交改过的档案格（空串当空）", () => {
    const 原 = { country: "美国", whatsapp: null, wechat: null, email: "a@b.com", source: null, level: null, website: null, alibabaId: null };
    expect(改过的档案({ country: "美国", whatsapp: "+1 2", wechat: "", email: "a@b.com", source: undefined }, 原)).toEqual({ whatsapp: "+1 2" });
    expect(改过的档案({ country: "", email: "a@b.com" }, 原)).toEqual({ country: null });
    expect(改过的档案({ country: "日本" }, null)).toEqual({ country: "日本" });
  });

  it("W-028 自家导出的「订单金额」「签约金额」「渠道归属」「图片张数」（D-24）列导回来不并进备注；负责人那列照旧并进", async () => {
    await 外贸();
    const 表头 = ["客户名称", "联系电话", "订单金额", "渠道归属", "销售负责人", "图片张数"];
    const w = await 执行导入({ 表头, 数据: [["Tim", "+998 90 000 2222", "USD 100", "小红", "张三", "商机 2 张"]], 映射: 猜列(表头, 字段表(BUSINESS_PRESETS["外贸出口"])), 重复行: "跳过" }, "a.xlsx");
    if (!w.ok) throw new Error(w.error);
    const 备注 = (await prisma.customer.findFirstOrThrow()).remark ?? "";
    expect(备注).not.toContain("USD 100");
    expect(备注).not.toContain("小红");
    expect(备注).not.toContain("商机 2 张");
    expect(备注).toContain("销售负责人：张三");
  });

  it("W-054 写档案推客户版本号：严格往前（不往回退）", async () => {
    await 外贸();
    const c = await 客户();
    const 未来 = new Date(Date.now() + 3600_000);
    await prisma.customer.update({ where: { id: c.id }, data: { updatedAt: 未来 } });
    await patchCustomer(c.id, "country", "美国");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).updatedAt.getTime()).toBeGreaterThan(未来.getTime());
  });
});

describe("B.3 老数据上切外贸再切回（2026-10-06 测试分期）", () => {
  it("通用模版的老数据：设置里切外贸 → 来源补上、老签约原样、赢单商机照旧；再切回通用照样能用", async () => {
    // 通用模版下的老数据
    const ch = await prisma.channel.create({ data: { name: "老带新渠道", channelOwnerId: jia.id } });
    const 甲 = await prisma.customer.create({ data: { name: "老客户甲", phone: "13900000001", salesOwnerId: jia.id, channelId: ch.id } });
    const 乙 = await prisma.customer.create({ data: { name: "老客户乙", phone: "13900000002", salesOwnerId: jia.id } });
    await prisma.lead.create({ data: { name: "乙公司", source: "展会", customerId: 乙.id, ownerId: jia.id, status: "已转化" } });
    const o = await prisma.opportunity.create({ data: { name: "老商机", customerId: 甲.id, amount: 100, ownerId: jia.id } });
    await saveContract({ customerId: 甲.id, amount: 100, signedAt: new Date(2026, 4, 1), remark: null, 联动: { 赢单: [o.id], 完成计划: [], 完成待办: [] } });

    // 设置里切外贸（走真的保存动作）
    const 外 = BUSINESS_PRESETS["外贸出口"];
    const r = await saveBusinessSettings({ ...外, poolDays: 0 });
    expect(r).toMatchObject({ ok: true, 补了来源: 2 });
    invalidateSettingsCache();
    expect((await getBusiness()).template).toBe("trade");
    const 来 = async (id: string) => (await prisma.customerExtra.findUnique({ where: { customerId: id } }))?.source;
    expect([await 来(甲.id), await 来(乙.id)]).toEqual(["老带新渠道", "展会"]);
    expect(await prisma.contract.count()).toBe(1); // 老签约原样还是那一笔
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("WON");

    // 再切回通用，改金额照样能存
    const k = await prisma.contract.findFirstOrThrow();
    await saveBusinessSettings({ ...BUSINESS_PRESETS["通用销售"], poolDays: 0 });
    invalidateSettingsCache();
    expect((await saveContract({ id: k.id, customerId: 甲.id, amount: 250, currency: "CNY", signedAt: k.signedAt, remark: null })).ok).toBe(true);
    expect((await prisma.contract.findFirstOrThrow()).amount).toBe(250);
    // 再切回外贸：不重复补来源（已经有了）
    expect(await saveBusinessSettings({ ...外, poolDays: 0 })).toMatchObject({ ok: true, 补了来源: 0 });
  });
});

describe("B.5 导出 → xlsx → 读回 → 导入，逐格一致（2026-10-06 测试分期）", () => {
  for (const 模 of ["通用销售", "外贸出口"] as const) {
    it(`${模}：所有人填的字段导回来一格不差`, async () => {
      await setSetting("business", BUSINESS_PRESETS[模]);
      invalidateSettingsCache();
      const b = BUSINESS_PRESETS[模];
      const 外 = 模 === "外贸出口";
      const c = await prisma.customer.create({
        data: { name: "往返客户", phone: "13912345678", school: "Round Trip LLC", grade: b.grades[0], major: "食品", followStatus: "意向较高", decisionStatus: "与家人商议", remark: "第一行\n第二行：=1+1", salesOwnerId: jia.id, expectedSignAt: 外 ? null : new Date(2026, 10, 3) },
      });
      if (外) await prisma.customerExtra.create({ data: { customerId: c.id, country: "德国", whatsapp: "+49 151 1234 5678", wechat: "rt_wx", email: "rt@example.de", source: "展会" } });
      const 出 = await 导出客户({});
      if (!出.ok) throw new Error(出.error);
      const 表 = 客户导出表(出.rows, b);
      const 读回 = 读xlsx(写xlsx([{ 名: "客户", 表头: 表.head, 行: 表.body }]));
      expect(读回[0]).toEqual(表.head);
      const 原 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, include: { extra: true } });
      await prisma.customer.deleteMany();
      const w = await 执行导入({ 表头: 读回[0], 数据: 读回.slice(1), 映射: 猜列(读回[0], 字段表(b)), 重复行: "跳过" }, "往返.xlsx");
      if (!w.ok) throw new Error(w.error);
      expect(w.新建).toBe(1);
      const 回 = await prisma.customer.findFirstOrThrow({ include: { extra: true } });
      for (const k of ["name", "phone", "school", "grade", "major", "followStatus", "decisionStatus"] as const) expect(回[k], k).toEqual(原[k]);
      // 备注原样回来；「销售负责人」那一列导入不收（归属是导入的人），按规矩并进备注、字不丢（W-028）
      expect(回.remark).toBe(`${原.remark}\n销售负责人：甲`);
      if (!外) expect(回.expectedSignAt?.toDateString()).toBe(原.expectedSignAt?.toDateString());
      if (外) for (const k of ["country", "whatsapp", "wechat", "email", "source"] as const) expect(回.extra?.[k], k).toEqual(原.extra?.[k]);
    });
  }
});
