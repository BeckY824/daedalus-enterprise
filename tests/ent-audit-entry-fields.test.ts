/**
 * 审核 11-18「新建入口与字段落库」修复的正式用例（复现单测 tests/audit-1118/entry-fields.test.ts E1–E4 改写而来，再各补对照）。
 *   P0-1 企业版导入表头「国家」落客户地址的国家；只有城市没国家的不补「中国」（地名判定同 cn-place.ts）
 *   P2-2 「中國」「中华人民共和国」认作中国（E2）
 *   P1-1 客户页新增项目（新建弹窗挑老客户同一个动作）项目来源建时可选（P-删-03）
 *   P1-3 设置 → 企业版导入拦回收站里的号码（P-删-08）
 *   P1-4 联系人到期清理 / 彻底删除 / 移出后，他的号不再留在客户上撞号（E4）
 *   P1-5 节点必填「国家 / 来源 / 联系方式」读企业版的格（E3）
 *   P1-6 电话定线：国家是国外时不带 + 的 11 位号不当大陆手机；只留 WhatsApp 的按国际号判
 * 名字、号码全是编造的
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 清过期, 彻底删除 } from "@/lib/enterprise/soft-delete";
import { 全公司查号 } from "@/lib/enterprise/contact-dedupe";
import { 规则猜列 } from "@/lib/enterprise-import/mapping";
import { 清洗, 空索引, 国家列落地址, 撞回收站, type 本地索引 } from "@/lib/enterprise-import/clean";
import { 读回收站号键 } from "@/lib/enterprise-import/dedup";
import { 读本地索引 } from "@/lib/enterprise-import/report";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";
import { 规整地址 } from "@/lib/enterprise/customer-v2";
import { 客户区域of, 电话定线, 默认分配方向 } from "@/lib/enterprise/customer-region";
import { 客户号们, 客户默认分配方向 } from "@/lib/enterprise/assign-direction-db";
import { 读必填数据 } from "@/lib/project/db";
import { 有效沟通还差 } from "@/lib/project/required";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { detachContact } from "@/app/(app)/customers/[id]/actions";
import { 摘联系人号 } from "@/lib/enterprise/contact-number-detach";
import { 读组织 } from "@/lib/enterprise/org";

afterAll(async () => { await prisma.$disconnect(); });

/* ───────────── 导入：表头「国家」+ 城市（P0-1） ───────────── */

function 映射样(客户列: Record<string, string>): 映射 {
  return {
    列: { customer: { 外部: "id", 名称: "name", 负责人: "owner", ...客户列 } },
    负责人: { 示例销售: "u-1" },
    值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
    默认负责人Id: "u-1",
  };
}
let 序 = 0;
function 条(字段: Record<string, string>): 原始记录 {
  序++;
  return { 实体: "customer", 外部ID: 字段.外部 ?? `N${序}`, 字段: { 负责人: "示例销售", ...字段 }, 行号: 序 + 1, 出处: "客户.xlsx" };
}
/** 表头按规则猜列（同设置 → 企业版导入）：「国家」→ country，「城市」→ addrCity */
const 猜的列 = (表头: string[]) => Object.fromEntries(Object.entries(规则猜列("customer", 表头)).filter(([, 字段]) => !!字段 && 字段 !== "name").map(([头, 字段]) => [头, 字段 as string]));
const 写的 = (r: ReturnType<typeof 清洗>, id: string) => r.待写.find((w) => w.外部ID === id)?.值 as Record<string, unknown> | undefined;

describe("P0-1 企业版导入：「国家」列落客户地址的国家", () => {
  it("（E1）表头「客户名称 / 国家 / 城市」、一行「美国 / 洛杉矶」：客户地址国家 = 美国、区域非大陆；老外贸档案那格照旧写", () => {
    const 列 = 猜的列(["客户名称", "国家", "城市"]);
    expect(列).toMatchObject({ 国家: "country", 城市: "addrCity" });
    const r = 清洗([条({ 外部: "U1", 名称: "示例美国公司", 国家: "美国", 城市: "洛杉矶" })], 映射样(列), 空索引());
    const v = 写的(r, "U1")!;
    expect(v).toMatchObject({ addrCountry: "美国", addrCity: "洛杉矶", country: "美国" });
    expect(v.addrProvince).toBeUndefined();
    expect(客户区域of(v as never)).toBe("非大陆");
  });

  it("只有城市、没有国家，城市认不出（Torino、洛杉矶）：不补「中国」、不落地址，原样进备注并提醒", () => {
    const 列 = 猜的列(["客户名称", "城市"]);
    const r = 清洗([条({ 外部: "T1", 名称: "示例意大利公司", 城市: "Torino" }), 条({ 外部: "T2", 名称: "示例洛城公司", 城市: "洛杉矶" })], 映射样(列), 空索引());
    for (const [id, 城] of [["T1", "Torino"], ["T2", "洛杉矶"]] as const) {
      const v = 写的(r, id)!;
      expect(v.addrCountry).toBeUndefined();
      expect(v.addrCity).toBeUndefined();
      expect(String(v.remark)).toContain(`地址：${城}`);
      expect(r.问题.some((q) => q.外部ID === id && q.级别 === "提醒" && q.说明.includes("没写国家"))).toBe(true);
    }
  });

  it("对照：只写了国内城市 / 省（杭州、义乌市、浙江省）照旧补「中国」；写了港澳台的照填、区域非大陆", () => {
    const 列 = 猜的列(["客户名称", "省份", "城市"]);
    const r = 清洗([
      条({ 外部: "C1", 名称: "示例杭州公司", 城市: "杭州" }),
      条({ 外部: "C2", 名称: "示例义乌公司", 省份: "浙江省", 城市: "义乌市" }),
      条({ 外部: "C3", 名称: "示例台北公司", 城市: "台北市" }),
    ], 映射样(列), 空索引());
    expect(写的(r, "C1")).toMatchObject({ addrCountry: "中国", addrCity: "杭州" });
    expect(写的(r, "C2")).toMatchObject({ addrCountry: "中国", addrProvince: "浙江省", addrCity: "义乌市" });
    expect(客户区域of(写的(r, "C1") as never)).toBe("大陆");
    expect(写的(r, "C3")).toMatchObject({ addrCountry: "中国", addrCity: "台北市" });
    expect(客户区域of(写的(r, "C3") as never)).toBe("非大陆");
  });

  it("对照：表里有「地址国家」列的照旧用那一列；「国家 / 地区」写成国内地名、泛称、英文的各自认对", () => {
    const r = 清洗([条({ 外部: "D1", 名称: "示例双列公司", 地址国家: "德国", 国家: "美国", 城市: "Berlin" })], 映射样({ 地址国家: "addrCountry", 国家: "country", 城市: "addrCity" }), 空索引());
    expect(写的(r, "D1")).toMatchObject({ addrCountry: "德国", addrCity: "Berlin", country: "美国" });
    expect(国家列落地址("浙江")).toEqual({ addrCountry: "中国", addrProvince: "浙江" });
    expect(国家列落地址("杭州")).toEqual({ addrCountry: "中国", addrCity: "杭州" });
    expect(国家列落地址("华东")).toEqual({ addrCountry: "中国" });
    expect(国家列落地址("中國")).toEqual({ addrCountry: "中国" });
    expect(国家列落地址("USA")).toEqual({ addrCountry: "美国" });
    expect(国家列落地址("香港")).toEqual({ addrCountry: "中国香港" });
    expect(客户区域of(国家列落地址("香港"))).toBe("非大陆");
    expect(国家列落地址("")).toBeNull();
  });
});

/* ───────────── 「中國」「中华人民共和国」（P2-2） ───────────── */

describe("P2-2 中国的别写法", () => {
  it("（E2）国家写「中國」「中华人民共和国」「中華人民共和國」：规整成「中国」、省市区县都留着", () => {
    for (const 国 of ["中國", "中华人民共和国", "中華人民共和國", "Mainland China"]) {
      const r = 规整地址({ addrCountry: 国, addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区" });
      expect([国, r.ok && r.值]).toEqual([国, { addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区" }]);
    }
  });
  it("对照：真国外照旧只留国家 + 城市；「中國香港」不当大陆", () => {
    expect(规整地址({ addrCountry: "美国", addrProvince: "加州", addrCity: "洛杉矶", addrDistrict: "X" })).toEqual({ ok: true, 值: { addrCountry: "美国", addrProvince: null, addrCity: "洛杉矶", addrDistrict: null } });
    const 港 = 规整地址({ addrCountry: "中國香港", addrCity: "九龍" });
    expect(港.ok && 港.值.addrCountry).toBe("中國香港");
    expect(客户区域of(港.ok ? 港.值 : null)).toBe("非大陆");
  });
});

/* ───────────── 电话定线（P1-6） ───────────── */

describe("P1-6 电话定线", () => {
  it("国家是国外时，不带 + 的 11 位号（14155550132）不当大陆手机", () => {
    expect(电话定线(["14155550132"], { 国家: "美国" })).toBeNull();
    expect(电话定线(["14155550132", "+14155550133"], { 国家: "美国" })).toBe("外贸");
  });
  it("只留了 WhatsApp 的：按国际号判（没带 + 的补上 +；国家是国外时不带 + 的 1 开头 11 位也按国际号）", () => {
    expect(电话定线([{ whatsapp: "14155550132" }], { 国家: "美国" })).toBe("外贸");
    expect(电话定线([{ whatsapp: "+971 50 123 4567" }])).toBe("外贸");
    expect(电话定线([{ whatsapp: "971501234567" }])).toBe("外贸");
    expect(默认分配方向({ 号们: [{ whatsapp: "+14155550132" }], 本人线: "内贸" })).toEqual({ 线: "外贸", 来源: "电话" });
  });
  it("不带 + 的 WhatsApp 形如大陆手机（11 位、1[3-9] 开头）、国家不是国外：按大陆手机判内贸，不补 + 读成 +1", () => {
    expect(电话定线([{ whatsapp: "13800001111" }])).toBe("内贸");
    expect(电话定线([{ whatsapp: "138 0000 1111" }], { 国家: "中国" })).toBe("内贸");
    expect(电话定线([{ whatsapp: "15912345678" }], { 国家: "中國" })).toBe("内贸");
    expect(默认分配方向({ 号们: [{ whatsapp: "13800001111" }], 本人线: "外贸" })).toEqual({ 线: "内贸", 来源: "电话" });
    // 国家是国外：维持按国际号读
    expect(电话定线([{ whatsapp: "13800001111" }], { 国家: "美国" })).toBe("外贸");
    // 不像大陆手机的（12 开头、位数不对）照旧按国际号
    expect(电话定线([{ whatsapp: "12025550132" }])).toBe("外贸");
  });
  it("对照：没国家 / 国家是中国的 11 位照旧大陆；+86 写明了的照旧大陆；电话在前、WhatsApp 在后；+86 的 WhatsApp 是大陆", () => {
    expect(电话定线(["13800001111"])).toBe("内贸");
    expect(电话定线(["13800001111"], { 国家: "中国" })).toBe("内贸");
    expect(电话定线(["13800001111"], { 国家: "中國" })).toBe("内贸");
    expect(电话定线(["+86 138 0000 1111"], { 国家: "美国" })).toBe("内贸");
    expect(电话定线(["13800001111", { whatsapp: "+14155550132" }])).toBe("内贸");
    expect(电话定线([{ whatsapp: "8613800001111" }])).toBe("内贸");
  });
});

/* ───────────── 要库的 ───────────── */

describe("要库", () => {
  let 老板: string, 销售: string;
  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    mocks.企业版 = true;
    const 人 = async (email: string, name: string, role = "SALES") => (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    老板 = await 人("boss", "老板", "ADMIN");
    销售 = await 人("s1", "小王");
    await prisma.entMember.createMany({ data: [{ userId: 老板, bizRole: "director" }, { userId: 销售, bizRole: "sales" }] });
    mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
  });

  describe("P1-6 客户的号带上 WhatsApp", () => {
    it("只有 WhatsApp（客户 WhatsApp / 号码几行）、地址空：分配方向按电话判外贸", async () => {
      const c = await prisma.customer.create({ data: { name: "只有WA甲", phone: "", salesOwnerId: 销售, extra: { create: { whatsapp: "+14155550132" } } } });
      const d = await prisma.customer.create({ data: { name: "只有WA乙", phone: "", salesOwnerId: 销售 } });
      await prisma.contactMethod.create({ data: { customerId: d.id, kind: "whatsapp", value: "+971501234567", numberKey: "971501234567" } });
      const org = await 读组织();
      for (const id of [c.id, d.id]) expect(await 客户默认分配方向(org, id, 销售)).toEqual({ 线: "外贸", 来源: "电话" });
    });
    it("对照：有大陆手机的照旧电话在前判内贸", async () => {
      const c = await prisma.customer.create({ data: { name: "有手机", phone: "13800001111", salesOwnerId: 销售, extra: { create: { whatsapp: "+14155550132" } } } });
      expect(await 客户号们(c.id)).toEqual(["13800001111", { whatsapp: "+14155550132" }]);
      expect(await 客户默认分配方向(await 读组织(), c.id, 销售)).toEqual({ 线: "内贸", 来源: "电话" });
    });
  });

  describe("P1-5 节点必填读企业版的格", () => {
    const 项目 = async (c: string) => prisma.project.findUniqueOrThrow({ where: { id: (await prisma.project.create({ data: { name: "项目", customerId: c, ownerId: 销售, creatorId: 销售, node: "线索验证" } })).id } });

    it("（E3）客户地址国家地区填了（addrCountry）、来源渠道选了（channelId）、只有客户本身的号码行：国家 / 来源 / 联系方式都算齐", async () => {
      const ch = await prisma.channel.create({ data: { name: "示例渠道", channelOwnerId: 老板 } });
      const c = await prisma.customer.create({ data: { name: "外贸客户", phone: "", salesOwnerId: 销售, addrCountry: "阿联酋", channelId: ch.id } });
      await prisma.contactMethod.create({ data: { customerId: c.id, kind: "whatsapp", value: "+971501234567", numberKey: "971501234567" } });
      const d = await 读必填数据(prisma as never, await 项目(c.id));
      expect(有效沟通还差({ ...d, 线索验证必填: ["国家", "来源", "联系方式"] })).toEqual([]);
    });
    it("对照：三样都没填照旧算差；老外贸档案那几格照旧也算", async () => {
      const 空 = await prisma.customer.create({ data: { name: "空客户", phone: "", salesOwnerId: 销售 } });
      const d1 = await 读必填数据(prisma as never, await 项目(空.id));
      expect(有效沟通还差({ ...d1, 线索验证必填: ["国家", "来源", "联系方式"] })).toEqual(["国家", "来源", "联系方式"]);
      const 老 = await prisma.customer.create({ data: { name: "老客户", phone: "", salesOwnerId: 销售, extra: { create: { country: "美国", source: "展会", whatsapp: "+14155550132" } } } });
      const d2 = await 读必填数据(prisma as never, await 项目(老.id));
      expect(有效沟通还差({ ...d2, 线索验证必填: ["国家", "来源", "联系方式"] })).toEqual([]);
    });
  });

  describe("P1-4 联系人真删 / 移出后号不留在客户上", () => {
    const 挂号 = async (customerId: string, contactId: string, kind: string, value: string, numberKey: string) =>
      prisma.contactMethod.create({ data: { customerId, contactId, kind, value, numberKey } });

    it("（E4）联系人进回收站满 30 天被清掉：他的号不留在客户上、全公司查号不再撞", async () => {
      const c = await prisma.customer.create({ data: { name: "客户甲", phone: "13700001111", salesOwnerId: 销售 } });
      const 联 = await prisma.contact.create({ data: { name: "已删联系人", phone: "13912345678", customerId: c.id, deletedAt: new Date(Date.now() - 40 * 86400_000) } });
      await 挂号(c.id, 联.id, "phone", "13912345678", "13912345678");
      await 挂号(c.id, 联.id, "whatsapp", "+14155550132", "14155550132");
      await 清过期(new Date());
      expect(await 看已删(() => prisma.contactMethod.findMany({ where: { customerId: c.id } }))).toEqual([]);
      expect(await 全公司查号(prisma, "手机号", "13912345678", "13912345678")).toEqual([]);
    });

    it("系统管理员彻底删除回收站里的联系人：号一起摘掉", async () => {
      const c = await prisma.customer.create({ data: { name: "客户乙", phone: "13700002222", salesOwnerId: 销售 } });
      const 联 = await prisma.contact.create({ data: { name: "删的人", phone: "13912340000", customerId: c.id, deletedAt: new Date() } });
      await 挂号(c.id, 联.id, "phone", "13912340000", "13912340000");
      expect(await 彻底删除({ id: 老板, role: "ADMIN" }, "Contact", 联.id)).toMatchObject({ ok: true });
      expect(await 看已删(() => prisma.contactMethod.count({ where: { customerId: c.id } }))).toBe(0);
      expect(await 全公司查号(prisma, "手机号", "13912340000", "13912340000")).toEqual([]);
    });

    it("从客户上移出联系人：号摘掉，子表里多的号记进未归属那行的备注", async () => {
      mocks.企业版 = false;
      const c = await prisma.customer.create({ data: { name: "客户丙", phone: "13700003333", salesOwnerId: 老板 } });
      const 联 = await prisma.contact.create({ data: { name: "移出的人", phone: "13912341111", customerId: c.id } });
      await 挂号(c.id, 联.id, "phone", "13912341111", "13912341111");
      await 挂号(c.id, 联.id, "whatsapp", "+14155550132", "14155550132");
      expect(await detachContact(联.id)).toMatchObject({ ok: true });
      expect(await prisma.contactMethod.count({ where: { customerId: c.id } })).toBe(0);
      const u = await prisma.unassignedContact.findUniqueOrThrow({ where: { id: 联.id } });
      expect(u.phone).toBe("13912341111");
      expect(u.remark).toContain("+14155550132");
    });

    it("对照：和客户主表电话是同一行的号留给客户（只摘掉联系人）；没删的联系人的号不动", async () => {
      const c = await prisma.customer.create({ data: { name: "客户丁", phone: "13700004444", salesOwnerId: 销售 } });
      const 删 = await prisma.contact.create({ data: { name: "同号的人", phone: "13700004444", customerId: c.id, deletedAt: new Date(Date.now() - 40 * 86400_000) } });
      const 在 = await prisma.contact.create({ data: { name: "在用的人", phone: "13912342222", customerId: c.id } });
      const 共用 = await 挂号(c.id, 删.id, "phone", "13700004444", "13700004444");
      await 挂号(c.id, 在.id, "phone", "13912342222", "13912342222");
      await 清过期(new Date());
      const 剩 = await prisma.contactMethod.findMany({ where: { customerId: c.id }, orderBy: { numberKey: "asc" } });
      expect(剩.map((m) => [m.id === 共用.id, m.contactId, m.numberKey])).toEqual([[true, null, "13700004444"], [false, 在.id, "13912342222"]]);
      expect(await prisma.$transaction((tx) => 摘联系人号(tx, []))).toEqual({ 删: 0, 留给客户: 0 });
    });
  });

  describe("P1-3 企业版导入拦回收站里的号码", () => {
    it("号码撞上回收站里的客户（删了的客户名下联系人的号、在用客户名下删了的联系人的号）：这一行不导，提示去捞回", async () => {
      // 企业版客户没有电话（E-260）：号在联系人上
      const 回收站客户 = await prisma.customer.create({ data: { name: "回收站客户", phone: "", salesOwnerId: 销售, deletedAt: new Date() } });
      await prisma.contact.create({ data: { name: "回收站联系人", phone: "13755550001", customerId: 回收站客户.id } });
      const 在用 = await prisma.customer.create({ data: { name: "在用客户", phone: "", salesOwnerId: 销售 } });
      await prisma.contact.create({ data: { name: "在用联系人", phone: "13755550009", customerId: 在用.id } });
      const 删人 = await prisma.contact.create({ data: { name: "删了的联系人", customerId: 在用.id, deletedAt: new Date() } });
      await prisma.contactMethod.create({ data: { customerId: 在用.id, contactId: 删人.id, kind: "phone", value: "13755550002", numberKey: "13755550002" } });
      const 索引 = await 读本地索引("excel");
      expect([...(索引.回收站号 ?? [])].sort()).toEqual(["13755550001", "13755550002"]);
      const r = 清洗([
        条({ 外部: "R1", 名称: "新名字一", 电话: "+86 137-5555-0001" }),
        条({ 外部: "R2", 名称: "新名字二", 电话: "13755550002" }),
        条({ 外部: "R3", 名称: "新名字三", 电话: "13755550003" }),
      ], 映射样({ 电话: "phone" }), 索引);
      expect(r.待写.map((w) => w.外部ID)).toEqual(["R3"]);
      for (const id of ["R1", "R2"]) expect(r.问题.find((q) => q.外部ID === id && q.级别 === "跳过")?.说明).toMatch(/回收站里的客户，这一条不导.*捞回/);
    });
    it("对照：在用的撞了照旧按在用的报；回收站里没有的不拦；不是企业版不查", async () => {
      const 在用的 = await prisma.customer.create({ data: { name: "在用的", phone: "", salesOwnerId: 销售 } });
      await prisma.contact.create({ data: { name: "在用的联系人", phone: "13755550011", customerId: 在用的.id } });
      const 索引: 本地索引 = { ...(await 读本地索引("excel")) };
      const r = 清洗([条({ 外部: "S1", 名称: "别的名字", 电话: "13755550011" })], 映射样({ 电话: "phone" }), 索引);
      expect(r.问题.find((q) => q.外部ID === "S1")?.说明).toMatch(/和我们这边已有的客户撞了/);
      expect(撞回收站({ 回收站号: new Set(["13755550099"]) }, ["13755550011", "1111", null])).toBeNull();
      mocks.企业版 = false;
      await prisma.customer.create({ data: { name: "删了的", phone: "13755550012", salesOwnerId: 销售, deletedAt: new Date() } });
      expect((await 读回收站号键()).size).toBe(0);
    });
  });

  describe("P1-1 客户页新增项目：项目来源建时可选", () => {
    const 建 = (customerId: string, channelId?: string | null) => 给客户建项目({
      customerId,
      项目: { name: "新一单", amount: 0, currency: "CNY", ownerId: 老板, 业务线: "外贸", ...(channelId !== undefined ? { channelId } : {}) },
      跟进: { type: "PHONE", content: "老客户又来询盘", occurredAt: "2026-11-18 10:00", 节点: "潜客培育", 明确回复: false },
    });

    it("客户来源「展会」，新项目选「阿里国际站」：项目来源 = 阿里国际站", async () => {
      const 展会 = await prisma.channel.create({ data: { name: "示例展会", channelOwnerId: 老板 } });
      const 阿里 = await prisma.channel.create({ data: { name: "示例阿里国际站", channelOwnerId: 老板 } });
      const c = await prisma.customer.create({ data: { name: "老客户A", phone: "13766660001", salesOwnerId: 老板, channelId: 展会.id } });
      const r = await 建(c.id, 阿里.id);
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect((await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } })).channelId).toBe(阿里.id);
    });
    it("对照：没选 = 带客户来源；选了停用的渠道被拦、不建", async () => {
      const 展会 = await prisma.channel.create({ data: { name: "示例展会", channelOwnerId: 老板 } });
      const 停 = await prisma.channel.create({ data: { name: "示例停用", channelOwnerId: 老板, active: false } });
      const c = await prisma.customer.create({ data: { name: "老客户B", phone: "13766660002", salesOwnerId: 老板, channelId: 展会.id } });
      const r = await 建(c.id);
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect((await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } })).channelId).toBe(展会.id);
      expect(await 建(c.id, 停.id)).toEqual({ ok: false, error: "项目来源这个渠道不存在或已停用，换一个" });
      expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(1);
    });
  });
});
