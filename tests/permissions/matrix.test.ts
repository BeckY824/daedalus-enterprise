/**
 * 企业版「角色 × 接口」权限枚举（2026-10-29）：自动扫出全部 route.ts 的每个 HTTP 方法、全部 "use server" 文件导出的动作，
 * 按 未登录 / 销售 / 市场 / 经理 / 老板 五种身份各调一遍，结果和 expected.json 逐格比对。
 *
 * - 扫出来、表里没有 → 红：新加接口要补表；表里有、代码里没了 → 红：删掉那一行
 * - 未登录必须 401（或跳登录 / 登出）；明确公开的写「公开」+ 理由；整条在企业版里关着（五种身份都 404 / 都 403）的也算拒
 * - 应拒绝的身份写 "403"；实际拿到 400（参数错先于权限判断）的写 "400" 并写「注」；按现状放行但其实越权的写「bug」
 * - 「允许」= 过了权限门：真放行，或者权限门之后参数不对（这里传的都是空参数、不存在的编号，多数会走到参数错）
 *
 * 调用方式：直接 import 路由处理器和动作，会话票走 crm_session（next/headers 和 NextRequest 两条路都带上），
 * 用拷出来的一份临时库；fetch、DNS、发信、控制面库都 mock 成一碰就抛，绝不连网。不起 next 服务器。
 *
 * 重录表：PERM_TABLE=write npx vitest run tests/permissions/matrix.test.ts
 * （按实际结果重写各格，已有的「公开」「注」「bug」和写成 "400" 的格保留；PERM_DUMP=<文件> 另存每格的原始文案，审表用）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-perm-enum-"));
  const 源 = path.resolve(__dirname, "../../prisma/test.db");
  fs.copyFileSync(源, path.join(dir, "P.db"));
  if (fs.existsSync(`${源}-wal`)) fs.copyFileSync(`${源}-wal`, path.join(dir, "P.db-wal"));
  // 附件、同步、工作区目录都跟着临时目录走：被测动作就算写文件也写不到仓库里
  process.env.DATABASE_URL = `file:${path.join(dir, "P.db")}`;
  process.env.WORKSPACE_DIR = path.join(dir, "ws");
  process.env.SYNC_DIR = path.join(dir, "sync");
  process.env.ATTACH_DIR = path.join(dir, "attach");
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  delete process.env.CRM_DATA_DIR;
  delete process.env.MULTI_TENANT;
  delete process.env.CRM_DEMO_SWITCH;
  return { dir, 票: undefined as string | undefined };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "P.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({
    get: (n: string) => (n === "crm_session" && 临时.票 ? { value: 临时.票 } : undefined),
    getAll: () => (临时.票 ? [{ name: "crm_session", value: 临时.票 }] : []),
    has: (n: string) => n === "crm_session" && !!临时.票,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
// 不连网：发信、DNS、控制面库一碰就抛；fetch 在下面 stubGlobal
const 不许连网 = vi.hoisted(() => (what: string) => () => {
  throw new Error(`测试里不许连网：${what}`);
});
vi.mock("nodemailer", () => ({ default: { createTransport: 不许连网("nodemailer") }, createTransport: 不许连网("nodemailer") }));
vi.mock("node:dns/promises", async (orig) => {
  const 真 = await orig<typeof import("node:dns/promises")>();
  const 拒 = async () => Promise.reject(new Error("测试里不许连网：DNS"));
  return { ...真, default: { ...真, lookup: 拒, resolveMx: 拒, resolve: 拒, resolve4: 拒, resolve6: 拒 }, lookup: 拒, resolveMx: 拒, resolve: 拒, resolve4: 拒, resolve6: 拒 };
});
vi.mock("@/lib/tenant/control", () => ({
  control: new Proxy({}, {
    get(_t, k) {
      if (typeof k === "symbol" || k === "then") return undefined;
      throw new Error(`控制面库不该被碰：control.${String(k)}`);
    },
  }),
}));

import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { defaultClient as raw } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";

vi.stubGlobal("fetch", async (u: unknown) => {
  throw new Error(`测试里不许连网：fetch ${String(u).slice(0, 80)}`);
});

const 身份们 = ["未登录", "销售", "市场", "经理", "老板"] as const;
type 身份 = (typeof 身份们)[number];
type 格 = "允许" | "400" | "401" | "403" | "404";
type 实际 = "放行" | "400" | "401" | "403" | "404" | "超时";
type 条目 = Partial<Record<身份, 格>> & { 公开?: string; 注?: string; bug?: string };

/** 五种身份是谁。业务角色照企业版组织里的写法：销售 sales、市场 marketing_mgr、经理 sales_mgr；老板是 ADMIN 账号 */
const 人: Record<Exclude<身份, "未登录">, { id: string; role: string; bizRole: string | null; managerId: string | null }> = {
  销售: { id: "p_sales", role: "SALES", bizRole: "sales", managerId: "p_mgr" },
  市场: { id: "p_mkt", role: "SALES", bizRole: "marketing_mgr", managerId: "p_boss" },
  经理: { id: "p_mgr", role: "MANAGER", bizRole: "sales_mgr", managerId: "p_boss" },
  老板: { id: "p_boss", role: "ADMIN", bizRole: null, managerId: null },
};
const 票们 = new Map<身份, string | undefined>();

const 表文件 = path.resolve(__dirname, "expected.json");
const 写表 = process.env.PERM_TABLE === "write";

// ---------- 扫描 ----------
const 源根 = path.resolve(__dirname, "../../src");
const 走 = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? 走(path.join(d, e.name)) : [path.join(d, e.name)]));
const 全部文件 = 走(源根).filter((f) => !f.includes(`${path.sep}generated${path.sep}`));
const 方法们 = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
/** 文件第一条语句是 "use server"（前面只许有注释） */
const 是动作文件 = (f: string) => /\.tsx?$/.test(f) && /^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(fs.readFileSync(f, "utf8"));
const 路由文件们 = 全部文件.filter((f) => path.basename(f) === "route.ts" && f.startsWith(path.join(源根, "app")));
const 动作文件们 = 全部文件.filter(是动作文件);

/** app/api/attachments/[id]/route.ts → /api/attachments/[id]；路由组 (app) 不进网址 */
const 网址of = (f: string) => "/" + path.relative(path.join(源根, "app"), path.dirname(f)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join("/");
const 实际网址 = (p: string) => p.replace(/\[\.\.\.[^\]]+\]/g, "不存在/x").replace(/\[[^\]]+\]/g, "不存在");
const 参数们 = (p: string) => {
  const o: Record<string, string | string[]> = {};
  for (const m of p.matchAll(/\[(\.\.\.)?([^\]]+)\]/g)) o[m[2]] = m[1] ? ["不存在", "x"] : "不存在";
  return o;
};

type 被测 = { 键: string; 文件: string; 调: () => Promise<unknown>; 是路由: boolean };
const 被测们: 被测[] = [];
for (const f of 路由文件们) {
  const mod = (await import(f)) as Record<string, unknown>;
  const 址 = 网址of(f);
  for (const m of 方法们) {
    const h = mod[m];
    if (typeof h !== "function") continue;
    被测们.push({
      键: `${m} ${址}`,
      文件: path.relative(path.resolve(源根, ".."), f),
      是路由: true,
      调: () => {
        const 头 = new Headers({ "content-type": "application/json", "user-agent": "vitest" });
        if (临时.票) 头.set("cookie", `crm_session=${临时.票}`);
        const req = new NextRequest(`http://localhost${实际网址(址)}`, { method: m, headers: 头, body: m === "GET" || m === "HEAD" ? undefined : "{}" });
        return (h as (r: NextRequest, c: unknown) => Promise<unknown>)(req, { params: Promise.resolve(参数们(址)) });
      },
    });
  }
}
for (const f of 动作文件们) {
  const mod = (await import(f)) as Record<string, unknown>;
  const 相对 = path.relative(源根, f).split(path.sep).join("/");
  for (const [名, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    被测们.push({
      键: `动作 ${相对}#${名}`,
      文件: path.relative(path.resolve(源根, ".."), f),
      是路由: false,
      // 参数一律给空表单：取字段拿到 null，当字符串用会报错，当编号查库查不到——都算参数错，不会误放行
      调: () => (fn as (...a: unknown[]) => Promise<unknown>)(...Array.from({ length: Math.max(fn.length, 1) }, () => new FormData())),
    });
  }
}
被测们.sort((a, b) => a.键.localeCompare(b.键));

// ---------- 归类 ----------
const 未登录文案 = /未登录|请先登录|登录已?(过期|失效)|重新登录|unauthori[sz]ed/i;
const 关着文案 = /只有桌面端|桌面端才|只在桌面端|托管版|没有开|没开|不提供|未开启|没有启用|这个部署|本地模式|当前部署没有|NOT_FOUND|多租户|不对外/i;
const 拒绝文案 = /FORBIDDEN|无权|没有权限|权限不够|只有.{0,24}(能|可以|才|有权)|仅.{0,12}(能|可)|不能(给|改|看|删|操作|管)|不是你的|不归你/i;
const 按文案 = (msg: string): 实际 => (未登录文案.test(msg) ? "401" : 关着文案.test(msg) ? "404" : 拒绝文案.test(msg) ? "403" : "400");
const 跳登录 = (url: string) => /^(https?:\/\/[^/]+)?\/(login|api\/auth\/logout)(\b|$)/.test(url);

type 记录 = { 实际: 实际; 细节: string };
function 归类错误(e: unknown): 记录 {
  const digest = e && typeof e === "object" && "digest" in e ? String((e as { digest: unknown }).digest) : "";
  if (digest.startsWith("NEXT_REDIRECT")) {
    const url = digest.split(";")[2] ?? "";
    return { 实际: 跳登录(url) ? "401" : "放行", 细节: `跳转 ${url}` };
  }
  const 码 = /^NEXT_HTTP_ERROR_FALLBACK;(\d+)/.exec(digest)?.[1];
  if (码) return { 实际: 码 === "401" ? "401" : 码 === "403" ? "403" : 码 === "404" ? "404" : "400", 细节: digest };
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("测试里不许连网") || msg.startsWith("控制面库不该被碰")) return { 实际: "400", 细节: `【挡住】${msg}` };
  // 参数类型不对时 Prisma 的报错里带着一段源码，别让源码里的字眼（「无权」「NOT_FOUND」）冒充拒绝
  if (/Invalid `\S+\(\)` invocation/.test(msg)) return { 实际: "400", 细节: `抛 Prisma 参数错 ${msg.split("\n").find((l) => l.includes("invocation"))?.trim().slice(0, 120) ?? ""}` };
  return { 实际: 按文案(msg), 细节: `抛 ${msg.replace(/\s+/g, " ").slice(0, 160)}` };
}
async function 归类返回(v: unknown, 是路由: boolean): Promise<记录> {
  if (是路由 && v instanceof Response) {
    const s = v.status;
    const 位 = v.headers.get("location") ?? "";
    let 文 = "";
    try {
      if (s >= 400) 文 = (await v.clone().text()).slice(0, 120);
    } catch {
      /* 流 */
    }
    // 流式接口（AI 问答）一律先回 200，认人在流里：读到最后那条 result 才知道是放行还是被拒
    if (s === 200 && (v.headers.get("content-type") ?? "").includes("event-stream")) {
      const 全文 = await Promise.race([v.text(), new Promise<string>((r) => setTimeout(() => r(""), 4000))]);
      const 结果 = 全文.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)) as Record<string, unknown>; } catch { return {}; } }).filter((x) => x.type === "result").pop();
      if (结果 && 结果.ok === false) return { 实际: 按文案(String(结果.error ?? "")), 细节: `流 ${String(结果.error ?? "").slice(0, 160)}` };
      return { 实际: "放行", 细节: `流 ${全文.slice(0, 120)}` };
    }
    if (s >= 300 && s < 400) return { 实际: 跳登录(位) ? "401" : "放行", 细节: `${s} → ${位}` };
    if (s === 401 || s === 403 || s === 404) return { 实际: String(s) as 实际, 细节: `${s} ${文}` };
    return { 实际: s < 300 ? "放行" : "400", 细节: `${s} ${文}` };
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const 文 = [o.error, o.message, o.msg, o.reason].find((x) => typeof x === "string" && x) as string | undefined;
    if (o.status === 401 || o.status === 403 || o.status === 404) return { 实际: String(o.status) as 实际, 细节: `回 status ${o.status} ${文 ?? ""}` };
    if (o.ok === false || (typeof o.error === "string" && o.error)) {
      if (!文) return { 实际: "400", 细节: `回 ${JSON.stringify(o).slice(0, 120)}（不带文案）` };
      return { 实际: 按文案(文), 细节: `回 ${文.slice(0, 160)}` };
    }
  }
  return { 实际: "放行", 细节: `回 ${(JSON.stringify(v) ?? String(v)).slice(0, 120)}` };
}
async function 调一次(t: 被测, 谁: 身份): Promise<记录> {
  await 恢复基线();
  临时.票 = 票们.get(谁);
  let 计时: ReturnType<typeof setTimeout> | undefined;
  try {
    const v = await Promise.race([t.调(), new Promise<"超时">((r) => (计时 = setTimeout(() => r("超时"), 5000)))]);
    if (v === "超时") return { 实际: "超时", 细节: "5 秒没回" };
    return await 归类返回(v, t.是路由);
  } catch (e) {
    return 归类错误(e);
  } finally {
    clearTimeout(计时);
    临时.票 = undefined;
  }
}
/** 实际结果符不符合表里这一格 */
const 符合 = (期: 格 | undefined, 实: 实际) => (期 === "允许" ? 实 === "放行" || 实 === "400" : 期 === 实);

// ---------- 库 ----------
const 存设置 = (key: string, v: unknown) => raw.setting.upsert({ where: { key }, update: { value: JSON.stringify(v) }, create: { key, value: JSON.stringify(v) } });
/** 每一次调用前都把人、组织、设置拉回原样：前一个身份真放行了改了什么，也影响不到后一个 */
async function 恢复基线() {
  for (const [名, u] of Object.entries(人)) {
    const data = { email: `${u.id}@x.com`, name: 名, password: "x", role: u.role, active: true };
    await raw.user.upsert({ where: { id: u.id }, update: data, create: { id: u.id, ...data } });
  }
  for (const u of Object.values(人)) {
    // 老板不进组织表：ADMIN 账号本来就是老板（推业务角色 推成 director）
    if (!u.bizRole) {
      await raw.entMember.deleteMany({ where: { userId: u.id } });
      continue;
    }
    const data = { bizRole: u.bizRole, managerId: u.managerId, dottedManagerId: null, deptId: null };
    await raw.entMember.upsert({ where: { userId: u.id }, update: data, create: { userId: u.id, ...data } });
  }
  await raw.$executeRawUnsafe(`DELETE FROM "Setting"`);
  await 存设置(规则.按组织看客户.key, true);
  await 存设置(规则.线索分配.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
}

// ---------- 表 ----------
type 表 = { 说明: string[]; 接口: Record<string, 条目> };
const 读表 = (): 表 => (fs.existsSync(表文件) ? JSON.parse(fs.readFileSync(表文件, "utf8")) : { 说明: [], 接口: {} });
const 期望表 = 读表();
const 录到 = new Map<string, Record<身份, 记录>>();

/** 一行一条，方便看 diff */
function 写出(t: 表) {
  const 行 = Object.keys(t.接口)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => {
      const e = t.接口[k];
      const 有序: Record<string, unknown> = {};
      for (const s of 身份们) 有序[s] = e[s];
      for (const x of ["公开", "注", "bug"] as const) if (e[x]) 有序[x] = e[x];
      return `    ${JSON.stringify(k)}: ${JSON.stringify(有序)}`;
    });
  fs.writeFileSync(表文件, `{\n  "说明": ${JSON.stringify(t.说明, null, 2).replace(/\n/g, "\n  ")},\n  "接口": {\n${行.join(",\n")}\n  }\n}\n`);
}

beforeAll(async () => {
  for (const t of ["AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await 恢复基线();
  const 密钥 = new TextEncoder().encode(readSecret());
  票们.set("未登录", undefined);
  for (const [名, u] of Object.entries(人)) 票们.set(名 as 身份, await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuedAt().setExpirationTime("1h").sign(密钥));
}, 60_000);

afterAll(async () => {
  if (写表) {
    const 新: 表 = { 说明: 期望表.说明, 接口: {} };
    for (const [键, 各] of 录到) {
      const 旧 = 期望表.接口[键] ?? {};
      const e: 条目 = {};
      for (const s of 身份们) {
        const 实 = 各[s].实际;
        // 表里特意写成 "400" 的格（参数错先于权限判断）照旧保留，其余按实际重写
        e[s] = 旧[s] === "400" && 实 === "400" ? "400" : 实 === "放行" || 实 === "400" ? "允许" : 实 === "超时" ? "400" : 实;
      }
      for (const x of ["公开", "注", "bug"] as const) if (旧[x]) e[x] = 旧[x];
      新.接口[键] = e;
    }
    写出(新);
    if (process.env.PERM_DUMP) {
      const 行 = [...录到].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify({ 键: k, 文件: 被测们.find((t) => t.键 === k)?.文件, ...Object.fromEntries(身份们.map((s) => [s, `${v[s].实际} | ${v[s].细节}`])) }));
      fs.writeFileSync(process.env.PERM_DUMP, 行.join("\n") + "\n");
    }
  }
  await raw.$disconnect();
  vi.unstubAllGlobals();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("权限表和代码对得上", () => {
  it("扫得到东西（扫描本身没坏）", () => {
    expect(路由文件们.length).toBeGreaterThan(40);
    expect(动作文件们.length).toBeGreaterThan(30);
    expect(被测们.filter((t) => t.是路由).length).toBeGreaterThan(50);
    expect(被测们.filter((t) => !t.是路由).length).toBeGreaterThan(200);
  });

  it.skipIf(写表)("每个扫出来的接口表里都有，表里每条代码里都还在", () => {
    const 扫到 = new Set(被测们.map((t) => t.键));
    const 缺 = [...扫到].filter((k) => !期望表.接口[k]);
    const 多 = Object.keys(期望表.接口).filter((k) => !扫到.has(k));
    expect(缺, `新加接口要补表（tests/permissions/expected.json，可以 PERM_TABLE=write 先录再审）：\n${缺.join("\n")}`).toEqual([]);
    expect(多, `表里有、代码里已经没有了，从 expected.json 删掉：\n${多.join("\n")}`).toEqual([]);
  });

  it.skipIf(写表)("表本身守规矩：未登录都拒、写成 400 的都有注、公开的都有理由", () => {
    const 错: string[] = [];
    for (const [k, e] of Object.entries(期望表.接口)) {
      for (const s of 身份们) if (!["允许", "400", "401", "403", "404"].includes(e[s] as string)) 错.push(`${k}：${s} 这一格没写或写错了（${e[s]}）`);
      const 登录的 = 身份们.filter((s) => s !== "未登录").map((s) => e[s]);
      // 整条在这个部署里关着：谁来都一样被拒，未登录拿到同一个拒绝码也行
      const 整条关着 = (e.未登录 === "404" || e.未登录 === "403") && 登录的.every((x) => x === e.未登录);
      // 未登录没拿到 401：要么明确公开（写理由），要么是已知问题——参数错先于认人（"400" + 注）、放行了但不漏数据（注）、真漏了（bug）
      const 有说法 = e.公开 || e.bug || (e.注 && (e.未登录 === "400" || e.未登录 === "允许"));
      if (e.未登录 !== "401" && !整条关着 && !有说法) 错.push(`${k}：未登录应为 401，实际表里是 ${e.未登录}（明确公开的写「公开」+ 理由）`);
      if (e.公开 !== undefined && !e.公开.trim()) 错.push(`${k}：「公开」要写理由`);
      for (const s of 身份们) if (e[s] === "400" && !e.注) 错.push(`${k}：${s} 写成 400（参数错先于权限判断）要写「注」`);
    }
    expect(错, 错.join("\n")).toEqual([]);
  });
});

describe("逐条按五种身份调一遍", () => {
  it.each(被测们.map((t) => [t.键, t] as const))("%s", async (键, t) => {
    const 期 = 期望表.接口[键];
    const 各 = {} as Record<身份, 记录>;
    // 老板放最后：权限最大的那位真放行了，不连累前面几位的结果（每次调用前也都恢复基线）
    for (const s of 身份们) 各[s] = await 调一次(t, s);
    录到.set(键, 各);
    if (写表) return;
    expect(各.未登录.实际 === "超时" || 身份们.some((s) => 各[s].实际 === "超时"), `${键} 有身份 5 秒没回：${JSON.stringify(各)}`).toBe(false);
    if (!期) return; // 缺表那条在上面报
    const 不符 = 身份们.filter((s) => !符合(期[s], 各[s].实际)).map((s) => `${s}：表里 ${期[s]}，实际 ${各[s].实际}（${各[s].细节}）`);
    expect(不符, `${键}（${t.文件}）\n${不符.join("\n")}`).toEqual([]);
  }, 40_000);
});
