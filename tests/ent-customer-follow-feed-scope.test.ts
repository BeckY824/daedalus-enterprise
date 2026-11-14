/**
 * 企业版客户页「沟通记录」和「跟进」菜单的可见范围，真库、真组织架构（2026-10-29 P14 第 3、6 条，lib/enterprise/customer-follow-feed.ts）：
 *   - 销售 A 看自己的客户甲：甲本身的老跟进 + A 的项目的跟进 + A 负责、挂着甲的关联项目（主客户是 B 的乙）的跟进；
 *     B 的项目（主客户乙，关联了甲）一条都不出、菜单里也不列；放进公海的 B 的项目（关联了甲）也不出——公海项目谁都看得到，沟通内容不露
 *   - 关联项目的那条记在乙名下：挂的商机是乙的，在甲这里不露
 *   - 老板看全部：B 的项目那条也在、标着 B 的项目
 *   - 新的在前、游标翻页（超过一页 50 条）不重不漏
 *   - 「跟进」菜单（跟进去处们）：主客户的 + 关联进来的；结束的、公海的排后面并标一句
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 ent-project-relate-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-cfeed-scope-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { defaultClient as raw, prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 客户沟通汇总, 跟进去处们, 汇总每页, 汇总的项目 } from "@/lib/enterprise/customer-follow-feed";

const 销售A = "cfeed_a";
const 销售B = "cfeed_b";
const 老板 = "cfeed_boss";
const A = { id: 销售A };
const B = { id: 销售B };
const 老板我 = { id: 老板 };

let 甲: string; // A 的客户
let 乙: string; // B 的客户
let A的项目: string; // 主客户甲
let A的关联项目: string; // A 负责、主客户乙、关联了甲
let B的项目: string; // 主客户乙、关联了甲
let B的公海项目: string; // 主客户乙、关联了甲、放进了项目公海
let 乙的商机: string;

const 时刻 = (分: number) => new Date(Date.UTC(2026, 9, 1, 8, 分));
async function 记(customerId: string, ownerId: string, title: string, 分: number, projectId?: string, opportunityId?: string) {
  const f = await raw.followUp.create({ data: { type: "PHONE", title, content: title, customerId, ownerId, occurredAt: 时刻(分), opportunityId } });
  if (projectId) await raw.followUpProject.create({ data: { followUpId: f.id, projectId, node: "lead" } });
  return f.id;
}
const 标题们 = (rows: { title: string }[]) => rows.map((r) => r.title);

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntFollowUpMeta", "EntBlocker", "FollowUpProject", "ProjectMember", "ProjectContact", "ProjectCustomer", "ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.user.create({ data: { id: 老板, email: `${老板}@x.com`, name: 老板, password: "x", role: "ADMIN" } });
  await raw.entMember.createMany({ data: [{ userId: 销售A }, { userId: 销售B }, { userId: 老板, bizRole: "director" }] });
  甲 = (await raw.customer.create({ data: { name: "QA-A的客户甲", phone: "13800001721", salesOwnerId: 销售A } })).id;
  乙 = (await raw.customer.create({ data: { name: "QA-B的客户乙", phone: "13800001722", salesOwnerId: 销售B } })).id;
  乙的商机 = (await raw.opportunity.create({ data: { name: "QA-乙的商机", customerId: 乙, ownerId: 销售B } })).id;
  A的项目 = (await raw.project.create({ data: { name: "QA-A的项目", customerId: 甲, ownerId: 销售A, creatorId: 销售A } })).id;
  A的关联项目 = (await raw.project.create({ data: { name: "QA-A负责的乙项目", customerId: 乙, ownerId: 销售A, creatorId: 销售B, result: "won" } })).id;
  B的项目 = (await raw.project.create({ data: { name: "QA-B的项目", customerId: 乙, ownerId: 销售B, creatorId: 销售B } })).id;
  B的公海项目 = (await raw.project.create({ data: { name: "QA-B的公海项目", customerId: 乙, ownerId: 销售B, creatorId: 销售B, pooledAt: new Date() } })).id;
  for (const p of [A的关联项目, B的项目, B的公海项目]) await raw.projectCustomer.create({ data: { projectId: p, customerId: 甲, roles: '["监理方"]' } });

  await 记(甲, 销售A, "甲的老跟进", 1);
  await 记(甲, 销售A, "A项目的沟通", 2, A的项目);
  await 记(乙, 销售A, "A关联项目的沟通", 3, A的关联项目, 乙的商机);
  await 记(乙, 销售B, "B项目的沟通", 4, B的项目);
  await 记(乙, 销售B, "B公海项目的沟通", 5, B的公海项目);
  await 记(乙, 销售B, "乙自己的老跟进", 6);
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

describe("企业版客户页沟通记录：只汇总我看得到的项目（真库、真组织架构）", () => {
  it("A 看甲：老跟进 + 自己的项目 + 自己负责的关联项目；B 的项目、公海里的 B 的项目一条不出；新的在前、每条标项目", async () => {
    const r = await 以谁的身份(销售A, () => 客户沟通汇总(A, 甲));
    expect(标题们(r.rows)).toEqual(["A关联项目的沟通", "A项目的沟通", "甲的老跟进"]);
    expect(r.hasMore).toBe(false);
    expect(r.rows.map((x) => x.项目)).toEqual([{ id: A的关联项目, 名: "QA-A负责的乙项目" }, { id: A的项目, 名: "QA-A的项目" }, null]);
    // 别人的东西连名字都不带出来
    expect(JSON.stringify(r)).not.toContain("QA-B的");
    // 关联项目那条记在乙名下、挂着乙的商机：在甲这里不露
    expect(r.rows[0].opportunity).toBeNull();
    expect(await raw.followUp.count({ where: { opportunityId: 乙的商机 } })).toBe(1);
  });

  it("A 的「跟进」菜单：主客户的在前、关联的标出来；结束的排后面；B 的项目（含公海里的）不列", async () => {
    const 去处 = await 以谁的身份(销售A, () => 跟进去处们(A, 甲));
    expect(去处.map((p) => [p.名, p.主, p.结束, p.说明])).toEqual([
      ["QA-A的项目", true, false, null],
      ["QA-A负责的乙项目", false, true, "已结束"],
    ]);
  });

  it("老板看全部：B 的项目那条也在、标着项目；乙自己的老跟进不混进甲", async () => {
    const r = await 以谁的身份(老板, () => 客户沟通汇总(老板我, 甲));
    expect(标题们(r.rows)).toEqual(["B公海项目的沟通", "B项目的沟通", "A关联项目的沟通", "A项目的沟通", "甲的老跟进"]);
    expect(r.rows[1].项目).toEqual({ id: B的项目, 名: "QA-B的项目" });
    const 去处 = await 以谁的身份(老板, () => 跟进去处们(老板我, 甲));
    expect(去处.map((p) => p.名)).toEqual(expect.arrayContaining(["QA-A的项目", "QA-B的项目", "QA-B的公海项目", "QA-A负责的乙项目"]));
    // 进行中的在前，结束、公海的在后
    expect(去处.slice(-2).map((p) => p.说明).sort()).toEqual(["在公海", "已结束"]);
  });

  it("B 看不到 A 的项目：B 的汇总里不出 A 项目的沟通；主客户是乙（B 的客户）、A 负责的项目也不出（11-01 项目不再跟客户走）", async () => {
    // B 打不开甲的客户页（loadCustomerFeed 先按客户限定挡）；这里直接调汇总，看项目这一层也不漏
    const r = await 以谁的身份(销售B, () => 客户沟通汇总(B, 甲));
    expect(标题们(r.rows)).not.toContain("A项目的沟通");
    expect(JSON.stringify(r)).not.toContain("QA-A的项目");
    // 11-01 权限只认业务角色：项目只看负责人范围，主客户是 B 的客户也不放开 A 负责的项目
    expect(标题们(r.rows)).toContain("B项目的沟通");
    expect(标题们(r.rows)).not.toContain("A关联项目的沟通");
  });

  it("超过一页：游标翻页不重不漏，同一时刻的按 id 接着往下", async () => {
    const 多 = 汇总每页 + 7;
    for (let i = 0; i < 多; i++) await 记(甲, 销售A, `批量${String(i).padStart(3, "0")}`, 100 + Math.floor(i / 3), i % 2 ? A的项目 : undefined);
    const 一 = await 以谁的身份(销售A, () => 客户沟通汇总(A, 甲));
    expect(一.rows).toHaveLength(汇总每页);
    expect(一.hasMore).toBe(true);
    const 末 = 一.rows[一.rows.length - 1];
    const 二 = await 以谁的身份(销售A, () => 客户沟通汇总(A, 甲, { occurredAt: 末.occurredAt, id: 末.id }));
    expect(二.hasMore).toBe(false);
    const 全 = [...一.rows, ...二.rows];
    expect(全).toHaveLength(多 + 3);
    expect(new Set(全.map((x) => x.id)).size).toBe(全.length);
    // 新的在前
    const 时间 = 全.map((x) => new Date(x.occurredAt).getTime());
    expect([...时间].sort((a, b) => b - a)).toEqual(时间);
    expect(标题们(全).slice(-3)).toEqual(["A关联项目的沟通", "A项目的沟通", "甲的老跟进"]);
  });
});

describe("删了的项目：沟通照旧留在客户下（11-03 C2-2）", () => {
  it("甲的项目进了回收站：挂在上面的沟通照样在甲的时间线里，不标项目；别的客户删的项目不混进来", async () => {
    const 要删的 = (await raw.project.create({ data: { name: "QA-要删的项目", customerId: 甲, ownerId: 销售A, creatorId: 销售A } })).id;
    await 记(甲, 销售A, "要删项目的沟通", 900, 要删的);
    await raw.project.update({ where: { id: 要删的 }, data: { deletedAt: new Date() } });
    const r = await 以谁的身份(销售A, () => 客户沟通汇总(A, 甲));
    const 那条 = r.rows.find((x) => x.title === "要删项目的沟通");
    expect(那条).toBeTruthy();
    expect(那条!.项目).toBeNull();
    // 乙那边删的项目不会混进甲
    const 乙要删 = (await raw.project.create({ data: { name: "QA-乙要删的项目", customerId: 乙, ownerId: 销售B, creatorId: 销售B } })).id;
    await 记(乙, 销售B, "乙删项目的沟通", 901, 乙要删);
    await raw.project.update({ where: { id: 乙要删 }, data: { deletedAt: new Date() } });
    const 再 = await 以谁的身份(老板, () => 客户沟通汇总(老板我, 甲));
    expect(标题们(再.rows)).not.toContain("乙删项目的沟通");
    expect(标题们(再.rows)).toContain("要删项目的沟通");
  });
});

/**
 * 8.5 万客户提速第三轮（11-14）：时间线按「记在哪位客户名下」拆成几句各取一页再合。
 * 拿原来那一句（三段 OR、一次排序截取）当对照，逐身份逐页比：每页的 id、顺序、hasMore 都一样。
 * 造的数据专挑合并容易错的：两位客户名下的沟通时间交错、同一分钟好几条（按 id 接着排）、比一页多、删了的项目也有
 */
describe("时间线拆句前后一样（第三轮 11-14）", () => {
  async function 原来那句(me: { id: string }, customerId: string, before?: { occurredAt: string; id: string }) {
    const 项目们 = await 汇总的项目(me, customerId);
    const ids = [...项目们.keys()];
    const 删了的 = (await 看全部(() => 看已删(() => prisma.project.findMany({ where: { customerId, deletedAt: { not: null } }, select: { id: true } })))).map((p) => p.id);
    const 范围 = { OR: [
      { customerId, projectNode: null },
      ...(ids.length ? [{ projectNode: { projectId: { in: ids } } }] : []),
      ...(删了的.length ? [{ customerId, projectNode: { projectId: { in: 删了的 } } }] : []),
    ] };
    const rows = await 看全部(() => prisma.followUp.findMany({
      where: { AND: [范围, ...(before ? [{ OR: [{ occurredAt: { lt: new Date(before.occurredAt) } }, { occurredAt: new Date(before.occurredAt), id: { lt: before.id } }] }] : [])] },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 汇总每页 + 1, select: { id: true, occurredAt: true },
    }));
    return { ids: rows.slice(0, 汇总每页).map((r) => r.id), hasMore: rows.length > 汇总每页 };
  }

  it("A、B、老板看甲：每一页都和原来那一句一样", async () => {
    // 乙名下、挂在 A 负责的关联项目上的（A 看得到）和甲名下的交错；同一分钟三四条
    for (let i = 0; i < 40; i++) await 记(乙, 销售A, `交错乙${i}`, 2000 + Math.floor(i / 4), A的关联项目);
    for (let i = 0; i < 40; i++) await 记(甲, 销售A, `交错甲${i}`, 2000 + Math.floor(i / 3), i % 3 ? undefined : A的项目);
    // B 的项目上（只有 B、老板看得到）
    for (let i = 0; i < 12; i++) await 记(乙, 销售B, `交错B${i}`, 2001 + i, B的项目);
    const 删的 = (await raw.project.create({ data: { name: "QA-拆句删的", customerId: 甲, ownerId: 销售A, creatorId: 销售A } })).id;
    for (let i = 0; i < 5; i++) await 记(甲, 销售A, `删的${i}`, 2003, 删的);
    await raw.project.update({ where: { id: 删的 }, data: { deletedAt: new Date() } });
    for (const [谁, 我] of [[销售A, A], [销售B, B], [老板, 老板我]] as const) {
      let before: { occurredAt: string; id: string } | undefined;
      let 页数 = 0;
      for (;;) {
        const 新 = await 以谁的身份(谁, () => 客户沟通汇总(我, 甲, before));
        const 旧 = await 以谁的身份(谁, () => 原来那句(我, 甲, before));
        expect({ 谁, 页数, ids: 新.rows.map((r) => r.id), hasMore: 新.hasMore }).toEqual({ 谁, 页数, ids: 旧.ids, hasMore: 旧.hasMore });
        页数++;
        if (!新.hasMore) break;
        const 末 = 新.rows[新.rows.length - 1];
        before = { occurredAt: 末.occurredAt, id: 末.id };
      }
      expect(页数).toBeGreaterThan(1);
    }
  });
});
