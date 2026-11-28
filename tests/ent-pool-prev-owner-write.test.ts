/**
 * 放进公海时把原负责人存到 poolPrevOwnerId（E-417 包 1，迁移 194）：
 * 手动放回、超时回收、客户连带、离职、导入各一条：进公海后列 = 原负责人；再进一次被覆盖；出公海不清。
 * 写列这一包钉死；E-417 包 2 起回避按这两列读（读的用例在 ent-pool-original-owner-hidden 等），本文件末尾补两条不写放回留痕的入池路（清负责人开关关着、按天掉公海）
 * 和「名单过上限 + 列为空」的读。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  团队: null as null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => mocks.团队 }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围, 回避名单上限 } from "@/lib/enterprise/visibility";
import { 放进公海, 领取 } from "@/app/(app)/customers/pool-actions";
import { 放回公海, 公海超时收回, 领取公海项目 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 离职放进公海 } from "@/lib/offboard-move";
import type { 停用分拣结果 } from "@/lib/offboard-db";
import { 无主项目进公海 } from "@/lib/enterprise-import/project-target";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 记换负责人 } from "@/lib/owner-log-db";
import { saveBusiness, DEFAULT_BUSINESS } from "@/lib/business";
import { 自动掉公海 } from "@/lib/pool-db";
import { 对拍 } from "@/lib/enterprise/pool-prev-owner-compare";
import { defaultClient as raw } from "@/lib/prisma";
import { 改 as 导入改 } from "@/lib/enterprise-import/apply";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 甲: 人;
let 乙: 人;
let 序号 = 0;

const 造人 = async (key: string, name: string, role = "SALES"): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: role === "ADMIN" ? "director" : "sales", ...(role === "ADMIN" ? {} : { line: "内贸" }) } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { ...u };
  忘掉企业版范围();
  return 以谁的身份(u.id, fn);
};
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({
    data: { name: `公海客户${序号}`, phone: "", salesOwnerId: ownerId, contacts: { create: { name: `联系人${序号}`, phone: `139${String(序号).padStart(8, "0")}`, isPrimary: true } } },
  })).id;
};
const 项目 = async (customerId: string, ownerId: string, createdAt?: Date) => {
  序号 += 1;
  return (await prisma.project.create({ data: { name: `项目${序号}`, customerId, ownerId, creatorId: ownerId, phase: "线索", node: "潜客培育", ...(createdAt ? { createdAt } : {}) } })).id;
};
const 项目列 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).poolPrevOwnerId;
const 客户列 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).poolPrevOwnerId;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  公海规则.项目能单独领 = true;
  甲 = await 造人("jia", "销售甲某");
  乙 = await 造人("yi", "销售乙某");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => {
  vi.unstubAllEnvs();
  公海规则.项目能单独领 = false;
  忘掉企业版范围();
});

describe("项目进公海写 poolPrevOwnerId", () => {
  it("手动放回：列 = 原负责人；别人领走再放回，被新的覆盖；没进过公海的列是空", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 没动的 = await 项目(c, 甲.id);
    expect(await 项目列(p)).toBeNull();
    expect(await 以(甲, () => 放回公海(甲, p))).toEqual({ ok: true });
    expect(await 项目列(p)).toBe(甲.id);
    expect(await 项目列(没动的)).toBeNull();

    // 乙领走（出公海不清列），再放回：覆盖成乙
    expect(await 以(乙, () => 领取公海项目(乙, p))).toMatchObject({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).toBeNull();
    expect(await 项目列(p)).toBe(甲.id);
    expect(await 以(乙, () => 放回公海(乙, p))).toEqual({ ok: true });
    expect(await 项目列(p)).toBe(乙.id);
  });

  it("超时回收：列 = 超时那位的原负责人", async () => {
    const 老板 = await 造人("boss", "老板", "ADMIN");
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id, new Date("2026-10-20T10:00:00"));
    expect(await 以(老板, () => 公海超时收回(老板, new Date("2026-10-25T00:02:00")))).toBeGreaterThanOrEqual(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    expect(await 项目列(p)).toBe(甲.id);
  });

  it("客户连带：客户放进公海时他自己负责的项目一起进，项目列和客户列都 = 原负责人；别的客户上别人负责的项目不写", async () => {
    const c = await 客户(甲.id);
    const 他的 = await 项目(c, 甲.id);
    const 别人的 = await 项目(await 客户(乙.id), 乙.id);
    const r = await 以(甲, () => 放进公海([c], "客户主动终止"));
    if (!r.ok) throw new Error(r.error);
    expect(await 客户列(c)).toBe(甲.id);
    expect(await 项目列(他的)).toBe(甲.id);
    expect(await 项目列(别人的)).toBeNull();
  });

  it("离职：进公海的项目和客户列 = 离职的人；一次几位按原负责人分别写", async () => {
    const 操作 = await 造人("op", "总管", "ADMIN");
    const c甲 = await 客户(甲.id);
    const p甲 = await 项目(c甲, 甲.id);
    const c乙 = await 客户(乙.id);
    const p乙 = await 项目(c乙, 乙.id);
    const 客户整体 = await 客户(甲.id);
    const 分 = { 进公海客户: [客户整体], 进公海项目: [p甲, p乙] } as unknown as 停用分拣结果;
    await prisma.$transaction((tx) => 离职放进公海(tx, 分, 操作.id));
    expect(await 项目列(p甲)).toBe(甲.id);
    expect(await 项目列(p乙)).toBe(乙.id);
    expect(await 客户列(客户整体)).toBe(甲.id);
    expect(await 客户列(c甲)).toBeNull();
  });

  it("导入：新建没负责人的项目进公海，列是空（没有原负责人）", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    // 先带一个旧值，模拟早先被放过；无主进公海按「原负责人 = 无」覆盖成空
    await prisma.project.update({ where: { id: p }, data: { poolPrevOwnerId: 乙.id } });
    await prisma.$transaction((tx) => 无主项目进公海(tx, p, 甲.id, new Date().toISOString()));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    expect(await 项目列(p)).toBeNull();
  });

  it("放回人的回避项目过了名单上限（超过名单上限，退回按关联写）：手动放回照样写上列，不被限定层挡成 0 行", async () => {
    const 占位 = await 无负责人占位Id(prisma);
    const 公海客户 = await 客户(占位);
    const 旧们: string[] = [];
    for (let i = 0; i < 回避名单上限 + 1; i++) {
      const id = await 项目(公海客户, 占位);
      旧们.push(id);
    }
    const 时刻 = new Date("2026-11-01T10:00:00Z");
    await prisma.project.updateMany({ where: { id: { in: 旧们 } }, data: { pooledAt: 时刻, ownerId: "" } });
    await prisma.projectNodeLog.createMany({ data: 旧们.map((id) => ({ projectId: id, userId: 甲.id, kind: "pool-release", fromOwnerId: 甲.id, toOwnerId: null, at: 时刻, toPhase: "线索", toNode: "潜客培育" })) });
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    expect(await 以(甲, () => 放回公海(甲, p))).toEqual({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    expect(await 项目列(p)).toBe(甲.id);
  });
});

describe("客户进公海写 poolPrevOwnerId", () => {
  it("手动放进公海 = 原负责人；领走再放，被新的覆盖；领走本身不清", async () => {
    const c = await 客户(甲.id);
    expect(await 客户列(c)).toBeNull();
    await 以(甲, () => 放进公海([c], "客户主动终止"));
    expect(await 客户列(c)).toBe(甲.id);
    const 占位 = (await prisma.user.findUniqueOrThrow({ where: { email: 无负责人占位邮箱 } })).id;
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(占位);

    const r = await 以(乙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(乙.id);
    expect(await 客户列(c)).toBe(甲.id);
    await 以(乙, () => 放进公海([c], "客户主动终止"));
    expect(await 客户列(c)).toBe(乙.id);
  });
  it("放回人的回避客户过了名单上限（超过名单上限，退回按关联写）：经 记换负责人 进公海照样写上列", async () => {
    const 占位 = await 无负责人占位Id(prisma);
    const 时刻 = new Date("2026-11-01T10:00:00Z");
    for (let i = 0; i < 回避名单上限 + 1; i++) {
      const id = await 客户(占位);
      await prisma.customerPool.create({ data: { customerId: id, userId: null, reason: "手动", at: 时刻 } });
      await prisma.customerOwnerLog.create({ data: { customerId: id, userId: 甲.id, fromOwnerId: 甲.id, toOwnerId: 占位, kind: "pool-release", at: 时刻 } });
    }
    const c = await 客户(甲.id);
    // 走 记换负责人（导入 / 离职那条路，外面没包 看全部），对应的 updateMany 要靠 记客户放回人 自己包 看全部
    await 以(甲, () => prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: c }, data: { salesOwnerId: 占位 } });
      await tx.customerPool.create({ data: { customerId: c, userId: null, reason: "手动", at: 时刻 } });
      await 记换负责人(tx, [{ customerId: c, from: 甲.id, to: 占位 }], 甲.id, "pool-release");
    }));
    expect(await 客户列(c)).toBe(甲.id);
  });

  it("导入换负责人到占位账号：本批新建的客户列为空（留痕照留、原负责人能看到）；导入改已有客户照写", async () => {
    const 占位 = await 无负责人占位Id(prisma);
    const 批 = await prisma.entImportBatch.create({ data: { source: "excel", kind: "full", status: "applying" } });
    const 新建的 = await 客户(甲.id);
    const 已有的 = await 客户(甲.id);
    await prisma.entImportRow.create({ data: { batchId: 批.id, entity: "customer", externalId: "x1", targetId: 新建的, kind: "create", written: "{}" } });
    for (const id of [新建的, 已有的]) {
      await prisma.$transaction((tx) => 导入改(tx, "customer", id, { salesOwnerId: 占位 }, { salesOwnerId: 甲.id }, new Date().toISOString(), { 批次Id: 批.id, 补培育: false }));
    }
    expect(await 客户列(新建的)).toBeNull();
    expect(await 客户列(已有的)).toBe(甲.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: 新建的, kind: "pool-release", fromOwnerId: 甲.id } })).toBe(1);
  });
});

describe("不写放回留痕的两条进公海的路：照样写列（E-417 包 2）", () => {
  it("清负责人开关关着：客户进公海负责人留着、不记放回留痕，列 = 原负责人；甲看不到也领不回，乙看得到、领得到", async () => {
    公海规则.进公海清负责人 = false;
    try {
      const c = await 客户(甲.id);
      expect((await 以(甲, () => 放进公海([c], "客户主动终止"))).ok).toBe(true);
      expect(await 客户列(c)).toBe(甲.id);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(甲.id); // 负责人没清
      expect(await prisma.customerOwnerLog.count({ where: { customerId: c, kind: "pool-release" } })).toBe(0); // 没有放回留痕
      expect(await 以(甲, () => prisma.customer.findUnique({ where: { id: c }, select: { id: true } }))).toBeNull();
      expect((await 以(甲, () => 领取([c]))).ok).toBe(false);
      expect(await 以(乙, () => prisma.customer.findUnique({ where: { id: c }, select: { id: true } }))).not.toBeNull();
      expect((await 以(乙, () => 领取([c]))).ok).toBe(true);
    } finally {
      公海规则.进公海清负责人 = true;
    }
  });

  it("按天掉公海：扫进公海的客户列 = 入池前的负责人（负责人留着、没有放回留痕）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", ""); // 企业版业务配置把 poolDays 锁成 0，按天扫只在别的版本里走
    invalidateSettingsCache();
    await saveBusiness({ ...DEFAULT_BUSINESS, poolDays: 30 });
    const 旧 = await 客户(甲.id);
    await prisma.customer.update({ where: { id: 旧 }, data: { lastFollowAt: new Date(Date.now() - 90 * 86_400_000) } });
    const 新 = await 客户(乙.id);
    await prisma.customer.update({ where: { id: 新 }, data: { lastFollowAt: new Date() } });
    expect(await 自动掉公海({ id: 甲.id, name: 甲.name })).toBe(1);
    expect(await prisma.customerPool.count({ where: { customerId: 旧 } })).toBe(1);
    expect(await 客户列(旧)).toBe(甲.id);
    expect(await 客户列(新)).toBeNull();
    expect(await prisma.customerOwnerLog.count({ where: { customerId: 旧, kind: "pool-release" } })).toBe(0);
  });
});

describe("回避名单过上限、公海里有列为空的行：按列写的条件不误挡（空列踩 NULL 的坑）", () => {
  it("甲放回 101 个公海项目 + 101 位公海客户，另有列为空的、乙放的：甲只看不到自己的；对拍（限定层互补）不报", async () => {
    const t = new Date("2026-11-01T10:00:00Z");
    const 公海客户 = async (列: string | null) => {
      const c = await 客户(甲.id);
      await prisma.customerPool.create({ data: { customerId: c, userId: null, reason: "手动", at: t } });
      await raw.customer.update({ where: { id: c }, data: { poolPrevOwnerId: 列 } });
      return c;
    };
    const 公海项目 = async (列: string | null) => {
      const c = await 客户(乙.id);
      const p = await 项目(c, "", t);
      await raw.project.update({ where: { id: p }, data: { pooledAt: t, poolPrevOwnerId: 列 } });
      return p;
    };
    const 甲的客户: string[] = [];
    const 甲的项目: string[] = [];
    for (let i = 0; i < 回避名单上限 + 1; i++) { 甲的客户.push(await 公海客户(甲.id)); 甲的项目.push(await 公海项目(甲.id)); }
    const 空客户 = [await 公海客户(null), await 公海客户(null)];
    const 空项目 = [await 公海项目(null), await 公海项目(null)];
    const 乙客户 = await 公海客户(乙.id);
    const 乙项目 = await 公海项目(乙.id);
    const 看 = await 以(甲, async () => ({
      客户: new Set((await prisma.customer.findMany({ where: { pool: { isNot: null } }, select: { id: true } })).map((r) => r.id)),
      项目: new Set((await prisma.project.findMany({ where: { pooledAt: { not: null } }, select: { id: true } })).map((r) => r.id)),
    }));
    for (const id of 甲的客户) expect(看.客户.has(id)).toBe(false);
    for (const id of 甲的项目) expect(看.项目.has(id)).toBe(false);
    for (const id of [...空客户, 乙客户]) expect(看.客户.has(id)).toBe(true);
    for (const id of [...空项目, 乙项目]) expect(看.项目.has(id)).toBe(true);
    const r = await 对拍(raw, prisma);
    expect(r.互补不成立人数).toBe(0);
  });
});
