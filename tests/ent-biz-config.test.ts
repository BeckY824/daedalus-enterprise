/**
 * 企业版业务配置（2026-10-28，business-config.ts 企业版锁定 / 企业版默认业务 + dict-kinds.ts 默认停用）：
 *   - 锁定：存着外贸 / 公海 30 天 / 项目模式关，读出来一律是通用、0 天、开着；存进去也先锁
 *   - 默认职位和简介：没存过、或还是桌面端某个预设原样 → 换成企业版的；人改过的照存的；只在读时换，不回写库
 *   - 无效原因「预算不足」「竞品中标」默认停用：新建的库停着；老库补停一次；补停过以后管理员再启用不会又被停
 *   - 开关关着：业务配置照存的读，字典一行不建
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, getSetting, invalidateSettingsCache } from "@/lib/settings";
import { getBusiness, saveBusiness, BUSINESS_KEY, BUSINESS_PRESETS, DEFAULT_BUSINESS, 企业版职位, 企业版简介 } from "@/lib/business";
import { 企业字典, 可选项 } from "@/lib/enterprise/dict";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const 外贸 = Object.entries(BUSINESS_PRESETS).find(([, p]) => p.template === "trade")![1];

describe("企业版锁定", () => {
  it("存着外贸、30 天、项目模式关：读出来是通用、0 天、开着", async () => {
    await setSetting(BUSINESS_KEY, { ...外贸, poolDays: 30, projectMode: false });
    expect(await getBusiness()).toMatchObject({ template: "general", poolDays: 0, projectMode: true });
  });

  it("存进去也先锁：库里就是锁过的", async () => {
    await saveBusiness({ ...外贸, poolDays: 30, projectMode: false });
    invalidateSettingsCache();
    expect(await getSetting(BUSINESS_KEY)).toMatchObject({ template: "general", poolDays: 0, projectMode: true });
  });
});

describe("默认职位和简介", () => {
  it("没存过：企业版的 19 个职位和企业版简介", async () => {
    const b = await getBusiness();
    expect(b.grades).toEqual([...企业版职位]);
    expect(企业版职位).toHaveLength(19);
    expect(b.brief).toBe(企业版简介);
  });

  it("存的还是桌面端某个预设原样：也换；只在读时换，库里不动", async () => {
    await setSetting(BUSINESS_KEY, 外贸);
    const b = await getBusiness();
    expect(b.grades).toEqual([...企业版职位]);
    expect(b.brief).toBe(企业版简介);
    invalidateSettingsCache();
    expect(await getSetting(BUSINESS_KEY)).toMatchObject({ grades: 外贸.grades, brief: 外贸.brief });
  });

  it("人改过的照存的", async () => {
    await setSetting(BUSINESS_KEY, { grades: ["老板", "采购"], brief: "我们自己写的" });
    const b = await getBusiness();
    expect(b.grades).toEqual(["老板", "采购"]);
    expect(b.brief).toBe("我们自己写的");
  });
});

describe("开关关着：照存的", () => {
  it("锁定、默认职位都不做", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await getBusiness()).toEqual(DEFAULT_BUSINESS);
    await saveBusiness({ ...外贸, poolDays: 30, projectMode: false });
    invalidateSettingsCache();
    expect(await getBusiness()).toMatchObject({ template: "trade", poolDays: 30, projectMode: false, grades: 外贸.grades, brief: 外贸.brief });
  });
});

describe("无效原因默认停用两项", () => {
  const 停的 = ["预算不足", "竞品中标"];
  const 启用的名 = async () => (await 企业字典("invalid")).filter((x) => x.active).map((x) => x.name);

  it("新建的库：这两项在列表里但停着，可选项里没有；别的照旧启用", async () => {
    const 全部 = await 企业字典("invalid");
    for (const n of 停的) expect(全部.find((x) => x.name === n)?.active).toBe(false);
    expect(全部.filter((x) => x.active).length).toBeGreaterThan(0);
    const 可选 = await 可选项("invalid");
    for (const n of 停的) expect(可选).not.toContain(n);
  });

  it("老库（这两项还启用着、没记号）：补停一次；管理员再启用，再读不会又停", async () => {
    await 企业字典("invalid");
    await prisma.entDictItem.updateMany({ where: { kind: "invalid" }, data: { active: true } });
    await prisma.setting.deleteMany({ where: { key: "entDict.defaultOff.invalid" } });
    for (const n of 停的) expect(await 启用的名()).not.toContain(n);

    await prisma.entDictItem.updateMany({ where: { kind: "invalid", name: "预算不足" }, data: { active: true } });
    expect(await 启用的名()).toContain("预算不足");
  });

  it("老库里改过名的那一项不动", async () => {
    await 企业字典("invalid");
    await prisma.entDictItem.updateMany({ where: { kind: "invalid" }, data: { active: true } });
    await prisma.entDictItem.updateMany({ where: { kind: "invalid", name: "竞品中标" }, data: { name: "输给了别家" } });
    await prisma.setting.deleteMany({ where: { key: "entDict.defaultOff.invalid" } });
    const 启用 = await 启用的名();
    expect(启用).toContain("输给了别家");
    expect(启用).not.toContain("预算不足");
  });

  it("开关关着：一行不建", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 可选项("invalid")).toEqual([]);
    expect(await prisma.entDictItem.count()).toBe(0);
  });
});

/*
  10-28 对照排查并进来的两处：首页「有 N 条新线索」数的是项目线索阶段（不是老 Lead 表）；
  「导入记录」栏和空库「去导入」都从 import-perm.ts 的 能导入导出 取，不另写一份。
*/
describe("首页新线索数", () => {
  it("只数线索阶段、没结局、不在公海的项目；老 Lead 表不算", async () => {
    const { 数新线索 } = await import("@/lib/project/list");
    const u = await prisma.user.create({ data: { email: "a@x", name: "甲", password: "x", title: "", role: "SALES" } });
    const c = await prisma.customer.create({ data: { name: "客户一", phone: "13800000001", salesOwnerId: u.id } });
    let 序 = 0;
    const 项目 = (补: Record<string, unknown> = {}) =>
      prisma.project.create({ data: { name: `项目${++序}`, customerId: c.id, ownerId: u.id, creatorId: u.id, phase: "线索", node: "潜客培育", ...补 } });
    await 项目();
    await 项目();
    await 项目({ result: "线索流失" });
    await 项目({ pooledAt: new Date() });
    await 项目({ phase: "商机", node: "明确需求" });
    await prisma.lead.create({ data: { name: "老线索", ownerId: u.id } });
    expect(await 数新线索()).toBe(2);
  });

  it("首页企业版只用项目时用它，其余照旧数 Lead 表", async () => {
    const { readFile } = await import("node:fs/promises");
    const s = await readFile("src/app/(app)/dashboard/page.tsx", "utf8");
    expect(s).toMatch(/只用项目 \? 数新线索\(\) : prisma\.lead\.count\(\)/);
    expect(s).not.toMatch(/await prisma\.lead\.count\(\)\) === 0/);
    expect(s.match(/数线索\(只用项目\)/g)).toHaveLength(2);
  });
});

describe("导入入口跟导入权限走", () => {
  it("「导入记录」栏：企业版只给老板、总管理员；开关关着照旧都有", async () => {
    const { readFile } = await import("node:fs/promises");
    const body = await readFile("src/app/(app)/settings/SettingsBody.tsx", "utf8");
    expect(body).toContain("const 能导入 = await 能导入导出(me);");
    expect(body).toContain("导入记录={能导入}");
    const view = await readFile("src/app/(app)/settings/SettingsView.tsx", "utf8");
    expect(view).toContain("导入记录 = true,");
    expect(view).toMatch(/\.\.\.\(导入记录 \? \[\{ key: "imports"/);
  });

  it("空库「去导入」用 能导入导出，不只认老板", async () => {
    const { readFile } = await import("node:fs/promises");
    const s = await readFile("src/app/(app)/dashboard/page.tsx", "utf8");
    expect(s).toMatch(/去导入 = async[^\n]*await 能导入导出\(user\)/);
    expect(s).not.toMatch(/role === "ADMIN";\s*$/m);
  });
});
