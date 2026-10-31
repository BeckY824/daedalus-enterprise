/**
 * 企业版切换视图（M-权限-08，lib/enterprise/view-as.ts）：
 *   - 只有总管理员（账号 ADMIN、组织里的总管理员）能切；别人直接 POST action 也拒，不出票
 *   - 切换期间 getCurrentUser 回被看的人（带 视图由 = 真身），读按他的范围照常
 *   - **切换期间服务端所有写一律拒**：create / update / upsert / delete、$executeRaw、写库的 $queryRaw；还有走 action 的那一路
 *   - 退出删票、回到自己，开始 / 退出各一条留痕
 *   - 票只认签它的那个会话；真身不再是总管理员时票不认人，但照样只读
 * 会话票、视图票都从假的 next/headers 里读（同 enterprise-permission-matrix），set / delete 落在这份假 cookie 上。
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
import { setSetting } from "@/lib/settings";
import { getCurrentUser, destroySession } from "@/lib/auth";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读组织 } from "@/lib/enterprise/org";
import { 能切换视图, 视图票, 签视图票, 当前视图 } from "@/lib/enterprise/view-as";
import { 读视图名单 } from "@/lib/enterprise/view-as-menu";
import { 开始视图, 退出视图 } from "@/app/(app)/view-as-actions";
import { patchCustomer } from "@/app/(app)/customers/actions";

const 人 = { 老板: "", 总管: "", 甲: "", 乙: "" };
let 甲的客户 = "";
let 乙的客户 = "";

const 签会话 = (sub: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));
async function 登录成(id: string) {
  罐.票.clear();
  罐.票.set("crm_session", await 签会话(id));
  忘掉企业版范围();
}

describe("企业版切换视图", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    罐.票.clear();
    const 部 = (await prisma.entDept.create({ data: { name: "销售一部" } })).id;
    const 建 = async (名: string, role: string, bizRole?: string) => {
      const u = await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role, password: "x" } });
      if (bizRole) await prisma.entMember.create({ data: { userId: u.id, deptId: bizRole === "director" ? null : 部, bizRole } });
      return u.id;
    };
    人.老板 = await 建("老板", "ADMIN");
    人.总管 = await 建("总管", "SALES", "director");
    人.甲 = await 建("业务员甲", "SALES", "sales");
    人.乙 = await 建("业务员乙", "SALES", "sales");
    甲的客户 = (await prisma.customer.create({ data: { name: "甲的客户", phone: "13900000001", salesOwnerId: 人.甲 } })).id;
    乙的客户 = (await prisma.customer.create({ data: { name: "乙的客户", phone: "13900000002", salesOwnerId: 人.乙 } })).id;
    await setSetting("enterprise.rule.org_scope", true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    罐.票.clear();
    忘掉企业版范围();
  });
  afterAll(() => prisma.$disconnect());

  it("谁能切：老板、总管理员能，业务员不能", async () => {
    const org = await 读组织();
    expect(能切换视图(org, "ADMIN", 人.老板)).toBe(true);
    expect(能切换视图(org, "SALES", 人.总管)).toBe(true);
    expect(能切换视图(org, "SALES", 人.甲)).toBe(false);
  });

  it("非总管理员直接调 action 也被拒，不出票、名单也拿不到", async () => {
    await 登录成(人.甲);
    const r = await 开始视图(人.乙);
    expect(r).toEqual({ ok: false, error: "只有总管理员能切换视图" });
    expect(罐.票.has(视图票)).toBe(false);
    expect(await 读视图名单((await getCurrentUser())!)).toBeNull();
    expect((await getCurrentUser())!.id).toBe(人.甲);
    expect(await prisma.auditLog.count({ where: { action: "view-as" } })).toBe(0);
  });

  it("总管理员切到业务员甲：按甲的权限看，期间一切写被拒；退出后恢复并留痕", async () => {
    await 登录成(人.总管);
    const 名单 = await 读视图名单((await getCurrentUser())!);
    expect(名单?.flatMap((g) => g.人.map((p) => p.id)).sort()).toEqual([人.老板, 人.甲, 人.乙].sort()); // 不列自己
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    expect(罐.票.has(视图票)).toBe(true);
    忘掉企业版范围();

    const me = (await getCurrentUser())!;
    expect(me.id).toBe(人.甲);
    expect(me.视图由).toEqual({ id: 人.总管, name: "总管" });
    // 读：按甲的范围
    expect((await prisma.customer.findMany({ select: { id: true } })).map((c) => c.id)).toEqual([甲的客户]);
    expect(await prisma.$queryRawUnsafe("SELECT 1 AS n")).toBeTruthy();

    // 写：哪一种都拒，code 同只读
    const 拒 = async (p: Promise<unknown>) => {
      const e = await p.then(() => null, (x: unknown) => x as { code?: string; message?: string });
      expect(e, "这条写应该被拒").not.toBeNull();
      expect(e!.code).toBe("CRM_READONLY");
      expect(e!.message).toContain("切换视图");
    };
    await 拒(prisma.customer.create({ data: { name: "新的", phone: "13900000003", salesOwnerId: 人.甲 } }));
    await 拒(prisma.customer.update({ where: { id: 甲的客户 }, data: { name: "改名" } }));
    await 拒(prisma.customer.updateMany({ data: { name: "全改" } }));
    await 拒(prisma.customer.upsert({ where: { id: 甲的客户 }, create: { name: "x", phone: "13900000004", salesOwnerId: 人.甲 }, update: { name: "y" } }));
    await 拒(prisma.customer.delete({ where: { id: 甲的客户 } }));
    await 拒(prisma.customer.deleteMany({}));
    await 拒(prisma.setting.create({ data: { key: "x", value: "1" } }));
    await 拒(prisma.auditLog.create({ data: { userId: 人.总管, userName: "总管", action: "x", entity: "x", summary: "x" } }));
    await 拒(prisma.$executeRawUnsafe(`UPDATE "Customer" SET name = 'x'`));
    await 拒(prisma.$executeRaw`UPDATE "Customer" SET name = 'x'`);
    await 拒(prisma.$queryRawUnsafe(`DELETE FROM "Customer" RETURNING id`));
    // 走界面那条 action（行内改备注）：到写库那一步被拒，不改库
    await 拒(patchCustomer(甲的客户, "remark", "action 改备注"));
    expect((await prisma.customer.findUnique({ where: { id: 甲的客户 } }))!.remark ?? "").not.toBe("action 改备注");

    // 退出：票没了、回到总管、写恢复，开始 / 退出各一条留痕
    expect(await 退出视图()).toEqual({ ok: true });
    expect(罐.票.has(视图票)).toBe(false);
    忘掉企业版范围();
    const 回来 = (await getCurrentUser())!;
    expect(回来.id).toBe(人.总管);
    expect(回来.视图由).toBeUndefined();
    await prisma.customer.update({ where: { id: 甲的客户 }, data: { name: "退出后能改" } });
    const 痕 = await prisma.auditLog.findMany({ where: { action: { in: ["view-as", "view-as-exit"] } }, orderBy: { at: "asc" } });
    expect(痕.map((a) => [a.action, a.userId, a.entityId])).toEqual([
      ["view-as", 人.总管, 人.甲],
      ["view-as-exit", 人.总管, 人.甲],
    ]);
    expect(痕[0].summary).toContain("业务员甲");
  });

  it("票只认签它的那个会话：换个人带着这张票，不认、也不拦", async () => {
    await 登录成(人.甲);
    罐.票.set(视图票, await 签视图票(人.总管, 人.乙));
    expect(await 当前视图()).toBeNull();
    const me = (await getCurrentUser())!;
    expect(me.id).toBe(人.甲);
    expect(me.视图由).toBeUndefined();
    await prisma.customer.update({ where: { id: 甲的客户 }, data: { name: "甲自己改" } });
    // 会话票塞进视图票的位子也不认（没有 typ / va / vb）
    罐.票.set(视图票, 罐.票.get("crm_session")!);
    expect(await 当前视图()).toBeNull();
  });

  it("业务员自己伪造不了：用自己会话签不出票（签名钥匙在服务端），乱写的票不认", async () => {
    await 登录成(人.甲);
    罐.票.set(视图票, "eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJ2aWV3LWFzIn0.bad");
    expect(await 当前视图()).toBeNull();
    expect((await getCurrentUser())!.id).toBe(人.甲);
  });

  it("切换中真身被撤了管理员：不再按被看的人渲染，但照样只读，直到退出", async () => {
    await 登录成(人.老板);
    expect(await 开始视图(人.乙)).toEqual({ ok: true });
    await prisma.user.update({ where: { id: 人.老板 }, data: { role: "SALES" } }).catch(() => {}); // 只读中，改不了
    // 绕开切换视图（别的会话）把老板降成业务员
    const 票 = 罐.票.get(视图票)!;
    罐.票.delete(视图票);
    await prisma.user.update({ where: { id: 人.老板 }, data: { role: "SALES" } });
    罐.票.set(视图票, 票);
    忘掉企业版范围();
    const me = (await getCurrentUser())!;
    expect(me.id).toBe(人.老板);
    expect(me.视图由).toBeUndefined();
    await expect(prisma.customer.update({ where: { id: 乙的客户 }, data: { name: "x" } })).rejects.toMatchObject({ code: "CRM_READONLY" });
    // 他也开不了新的
    expect(await 开始视图(人.甲)).toEqual({ ok: false, error: "只有总管理员能切换视图" });
    await 退出视图();
    忘掉企业版范围();
    await prisma.customer.create({ data: { name: "退出后能建", phone: "13900000005", salesOwnerId: 人.老板 } });
  });

  it("退出登录连视图票一起清", async () => {
    await 登录成(人.总管);
    await 开始视图(人.甲);
    await destroySession();
    expect(罐.票.has(视图票)).toBe(false);
    expect(罐.票.has("crm_session")).toBe(false);
  });

  it("不是企业版：没有切换视图", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: false, error: "这个部署没有切换视图" });
    expect(罐.票.has(视图票)).toBe(false);
  });
});
