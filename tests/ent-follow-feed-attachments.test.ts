/**
 * F-047：客户页「沟通记录」汇总时间线带上沟通附件（截图、录音），真库、真组织架构（lib/enterprise/customer-follow-feed.ts 汇总一页）。
 * 市场成员（渠运、市场管理）建线索时在向导上传的截图挂在第一条沟通上；线索分给销售后，市场成员进客户详情只剩这条汇总时间线。
 * 口径：能看到这条沟通就能看它的截图 / 录音（P-看-05 + api/attachments/access.ts 认沟通「看沟通附件 = 看得到沟通挂的项目」）：
 *   - 渠运看自己建、已分给销售的客户：自己建的项目上那条沟通带附件；销售自己建的项目（渠运看不到）上的沟通、附件都不出
 *   - 市场管理同样：自己建的项目上的带；
 *   - 不挂项目的沟通、看不到的项目上的沟通：附件一律不带（接口本来就不给看）
 *   - 每一位：汇总里给了的附件 = 附件接口（认附件父记录）放行看的那些，一张不多、一张不少；传、删接口照旧挡
 *   - 销售负责人看自己的客户：条目和顺序不变，自己项目上的附件照带；同事的项目上的不出
 *   - 翻页（游标）同一处：第二页的附件照样带
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 ent-customer-follow-feed-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-cfeed-att-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 客户沟通汇总, 客户页沟通两样, 汇总每页 } from "@/lib/enterprise/customer-follow-feed";
import { 认附件父记录 } from "@/app/api/attachments/access";
import type { FollowUpRow } from "@/app/(app)/customers/[id]/types";

const 渠运 = "fatt_qy";
const 市管 = "fatt_sg";
const 销售 = "fatt_xs";
const 同事 = "fatt_xs2";

let 甲: string; // 渠运建、分给销售的客户
let 乙: string; // 市场管理建、分给销售的客户
const 项目: Record<string, string> = {};
const 沟通: Record<string, string> = {};
const 附件们: { id: string; followUpId: string }[] = [];

const 时刻 = (分: number) => new Date(Date.UTC(2026, 10, 20, 2, 分));
async function 记(customerId: string, ownerId: string, title: string, 分: number, projectId?: string, 附件 = 0) {
  const f = await raw.followUp.create({ data: { type: "PHONE", title, content: title, customerId, ownerId, occurredAt: 时刻(分) } });
  if (projectId) await raw.followUpProject.create({ data: { followUpId: f.id, projectId, node: "lead" } });
  for (let i = 0; i < 附件; i++) {
    const a = await raw.attachment.create({ data: { followUpId: f.id, name: `${title}-${i}.png`, mime: "image/png", size: 100 + i, sha256: `${f.id}-${i}`, userId: ownerId } });
    附件们.push({ id: a.id, followUpId: f.id });
  }
  沟通[title] = f.id;
  return f.id;
}
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id, email: `${id}@x.com` }; };
const 看汇总 = (谁: string, 客户: string, before?: { occurredAt: string; id: string }) => { 当(谁); return 以谁的身份(谁, () => 客户沟通汇总({ id: 谁 }, 客户, before)); };
const 附件of = (rows: FollowUpRow[]) => Object.fromEntries(rows.filter((r) => r.附件).map((r) => [r.title, r.附件!.map((a) => a.name)]));
/** 汇总里给了的附件 id = 接口（认沟通）放行看的附件 id（这位客户名下所有沟通的附件里挑） */
async function 和接口一样(谁: string, 客户: string, rows: FollowUpRow[]) {
  const 给了 = new Set(rows.flatMap((r) => (r.附件 ?? []).map((a) => a.id)));
  const 这位的 = new Set((await raw.followUp.findMany({ where: { customerId: 客户 }, select: { id: true } })).map((f) => f.id));
  const 候选 = 附件们.filter((a) => 这位的.has(a.followUpId) || rows.some((r) => r.id === a.followUpId));
  当(谁);
  const 放行 = new Set<string>();
  for (const a of 候选) {
    const r = await 以谁的身份(谁, () => 认附件父记录({ opportunityId: null, leadId: null, contactId: null, projectId: null, followUpId: a.followUpId }, false));
    if (!("错" in r)) 放行.add(a.id);
  }
  expect([...给了].sort()).toEqual([...放行].sort());
  return 放行;
}

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntFollowUpMeta", "EntBlocker", "FollowUpProject", "ProjectMember", "ProjectContact", "ProjectCustomer", "ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [渠运, 市管, 销售, 同事]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  // 市场成员按部门认（market.ts 市场部门们：名字带「市场」的部门），渠运、市场管理都在市场部里（同正式库的摆法）
  const 市场部 = (await raw.entDept.create({ data: { name: "市场部" } })).id;
  await raw.entMember.createMany({ data: [{ userId: 渠运, bizRole: "channel_ops", managerId: 市管, deptId: 市场部 }, { userId: 市管, bizRole: "marketing_mgr", deptId: 市场部 }, { userId: 销售, bizRole: "sales" }, { userId: 同事, bizRole: "sales" }] });

  甲 = (await raw.customer.create({ data: { name: "QA-渠运建的客户", phone: "13800004701", salesOwnerId: 销售, creator: { create: { userId: 渠运 } } } })).id;
  乙 = (await raw.customer.create({ data: { name: "QA-市管建的客户", phone: "13800004702", salesOwnerId: 销售, creator: { create: { userId: 市管 } } } })).id;
  const 建 = async (名: string, customerId: string, ownerId: string, creatorId: string) => (项目[名] = (await raw.project.create({ data: { name: 名, customerId, ownerId, creatorId } })).id);
  await 建("渠运建的项目", 甲, 销售, 渠运);
  await 建("销售自己建的项目", 甲, 销售, 销售);
  await 建("同事的项目", 甲, 同事, 同事);
  await 建("市管建的项目", 乙, 销售, 市管);

  await 记(甲, 渠运, "潜客培育", 1, 项目["渠运建的项目"], 2);
  await 记(甲, 销售, "销售跟进", 2, 项目["渠运建的项目"]);
  await 记(甲, 销售, "销售项目的沟通", 3, 项目["销售自己建的项目"], 1);
  await 记(甲, 同事, "同事项目的沟通", 4, 项目["同事的项目"], 1);
  // 不挂项目的老跟进上挂了附件（老数据）：接口不给看，汇总也不带
  await 记(甲, 销售, "客户本身的老跟进", 5, undefined, 1);
  await 记(乙, 市管, "市管的潜客培育", 1, 项目["市管建的项目"], 1);
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

describe("F-047 客户页沟通记录带沟通附件（真库）", () => {
  it("渠运看自己建、已分给销售的客户：自己建的项目上那条带截图；看不到的项目上的沟通和附件都不出", async () => {
    const r = await 看汇总(渠运, 甲);
    expect(r.rows.map((x) => x.title)).toEqual(["客户本身的老跟进", "销售跟进", "潜客培育"]);
    expect(附件of(r.rows)).toEqual({ 潜客培育: ["潜客培育-0.png", "潜客培育-1.png"] });
    expect(JSON.stringify(r)).not.toContain("销售项目的沟通");
    expect(JSON.stringify(r)).not.toContain("同事项目的沟通");
    // 没附件的那条不带这个字段（不是空数组）
    expect(r.rows.find((x) => x.title === "销售跟进")).not.toHaveProperty("附件");
    const 放行 = await 和接口一样(渠运, 甲, r.rows);
    expect(放行.size).toBe(2);
  });

  it("渠运：给看的附件传、删接口照旧挡（只读）", async () => {
    当(渠运);
    const 传 = await 以谁的身份(渠运, () => 认附件父记录({ opportunityId: null, leadId: null, contactId: null, projectId: null, followUpId: 沟通["潜客培育"] }, true));
    const 删 = await 以谁的身份(渠运, () => 认附件父记录({ opportunityId: null, leadId: null, contactId: null, projectId: null, followUpId: 沟通["潜客培育"] }, "删"));
    expect("错" in 传 && 传.状态).toBe(403);
    expect("错" in 删 && 删.状态).toBe(403);
  });

  it("市场管理看自己建、已分给销售的客户：自己建的项目上那条带截图，和接口一致", async () => {
    const r = await 看汇总(市管, 乙);
    expect(附件of(r.rows)).toEqual({ 市管的潜客培育: ["市管的潜客培育-0.png"] });
    await 和接口一样(市管, 乙, r.rows);
  });

  it("市场管理看下属渠运建的客户：给的附件和接口放行的一样（一张不多）", async () => {
    const r = await 看汇总(市管, 甲);
    await 和接口一样(市管, 甲, r.rows);
    expect(JSON.stringify(r)).not.toContain("同事项目的沟通");
  });

  it("销售负责人看自己的客户：条目、顺序、项目标注不变；自己项目上的附件照带，同事的项目、不挂项目的不带", async () => {
    const r = await 看汇总(销售, 甲);
    expect(r.rows.map((x) => x.title)).toEqual(["客户本身的老跟进", "销售项目的沟通", "销售跟进", "潜客培育"]);
    expect(r.rows.map((x) => x.项目?.名 ?? null)).toEqual([null, "销售自己建的项目", "渠运建的项目", "渠运建的项目"]);
    expect(附件of(r.rows)).toEqual({ 销售项目的沟通: ["销售项目的沟通-0.png"], 潜客培育: ["潜客培育-0.png", "潜客培育-1.png"] });
    await 和接口一样(销售, 甲, r.rows);
    // 客户页首屏（客户页沟通两样）和翻页（客户沟通汇总）是同一处，给的一样
    当(销售);
    const [首屏] = await 以谁的身份(销售, () => 客户页沟通两样({ id: 销售 }, 甲));
    expect(首屏.rows).toEqual(r.rows);
  });

  it("翻页：第二页上的沟通附件照样带", async () => {
    for (let i = 0; i < 汇总每页; i++) await 记(甲, 销售, `新跟进${i}`, 10 + i, 项目["渠运建的项目"]);
    const 一 = await 看汇总(渠运, 甲);
    expect(一.hasMore).toBe(true);
    expect(附件of(一.rows)).toEqual({});
    const 末 = 一.rows[一.rows.length - 1];
    const 二 = await 看汇总(渠运, 甲, { occurredAt: 末.occurredAt, id: 末.id });
    expect(附件of(二.rows)).toEqual({ 潜客培育: ["潜客培育-0.png", "潜客培育-1.png"] });
  });

  it("关联项目带进来、记在别的客户名下的沟通：不带附件（接口 认沟通 要看得到那位客户，带了会是破图）", async () => {
    // 销售负责项目 P，P 的主客户 丙 归同事、销售看不到 丙；甲 是 P 的关联客户。P 上记在 丙 名下、带附件的那条，汇总在 甲 页里出，但不带附件
    const 丙 = (await raw.customer.create({ data: { name: "QA-同事的客户", phone: "13800004703", salesOwnerId: 同事, creator: { create: { userId: 同事 } } } })).id;
    const P = (await raw.project.create({ data: { name: "跨客户项目", customerId: 丙, ownerId: 销售, creatorId: 销售 } })).id;
    await raw.projectCustomer.create({ data: { projectId: P, customerId: 甲 } });
    忘掉企业版范围();
    await 记(丙, 销售, "记在别的客户名下", 200, P, 1);
    const r = await 看汇总(销售, 甲);
    const 行 = r.rows.find((x) => x.title === "记在别的客户名下");
    expect(行, "这条沟通照旧出现在汇总里").toBeTruthy();
    expect(行).not.toHaveProperty("附件");
    // 前提成立：接口那边这条沟通的附件销售确实看不了（不带才对）
    当(销售);
    const 看 = await 以谁的身份(销售, () => 认附件父记录({ opportunityId: null, leadId: null, contactId: null, projectId: null, followUpId: 沟通["记在别的客户名下"] }, false));
    expect("错" in 看).toBe(true);
  });
});
