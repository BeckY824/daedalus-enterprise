/**
 * 切换视图（只读预览，lib/enterprise/view-as.ts）的通用扫描（11-12）：
 *   - 扫 src 下所有 "use server" 文件的每个导出、所有 /api 路由的非 GET 处理函数，在切换视图里逐个调一遍（几组常见参数），
 *     调完整个库一行不差（逐表逐行比，不只比条数）。新加的 action / 路由不用登记，自动进来
 *   - /api 非 GET 在进路由之前还有 proxy 那一道（view-as-gate.ts 视图挡写）：签名对、是这个会话签的才挡，伪造 / 过期 / 别人的票不挡（也不认）
 *   - 被看的人轮流换成销售、上级、条线总管理、管理员只读（不同角色在权限判断处早退的地方不一样，换着看才走得到各自的写）；
 *     扫描期间装探针：fetch、fs 写 / 删、控制面库的写，碰一次就算失败；返回值里不许出现对方的 AI 对话
 *   - 系统写 的每一处调用前都先问过切换视图（静态守卫）；字典全空 + 切换视图时几张主要页面的服务端取数不崩、不写
 *   - 开关默认开（没设环境变量就有），CRM_ENT_VIEW_AS=0 才关：关着时带着签名对的票也什么都不算——读按自己、写照常、入口不给
 *   - 票绑在这一次登录上（会话 ims）：退出再登录，旧票作废；演示部署（CRM_DEMO_SWITCH=1）开始视图也拒
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
import { 视图票, 签视图票, 当前视图, 等拦下留痕, 忘掉拦下留痕 } from "@/lib/enterprise/view-as";
import { 读视图名单, 有切换视图 } from "@/lib/enterprise/view-as-menu";
import { 视图挡写 } from "@/lib/enterprise/view-as-gate";
import { 开始视图 } from "@/app/(app)/view-as-actions";

const 钥 = () => new TextEncoder().encode(readSecret());
const 签会话 = (sub: string, 有效 = "1h", ims?: number) => new SignJWT(ims === undefined ? {} : { ims }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime(有效).sign(钥());
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

/** 被看的人的 AI 对话里的一句：扫描时任何返回值里出现它就是漏给了管理员 */
const AI暗号 = "只有自己看得见的AI暗号";

/** 再加三种角色的人（只在扫描里用，别的用例的名单不受影响）：上级、条线总管理（带业务线，不算系统管理员）、管理员只读 */
async function 多几种角色(): Promise<Record<string, string>> {
  const 部 = (await defaultClient.entDept.findFirstOrThrow()).id;
  const 建 = async (名: string, bizRole: string, line: string | null = null) => {
    const u = await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, deptId: bizRole === "director" ? null : 部, bizRole, line } });
    return u.id;
  };
  const 经理 = await 建("经理", "sales_mgr");
  await prisma.entMember.update({ where: { userId: 人.甲 }, data: { managerId: 经理 } });
  const r = { 销售: 人.甲, 上级: 经理, 条线总管理: await 建("条线总管", "director", "内贸"), 管理员只读: await 建("只读管", "admin") };
  for (const id of Object.values(r)) {
    await prisma.aiConversation.create({ data: { title: `${AI暗号}标题`, ownerId: id, scope: "home", messages: { create: [{ role: "user", text: `${AI暗号}问` }, { role: "assistant", text: `${AI暗号}答` }] } } });
  }
  return r;
}

/** 切换视图自己的留痕（开始 view-as、退出 view-as-exit、拦下 view-as-blocked）是放行写的，快照里不算 */
const 去掉拦下留痕 = (快: string) => {
  const o = JSON.parse(快) as Record<string, string[]>;
  o.AuditLog = (o.AuditLog ?? []).filter((r) => !(JSON.parse(r) as { action: string }).action.startsWith("view-as"));
  return JSON.stringify(o);
};

/**
 * 探针：扫描期间对外发请求（fetch）、写 / 删磁盘文件、写控制面库，任何一次都算失败。
 * fs 用 syncBuiltinESMExports 把具名导入（import { writeFile } from "node:fs/promises"）也换成探针
 */
async function 装探针(): Promise<{ 记录: string[]; 拆: () => Promise<void> }> {
  const 记录: string[] = [];
  const { syncBuiltinESMExports } = await import("node:module");
  const fsp = fs.promises as unknown as Record<string, unknown>;
  const 同步 = fs as unknown as Record<string, unknown>;
  const 换掉: [Record<string, unknown>, string, unknown][] = [];
  const 换 = (o: Record<string, unknown>, k: string, 名: string, 异步: boolean) => {
    换掉.push([o, k, o[k]]);
    o[k] = (...a: unknown[]) => {
      记录.push(`${名}(${String(a[0]).slice(0, 120)})`);
      const e = new Error(`探针：切换视图里不许 ${名}`);
      if (异步) return Promise.reject(e);
      throw e;
    };
  };
  for (const k of ["writeFile", "appendFile", "unlink", "rm", "rmdir", "rename", "copyFile", "truncate", "cp"]) {
    if (typeof fsp[k] === "function") 换(fsp, k, `fs.promises.${k}`, true);
    if (typeof 同步[`${k}Sync`] === "function") 换(同步, `${k}Sync`, `fs.${k}Sync`, false);
    if (typeof 同步[k] === "function") 换(同步, k, `fs.${k}`, false);
  }
  for (const k of ["createWriteStream"]) 换(同步, k, `fs.${k}`, false);
  syncBuiltinESMExports();
  const 原fetch = globalThis.fetch;
  globalThis.fetch = (async (u: unknown) => {
    记录.push(`fetch(${String(u instanceof Request ? u.url : u).slice(0, 120)})`);
    throw new Error("探针：切换视图里不许对外发请求");
  }) as typeof fetch;
  // 控制面库：自部署本来就没有；换成只记不写的假客户端，任何写方法、裸 SQL 一碰就记
  const g = globalThis as unknown as { control?: unknown; controlPragmas?: boolean };
  const 原控 = [g.control, g.controlPragmas] as const;
  const 写法 = /^(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$queryRaw|\$queryRawUnsafe|\$transaction)$/;
  g.controlPragmas = true;
  g.control = new Proxy({}, {
    get(_t, 表) {
      if (typeof 表 !== "string") return undefined;
      if (写法.test(表)) return async () => { 记录.push(`control.${表}`); throw new Error("探针：切换视图里不许写控制面库"); };
      return new Proxy({}, { get(_u, 法) {
        if (typeof 法 !== "string") return undefined;
        return async () => {
          if (写法.test(法)) { 记录.push(`control.${表}.${法}`); throw new Error("探针：切换视图里不许写控制面库"); }
          return 法 === "findMany" ? [] : 法 === "count" ? 0 : null;
        };
      } });
    },
  });
  return {
    记录,
    拆: async () => {
      for (const [o, k, v] of 换掉.reverse()) o[k] = v;
      syncBuiltinESMExports();
      globalThis.fetch = 原fetch;
      [g.control, g.controlPragmas] = 原控;
    },
  };
}

/** 把一页服务端组件往下展开：异步组件（async function）调一遍、接着展开它画出来的；客户端组件（普通函数，用 hook）不调 */
async function 展开(节点: unknown, 深 = 0): Promise<void> {
  if (深 > 40 || 节点 == null || typeof 节点 !== "object") return;
  if (Array.isArray(节点)) { for (const x of 节点) await 展开(x, 深 + 1); return; }
  if (节点 instanceof Promise) { await 展开(await 节点, 深 + 1); return; }
  const el = 节点 as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
  if (!el.$$typeof || !el.props) return;
  if (typeof el.type === "function" && el.type.constructor.name === "AsyncFunction") {
    await 展开(await (el.type as (p: unknown) => Promise<unknown>)(el.props), 深 + 1);
    return;
  }
  for (const v of Object.values(el.props)) await 展开(v, 深 + 1);
}

describe("切换视图里调遍所有写入口，库一行不差", () => {
  it("轮流看销售、上级、条线总管理、管理员只读：每个 server action 导出、每个 /api 非 GET 调完库没变，没对外发请求、没写盘、没碰控制面库，返回里没有对方的 AI 对话", async () => {
    const 角色们 = await 多几种角色();
    await 登录成(人.总管);
    const 前 = await 快照();
    const 调了 = new Set<string>();
    const 路由们 = new Set<string>();
    const 漏了AI: string[] = [];
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
    const 看看AI = async (名: string, r: unknown) => {
      let t = "";
      try { t = r instanceof Response ? await r.clone().text() : JSON.stringify(r) ?? ""; } catch { /* 带循环引用的返回值不管 */ }
      if (t.includes(AI暗号)) 漏了AI.push(名);
    };
    const 动作文件 = 全部文件("src/app").concat(全部文件("src/lib")).filter((f) => 是动作文件(fs.readFileSync(f, "utf8")));
    const 路由文件 = 全部文件("src/app/api").filter((p) => /route\.tsx?$/.test(p));
    for (const [角色, 谁] of Object.entries(角色们)) {
      await 登录成(人.总管);
      expect(await 开始视图(谁), 角色).toEqual({ ok: true });
      忘掉企业版范围();
      expect((await getCurrentUser())!.视图由?.id, 角色).toBe(人.总管);
      expect((await getCurrentUser())!.id, 角色).toBe(谁);
      // 每调一次之前把两张票原样放回：有的 action 会清 cookie（退出登录这类），清了之后的调用就不在视图里了
      const 票们 = new Map(罐.票);
      const 放回 = () => { 罐.票.clear(); for (const [k, v] of 票们) 罐.票.set(k, v); };
      const 清了票的: string[] = [];
      const 超时的: string[] = [];
      const 探针 = await 装探针();
      try {
        for (const f of 动作文件) {
          const m = (await import(/* @vite-ignore */ 别名(f))) as Record<string, unknown>;
          for (const [名, fn] of Object.entries(m)) {
            if (typeof fn !== "function") continue;
            // 开始 / 退出视图本身就是要放行的（只动票、记留痕给管理员本人），扫完再单独验
            if (名 === "退出视图" || 名 === "开始视图") continue;
            const 全名 = `${别名(f)}#${名}`;
            调了.add(全名);
            for (const a of 参数组) {
              放回();
              const r = await 限时((fn as (...x: unknown[]) => Promise<unknown>)(...a).catch(() => null));
              if (r === "超时") 超时的.push(全名);
              else await 看看AI(`${角色} ${全名}`, r);
              if (!罐.票.has(视图票)) 清了票的.push(全名);
            }
          }
        }
        for (const f of 路由文件) {
          const m = (await import(/* @vite-ignore */ 别名(f))) as Record<string, unknown>;
          for (const 法 of ["POST", "PUT", "PATCH", "DELETE"]) {
            const fn = m[法];
            if (typeof fn !== "function") continue;
            路由们.add(`${别名(f)}#${法}`);
            for (const body of ["{}", JSON.stringify({ customerId: 物.客户, projectId: 物.项目, id: 物.客户, name: "x" })]) {
              放回();
              const req = new Request("http://ent.test/api/x", { method: 法, body, headers: { "content-type": "application/json", cookie: [...罐.票].map(([k, v]) => `${k}=${v}`).join("; ") } });
              if ((await 限时((fn as (r: Request, c: unknown) => Promise<unknown>)(req, { params: Promise.resolve({ id: 物.客户, slug: [] }) }).catch(() => null))) === "超时") 超时的.push(`${别名(f)}#${法}`);
            }
          }
        }
      } finally {
        await 探针.拆();
      }
      expect(探针.记录, `${角色}：\n${探针.记录.join("\n")}`).toEqual([]);
      // 没有哪个卡住（卡住的会在测试结束后接着跑，那时已不在视图里）
      expect(超时的, `${角色}：\n${超时的.join("\n")}`).toEqual([]);
      // 清票的只许是退出登录（它连会话一起清，回登录页）
      expect([...new Set(清了票的)].every((x) => /logout|退出登录|signOut/i.test(x)), [...new Set(清了票的)].join("\n")).toBe(true);
      放回();
      expect((await 当前视图())?.谁, 角色).toBe(谁);
      await 等拦下留痕();
      expect(去掉拦下留痕(await 快照()), 角色).toBe(去掉拦下留痕(前));
    }
    // 扫到的数量写进断言：少了一大截说明扫描本身坏了（比如判 "use server" 的正则失效）
    expect(调了.size, [...调了].join("\n")).toBeGreaterThan(150);
    expect(路由们.size, [...路由们].join("\n")).toBeGreaterThan(15);
    if (process.env.VIEW_AS_SCAN_DUMP) fs.writeFileSync(process.env.VIEW_AS_SCAN_DUMP, `${调了.size} 个 action、${路由们.size} 个路由\n${[...调了].join("\n")}\n${[...路由们].join("\n")}\n`);
    expect(漏了AI, 漏了AI.join("\n")).toEqual([]);
    // 拦下的写记在真身名下，写明看的是谁
    const 拦下 = await defaultClient.auditLog.findMany({ where: { action: "view-as-blocked" } });
    expect(拦下.length).toBeGreaterThan(0);
    expect(new Set(拦下.map((r) => r.userId))).toEqual(new Set([人.总管]));
    expect(new Set(拦下.map((r) => r.entityId))).toEqual(new Set(Object.values(角色们)));
  }, 900_000);

  it("系统写 的每一处调用前都先问过切换视图（视图中跳过 / 正在切换视图 / 当前视图），漏了的种子写会被拦成整页报错", () => {
    const 漏的: string[] = [];
    let 处数 = 0;
    for (const f of 全部文件("src")) {
      if (f.endsWith(path.join("lib", "team-scope.ts"))) continue; // 定义处
      const 行们 = fs.readFileSync(f, "utf8").split("\n");
      行们.forEach((行, i) => {
        if (!/(^|[^\w\u4e00-\u9fff])系统写\(/.test(行) || /^\s*(\/\/|\*|\/\*)/.test(行)) return;
        处数++;
        // 往上找到这一处所在函数的开头（顶格的 function / const … = …），这一段里要先问过
        let 起 = i;
        while (起 > 0 && !/^(export\s+)?(default\s+)?(async\s+)?function\b|^(export\s+)?const\s+\S+\s*=/.test(行们[起])) 起--;
        const 段 = 行们.slice(起, i + 1).join("\n");
        if (!/(视图中跳过|正在切换视图|当前视图)\(\)/.test(段)) 漏的.push(`${path.relative(".", f)}:${i + 1}`);
      });
    }
    expect(处数).toBeGreaterThanOrEqual(5);
    expect(漏的, 漏的.join("\n")).toEqual([]);
  });

  it("字典全空 + 切换视图：首页、客户列表、客户详情、项目、渠道、设置几页的服务端取数都不崩、一笔不写、字典还是空的", async () => {
    const 角色们 = await 多几种角色();
    await 登录成(人.总管);
    const 前 = await 快照();
    const 页们: [string, () => Promise<unknown>][] = [
      ["壳", async () => (await import("@/app/(app)/layout")).default({ children: null, pane: null } as never)],
      ["首页", async () => (await import("@/app/(app)/dashboard/page")).default({ searchParams: Promise.resolve({}) } as never)],
      ["客户列表", async () => (await import("@/app/(app)/customers/page")).default({ searchParams: Promise.resolve({}) } as never)],
      ["客户详情", async () => (await import("@/app/(app)/customers/[id]/page")).default({ params: Promise.resolve({ id: 物.客户 }), searchParams: Promise.resolve({}) } as never)],
      ["项目", async () => (await import("@/app/(app)/projects/page")).default({ searchParams: Promise.resolve({}) } as never)],
      ["项目详情", async () => (await import("@/app/(app)/projects/[id]/page")).default({ params: Promise.resolve({ id: 物.项目 }), searchParams: Promise.resolve({}) } as never)],
      ["渠道", async () => (await import("@/app/(app)/channels/page")).default({ searchParams: Promise.resolve({}) } as never)],
      ["设置", async () => (await import("@/app/(app)/settings/page")).default()],
    ];
    const 崩了: string[] = [];
    for (const [角色, 谁] of Object.entries(角色们)) {
      await 登录成(人.总管);
      expect(await 开始视图(谁)).toEqual({ ok: true });
      for (const [页, 画] of 页们) {
        忘掉企业版范围();
        try {
          await 展开(await 画());
        } catch (e) {
          // 跳转（没权限进的页回首页、项目页并进客户这类）、404 不算崩
          if (/^(REDIRECT:|NOT_FOUND$)/.test((e as Error).message)) continue;
          崩了.push(`${角色} ${页}：${(e as Error).message}${process.env.VIEW_AS_SCAN_STACK ? `\n${(e as Error).stack}` : ""}`);
        }
      }
    }
    expect(崩了, 崩了.join("\n")).toEqual([]);
    await 等拦下留痕();
    expect((await defaultClient.auditLog.findMany({ where: { action: "view-as-blocked" } })).map((r) => r.summary), "页面渲染不该去碰写").toEqual([]);
    expect(去掉拦下留痕(await 快照())).toBe(去掉拦下留痕(前));
    expect(await defaultClient.entDictItem.count()).toBe(0);
    expect(await defaultClient.projectRole.count()).toBe(0);
    expect(await defaultClient.projectExceptionCategory.count()).toBe(0);
  }, 300_000);
});

describe("AI 对话：切换视图时看不到对方的", () => {
  it("列表回空、内容回 null（服务端取数处就不查）；对方自己登录照常看得到", async () => {
    const { 列对话, 读对话 } = await import("@/app/(app)/dashboard/threads");
    const c = await prisma.aiConversation.create({ data: { title: `${AI暗号}标题`, ownerId: 人.甲, scope: "home", messages: { create: [{ role: "user", text: `${AI暗号}问` }] } } });
    await 登录成(人.甲);
    expect((await 列对话()).map((r) => r.id)).toEqual([c.id]);
    expect((await 读对话(c.id))?.messages[0]?.text).toBe(`${AI暗号}问`);
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    expect((await getCurrentUser())!.id).toBe(人.甲);
    expect(await 列对话()).toEqual([]);
    expect(await 列对话({ scope: "home" })).toEqual([]);
    expect(await 读对话(c.id)).toBeNull();
  });
});

describe("拦下的写留一笔（记在真身名下，走放行通道）", () => {
  it("同一种写一分钟内只记一条；换一种写再记；退出后不在视图就不记", async () => {
    忘掉拦下留痕();
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    for (let i = 0; i < 5; i++) await expect(prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "改" } })).rejects.toMatchObject({ code: "CRM_READONLY" });
    await expect(prisma.contact.update({ where: { id: 物.联系人 }, data: { name: "改" } })).rejects.toMatchObject({ code: "CRM_READONLY" });
    await 等拦下留痕();
    const 行 = await defaultClient.auditLog.findMany({ where: { action: "view-as-blocked" }, orderBy: { at: "asc" } });
    expect(行.map((r) => [r.userId, r.userName, r.entityId])).toEqual([[人.总管, "总管", 人.甲], [人.总管, "总管", 人.甲]]);
    // 留痕不等落库（见 view-as.ts 记拦下），两条的先后不定
    expect(行.map((r) => r.summary).sort()).toEqual(["以「业务员甲」的视图查看时试图改数据，已拦下（Contact.update）", "以「业务员甲」的视图查看时试图改数据，已拦下（Customer.update）"]);
    expect((await defaultClient.customer.findUniqueOrThrow({ where: { id: 物.客户 } })).remark).not.toBe("改");
    const { 退出视图 } = await import("@/app/(app)/view-as-actions");
    expect(await 退出视图()).toEqual({ ok: true });
    忘掉企业版范围();
    await prisma.contact.update({ where: { id: 物.联系人 }, data: { name: "退出后照常改" } });
    await 等拦下留痕();
    expect(await defaultClient.auditLog.count({ where: { action: "view-as-blocked" } })).toBe(2);
  });
});

describe("proxy 那一道：/api 非 GET 在进路由前就 403", () => {
  const 请求 = (method: string, pathname: string, 票们: Record<string, string>) => ({
    method, nextUrl: { pathname }, cookies: { get: (n: string) => (票们[n] ? { value: 票们[n] } : undefined) },
  });
  it("这个会话签的有效票：POST / PUT / PATCH / DELETE 挡（只读），GET / HEAD 和退出登录不挡", async () => {
    const 票们 = { crm_session: await 签会话(人.总管), [视图票]: await 签视图票(人.总管, 人.甲) };
    for (const 法 of ["POST", "PUT", "PATCH", "DELETE"]) expect(await 视图挡写(请求(法, "/api/attachments", 票们), 钥()), 法).toBe("只读");
    expect(await 视图挡写(请求("GET", "/api/attachments", 票们), 钥())).toBeNull();
    expect(await 视图挡写(请求("HEAD", "/api/attachments", 票们), 钥())).toBeNull();
    expect(await 视图挡写(请求("POST", "/api/auth/logout", 票们), 钥())).toBeNull();
    expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 票们.crm_session }), 钥())).toBeNull();
  });
  it("伪造、过期、篡改、别的会话的票：不认人，但写照样挡（失效，提示刷新）；开关关着、不是企业版不挡", async () => {
    const 会话 = await 签会话(人.甲);
    const 别人签的 = await 签视图票(人.总管, 人.乙);
    const 过期 = await new SignJWT({ typ: "view-as", va: 人.乙, vb: 人.甲 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(钥());
    const 外钥 = await new SignJWT({ typ: "view-as", va: 人.乙, vb: 人.甲 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode("x".repeat(40)));
    const 好的 = await 签视图票(人.甲, 人.乙);
    const 篡改 = 好的.slice(0, -3) + (好的.endsWith("aaa") ? "bbb" : "aaa");
    for (const 票 of [别人签的, 过期, 外钥, 篡改, "乱写的"]) expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 票 }), 钥())).toBe("失效");
    expect(await 视图挡写(请求("POST", "/api/x", { [视图票]: 好的 }), 钥())).toBe("失效");
    expect(await 视图挡写(请求("GET", "/api/x", { crm_session: 会话, [视图票]: 过期 }), 钥())).toBeNull();
    expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 好的 }), 钥())).toBe("只读");
    vi.stubEnv("CRM_ENT_VIEW_AS", "0");
    for (const 票 of [好的, 过期, "乱写的"]) expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 票 }), 钥())).toBeNull();
    vi.stubEnv("CRM_ENT_VIEW_AS", "");
    vi.stubEnv("CRM_ENTERPRISE", "");
    for (const 票 of [好的, 过期]) expect(await 视图挡写(请求("POST", "/api/x", { crm_session: 会话, [视图票]: 票 }), 钥())).toBeNull();
  });
});

describe("开关：默认开，CRM_ENT_VIEW_AS=0 才关", () => {
  it("没设环境变量：企业版下就有（客户服务器上现有的照旧）", async () => {
    vi.stubEnv("CRM_ENT_VIEW_AS", "");
    await 登录成(人.总管);
    expect(有切换视图()).toBe(true);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    expect((await getCurrentUser())!.id).toBe(人.甲);
  });
  it("=0：入口不给、开始视图拒；带着签名对的票也不认：读按自己、写照常、不当只读", async () => {
    vi.stubEnv("CRM_ENT_VIEW_AS", "0");
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

describe("票绑在这一次登录上、演示部署不给", () => {
  const 请求 = (票们: Record<string, string>) => ({ method: "POST", nextUrl: { pathname: "/api/x" }, cookies: { get: (n: string) => (票们[n] ? { value: 票们[n] } : undefined) } });
  it("开始视图把会话的 ims 签进票；退出再登录（新 ims）旧票作废：认人、读、proxy 都不认", async () => {
    罐.票.clear();
    罐.票.set("crm_session", await 签会话(人.总管, "1h", 1_700_000_000_000));
    忘掉企业版范围();
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    const 旧票 = 罐.票.get(视图票)!;
    忘掉企业版范围();
    expect((await getCurrentUser())!.id).toBe(人.甲);
    expect(await 视图挡写(请求({ crm_session: 罐.票.get("crm_session")!, [视图票]: 旧票 }), 钥())).toBe("只读");
    // 退出再登录：同一个人、新会话（新 ims），把旧的视图票塞回去
    罐.票.clear();
    罐.票.set("crm_session", await 签会话(人.总管, "1h", 1_700_000_999_000));
    罐.票.set(视图票, 旧票);
    忘掉企业版范围();
    expect(await 当前视图()).toBeNull();
    expect((await getCurrentUser())!.id).toBe(人.总管);
    // 旧票不认人，但带着它的写照样拒（提示刷新），见下面「视图票失效」
    expect(await 视图挡写(请求({ crm_session: 罐.票.get("crm_session")!, [视图票]: 旧票 }), 钥())).toBe("失效");
    await expect(prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "新会话" } })).rejects.toMatchObject({ code: "CRM_READONLY", message: "视角已失效，请刷新页面" });
    罐.票.delete(视图票);
    await prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "新会话照常写" } });
  });
  it("演示部署（CRM_DEMO_SWITCH=1）：菜单不给，开始视图也拒", async () => {
    vi.stubEnv("CRM_DEMO_SWITCH", "1");
    await 登录成(人.总管);
    expect(await 读视图名单((await getCurrentUser())!)).toBeNull();
    expect(await 开始视图(人.甲)).toEqual({ ok: false, error: "这个部署没有切换视图" });
    expect(罐.票.has(视图票)).toBe(false);
  });
});

describe("视图票失效（过期、上线前签的没绑会话的旧票、退出重登后的旧标签页）：这次请求的写拒，打开页面时删票，之后照常", () => {
  /** 罐里的 cookie 拼成一个真的页面请求，过一遍 proxy；回 proxy 的响应 */
  const 过proxy = async (method: string, 址 = "/customers") => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");
    return proxy(new NextRequest(`http://ent.test${址}`, { method, headers: { cookie: [...罐.票].map(([k, v]) => `${k}=${v}`).join("; ") } }));
  };
  /** 浏览器照 proxy 回的 Set-Cookie 删票 */
  const 照删 = (res: Response) => {
    const 设 = res.headers.getSetCookie().find((c) => c.startsWith(`${视图票}=`));
    if (设 && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(设)) 罐.票.delete(视图票);
    return 设;
  };
  const 旧版票 = (由: string, 谁: string) =>
    new SignJWT({ typ: "view-as", va: 谁, vb: 由 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(钥()); // 没有 vs：上线前签的
  const 过期票 = (由: string, 谁: string) =>
    new SignJWT({ typ: "view-as", va: 谁, vb: 由, vs: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 7300).setExpirationTime(Math.floor(Date.now() / 1000) - 100).sign(钥());

  for (const [名, 签] of [["没有 vs 的旧票", 旧版票], ["过期的票", 过期票]] as const) {
    it(`${名}：写拒且库不变（action、/api 都拒）→ 同一会话打开页面，票被删、以真身渲染 → 再写成功`, async () => {
      await 登录成(人.总管);
      罐.票.set(视图票, await 签(人.总管, 人.甲));
      忘掉企业版范围();
      // 读按真身（不认这张票），但横幅那头 layout 还看得到票在
      expect((await getCurrentUser())!.id).toBe(人.总管);
      expect(await 当前视图()).toBeNull();
      const 前 = await 快照();
      // 写：库层拒、提示刷新；不记拦下留痕（不知道在看谁）
      await expect(prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "以本人身份写" } })).rejects.toMatchObject({ code: "CRM_READONLY", message: "视角已失效，请刷新页面" });
      const { 新建对话 } = await import("@/app/(app)/dashboard/threads");
      await expect(新建对话("x")).rejects.toMatchObject({ code: "CRM_READONLY" });
      const { 切换收藏 } = await import("@/app/(app)/favorites");
      expect(await 切换收藏(物.客户)).toEqual({ ok: false, error: "视角已失效，请刷新页面" });
      const { 视图外部拒 } = await import("@/lib/enterprise/view-as");
      expect(await 视图外部拒()).toEqual({ ok: false, error: "视角已失效，请刷新页面" });
      // /api 非 GET：proxy 那一道 403
      const api = await 过proxy("POST", "/api/attachments");
      expect(api.status).toBe(403);
      expect(await api.json()).toEqual({ error: "视角已失效，请刷新页面" });
      // server action（页面路径上的 POST）proxy 不删票：删了再点一下就以真身写进去了
      expect(照删(await 过proxy("POST"))).toBeUndefined();
      expect(罐.票.has(视图票)).toBe(true);
      await 等拦下留痕();
      expect(await 快照()).toBe(前);
      // 打开页面（GET）：proxy 删票，这一次渲染的请求头里也没有了
      const 页 = await 过proxy("GET");
      expect(页.status).toBe(200);
      expect(照删(页)).toBeDefined();
      expect(页.headers.get("x-middleware-request-cookie") ?? "").not.toContain(视图票);
      expect(页.headers.get("x-middleware-request-cookie") ?? "").toContain("crm_session=");
      expect(罐.票.has(视图票)).toBe(false);
      // 删票之后就是普通真身请求：写成功
      忘掉企业版范围();
      await prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "刷新后照常写" } });
      expect((await defaultClient.customer.findUniqueOrThrow({ where: { id: 物.客户 } })).remark).toBe("刷新后照常写");
    });
  }

  it("有效票的页面请求 proxy 不删；没登录带着坏票被弹去登录页时顺手删", async () => {
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    expect(照删(await 过proxy("GET"))).toBeUndefined();
    expect(罐.票.has(视图票)).toBe(true);
    罐.票.delete("crm_session");
    const 弹 = await 过proxy("GET");
    expect(弹.status).toBe(307);
    expect(照删(弹)).toBeDefined();
  });

  it("开关关着（CRM_ENT_VIEW_AS=0）：带着坏票也不拒、不删，当功能不存在", async () => {
    vi.stubEnv("CRM_ENT_VIEW_AS", "0");
    await 登录成(人.总管);
    罐.票.set(视图票, await 旧版票(人.总管, 人.甲));
    忘掉企业版范围();
    await prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "关着照常写" } });
    expect((await 过proxy("POST", "/api/attachments")).status).not.toBe(403);
    expect(照删(await 过proxy("GET"))).toBeUndefined();
    expect(罐.票.has(视图票)).toBe(true);
  });

  it("退出视图带着坏票也照常：删票，之后照常写", async () => {
    await 登录成(人.总管);
    罐.票.set(视图票, await 旧版票(人.总管, 人.甲));
    const { 退出视图 } = await import("@/app/(app)/view-as-actions");
    expect(await 退出视图()).toEqual({ ok: true });
    expect(罐.票.has(视图票)).toBe(false);
    忘掉企业版范围();
    await prisma.customer.update({ where: { id: 物.客户 }, data: { remark: "退出后照常写" } });
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

