/**
 * 企业版上线前全面测试 · 权限 + 可见范围（11-02）：这一份钉的是**找到的漏洞**，现在会红，修好后变绿。
 *
 * 权限口径（用户定）：只认业务角色 bizRole；没设业务角色 = 没权限；admin 只读；负责人能编辑沟通、项目、客户详情；
 * 分配、转让等「改归属」只给管理和总管理；删除、回收站恢复只给总管理（director）；写的人自己 10 分钟内能撤回刚记的。
 *
 * 每条都断言**正确的行为**，并用不带限定的 raw 核对库里没被动过。
 * 用拷出来的一份库、显式单连接、真会话票（同 enterprise-permission-matrix），不碰共用测试库。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-perm-bugs-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 票: undefined as string | undefined };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
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
import { patchCustomer } from "@/app/(app)/customers/actions";
import { restoreContact, 撤销记一笔, type 删掉的联系人 } from "@/app/(app)/customers/[id]/actions";
import { 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 认父记录 } from "@/app/api/attachments/access";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { 只看某人话 } from "@/lib/enterprise/permissions";

/** 人：代称 → 用户 id */
const 人 = {
  老板: "p_boss", // director，账号 SALES（只认业务角色）
  组长: "p_mgr", // sales_mgr，上级 老板
  销售甲: "p_a", // sales，上级 组长
  销售乙: "p_b", // sales，上级 组长
  销售丙: "p_c", // sales，上级 老板（另一组）
  没角色: "p_none", // 账号 ADMIN，没有业务角色 → 没权限
} as const;
type 谁 = keyof typeof 人;

const 客户 = { 甲的: "", 乙的: "", 丙的: "", 公海: "" };

const 签票 = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));
async function 作为<R>(r: 谁, f: () => Promise<R>): Promise<R> {
  临时.票 = await 签票(人[r]);
  忘掉企业版范围();
  try {
    return await f();
  } finally {
    临时.票 = undefined;
  }
}
/** 调一个写操作：抛错（入口拦下、只读错误、FORBIDDEN）都当「被拒」，回的 { ok:false } 也是被拒 */
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
  for (const t of ["AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUpProject", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "Project", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) {
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
      { userId: 人.组长, bizRole: "sales_mgr", managerId: 人.老板 },
      { userId: 人.销售甲, bizRole: "sales", managerId: 人.组长 },
      { userId: 人.销售乙, bizRole: "sales", managerId: 人.组长 },
      { userId: 人.销售丙, bizRole: "sales", managerId: 人.老板 },
    ],
  });
  客户.甲的 = (await raw.customer.create({ data: { name: "甲的客户", phone: "13800220001", salesOwnerId: 人.销售甲 } })).id;
  客户.乙的 = (await raw.customer.create({ data: { name: "乙的客户", phone: "13800220002", salesOwnerId: 人.销售乙 } })).id;
  客户.丙的 = (await raw.customer.create({ data: { name: "丙的客户", phone: "13800220003", salesOwnerId: 人.销售丙 } })).id;
  客户.公海 = (await raw.customer.create({ data: { name: "公海客户", phone: "13800220004", salesOwnerId: 人.老板 } })).id;
  await raw.customerPool.create({ data: { customerId: 客户.公海 } });
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

const 负责人 = async (id: string) => (await raw.customer.findUniqueOrThrow({ where: { id }, select: { salesOwnerId: true } })).salesOwnerId;

describe("【高】patchCustomer 的 salesOwnerId 一格绕过转让挡（customers/actions.ts:1542）", () => {
  it("「按组织看客户」关着（默认）：销售甲在行内把销售丙的客户负责人改成自己 → 应被拒，负责人还是销售丙", async () => {
    await 开规则(false);
    const r = await 试("销售甲", () => patchCustomer(客户.丙的, "salesOwnerId", 人.销售甲));
    expect(await 负责人(客户.丙的), `patchCustomer 回 ${JSON.stringify(r.回)}`).toBe(人.销售丙);
    expect(r.成了).toBe(false);
  });

  it("规则开着：销售甲把公海客户的负责人直接改成自己（绕过「领取」）→ 应被拒", async () => {
    await 开规则(true);
    const r = await 试("销售甲", () => patchCustomer(客户.公海, "salesOwnerId", 人.销售甲));
    expect(await 负责人(客户.公海), `patchCustomer 回 ${JSON.stringify(r.回)}`).toBe(人.老板);
    expect(r.成了).toBe(false);
  });

  it("规则开着：没设业务角色的人（账号是 ADMIN）把公海客户负责人改成自己 → 应被拒", async () => {
    await 开规则(true);
    const r = await 试("没角色", () => patchCustomer(客户.公海, "salesOwnerId", 人.没角色));
    expect(await 负责人(客户.公海), `patchCustomer 回 ${JSON.stringify(r.回)}`).toBe(人.老板);
    expect(r.成了).toBe(false);
  });
});

describe("【高】规则关着时改客户字段不核负责人（patchCustomer / saveCustomer 同一口子）", () => {
  it("销售甲改销售乙客户的 major → 应被拒，库里不变", async () => {
    await 开规则(false);
    const r = await 试("销售甲", () => patchCustomer(客户.乙的, "major", "甲改的"));
    expect((await raw.customer.findUniqueOrThrow({ where: { id: 客户.乙的 } })).major, `patchCustomer 回 ${JSON.stringify(r.回)}`).toBeNull();
    expect(r.成了).toBe(false);
  });

  it("规则开着：没设业务角色的人改公海客户字段 → 应被拒", async () => {
    await 开规则(true);
    const r = await 试("没角色", () => patchCustomer(客户.公海, "major", "没角色改的"));
    expect((await raw.customer.findUniqueOrThrow({ where: { id: 客户.公海 } })).major, `patchCustomer 回 ${JSON.stringify(r.回)}`).toBeNull();
    expect(r.成了).toBe(false);
  });
});

describe("【高】restoreContact 不做任何权限检查（customers/[id]/actions.ts:1022；restoreFollowUp 11-09 已删）", () => {
  it("总管理删进回收站的联系人，销售甲调 restoreContact 恢复 → 应被拒，还在回收站", async () => {
    await 开规则(false);
    const c = await raw.contact.create({ data: { name: "甲客户的联系人", phone: "13900220001", customerId: 客户.甲的, deletedAt: new Date() } });
    const 快照: 删掉的联系人 = { 哪种: "挂着", id: c.id, name: c.name, position: null, phone: c.phone, email: null, wechat: null, remark: null, isPrimary: false, customerId: 客户.甲的, createdAt: c.createdAt.toISOString(), 跟进: [] };
    const r = await 试("销售甲", () => restoreContact(快照));
    expect((await raw.contact.findUniqueOrThrow({ where: { id: c.id } })).deletedAt, `restoreContact 回 ${JSON.stringify(r.回)}`).not.toBeNull();
    expect(r.成了).toBe(false);
  });

  it("销售甲用 restoreContact 在销售乙的客户上凭空建一位联系人 → 应被拒，库里不该多出来", async () => {
    await 开规则(false);
    const 快照: 删掉的联系人 = { 哪种: "挂着", id: "forged-contact-1", name: "凭空的人", position: null, phone: "13900220009", email: null, wechat: null, remark: null, isPrimary: true, customerId: 客户.乙的, createdAt: new Date("2024-01-01T00:00:00Z").toISOString(), 跟进: [] };
    const r = await 试("销售甲", () => restoreContact(快照));
    expect(await raw.contact.findUnique({ where: { id: 快照.id } }), `restoreContact 回 ${JSON.stringify(r.回)}`).toBeNull();
  });
});

describe("【中】撤销记一笔 硬删同一客户下任何人、任何时候的沟通（customers/[id]/actions.ts:572）", () => {
  it("销售甲在自己客户上拿组长两小时前记的沟通 id 调 撤销记一笔 → 应不删", async () => {
    await 开规则(true);
    const 两小时前 = new Date(Date.now() - 2 * 3600_000);
    const f = await raw.followUp.create({ data: { type: "PHONE", title: "", content: "组长记的", occurredAt: 两小时前, createdAt: 两小时前, customerId: 客户.甲的, ownerId: 人.组长 } });
    const 计划 = await raw.followPlan.create({ data: { subject: "回访", plannedAt: new Date(), customerId: 客户.甲的, ownerId: 人.销售甲, done: true, doneAt: new Date() } });
    const r = await 试("销售甲", () => 撤销记一笔({ customerId: 客户.甲的, 跟进id: f.id, 计划id: 计划.id }));
    expect(await raw.followUp.findUnique({ where: { id: f.id } }), `撤销记一笔 回 ${JSON.stringify(r.回)}`).not.toBeNull();
  });
});

describe("【中】撤销公海「放进」不限时（customers/pool-actions.ts:253）", () => {
  it("销售甲两小时前把自己的客户放进公海，现在点撤销 → 应撤不回（原负责人不能领回）", async () => {
    await 开规则(true);
    await raw.customerPool.create({ data: { customerId: 客户.甲的, userId: 人.销售甲, reason: "手动", at: new Date(Date.now() - 2 * 3600_000) } });
    const r = await 试("销售甲", () => 撤销公海("放进", [{ id: 客户.甲的, 值: 人.销售甲 }]));
    expect(await raw.customerPool.findUnique({ where: { customerId: 客户.甲的 } }), `撤销公海 回 ${JSON.stringify(r.回)}`).not.toBeNull();
  });
});

describe("【中】附件 认父记录：联系人 / 线索 / 商机三支不看业务角色、删不要求总管理（api/attachments/access.ts:38-62）", () => {
  it("V3.5.1：销售甲删自己客户联系人上的附件 → 能（负责人本人能软删）；销售乙删甲客户的 → 拒", async () => {
    await 开规则(true);
    const c = await raw.contact.create({ data: { name: "甲客户的联系人", customerId: 客户.甲的 } });
    const r = await 作为("销售甲", () => 认父记录({ contactId: c.id }, "删"));
    expect("错" in r, JSON.stringify(r)).toBe(false);
    const r2 = await 作为("销售乙", () => 认父记录({ contactId: c.id }, "删"));
    expect("错" in r2, JSON.stringify(r2)).toBe(true);
  });

  it("P-删-04（11-23）：删附件和传附件同一口径——能传就能删（项目运营角色的负责人原来传得上、删不掉）；别人的客户照拒", async () => {
    await 开规则(true);
    await raw.entMember.update({ where: { userId: 人.销售丙 }, data: { bizRole: "project_ops" } });
    忘掉企业版范围();
    const c = await raw.contact.create({ data: { name: "丙客户的联系人", customerId: 客户.丙的 } });
    const 传 = await 作为("销售丙", () => 认父记录({ contactId: c.id }, true));
    expect("错" in 传, JSON.stringify(传)).toBe(false);
    const 删 = await 作为("销售丙", () => 认父记录({ contactId: c.id }, "删"));
    expect("错" in 删, JSON.stringify(删)).toBe(false);
    const 别人删 = await 作为("销售乙", () => 认父记录({ contactId: c.id }, "删"));
    expect("错" in 别人删, JSON.stringify(别人删)).toBe(true);
    // 公海客户的联系人附件：照旧只有系统管理员删得了
    const g = await raw.contact.create({ data: { name: "公海客户的联系人", customerId: 客户.公海 } });
    expect("错" in (await 作为("销售甲", () => 认父记录({ contactId: g.id }, "删")))).toBe(true);
  });

  it("P-删-04（11-23 审查）：没挂客户的线索附件按能不能改这条线索判——能改的（负责人、系统管理员、市场管理改没分的和圈里的）能传能删；只读角色、只看某人、虚线上级、同组别人都拒", async () => {
    await 开规则(true);
    // 线索分配开着：市场管理看得到、改得了没分的线索和市场圈里的人负责的（visibility.ts 线索全看 / 线索圈）
    await 存设置(规则.线索分配.key, true);
    for (const [id, bizRole, managerId, dottedManagerId] of [
      ["p_mkt", "marketing_mgr", null, null], ["p_mm", "sales", "p_mkt", null], ["p_ro", "admin", null, null],
      ["p_watch", "marketing_mgr", null, null], ["p_dot", "sales_mgr", null, null], ["p_d", "sales", null, "p_dot"],
    ] as const) {
      await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES", active: true } });
      await raw.entMember.create({ data: { userId: id, bizRole, managerId, dottedManagerId } });
    }
    // 只看某人：p_watch 只看 p_mm
    await 存设置(只看某人键, { p_watch: "p_mm" });
    invalidateSettingsCache();
    忘掉企业版范围();
    const 甲的 = await raw.lead.create({ data: { name: "甲的散线索", ownerId: 人.销售甲 } });
    const 没分的 = await raw.lead.create({ data: { name: "没分的散线索", ownerId: null } });
    const 圈里的 = await raw.lead.create({ data: { name: "市场圈的散线索", ownerId: "p_mm" } });
    const 自己的 = await raw.lead.create({ data: { name: "只看某人自己的散线索", ownerId: "p_watch" } });
    const 下属的 = await raw.lead.create({ data: { name: "虚线下属的散线索", ownerId: "p_d" } });
    const 以 = async <R,>(id: string, f: () => Promise<R>): Promise<R> => {
      临时.票 = await 签票(id);
      忘掉企业版范围();
      try { return await f(); } finally { 临时.票 = undefined; }
    };
    const 错 = (r: object) => "错" in r;
    // 能改这条线索的：传、删都放
    for (const [id, l] of [[人.销售甲, 甲的], [人.老板, 甲的], [人.老板, 没分的], ["p_mkt", 没分的], ["p_mkt", 圈里的], [人.组长, 甲的]] as const) {
      expect(错(await 以(id, () => 认父记录({ leadId: l.id }, true))), `${id} 传 ${l.name}`).toBe(false);
      expect(错(await 以(id, () => 认父记录({ leadId: l.id }, "删"))), `${id} 删 ${l.name}`).toBe(false);
    }
    // 看得到、改不了的：看放，传、删都拒（只读角色看全部；只看某人自己负责的也只能看；虚线上级看得到虚线下属的）
    for (const [id, l] of [["p_ro", 甲的], ["p_ro", 没分的], ["p_watch", 圈里的], ["p_watch", 自己的], ["p_dot", 下属的]] as const) {
      expect(错(await 以(id, () => 认父记录({ leadId: l.id }, false))), `${id} 看 ${l.name}`).toBe(false);
      expect(错(await 以(id, () => 认父记录({ leadId: l.id }, true))), `${id} 传 ${l.name}`).toBe(true);
      expect(错(await 以(id, () => 认父记录({ leadId: l.id }, "删"))), `${id} 删 ${l.name}`).toBe(true);
    }
    // 只看某人自己负责的也拒，给的是只看某人那句（钉住设置生效了，不是碰巧没在范围里）
    expect(await 以("p_watch", () => 认父记录({ leadId: 自己的.id }, true))).toEqual({ 错: 只看某人话, 状态: 403 });
    // 市场管理改不了圈外的人负责的；同组的别人照拒
    for (const [id, l] of [["p_mkt", 甲的], [人.销售乙, 甲的]] as const) {
      expect(错(await 以(id, () => 认父记录({ leadId: l.id }, true))), `${id} 传 ${l.name}`).toBe(true);
      expect(错(await 以(id, () => 认父记录({ leadId: l.id }, "删"))), `${id} 删 ${l.name}`).toBe(true);
    }
  });

  it("没设业务角色的人给公海客户的联系人传附件 → 应被拒", async () => {
    await 开规则(true);
    const c = await raw.contact.create({ data: { name: "公海客户的联系人", customerId: 客户.公海 } });
    const r = await 作为("没角色", () => 认父记录({ contactId: c.id }, true));
    expect("错" in r, JSON.stringify(r)).toBe(true);
  });

  it("规则关着：销售甲删销售乙客户商机上的附件 → 应被拒", async () => {
    await 开规则(false);
    const o = await raw.opportunity.create({ data: { name: "乙的商机", customerId: 客户.乙的, ownerId: 人.销售乙 } });
    const r = await 作为("销售甲", () => 认父记录({ opportunityId: o.id }, "删"));
    expect("错" in r, JSON.stringify(r)).toBe(true);
  });
});
