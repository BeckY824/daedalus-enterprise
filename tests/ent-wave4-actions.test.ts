/**
 * 11-18 审核第四波（连库）：前三波没排进的发现，直接调服务端动作 / 库函数复现，修前红、修后绿。
 *   - 权限 P1-4：saveFollowUp 顺手建待办 / 提醒过 客户事项挡（销管不能在下属客户上建）
 *   - 权限 P1-5：按客户直接读跟进的老接口（loadFollowHistory、readFollowHistoryRow、取客户近况）不出看不到的项目上的沟通
 *   - 权限 P2-5：撤销导入批次复查 能导入导出
 *   - 权限 P2-6：确认转让类交接也复查接手人能不能接
 *   - 权限 P2-7：saveFollowUp 挂的联系人要是这位客户的；deleteFollowUp 按库里那条的客户重算
 *   - 权限 P2-8：AI 卡撤销「记跟进」只认 AI 卡建的那条
 *   - 权限 P2-9：设了只看某人的上级不能处理离职交接
 *   - 新建入口 P2-8：彻底删除后清掉没外键的孤儿行（有效沟通标记、撞号查询记录）
 *   - 统计 P2-1：数据页「将回公海」按负责人的线算天数（同首页卡）
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const 当前 = vi.hoisted(() => ({ me: { id: "", name: "", email: "x", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => 当前.me, getCurrentUser: async () => 当前.me }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { saveFollowUp, deleteFollowUp } from "@/app/(app)/customers/[id]/actions";
import { loadFollowHistory, readFollowHistoryRow } from "@/app/(app)/customers/[id]/follow-history-actions";
import { 取客户近况 } from "@/app/(app)/customers/[id]/pick";
import { 撤销批次 } from "@/app/(app)/customers/import-actions";
import { 确认交接 } from "@/app/(app)/customers/handover-actions";
import { undoProposal } from "@/app/(app)/dashboard/apply";
import { 能交接 } from "@/lib/enterprise/offboard-handover";
import { 不能导入导出 } from "@/lib/enterprise/import-perm";
import { 不能改客户事项话 } from "@/lib/enterprise/follow-perm";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { 彻底删除 } from "@/lib/enterprise/soft-delete";
import { 将回公海of } from "@/lib/project/review-extras-db";
import { 存组织规则 } from "@/lib/project/org-rules-store";
import { 默认组织规则 } from "@/lib/project/org-rules";

let 系管 = "", 经理 = "", 下属 = "", 销售 = "";
let 序 = 0;
const 人 = async (name: string, bizRole: string, managerId: string | null = null, line: string | null = null) => {
  const u = await prisma.user.create({ data: { email: `${name}${++序}@x`, name, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId, line } });
  return u.id;
};
const 当 = (id: string) => { 当前.me = { ...当前.me, id, name: id }; };
const 客户 = async (salesOwnerId: string, 补: Record<string, unknown> = {}) =>
  (await prisma.customer.create({ data: { name: `示例客户${++序}`, phone: "", salesOwnerId, ...补 } })).id;
const 提醒 = (customerId: string, 补: Record<string, unknown> = {}) => saveFollowUp({
  customerId, type: "REMIND", content: "回个电话", status: "待处理", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"),
  dueAt: dayjs().add(2, "day").format("YYYY-MM-DD"), ...补,
} as never);

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  系管 = await 人("系管", "director");
  经理 = await 人("经理", "sales_mgr");
  下属 = await 人("下属", "sales", 经理);
  销售 = await 人("销售", "sales");
});
afterEach(() => void vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("权限 P1-4 / P2-7 saveFollowUp", () => {
  it("销管在下属客户上记带时间的提醒、顺手建待办：拒，一条不存；负责人本人照常", async () => {
    const c = await 客户(下属);
    当(经理);
    expect(await 提醒(c)).toEqual({ ok: false, error: 不能改客户事项话 });
    expect(await 提醒(c, { type: "REMIND", dueAt: null, status: "已完成", 附带: { tasks: [{ title: "发报价" }] } })).toEqual({ ok: false, error: 不能改客户事项话 });
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
    当(下属);
    expect(await 提醒(c)).toMatchObject({ ok: true });
  });

  it("挂别的客户的联系人：拒；挂自己客户的联系人照常", async () => {
    const c = await 客户(下属), 别家 = await 客户(销售);
    const 别人的 = await prisma.contact.create({ data: { customerId: 别家, name: "别家联系人" } });
    const 自己的 = await prisma.contact.create({ data: { customerId: c, name: "自己联系人" } });
    当(下属);
    expect(await 提醒(c, { contactId: 别人的.id })).toMatchObject({ ok: false });
    expect(await 提醒(c, { contactId: 自己的.id })).toMatchObject({ ok: true });
  });

  it("deleteFollowUp 传错客户 id：按库里那条的客户重算最近跟进，传来的那位不动", async () => {
    const c = await 客户(下属), 别家 = await 客户(销售, { lastFollowAt: new Date("2026-11-01T02:00:00Z") });
    const f = await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "打过", occurredAt: new Date(), customerId: c, ownerId: 下属 } });
    当(系管);
    expect(await deleteFollowUp(f.id, 别家)).toMatchObject({ ok: true });
    expect((await prisma.customer.findUnique({ where: { id: 别家 } }))?.lastFollowAt?.toISOString()).toBe("2026-11-01T02:00:00.000Z");
  });
});

describe("权限 P1-5 老读接口按项目可见滤（P-看-12）", () => {
  it("客户负责人读不到同一客户下同事负责的项目上的沟通；自己项目上的、不挂项目的照出", async () => {
    await setSetting("business", { projectMode: true });
    const { 规则 } = await import("@/lib/enterprise/rules");
    await prisma.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
    invalidateSettingsCache();
    const { 以谁的身份, 忘掉企业版范围 } = await import("@/lib/enterprise/visibility");
    忘掉企业版范围();
    const c = await 客户(下属);
    const 同事项目 = await prisma.project.create({ data: { name: "同事项目", customerId: c, ownerId: 销售, creatorId: 销售, phase: "商机", node: "明确需求" } });
    const 我项目 = await prisma.project.create({ data: { name: "我的项目", customerId: c, ownerId: 下属, creatorId: 下属, phase: "商机", node: "明确需求" } });
    const 记 = async (content: string, ownerId: string, projectId: string | null, 早 = 0) => {
      const f = await prisma.followUp.create({ data: { type: "PHONE", title: "", content, occurredAt: new Date(Date.now() - 早), customerId: c, ownerId } });
      if (projectId) await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: "明确需求" } });
      return f.id;
    };
    const 别人那条 = await 记("同事项目上的", 销售, 同事项目.id);
    await 记("我项目上的", 下属, 我项目.id, 60_000);
    await 记("客户本身的", 下属, null, 120_000);
    当(下属);
    // 没有请求上下文时限定层不限定：按这个人的身份跑（同 MCP 入口），项目可见范围才生效
    const r = await 以谁的身份(下属, () => loadFollowHistory(c));
    expect(r.ok && r.rows.map((x) => x.content).sort()).toEqual(["客户本身的", "我项目上的"]);
    const 一条 = await 以谁的身份(下属, () => readFollowHistoryRow(c, 别人那条));
    expect(一条.ok && 一条.row).toBeNull();
    expect((await 以谁的身份(下属, () => 取客户近况(c)))?.上次跟进?.content).toBe("我项目上的");
    // 对照：系统管理员看全部，读得到同事项目上的那条
    当(系管);
    const 他 = await 以谁的身份(系管, () => loadFollowHistory(c));
    expect(他.ok && 他.rows.map((x) => x.content)).toContain("同事项目上的");
  });
});

describe("权限 P2-5 撤销导入批次", () => {
  it("不是系统管理员：拒（自己当年导的那批也不行）", async () => {
    const b = await prisma.importBatch.create({ data: { userId: 销售, userName: "销售", fileName: "a.xlsx" } });
    当(销售);
    expect(await 撤销批次(b.id)).toEqual({ ok: false, error: 不能导入导出 });
  });
});

describe("权限 P2-6 确认转让类交接复查接手人", () => {
  it("发起后接手人被改成只读角色：确认不了，交接还在待确认", async () => {
    const c = await 客户(销售);
    const h = await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 销售, toUserId: 下属, byUserId: 销售, status: "待确认", customerIds: JSON.stringify([c]) } });
    await prisma.entMember.update({ where: { userId: 下属 }, data: { bizRole: "admin" } });
    当(下属);
    const r = await 确认交接(h.id);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/接不了/);
    expect((await prisma.entHandover.findUnique({ where: { id: h.id } }))?.status).toBe("待确认");
    expect((await prisma.customer.findUnique({ where: { id: c } }))?.salesOwnerId).toBe(销售);
  });
});

describe("权限 P2-8 AI 卡撤销记跟进", () => {
  it("凭据里换成自己手记的那条（10 分钟内）：拒，不删；AI 卡记的那条（留痕里有）照撤", async () => {
    const c = await 客户(下属);
    const 手记 = await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "手记的", occurredAt: new Date(), customerId: c, ownerId: 下属 } });
    当(下属);
    expect(await undoProposal({ kind: "add_followup", customerId: c, id: 手记.id })).toMatchObject({ ok: false });
    expect((await prisma.followUp.findUnique({ where: { id: 手记.id } }))?.deletedAt).toBeNull();
    const 卡记 = await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "卡记的", occurredAt: new Date(), customerId: c, ownerId: 下属 } });
    await prisma.auditLog.create({ data: { userId: 下属, userName: "下属", action: "ai_apply", entity: "Ai", entityId: "add_followup", summary: "确认 AI 建议", detail: JSON.stringify({ 跟进: 卡记.id }) } });
    expect(await undoProposal({ kind: "add_followup", customerId: c, id: 卡记.id })).toMatchObject({ ok: true });
  });
});

describe("权限 P2-9 离职交接发起人", () => {
  it("手填直属上级设了「只看某人」：不能处理；对照：不设照常", async () => {
    const 走的 = await 人("走的", "sales", 经理);
    await prisma.user.update({ where: { id: 走的 }, data: { active: false } });
    当(经理);
    expect(await 能交接(当前.me, 走的)).toBe(true);
    await setSetting(只看某人键, JSON.stringify({ [经理]: 销售 }));
    invalidateSettingsCache();
    const { 忘掉企业版范围 } = await import("@/lib/enterprise/visibility");
    忘掉企业版范围();
    expect(await 能交接(当前.me, 走的)).toBe(false);
  });
});

describe("新建入口 P2-8 彻底删除清孤儿行", () => {
  it("客户彻底删除后，撞号查询记录、沟通标记跟着清；别的客户的照留", async () => {
    const c = await 客户(销售, { deletedAt: new Date() }), 留 = await 客户(销售);
    const f = await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "x", occurredAt: new Date(), customerId: c, ownerId: 销售 } });
    const g = await prisma.followUp.create({ data: { type: "PHONE", title: "", content: "y", occurredAt: new Date(), customerId: 留, ownerId: 销售 } });
    await prisma.entFollowUpMark.createMany({ data: [{ followUpId: f.id, projectId: "p1", phase: "线索" }, { followUpId: g.id, projectId: "p2", phase: "线索" }] });
    await prisma.entDupeHit.createMany({ data: [{ userId: 销售, keyType: "手机号", keyValue: "13800000001", customerId: c }, { userId: 销售, keyType: "手机号", keyValue: "13800000002", customerId: 留 }] });
    expect(await 彻底删除({ id: 系管, role: "SALES" }, "Customer", c)).toMatchObject({ ok: true });
    expect((await prisma.entFollowUpMark.findMany()).map((x) => x.followUpId)).toEqual([g.id]);
    expect((await prisma.entDupeHit.findMany()).map((x) => x.customerId)).toEqual([留]);
  });
});

describe("统计 P2-1 将回公海按负责人的线算", () => {
  it("外贸成员负责、项目没填业务线：按外贸天数进 3 天内（同首页卡）", async () => {
    await 存组织规则({ ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 开: true, 起算日: null, 节点天数: { 潜客培育: 30 }, 外贸节点天数: { 潜客培育: 5 } } });
    invalidateSettingsCache();
    const 外 = await 人("外贸销售", "sales", null, "外贸");
    const c = await 客户(外);
    await prisma.project.create({ data: { name: "外贸项目", customerId: c, ownerId: 外, creatorId: 外, phase: "线索", node: "潜客培育", createdAt: dayjs().subtract(3, "day").toDate() } });
    const r = await 将回公海of(undefined);
    expect(r.预警.map((x) => x.名)).toEqual(["外贸项目"]);
  });
});
