/**
 * 合并客户第二批 2a · 项目合并（服务端；规划 merge-customer-b2「同负责人的两个项目怎么并」，客户 E-280 二）：
 *   - 前提：同客户、同负责人（系统管理员可代并）、都没结束、不在公海、线索阶段、无回款无提成行；被并掉的没判有效、没在等判、没判无效
 *   - 挪 / 不挪逐表；被并掉的结束为重复线索，不补名额；合并不算一次跟进
 *   - 单撤：只比合并写过的格；谁能撤；30 天；删除 / 转让 / 交接之后再撤
 *   - 合并之后 30 天内的保护：重启、改结局、改判、换客户
 *   - 整单撤回客户合并时先撤之后并过的项目
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 项目合并预览, 执行项目合并, 撤回项目合并, 能并进的项目, 项目的合并单, 项目合并通知种类, 阶段和钱拦, 项目合并验证步 } from "@/lib/enterprise/project-merge";
import { 项目单, 被并项目拦, 换客户合并拦 } from "@/lib/enterprise/project-merge-guard";
import { 执行合并, 撤回合并 } from "@/lib/enterprise/customer-merge";
import { 项目换客户 } from "@/lib/enterprise/project-move-customer";
import { 改节点, 删项目 } from "@/lib/project/db";
import { 销售初判 } from "@/lib/project/lead-verify";
import { 撤回一批 } from "@/lib/enterprise-import/revert";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 丙: 人;
let 序 = 0;
const 天 = 86_400_000;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string) {
  序++;
  return (await raw.customer.create({ data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId } })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, ...补 } })).id;
}
async function 联系人(customerId: string) {
  return (await raw.contact.create({ data: { name: `联系人${++序}`, customerId, phone: `1390000${String(序).padStart(4, "0")}` } })).id;
}
/** 项目上记一条沟通：FollowUpProject + 标记 + 编号 */
async function 项目沟通(customerId: string, projectId: string, at = new Date()) {
  const f = await raw.followUp.create({ data: { type: "PHONE", title: "沟通", content: "聊过", customerId, ownerId: 乙.id, occurredAt: at } });
  await raw.followUpProject.create({ data: { followUpId: f.id, projectId, node: "潜客培育" } });
  await raw.entFollowUpMark.create({ data: { followUpId: f.id, projectId, phase: "线索" } });
  await raw.entFollowUpMeta.create({ data: { followUpId: f.id, projectId, code: `FUL20261126${String(++序).padStart(6, "0")}` } });
  return f.id;
}
async function 卡点(customerId: string, projectId: string, status = "待接受") {
  return (await raw.entBlocker.create({
    data: { code: `KD${++序}`, projectId, customerId, phase: "线索", type: "x", impact: "x", obstacle: "x", description: "x", dueDays: 3, dueAt: new Date(), creatorId: 乙.id, status },
  })).id;
}
const 并 = async (a: string, b: string, me: 人, opt: { 组员?: string[]; 现在?: Date } = {}) => {
  const r = await 执行项目合并(prisma, a, b, me, opt);
  if (!r.ok) throw new Error(r.error);
  return r.mergeId;
};
const 项 = (id: string) => raw.project.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  await raw.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }] });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("前提：谁能并、哪些拦", () => {
  it("同客户、同负责人的两个线索：负责人本人能并；同事、负责人不同、不同客户都拦；系统管理员能代并", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    expect(await 项目合并预览(prisma, a, b, 乙)).toMatchObject({ 能并: true, 原因: [] });
    expect(await 项目合并预览(prisma, a, b, 丙)).toMatchObject({ 能并: false, 原因: [expect.stringContaining("不是你负责的")] });
    expect(await 项目合并预览(prisma, a, b, 老板)).toMatchObject({ 能并: true });
    expect(await 能并进的项目(prisma, b, 乙)).toEqual([expect.objectContaining({ id: a })]);
    expect(await 能并进的项目(prisma, b, 丙)).toEqual([]);

    const 丙的 = await 项目(丙.id, c);
    expect(await 项目合并预览(prisma, a, 丙的, 老板)).toMatchObject({ 能并: false, 原因: [expect.stringContaining("负责人不同")] });
    const 别家 = await 项目(乙.id, await 客户(乙.id));
    expect(await 项目合并预览(prisma, a, 别家, 乙)).toMatchObject({ 能并: false, 原因: expect.arrayContaining([expect.stringContaining("不在同一位客户名下")]) });
    expect(await 项目合并预览(prisma, a, a, 乙)).toMatchObject({ 能并: false, 原因: [expect.stringContaining("不能和自己合并")] });
    // 执行同样拦，一行不写
    expect(await 执行项目合并(prisma, a, b, 丙)).toMatchObject({ ok: false, error: expect.stringContaining("不是你负责的") });
    expect(await raw.entCustomerMerge.count()).toBe(0);
  });

  it("已结束、在线索公海、在等分配、商机阶段、有回款、有提成行（没回款）都拦", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const 拦 = async (b: string, 话: string) => {
      const r = await 项目合并预览(prisma, a, b, 乙);
      expect(r.能并, 话).toBe(false);
      expect(r.原因.join("；")).toContain(话);
    };
    await 拦(await 项目(乙.id, c, { result: "线索流失" }), "已经结束");
    await 拦(await 项目(乙.id, c, { pooledAt: new Date() }), "线索公海");
    await 拦(await 项目(乙.id, c, { awaitAssignAt: new Date() }), "等分配");
    await 拦(await 项目(乙.id, c, { phase: "商机", node: "需求确认" }), "商机阶段");
    const 有回款 = await 项目(乙.id, c);
    await raw.entProjectPayment.create({ data: { projectId: 有回款, paidAt: new Date(), currency: "CNY", amount: 100 } as never });
    await 拦(有回款, "有回款");
    // 有提成行、没回款这一种（规划钉住）
    const 有提成 = await 项目(乙.id, c);
    await raw.entCommissionSplit.create({ data: { projectId: 有提成, userId: 乙.id, percent: 100, setById: 乙.id } });
    await 拦(有提成, "有提成记录");
    // 留下的那个是商机也拦（第 6 件默认两个都限）
    const 商机 = await 项目(乙.id, c, { phase: "商机", node: "需求确认" });
    const r = await 项目合并预览(prisma, 商机, await 项目(乙.id, c), 乙);
    expect(r.原因.join("；")).toContain("商机阶段");
    expect(阶段和钱拦({ name: "x", phase: "订单" }, "留下", { 回款: 0, 提成: 0 })).toEqual([expect.stringContaining("订单阶段")]);
  });

  it("被并掉的判过有效、在等复核、已判无效都拦；留下的那个判过有效照样能并", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    await raw.entLeadVerify.create({ data: { projectId: b, verdict: "有效线索", finalResult: "有效线索" } });
    expect((await 项目合并预览(prisma, a, b, 乙)).原因.join()).toContain("判过有效");
    await raw.entLeadVerify.update({ where: { projectId: b }, data: { verdict: "初验无效", finalResult: null, pending: "市场复核" } });
    expect((await 项目合并预览(prisma, a, b, 乙)).原因.join()).toContain("在等市场复核");
    await raw.entLeadVerify.update({ where: { projectId: b }, data: { verdict: "无效线索", finalResult: "无效线索", pending: null } });
    expect((await 项目合并预览(prisma, a, b, 乙)).原因.join()).toContain("已判无效线索");
    // 反过来：判过有效的留下，另一个并进来
    expect(await 项目合并预览(prisma, b, a, 乙)).toMatchObject({ 能并: true });
  });

  it("只读角色（管理员类）不能并、不能撤，合并单不摆撤回", async () => {
    const 丁 = await 造人("ding", "丁", "SALES");
    await raw.entMember.create({ data: { userId: 丁.id, bizRole: "admin" } });
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    expect(await 执行项目合并(prisma, a, b, 丁)).toMatchObject({ ok: false, error: expect.stringContaining("只能看") });
    const mergeId = await 并(a, b, 乙);
    expect(await 撤回项目合并(prisma, mergeId, 丁)).toMatchObject({ ok: false, error: expect.stringContaining("只有合并的人或系统管理员") });
    expect((await 项目的合并单(prisma, a, 丁))[0].能撤).toBe(false);
    expect((await 项目的合并单(prisma, b, 乙))[0]).toMatchObject({ 方向: "并出去", 能撤: true });
  });

  it("项目在离职交接里、客户在转让交接里都拦", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const h = await raw.entHandover.create({ data: { kind: "离职", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 老板.id, way: "项目", projectIds: JSON.stringify([b]) } });
    expect((await 项目合并预览(prisma, a, b, 老板)).原因.join()).toContain("离职交接中");
    await raw.entHandover.update({ where: { id: h.id }, data: { status: "已撤回" } });
    await raw.entHandover.create({ data: { kind: "转让", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 乙.id, way: "客户", customerIds: JSON.stringify([c]) } });
    expect((await 项目合并预览(prisma, a, b, 乙)).原因.join()).toContain("转让交接中");
  });
});

describe("挪 / 不挪", () => {
  it("沟通、标记、编号、附件、录音点评、没解决的卡点、老商机对照挪到留下的；联系人、关联客户去重；勾的组员加进来；不挪的留着", async () => {
    const c = await 客户(乙.id);
    const c2 = await 客户(乙.id);
    const a = await 项目(乙.id, c, { nextStepAt: new Date("2026-12-01T02:00:00Z") });
    const b = await 项目(乙.id, c);
    const 旧 = new Date(Date.now() - 3 * 天);
    const fa = await 项目沟通(c, a, new Date(Date.now() - 5 * 天));
    const fb = await 项目沟通(c, b, 旧);
    const 附 = await raw.attachment.create({ data: { projectId: b, name: "方案.pdf", mime: "application/pdf", size: 1, sha256: "x" } });
    const 录 = await raw.entCoachRecording.create({ data: { projectId: b, authorId: 乙.id, sourceKind: "upload" } });
    const 评 = await raw.entCoachTopic.create({ data: { projectId: b, node: "潜客培育", title: "t", body: "b", authorId: 老板.id } });
    const 没解决 = await 卡点(c, b);
    const 解决了 = await 卡点(c, b, "已解决");
    const 对照 = await raw.entExternalRef.create({ data: { source: "feishu", entity: "opportunity", externalId: "o1", targetId: b, fingerprint: "f", written: "{}", raw: "{}" } });
    const 都有 = await 联系人(c);
    const 只B = await 联系人(c);
    await raw.projectContact.createMany({ data: [{ projectId: a, contactId: 都有 }, { projectId: b, contactId: 都有, roles: "决策人" }, { projectId: b, contactId: 只B }] });
    await raw.projectCustomer.createMany({ data: [{ projectId: a, customerId: c2 }, { projectId: b, customerId: c2 }] });
    await raw.projectMember.createMany({ data: [{ projectId: b, userId: 丙.id }, { projectId: b, userId: 老板.id }, { projectId: a, userId: 老板.id }] });
    // 不挪的
    await raw.projectNodeLog.create({ data: { projectId: b, userId: 乙.id, toPhase: "线索", toNode: "潜客培育" } });
    await raw.entLeadVerifyLog.create({ data: { projectId: b, step: "销售初判", verdict: "还需培育", userId: 乙.id } });
    await raw.entProjectCold.create({ data: { projectId: b, coldDay: "2026-11-20" } });
    await raw.entReplyOverdue.create({ data: { projectId: a, anchorAt: 旧, holderId: 乙.id, since: 旧 } as never });
    const 回复前 = await raw.entReplyOverdue.findUniqueOrThrow({ where: { projectId: a } });
    const 沟通数 = await raw.followUp.count();

    const mergeId = await 并(a, b, 乙, { 组员: [丙.id, 老板.id] });

    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: fb } })).projectId).toBe(a);
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: fa } })).projectId).toBe(a);
    expect((await raw.entFollowUpMark.findUniqueOrThrow({ where: { followUpId: fb } })).projectId).toBe(a);
    expect((await raw.entFollowUpMeta.findUniqueOrThrow({ where: { followUpId: fb } })).projectId).toBe(a);
    expect((await raw.attachment.findUniqueOrThrow({ where: { id: 附.id } })).projectId).toBe(a);
    expect((await raw.entCoachRecording.findUniqueOrThrow({ where: { id: 录.id } })).projectId).toBe(a);
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: 评.id } })).projectId).toBe(a);
    expect((await raw.entBlocker.findUniqueOrThrow({ where: { id: 没解决 } })).projectId).toBe(a);
    expect((await raw.entBlocker.findUniqueOrThrow({ where: { id: 解决了 } })).projectId).toBe(b);
    expect((await raw.entExternalRef.findUniqueOrThrow({ where: { id: 对照.id } })).targetId).toBe(a);
    expect((await raw.projectContact.findMany({ where: { projectId: a }, orderBy: { contactId: "asc" } })).map((x) => x.contactId).sort()).toEqual([都有, 只B].sort());
    expect(await raw.projectContact.count({ where: { projectId: b } })).toBe(0);
    expect(await raw.projectCustomer.count({ where: { projectId: a, customerId: c2 } })).toBe(1);
    expect(await raw.projectCustomer.count({ where: { projectId: b } })).toBe(0);
    // 组员：丙 加进 A，老板 已在组里跳过；B 的组员行不动
    expect((await raw.projectMember.findMany({ where: { projectId: a } })).map((m) => m.userId).sort()).toEqual([老板.id, 丙.id].sort());
    expect(await raw.projectMember.count({ where: { projectId: b } })).toBe(2);
    // 不挪
    expect(await raw.projectNodeLog.count({ where: { projectId: a } })).toBe(0);
    expect(await raw.entLeadVerifyLog.count({ where: { projectId: a } })).toBe(0);
    expect(await raw.entProjectCold.count({ where: { projectId: b } })).toBe(1);
    // 被并掉的：重复线索，不补名额
    const B后 = await 项(b);
    expect(B后).toMatchObject({ result: "线索流失", closedAt: expect.any(Date) });
    expect(await raw.entLeadVerify.findUniqueOrThrow({ where: { projectId: b } })).toMatchObject({ verdict: "无效线索", finalResult: "无效线索", invalidReason: "重复线索", pending: null });
    expect(await raw.entLeadVerifyLog.count({ where: { projectId: b, step: 项目合并验证步 } })).toBe(1);
    expect(await raw.entLeadMakeup.count()).toBe(0);
    // 合并不算一次跟进：没新沟通，A 的下一步时间、回复逾期的钟不动
    expect(await raw.followUp.count()).toBe(沟通数);
    expect((await 项(a)).nextStepAt?.toISOString()).toBe("2026-12-01T02:00:00.000Z");
    expect(await raw.entReplyOverdue.findUniqueOrThrow({ where: { projectId: a } })).toEqual(回复前);
    // 合并单 + 两条日志 + 通知（操作人自己不发）
    const 单 = await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: mergeId } });
    expect(单).toMatchObject({ kind: 项目单, fromId: b, intoId: a, status: "已合并", byUserId: 乙.id });
    expect(JSON.parse(单.counts)).toMatchObject({ 沟通: 1, 附件: 1, 录音: 1, 点评: 1, 联系人: 2, 关联客户: 1, 卡点: 1 });
    expect(await raw.auditLog.count({ where: { action: "merge", entity: "Project" } })).toBe(2);
    await 等通知推完();
    expect(await raw.entNotice.count({ where: { kind: 项目合并通知种类 } })).toBe(0);
  });

  it("系统管理员代并：负责人收一条通知；勾了不在被并项目组里的人整笔拦下", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    expect(await 执行项目合并(prisma, a, b, 老板, { 组员: [丙.id] })).toMatchObject({ ok: false, error: expect.stringContaining("勾的组员不在") });
    expect((await 项(b)).result).toBeNull();
    await 并(a, b, 老板);
    await 等通知推完();
    expect((await raw.entNotice.findMany({ where: { kind: 项目合并通知种类 } })).map((n) => n.userId)).toEqual([乙.id]);
  });
});

describe("撤回", () => {
  it("只比合并写过的格：挪的回去、去重删的建回、加的组员删掉、结局终判清回；之后被改过的记进没还原", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const x = await 项目(乙.id, c);
    const f1 = await 项目沟通(c, b);
    const f2 = await 项目沟通(c, b);
    const 都有 = await 联系人(c);
    await raw.projectContact.createMany({ data: [{ projectId: a, contactId: 都有 }, { projectId: b, contactId: 都有, roles: "决策人" }] });
    await raw.projectMember.create({ data: { projectId: b, userId: 丙.id } });
    await raw.entLeadVerify.create({ data: { projectId: b, verdict: "暂未判定", verifyNote: "原来的" } });
    const mergeId = await 并(a, b, 乙, { 组员: [丙.id] });
    // 合并之后 f2 被挪到别的项目
    await raw.followUpProject.update({ where: { followUpId: f2 }, data: { projectId: x } });

    const r = await 撤回项目合并(prisma, mergeId, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(r.没还原).toEqual([{ 类: "沟通", id: f2, 原因: expect.stringContaining("合并之后被改过") }]);
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: f1 } })).projectId).toBe(b);
    expect((await raw.entFollowUpMark.findUniqueOrThrow({ where: { followUpId: f2 } })).projectId).toBe(b);
    expect(await raw.projectContact.findFirst({ where: { projectId: b, contactId: 都有 } })).toMatchObject({ roles: "决策人" });
    expect(await raw.projectContact.count({ where: { projectId: a, contactId: 都有 } })).toBe(1);
    expect(await raw.projectMember.count({ where: { projectId: a } })).toBe(0);
    expect(await 项(b)).toMatchObject({ result: null, closedAt: null });
    expect(await raw.entLeadVerify.findUniqueOrThrow({ where: { projectId: b } })).toMatchObject({ verdict: "暂未判定", finalResult: null, invalidReason: null, verifyNote: "原来的" });
    expect(await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: mergeId } })).toMatchObject({ status: "已撤回", undoneById: 乙.id });
    expect(await 撤回项目合并(prisma, mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("已经撤回过") });
    // 原来没有验证行的：撤回删掉那一行
    const d = await 项目(乙.id, c);
    const m2 = await 并(a, d, 乙);
    expect((await 撤回项目合并(prisma, m2, 乙)).ok).toBe(true);
    expect(await raw.entLeadVerify.findUnique({ where: { projectId: d } })).toBeNull();
    expect(await 项目的合并单(prisma, a, 乙)).toHaveLength(2);
  });

  it("谁能撤：合并的人、系统管理员；同事不能；30 天后不能", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const mergeId = await 并(a, b, 乙, { 现在: new Date(Date.now() - 31 * 天) });
    expect(await 撤回项目合并(prisma, mergeId, 丙)).toMatchObject({ ok: false, error: expect.stringContaining("只有合并的人或系统管理员") });
    expect(await 撤回项目合并(prisma, mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("超过 30 天") });
    // 过了 30 天也不再拦换客户（不能撤也就不拦）
    expect(await 换客户合并拦(prisma, b)).toBeNull();
    const e = await 项目(乙.id, c);
    const 近 = await 并(a, e, 乙);
    expect((await 撤回项目合并(prisma, 近, 老板)).ok).toBe(true);
  });

  it("转让：留下的项目转给了别人，合并的人不能撤，系统管理员能撤", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const f = await 项目沟通(c, b);
    const mergeId = await 并(a, b, 乙);
    await raw.project.update({ where: { id: a }, data: { ownerId: 丙.id } });
    expect(await 撤回项目合并(prisma, mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("不归你负责") });
    expect((await 项目的合并单(prisma, a, 乙))[0].能撤).toBe(false);
    expect((await 项目的合并单(prisma, a, 老板))[0].能撤).toBe(true);
    const r = await 撤回项目合并(prisma, mergeId, 老板);
    expect(r).toMatchObject({ ok: true, 没还原: [] });
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: f } })).projectId).toBe(b);
  });

  it("删除：两个项目有一个在回收站里，撤回拦下，先恢复", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const mergeId = await 并(a, b, 乙);
    const d = await 删项目(乙, a);
    expect(d.ok).toBe(true);
    expect(await 撤回项目合并(prisma, mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("在回收站里，先恢复") });
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: mergeId } })).status).toBe("已合并");
  });

  it("交接：项目在离职交接待确认里，撤回拦下；撤回交接后能撤", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const mergeId = await 并(a, b, 乙);
    const h = await raw.entHandover.create({ data: { kind: "离职", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 老板.id, way: "项目", projectIds: JSON.stringify([a]) } });
    expect(await 撤回项目合并(prisma, mergeId, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("离职交接中") });
    await raw.entHandover.update({ where: { id: h.id }, data: { status: "已撤回" } });
    expect((await 撤回项目合并(prisma, mergeId, 老板)).ok).toBe(true);
  });

  it("连环：留下的又并进了别的项目，先撤那次", async () => {
    const c = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const z = await 项目(乙.id, c);
    const f = await 项目沟通(c, b);
    const m1 = await 并(a, b, 乙);
    const m2 = await 并(z, a, 乙);
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: f } })).projectId).toBe(z);
    expect(await 撤回项目合并(prisma, m1, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("先撤回那次合并") });
    expect((await 撤回项目合并(prisma, m2, 乙)).ok).toBe(true);
    expect((await 撤回项目合并(prisma, m1, 乙)).ok).toBe(true);
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: f } })).projectId).toBe(b);
  });
});

describe("合并之后 30 天内的保护", () => {
  it("被并掉的：重启、改结局、线索验证改判、换客户都拦；留下的：换客户拦，改节点照常；撤回后都放开", async () => {
    const c = await 客户(乙.id);
    const c2 = await 客户(乙.id);
    const a = await 项目(乙.id, c);
    const b = await 项目(乙.id, c);
    const mergeId = await 并(a, b, 乙);
    expect(await 被并项目拦(prisma, b)).toContain("已并入");
    expect(await 被并项目拦(prisma, a)).toBeNull();
    // 重启（改回进行中）、改结局
    expect(await 改节点(乙, b, { phase: "线索", node: "潜客培育", result: null })).toMatchObject({ ok: false, error: expect.stringContaining("要动先撤回合并") });
    expect(await 改节点(乙, b, { phase: "线索", node: "潜客培育", result: "异常状态" }, { categoryId: "x" })).toMatchObject({ ok: false, error: expect.stringContaining("要动先撤回合并") });
    // 线索验证改判
    expect(await 销售初判(乙, b, "有效")).toMatchObject({ ok: false, error: expect.stringContaining("要动先撤回合并") });
    // 换客户：两头都拦
    expect(await 项目换客户(prisma, b, c2, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("要动先撤回合并") });
    expect(await 项目换客户(prisma, a, c2, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("换客户前先撤回那次合并") });
    // 留下的照常改节点
    expect((await 改节点(乙, a, { phase: "线索", node: "潜客培育", result: "线索流失" }, { 备注: "测" })).ok).toBe(true);
    expect((await 改节点(乙, a, { phase: "线索", node: "潜客培育", result: null })).ok).toBe(true);

    expect((await 撤回项目合并(prisma, mergeId, 乙)).ok).toBe(true);
    expect(await 被并项目拦(prisma, b)).toBeNull();
    expect((await 项目换客户(prisma, a, c2, 乙)).ok).toBe(true);
  });
});

describe("整单撤回客户合并：先撤之后并过的项目", () => {
  it("B 家并进 A 家后，B 挪过来的项目和 A 的项目合并；撤回客户合并先撤项目合并，再拆回", async () => {
    const A = await 客户(乙.id);
    const B = await 客户(乙.id);
    const pa = await 项目(乙.id, A);
    const pb = await 项目(乙.id, B);
    const f = await 项目沟通(B, pb);
    const cm = await 执行合并(prisma, A, B, 乙);
    if (!cm.ok) throw new Error(cm.error);
    const pm = await 并(pa, pb, 乙);
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: f } })).projectId).toBe(pa);

    const r = await 撤回合并(prisma, cm.mergeId, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(r.提示).toContain("先撤回了 1 次项目合并");
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: pm } })).status).toBe("已撤回");
    expect(await 项(pb)).toMatchObject({ customerId: B, result: null });
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: f } })).projectId).toBe(pb);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f } })).customerId).toBe(B);
  });
});

describe("字段覆盖守卫：库里带项目 id 的表都定过挪不挪", () => {
  it("schema 里每个指项目的列都在下面清单里（新加表要先想清楚项目合并挪不挪、撤回怎么回）", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const 列们: string[] = [];
    let 模型 = "";
    for (const 行 of schema.split("\n")) {
      const m = /^model (\w+) /.exec(行);
      if (m) 模型 = m[1];
      const c = /^\s+(\w*[pP]rojectId)\s+String/.exec(行);
      if (c && 模型) 列们.push(`${模型}.${c[1]}`);
    }
    // 挪（project-merge.ts 挪表 / 去重表）
    const 挪 = ["FollowUpProject.projectId", "EntFollowUpMark.projectId", "EntFollowUpMeta.projectId", "Attachment.projectId", "EntCoachRecording.projectId", "EntCoachTopic.projectId", "EntBlocker.projectId", "ProjectContact.projectId", "ProjectCustomer.projectId"];
    // 人勾的
    const 勾 = ["ProjectMember.projectId"];
    // 不挪 / 不涉及（规划逐表清单）：项目自己的经历、前提拦住的回款提成、售后列、AI 对话自己的项目
    const 不挪 = [
      "ProjectNodeLog.projectId", "EntLeadVerify.projectId", "EntLeadVerifyLog.projectId", "EntLeadAssign.projectId", "EntLeadGiveUp.projectId",
      "EntLeadMakeup.projectId", "EntLeadMakeup.usedProjectId", "EntReplyOverdue.projectId", "EntRequiredBlock.projectId", "EntProjectCold.projectId",
      "EntProjectPayment.projectId", "EntCommission.projectId", "EntCommissionSplit.projectId", "FollowPlan.afterSaleProjectId", "AiConversation.projectId",
    ];
    expect(列们.filter((x) => ![...挪, ...勾, ...不挪].includes(x)), "新表带项目 id：在 project-merge.ts 决定挪不挪，再补进这里").toEqual([]);
    expect([...挪, ...勾, ...不挪].filter((x) => !列们.includes(x)), "表里没有了，从清单删掉").toEqual([]);
  });
});

describe("导入整批撤回", () => {
  it("这一批建的项目已并入别的项目、或有项目并进了它：都跳过不撤，报告写明", async () => {
    const c = await 客户(乙.id);
    const a = await (async () => (await raw.project.create({ data: { name: "留下的线索", customerId: c, ownerId: 乙.id, creatorId: 乙.id } })).id)();
    const b = await (async () => (await raw.project.create({ data: { name: "导进来的线索", customerId: c, ownerId: 乙.id, creatorId: 乙.id } })).id)();
    const 批 = await raw.entImportBatch.create({ data: { source: "excel", status: "done" } });
    for (const [x, id] of [["o1", b], ["o2", a]] as const) {
      await raw.entImportRow.create({ data: { batchId: 批.id, entity: "opportunity", externalId: x, targetId: id, kind: "create", written: "{}" } });
      await raw.entExternalRef.create({ data: { source: "excel", entity: "opportunity", externalId: x, targetId: id, fingerprint: "f", written: "{}", raw: "{}", batchId: 批.id } });
    }
    const mergeId = await 并(a, b, 乙);
    const 结 = await 撤回一批(批.id, { id: 老板.id, name: 老板.name });
    expect(结.留下).toEqual(expect.arrayContaining([
      expect.objectContaining({ 原因: expect.stringContaining("已并入 → 「留下的线索」，未撤") }),
      expect.objectContaining({ 原因: expect.stringContaining("「导进来的线索」并进了这个项目，未撤") }),
    ]));
    expect((await 项(a)).deletedAt).toBeNull();
    expect((await 项(b)).deletedAt).toBeNull();
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: mergeId } })).status).toBe("已合并");
  });
});
