/**
 * 企业版上线前全面测试 · 权限 + 可见范围（11-02）：这一份是**权限矩阵补缺**，按用户定的口径断言，现在应全绿。
 *
 * 口径：只认业务角色；没设业务角色 = 没权限；admin 只读；负责人能编辑项目；转让 / 分配给管理和总管理，负责人能转出自己名下的；
 * 删除只给总管理（director，含勾了「不管设置」的）；离职交接：能管设置的总管理、规则开着时的直属上级；不管设置的总管理只能交接直属下级。
 * 每格都用不带限定的 raw 核对库里的结果。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-perm-matrix-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 票: undefined as string | undefined };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=4&socket_timeout=20` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({ get: (n: string) => (n === "crm_session" && 临时.票 ? { value: 临时.票 } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// 项目模式开着（企业版现在的用法）
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { SignJWT } from "jose";
import { defaultClient as raw } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { invalidateSettingsCache } from "@/lib/settings";
import { 编辑项目, 删除项目 } from "@/app/(app)/projects/actions";
import { assignSalesOwner, deleteCustomers } from "@/app/(app)/customers/actions";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";
import { deactivateUser } from "@/app/(app)/settings/actions";
import { 可选项 } from "@/lib/enterprise/dict";

const 人 = {
  老板: "m_boss", // director，账号 SALES
  闲总: "m_ns", // director + 不管设置，上级 老板
  组长: "m_mgr", // sales_mgr，上级 闲总
  组长二: "m_mgr2", // sales_mgr，上级 老板（另一组）
  销售甲: "m_a", // sales，上级 组长
  销售乙: "m_b", // sales，上级 组长
  销售丙: "m_c", // sales，上级 组长二
  市场: "m_mkt", // marketing_mgr
  管理员: "m_adm", // admin，只读
  没角色: "m_none", // 账号 ADMIN，没有业务角色
  多角色: "m_multi", // sales,marketing_mgr，上级 组长
} as const;
type 谁 = keyof typeof 人;
const 客户 = { 甲的: "", 乙的: "", 丙的: "" };
const 项目 = { 甲的: "" };

const 签票 = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));
async function 作为<R>(r: 谁, f: () => Promise<R>): Promise<R> {
  临时.票 = await 签票(人[r]);
  忘掉企业版范围();
  try { return await f(); } finally { 临时.票 = undefined; }
}
async function 试<R>(r: 谁, f: () => Promise<R>): Promise<{ 成了: boolean; 回: unknown }> {
  try {
    const 回 = await 作为(r, f);
    const 成了 = !(回 && typeof 回 === "object" && "ok" in 回 && (回 as { ok: unknown }).ok === false) && !(回 && typeof 回 === "object" && "错" in 回);
    return { 成了, 回 };
  } catch (e) {
    return { 成了: false, 回: String((e as { digest?: string })?.digest ?? e) };
  }
}
const 存设置 = (key: string, v: unknown) => raw.setting.upsert({ where: { key }, update: { value: JSON.stringify(v) }, create: { key, value: JSON.stringify(v) } });
async function 开规则(on: boolean) {
  await 存设置(规则.按组织看客户.key, on);
  invalidateSettingsCache();
  忘掉企业版范围();
}

async function 重建() {
  for (const t of ["AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUpProject", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "ProjectMember", "ProjectNodeChange", "Project", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) {
    await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  }
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const [名, id] of Object.entries(人)) {
    await raw.user.create({ data: { id, email: `${id}@x.com`, name: 名, password: "x", role: 名 === "没角色" ? "ADMIN" : "SALES", active: true } });
  }
  await raw.entMember.createMany({
    data: [
      { userId: 人.老板, bizRole: "director" },
      { userId: 人.闲总, bizRole: "director", managerId: 人.老板, noSettings: true },
      { userId: 人.组长, bizRole: "sales_mgr", managerId: 人.闲总 },
      { userId: 人.组长二, bizRole: "sales_mgr", managerId: 人.老板 },
      { userId: 人.销售甲, bizRole: "sales", managerId: 人.组长 },
      { userId: 人.销售乙, bizRole: "sales", managerId: 人.组长 },
      { userId: 人.销售丙, bizRole: "sales", managerId: 人.组长二 },
      { userId: 人.市场, bizRole: "marketing_mgr", managerId: 人.老板 },
      { userId: 人.管理员, bizRole: "admin", managerId: 人.老板 },
      { userId: 人.多角色, bizRole: "sales,marketing_mgr", managerId: 人.组长 },
    ],
  });
  客户.甲的 = (await raw.customer.create({ data: { name: "甲的客户", phone: "13800330001", salesOwnerId: 人.销售甲 } })).id;
  客户.乙的 = (await raw.customer.create({ data: { name: "乙的客户", phone: "13800330002", salesOwnerId: 人.销售乙 } })).id;
  客户.丙的 = (await raw.customer.create({ data: { name: "丙的客户", phone: "13800330003", salesOwnerId: 人.销售丙 } })).id;
  项目.甲的 = (await raw.project.create({ data: { name: "甲的项目", customerId: 客户.甲的, ownerId: 人.销售甲, creatorId: 人.销售甲 } })).id;
  await 存设置(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
}

beforeEach(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  临时.票 = undefined;
  await 重建();
});
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

const 项目名 = async () => (await raw.project.findUnique({ where: { id: 项目.甲的 }, select: { name: true } }))?.name;
const 项目负责人 = async () => (await raw.project.findUnique({ where: { id: 项目.甲的 }, select: { ownerId: true } }))?.ownerId;
const 客户负责人 = async (id: string) => (await raw.customer.findUnique({ where: { id }, select: { salesOwnerId: true } }))?.salesOwnerId;

describe("编辑项目 · 改名称：负责人、系统管理员（规则开、项目模式，V3.5.1）", () => {
  const 表: [谁, boolean][] = [["销售甲", true], ["销售乙", false], ["组长", false], ["老板", true], ["管理员", false], ["没角色", false], ["市场", false]];
  for (const [r, 应] of 表) {
    it(`${r} 改甲的项目名 → ${应 ? "能" : "拒"}`, async () => {
      const x = await 试(r, () => 编辑项目(项目.甲的, { name: `${r}改的` } as never));
      expect(x.成了, JSON.stringify(x.回)).toBe(应);
      expect(await 项目名()).toBe(应 ? `${r}改的` : "甲的项目");
    });
  }
});

describe("编辑项目 · 改负责人（转让）：负责人转自己的、实线上级、总管理", () => {
  const 表: [谁, boolean][] = [["销售甲", true], ["组长", true], ["老板", true], ["闲总", true], ["销售乙", false], ["组长二", false], ["管理员", false], ["没角色", false], ["市场", false]];
  for (const [r, 应] of 表) {
    it(`${r} 把甲的项目转给销售乙 → ${应 ? "能" : "拒"}`, async () => {
      const x = await 试(r, () => 编辑项目(项目.甲的, { name: "甲的项目", ownerId: 人.销售乙 } as never));
      expect(x.成了, JSON.stringify(x.回)).toBe(应);
      expect(await 项目负责人()).toBe(应 ? 人.销售乙 : 人.销售甲);
    });
  }
});

describe("删除项目：总管理（含不管设置的）、负责人本人（V3.5.1 软删）", () => {
  const 表: [谁, boolean][] = [["老板", true], ["闲总", true], ["销售甲", true], ["销售乙", false], ["组长", false], ["管理员", false], ["没角色", false], ["市场", false]];
  for (const [r, 应] of 表) {
    it(`${r} 删甲的项目 → ${应 ? "能" : "拒"}`, async () => {
      const x = await 试(r, () => 删除项目(项目.甲的));
      expect(x.成了, JSON.stringify(x.回)).toBe(应);
      // 企业版删项目 = 进回收站（deletedAt 有值）
      const p = await raw.project.findUnique({ where: { id: 项目.甲的 }, select: { deletedAt: true } });
      if (应) expect(p?.deletedAt).not.toBeNull(); else expect(p?.deletedAt).toBeNull();
    });
  }
});

describe("assignSalesOwner（客户转让 / 分配）", () => {
  // 负责人本人转自己的 = 申请移交（客户 11-09 回执 X4）：发得出，确认前不生效
  const 表: [谁, string, boolean | "申请"][] = [
    ["销售甲", "甲的", "申请"], ["销售甲", "乙的", false], ["组长", "甲的", true], ["老板", "甲的", true], ["组长二", "甲的", false],
    ["管理员", "甲的", false], ["没角色", "甲的", false], ["市场", "甲的", false],
  ];
  for (const [r, 谁的, 应] of 表) {
    it(`${r} 把${谁的}客户转给销售丙 → ${应 === "申请" ? "申请移交" : 应 ? "能" : "拒"}`, async () => {
      const id = 客户[谁的 as keyof typeof 客户];
      const 原 = await 客户负责人(id);
      const x = await 试(r, () => assignSalesOwner([id], 人.销售丙));
      if (应 === "申请") {
        expect(x.回, JSON.stringify(x.回)).toMatchObject({ ok: true, updated: 0, 申请移交: true });
        expect(await 客户负责人(id)).toBe(原);
        return;
      }
      const 真成 = x.成了 && (x.回 as { updated?: number })?.updated !== 0;
      expect(真成, JSON.stringify(x.回)).toBe(应);
      expect(await 客户负责人(id)).toBe(应 ? 人.销售丙 : 原);
    });
  }
});

describe("deleteCustomers：总管理、负责人本人（V3.5.1 软删）", () => {
  const 表: [谁, boolean][] = [["老板", true], ["闲总", true], ["销售甲", true], ["销售乙", false], ["组长", false], ["管理员", false], ["没角色", false], ["市场", false], ["多角色", false]];
  for (const [r, 应] of 表) {
    it(`${r} 删甲的客户 → ${应 ? "能" : "拒"}`, async () => {
      const x = await 试(r, () => deleteCustomers([客户.甲的]));
      expect(x.成了, JSON.stringify(x.回)).toBe(应);
      const 还在 = await raw.customer.findUnique({ where: { id: 客户.甲的 }, select: { id: true } });
      // 删 = 进回收站或真删；被拒时客户行一定还在
      if (!应) expect(还在).not.toBeNull();
    });
  }
});

describe("放进公海：负责人可以，别人和 admin 拒", () => {
  const 表: [谁, boolean][] = [["销售甲", true], ["销售乙", false], ["管理员", false], ["没角色", false], ["市场", false]];
  for (const [r, 应] of 表) {
    it(`${r} 把甲的客户放进公海 → ${应 ? "能" : "拒"}`, async () => {
      const 原因 = (await 可选项("recycle"))[0];
      const x = await 试(r, () => 放进公海([客户.甲的], 原因));
      const 真成 = x.成了 && (x.回 as { updated?: number })?.updated === 1;
      expect(真成, JSON.stringify(x.回)).toBe(应);
      expect(await raw.customerPool.count({ where: { customerId: 客户.甲的 } })).toBe(应 ? 1 : 0);
    });
  }
});

describe("deactivateUser（离职交接）", () => {
  const 表: [string, 谁, 谁, 谁, boolean, boolean][] = [
    // 说明, 谁办, 停谁, 转给谁, 规则开, 应
    ["不管设置的总管理办非直属（隔一层的销售甲）", "闲总", "销售甲", "销售乙", true, false],
    ["不管设置的总管理办直属（组长）", "闲总", "组长", "组长二", true, true],
    ["组长办直属销售甲（规则开）", "组长", "销售甲", "销售乙", true, true],
    // 11-03：谁能办离职 = 手填直属上级 + 系统管理员，不再看「按组织看客户」规则
    ["组长办直属销售甲（规则关）", "组长", "销售甲", "销售乙", false, true],
    ["老板（能管设置）办销售甲", "老板", "销售甲", "销售乙", true, true],
    ["销售乙办同事销售甲", "销售乙", "销售甲", "销售乙", true, false],
    ["admin 办销售甲", "管理员", "销售甲", "销售乙", true, false],
    ["没角色（账号 ADMIN）办销售甲", "没角色", "销售甲", "销售乙", true, false],
  ];
  for (const [说明, r, 停, 给, 规则开, 应] of 表) {
    it(`${说明} → ${应 ? "能" : "拒"}`, async () => {
      if (!规则开) await 开规则(false);
      const x = await 试(r, () => deactivateUser(人[停], 人[给]));
      expect(x.成了, JSON.stringify(x.回)).toBe(应);
      const u = await raw.user.findUnique({ where: { id: 人[停] }, select: { active: true } });
      expect(u?.active).toBe(!应);
    });
  }
});
