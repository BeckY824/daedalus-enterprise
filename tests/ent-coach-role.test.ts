/**
 * 企业版业务角色「销售教练」（coach，11-17）：照只读管理员那套——看全部（第一版设了业务线也看全部，不按线）、写全拦、不当负责人、不领不建；
 * 电话对他藏（Q9，规则开不开都藏）；不兼销售类角色（Q10，设置页、服务端都挡）；账号 ADMIN 不放行。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-coach-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 登录.user, getCurrentUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 读组织 } from "@/lib/enterprise/org";
import { 项目页去向 } from "@/app/(app)/projects/[id]/load";
import { 读市场身份 } from "@/lib/enterprise/market-view-db";
import {
  能看全部, 能看项目, 能进设置, 只读角色, 是教练, 只读话of, 只读角色话, 教练只读话, 能当负责人, 不能当负责人话, 能新建和领取, 能领公海,
  能编辑项目, 能转让项目, 能删除, 能改客户, 是管理层, 是系统管理员,
} from "@/lib/enterprise/permissions";
import { 按线的线 } from "@/lib/enterprise/line-viewer";
import { 能切换视图 } from "@/lib/enterprise/view-as";
import { 能导入导出 } from "@/lib/enterprise/import-perm";
import { 字段权限of, 字段权限key } from "@/lib/enterprise/field-perm";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 对照能给的角色 } from "@/lib/enterprise/org-sync";
import { 设置范围of, 我能做什么 } from "@/lib/enterprise/settings-scope";
import { 角色组合问题, 角色名, 默认范围, 是只读角色们 } from "@/lib/sync/dept-policy";
import { 卡点只读, 默认卡点角色开关 } from "@/lib/project/blocker-rules";
import { 领取 } from "@/app/(app)/customers/pool-actions";
import { 设成员 } from "@/app/(app)/settings/org-actions";
import { invalidateSettingsCache } from "@/lib/settings";
import { 能看提成, 销售教练能看提成, 读项目提成 } from "@/lib/project/commission-db";
import { 开启MCP, 查MCP接入 } from "@/app/(app)/settings/actions";
import { 读令牌 } from "@/lib/mcp/token";

const 教练 = "co_coach"; // coach，账号 ADMIN（账号角色不放行）
const 线教 = "co_line"; // coach + 外贸：第一版照样看全部
const 兼总 = "co_dir"; // coach,director：总管理盖过只读
const 兼管 = "co_adm"; // coach,admin：只读，说管理员那句
const 老板 = "co_boss"; // director
const 外销 = "co_wai"; // sales，外贸
const 内销 = "co_nei"; // sales，内贸
const 外下 = "co_sub"; // sales，内贸，线教的实线下属

const 作为 = <T,>(id: string, f: () => Promise<T>) => 以谁的身份(id, f);
const 我 = (id: string) => ({ id, role: "SALES" });
const 排 = (a: string[]) => [...a].sort();
const 项目名单 = async (id: string) => 排((await 作为(id, () => db.project.findMany())).map((p) => p.name));
const 客户名单 = async (id: string) => 排((await 作为(id, () => db.customer.findMany())).map((c) => c.name).filter((n) => n.startsWith("客-")));
const 存设置 = async (key: string, v: unknown) => {
  await raw.setting.upsert({ where: { key }, update: { value: JSON.stringify(v) }, create: { key, value: JSON.stringify(v) } });
  invalidateSettingsCache();
  忘掉企业版范围();
};
let 序 = 0;
const 客 = (name: string, salesOwnerId: string, bizLine?: string | null) => raw.customer.create({ data: { name, phone: `139${String(++序).padStart(8, "0")}`, salesOwnerId, bizLine: bizLine ?? null } });
const 项 = async (name: string, ownerId: string, bizLine: string | null, opt: { pooledAt?: Date } = {}) => {
  const c = await 客(`项目客-${name}`, ownerId, bizLine);
  return raw.project.create({ data: { name, customerId: c.id, ownerId, creatorId: ownerId, bizLine, pooledAt: opt.pooledAt ?? null, phase: "商机", node: "明确需求" } });
};

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntBlocker", "ProjectNodeLog", "ProjectMember", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  await raw.$executeRawUnsafe('DELETE FROM "Customer"');
  await raw.$executeRawUnsafe('DELETE FROM "Channel"');
  await raw.$executeRawUnsafe('DELETE FROM "User"');
  for (const id of [教练, 线教, 兼总, 兼管, 老板, 外销, 内销, 外下]) {
    await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: id === 教练 ? "ADMIN" : "SALES", active: true } });
  }
  await raw.entMember.createMany({
    data: [
      { userId: 教练, bizRole: "coach" },
      { userId: 线教, bizRole: "coach", line: "外贸" },
      { userId: 兼总, bizRole: "coach,director" },
      { userId: 兼管, bizRole: "admin,coach" },
      { userId: 老板, bizRole: "director" },
      { userId: 外销, bizRole: "sales", line: "外贸" },
      { userId: 内销, bizRole: "sales", line: "内贸" },
      { userId: 外下, bizRole: "sales", line: "内贸", managerId: 线教 },
    ],
  });
  await 项("外销外贸", 外销, "外贸");
  await 项("内销内贸", 内销, "内贸");
  await 项("下属内贸", 外下, "内贸");
  await 项("公海内贸", 内销, "内贸", { pooledAt: new Date() });
  await 客("客-外销", 外销, "外贸");
  await 客("客-内销", 内销, "内贸");
  const 公 = await 客("客-公海", 内销, "内贸");
  await raw.customerPool.create({ data: { customerId: 公.id } });
  await 存设置(规则.按组织看客户.key, true);
}, 60_000);

beforeEach(() => 忘掉企业版范围());
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("角色本身", () => {
  it("叫「销售教练」、默认看全部；只读名单里有它", () => {
    expect(角色名.coach).toBe("销售教练");
    expect(默认范围.coach).toBe("all");
    expect(是只读角色们(["coach"])).toBe(true);
    expect(是只读角色们(["coach", "director"])).toBe(false);
  });

  it("只读、看全部、不当负责人、不领不建、进不了设置、切不了视图、不能导入导出；账号 ADMIN 不放行", async () => {
    const org = await 读组织();
    const me = { id: 教练, role: "ADMIN" };
    expect(只读角色(me, org)).toBe(true);
    expect(是教练(me, org)).toBe(true);
    expect(能看全部(me, org)).toBe(true);
    expect(是系统管理员(me, org)).toBe(false);
    expect(能当负责人(org, 教练)).toBe(false);
    expect(不能当负责人话(org, 教练)).toBe("销售教练只读，不能当负责人");
    expect(能新建和领取(me, org)).toBe(false);
    expect(能领公海(me, org)).toBe(false);
    expect(能进设置(me, org)).toBe(false);
    expect(能切换视图(org, 教练)).toBe(false);
    expect(await 能导入导出(me)).toBe(false);
    // 首页、复盘按人看（同只读管理员）
    expect(是管理层(me, org)).toBe(true);
  });

  it("项目、客户上的写判定全拒（含公海里的）", async () => {
    const org = await 读组织();
    const me = 我(教练);
    for (const p of await raw.project.findMany()) {
      expect(能看项目(me, p, org)).toBe(true);
      expect(能编辑项目(me, p, org)).toBe(false);
      expect(能转让项目(me, p, org)).toBe(false);
    }
    expect(能删除(me, org, 教练)).toBe(false);
    expect(能改客户(me, { salesOwnerId: 外销, 在公海: false }, org)).toBe(false);
    expect(能改客户(me, { salesOwnerId: null, 在公海: true }, org)).toBe(false);
  });

  it("只读那句按人说：教练说教练的，兼管理员的、管理员照旧", async () => {
    const org = await 读组织();
    expect(只读话of(我(教练), org)).toBe(教练只读话);
    expect(只读话of(我(兼管), org)).toBe(只读角色话);
    expect(只读角色(我(兼管), org)).toBe(true);
  });

  it("兼总管理：按总管理（不只读、能当负责人）", async () => {
    const org = await 读组织();
    expect(只读角色(我(兼总), org)).toBe(false);
    expect(是系统管理员(我(兼总), org)).toBe(true);
    expect(能当负责人(org, 兼总)).toBe(true);
  });
});

describe("看得到什么", () => {
  it("没设线：项目、客户全部（含公海）", async () => {
    expect(await 项目名单(教练)).toEqual(排(["外销外贸", "内销内贸", "下属内贸", "公海内贸"]));
    expect(await 客户名单(教练)).toEqual(排(["客-外销", "客-内销", "客-公海"]));
  });

  it("「按组织看客户」关着也看全部", async () => {
    await 存设置(规则.按组织看客户.key, false);
    try {
      expect((await 项目名单(教练)).length).toBe(4);
    } finally {
      await 存设置(规则.按组织看客户.key, true);
    }
  });

  it("设了外贸线：第一版不按线，照样看全部（只读）", async () => {
    const org = await 读组织();
    expect(按线的线(org, 线教)).toBeNull();
    expect(按线的线(org, 教练)).toBeNull();
    expect(能看全部(我(线教), org)).toBe(true);
    expect(只读角色(我(线教), org)).toBe(true);
    expect(await 项目名单(线教)).toEqual(排(["外销外贸", "内销内贸", "下属内贸", "公海内贸"]));
    expect(await 客户名单(线教)).toContain("客-内销");
  });
});

describe("放在市场部门里（录音点评跟进 11-22，3703 实操）", () => {
  it("教练、兼管理员的放进市场部门：不算市场视角，项目照教练口径都进得去（不落「没有找到这条记录」）", async () => {
    const 市场部 = (await raw.entDept.create({ data: { name: "市场部" } })).id;
    await raw.entMember.updateMany({ where: { userId: { in: [教练, 兼管] } }, data: { deptId: 市场部 } });
    忘掉企业版范围();
    try {
      const p = await raw.project.findFirstOrThrow({ where: { name: "外销外贸" }, select: { id: true, customerId: true } });
      for (const id of [教练, 兼管]) {
        expect(await 读市场身份(id)).toBeNull();
        expect(await 作为(id, () => 项目页去向({ id, role: "SALES" } as never, p.id))).toEqual({ 种: "客户页", 到: `/customers/${p.customerId}?project=${p.id}` });
        expect(await 项目名单(id)).toEqual(排(["外销外贸", "内销内贸", "下属内贸", "公海内贸"]));
      }
    } finally {
      await raw.entMember.updateMany({ where: { userId: { in: [教练, 兼管] } }, data: { deptId: null } });
      await raw.entDept.delete({ where: { id: 市场部 } });
      忘掉企业版范围();
    }
  });
});

describe("写全拦（服务端 team-scope）", () => {
  it("改项目、改客户、记沟通、发卡点、建待办都拒，库里不变", async () => {
    const p = await raw.project.findFirstOrThrow({ where: { name: "外销外贸" } });
    await expect(作为(教练, () => db.project.update({ where: { id: p.id }, data: { name: "改" } }))).rejects.toThrow(教练只读话);
    await expect(作为(教练, () => db.customer.update({ where: { id: p.customerId }, data: { major: "x" } }))).rejects.toThrow(教练只读话);
    await expect(作为(教练, () => db.followUp.create({ data: { customerId: p.customerId, userId: 教练, content: "x", type: "电话" } as never }))).rejects.toThrow(教练只读话);
    await expect(作为(教练, () => db.task.create({ data: { customerId: p.customerId, ownerId: 外销, title: "x" } }))).rejects.toThrow(教练只读话);
    await expect(
      作为(教练, () => db.entBlocker.create({ data: { code: "CO-1", projectId: p.id, customerId: p.customerId, phase: "商机", type: "中度卡点", impact: "短期不影响", obstacle: "x", description: "x", dueDays: 3, dueAt: new Date(), creatorId: 教练 } })),
    ).rejects.toThrow(教练只读话);
    await expect(作为(教练, () => db.project.delete({ where: { id: p.id } }))).rejects.toThrow(教练只读话);
    expect(await raw.task.count({ where: { customerId: p.customerId } })).toBe(0);
    expect((await raw.project.findUniqueOrThrow({ where: { id: p.id } })).name).toBe("外销外贸");
    expect(await raw.followUp.count({ where: { customerId: p.customerId } })).toBe(0);
    expect(await raw.entBlocker.count()).toBe(0);
  });

  it("设线的教练同样拒", async () => {
    const p = await raw.project.findFirstOrThrow({ where: { name: "外销外贸" } });
    await expect(作为(线教, () => db.project.update({ where: { id: p.id }, data: { name: "改" } }))).rejects.toThrow(教练只读话);
  });

  it("公海看得到、领不走", async () => {
    const c = await raw.customer.findFirstOrThrow({ where: { name: "客-公海" } });
    登录.user = { ...登录.user, id: 教练, name: 教练, role: "ADMIN" };
    expect(await 领取([c.id])).toEqual({ ok: false, error: 教练只读话 });
    const 后 = await raw.customer.findUniqueOrThrow({ where: { id: c.id }, include: { pool: true } });
    expect(后.pool).not.toBeNull();
  });
});

describe("电话对教练藏（Q9）", () => {
  it("「字段权限」规则关着也藏，别的字段只能看；总管理、兼总管理、销售照旧", async () => {
    await 存设置(规则.字段权限.key, false);
    expect((await 字段权限of(教练))("电话")).toBe("藏");
    expect((await 字段权限of(教练))("商机金额")).toBe("看");
    expect((await 字段权限of(线教))("电话")).toBe("藏");
    expect((await 字段权限of(老板))("电话")).toBe("改");
    expect((await 字段权限of(兼总))("电话")).toBe("改");
    expect((await 字段权限of(外销))("电话")).toBe("改");
    const 教练号 = await 号码脱敏器(教练);
    expect(教练号("13912345678")).not.toBe("13912345678");
    expect(教练号("13912345678")).toContain("*");
    expect((await 号码脱敏器(老板))("13912345678")).toBe("13912345678");
  });

  it("规则开着、配置表给教练写了「看」也不管用：照样藏", async () => {
    await 存设置(规则.字段权限.key, true);
    await 存设置(字段权限key, { 电话: { coach: "看" } });
    try {
      expect((await 字段权限of(教练))("电话")).toBe("藏");
      expect((await 号码脱敏器(教练))("13912345678")).toContain("*");
    } finally {
      await 存设置(规则.字段权限.key, false);
    }
  });

  it("没传人、请求外（定时任务）规则关着照旧不打码", async () => {
    await 存设置(规则.字段权限.key, false);
    登录.user = { ...登录.user, id: "" };
    expect((await 号码脱敏器())("13912345678")).toBe("13912345678");
  });
});

describe("不兼销售类角色（Q10）", () => {
  it("纯判定：兼销售、销管、渠运、市管、组员都不行；兼总管理、管理员可以", () => {
    for (const r of ["sales", "sales_mgr", "channel_ops", "marketing_mgr", "project_ops"]) expect(角色组合问题(["coach", r])).toMatch(/销售教练不能兼/);
    expect(角色组合问题(["coach", "director"])).toBeNull();
    expect(角色组合问题(["coach", "admin"])).toBeNull();
    expect(角色组合问题(["sales", "marketing_mgr"])).toBeNull();
  });

  it("服务端 设成员 挡住，库里不变；单设教练能存", async () => {
    登录.user = { ...登录.user, id: 老板, name: 老板, role: "SALES" };
    const r = await 设成员(外销, { bizRole: ["coach", "sales"] });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/销售教练不能兼销售成员/) });
    expect((await raw.entMember.findUniqueOrThrow({ where: { userId: 外销 } })).bizRole).toBe("sales");
    const r2 = await 设成员(内销, { bizRole: ["coach"] });
    expect(r2.ok).toBe(true);
    expect((await raw.entMember.findUniqueOrThrow({ where: { userId: 内销 } })).bizRole).toBe("coach");
    await raw.entMember.update({ where: { userId: 内销 }, data: { bizRole: "sales" } });
    忘掉企业版范围();
  });
});

describe("别处的口径", () => {
  it("飞书职务对照不自动给教练；卡点只读、默认看全部", () => {
    expect(对照能给的角色("coach")).toBe(false);
    expect(卡点只读(["coach"])).toBe(true);
    expect(卡点只读(["coach", "director"])).toBe(false);
    expect(默认卡点角色开关.范围.coach).toBe("全部");
  });

  it("设置页：只给个人页签、按只读显示；「我能做什么」写明不能改、看不到电话", async () => {
    const org = await 读组织();
    const 范围 = 设置范围of({ id: 教练, role: "ADMIN" }, org, true);
    expect(范围).toMatchObject({ 身份: "只读管理员", 可看: false, 可改: false, 只读: true, 只个人: true });
    const 项 = 我能做什么(["coach"], 范围.身份, false);
    expect(项.find((x) => x.事 === "改任何数据")?.能).toBe(false);
    expect(项.find((x) => x.事 === "看客户电话")?.能).toBe(false);
    expect(项.find((x) => x.事 === "看全部客户和项目")?.能).toBe(true);
  });
});

describe("提成、MCP、导出（11-17 评估）", () => {
  it("提成：教练看不到（提成卡、AI 查提成表都走 能看提成）；常量默认藏；兼管理员的按管理员看", async () => {
    expect(销售教练能看提成).toBe(false);
    const org = await 读组织();
    const p = await raw.project.findFirstOrThrow({ where: { name: "外销外贸" } });
    expect(能看提成(我(教练), p, new Set(), org)).toBe(false);
    expect(能看提成(我(线教), p, new Set(), org)).toBe(false);
    expect(能看提成(我(兼管), p, new Set(), org)).toBe(true);
    expect(能看提成(我(老板), p, new Set(), org)).toBe(true);
    const 卡 = await 读项目提成(我(教练), { ...p, amount: 100, currency: "CNY" }, [], org, (id) => id, raw);
    expect(卡).toBeNull();
  });

  it("MCP 令牌：教练开不了、看不到；库里没有令牌", async () => {
    登录.user = { ...登录.user, id: 教练, name: 教练, role: "ADMIN" };
    const r = await 开启MCP();
    expect(r).toMatchObject({ ok: false });
    expect(await 查MCP接入()).toMatchObject({ 可用: false, 令牌: null });
    expect(await 读令牌()).toBeNull();
  });

  it("导出：教练不能（能导入导出只给系统管理员）", async () => {
    expect(await 能导入导出({ id: 教练, role: "ADMIN" })).toBe(false);
    expect(await 能导入导出({ id: 线教, role: "SALES" })).toBe(false);
  });
});
