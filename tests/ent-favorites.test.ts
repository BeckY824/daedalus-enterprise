/**
 * 左栏收藏（客户、项目）在企业版三种身份下：普通账号正常收；切换视图是只读，不许替被看的人改，回一句话、不崩整页；
 * 只读管理员的收藏是自己的偏好，不算改业务数据，照收。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const 罐 = vi.hoisted(() => ({ 票: new Map<string, string>() }));
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({
    get: (n: string) => (罐.票.has(n) ? { name: n, value: 罐.票.get(n)! } : undefined),
    set: (n: string, v: string) => void 罐.票.set(n, v),
    delete: (n: string) => void 罐.票.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { resetDb } from "./reset";
import { setSetting, getSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 开始视图, 退出视图 } from "@/app/(app)/view-as-actions";
import { 切换收藏, 切换项目收藏 } from "@/app/(app)/favorites";
import { 读收藏, 收藏键, 读项目收藏, 项目收藏键, 项目收藏了吗 } from "@/lib/favorites";
import { 放回公海 } from "@/lib/project/db";

const 签会话 = (sub: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));
async function 登录成(id: string) {
  罐.票.clear();
  罐.票.set("crm_session", await 签会话(id));
  忘掉企业版范围();
}

const 人 = { 总管: "", 只读管: "", 甲: "", 乙: "" };
let 甲的客户 = "";
let 甲的项目 = "";
let 序 = 0;
const 建项目 = async (ownerId: string, name = `项目${++序}`) =>
  (await prisma.project.create({ data: { name, customerId: 甲的客户, ownerId, creatorId: ownerId, phase: "商机", node: "明确需求" } })).id;
const 甲 = () => ({ id: 人.甲, role: "SALES", name: "业务员甲" });

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
    vi.stubEnv("CRM_ENT_VIEW_AS", "1"); // 切换视图开关（11-12 起默认关）
  罐.票.clear();
  const 部 = (await prisma.entDept.create({ data: { name: "销售一部" } })).id;
  const 建 = async (名: string, role: string, bizRole: string) => {
    const u = await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role, password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, deptId: bizRole === "sales" ? 部 : null, bizRole } });
    return u.id;
  };
  人.总管 = await 建("总管", "SALES", "director");
  人.只读管 = await 建("只读管", "ADMIN", "admin");
  人.甲 = await 建("业务员甲", "SALES", "sales");
  人.乙 = await 建("业务员乙", "SALES", "sales");
  甲的客户 = (await prisma.customer.create({ data: { name: "甲的客户", phone: "13900000001", salesOwnerId: 人.甲 } })).id;
  甲的项目 = await 建项目(人.甲, "甲的项目");
  await setSetting("enterprise.rule.org_scope", true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  罐.票.clear();
  忘掉企业版范围();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("客户收藏", () => {
  it("普通账号：能收、左栏读得到；再点拿掉", async () => {
    await 登录成(人.甲);
    expect(await 切换收藏(甲的客户)).toEqual({ ok: true, 收藏了: true });
    expect((await 读收藏(人.甲)).map((c) => c.name)).toEqual(["甲的客户"]);
    expect(await 切换收藏(甲的客户)).toEqual({ ok: true, 收藏了: false });
    expect(await 读收藏(人.甲)).toEqual([]);
  });

  it("切换视图：回一句话、不抛错，被看的人的收藏不动", async () => {
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    const r = await 切换收藏(甲的客户);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("切换视图");
    await 退出视图();
    expect((await getSetting<string[]>(收藏键(人.甲))) ?? []).toEqual([]);
    expect((await getSetting<string[]>(收藏键(人.总管))) ?? []).toEqual([]);
  });

  it("只读管理员：收藏是自己的偏好，照收", async () => {
    await 登录成(人.只读管);
    expect(await 切换收藏(甲的客户)).toEqual({ ok: true, 收藏了: true });
    expect((await 读收藏(人.只读管)).map((c) => c.name)).toEqual(["甲的客户"]);
  });
});

describe("项目收藏", () => {
  it("普通账号：能收、左栏读得到、星亮；再点拿掉", async () => {
    await 登录成(人.甲);
    expect(await 切换项目收藏(甲的项目)).toEqual({ ok: true, 收藏了: true });
    expect(await 读项目收藏(甲())).toEqual([{ id: 甲的项目, name: "甲的项目" }]);
    expect(await 项目收藏了吗(人.甲, 甲的项目)).toBe(true);
    expect(await 切换项目收藏(甲的项目)).toEqual({ ok: true, 收藏了: false });
    expect(await 读项目收藏(甲())).toEqual([]);
    expect(await 项目收藏了吗(人.甲, 甲的项目)).toBe(false);
  });

  it("切换视图：回一句话、不抛错，被看的人的收藏不动", async () => {
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    const r = await 切换项目收藏(甲的项目);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("切换视图");
    await 退出视图();
    expect((await getSetting<string[]>(项目收藏键(人.甲))) ?? []).toEqual([]);
    expect((await getSetting<string[]>(项目收藏键(人.总管))) ?? []).toEqual([]);
  });

  it("只读管理员：照收", async () => {
    await 登录成(人.只读管);
    expect(await 切换项目收藏(甲的项目)).toEqual({ ok: true, 收藏了: true });
    expect((await 读项目收藏({ id: 人.只读管, role: "ADMIN" })).map((p) => p.name)).toEqual(["甲的项目"]);
  });

  it("看不到的项目：说不在了、不占名额", async () => {
    await 登录成(人.乙);
    expect(await 切换项目收藏(甲的项目)).toEqual({ ok: false, error: "这个项目已经不在了" });
    expect((await getSetting<string[]>(项目收藏键(人.乙))) ?? []).toEqual([]);
  });

  it("后来不归他看了、删进回收站了：左栏不留，也不占名额", async () => {
    const 乙的 = await 建项目(人.乙);
    const 乙的二 = await 建项目(人.乙);
    await 登录成(人.乙);
    await 切换项目收藏(乙的);
    await 切换项目收藏(乙的二);
    await prisma.project.update({ where: { id: 乙的 }, data: { ownerId: 人.甲, creatorId: 人.甲 } });
    await prisma.project.update({ where: { id: 乙的二 }, data: { deletedAt: new Date() } });
    忘掉企业版范围();
    expect(await 读项目收藏({ id: 人.乙, role: "SALES" })).toEqual([]);
    const 新 = await 建项目(人.乙);
    await 切换项目收藏(新);
    expect(await getSetting<string[]>(项目收藏键(人.乙))).toEqual([新]);
  });

  it("进了公海、他是要回避的原负责人：左栏不显示；同事照常看得到", async () => {
    await 登录成(人.甲);
    await 切换项目收藏(甲的项目);
    expect(await 放回公海(甲(), 甲的项目)).toEqual({ ok: true });
    忘掉企业版范围();
    expect(await 读项目收藏(甲())).toEqual([]);
    await 登录成(人.乙);
    expect(await 切换项目收藏(甲的项目)).toEqual({ ok: true, 收藏了: true });
    expect((await 读项目收藏({ id: 人.乙, role: "SALES" })).map((p) => p.name)).toEqual(["甲的项目"]);
  });

  it("上限 8：新的排最前，挤掉最早的", async () => {
    await 登录成(人.甲);
    const 们: string[] = [];
    for (let i = 0; i < 9; i++) 们.push(await 建项目(人.甲));
    for (const id of 们) await 切换项目收藏(id);
    expect((await 读项目收藏(甲())).map((p) => p.id)).toEqual([...们].reverse().slice(0, 8));
  });
});
