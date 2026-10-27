/**
 * 企业版提成 + 组长分配（2026-10-26，迁移 051）。
 * 钉的是：2% / 30% 怎么算、成交低于底价溢价算 0；改 A / B 进操作记录；分配合计不能超 100%、剩下的归组长；
 * 组长以外的销售改不了分配；赢单（进订单）那一刻固定实际提成；开关关着照旧——一行不写、卡片不出。
 * 10-27：比例分内贸 / 外贸 / 不限三套，按项目负责人的业务线取，两边都做或没设的用不限；旧的平铺值当不限读。
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
import { 存项目底价, 存提成分配, 改提成比例, 更正实际提成 } from "@/app/(app)/projects/commission-actions";
import { 读项目提成, 读提成比例 } from "@/lib/project/commission-db";
import { 改节点 } from "@/lib/project/db";
import { 算提成, 分到每人, 分配问题, 默认提成比例, 更正问题 } from "@/lib/project/commission";
import { 读组织 } from "@/lib/enterprise/org";
import { invalidateSettingsCache } from "@/lib/settings";

let 甲: string; // 老板
let 乙: string; // 组长（项目负责人）
let 丙: string; // 已进组的组员
let 丁: string; // 邀请了还没同意
let 项目id: string;

/** 三套比例：没单独给内贸 / 外贸的跟不限一样 */
const 三套 = (底价比例: number, 溢价比例: number, 另: Partial<Record<"内贸" | "外贸", [number, number]>> = {}) => {
  const 套 = (k: "内贸" | "外贸") => ({ 底价比例: 另[k]?.[0] ?? 底价比例, 溢价比例: 另[k]?.[1] ?? 溢价比例 });
  return { 内贸: 套("内贸"), 外贸: 套("外贸"), 不限: { 底价比例, 溢价比例 } };
};
const 记录 = () => prisma.auditLog.findMany({ orderBy: { at: "asc" }, select: { entity: true, entityId: true, summary: true } });
const 当 = (id: string, role: string) => { mocks.user = { ...mocks.user, id, role }; };
const 名 = (uid: string) => ({ [甲]: "甲", [乙]: "乙", [丙]: "丙", [丁]: "丁" })[uid] ?? "?";
const 卡 = async (who: { id: string; role: string }) => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: 项目id } });
  const 在组 = (await prisma.projectMember.findMany({ where: { projectId: 项目id, inviteStatus: "JOINED" } })).map((m) => m.userId);
  return 读项目提成(who, p, 在组, null, 名, prisma);
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.开 = true;
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  丙 = (await prisma.user.create({ data: { email: "bing", name: "丙", title: "", role: "SALES", password: "x" } })).id;
  丁 = (await prisma.user.create({ data: { email: "ding", name: "丁", title: "", role: "SALES", password: "x" } })).id;
  当(甲, "ADMIN");
  const c = await prisma.customer.create({ data: { name: "客户", phone: "13800000001", salesOwnerId: 乙 } });
  项目id = (await prisma.project.create({
    data: { name: "一期", customerId: c.id, ownerId: 乙, creatorId: 乙, phase: "商机", node: "首款支付", amount: 120000 },
  })).id;
  await prisma.projectMember.createMany({
    data: [
      { projectId: 项目id, userId: 乙, inviteStatus: "JOINED" },
      { projectId: 项目id, userId: 丙, inviteStatus: "JOINED" },
      { projectId: 项目id, userId: 丁, inviteStatus: "INVITED" },
    ],
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("算法", () => {
  it("底价 × 2% + (成交 − 底价) × 30%", () => {
    expect(算提成(120000, 100000, 默认提成比例)).toEqual({
      成交金额: 120000, 项目底价: 100000, 项目溢价: 20000, 底价提成: 2000, 溢价提成: 6000, 合计: 8000,
    });
  });
  it("成交低于底价：溢价算 0，不出负数", () => {
    expect(算提成(80000, 100000, 默认提成比例)).toMatchObject({ 项目溢价: 0, 底价提成: 2000, 溢价提成: 0, 合计: 2000 });
  });
  it("底价没填不出数", () => {
    expect(算提成(120000, null, 默认提成比例)).toBeNull();
  });
  it("没设过比例：默认 2% / 30%", async () => {
    expect(await 读提成比例()).toEqual(三套(2, 30));
  });
  it("分配合计超 100% 报错；正好 100% 行", () => {
    expect(分配问题({ a: 60, b: 40.01 })).toMatch(/超过 100%/);
    expect(分配问题({ a: 60, b: 40 })).toBeNull();
    expect(分配问题({ a: 0.1, b: 0.2, c: 99.7 })).toBeNull();
  });
  it("剩下的（含零头）归组长；不在组的那份回到组长", () => {
    const 在组 = new Set(["组长", "x", "y"]);
    expect(分到每人(100, "组长", [{ userId: "x", percent: 33.33 }, { userId: "y", percent: 33.33 }, { userId: "走了", percent: 20 }], 在组)).toEqual([
      { userId: "组长", 比例: 33.34, 金额: 33.34, 组长: true },
      { userId: "x", 比例: 33.33, 金额: 33.33, 组长: false },
      { userId: "y", 比例: 33.33, 金额: 33.33, 组长: false },
    ]);
  });
});

describe("提成比例 A / B", () => {
  it("老板改了进操作记录；没改动不记", async () => {
    expect(await 改提成比例(三套(3, 25, { 内贸: [2, 30], 外贸: [2, 30] }))).toEqual({ ok: true, 变了: true });
    expect(await 改提成比例(三套(3, 25, { 内贸: [2, 30], 外贸: [2, 30] }))).toEqual({ ok: true, 变了: false });
    expect(await 读提成比例()).toEqual(三套(3, 25, { 内贸: [2, 30], 外贸: [2, 30] }));
    expect(await 改提成比例(三套(3, 25, { 内贸: [1.5, 20], 外贸: [2, 30] }))).toEqual({ ok: true, 变了: true });
    expect(await 记录()).toEqual([
      { entity: "Setting", entityId: "entCommissionRates", summary: "提成比例：不限 底价 2% → 3%，溢价 30% → 25%" },
      { entity: "Setting", entityId: "entCommissionRates", summary: "提成比例：内贸 底价 2% → 1.5%，溢价 30% → 20%" },
    ]);
  });
  it("旧的平铺值（10-27 之前存的）当不限读，内贸 / 外贸跟着它", async () => {
    await prisma.setting.create({ data: { key: "entCommissionRates", value: JSON.stringify({ 底价比例: 4, 溢价比例: 35 }) } });
    invalidateSettingsCache();
    expect(await 读提成比例()).toEqual(三套(4, 35));
  });
  it("少一套、不是对象：拦，库里不写", async () => {
    const { 外贸: _, ...少外贸 } = 三套(3, 25);
    expect(await 改提成比例({ ...少外贸, 外贸: { 底价比例: 3 } } as never)).toMatchObject({ ok: false, error: expect.stringContaining("外贸") });
    expect(await 改提成比例(null as never)).toMatchObject({ ok: false });
    expect(await prisma.setting.findUnique({ where: { key: "entCommissionRates" } })).toBeNull();
  });
  it("销售改不了；超出 0–100 拦", async () => {
    当(乙, "SALES");
    expect(await 改提成比例(三套(3, 25))).toMatchObject({ ok: false, error: expect.stringContaining("只有老板") });
    当(甲, "ADMIN");
    expect(await 改提成比例(三套(3, 25, { 外贸: [101, 25] }))).toMatchObject({ ok: false, error: expect.stringContaining("外贸") });
    expect(await prisma.setting.findUnique({ where: { key: "entCommissionRates" } })).toBeNull();
    expect(await 记录()).toEqual([]);
  });
});

describe("项目底价和分配", () => {
  it("组长填底价、分给组员；预估按现在的比例，剩下归组长；各记一条操作记录", async () => {
    当(乙, "SALES");
    expect(await 存项目底价(项目id, 100000)).toEqual({ ok: true, 变了: true });
    expect(await 存提成分配(项目id, { [丙]: 30 })).toEqual({ ok: true, 变了: true });
    const t = (await 卡({ id: 乙, role: "SALES" }))!;
    expect(t.预估).toMatchObject({ 成交金额: 120000, 项目底价: 100000, 项目溢价: 20000, 合计: 8000 });
    expect(t.实际).toBeNull();
    expect(t.每人).toEqual([
      { userId: 乙, name: "乙", 比例: 70, 金额: 5600, 组长: true },
      { userId: 丙, name: "丙", 比例: 30, 金额: 2400, 组长: false },
    ]);
    expect(t.能改).toBe(true);
    expect(t.组员).toEqual([{ userId: 丙, name: "丙" }]);
    expect(await 记录()).toEqual([
      { entity: "EntCommission", entityId: 项目id, summary: "项目「一期」的项目底价：空 → 100000" },
      { entity: "EntCommission", entityId: 项目id, summary: "项目「一期」的提成分配：丙 30%，组长 70%" },
    ]);
  });

  it("合计超 100% 拦，一行不写", async () => {
    当(乙, "SALES");
    expect(await 存提成分配(项目id, { [丙]: 100.5 })).toMatchObject({ ok: false });
    expect(await prisma.entCommissionSplit.count()).toBe(0);
    expect(await 记录()).toEqual([]);
  });

  it("只能分给已进组的人：没同意邀请的、组长自己都拦", async () => {
    当(乙, "SALES");
    expect(await 存提成分配(项目id, { [丁]: 10 })).toMatchObject({ ok: false, error: expect.stringContaining("已经进组") });
    expect(await 存提成分配(项目id, { [乙]: 10 })).toMatchObject({ ok: false, error: expect.stringContaining("组长自己") });
    expect(await prisma.entCommissionSplit.count()).toBe(0);
  });

  it("组长以外的销售（哪怕是组员）改不了分配、底价", async () => {
    当(丙, "SALES");
    expect(await 存提成分配(项目id, { [丙]: 90 })).toMatchObject({ ok: false, error: expect.stringContaining("只有组长") });
    expect(await 存项目底价(项目id, 1)).toMatchObject({ ok: false });
    expect(await prisma.entCommissionSplit.count()).toBe(0);
    expect(await prisma.entCommission.count()).toBe(0);
    expect(await 记录()).toEqual([]);
    // 组员能看、不能改
    expect(await 卡({ id: 丙, role: "SALES" })).toMatchObject({ 能改: false });
    // 不在组的销售看不到
    expect(await 卡({ id: 丁, role: "SALES" })).toBeNull();
  });

  it("老板也能改分配", async () => {
    expect(await 存提成分配(项目id, { [丙]: 50 })).toEqual({ ok: true, 变了: true });
  });

  it("项目底价只有项目负责人填：老板、总管理员也不代填，一行不写、不记", async () => {
    当(甲, "ADMIN");
    expect(await 存项目底价(项目id, 100000)).toMatchObject({ ok: false, error: "项目底价由项目负责人填" });
    expect(await prisma.entCommission.count()).toBe(0);
    expect(await 记录()).toEqual([]);
    // 卡片上：老板能改分配、不能填底价；负责人两样都能；组员都不能
    expect(await 卡({ id: 甲, role: "ADMIN" })).toMatchObject({ 能改: true, 能填底价: false });
    expect(await 卡({ id: 乙, role: "SALES" })).toMatchObject({ 能改: true, 能填底价: true });
    expect(await 卡({ id: 丙, role: "SALES" })).toMatchObject({ 能改: false, 能填底价: false });
    当(乙, "SALES");
    expect(await 存项目底价(项目id, 100000)).toEqual({ ok: true, 变了: true });
  });

  it("成交金额低于项目底价：项目溢价算 0，提成只剩底价那份，不出负数", async () => {
    当(乙, "SALES");
    await 存项目底价(项目id, 100000);
    await prisma.project.update({ where: { id: 项目id }, data: { amount: 80000 } });
    const t = (await 卡({ id: 乙, role: "SALES" }))!;
    expect(t.预估).toMatchObject({ 成交金额: 80000, 项目底价: 100000, 项目溢价: 0, 合计: 2000 });
    expect(t.每人.every((x) => (x.金额 ?? 0) >= 0)).toBe(true);
    // 正好等于底价：溢价也是 0
    await prisma.project.update({ where: { id: 项目id }, data: { amount: 100000 } });
    expect((await 卡({ id: 乙, role: "SALES" }))!.预估).toMatchObject({ 项目溢价: 0, 合计: 2000 });
  });
});

describe("赢单固定实际提成", () => {
  it("进订单那一刻按当时的比例固定；之后改比例、改金额不动实际；退不回商机，固定一直不动", async () => {
    当(乙, "SALES");
    await 存项目底价(项目id, 100000);
    await 存提成分配(项目id, { [丙]: 25 });
    当(甲, "ADMIN");
    expect(await 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true, 变了: true });
    const c = await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } });
    expect(c).toMatchObject({ fixedDeal: 120000, fixedBase: 100000, fixedRateBase: 2, fixedRatePremium: 30, fixedTotal: 8000 });
    expect(c.fixedAt).toBeInstanceOf(Date);

    await 改提成比例(三套(5, 50));
    await prisma.project.update({ where: { id: 项目id }, data: { amount: 200000 } });
    const t = (await 卡({ id: 乙, role: "SALES" }))!;
    expect(t.实际).toMatchObject({ 成交金额: 120000, 项目底价: 100000, 合计: 8000, 比例: { 底价比例: 2, 溢价比例: 30 } });
    expect(t.预估?.合计).toBe(55000); // 预估跟着现在的比例和金额走，只作参考
    expect(t.每人.map((x) => x.金额)).toEqual([6000, 2000]); // 分按实际提成算

    // 固定了以后底价不能改
    当(乙, "SALES");
    expect(await 存项目底价(项目id, 90000)).toMatchObject({ ok: false, error: expect.stringContaining("已经赢单") });

    // 进了订单不回商机（10-26 三大阶段规则），固定的提成也就一直不动
    当(甲, "ADMIN");
    expect(await 改节点(mocks.user, 项目id, { phase: "商机", node: "首款支付" })).toMatchObject({ ok: false, error: expect.stringContaining("不能退回商机") });
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedTotal: 8000, basePrice: 100000 });
  });

  it("没填底价就赢单：在订单阶段补填底价时固定", async () => {
    expect(await 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true });
    expect(await prisma.entCommission.findUnique({ where: { projectId: 项目id } })).toBeNull();
    当(乙, "SALES");
    expect(await 存项目底价(项目id, 100000)).toEqual({ ok: true, 变了: true });
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedTotal: 8000 });
  });
});

describe("按负责人的业务线取比例（10-27）", () => {
  const 卡带组织 = async () => {
    const p = await prisma.project.findUniqueOrThrow({ where: { id: 项目id } });
    const 在组 = (await prisma.projectMember.findMany({ where: { projectId: 项目id, inviteStatus: "JOINED" } })).map((m) => m.userId);
    return (await 读项目提成({ id: 乙, role: "SALES" }, p, 在组, await 读组织(), 名, prisma))!;
  };
  beforeEach(async () => {
    await 改提成比例(三套(2, 30, { 内贸: [1, 10], 外贸: [3, 40] }));
    当(乙, "SALES");
    await 存项目底价(项目id, 100000);
    当(甲, "ADMIN");
  });
  it("负责人是内贸：预估和赢单固定都按内贸那一套", async () => {
    await prisma.entMember.create({ data: { userId: 乙, bizRole: "sales", line: "内贸" } });
    const t = await 卡带组织();
    expect(t.范围).toBe("内贸");
    expect(t.比例).toEqual({ 底价比例: 1, 溢价比例: 10 });
    expect(t.预估?.合计).toBe(3000);
    await 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" });
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedRateBase: 1, fixedRatePremium: 10, fixedTotal: 3000 });
  });
  it("负责人是外贸：按外贸", async () => {
    await prisma.entMember.create({ data: { userId: 乙, bizRole: "sales", line: "外贸" } });
    expect((await 卡带组织()).预估?.合计).toBe(11000);
    await 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" });
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedRateBase: 3, fixedRatePremium: 40, fixedTotal: 11000 });
  });
  it("两边都做（业务线空）、不在组织里：按不限", async () => {
    expect((await 卡带组织()).范围).toBe("不限");
    await prisma.entMember.create({ data: { userId: 乙, bizRole: "sales", line: null } });
    const t = await 卡带组织();
    expect([t.范围, t.预估?.合计]).toEqual(["不限", 8000]);
    await 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" });
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedRateBase: 2, fixedRatePremium: 30, fixedTotal: 8000 });
  });
});

describe("总管理员更正已固定提成（10-27）", () => {
  let 戊: string; // 总管理员
  const 赢单 = async () => {
    当(乙, "SALES");
    await 存项目底价(项目id, 100000);
    await 存提成分配(项目id, { [丙]: 25 });
    当(甲, "ADMIN");
    await 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" });
  };
  const 组织卡 = async (who: { id: string; role: string }) => {
    const p = await prisma.project.findUniqueOrThrow({ where: { id: 项目id } });
    const 在组 = (await prisma.projectMember.findMany({ where: { projectId: 项目id, inviteStatus: "JOINED" } })).map((m) => m.userId);
    return 读项目提成(who, p, 在组, await 读组织(), 名, prisma);
  };
  beforeEach(async () => {
    戊 = (await prisma.user.create({ data: { email: "wu", name: "戊", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 戊, bizRole: "director" } });
  });

  it("纯函数：金额要填、不能负、最多两位小数；原因必填、最多 200 字", () => {
    expect(更正问题(null, "x")).toBe("要填更正后的实际提成");
    expect(更正问题(-1, "x")).toBe("实际提成不能是负数");
    expect(更正问题(1.234, "x")).toBe("实际提成最多两位小数");
    expect(更正问题(100, "  ")).toBe("要写更正原因");
    expect(更正问题(100, "字".repeat(201))).toBe("更正原因最多 200 个字");
    expect(更正问题(0, "全额退款")).toBeNull();
  });

  it("总管理员改合计、写原因，操作记录留前后值；分配按新合计分；卡片标「已更正」", async () => {
    await 赢单();
    当(戊, "SALES");
    expect(await 更正实际提成(项目id, 6000, "  回款少一笔  ")).toEqual({ ok: true, 变了: true });
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedTotal: 6000, fixedDeal: 120000, fixedBase: 100000 });
    const 改 = await prisma.auditLog.findFirstOrThrow({ where: { summary: { contains: "更正实际提成" } } });
    expect(改.summary).toBe("项目「一期」更正实际提成：8000 → 6000，原因：回款少一笔");
    expect(JSON.parse(String(改.detail))).toEqual({ 实际提成: { 前: 8000, 后: 6000 }, 原因: "回款少一笔" });
    const t = (await 组织卡({ id: 戊, role: "SALES" }))!;
    expect(t.实际).toMatchObject({ 合计: 6000, 按算式: 8000 });
    expect(t.能更正).toBe(true);
    expect(t.每人.map((x) => x.金额)).toEqual([4500, 1500]);
    // 一样的金额不再记
    const 条数 = await prisma.auditLog.count();
    expect(await 更正实际提成(项目id, 6000, "再点一次")).toEqual({ ok: true, 变了: false });
    expect(await prisma.auditLog.count()).toBe(条数);
  });

  it("别人都不行：管理员、销售管理、组长、组员拦下一行不写，卡片上也没有入口；没设业务角色的老板按总管理算", async () => {
    await 赢单();
    const 己 = (await prisma.user.create({ data: { email: "ji", name: "己", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 己, bizRole: "admin" } });
    const 庚 = (await prisma.user.create({ data: { email: "geng", name: "庚", title: "", role: "MANAGER", password: "x" } })).id;
    for (const [id, role] of [[己, "SALES"], [庚, "MANAGER"], [乙, "SALES"], [丙, "SALES"]] as const) {
      当(id, role);
      expect(await 更正实际提成(项目id, 1, "改")).toMatchObject({ ok: false, error: "只有总管理员能更正已固定的提成" });
      expect((await 组织卡({ id, role }))?.能更正).toBe(false);
    }
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedTotal: 8000 });
    expect((await 组织卡({ id: 己, role: "SALES" }))!.实际).not.toHaveProperty("按算式");
    expect((await 组织卡({ id: 甲, role: "ADMIN" }))?.能更正).toBe(true);
  });

  it("还没固定：不让更正，卡片也不给入口；原因没写拦", async () => {
    当(乙, "SALES");
    await 存项目底价(项目id, 100000);
    当(戊, "SALES");
    expect(await 更正实际提成(项目id, 100, "x")).toMatchObject({ ok: false, error: expect.stringContaining("还没固定") });
    expect((await 组织卡({ id: 戊, role: "SALES" }))?.能更正).toBe(false);
    expect(await 更正实际提成(项目id, 100, "")).toMatchObject({ ok: false, error: "要写更正原因" });
  });

  it("不是企业版：拦，一行不写", async () => {
    await 赢单();
    vi.stubEnv("CRM_ENTERPRISE", "");
    当(戊, "SALES");
    expect(await 更正实际提成(项目id, 1, "改")).toMatchObject({ ok: false, error: "提成是企业版的功能" });
    expect(await prisma.entCommission.findUniqueOrThrow({ where: { projectId: 项目id } })).toMatchObject({ fixedTotal: 8000 });
  });
});

describe("开关关着照旧", () => {
  it("不是企业版：三个动作都拦，一行不写、不记；卡片不出；进订单不建提成表", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    当(乙, "SALES");
    expect(await 存项目底价(项目id, 100000)).toMatchObject({ ok: false, error: "提成是企业版的功能" });
    expect(await 存提成分配(项目id, { [丙]: 30 })).toMatchObject({ ok: false, error: "提成是企业版的功能" });
    当(甲, "ADMIN");
    expect(await 改提成比例(三套(3, 25))).toMatchObject({ ok: false, error: "提成是企业版的功能" });
    expect(await 卡({ id: 甲, role: "ADMIN" })).toBeNull();
    expect(await 改节点(mocks.user, 项目id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true });
    expect(await prisma.entCommission.count()).toBe(0);
    expect(await prisma.entCommissionSplit.count()).toBe(0);
    expect(await prisma.setting.findUnique({ where: { key: "entCommissionRates" } })).toBeNull();
    expect((await 记录()).filter((r) => r.entity === "EntCommission" || r.entity === "Setting")).toEqual([]);
  });

  it("项目模式没开：同样拦", async () => {
    mocks.开 = false;
    expect(await 存项目底价(项目id, 100000)).toMatchObject({ ok: false, error: expect.stringContaining("没开") });
    expect(await 存提成分配(项目id, { [丙]: 30 })).toMatchObject({ ok: false, error: expect.stringContaining("没开") });
    expect(await 改提成比例(三套(3, 25))).toMatchObject({ ok: false, error: expect.stringContaining("没开") });
    expect(await prisma.entCommission.count()).toBe(0);
    expect(await 记录()).toEqual([]);
  });
});
