/**
 * 企业版提成比例按人单设（10-28 用户「以销售个人为单位」）。Setting entCommissionRatesByUser 存 JSON，不加字段、不加迁移。
 * 钉的是：取比例的顺序 = 负责人自己单设的 → 他业务线那一套 → 默认 2% / 30%，单设一项另一项跟业务线；
 * 读写都规整（坏的、负的、超 100、三位小数那项不算）；离职（停用）的人的单设不算；只有老板、总管理员能改，改了进操作记录；
 * 只交改了的人、别人原样；算提成、项目提成卡、赢单固定三处一个顺序；开关关着照旧。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
  开: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 存项目底价, 改提成比例, 改按人提成比例 } from "@/app/(app)/projects/commission-actions";
import { 读项目提成, 读按人提成比例 } from "@/lib/project/commission-db";
import { 改节点 } from "@/lib/project/db";
import { 规整按人提成比例, 按人提成比例问题, 取提成比例, 默认提成比例, 算提成 } from "@/lib/project/commission";
import { 读组织 } from "@/lib/enterprise/org";
import { invalidateSettingsCache } from "@/lib/settings";

const 键 = "entCommissionRatesByUser";
let 甲: string; // 老板
let 乙: string; // 销售（项目负责人）
let 丙: string; // 另一个销售
let 项目id: string;

const 三套 = (底价比例: number, 溢价比例: number, 另: Partial<Record<"内贸" | "外贸", [number, number]>> = {}) => {
  const 套 = (k: "内贸" | "外贸") => ({ 底价比例: 另[k]?.[0] ?? 底价比例, 溢价比例: 另[k]?.[1] ?? 溢价比例 });
  return { 内贸: 套("内贸"), 外贸: 套("外贸"), 不限: { 底价比例, 溢价比例 } };
};
const 默认三套 = 三套(2, 30);
const 记录 = () => prisma.auditLog.findMany({ where: { entityId: 键 }, orderBy: { at: "asc" }, select: { entity: true, summary: true } });
const 当 = (id: string, role: string) => { mocks.user = { ...mocks.user, id, role }; };
const 名 = (uid: string) => ({ [甲]: "甲", [乙]: "乙", [丙]: "丙" })[uid] ?? "?";
const 存的 = async () => {
  const s = await prisma.setting.findUnique({ where: { key: 键 } });
  return s ? JSON.parse(s.value) : null;
};
/** 直接往库里写（模拟老数据 / 坏数据） */
const 硬写 = async (value: string) => {
  await prisma.setting.upsert({ where: { key: 键 }, update: { value }, create: { key: 键, value } });
  invalidateSettingsCache();
};
const 卡 = async () => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: 项目id } });
  const 在组 = (await prisma.projectMember.findMany({ where: { projectId: 项目id, inviteStatus: "JOINED" } })).map((m) => m.userId);
  return 读项目提成({ id: 甲, role: "ADMIN" }, p, 在组, await 读组织(), 名, prisma);
};
const 赢单 = () => 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" });
const 固定 = () => prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.开 = true;
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  丙 = (await prisma.user.create({ data: { email: "bing", name: "丙", title: "", role: "SALES", password: "x" } })).id;
  当(甲, "ADMIN");
  const c = await prisma.customer.create({ data: { name: "客户", phone: "13800000001", salesOwnerId: 乙 } });
  项目id = (await prisma.project.create({
    data: { name: "一期", customerId: c.id, ownerId: 乙, creatorId: 乙, phase: "商机", node: "首款支付", amount: 120000 },
  })).id;
  await prisma.projectMember.create({ data: { projectId: 项目id, userId: 乙, inviteStatus: "JOINED" } });
  当(乙, "SALES");
  expect(await 存项目底价(项目id, 100000)).toMatchObject({ ok: true });
  当(甲, "ADMIN");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("纯函数", () => {
  it("顺序：本人单设 → 业务线那一套 → 默认 2% / 30%；单设一项另一项跟业务线", () => {
    const 线 = 三套(2, 30, { 外贸: [3, 40] });
    expect(取提成比例(线, { u: { 底价比例: 1, 溢价比例: 10 } }, "u", "外贸")).toEqual({ 比例: { 底价比例: 1, 溢价比例: 10 }, 范围: "外贸", 单设: "全部" });
    expect(取提成比例(线, { u: { 溢价比例: 50 } }, "u", "外贸")).toEqual({ 比例: { 底价比例: 3, 溢价比例: 50 }, 范围: "外贸", 单设: "部分" });
    expect(取提成比例(线, { 别人: { 底价比例: 9 } }, "u", "外贸")).toEqual({ 比例: { 底价比例: 3, 溢价比例: 40 }, 范围: "外贸", 单设: null });
    expect(取提成比例(默认三套, {}, "u", null)).toEqual({ 比例: 默认提成比例, 范围: "不限", 单设: null });
    // 单设 0% 也是单设，不当没设
    expect(取提成比例(线, { u: { 底价比例: 0 } }, "u", "内贸").比例).toEqual({ 底价比例: 0, 溢价比例: 30 });
    // 原型上的名字不会被当成某个人
    expect(取提成比例(线, {}, "toString", null).单设).toBeNull();
  });

  it("规整：不是对象 / 数组 → 空；坏的那项不算（负数、超 100、三位小数、字符串），一项都不剩整条不要", () => {
    for (const v of [null, undefined, "x", 3, [], [{ 底价比例: 1 }]]) expect(规整按人提成比例(v)).toEqual({});
    expect(规整按人提成比例({
      a: { 底价比例: 5, 溢价比例: -1 },
      b: { 底价比例: 101, 溢价比例: 1.234 },
      c: { 底价比例: "5", 溢价比例: 20 },
      d: [1, 2],
      e: null,
      f: { 底价比例: 0, 溢价比例: 100 },
    })).toEqual({ a: { 底价比例: 5 }, c: { 溢价比例: 20 }, f: { 底价比例: 0, 溢价比例: 100 } });
  });

  it("规整给了在职：不在职的人整条不算", () => {
    expect(规整按人提成比例({ a: { 底价比例: 5 }, 走了: { 底价比例: 6 } }, (uid) => uid === "a")).toEqual({ a: { 底价比例: 5 } });
  });

  it("交上来的检查：null = 跟业务线可以；超范围、三位小数报是谁；格式不对拦", () => {
    expect(按人提成比例问题({ a: { 底价比例: null, 溢价比例: 12.5 } })).toBeNull();
    expect(按人提成比例问题({ a: { 底价比例: 101, 溢价比例: null } }, () => "乙")).toBe("乙：底价提成比例要在 0% 到 100% 之间");
    expect(按人提成比例问题({ a: { 底价比例: 1, 溢价比例: -0.01 } })).toMatch(/^有一个人：溢价提成比例/);
    expect(按人提成比例问题({ a: { 底价比例: 1.234, 溢价比例: null } })).toMatch(/最多两位小数/);
    for (const v of [null, [], "x", { a: 3 }, { a: [1] }]) expect(按人提成比例问题(v)).toMatch(/格式不对/);
  });
});

describe("三处一个顺序：项目提成卡、算提成、赢单固定", () => {
  beforeEach(async () => {
    expect(await 改提成比例(三套(2, 30, { 内贸: [1, 10], 外贸: [3, 40] }))).toMatchObject({ ok: true });
    await prisma.entMember.create({ data: { userId: 乙, bizRole: "sales", line: "外贸" } });
  });

  it("没单设：按业务线（外贸 3% / 40%）", async () => {
    const t = (await 卡())!;
    expect([t.范围, t.比例, t.单设, t.预估?.合计]).toEqual(["外贸", { 底价比例: 3, 溢价比例: 40 }, null, 11000]);
    await 赢单();
    expect(await 固定()).toMatchObject({ fixedRateBase: 3, fixedRatePremium: 40, fixedTotal: 11000 });
  });

  it("两项都单设：比业务线优先；卡片、赢单固定都用单设的", async () => {
    expect(await 改按人提成比例({ [乙]: { 底价比例: 1.5, 溢价比例: 20 } })).toEqual({ ok: true, 变了: true });
    const t = (await 卡())!;
    expect([t.比例, t.单设]).toEqual([{ 底价比例: 1.5, 溢价比例: 20 }, "全部"]);
    expect(t.预估).toEqual(算提成(120000, 100000, { 底价比例: 1.5, 溢价比例: 20 }));
    expect(t.预估?.合计).toBe(5500);
    await 赢单();
    expect(await 固定()).toMatchObject({ fixedRateBase: 1.5, fixedRatePremium: 20, fixedTotal: 5500 });
  });

  it("只单设溢价：底价跟业务线（外贸 3%）", async () => {
    await 改按人提成比例({ [乙]: { 底价比例: null, 溢价比例: 50 } });
    const t = (await 卡())!;
    expect([t.比例, t.单设, t.预估?.合计]).toEqual([{ 底价比例: 3, 溢价比例: 50 }, "部分", 13000]);
    await 赢单();
    expect(await 固定()).toMatchObject({ fixedRateBase: 3, fixedRatePremium: 50, fixedTotal: 13000 });
  });

  it("单设的是别人：负责人照旧按业务线", async () => {
    await 改按人提成比例({ [丙]: { 底价比例: 9, 溢价比例: 9 } });
    expect((await 卡())!.比例).toEqual({ 底价比例: 3, 溢价比例: 40 });
    await 赢单();
    expect(await 固定()).toMatchObject({ fixedRateBase: 3, fixedRatePremium: 40 });
  });

  it("赢单固定之后再改单设：实际提成不动", async () => {
    await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 } });
    await 赢单();
    await 改按人提成比例({ [乙]: { 底价比例: 5, 溢价比例: 50 } });
    expect(await 固定()).toMatchObject({ fixedRateBase: 1, fixedRatePremium: 10, fixedTotal: 3000 });
    expect((await 卡())!.实际?.合计).toBe(3000);
  });

  it("库里是坏的（不是 JSON、数组、值超范围）：当没单设，按业务线", async () => {
    for (const v of ["不是json", "[1,2]", JSON.stringify({ [乙]: { 底价比例: -1, 溢价比例: 200 } })]) {
      await 硬写(v);
      expect((await 卡())!.比例).toEqual({ 底价比例: 3, 溢价比例: 40 });
    }
    await 赢单();
    expect(await 固定()).toMatchObject({ fixedRateBase: 3, fixedRatePremium: 40 });
  });
});

describe("离职（停用）的人", () => {
  it("单设还在库里但不算：卡片、赢单固定都按业务线（默认 2% / 30%）；读出来也没有他", async () => {
    await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 } });
    await prisma.user.update({ where: { id: 乙 }, data: { active: false } });
    invalidateSettingsCache();
    expect(await 存的()).toEqual({ [乙]: { 底价比例: 1, 溢价比例: 10 } });
    expect(await 读按人提成比例(await 读组织())).toEqual({});
    const t = (await 卡())!;
    expect([t.比例, t.单设, t.预估?.合计]).toEqual([默认提成比例, null, 8000]);
    await 赢单();
    expect(await 固定()).toMatchObject({ fixedRateBase: 2, fixedRatePremium: 30, fixedTotal: 8000 });
  });

  it("给不在组织里的人单设：拦，不写；去掉他的单设可以", async () => {
    await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 } });
    await prisma.user.update({ where: { id: 乙 }, data: { active: false } });
    expect(await 改按人提成比例({ [乙]: { 底价比例: 5, 溢价比例: null } })).toMatchObject({ ok: false, error: expect.stringContaining("不在组织里") });
    expect(await 改按人提成比例({ 没这个人: { 底价比例: 5, 溢价比例: null } })).toMatchObject({ ok: false, error: expect.stringContaining("不在组织里") });
    expect(await 存的()).toEqual({ [乙]: { 底价比例: 1, 溢价比例: 10 } });
    expect(await 改按人提成比例({ [乙]: { 底价比例: null, 溢价比例: null } })).toEqual({ ok: true, 变了: true });
    expect(await 存的()).toEqual({});
    expect((await 记录()).at(-1)?.summary).toBe("按人提成比例：乙 底价 1% → 跟业务线，溢价 10% → 跟业务线");
  });
});

describe("改按人设置", () => {
  it("老板改了进操作记录，一个人一段；没改动不记", async () => {
    expect(await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: null }, [丙]: { 底价比例: 2.5, 溢价比例: 35 } })).toEqual({ ok: true, 变了: true });
    expect(await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: null } })).toEqual({ ok: true, 变了: false });
    expect(await 存的()).toEqual({ [乙]: { 底价比例: 1 }, [丙]: { 底价比例: 2.5, 溢价比例: 35 } });
    expect(await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 12 } })).toEqual({ ok: true, 变了: true });
    expect(await 记录()).toEqual([
      { entity: "Setting", summary: "按人提成比例：乙 底价 跟业务线 → 1%，溢价 跟业务线 → 跟业务线；丙 底价 跟业务线 → 2.5%，溢价 跟业务线 → 35%" },
      { entity: "Setting", summary: "按人提成比例：乙 底价 1% → 1%，溢价 跟业务线 → 12%" },
    ]);
  });

  it("只交改了的人：没交的（含离职的老条目）原样留着", async () => {
    await 硬写(JSON.stringify({ 走了的人: { 底价比例: 7 } }));
    await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 }, [丙]: { 底价比例: 2, 溢价比例: 20 } });
    await 改按人提成比例({ [丙]: { 底价比例: null, 溢价比例: null } });
    expect(await 存的()).toEqual({ 走了的人: { 底价比例: 7 }, [乙]: { 底价比例: 1, 溢价比例: 10 } });
  });

  it("超范围、负数、三位小数、格式不对：拦，库里不写、不记", async () => {
    for (const x of [{ 底价比例: 101, 溢价比例: null }, { 底价比例: -1, 溢价比例: null }, { 底价比例: null, 溢价比例: 1.234 }, { 底价比例: "3", 溢价比例: null }]) {
      expect(await 改按人提成比例({ [乙]: x } as never)).toMatchObject({ ok: false });
    }
    for (const v of [[], "x", { [乙]: 3 }]) expect(await 改按人提成比例(v as never)).toMatchObject({ ok: false });
    // 什么都没交 = 没改动
    expect(await 改按人提成比例(null as never)).toEqual({ ok: true, 变了: false });
    expect(await 存的()).toBeNull();
    expect(await 记录()).toEqual([]);
  });

  it("销售、销售管理、市场管理改不了；总管理员能改（和改三套同一个权限）", async () => {
    for (const bizRole of ["sales", "sales_mgr", "marketing_mgr"]) {
      await prisma.entMember.upsert({ where: { userId: 丙 }, update: { bizRole }, create: { userId: 丙, bizRole } });
      当(丙, "SALES");
      expect(await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 } })).toMatchObject({ ok: false, error: "只有老板或总管理员能改提成比例" });
    }
    expect(await 存的()).toBeNull();
    expect(await 记录()).toEqual([]);
    await prisma.entMember.update({ where: { userId: 丙 }, data: { bizRole: "director" } });
    expect(await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 } })).toEqual({ ok: true, 变了: true });
  });
});

describe("开关关着照旧", () => {
  it("不是企业版：拦，一行不写、不记；库里有单设也不出卡片、进订单不建提成表", async () => {
    await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 } });
    const 前 = await 存的();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 改按人提成比例({ [乙]: { 底价比例: 5, 溢价比例: 50 } })).toMatchObject({ ok: false, error: "提成是企业版的功能" });
    expect(await 存的()).toEqual(前);
    expect(await 记录()).toHaveLength(1);
    expect(await 卡()).toBeNull();
    await prisma.entCommission.deleteMany();
    expect(await 赢单()).toMatchObject({ ok: true });
    expect(await prisma.entCommission.count()).toBe(0);
  });

  it("项目模式没开：同样拦", async () => {
    mocks.开 = false;
    expect(await 改按人提成比例({ [乙]: { 底价比例: 1, 溢价比例: 10 } })).toMatchObject({ ok: false, error: expect.stringContaining("没开") });
    expect(await 存的()).toBeNull();
    expect(await 记录()).toEqual([]);
  });
});
