/**
 * 企业版接了飞书登录之后的账号密码（11-03，lib/enterprise/password-login.ts、app/login/actions.ts、lib/auth.ts）：
 *   - 密码只给系统管理员兜底：普通成员、只读管理员知道密码也登不进；登不进一律同一句，不区分没这个号 / 密码错 / 不是系统管理员
 *   - 没接飞书（本机、E2E）：照旧谁都能用密码登
 *   - 组织表里还没有系统管理员（刚部署）：账号角色 ADMIN 的能登，免得谁都进不去
 *   - 改密（自己改、管理员重置）后，别的设备上改密前签发的会话作废；改密的本人当场续一张新票
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { value: jar.get(key)! } : undefined),
    set: (key: string, value: string) => jar.set(key, value),
    delete: (key: string) => jar.delete(key),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));

import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 哈希密码 } from "@/lib/password";
import { login } from "@/app/login/actions";
import { createSession, getSessionUser, SECRET } from "@/lib/auth";
import { changeMyPassword } from "@/app/(app)/settings/actions";
import { 密码登录拒绝话 } from "@/lib/enterprise/password-login";

afterAll(() => prisma.$disconnect());
afterEach(() => {
  vi.unstubAllEnvs();
  jar.clear();
});

const 稍等 = () => new Promise((r) => setTimeout(r, 5));
let 序 = 0;
/** 建号：登录名每次不同（登录限流按登录名记，用例之间互不牵连） */
async function 建号(name: string, 密码: string, opt: { role?: string; bizRole?: string; line?: string } = {}) {
  const u = await prisma.user.create({
    data: { email: `u${++序}-${Date.now()}`, name, title: "", role: opt.role ?? "SALES", password: await 哈希密码(密码) },
  });
  if (opt.bizRole !== undefined) await prisma.entMember.create({ data: { userId: u.id, bizRole: opt.bizRole, line: opt.line ?? null } });
  return u;
}
const 接飞书 = () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  vi.stubEnv("MULTI_TENANT", "");
  vi.stubEnv("ENT_FEISHU_APP_ID", "cli_test");
  vi.stubEnv("ENT_FEISHU_APP_SECRET", "s");
};

describe("接了飞书：账号密码只给系统管理员", () => {
  beforeEach(async () => {
    await resetDb();
    接飞书();
  });

  it("系统管理员（总管理、没设业务线）能用密码登", async () => {
    const 管 = await 建号("总管甲", "pass-1234", { bizRole: "director" });
    expect(await login(管.email, "pass-1234")).toEqual({ ok: true });
    expect((await getSessionUser())?.id).toBe(管.id);
  });

  it("普通销售、只读管理员、条线总管理：密码对也拒，说法和密码错一样；都不发会话", async () => {
    await 建号("总管甲", "pass-1234", { bizRole: "director" });
    const 销售 = await 建号("销售甲", "pass-1234", { bizRole: "sales" });
    const 只读 = await 建号("管理员甲", "pass-1234", { role: "ADMIN", bizRole: "admin" });
    const 条线 = await 建号("条线甲", "pass-1234", { bizRole: "director", line: "内贸" });
    for (const u of [销售, 只读, 条线]) expect(await login(u.email, "pass-1234")).toEqual({ ok: false, error: 密码登录拒绝话 });
    expect(await login(销售.email, "wrong-pass")).toEqual({ ok: false, error: 密码登录拒绝话 });
    expect(await login("no-such-user", "pass-1234")).toEqual({ ok: false, error: 密码登录拒绝话 });
    expect(jar.size).toBe(0);
  });

  it("组织表里还没有系统管理员：账号角色 ADMIN 的能登，普通账号照样拒", async () => {
    const 老板 = await 建号("老板甲", "pass-1234", { role: "ADMIN" });
    const 销售 = await 建号("销售甲", "pass-1234");
    expect(await login(老板.email, "pass-1234")).toEqual({ ok: true });
    expect(await login(销售.email, "pass-1234")).toEqual({ ok: false, error: 密码登录拒绝话 });
  });

  it("没接飞书：照旧谁都能用密码登，错了照旧分开说", async () => {
    vi.stubEnv("ENT_FEISHU_APP_ID", "");
    await 建号("总管甲", "pass-1234", { bizRole: "director" });
    const 销售 = await 建号("销售甲", "pass-1234", { bizRole: "sales" });
    expect(await login(销售.email, "pass-1234")).toEqual({ ok: true });
    expect(await login(销售.email, "wrong-pass")).toEqual({ ok: false, error: "密码错误" });
  });
});

describe("改密后旧会话作废", () => {
  beforeEach(() => resetDb());

  it("自己改密：别的设备上的旧票进不来，本人当场换新票、照样在线", async () => {
    const 我 = await 建号("总管甲", "old-pass-123", { role: "ADMIN" });
    await createSession(我.id);
    const 旧票 = jar.get("crm_session")!;
    await 稍等();
    expect(await changeMyPassword("old-pass-123", "new-pass-456")).toEqual({ ok: true });
    const 新票 = jar.get("crm_session")!;
    expect(新票).not.toBe(旧票);
    expect((await getSessionUser())?.id).toBe(我.id);
    jar.set("crm_session", 旧票);
    expect(await getSessionUser()).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: 我.id } }))?.passwordChangedAt).toBeInstanceOf(Date);
  });

  it("管理员重置别人的密码（写了改密时刻）：那人改密前的票作废，之后登的票能用；没 ims 的老票也作废", async () => {
    const 他 = await 建号("销售甲", "old-pass-123");
    await createSession(他.id);
    const 旧票 = jar.get("crm_session")!;
    await 稍等();
    await prisma.user.update({ where: { id: 他.id }, data: { passwordChangedAt: new Date() } });
    expect(await getSessionUser()).toBeNull();
    await 稍等();
    await createSession(他.id);
    expect((await getSessionUser())?.id).toBe(他.id);
    jar.set("crm_session", 旧票);
    expect(await getSessionUser()).toBeNull();
    const 无ims = await new SignJWT({ sub: 他.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1d").sign(SECRET);
    jar.set("crm_session", 无ims);
    expect(await getSessionUser()).toBeNull();
  });

  it("没改过密的账号：老票（没有 ims）照旧能用", async () => {
    const 他 = await 建号("销售甲", "old-pass-123");
    jar.set("crm_session", await new SignJWT({ sub: 他.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1d").sign(SECRET));
    expect((await getSessionUser())?.id).toBe(他.id);
  });
});
