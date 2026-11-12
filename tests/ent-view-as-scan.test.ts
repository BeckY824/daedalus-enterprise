/**
 * 切换视图（只读预览，lib/enterprise/view-as.ts）的通用扫描（11-12）：
 *   - 扫 src 下所有 "use server" 文件的每个导出、所有 /api 路由的非 GET 处理函数，在切换视图里逐个调一遍（几组常见参数），
 *     调完整个库一行不差（逐表逐行比，不只比条数）。新加的 action / 路由不用登记，自动进来
 *   - /api 非 GET 在进路由之前还有 proxy 那一道（view-as-gate.ts 视图挡写）：签名对、是这个会话签的才挡，伪造 / 过期 / 别人的票不挡（也不认）
 *   - 开关（CRM_ENT_VIEW_AS）关着：带着签名对的票也什么都不算——读按自己、写照常、入口不给
 * 会话票、视图票都从假的 next/headers 里读（同 ent-view-as.test.ts）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 罐 = vi.hoisted(() => ({ 票: new Map<string, string>() }));
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({
    get: (n: string) => (罐.票.has(n) ? { name: n, value: 罐.票.get(n)! } : undefined),
    getAll: () => [...罐.票].map(([name, value]) => ({ name, value })),
    has: (n: string) => 罐.票.has(n),
    set: (n: string, v: string) => void 罐.票.set(n, v),
    delete: (n: string) => void 罐.票.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import { SignJWT } from "jose";
import { Prisma } from "@/generated/prisma";
import { prisma, defaultClient } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 视图票, 签视图票, 当前视图 } from "@/lib/enterprise/view-as";
import { 读视图名单, 有切换视图 } from "@/lib/enterprise/view-as-menu";
import { 视图挡写 } from "@/lib/enterprise/view-as-gate";
import { 开始视图 } from "@/app/(app)/view-as-actions";

const 钥 = () => new TextEncoder().encode(readSecret());
const 签会话 = (sub: string, 有效 = "1h") => new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime(有效).sign(钥());
const 人 = { 总管: "", 二总管: "", 甲: "", 乙: "" };
const 物 = { 客户: "", 乙客户: "", 项目: "", 联系人: "", 跟进: "" };

async function 登录成(id: string) {
  罐.票.clear();
  罐.票.set("crm_session", await 签会话(id));
  忘掉企业版范围();
}

/** 整个库逐表逐行（按 id 排）：调完前后比，一行不差才算没写 */
async function 快照(): Promise<string> {
  const 表们 = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const 份: Record<string, unknown> = {};
  for (const t of 表们) {
    const d = (defaultClient as unknown as Record<string, { findMany?: (a?: unknown) => Promise<unknown[]> }>)[t[0].toLowerCase() + t.slice(1)];
    if (!d?.findMany) continue;
    const 行 = await d.findMany();
    份[t] = 行.map((r) => JSON.stringify(r)).sort();
  }
  return JSON.stringify(份);
}

const 全部文件 = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : 全部文件(p);
    return /\.tsx?$/.test(p) ? [p] : [];
  });
const 是动作文件 = (src: string) => /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(src);
const 别名 = (f: string) => "@/" + path.relative("src", f).replace(/\\/g, "/").replace(/\.tsx?$/, "");

/** 最多等这么久：调外部的（AI、飞书）在切换视图里本来就不发，万一哪个卡住也不拖垮整条 */
const 限时 = <T,>(p: Promise<T>, ms = 4000) => Promise.race([p, new Promise<"超时">((r) => setTimeout(() => r("超时"), ms))]);

beforeEach(async () => {
  // 先清库再开企业版：企业版的 deleteMany 是软删（进回收站），清不干净
  罐.票.clear();
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  vi.stubEnv("CRM_ENT_VIEW_AS", "1");
  const 部 = (await prisma.entDept.create({ data: { name: "销售一部" } })).id;
  const 建 = async (名: string, bizRole: string, managerId: string | null = null) => {
    const u = await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, deptId: bizRole === "director" ? null : 部, bizRole, managerId } });
    return u.id;
  };
  人.总管 = await 建("总管", "director");
  人.二总管 = await 建("二总管", "director");
  人.甲 = await 建("业务员甲", "sales");
  人.乙 = await 建("业务员乙", "sales");
  物.客户 = (await prisma.customer.create({ data: { name: "甲的客户", phone: "13900000001", salesOwnerId: 人.甲 } })).id;
  物.乙客户 = (await prisma.customer.create({ data: { name: "乙的客户", phone: "13900000002", salesOwnerId: 人.乙 } })).id;
  物.项目 = (await prisma.project.create({ data: { name: "甲的项目", customerId: 物.客户, ownerId: 人.甲, creatorId: 人.甲, phase: "商机", node: "方案敲定" } })).id;
  物.联系人 = (await prisma.contact.create({ data: { customerId: 物.客户, name: "联系人一" } })).id;
  物.跟进 = (await prisma.followUp.create({ data: { customerId: 物.客户, ownerId: 人.甲, title: "电话", content: "打过电话", type: "PHONE" } })).id;
  await setSetting("enterprise.rule.org_scope", true);
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); 罐.票.clear(); 忘掉企业版范围(); });
afterAll(() => prisma.$disconnect());

describe("切换视图里调遍所有写入口，库一行不差", () => {
  it("每个 server action 导出、每个 /api 非 GET：调完库没变（新加的自动进来）", async () => {
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    expect((await getCurrentUser())!.视图由?.id).toBe(人.总管);
    const 前 = await 快照();
    // 每调一次之前把两张票原样放回：有的 action 会清 cookie（退出登录这类），清了之后的调用就不在视图里了
    const 票们 = new Map(罐.票);
    const 放回 = () => { 罐.票.clear(); for (const [k, v] of 票们) 罐.票.set(k, v); };
    const 清了票的: string[] = [];
    const 超时的: string[] = [];

    const 参数组: unknown[][] = [
      [],
      [物.客户],
      [物.项目],
      [物.客户, "remark", "改一下"],
      [物.项目, "name", "改一下"],
      [[物.客户]],
      [{ id: 物.客户, customerId: 物.客户, projectId: 物.项目, name: "新名字", phone: "13900000099", content: "x", userId: 人.乙, toUserId: 人.乙 }],
      [物.客户, 人.乙],
      [物.联系人, { name: "改" }],
      [物.跟进],
    ];
    const 调了: string[] = [];
    for (const f of 全部文件("src/app").concat(全部文件("src/lib"))) {
      const src = fs.readFileSync(f, "utf8");
      if (!是动作文件(src)) continue;
      const m = (await import(/* @vite-ignore */ 别名(f))) as Record<string, unknown>;
      for (const [名, fn] of Object.entries(m)) {
        if (typeof fn !== "function") continue;
        // 退出视图本身就是要放行的那一个（它只删票、记留痕给管理员本人），扫完再单独验
        if (名 === "退出视图" || 名 === "开始视图") continue;
        调了.push(`${别名(f)}#${名}`);
        for (const a of 参数组) {
          放回();
          if ((await 限时((fn as (...x: unknown[]) => Promise<unknown>)(...a).catch(() => null))) === "超时") 超时的.push(`${别名(f)}#${名}`);
          if (!罐.票.has(视图票)) 清了票的.push(`${别名(f)}#${名}`);
        }
      }
    }
    const 路由们: string[] = [];
    for (const f of 全部文件("src/app/api").filter((p) => /route\.tsx?$/.test(p))) {
      const m = (await import(/* @vite-ignore */ 别名(f))) as Record<string, unknown>;
      for (const 法 of ["POST", "PUT", "PATCH", "DELETE"]) {
        const fn = m[法];
        if (typeof fn !== "function") continue;
        路由们.push(`${别名(f)}#${法}`);
        for (const body of ["{}", JSON.stringify({ customerId: 物.客户, projectId: 物.项目, id: 物.客户, name: "x" })]) {
          放回();
          const req = new Request("http://ent.test/api/x", { method: 法, body, headers: { "content-type": "application/json", cookie: [...罐.票].map(([k, v]) => `${k}=${v}`).join("; ") } });
          if ((await 限时((fn as (r: Request, c: unknown) => Promise<unknown>)(req, { params: Promise.resolve({ id: 物.客户, slug: [] }) }).catch(() => null))) === "超时") 超时的.push(`${别名(f)}#${法}`);
        }
      }
    }
    // 扫到的数量写进断言：少了一大截说明扫描本身坏了（比如判 "use server" 的正则失效）
    expect(调了.length, 调了.join("\n")).toBeGreaterThan(150);
    expect(路由们.length, 路由们.join("\n")).toBeGreaterThan(15);
    if (process.env.VIEW_AS_SCAN_DUMP) fs.writeFileSync(process.env.VIEW_AS_SCAN_DUMP, `${调了.length} 个 action、${路由们.length} 个路由\n${调了.join("\n")}\n${路由们.join("\n")}\n`);
    // 没有哪个卡住（卡住的会在测试结束后接着跑，那时已不在视图里）
    expect(超时的, 超时的.join("\n")).toEqual([]);
    // 清票的只许是退出登录（它连会话一起清，回登录页）
    expect([...new Set(清了票的)].every((x) => /logout|退出登录|signOut/i.test(x)), [...new Set(清了票的)].join("\n")).toBe(true);
    放回();
    expect((await 当前视图())?.谁).toBe(人.甲);
    expect(await 快照()).toBe(前);
  }, 600_000);
});

describe("proxy 那一道：/api 非 GET 在进路由前就 403", () => {
  const 请求 = (method: string, pathname: string, 票们: Record<string, string>) => ({
    method, nextUrl: { pathname }, cookies: { get: (n: string) => (票们[n] ? { value: 票们[n] } : undefined) },
  });
  it("这个会话签的有效票：POST / PUT / PATCH / DELETE 挡，GET / HEAD 和退出登录不挡", async () => {
    const 票们 = { crm_session: await 签会话(人.总管), [视图票]: await 签视图票(人.总管, 人.甲) };
    for (const 法 of ["POST", "PUT", "PATCH", "DELETE"]) expect(await 视图挡写(请求(法, "/api/attachments", 票们), 钥()), 法).toBe(true);
    expect(await 视图挡写(请求("GET", "/api/attachments", 票们), 钥())).toBe(false);
    expect(await 视图挡写(请求("HEAD", "/api/attachments", 票们), 钥())).toBe(false);
    expect(await 视图挡写(请求("POST", "/api/auth/logout", 票们), 钥())).toBe(false);
  });
  it("伪造、过期、篡改、别的会话的票不挡；开关关着、不是企业版不挡", async () => {
    const 会话 = await 签会话(人.甲);
    const 别人签的 = await 签视图票(人.总管, 人.乙);
    const 过期 = await new SignJWT({ typ: "view-as", va: 人.乙, vb: 人.甲 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(钥());
    const 外钥 = await new SignJWT({ typ: "view-as", va: 人.乙, vb: 人.甲 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode("x".repeat(40)));
    const 好的 = await 签视图票(人.甲, 人.乙);
    const 篡改 = 好的.slice(0, -3) + (好的.endsWith("aaa") ? "bbb" : "aaa");
    for (const 票 of [别人签的, 过期, 外钥, 篡改, "乱写的"]) expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 票 }), 钥())).toBe(false);
    expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 好的 }), 钥())).toBe(true);
    vi.stubEnv("CRM_ENT_VIEW_AS", "");
    expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 好的 }), 钥())).toBe(false);
    vi.stubEnv("CRM_ENT_VIEW_AS", "1");
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 好的 }), 钥())).toBe(false);
  });
});

describe("开关（CRM_ENT_VIEW_AS）关着：和没有这个功能一样", () => {
  it("入口不给、开始视图拒；带着签名对的票也不认：读按自己、写照常、不当只读", async () => {
    vi.stubEnv("CRM_ENT_VIEW_AS", "");
    await 登录成(人.总管);
    expect(有切换视图()).toBe(false);
    expect(await 读视图名单((await getCurrentUser())!)).toBeNull();
    expect(await 开始视图(人.甲)).toEqual({ ok: false, error: "这个部署没有切换视图" });
    expect(罐.票.has(视图票)).toBe(false);
    罐.票.set(视图票, await 签视图票(人.总管, 人.甲));
    忘掉企业版范围();
    expect(await 当前视图()).toBeNull();
    const me = (await getCurrentUser())!;
    expect(me.id).toBe(人.总管);
    expect(me.视图由).toBeUndefined();
    await prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "关着照常写" } });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 物.客户 } })).remark).toBe("关着照常写");
  });
});

describe("谁能被看", () => {
  it("名单不列自己和别的系统管理员；直接调 action 看另一位系统管理员也拒；票里写的是系统管理员也不认", async () => {
    await 登录成(人.总管);
    const 名单 = (await 读视图名单((await getCurrentUser())!))!;
    expect(名单.flatMap((g) => g.人.map((p) => p.id)).sort()).toEqual([人.甲, 人.乙].sort());
    expect(await 开始视图(人.二总管)).toEqual({ ok: false, error: "不能以另一位系统管理员的视图查看" });
    expect(罐.票.has(视图票)).toBe(false);
    罐.票.set(视图票, await 签视图票(人.总管, 人.二总管));
    忘掉企业版范围();
    expect((await getCurrentUser())!.id).toBe(人.总管);
  });
  it("被看的人停用了：票不再认人（读按管理员自己），顶上显示已失效", async () => {
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    const 票 = 罐.票.get(视图票)!;
    罐.票.delete(视图票);
    await prisma.user.update({ where: { id: 人.甲 }, data: { active: false } });
    罐.票.set(视图票, 票);
    忘掉企业版范围();
    expect((await getCurrentUser())!.id).toBe(人.总管);
  });
});

describe("读的结果和那个人自己登录一致", () => {
  it("销售、上级、市场成员：客户、项目、能看到的人和自己登录看到的一模一样", async () => {
    const 部 = (await defaultClient.entDept.findFirstOrThrow()).id;
    const 经理 = (await prisma.user.create({ data: { email: "经理@t", name: "经理", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 经理, deptId: 部, bizRole: "sales_mgr" } });
    await prisma.entMember.update({ where: { userId: 人.甲 }, data: { managerId: 经理 } });
    const 小市 = (await prisma.user.create({ data: { email: "小市@t", name: "小市", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 小市, bizRole: "channel_ops" } });
    const { 市场成员key } = await import("@/lib/enterprise/market");
    await setSetting(市场成员key, [小市]);
    const 乙客户 = 物.乙客户;
    await prisma.project.create({ data: { name: "市场建的", customerId: 乙客户, ownerId: 人.乙, creatorId: 小市, phase: "线索", node: "线索验证" } });
    const 看到 = async () => {
      忘掉企业版范围();
      const me = (await getCurrentUser())!;
      return {
        我: me.id,
        客户: (await prisma.customer.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((c) => c.id),
        项目: (await prisma.project.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((p) => p.id),
      };
    };
    for (const 谁 of [人.甲, 经理, 小市]) {
      await 登录成(谁);
      const 自己 = await 看到();
      await 登录成(人.总管);
      expect(await 开始视图(谁)).toEqual({ ok: true });
      expect(await 看到(), 谁).toEqual(自己);
    }
  });
});

