/**
 * 企业版「组员能记沟通」（11-17 客户答复第 3 问选 A：「组员能记，限本项目的组员，记录上显示是谁记的，项目负责人不变」），
 * 真库、真组织架构范围（visibility.ts + 加上限定），不 mock 只读名单：
 *   组员看这位客户是连带只读（P-看-08，限定层把客户记在「只能看」里，在下面新建沟通会被拦）——
 *   - 项目上记（记项目沟通，客户页选了关联项目、项目详情、首页待办都走它）：已进组的组员记得上，记录人是组员，项目 / 客户负责人不变；
 *     组员记不改项目的下一步文字 / 时间、也不要求填（11-19 客户答复），负责人照旧
 *   - 客户页兜底 / AI 记沟通卡（saveFollowUp）：组员新记一条沟通自动挂到他进组的在推项目上；待办、顺带计划、改已有的照旧只读
 *   - 只是被邀请（没同意，项目和客户都还看不到）、项目已结束：记不上，库里不多一条
 *   - 客户资料照旧改不了
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 ent-contact-link-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-comm-member-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), getCurrentUser: async () => 登录.user, requireUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围, 组员只读话 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { dayjs } from "@/lib/utils";
import { 记项目沟通 } from "@/lib/project/db";
import { 只读客户 } from "@/lib/team-scope";
import { saveFollowUp, type FollowUpInput } from "@/app/(app)/customers/[id]/actions";
import { 沟通项目已结束话 } from "@/lib/project/follow-needs-project";
import { 本人改沟通过时话 } from "@/lib/enterprise/follow-perm";

const 负责人 = "cm_owner";
const 组员 = "cm_member";
let 客户: string;

const 作为 = <T,>(id: string, f: () => Promise<T>) => {
  登录.user = { ...登录.user, id, name: id, email: `${id}@x.com` };
  return 以谁的身份(id, f);
};
const 建项目 = async (补: Record<string, unknown> = {}, 进组: "JOINED" | "INVITED" | null = "JOINED") => {
  const p = await raw.project.create({ data: { name: `项目${Math.random().toString(36).slice(2, 6)}`, customerId: 客户, ownerId: 负责人, creatorId: 负责人, phase: "商机", node: "明确需求", ...补 } });
  if (进组) await raw.projectMember.create({ data: { projectId: p.id, userId: 组员, inviteStatus: 进组 } });
  return p;
};
const 向导 = () => ({ type: "PHONE", content: "组员打了电话", occurredAt: dayjs().subtract(1, "hour").toISOString(), 下一步: "发报价", 阶段: "商机" });
const 记 = (补: Partial<FollowUpInput> = {}) => saveFollowUp({
  customerId: 客户, type: "PHONE", content: "组员微信聊了", status: "已完成", occurredAt: dayjs().subtract(30, "minute").format("YYYY-MM-DD HH:mm"), ...补,
});
const 挂在 = async (followUpId: string) => (await raw.followUpProject.findUnique({ where: { followUpId } }))?.projectId ?? null;

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "FollowUpProject", "ProjectMember", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [负责人, 组员]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [{ userId: 负责人, bizRole: "sales" }, { userId: 组员, bizRole: "sales" }] });
  客户 = (await raw.customer.create({ data: { name: "QA-负责人的客户", phone: "13800003001", salesOwnerId: 负责人 } })).id;
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
});

beforeEach(async () => {
  process.env.CRM_ENTERPRISE = "1";
  for (const t of ["FollowUpProject", "FollowUpSource", "FollowUp", "Task", "FollowPlan", "ProjectNodeLog", "ProjectMember", "Project", "AuditLog"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.customer.update({ where: { id: 客户 }, data: { lastFollowAt: null } });
  忘掉企业版范围();
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("组员在只读客户上记沟通（真范围）", () => {
  it("前提：组员看这位客户是连带只读（P-看-08），客户资料照旧改不了", async () => {
    await 建项目();
    await 作为(组员, async () => {
      expect(await 只读客户(raw as never, { id: 客户, salesOwnerId: 负责人 })).toBe("全");
      await expect(prisma.customer.update({ where: { id: 客户 }, data: { remark: "组员改" } })).rejects.toThrow();
    });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: 客户 } })).remark).toBeNull();
  });

  it("项目上记（记项目沟通）：已进组的组员记得上；记录人是组员，项目、客户负责人不变，客户最近跟进跟着走", async () => {
    const p = await 建项目();
    const r = await 作为(组员, () => 记项目沟通({ id: 组员, role: "SALES" }, p.id, 向导()));
    expect(r).toMatchObject({ ok: true });
    const f = await raw.followUp.findUniqueOrThrow({ where: { id: r.followUpId! } });
    expect(f.ownerId).toBe(组员);
    expect(await 挂在(f.id)).toBe(p.id);
    expect((await raw.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(负责人);
    const c = await raw.customer.findUniqueOrThrow({ where: { id: 客户 } });
    expect(c.salesOwnerId).toBe(负责人);
    expect(c.lastFollowAt?.getTime()).toBe(f.occurredAt.getTime());
  });

  it("组员记不改项目下一步（11-19 客户答复）：交来的下一步不认、不要求必填；负责人照旧写", async () => {
    const 原时间 = dayjs().add(5, "day").startOf("day").toDate();
    const p = await 建项目({ nextStepText: "负责人定的下一步", nextStepAt: 原时间 });
    const 带下一步 = { ...向导(), 下一步: "组员想改的下一步", 下一步时间: dayjs().add(1, "day").format("YYYY-MM-DD") };
    // 带了下一步也不写；要下一步文字（项目详情那条路）对组员也不拦
    expect(await 作为(组员, () => 记项目沟通({ id: 组员, role: "SALES" }, p.id, 带下一步, new Date(), { 要下一步文字: true }))).toMatchObject({ ok: true });
    expect(await 作为(组员, () => 记项目沟通({ id: 组员, role: "SALES" }, p.id, { ...向导(), 下一步: "" }, new Date(), { 要下一步文字: true }))).toMatchObject({ ok: true });
    let 项 = await raw.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(项.nextStepText).toBe("负责人定的下一步");
    expect(项.nextStepAt?.getTime()).toBe(原时间.getTime());
    // 负责人：照旧要写、照旧写到项目上
    expect(await 作为(负责人, () => 记项目沟通({ id: 负责人, role: "SALES" }, p.id, { ...向导(), 下一步: "" }, new Date(), { 要下一步文字: true }))).toMatchObject({ ok: false });
    expect(await 作为(负责人, () => 记项目沟通({ id: 负责人, role: "SALES" }, p.id, { ...带下一步, 下一步: "负责人改的下一步" }, new Date(), { 要下一步文字: true }))).toMatchObject({ ok: true });
    项 = await raw.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(项.nextStepText).toBe("负责人改的下一步");
    expect(dayjs(项.nextStepAt).format("YYYY-MM-DD")).toBe(带下一步.下一步时间);
  });

  it("客户页兜底 / AI 记沟通卡（saveFollowUp）：组员新记一条沟通，自动挂到他进组的在推项目上", async () => {
    const p = await 建项目();
    await 建项目({}, null); // 同一位客户上另一个没进组的项目：不算组员能记的，不用选
    const r = await 作为(组员, () => 记());
    expect(r).toMatchObject({ ok: true });
    const f = await raw.followUp.findUniqueOrThrow({ where: { id: (r as { id: string }).id } });
    expect(f.ownerId).toBe(组员);
    expect(await 挂在(f.id)).toBe(p.id);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(负责人);
  });

  it("组员只能记沟通：待办 / 提醒、顺带下次计划照旧只读，库里不多一条；改自己记的只在 30 分钟内（11-19），过了照旧不行", async () => {
    const p = await 建项目();
    await 作为(组员, async () => {
      expect(await 记({ type: "TASK", dueAt: dayjs().add(1, "day").format("YYYY-MM-DD") })).toEqual({ ok: false, error: 组员只读话 });
      expect(await 记({ 附带: { tasks: [], plan: { subject: "再聊", plannedAt: dayjs().add(2, "day").format("YYYY-MM-DD"), method: "电话" } } })).toEqual({ ok: false, error: 组员只读话 });
    });
    expect(await raw.followUp.count()).toBe(0);
    const 记了 = await 作为(组员, () => 记项目沟通({ id: 组员, role: "SALES" }, p.id, 向导()));
    expect(记了).toMatchObject({ ok: true });
    // 11-19 客户：提交后 30 分钟内能改（记录人本人，ent-followup-edit-30min.test.ts）；过了 30 分钟照旧改不了
    await raw.followUp.update({ where: { id: 记了.followUpId! }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    const 改 = await 作为(组员, () => 记({ id: 记了.followUpId!, content: "组员想改" }));
    expect(改).toEqual({ ok: false, error: 本人改沟通过时话 });
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: 记了.followUpId! } })).content).toBe("组员打了电话");
  });

  it("只是被邀请（没同意）、项目已结束：记不上，库里不多一条", async () => {
    const 邀请中 = await 建项目({}, "INVITED");
    await 作为(组员, async () => {
      // 没同意 = 还看不到这个项目和这位客户：两条路都记不上
      expect(await 记项目沟通({ id: 组员, role: "SALES" }, 邀请中.id, 向导())).toMatchObject({ ok: false });
      expect(await 记({ projectId: 邀请中.id })).toMatchObject({ ok: false });
    });
    await raw.projectMember.deleteMany();
    await raw.project.deleteMany();
    const 结束 = await 建项目({ result: "丢单" });
    忘掉企业版范围();
    await 作为(组员, async () => {
      expect(await 记项目沟通({ id: 组员, role: "SALES" }, 结束.id, 向导())).toEqual({ ok: false, error: 沟通项目已结束话 });
      expect(await 记({ projectId: 结束.id })).toEqual({ ok: false, error: 沟通项目已结束话 });
      // 没有能记的在推项目：组员在这位客户上照旧只能看
      expect(await 记()).toEqual({ ok: false, error: 组员只读话 });
    });
    expect(await raw.followUp.count()).toBe(0);
  });
});
