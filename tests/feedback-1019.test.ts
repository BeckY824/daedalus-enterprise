/**
 * 客户使用反馈（2026-10-19，05-反馈与复盘/客户使用反馈-审查-20261019.md）桌面端采纳的几条：
 *
 *   （2. Windows 点 × 最小化到托盘：属于桌面壳，企业库不带壳，不在这里钉）
 *   3. 跟进类型加「微信沟通」（WECHAT）
 *   4. 录入弹窗草稿（lib/form-guard 的存取；弹窗行为在 feedback-1019.ui.test.ts 里用真浏览器钉）
 *   5. 外贸新建客户：电话 / WhatsApp / 邮箱 / 微信至少填一个；只有微信的按微信认人（表单、导入同一条规矩）
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
import { BUSINESS_PRESETS } from "@/lib/business-config";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 执行导入, 预览导入 } from "@/app/(app)/customers/import-actions";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { 摊开, 并重复行 } from "@/lib/import/plan";
import { FOLLOW_TYPES, FOLLOW_TYPE_MAP, 跟进类型们 } from "@/lib/constants";
import { 方式到类型 } from "@/app/(app)/customers/[id]/CompletePlanModal";
import { 草稿全名, 读草稿, 存草稿, 清草稿, 有内容 } from "@/lib/form-guard";
import { dayjs } from "@/lib/utils";

let jia: { id: string };
const 外贸配置 = BUSINESS_PRESETS["外贸出口"];
async function 外贸() {
  await setSetting("business", 外贸配置);
  invalidateSettingsCache();
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  jia = await prisma.user.create({ data: { email: "jia", name: "甲", title: "销售", role: "ADMIN", password: "x" } });
  mocks.user = { id: jia.id, name: "甲", email: "jia", role: "ADMIN", title: "管理员", avatar: null };
});
afterAll(async () => { await prisma.$disconnect(); });

const 基本 = { phone: "", school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, channelId: null, referrerCustomerId: null };
const 新建 = (name: string, extra: Record<string, string | null>, phone = "") => saveCustomer({ ...基本, name, phone, extra });
async function 编辑(id: string, patch: Record<string, unknown>) {
  const r = await prisma.customer.findUniqueOrThrow({ where: { id } });
  const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
  return saveCustomer({ id, updatedAt: r.updatedAt.toISOString(), base, ...base, ...patch } as Parameters<typeof saveCustomer>[0]);
}
const 微信 = async (id: string) => (await prisma.customerExtra.findUnique({ where: { customerId: id } }))?.wechat;

describe("3. 跟进类型「微信沟通」", () => {
  it("类型表、外贸 / 通用的下拉都有 WECHAT；不做笼统的「社媒沟通」（手机端认 WECHAT 归团队版那边）", () => {
    expect(FOLLOW_TYPE_MAP.WECHAT).toMatchObject({ label: "微信沟通", icon: "wechat" });
    expect(跟进类型们(true).map((t) => t.value)).toContain("WECHAT");
    expect(跟进类型们(false).map((t) => t.value)).toContain("WECHAT");
    expect(FOLLOW_TYPES.some((t) => /社媒/.test(t.label))).toBe(false);
  });

  it("计划上写的方式认得出微信（企业微信也算）；短信还是短信", () => {
    expect(方式到类型("微信沟通", false)).toBe("WECHAT");
    expect(方式到类型("企业微信语音", true)).toBe("WECHAT");
    expect(方式到类型("短信", false)).toBe("SMS");
  });

  it("记一条微信沟通的跟进存得进去", async () => {
    const c = await prisma.customer.create({ data: { name: "王伟", phone: "13800001111", salesOwnerId: jia.id } });
    const r = await saveFollowUp({ customerId: c.id, type: "WECHAT", content: "微信上发了报价单", status: "已完成", occurredAt: new Date().toISOString() });
    expect(r.ok).toBe(true);
    expect(await prisma.followUp.count({ where: { type: "WECHAT" } })).toBe(1);
  });
});

describe("5. 外贸新建客户：只有微信也能建，按微信认人", () => {
  it("只填微信能存；同一个微信号（大小写、空格不同）再建一位被挡，说的是微信", async () => {
    await 外贸();
    const r = await 新建("Wang Wei", { wechat: "WangWei_88" });
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: r.id } })).phone).toBe("");
    expect(await 微信(r.id)).toBe("WangWei_88");
    const 再 = await 新建("王伟", { wechat: " wangwei_88 " });
    expect(再.ok).toBe(false);
    expect(!再.ok && 再.error).toMatch(/微信 wangwei_88 已存在（Wang Wei）/);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("有电话或邮箱的照旧按电话 / 邮箱认：两位有电话的共用一个微信号都存得下", async () => {
    await 外贸();
    expect((await 新建("A", { wechat: "shop_wx" }, "+86 138 0000 1111")).ok).toBe(true);
    expect((await 新建("B", { wechat: "shop_wx" }, "+86 138 0000 2222")).ok).toBe(true);
    expect((await 新建("C", { wechat: "shop_wx", email: "c@x.com" })).ok).toBe(true);
  });

  it("按微信认的那位：改别的照常；微信不许清空；补上邮箱之后微信就能清了", async () => {
    await 外贸();
    const r = await 新建("Wang", { wechat: "wang_wx" });
    if (!r.ok) throw new Error(r.error);
    expect((await 编辑(r.id, { remark: "要样品", extra: { wechat: "wang_wx" } })).ok).toBe(true);
    const 清 = await 编辑(r.id, { extra: { wechat: null } });
    expect(清.ok).toBe(false);
    expect(!清.ok && 清.error).toMatch(/按微信认的：微信不能清空/);
    expect(await 微信(r.id)).toBe("wang_wx");
    expect((await 编辑(r.id, { extra: { wechat: null, email: "wang@x.com" } })).ok).toBe(true);
    expect(await 微信(r.id)).toBeNull();
  });

  it("通用模版不变：只有微信照旧要电话", async () => {
    const r = await 新建("张三", { wechat: "zs" });
    expect(!r.ok && r.error).toBe("请输入联系电话");
  });
});

describe("5. 导入：只有微信的行进得来，同一条规矩", () => {
  const 表头 = ["联系人昵称", "微信", "国家地区", "联系人电话"];
  const 方案 = (数据: string[][], 重复行: "跳过" | "补空" = "跳过") => ({ 表头, 数据, 映射: 猜列(表头, 字段表(外贸配置)), 重复行 });

  it("只有微信的行进得来；再导一次（大小写不同）认得出、补空不另建", async () => {
    await 外贸();
    const 一 = await 执行导入(方案([["Wang Wei", "WangWei_88", "", ""]]), "a.xlsx");
    if (!一.ok) throw new Error(一.error);
    expect(一.新建).toBe(1);
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "Wang Wei" } });
    expect([c.phone, await 微信(c.id)]).toEqual(["", "WangWei_88"]);

    const 看 = await 预览导入(方案([["王伟", "wangwei_88", "中国", ""]], "补空"));
    if (!看.ok) throw new Error(看.error);
    expect([看.预览.新建, 看.预览.已在库里]).toEqual([0, 1]);
    const 二 = await 执行导入(方案([["王伟", "wangwei_88", "中国", ""]], "补空"), "b.xlsx");
    if (!二.ok) throw new Error(二.error);
    expect([二.新建, 二.补空]).toEqual([0, 1]);
    expect(await prisma.customer.count()).toBe(1);
    expect((await prisma.customerExtra.findUniqueOrThrow({ where: { customerId: c.id } })).country).toBe("中国");
  });

  it("同一份表：同微信的两行合成一条；没电话那行和同微信有电话那行也合成一条", async () => {
    await 外贸();
    const 数据 = [
      ["Wang", "wang_wx", "", ""],
      ["Wang W.", "WANG_WX", "中国", ""],
      ["Li", "li_wx", "", ""],
      ["Li Na", "li_wx", "中国", "+86 138 0000 3333"],
    ];
    const 表 = 字段表(外贸配置);
    const { 行, 合掉几行 } = 并重复行(摊开({ 表头, 数据, 行号: [2, 3, 4, 5], 映射: 猜列(表头, 表), 字段表: 表 }));
    expect(合掉几行).toBe(2);
    expect(行.map((r) => r.值.name)).toEqual(["Wang", "Li"]);
    const w = await 执行导入(方案(数据), "a.xlsx");
    if (!w.ok) throw new Error(w.error);
    expect(w.新建).toBe(2);
    expect(await prisma.customer.count()).toBe(2);
  });

  it("库里两位没电话没邮箱的都是这个微信：说不清，谁也不动", async () => {
    await 外贸();
    for (const n of ["A", "B"]) await prisma.customer.create({ data: { name: n, phone: "", salesOwnerId: jia.id, extra: { create: { wechat: "dup_wx" } } } });
    const 看 = await 预览导入(方案([["C", "dup_wx", "中国", ""]], "补空"));
    if (!看.ok) throw new Error(看.error);
    expect(看.预览.说不清).toBe(1);
    expect(看.预览.挡下[0].原因).toMatch(/2 位都是这个微信号/);
  });
});

describe("4. 录入弹窗草稿（只存本机）", () => {
  const 库 = new Map<string, string>();
  beforeEach(() => {
    库.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => 库.get(k) ?? null,
      setItem: (k: string, v: string) => void 库.set(k, v),
      removeItem: (k: string) => void 库.delete(k),
    });
  });

  it("按人分：换个账号看不到上一个人的草稿", () => {
    expect(草稿全名("u1", "新建客户")).not.toBe(草稿全名("u2", "新建客户"));
    存草稿(草稿全名("u1", "新建客户"), { name: "Wang" });
    expect(读草稿(草稿全名("u2", "新建客户"))).toBeNull();
    expect(读草稿(草稿全名("u1", "新建客户"))).toEqual({ name: "Wang" });
  });

  it("日期格存进去读出来还是 dayjs（DatePicker 才认得）；清掉就没了", () => {
    const 全名 = 草稿全名("u1", "新建商机:");
    存草稿(全名, { name: "样品单", expectedSignAt: dayjs("2026-11-01T10:00:00+08:00"), tags: ["a"] });
    const 稿 = 读草稿(全名)!;
    expect(dayjs.isDayjs(稿.expectedSignAt)).toBe(true);
    expect((稿.expectedSignAt as ReturnType<typeof dayjs>).toISOString()).toBe("2026-11-01T02:00:00.000Z");
    expect(稿.tags).toEqual(["a"]);
    清草稿(全名);
    expect(读草稿(全名)).toBeNull();
  });

  it("放 7 天，过了当没有；坏的、空的当没有", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
      存草稿("k", { name: "x" });
      vi.setSystemTime(new Date("2026-10-07T23:00:00Z"));
      expect(读草稿("k")).toEqual({ name: "x" });
      vi.setSystemTime(new Date("2026-10-08T01:00:00Z"));
      expect(读草稿("k")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    库.set("坏", "{not json");
    expect(读草稿("坏")).toBeNull();
    expect(读草稿("没有")).toBeNull();
  });

  it("有内容：空串、空格、空数组、null 不算；数字、日期、有字的算", () => {
    expect(有内容({ name: "", phone: "  ", tags: [], extra: { wechat: null } })).toBe(false);
    expect(有内容({ extra: { wechat: "wx" } })).toBe(true);
    expect(有内容({ amount: 0 })).toBe(true);
    expect(有内容({ at: dayjs() })).toBe(true);
  });
});
