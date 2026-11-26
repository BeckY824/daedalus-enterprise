/**
 * 客户页「看得到的项目」只算一遍（4 核提速 1c 第 5 条，11-16）：原来客户页同时调 客户沟通汇总（连挂过 = true）和 跟进去处们（连挂过 = false），
 * 主客户的项目、关联、项目行、客户可见、回避各查两遍。改成 客户页沟通两样：按 连挂过 = true 算一遍，菜单滤掉只从「挂过」来的。
 * 这里钉两件事：
 *   - 结果逐身份和分开调两次一模一样（销售 A、销售 B、A 的销售管理、总管理），数据里专门有「只挂过」的项目（看得到的、看不到的各一个）；
 *   - 少查的条数：可见走现读时至少少 5 句（项目 id、关联、项目行、客户可见、回避），可见走请求内缓存时（客户页实际用法）至少少 4 句。
 * 用拷出来的一份库、显式单连接（同 ent-customer-follow-feed-scope.test.ts），主连接的 query 事件计数。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-cfeed-once-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 开: false, 句: [] as string[] };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
  (raw as unknown as { $on: (e: string, f: (x: { query: string }) => void) => void }).$on("query", (e) => { if (临时.开) 临时.句.push(e.query); });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { defaultClient as raw } from "@/lib/prisma";
import { 等日志齐 } from "./query-log";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 客户沟通汇总, 跟进去处们, 客户页沟通两样, type 可见法 } from "@/lib/enterprise/customer-follow-feed";
import { 看得到的客户 } from "@/lib/project/db";

const 销售A = "cfo_a";
const 销售B = "cfo_b";
const 经理 = "cfo_mgr";
const 老板 = "cfo_boss";

let 甲: string;
const 时刻 = (分: number) => new Date(Date.UTC(2026, 9, 1, 8, 分));
async function 记(customerId: string, ownerId: string, title: string, 分: number, projectId?: string) {
  const f = await raw.followUp.create({ data: { type: "PHONE", title, content: title, customerId, ownerId, occurredAt: 时刻(分) } });
  if (projectId) await raw.followUpProject.create({ data: { followUpId: f.id, projectId, node: "lead" } });
}

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntFollowUpMeta", "EntBlocker", "FollowUpProject", "ProjectMember", "ProjectContact", "ProjectCustomer", "ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B, 经理, 老板]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [{ userId: 销售A, managerId: 经理 }, { userId: 销售B }, { userId: 经理, bizRole: "sales_mgr" }, { userId: 老板, bizRole: "director" }] });
  甲 = (await raw.customer.create({ data: { name: "QA-甲", phone: "13800001731", salesOwnerId: 销售A } })).id;
  const 乙 = (await raw.customer.create({ data: { name: "QA-乙", phone: "13800001732", salesOwnerId: 销售B } })).id;
  const 项目 = (name: string, customerId: string, ownerId: string, x: object = {}) => raw.project.create({ data: { name, customerId, ownerId, creatorId: ownerId, ...x } }).then((p) => p.id);
  const A的 = await 项目("QA-A的项目", 甲, 销售A);
  const A结束的 = await 项目("QA-A结束的项目", 甲, 销售A, { result: "won" });
  const A关联的 = await 项目("QA-A负责的乙项目", 乙, 销售A);
  const B关联的 = await 项目("QA-B的项目关联甲", 乙, 销售B);
  const B公海的 = await 项目("QA-B的公海项目关联甲", 乙, 销售B, { pooledAt: new Date() });
  // 只挂过：主客户是乙、没关联甲，但有记在甲名下的沟通挂上去（项目主客户改过的老数据）
  const A只挂过 = await 项目("QA-A只挂过的", 乙, 销售A);
  const B只挂过 = await 项目("QA-B只挂过的", 乙, 销售B);
  for (const p of [A关联的, B关联的, B公海的]) await raw.projectCustomer.create({ data: { projectId: p, customerId: 甲, roles: '["监理方"]' } });
  await 记(甲, 销售A, "甲的老跟进", 1);
  await 记(甲, 销售A, "A项目的沟通", 2, A的);
  await 记(甲, 销售A, "A结束项目的沟通", 3, A结束的);
  await 记(乙, 销售A, "A关联项目的沟通", 4, A关联的);
  await 记(乙, 销售B, "B关联项目的沟通", 5, B关联的);
  await 记(乙, 销售B, "B公海项目的沟通", 6, B公海的);
  await 记(甲, 销售A, "甲挂在A只挂过的", 7, A只挂过);
  await 记(甲, 销售B, "甲挂在B只挂过的", 8, B只挂过);
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  忘掉企业版范围();
});

beforeEach(() => {
  process.env.CRM_ENTERPRISE = "1";
  忘掉企业版范围();
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

async function 数<T>(fn: () => Promise<T>): Promise<{ r: T; 句: number }> {
  // query 日志可能比结果晚到（见 tests/query-log.ts）：开开关后先等齐再清空，跑完、关开关前再等齐才数
  临时.句 = [];
  临时.开 = true;
  await 等日志齐(raw, 临时.句);
  临时.句 = [];
  try {
    const r = await fn();
    await 等日志齐(raw, 临时.句);
    return { r, 句: 临时.句.length };
  } finally {
    临时.开 = false;
  }
}

/** 客户页的用法：一次请求内客户可见只查一遍（lib/project/visible-customers.ts 的 页面看得到的客户 用 react cache） */
function 请求内缓存的可见(): 可见法 {
  const 记住 = new Map<string, Promise<Set<string>>>();
  return (ids) => {
    const k = JSON.stringify(ids);
    if (!记住.has(k)) 记住.set(k, 看得到的客户(ids));
    return 记住.get(k)!;
  };
}

describe("客户页沟通两样：看得到的项目只算一遍，结果和分开调两次一样", () => {
  for (const [谁, 角色] of [[销售A, "销售"], [销售B, "别人的销售"], [经理, "A 的销售管理"], [老板, "总管理"]] as const) {
    it(`${角色}看甲：沟通第一页、「跟进」菜单逐项一样；少查项目那一套`, async () => {
      const me = { id: 谁 };
      // 先热一遍（组织、设置缓存这类跨请求的照生产一样是热的）
      await 以谁的身份(谁, () => 客户页沟通两样(me, 甲));
      const 分开 = await 数(() => 以谁的身份(谁, () => Promise.all([客户沟通汇总(me, 甲), 跟进去处们(me, 甲)])));
      const 合起 = await 数(() => 以谁的身份(谁, () => 客户页沟通两样(me, 甲)));
      expect(合起.r).toEqual(分开.r);
      expect(分开.句 - 合起.句, `${角色}：分开 ${分开.句} 句，合起 ${合起.句} 句`).toBeGreaterThanOrEqual(5);

      // 客户页实际用法：可见走请求内缓存，这时少 4 句（项目 id、关联、项目行、回避；客户可见本来就只查一遍）
      const 缓1 = 请求内缓存的可见(), 缓2 = 请求内缓存的可见();
      const 分开缓 = await 数(() => 以谁的身份(谁, () => Promise.all([客户沟通汇总(me, 甲, undefined, 缓1), 跟进去处们(me, 甲, 缓1)])));
      const 合起缓 = await 数(() => 以谁的身份(谁, () => 客户页沟通两样(me, 甲, 缓2)));
      expect(合起缓.r).toEqual(分开缓.r);
      expect(分开缓.句 - 合起缓.句, `${角色}（请求内缓存）：分开 ${分开缓.句} 句，合起 ${合起缓.句} 句`).toBeGreaterThanOrEqual(4);
    });
  }

  it("只挂过的项目：进沟通汇总（标着项目），不进「跟进」菜单；看不到的只挂过项目哪边都不出", async () => {
    const [汇总, 去处] = await 以谁的身份(销售A, () => 客户页沟通两样({ id: 销售A }, 甲));
    expect(汇总.rows.find((r) => r.title === "甲挂在A只挂过的")?.项目?.名).toBe("QA-A只挂过的");
    expect(去处.map((p) => p.名).sort()).toEqual(["QA-A的项目", "QA-A结束的项目", "QA-A负责的乙项目"].sort());
    expect(去处.at(-1)?.名).toBe("QA-A结束的项目");
    expect(JSON.stringify([汇总, 去处])).not.toContain("QA-B只挂过的");
    // 总管理看得到 B 的只挂过项目：汇总里有，菜单里照样没有
    const [汇总2, 去处2] = await 以谁的身份(老板, () => 客户页沟通两样({ id: 老板 }, 甲));
    expect(汇总2.rows.find((r) => r.title === "甲挂在B只挂过的")?.项目?.名).toBe("QA-B只挂过的");
    expect(去处2.map((p) => p.名)).not.toContain("QA-B只挂过的");
    expect(去处2.map((p) => p.名)).not.toContain("QA-A只挂过的");
  });
});
