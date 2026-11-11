/**
 * 企业版「按线只读」（11-02，lib/enterprise/line-viewer.ts + visibility.ts + team-scope）：业务角色 管理员 + 业务线。
 * 钉的是：负责人或创建人是这条线的成员、标签是这条线、下属的、公海的都看得到，别的看不到；一律不能改；
 * 看板选人框有这条线的成员；切视图、设置不给；没设业务线的管理员照旧看全部；另一条线设上人就对称生效。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-line-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 读组织 } from "@/lib/enterprise/org";
import { 能看全部, 能看项目, 能进设置, 只读角色, 只读按线, 只读角色话 } from "@/lib/enterprise/permissions";
import { 按线的线, 按线范围of } from "@/lib/enterprise/line-viewer";
import { 能切换视图 } from "@/lib/enterprise/view-as";
import { 看板范围of } from "@/lib/project/board-member";
import { 卡点权限, 卡点看板范围 } from "@/lib/project/blocker";
import { 领取 } from "@/app/(app)/customers/pool-actions";

const 线管 = "lv_view"; // 管理员 + 外贸
const 内管 = "lv_nei"; // 管理员 + 内贸（留的那个位置）
const 全管 = "lv_all"; // 管理员，没设业务线
const 总 = "lv_dir"; // 总管理 + 外贸：兼总管理不算按线
const 外下 = "lv_sub"; // 外贸，线管的实线下属
const 外甲 = "lv_wa"; // 外贸，不在线管链上
const 下内 = "lv_subnei"; // 内贸，线管的实线下属
const 虚内 = "lv_dot"; // 内贸，线管的虚线下属
const 内甲 = "lv_na"; // 内贸，不在线管链上
const 无线 = "lv_none"; // 没设业务线

const 作为 = <T,>(id: string, f: () => Promise<T>) => 以谁的身份(id, f);
const 我 = (id: string) => ({ id, role: "SALES" });
const 排 = (a: string[]) => [...a].sort();
const 项目名单 = async (id: string) => 排((await 作为(id, () => db.project.findMany())).map((p) => p.name));
const 客户名单 = async (id: string) => 排((await 作为(id, () => db.customer.findMany())).map((c) => c.name).filter((n) => n.startsWith("客-")));
const 存设置 = async (key: string, v: unknown) => {
  await raw.setting.upsert({ where: { key }, update: { value: JSON.stringify(v) }, create: { key, value: JSON.stringify(v) } });
  忘掉企业版范围();
};
let 序 = 0;
const 客 = (name: string, salesOwnerId: string, bizLine?: string | null) => raw.customer.create({ data: { name, phone: `139${String(++序).padStart(8, "0")}`, salesOwnerId, bizLine: bizLine ?? null } });
const 项 = async (name: string, ownerId: string, bizLine: string | null, opt: { creatorId?: string; pooledAt?: Date } = {}) => {
  const c = await 客(`项目客-${name}`, ownerId, bizLine);
  return raw.project.create({ data: { name, customerId: c.id, ownerId, creatorId: opt.creatorId ?? ownerId, bizLine, pooledAt: opt.pooledAt ?? null, phase: "商机", node: "明确需求" } });
};

// 线管看得到 / 看不到的项目
const 线管看得到 = ["外甲负责外贸标", "外甲负责内贸标", "外甲创建内甲负责", "内甲负责外贸标", "外甲负责没填", "下属负责内贸标", "虚线下属负责内贸标", "公海内贸", "我是组员内贸"];
const 线管看不到 = ["内甲内贸", "内甲没填", "内甲暂不分配", "无线内贸", "无线没填"];

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntBlocker", "ProjectNodeLog", "ProjectMember", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  await raw.$executeRawUnsafe('DELETE FROM "Customer"');
  await raw.$executeRawUnsafe('DELETE FROM "Channel"');
  await raw.$executeRawUnsafe('DELETE FROM "User"');
  for (const id of [线管, 内管, 全管, 总, 外下, 外甲, 下内, 虚内, 内甲, 无线]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES", active: true } });
  await raw.entMember.createMany({
    data: [
      { userId: 线管, bizRole: "admin", line: "外贸", noSettings: true },
      { userId: 内管, bizRole: "admin", line: "内贸", noSettings: true },
      { userId: 全管, bizRole: "admin" },
      { userId: 总, bizRole: "director", line: "外贸" },
      { userId: 外下, bizRole: "sales", line: "外贸", managerId: 线管 },
      { userId: 外甲, bizRole: "channel_ops", line: "外贸" },
      { userId: 下内, bizRole: "sales", line: "内贸", managerId: 线管 },
      { userId: 虚内, bizRole: "sales", line: "内贸", dottedManagerId: 线管 },
      { userId: 内甲, bizRole: "sales", line: "内贸" },
      { userId: 无线, bizRole: "sales" },
    ],
  });

  await 项("外甲负责外贸标", 外甲, "外贸");
  await 项("外甲负责内贸标", 外甲, "内贸");
  await 项("外甲创建内甲负责", 内甲, "内贸", { creatorId: 外甲 });
  await 项("内甲负责外贸标", 内甲, "外贸");
  await 项("外甲负责没填", 外甲, null);
  await 项("下属负责内贸标", 下内, "内贸");
  await 项("虚线下属负责内贸标", 虚内, "内贸");
  await 项("公海内贸", 内甲, "内贸", { pooledAt: new Date() });
  const 组员的 = await 项("我是组员内贸", 内甲, "内贸");
  await raw.projectMember.create({ data: { projectId: 组员的.id, userId: 线管, inviteStatus: "JOINED" } });
  await 项("内甲内贸", 内甲, "内贸");
  await 项("内甲没填", 内甲, null);
  await 项("内甲暂不分配", 内甲, "暂不分配");
  await 项("无线内贸", 无线, "内贸");
  await 项("无线没填", 无线, null);

  await 客("客-外贸标内甲负责", 内甲, "外贸");
  await 客("客-内贸标外甲负责", 外甲, "内贸");
  await 客("客-没填外甲负责", 外甲, null);
  await 客("客-下属内贸标", 下内, "内贸");
  await 客("客-内甲内贸", 内甲, "内贸");
  await 客("客-内甲没填", 内甲, null);
  const 带外贸项目 = await 客("客-内甲内贸带外贸项目", 内甲, "内贸");
  await raw.project.create({ data: { name: "挂在内贸客户下的外贸项目", customerId: 带外贸项目.id, ownerId: 无线, creatorId: 无线, bizLine: "外贸", phase: "商机", node: "明确需求" } });
  const 公 = await 客("客-公海内贸", 内甲, "内贸");
  await raw.customerPool.create({ data: { customerId: 公.id } });
  线管看得到.push("挂在内贸客户下的外贸项目");
}, 60_000);

beforeEach(() => 忘掉企业版范围());
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("身份", () => {
  it("管理员 + 业务线才算按线；没设线的、兼总管理的、销售都不算", async () => {
    const org = await 读组织();
    expect(按线的线(org, 线管)).toBe("外贸");
    expect(按线的线(org, 内管)).toBe("内贸");
    expect(按线的线(org, 全管)).toBeNull();
    expect(按线的线(org, 总)).toBeNull();
    expect(按线的线(org, 外甲)).toBeNull();
    expect(只读按线(我(线管), org)).toBe("外贸");
    expect(只读按线(我(全管), org)).toBeNull();
  });

  it("名单 = 本人 + 下属（实线、虚线）+ 这条线的成员；不含别的线", async () => {
    const x = 按线范围of(await 读组织(), 线管)!;
    expect(排(x.人们)).toEqual(排([线管, 外下, 下内, 虚内, 外甲, 总]));
    expect(x.人们).not.toContain(内甲);
  });

  it("不算看全部、照样只读、设置和切视图都不给；没设线的管理员照旧看全部", async () => {
    const org = await 读组织();
    expect(能看全部(我(线管), org)).toBe(false);
    expect(只读角色(我(线管), org)).toBe(true);
    expect(能进设置(我(线管), org)).toBe(false);
    expect(能切换视图(org, 线管)).toBe(false);
    expect(能看全部(我(全管), org)).toBe(true);
    expect(只读角色(我(全管), org)).toBe(true);
    // V3.5.1：切视图只给系统管理员，没设线的管理员也不行
    expect(能切换视图(org, 全管)).toBe(false);
    expect(能切换视图(org, 总)).toBe(false); // 总 设了线 = 条线总管理，也只看不切
  });
});

describe("看得到什么", () => {
  it("项目：线上成员负责或创建、标签对上、下属、公海、自己是组员的看得到；别的看不到", async () => {
    const 看到 = await 项目名单(线管);
    expect(看到).toEqual(排(线管看得到));
    for (const n of 线管看不到) expect(看到).not.toContain(n);
  });

  it("客户：标签对上、线上成员负责、下属负责、名下有这条线的项目、公海；别的看不到", async () => {
    const 看到 = await 客户名单(线管);
    expect(看到).toEqual(排(["客-外贸标内甲负责", "客-内贸标外甲负责", "客-没填外甲负责", "客-下属内贸标", "客-内甲内贸带外贸项目", "客-公海内贸"]));
  });

  it("项目下的客户跟着看到；看不到的项目，客户也看不到", async () => {
    const 名 = (await 作为(线管, () => db.customer.findMany())).map((c) => c.name);
    expect(名).toContain("项目客-外甲负责内贸标");
    expect(名).not.toContain("项目客-内甲内贸");
  });

  it("「按组织看客户」关着也按线", async () => {
    await 存设置(规则.按组织看客户.key, false);
    try {
      expect(await 项目名单(线管)).toEqual(排(线管看得到));
    } finally {
      await 存设置(规则.按组织看客户.key, true);
    }
  });

  it("能看项目（详情页）和列表一个口径", async () => {
    const org = await 读组织();
    const 列表 = new Set(await 项目名单(线管));
    for (const p of await raw.project.findMany()) {
      if (p.name === "我是组员内贸") continue; // 组员在详情页另外放行
      expect([p.name, 能看项目(我(线管), p, org)]).toEqual([p.name, 列表.has(p.name)]);
    }
  });

  it("没设线的管理员看全部", async () => {
    expect((await 项目名单(全管)).length).toBe((await raw.project.count()));
  });

  it("内贸的位置对称：设上人就看内贸这边，外贸成员的外贸标签看不到", async () => {
    const 看到 = await 项目名单(内管);
    for (const n of ["内甲内贸", "内甲没填", "内甲暂不分配", "外甲负责内贸标", "无线内贸", "无线没填", "下属负责内贸标", "公海内贸"]) expect(看到).toContain(n);
    for (const n of ["外甲负责外贸标", "外甲负责没填"]) expect(看到).not.toContain(n);
  });
});

describe("只能看", () => {
  it("看得到的项目、客户也改不了", async () => {
    const p = await raw.project.findFirstOrThrow({ where: { name: "外甲负责外贸标" } });
    await expect(作为(线管, () => db.project.update({ where: { id: p.id }, data: { name: "改" } }))).rejects.toThrow(只读角色话);
    await expect(作为(线管, () => db.customer.update({ where: { id: p.customerId }, data: { major: "x" } }))).rejects.toThrow(只读角色话);
    await expect(作为(线管, () => db.followUp.create({ data: { customerId: p.customerId, userId: 线管, content: "x", type: "电话" } as never }))).rejects.toThrow();
    expect((await raw.project.findUniqueOrThrow({ where: { id: p.id } })).name).toBe("外甲负责外贸标");
  });

  it("公海看得到、领不走", async () => {
    const c = await raw.customer.findFirstOrThrow({ where: { name: "客-公海内贸" } });
    登录.user = { ...登录.user, id: 线管, name: 线管, role: "SALES" };
    expect(await 领取([c.id])).toEqual({ ok: false, error: 只读角色话 });
    登录.user = { ...登录.user, id: 全管, name: 全管, role: "SALES" };
    expect(await 领取([c.id])).toEqual({ ok: false, error: 只读角色话 });
    const 后 = await raw.customer.findUniqueOrThrow({ where: { id: c.id }, include: { pool: true } });
    expect(后.salesOwnerId).toBe(内甲);
    expect(后.pool).not.toBeNull();
  });
});

describe("看板和卡点", () => {
  it("选人框有这条线的成员和下属，没有别的线", async () => {
    const { 管理层, 全看, 可选 } = 看板范围of(await 读组织(), null, 线管);
    expect(管理层).toBe(true);
    expect(全看).toBe(false);
    for (const id of [线管, 外下, 外甲, 下内, 虚内]) expect(可选).toContain(id);
    expect(可选).not.toContain(内甲);
    expect(可选).not.toContain(无线);
  });

  it("卡点：不算全部；看板范围不是空条件；看得到外贸成员的，看不到别的", async () => {
    const 发 = async (项目名: string, code: string) => {
      const p = await raw.project.findFirstOrThrow({ where: { name: 项目名 } });
      return raw.entBlocker.create({ data: { code, projectId: p.id, customerId: p.customerId, phase: "商机", type: "中度卡点", impact: "短期不影响", obstacle: "x", description: "x", dueDays: 3, dueAt: new Date(), creatorId: p.ownerId } });
    };
    await 发("外甲负责内贸标", "LV-1");
    await 发("内甲内贸", "LV-2");
    await 发("内甲负责外贸标", "LV-3");
    expect((await 卡点权限(我(线管))).全部).toBe(false);
    expect((await 卡点权限(我(全管))).全部).toBe(true);
    const 范围 = await 卡点看板范围(我(线管));
    expect(范围).not.toEqual({});
    const 数 = (await raw.entBlocker.findMany({ where: 范围 ?? {} })).map((b) => b.code);
    expect(排(数)).toEqual(["LV-1", "LV-3"]);
    expect(排((await 作为(线管, () => db.entBlocker.findMany())).map((b) => b.code))).toEqual(["LV-1", "LV-3"]);
  });
});
