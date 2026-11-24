/**
 * 只读身份的写操作都拦（P-看-19 只放开看，用户 11-24；审查 11-25）：
 *   - 设了「只看某人」的人进了组的项目，列表、详情能看（P-看-19），可组员能做的写操作一律拒：
 *     记沟通（项目详情、客户页兜底、选项目）、本人 30 分钟内改沟通、发 / 认领 / 完成卡点、拉人进组、传项目附件、改项目字段；
 *     项目详情、客户页的「记沟通」「加组员」入口不出
 *   - 普通组员照常能记沟通（11-17 客户定）
 *   - 条线总管理看本线建的、负责人在线外的客户（P-看-18 只读）：记沟通、建项目、传附件、转交、放公海都拒，库里不变
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 ent-comm-member-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-readonly-writes-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), getCurrentUser: async () => 登录.user, requireUser: async () => 登录.user }));
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

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { 读组织 } from "@/lib/enterprise/org";
import { 只看某人话 } from "@/lib/enterprise/permissions";
import { dayjs } from "@/lib/utils";
import { 记项目沟通, 加组员, 改项目, 能加组员 } from "@/lib/project/db";
import { 能往项目记沟通, 可记沟通项目们, 核沟通项目 } from "@/lib/project/follow-needs-project";
import { 卡点权限, 认领卡点, 发卡点预检, 能写卡点 } from "@/lib/project/blocker";
import { 本人限时改挡 } from "@/lib/enterprise/follow-perm";
import { saveFollowUp, type FollowUpInput } from "@/app/(app)/customers/[id]/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";
import { 认附件父记录 } from "@/app/api/attachments/access";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 跟进去处们 } from "@/lib/enterprise/customer-follow-feed";

const 负责人 = "ro_owner", 组员 = "ro_member", 盯的人 = "ro_watcher", 被盯 = "ro_watched";
const 线总 = "ro_linedir", 线内 = "ro_lineman", 同事 = "ro_peer";
const 我 = (id: string) => ({ id, role: "SALES" });
let 客户A: string, 项目P: string, 客户B: string, 项目Q: string;

const 作为 = <T,>(id: string, f: () => Promise<T>) => {
  登录.user = { ...登录.user, id, name: id, email: `${id}@x.com` };
  return 以谁的身份(id, f);
};
const 向导 = () => ({ type: "PHONE", content: "打了电话", occurredAt: dayjs().subtract(1, "hour").toISOString(), 下一步: "发报价", 阶段: "商机" });
const 记 = (customerId: string, 补: Partial<FollowUpInput> = {}) => saveFollowUp({
  customerId, type: "PHONE", content: "微信聊了", status: "已完成", occurredAt: dayjs().subtract(30, "minute").format("YYYY-MM-DD HH:mm"), ...补,
});
const 项目附件 = (projectId: string) => 认附件父记录({ opportunityId: null, leadId: null, contactId: null, projectId, followUpId: null }, true);

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "FollowUpProject", "ProjectMember", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [负责人, 组员, 盯的人, 被盯, 线总, 线内, 同事]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [
    { userId: 负责人, bizRole: "sales" }, { userId: 组员, bizRole: "sales,project_ops" }, { userId: 盯的人, bizRole: "sales,project_ops" },
    { userId: 被盯, bizRole: "sales" }, { userId: 线总, bizRole: "director", line: "外贸" }, { userId: 线内, bizRole: "sales", line: "外贸" }, { userId: 同事, bizRole: "sales" },
  ] });
  for (const [key, value] of [[规则.按组织看客户.key, "true"], [只看某人键, JSON.stringify({ [盯的人]: 被盯 })]]) await raw.setting.create({ data: { key, value } });
});

beforeEach(async () => {
  process.env.CRM_ENTERPRISE = "1";
  for (const t of ["Attachment", "FollowUpProject", "FollowUpSource", "FollowUp", "Task", "FollowPlan", "ProjectNodeLog", "ProjectMember", "Project", "CustomerPool", "AuditLog", "Customer"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  // A：负责人的客户和项目；组员、只看某人都点了同意进组
  客户A = (await raw.customer.create({ data: { name: "QA-甲", phone: "13800004001", salesOwnerId: 负责人, creator: { create: { userId: 负责人 } } } })).id;
  项目P = (await raw.project.create({ data: { name: "甲项目", customerId: 客户A, ownerId: 负责人, creatorId: 负责人, phase: "商机", node: "明确需求" } })).id;
  await raw.projectMember.createMany({ data: [{ projectId: 项目P, userId: 组员, inviteStatus: "JOINED" }, { projectId: 项目P, userId: 盯的人, inviteStatus: "JOINED" }] });
  // B：本线成员建的、负责人是线外同事（P-看-18：条线总管理看得到、只读）
  客户B = (await raw.customer.create({ data: { name: "QA-乙", phone: "13800004002", salesOwnerId: 同事, creator: { create: { userId: 线内 } } } })).id;
  项目Q = (await raw.project.create({ data: { name: "乙项目", customerId: 客户B, ownerId: 同事, creatorId: 线内, phase: "商机", node: "明确需求" } })).id;
  忘掉企业版范围();
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("只看某人进组的项目：能看，写一律拒（P-看-19）", () => {
  it("前提：项目和客户都看得到（P-看-19 放开看）", async () => {
    await 作为(盯的人, async () => {
      expect(await prisma.project.findUnique({ where: { id: 项目P }, select: { id: true } })).not.toBeNull();
      expect(await prisma.customer.findUnique({ where: { id: 客户A }, select: { id: true } })).not.toBeNull();
    });
  });

  it("记沟通：项目详情、客户页兜底、客户页选了项目都拒，库里不多一条", async () => {
    const org = await 读组织();
    expect(能往项目记沟通(我(盯的人), { ownerId: 负责人, pooledAt: null }, org, "JOINED")).toBe(false);
    await 作为(盯的人, async () => {
      expect(await 记项目沟通(我(盯的人), 项目P, 向导())).toEqual({ ok: false, error: 只看某人话 });
      expect((await 可记沟通项目们(我(盯的人), 客户A)).可记).toEqual([]);
      expect(await 核沟通项目(我(盯的人), 客户A, 项目P)).toBe(只看某人话);
      expect(await 记(客户A)).toMatchObject({ ok: false });
      expect(await 记(客户A, { projectId: 项目P })).toMatchObject({ ok: false });
    });
    expect(await raw.followUp.count()).toBe(0);
  });

  it("本人 30 分钟内改沟通：拒（哪怕这条是他设只看某人之前记的），内容不变", async () => {
    const f = await raw.followUp.create({ data: { customerId: 客户A, type: "PHONE", title: "电话", content: "原话", ownerId: 盯的人 } });
    await raw.followUpProject.create({ data: { followUpId: f.id, projectId: 项目P, node: "明确需求" } });
    await 作为(盯的人, async () => {
      expect(await 本人限时改挡(我(盯的人), { ...f, customerId: 客户A })).toBe(只看某人话);
      expect(await 记(客户A, { id: f.id, content: "改了" })).toMatchObject({ ok: false });
    });
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).content).toBe("原话");
  });

  it("卡点：发、认领都拒，说只看某人那句；能写 = false（认领 / 完成按钮跟着不出）", async () => {
    expect((await 卡点权限(我(盯的人))).能写).toBe(false);
    expect(await 能写卡点(盯的人)).toBe(false);
    expect(await 发卡点预检(我(盯的人), 项目P, [])).toBe(只看某人话);
    expect(await 认领卡点(我(盯的人), "不存在也先拦")).toEqual({ ok: false, error: 只看某人话 });
    // 普通组员照旧能写
    expect((await 卡点权限(我(组员))).能写).toBe(true);
  });

  it("拉人进组、改项目字段、传项目附件都拒，库里不变", async () => {
    const org = await 读组织();
    expect(能加组员(我(盯的人), { ownerId: 负责人, pooledAt: null }, org, true)).toBe(false);
    await 作为(盯的人, async () => {
      expect(await 加组员(我(盯的人), 项目P, 被盯)).toMatchObject({ ok: false });
      expect(await 改项目(我(盯的人), 项目P, { name: "改名" } as never)).toMatchObject({ ok: false });
      expect(await 项目附件(项目P)).toHaveProperty("错");
    });
    expect(await raw.projectMember.count({ where: { projectId: 项目P, userId: 被盯 } })).toBe(0);
    expect((await raw.project.findUniqueOrThrow({ where: { id: 项目P } })).name).toBe("甲项目");
    // 普通 project_ops 组员照旧能拉人（V3.5.1）
    expect(能加组员(我(组员), { ownerId: 负责人, pooledAt: null }, org, true)).toBe(true);
  });

  it("界面：项目详情不出「记沟通」「加组员」，客户页项目去处 能记 = false；普通组员照出", async () => {
    const 详情 = async (id: string) => {
      const r = await 作为(id, () => 读项目详情({ ...登录.user, id }, 项目P));
      if (r.种 !== "有") throw new Error(`进不了详情：${r.种}`);
      return r.props.p as unknown as { 能记沟通: boolean; 能加组员: boolean };
    };
    expect(await 详情(盯的人)).toMatchObject({ 能记沟通: false, 能加组员: false });
    expect(await 详情(组员)).toMatchObject({ 能记沟通: true, 能加组员: true });
    const 去处 = async (id: string) => (await 作为(id, () => 跟进去处们(我(id), 客户A))).find((p) => p.id === 项目P);
    expect((await 去处(盯的人))?.能记).toBe(false);
    expect((await 去处(组员))?.能记).toBe(true);
  });
});

describe("普通组员照常能记沟通（11-17 回归）", () => {
  it("项目详情记、客户页兜底记都记得上，记录人是组员", async () => {
    const r = await 作为(组员, () => 记项目沟通(我(组员), 项目P, 向导()));
    expect(r).toMatchObject({ ok: true });
    const s = await 作为(组员, () => 记(客户A));
    expect(s).toMatchObject({ ok: true });
    expect(await raw.followUp.count({ where: { ownerId: 组员 } })).toBe(2);
  });
});

describe("条线总管理在 P-看-18 只读客户下：写一律拒（审查建议 4）", () => {
  it("前提：客户和项目看得到", async () => {
    await 作为(线总, async () => {
      expect(await prisma.customer.findUnique({ where: { id: 客户B }, select: { id: true } })).not.toBeNull();
      expect(await prisma.project.findUnique({ where: { id: 项目Q }, select: { id: true } })).not.toBeNull();
    });
  });

  it("记沟通、建项目、传附件、转交、放公海都拒，库里不变", async () => {
    await 作为(线总, async () => {
      expect(await 记项目沟通(我(线总), 项目Q, 向导())).toMatchObject({ ok: false });
      expect(await 记(客户B)).toMatchObject({ ok: false });
      expect(await 记(客户B, { projectId: 项目Q })).toMatchObject({ ok: false });
      expect(await 给客户建项目({ customerId: 客户B, 项目: { name: "线总建的", ownerId: 线总 }, 跟进: 向导() } as never)).toMatchObject({ ok: false });
      expect(await 项目附件(项目Q)).toHaveProperty("错");
      expect(await assignSalesOwner([客户B], 线内)).toMatchObject({ ok: false });
      const 放 = await 放进公海([客户B]);
      expect(放.ok === false || 放.updated === 0).toBe(true);
    });
    expect(await raw.followUp.count()).toBe(0);
    expect(await raw.project.count({ where: { customerId: 客户B } })).toBe(1);
    expect(await raw.customerPool.count()).toBe(0);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: 客户B } })).salesOwnerId).toBe(同事);
  });
});
