/**
 * 全页面 AI 写入卡（企业版只用项目，lib/agent/project-tools.ts → project-proposals.ts → apply-project.ts）。
 *
 * 每种卡钉四件事：
 *   - buildProposal 收卡：不合法当场拒（模型重说）
 *   - missingFields：没填的照样出卡，但确认按钮灰着（落库那一步再拦一次）
 *   - 确认后转给页面上同一个 server action（下面把这些 action 包一层 spy，真实逻辑照跑）
 *   - 没权限 / 看不到的人确认：原话回卡片，一行不写
 * 同事被拒：项目类 action 自己按负责人拦（卡确认后照样转进去、由它拒）；联系人、删客户 action 里没拦，卡在转之前先拦。
 * 另外：同名的不止一个时不替人挑（候选），挑之前不能确认；只用项目关着时不给这批工具
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "ADMIN", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
/* 包一层 spy：看 apply 调的是不是那个 action；里面照原样跑（权限、团队范围都是真的） */
vi.mock("@/app/(app)/projects/actions", async (原) => {
  const m = await 原<typeof import("@/app/(app)/projects/actions")>();
  return { ...m, 改项目节点: vi.fn(m.改项目节点), 终止项目进程: vi.fn(m.终止项目进程), 记项目沟通Action: vi.fn(m.记项目沟通Action), 线索初判Action: vi.fn(m.线索初判Action) };
});
vi.mock("@/app/(app)/projects/blocker-actions", async (原) => {
  const m = await 原<typeof import("@/app/(app)/projects/blocker-actions")>();
  return { ...m, 解决卡点Action: vi.fn(m.解决卡点Action) };
});
vi.mock("@/app/(app)/projects/payment-actions", async (原) => {
  const m = await 原<typeof import("@/app/(app)/projects/payment-actions")>();
  return { ...m, 记回款: vi.fn(m.记回款), 删回款: vi.fn(m.删回款) };
});
vi.mock("@/app/(app)/customers/[id]/actions", async (原) => {
  const m = await 原<typeof import("@/app/(app)/customers/[id]/actions")>();
  return { ...m, saveContact: vi.fn(m.saveContact) };
});
vi.mock("@/app/(app)/customers/actions", async (原) => {
  const m = await 原<typeof import("@/app/(app)/customers/actions")>();
  return { ...m, deleteCustomers: vi.fn(m.deleteCustomers) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { TOOLS } from "@/lib/agent/tools";
import { 这一家的工具 } from "@/lib/agent/run";
import { buildProposal, missingFields, type Proposal } from "@/lib/agent/proposals";
import { 不可撤销, type 项目卡 } from "@/lib/agent/project-proposals";
import { applyProposal, undoProposal } from "@/app/(app)/dashboard/apply";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import * as 项目动作 from "@/app/(app)/projects/actions";
import * as 卡点动作 from "@/app/(app)/projects/blocker-actions";
import * as 回款动作 from "@/app/(app)/projects/payment-actions";
import * as 联系人动作 from "@/app/(app)/customers/[id]/actions";
import * as 客户动作 from "@/app/(app)/customers/actions";
import { 记回款 as 库记回款 } from "@/lib/project/payment-db";
import { 记项目沟通 } from "@/lib/project/db";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 乙: 人, 丙: 人;
let 客户id: string, 项目id: string;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; 忘掉企业版范围(); };
const b = { ...DEFAULT_BUSINESS, projectMode: true };
const ctx = (me: 人) => ({ userId: me.id, userName: me.name, b, recordOffset: 0, proposals: [] as Proposal[] });

/** 以某人身份调一个 propose_* 工具，拿回它出的那张卡 */
async function 出(name: string, args: Record<string, unknown>, me: 人 = 乙) {
  当(me);
  const c = ctx(me);
  const r = await 以谁的身份(me.id, () => TOOLS.find((t) => t.name === name)!.run(args, c as never));
  return { r, 卡: c.proposals[0] as 项目卡 | undefined };
}
/** 以某人身份点确认 */
async function 确认(p: Proposal, me: 人) {
  当(me);
  return 以谁的身份(me.id, () => applyProposal(p));
}
const 收 = (kind: string, args: Record<string, unknown>, 客户 = { id: "", name: "" }) => buildProposal("t", kind as never, 客户, { reason: "人说的", ...args }, b);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.clearAllMocks();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  await prisma.entMember.createMany({ data: [{ userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }] });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  客户id = (await prisma.customer.create({ data: { name: "云帆科技", phone: "13900000001", salesOwnerId: 乙.id } })).id;
  项目id = (await prisma.project.create({ data: { name: "云帆一期", customerId: 客户id, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
  当(老板);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("给不给工具", () => {
  it("只用项目开着才有 propose_project_node 等；关着没有", async () => {
    const 名 = (只用项目: boolean) => 这一家的工具(b, 只用项目).TOOLS.map((t) => t.name);
    expect(名(true)).toEqual(expect.arrayContaining(["propose_project_node", "propose_blocker_add", "propose_payment_add", "propose_lead_verify", "propose_contact_update", "propose_customer_delete"]));
    expect(名(false)).not.toContain("propose_project_node");
  });
});

describe("推进节点 / 定结局", () => {
  it("收卡：没有目标拒不了但算缺；终止要原因", () => {
    const r = 收("project_node", { targetId: 项目id, targetName: "云帆一期", 目标: "" });
    expect(r.ok).toBe(true);
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(expect.arrayContaining(["去哪一步"]));
    const 终 = 收("project_node", { targetId: 项目id, targetName: "x", 目标: "终止", 到: { phase: "线索", node: "潜客培育", result: "线索流失" } });
    expect(missingFields((终 as { proposal: Proposal }).proposal)).toContain("原因");
    expect(不可撤销("project_node")).toBe(true);
  });

  it("负责人确认终止：转给 终止项目进程，项目变线索流失、留一条 ai_apply 记录；同事确认一行不写", async () => {
    const { 卡 } = await 出("propose_project_node", { project: "云帆一期", 目标: "终止", 原因: "预算砍了", reason: "人说丢了" });
    expect(卡).toMatchObject({ kind: "project_node", targetId: 项目id, 到: { result: "线索流失" } });
    expect(missingFields(卡!)).toEqual([]);

    const 拒 = await 确认(卡!, 丙);
    expect(拒.ok).toBe(false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).result).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "ai_apply" } })).toBe(0);

    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(项目动作.终止项目进程).toHaveBeenCalledWith(项目id, { categoryId: null, 备注: "预算砍了" });
    expect(项目动作.改项目节点).not.toHaveBeenCalled();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).result).toBe("线索流失");
    expect(await prisma.auditLog.count({ where: { action: "ai_apply" } })).toBe(1);
  });

  it("同名两个：不替人挑，候选里两个，挑之前确认拦下", async () => {
    const 另 = (await prisma.customer.create({ data: { name: "云帆贸易", phone: "13900000002", salesOwnerId: 乙.id } })).id;
    await prisma.project.create({ data: { name: "云帆一期", customerId: 另, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    const { 卡 } = await 出("propose_project_node", { project: "云帆一期", 目标: "终止", 原因: "x", reason: "y" });
    expect(卡!.targetId).toBe("");
    expect(卡!.候选).toHaveLength(2);
    expect(missingFields(卡!)).toContain("选哪一个");
    expect(await 确认(卡!, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("选哪一个") });
    expect(项目动作.终止项目进程).not.toHaveBeenCalled();
    // 人挑了第一个：补 合进卡里，就能确认
    const c = 卡!.候选![0];
    const 挑了 = { ...卡!, targetId: c.id, targetName: c.名, ...(c.补 ?? {}) } as 项目卡;
    expect(missingFields(挑了)).toEqual([]);
  });
});

describe("沟通 + 卡点", () => {
  it("收卡：卡点类型不认得拒；没填明确回复、下一步算缺", () => {
    expect(收("project_followup", { targetId: 项目id, content: "x", 要卡点: true, 卡点类型: "超级卡点" })).toMatchObject({ ok: false });
    const r = 收("project_followup", { targetId: 项目id, targetName: "x", content: "聊了报价", 要卡点: true, 卡点类型: "" });
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["客户明确回复了吗", "下一步做什么", "卡点类型"]);
  });

  it("负责人确认：转给 记项目沟通Action（带卡点）；沟通、卡点各一条；同事确认一行不写", async () => {
    const { 卡 } = await 出("propose_blocker_add", { project: "云帆一期", 卡点类型: "中度卡点", 影响等级: "短期不影响", 卡点描述: "报价高", content: "客户嫌贵", 明确回复: "否", 下一步: "下周再报价", reason: "人说卡在价格" });
    expect(卡).toMatchObject({ kind: "project_followup", 要卡点: true, 卡点类型: "中度卡点" });

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.entBlocker.count()).toBe(0);

    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(项目动作.记项目沟通Action).toHaveBeenCalledWith(
      项目id,
      expect.objectContaining({ content: "客户嫌贵", 明确回复: false, 下一步: "下周再报价", 阶段: "线索" }),
      { type: "中度卡点", impact: "短期不影响", description: "报价高" },
    );
    expect(await prisma.followUp.count()).toBe(1);
    expect(await prisma.entBlocker.count()).toBe(1);
  });
});

describe("解决卡点", () => {
  async function 一个处理中的卡点(handler: string) {
    const f = await 记项目沟通({ id: 乙.id, role: "SALES" }, 项目id, { type: "PHONE", content: "聊了", occurredAt: new Date().toISOString().slice(0, 10), 阶段: "线索", 明确回复: true });
    return prisma.entBlocker.create({
      data: { code: "BLK20261101001", projectId: 项目id, followUpId: f.followUpId!, customerId: 客户id, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格", description: "报价高", dueDays: 3, dueAt: new Date(), creatorId: 乙.id, status: "处理中", assigneeId: handler },
    });
  }

  it("收卡：没写方案、结果算缺", () => {
    const r = 收("blocker_resolve", { targetId: "b1", targetName: "BLK" });
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["解决方案", "解决结果"]);
  });

  it("处理人确认：转给 解决卡点Action，变已解决；不是处理人的确认一行不写", async () => {
    const k = await 一个处理中的卡点(乙.id);
    const { 卡 } = await 出("propose_blocker_resolve", { project: "云帆一期", reason: "人说解决了" });
    expect(卡).toMatchObject({ kind: "blocker_resolve", targetId: k.id });
    const 填好 = { ...卡!, solution: "降价 5%", result: "客户接受" } as 项目卡;

    const 拒 = await 确认(填好, 丙);
    expect(拒.ok).toBe(false);
    expect((await prisma.entBlocker.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("处理中");

    const r = await 确认(填好, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(卡点动作.解决卡点Action).toHaveBeenCalledWith(k.id, { solution: "降价 5%", result: "客户接受" });
    expect((await prisma.entBlocker.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("已解决");
  });
});

describe("回款", () => {
  it("收卡：金额负数、日子看不懂拒；没金额算缺；新记的能撤，删的不能", () => {
    expect(收("payment_add", { targetId: 项目id, amount: -1, paidAt: "2026-11-01" })).toMatchObject({ ok: false });
    expect(收("payment_add", { targetId: 项目id, amount: 10, paidAt: "下周" })).toMatchObject({ ok: false });
    const r = 收("payment_add", { targetId: 项目id, targetName: "x", paidAt: "2026-11-01" });
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["金额"]);
    expect(不可撤销("payment_add")).toBe(false);
    expect(不可撤销("payment_delete")).toBe(true);
  });

  it("负责人记一笔：转给 记回款，能从卡上撤销；同事确认一行不写", async () => {
    const { 卡 } = await 出("propose_payment_add", { project: "云帆一期", paidAt: "2026-11-01", amount: 5000, currency: "CNY", reason: "人说到账了" });
    expect(卡).toMatchObject({ kind: "payment_add", targetId: 项目id, amount: 5000 });

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(await prisma.entProjectPayment.count()).toBe(0);

    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true, 撤销: { kind: "payment_add", projectId: 项目id } });
    expect(回款动作.记回款).toHaveBeenCalledWith(项目id, { paidAt: "2026-11-01", currency: "CNY", amount: 5000 });
    expect(await prisma.entProjectPayment.count()).toBe(1);
    expect(await undoProposal((r as unknown as { 撤销: never }).撤销)).toMatchObject({ ok: true });
    expect(await prisma.entProjectPayment.count()).toBe(0);
  });

  it("删一笔：转给 删回款；同事确认一行不删", async () => {
    const 笔 = await 库记回款({ id: 乙.id, role: "SALES" }, 项目id, { paidAt: "2026-10-20", currency: "CNY", amount: 800 });
    const { 卡 } = await 出("propose_payment_delete", { project: "云帆一期", amount: 800, reason: "人说记错了" });
    expect(卡).toMatchObject({ kind: "payment_delete", targetId: 笔.id });

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(await prisma.entProjectPayment.count()).toBe(1);

    expect(await 确认(卡!, 乙)).toMatchObject({ ok: true });
    expect(回款动作.删回款).toHaveBeenCalledWith(笔.id);
    expect(await prisma.entProjectPayment.count()).toBe(0);
  });
});

describe("线索验证", () => {
  beforeEach(async () => {
    await prisma.project.update({ where: { id: 项目id }, data: { node: "线索验证" } });
  });

  it("收卡：这一步判不了的拒；初判无效没原因算缺", () => {
    expect(收("lead_verify", { targetId: 项目id, 步: "初判", 判: "接受" })).toMatchObject({ ok: false });
    const r = 收("lead_verify", { targetId: 项目id, targetName: "x", 步: "初判", 判: "无效" });
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["无效原因"]);
  });

  it("负责人初判无效：转给 线索初判Action，记下初验无效；不归他判的人确认一行不写", async () => {
    const { 卡 } = await 出("propose_lead_verify", { project: "云帆一期", 判: "无效", 无效原因: "联系方式无效", 说明: "打了三次", reason: "人说是空号" });
    expect(卡).toMatchObject({ kind: "lead_verify", targetId: 项目id, 步: "初判", 判: "无效" });

    const 拒 = await 确认(卡!, 丙);
    expect(拒.ok).toBe(false);
    expect(await prisma.entLeadVerify.count()).toBe(0);

    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(项目动作.线索初判Action).toHaveBeenLastCalledWith(项目id, "无效", expect.objectContaining({ invalidReason: "联系方式无效", verifyNote: "打了三次" }));
    expect(await prisma.entLeadVerify.findUnique({ where: { projectId: 项目id } })).toMatchObject({ verdict: "初验无效" });
  });
});

describe("联系人", () => {
  it("收卡：电话不让 AI 改；性别只认男女；姓名改空算缺", () => {
    expect(收("contact_update", { targetId: "c", 改: [{ field: "phone", value: "1" }] })).toMatchObject({ ok: false });
    expect(收("contact_update", { targetId: "c", 改: [{ field: "gender", value: "未知" }] })).toMatchObject({ ok: false });
    const r = 收("contact_update", { targetId: "c", targetName: "x", 改: [{ field: "name", value: "" }] });
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["姓名"]);
  });

  it("负责人确认：转给 saveContact，职位改了、电话不动；看不到这位客户的同事确认一行不写", async () => {
    const 人 = await prisma.contact.create({ data: { name: "王经理", position: "采购", phone: "13700000001", customerId: 客户id } });
    const { 卡 } = await 出("propose_contact_update", { contact: "王经理", 改: [{ field: "position", value: "采购总监" }], reason: "人说升职了" });
    expect(卡).toMatchObject({ kind: "contact_update", targetId: 人.id, 现值: { position: "采购" } });

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(联系人动作.saveContact).not.toHaveBeenCalled();
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: 人.id } })).position).toBe("采购");

    expect(await 确认(卡!, 乙)).toMatchObject({ ok: true });
    expect(联系人动作.saveContact).toHaveBeenCalledWith(expect.objectContaining({ id: 人.id, position: "采购总监", phone: "13700000001" }));
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 人.id } })).toMatchObject({ position: "采购总监", phone: "13700000001" });
  });
});

describe("删客户", () => {
  it("卡上写「删除」和名字，不可撤销", async () => {
    const { r, 卡 } = await 出("propose_customer_delete", { customer: "云帆科技", reason: "人说是重复的" });
    expect(r.summary).toContain("删除客户「云帆科技」");
    expect(卡).toMatchObject({ kind: "customer_delete", targetId: 客户id });
    expect(不可撤销("customer_delete")).toBe(true);
  });

  it("负责人确认：转给 deleteCustomers，进回收站；看不到的同事确认一行不删", async () => {
    const { 卡 } = await 出("propose_customer_delete", { customer: "云帆科技", reason: "人说是重复的" });

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(客户动作.deleteCustomers).not.toHaveBeenCalled();
    expect(await prisma.customer.count()).toBe(1);

    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(客户动作.deleteCustomers).toHaveBeenCalledWith([客户id]);
    expect(await prisma.customer.count()).toBe(0);
  });
});
