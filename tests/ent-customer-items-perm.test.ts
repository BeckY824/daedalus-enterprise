/**
 * 企业版客户详情上的待办、下次计划、联系人移出 / 挂回（11-02 权限只认业务角色）：跟着客户负责人走。
 * 负责人（销售）能动；同组别人、上级、总管理只看；没业务角色、管理员拒；改已有的不许挪到别的客户名下。
 * 骨架同 ent-full-perm-bugs（拷出来的一份库、真会话票）。
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
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
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
import { saveTask, toggleTask, deleteTask, savePlan, deletePlan, completePlan, detachContact, undoDetachContact, saveUnassignedContact } from "@/app/(app)/customers/[id]/actions";
import { bulkFollowStatus } from "@/app/(app)/customers/actions";

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

const 明天 = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const 建待办 = (customerId: string, ownerId: string) => raw.task.create({ data: { title: "寄样", customerId, ownerId } });
const 建计划 = (customerId: string, ownerId: string) => raw.followPlan.create({ data: { subject: "回访", plannedAt: new Date(Date.now() + 86400000), method: "电话", customerId, ownerId } });

describe.each([false, true])("待办、计划（按组织看客户 %s）", (规则开) => {
  beforeEach(() => 开规则(规则开));

  it("负责人销售甲：加、改、勾完成、删自己客户的待办都成", async () => {
    expect((await 试("销售甲", () => saveTask({ customerId: 客户.甲的, title: "报价", dueAt: 明天() }))).成了).toBe(true);
    const t = await raw.task.findFirstOrThrow({ where: { customerId: 客户.甲的 } });
    expect((await 试("销售甲", () => saveTask({ id: t.id, customerId: 客户.甲的, title: "报价2" }))).成了).toBe(true);
    expect((await 试("销售甲", () => toggleTask(t.id, true))).成了).toBe(true);
    expect((await 试("销售甲", () => deleteTask(t.id))).成了).toBe(true);
    expect(await raw.task.count({ where: { id: t.id } })).toBe(0);
  });

  it.each(["销售乙", "组长", "老板", "没角色"] as const)("%s 动不了销售甲客户的待办（加、改、勾、删）", async (谁) => {
    const t = await 建待办(客户.甲的, 人.销售甲);
    expect((await 试(谁, () => saveTask({ customerId: 客户.甲的, title: "别人加的" }))).成了).toBe(false);
    expect((await 试(谁, () => saveTask({ id: t.id, customerId: 客户.甲的, title: "别人改的" }))).成了).toBe(false);
    expect((await 试(谁, () => toggleTask(t.id, true))).成了).toBe(false);
    expect((await 试(谁, () => deleteTask(t.id))).成了).toBe(false);
    const 后 = await raw.task.findUniqueOrThrow({ where: { id: t.id } });
    expect([后.title, 后.done]).toEqual(["寄样", false]);
    expect(await raw.task.count({ where: { customerId: 客户.甲的 } })).toBe(1);
  });

  it("销售乙拿自己客户的 customerId 改销售甲的待办（想挪过来）→ 拒，还在甲的客户下", async () => {
    const t = await 建待办(客户.甲的, 人.销售甲);
    expect((await 试("销售乙", () => saveTask({ id: t.id, customerId: 客户.乙的, title: "挪走" }))).成了).toBe(false);
    expect((await raw.task.findUniqueOrThrow({ where: { id: t.id } })).customerId).toBe(客户.甲的);
  });

  it("负责人自己也不能借编辑把待办 / 计划挪到别的客户名下", async () => {
    const t = await 建待办(客户.甲的, 人.销售甲);
    const p = await 建计划(客户.甲的, 人.销售甲);
    await raw.customer.update({ where: { id: 客户.乙的 }, data: { salesOwnerId: 人.销售甲 } });
    expect((await 试("销售甲", () => saveTask({ id: t.id, customerId: 客户.乙的, title: "挪" }))).成了).toBe(false);
    expect((await 试("销售甲", () => savePlan({ id: p.id, customerId: 客户.乙的, subject: "挪", plannedAt: 明天(), method: "电话" }))).成了).toBe(false);
    expect((await raw.task.findUniqueOrThrow({ where: { id: t.id } })).customerId).toBe(客户.甲的);
    expect((await raw.followPlan.findUniqueOrThrow({ where: { id: p.id } })).customerId).toBe(客户.甲的);
  });

  it("负责人销售甲：排、改、完成、删自己客户的计划都成", async () => {
    expect((await 试("销售甲", () => savePlan({ customerId: 客户.甲的, subject: "回访", plannedAt: 明天(), method: "电话" }))).成了).toBe(true);
    const p = await raw.followPlan.findFirstOrThrow({ where: { customerId: 客户.甲的 } });
    expect((await 试("销售甲", () => savePlan({ id: p.id, customerId: 客户.甲的, subject: "回访2", plannedAt: 明天(), method: "电话" }))).成了).toBe(true);
    expect((await 试("销售甲", () => completePlan(p.id))).成了).toBe(true);
    expect((await 试("销售甲", () => deletePlan(p.id))).成了).toBe(true);
  });

  it.each(["销售乙", "组长", "老板", "没角色"] as const)("%s 动不了销售甲客户的计划（排、改、完成、删）", async (谁) => {
    const p = await 建计划(客户.甲的, 人.销售甲);
    expect((await 试(谁, () => savePlan({ customerId: 客户.甲的, subject: "别人排的", plannedAt: 明天(), method: "电话" }))).成了).toBe(false);
    expect((await 试(谁, () => savePlan({ id: p.id, customerId: 客户.甲的, subject: "别人改的", plannedAt: 明天(), method: "电话" }))).成了).toBe(false);
    expect((await 试(谁, () => completePlan(p.id))).成了).toBe(false);
    expect((await 试(谁, () => deletePlan(p.id))).成了).toBe(false);
    const 后 = await raw.followPlan.findUniqueOrThrow({ where: { id: p.id } });
    expect([后.subject, 后.done]).toEqual(["回访", false]);
    expect(await raw.followPlan.count({ where: { customerId: 客户.甲的 } })).toBe(1);
  });

  it("公海里的客户：谁都不能给它加待办、排计划（先领取）", async () => {
    for (const 谁 of ["销售甲", "老板"] as const) {
      expect((await 试(谁, () => saveTask({ customerId: 客户.公海, title: "x" }))).成了).toBe(false);
      expect((await 试(谁, () => savePlan({ customerId: 客户.公海, subject: "x", plannedAt: 明天(), method: "电话" }))).成了).toBe(false);
    }
  });

  it("项目负责人（客户不归他）也能动这位客户的待办", async () => {
    await raw.project.create({ data: { name: "乙的项目", customerId: 客户.甲的, ownerId: 人.销售乙, creatorId: 人.销售乙 } });
    expect((await 试("销售乙", () => saveTask({ customerId: 客户.甲的, title: "项目上的事" }))).成了).toBe(true);
  });
});

describe.each([false, true])("联系人移出 / 挂回（按组织看客户 %s）", (规则开) => {
  beforeEach(() => 开规则(规则开));
  const 建联系人 = () => raw.contact.create({ data: { name: "张工", customerId: 客户.甲的 } });

  it("负责人销售甲：移出、撤销移出都成", async () => {
    const c = await 建联系人();
    expect((await 试("销售甲", () => detachContact(c.id))).成了).toBe(true);
    expect((await 试("销售甲", () => undoDetachContact(c.id, false))).成了).toBe(true);
    expect((await raw.contact.findUniqueOrThrow({ where: { id: c.id } })).customerId).toBe(客户.甲的);
  });

  it.each(["销售乙", "组长", "老板", "没角色"] as const)("%s 不能把销售甲客户的联系人移出", async (谁) => {
    const c = await 建联系人();
    expect((await 试(谁, () => detachContact(c.id))).成了).toBe(false);
    expect((await raw.contact.findUniqueOrThrow({ where: { id: c.id } })).customerId).toBe(客户.甲的);
  });

  it("未归属的人：销售乙不能挂到销售甲的客户下，能挂到自己客户下；没角色的连资料都改不了", async () => {
    const u = await raw.unassignedContact.create({ data: { id: "u_li", name: "李工", ownerId: 人.销售乙 } });
    expect((await 试("销售乙", () => saveUnassignedContact({ id: u.id, name: "李工", customerId: 客户.甲的 }))).成了).toBe(false);
    expect(await raw.unassignedContact.count({ where: { id: u.id } })).toBe(1);
    expect((await 试("没角色", () => saveUnassignedContact({ id: u.id, name: "没角色改的" }))).成了).toBe(false);
    expect((await raw.unassignedContact.findUniqueOrThrow({ where: { id: u.id } })).name).toBe("李工");
    expect((await 试("销售乙", () => saveUnassignedContact({ id: u.id, name: "李工", customerId: 客户.乙的 }))).成了).toBe(true);
  });
});

describe.each([false, true])("列表批量改跟进状态（按组织看客户 %s）", (规则开) => {
  beforeEach(() => 开规则(规则开));
  const 状态 = async (id: string) => (await raw.customer.findUniqueOrThrow({ where: { id } })).followStatus;

  it("负责人改自己的客户成；勾进一位别人的整批不改", async () => {
    expect((await 试("销售甲", () => bulkFollowStatus([客户.甲的], "意向较高"))).成了).toBe(true);
    expect(await 状态(客户.甲的)).toBe("意向较高");
    expect((await 试("销售甲", () => bulkFollowStatus([客户.甲的, 客户.乙的], "已成交"))).成了).toBe(false);
    expect([await 状态(客户.甲的), await 状态(客户.乙的)]).toEqual(["意向较高", "待跟进"]);
  });

  it("组长、老板、没角色改销售甲的客户 → 拒；公海客户谁都不能改", async () => {
    for (const 谁 of ["组长", "老板", "没角色", "销售乙"] as const) {
      expect((await 试(谁, () => bulkFollowStatus([客户.甲的], "意向较高"))).成了).toBe(false);
    }
    expect((await 试("老板", () => bulkFollowStatus([客户.公海], "意向较高"))).成了).toBe(false);
    expect([await 状态(客户.甲的), await 状态(客户.公海)]).toEqual(["待跟进", "待跟进"]);
  });
});
