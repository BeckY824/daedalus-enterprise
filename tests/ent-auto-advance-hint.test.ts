/**
 * 记沟通顺带按必填把节点推了一格，不能悄悄推（11-20）：每个记沟通的入口推了都回「推到哪」，界面 / AI 卡拿去说一句。真库：
 *   - 客户上记（saveFollowUp：客户页、完成计划、速记、首页 AI 记沟通卡 add_followup）回 自动推进（哪个项目、推到哪）
 *   - 首页 AI 记沟通卡（add_followup）、项目上的 AI 记沟通卡（project_followup）确认后回 推进 那一句
 *   - 文案共用一处（lib/project/auto-advance-text.ts）
 * 另：项目来源有没有值，节点必填和项目页同一个判断（项目没选跟客户来源也算有，同渠道统计）
 * 11-20 审查补：组员记沟通不推（P-沟通-05）；同一次保存刚写的下一步不被这次自动推进清掉；
 *   撤销回到这次推之前的节点、带回被清掉的下一步，项目已经被改过就不撤
 * 11-20 复审补：客户上存了之后只推我能改节点的项目（同事负责、我是组员的不推；销售管理改下属的沟通不推下属的项目）；
 *   「仅上级推」上级代推带来的下一步不采纳
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 默认组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 as 开关 } from "@/lib/enterprise/rules";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { buildProposal, type Proposal } from "@/lib/agent/proposals";
import { 北京日期 } from "./helpers/beijing-date";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 自动推进话, 自动推进话of } from "@/lib/project/auto-advance-text";
import { 项目来源有值, 还差, type 必填数据 } from "@/lib/project/required";
import { 读必填数据 } from "@/lib/project/db";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 记项目沟通, 客户项目按必填推进 } from "@/lib/project/db";
import { 改项目节点 } from "@/app/(app)/projects/actions";

const 开着 = (必填: Record<string, string[]>): 组织规则 => ({ ...默认组织规则, 节点推进: { 开: true, 必填 } });
const b = { ...DEFAULT_BUSINESS, projectMode: true };

describe("推进那句话（纯函数）", () => {
  it("项目上存的回 自动推到；客户上存的回 自动推进（带项目名，多个用「；」接）；没推回 null", () => {
    expect(自动推进话(["方案敲定"])).toBe("必填齐了，自动推进到 方案敲定");
    expect(自动推进话(["方案敲定"], "一号")).toBe("项目「一号」必填齐了，自动推进到 方案敲定");
    expect(自动推进话([])).toBeNull();
    expect(自动推进话of({ ok: true, 自动推到: ["线索验证"] })).toBe("必填齐了，自动推进到 线索验证");
    expect(自动推进话of({ ok: true, 自动推进: [{ id: "a", name: "一号", 到: ["方案敲定"] }, { id: "b", name: "二号", 到: ["线索验证"] }] }))
      .toBe("项目「一号」必填齐了，自动推进到 方案敲定；项目「二号」必填齐了，自动推进到 线索验证");
    expect(自动推进话of({ ok: true })).toBeNull();
    expect(自动推进话of(null)).toBeNull();
  });
});

describe("项目来源有值（纯函数，必填和项目页同一处）", () => {
  it("项目自己选了 / 没选跟客户来源都算有；两个都空才算没填", () => {
    expect(项目来源有值("ch1", null)).toBe(true);
    expect(项目来源有值(null, "ch2")).toBe(true);
    expect(项目来源有值(null, null)).toBe(false);
    expect(项目来源有值("", undefined)).toBe(false);
  });
});

describe("真库", () => {
  let 乙: { id: string; role: string; name: string };
  let 客户: string;
  async function 人(email: string, role: string, bizRole: string) {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, bizRole } });
    return { id: u.id, role, name: email };
  }
  const 当 = (u: { id: string; role: string; name: string }) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; 忘掉企业版范围(); };
  /** 商机·痛点挖掘配了预算能力，画像早就选了（存量项目、或当时没推）：下一次保存（这里是记沟通）才推到方案敲定 */
  const 画像齐了的项目 = (补: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "痛点挖掘", budgetLevel: "预算充足", ...补 } });

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("business", { projectMode: true });
    await setSetting(开关.按组织看客户.key, true);
    乙 = await 人("yi", "SALES", "sales");
    当(乙);
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙.id } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("客户上记沟通（saveFollowUp）：推了回 自动推进（哪个项目、推到哪）；没推不带", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const p = await 画像齐了的项目();
    const r = await 以谁的身份(乙.id, () => saveFollowUp({ customerId: 客户, projectId: p.id, type: "PHONE", title: "", content: "电话聊了预算和排期", status: "已完成", occurredAt: new Date().toISOString() }));
    expect(r).toMatchObject({ ok: true, 自动推进: [{ id: p.id, name: "一号项目", 到: ["方案敲定"] }] });
    expect(自动推进话of(r)).toBe("项目「一号项目」必填齐了，自动推进到 方案敲定");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).node).toBe("方案敲定");
    // 再记一条：方案敲定没配必填，不推，不带
    const 再 = await 以谁的身份(乙.id, () => saveFollowUp({ customerId: 客户, projectId: p.id, type: "PHONE", title: "", content: "又聊了一次方案细节", status: "已完成", occurredAt: new Date().toISOString() }));
    expect(再.ok).toBe(true);
    expect(再).not.toHaveProperty("自动推进");
  });

  it("首页 AI 记沟通卡（add_followup）：确认后回 推进 那一句，写明撤销这条沟通不退进程", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const p = await 画像齐了的项目();
    const 卡 = buildProposal("t", "add_followup", { id: 客户, name: "客户甲" }, { reason: "人说的", type: "PHONE", title: "", content: "电话聊了预算和排期", occurredAt: new Date().toISOString(), projectId: p.id }, b);
    expect(卡.ok).toBe(true);
    const r = await 以谁的身份(乙.id, () => applyProposal((卡 as { proposal: Proposal }).proposal));
    expect(r).toMatchObject({ ok: true, 推进: "项目「一号项目」必填齐了，自动推进到 方案敲定（撤销这条沟通不会把进程退回去）" });
    expect(r.ok && r.message).toContain("自动推进到 方案敲定");
  });

  it("项目上的 AI 记沟通卡（project_followup）：确认后回 推进 那一句；没推不带", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const p = await 画像齐了的项目();
    const 卡 = (id: string) => ({ id: "t", kind: "project_followup", customerId: 客户, customerName: "客户甲", reason: "人说的", targetId: id, targetName: "一号项目", projectId: id, type: "PHONE", content: "电话聊了预算", 下一步: "下周报方案", 下一步时间: "", 要卡点: false, 卡点类型: "", 影响等级: "", 阻碍原因: [] }) as unknown as Proposal;
    const r = await 以谁的身份(乙.id, () => applyProposal(卡(p.id)));
    expect(r).toMatchObject({ ok: true, 推进: "必填齐了，自动推进到 方案敲定（这张卡不能撤销，要退回去到项目页改进程）" });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).node).toBe("方案敲定");
    const q = await prisma.project.create({ data: { name: "二号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "痛点挖掘" } });
    const 没推 = await 以谁的身份(乙.id, () => applyProposal({ ...卡(q.id), content: "电话又聊了一次" } as Proposal));
    expect(没推.ok).toBe(true);
    expect(没推).not.toHaveProperty("推进");
  });

  it("组员记沟通（P-沟通-05）：客户页 / 首页 AI 记沟通卡走 saveFollowUp，挂到别人负责的项目上，不触发自动推进", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const 丙 = await 人("bing", "SALES", "sales");
    // ① 客户是丙的、我看不到（组员来记）；② 客户我看得到、项目是丙的、我进了组
    const 丙客 = (await prisma.customer.create({ data: { name: "客户丙", phone: "13800000003", salesOwnerId: 丙.id } })).id;
    for (const cid of [丙客, 客户]) {
      const p = await prisma.project.create({ data: { name: `丙的项目${cid === 客户 ? "二" : "一"}`, customerId: cid, ownerId: 丙.id, creatorId: 丙.id, phase: "商机", node: "痛点挖掘", budgetLevel: "预算充足" } });
      await prisma.projectMember.create({ data: { projectId: p.id, userId: 乙.id, inviteStatus: "JOINED" } });
      当(乙);
      const r = await 以谁的身份(乙.id, () => saveFollowUp({ customerId: cid, projectId: p.id, type: "PHONE", title: "", content: "组员电话聊了预算", status: "已完成", occurredAt: new Date().toISOString() }));
      expect(r.ok).toBe(true);
      expect(r).not.toHaveProperty("自动推进");
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).node).toBe("痛点挖掘");
      expect(await prisma.projectNodeLog.count({ where: { projectId: p.id } })).toBe(0);
    }
  });

  it("我负责 P1、又是同事 P2 的组员（复审①）：记沟通只推我能改节点的 P1，P2 不推；挂到 P2 记也照推我自己的 P1", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const 丙 = await 人("bing", "SALES", "sales");
    for (const 挂 of ["P1", "P2"] as const) {
      const P1 = await 画像齐了的项目({ name: `我的${挂}` });
      const P2 = await prisma.project.create({ data: { name: `丙的${挂}`, customerId: 客户, ownerId: 丙.id, creatorId: 丙.id, phase: "商机", node: "痛点挖掘", budgetLevel: "预算充足" } });
      await prisma.projectMember.create({ data: { projectId: P2.id, userId: 乙.id, inviteStatus: "JOINED" } });
      当(乙);
      const r = await 以谁的身份(乙.id, () => saveFollowUp({ customerId: 客户, projectId: (挂 === "P1" ? P1 : P2).id, type: "PHONE", title: "", content: `电话聊了预算（挂${挂}）`, status: "已完成", occurredAt: new Date().toISOString() }));
      expect(r).toMatchObject({ ok: true, 自动推进: [{ id: P1.id, 到: ["方案敲定"] }] });
      expect((r as { 自动推进: unknown[] }).自动推进).toHaveLength(1);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: P1.id } })).node).toBe("方案敲定");
      expect((await prisma.project.findUniqueOrThrow({ where: { id: P2.id } })).node).toBe("痛点挖掘");
      expect(await prisma.projectNodeLog.count({ where: { projectId: P2.id } })).toBe(0);
    }
  });

  it("销售管理改下属记的沟通（复审①，input.id 路径）：不推下属负责的项目，只推自己负责的", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const 甲 = await 人("jia", "SALES", "sales_mgr");
    await prisma.entMember.update({ where: { userId: 乙.id }, data: { managerId: 甲.id } });
    // 客户是甲的（甲是客户负责人、又是管理，能改这位客户的沟通）；P 是下属乙负责的，Q 是甲自己的
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 甲.id } });
    const P = await 画像齐了的项目({ budgetLevel: null });
    const Q = await prisma.project.create({ data: { name: "甲的项目", customerId: 客户, ownerId: 甲.id, creatorId: 甲.id, phase: "商机", node: "痛点挖掘" } });
    当(乙);
    // 乙在自己负责的项目上记（客户是甲的，乙从项目页记）
    const 记 = await 以谁的身份(乙.id, () => 记项目沟通({ id: 乙.id, role: "SALES" }, P.id, { type: "PHONE", content: "乙电话聊了预算", occurredAt: new Date().toISOString(), 阶段: "商机" }));
    expect(记).toMatchObject({ ok: true });
    expect(记).not.toHaveProperty("自动推到");
    // 记完之后两个项目的预算都补上了：下一次客户上保存才会推
    await prisma.project.updateMany({ where: { id: { in: [P.id, Q.id] } }, data: { budgetLevel: "预算充足" } });
    当(甲);
    const 改 = await 以谁的身份(甲.id, () => saveFollowUp({ id: (记 as { followUpId: string }).followUpId, customerId: 客户, type: "PHONE", title: "", content: "乙电话聊了预算（甲补了几句）", status: "已完成", occurredAt: new Date().toISOString() }));
    expect(改).toMatchObject({ ok: true, 自动推进: [{ id: Q.id, 到: ["方案敲定"] }] });
    expect((改 as { 自动推进: unknown[] }).自动推进).toHaveLength(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: P.id } })).node).toBe("痛点挖掘");
    expect(await prisma.projectNodeLog.count({ where: { projectId: P.id } })).toBe(0);
  });

  it("客户项目按必填推进 新建的：这一次刚建、指定给了别人的项目照推（建档 / 客户页新建项目 / 线索转化）；别的同事项目照旧不推", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const 丙 = await 人("bing", "SALES", "sales");
    const 丙的 = (name: string) => prisma.project.create({ data: { name, customerId: 客户, ownerId: 丙.id, creatorId: 乙.id, phase: "商机", node: "痛点挖掘", budgetLevel: "预算充足" } });
    const 新 = await 丙的("刚建给丙的");
    const 老 = await 丙的("丙原来的");
    当(乙);
    const 推了 = await 客户项目按必填推进({ id: 乙.id, role: "SALES" }, 客户, { 新建的: 新.id });
    expect(推了.map((x) => x.id)).toEqual([新.id]);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 新.id } })).node).toBe("方案敲定");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 老.id } })).node).toBe("痛点挖掘");
    expect(await 客户项目按必填推进({ id: 乙.id, role: "SALES" }, 客户)).toEqual([]);
  });

  it("「仅上级推」时直属上级代推带 期望在 + 下一步（复审②）：照推，但不采纳上级传的下一步，照旧清掉下属的", async () => {
    await setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 推进权限: "仅上级推" } });
    const 甲 = await 人("jia", "SALES", "sales_mgr");
    await prisma.entMember.update({ where: { userId: 乙.id }, data: { managerId: 甲.id } });
    const p = await prisma.project.create({ data: { name: "代推的", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "痛点挖掘", nextStepText: "乙的下一步" } });
    当(甲);
    const r = await 以谁的身份(甲.id, () => 改项目节点(p.id, { phase: "商机", node: "方案敲定", result: null }, null, { 期望在: { phase: "商机", node: "痛点挖掘", result: null }, 下一步: { 文字: "上级塞的下一步", 时间: 北京日期(3) } }));
    expect(r).toMatchObject({ ok: true, 变了: true });
    const 后 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(后).toMatchObject({ node: "方案敲定", nextStepText: null, nextStepAt: null });
    // 往回退照旧只给负责人：上级代推只有往前这一步
    expect(await 以谁的身份(甲.id, () => 改项目节点(p.id, { phase: "商机", node: "痛点挖掘", result: null }, null, { 期望在: { phase: "商机", node: "方案敲定", result: null }, 下一步: { 文字: "上级塞的下一步", 时间: null } }))).toMatchObject({ ok: false });
  });

  it("标了无效的公海客户、挂到同事留在原处的项目（我是组员，复审①）：照记，不推同事的项目", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const 丙 = await 人("bing", "SALES", "sales");
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 丙.id, poolInvalidAt: new Date() } });
    await prisma.customerPool.create({ data: { customerId: 客户, reason: "手动", userId: 丙.id } });
    const P = await prisma.project.create({ data: { name: "丙留在原处的", customerId: 客户, ownerId: 丙.id, creatorId: 丙.id, phase: "商机", node: "痛点挖掘", budgetLevel: "预算充足" } });
    await prisma.projectMember.create({ data: { projectId: P.id, userId: 乙.id, inviteStatus: "JOINED" } });
    当(乙);
    const r = await 以谁的身份(乙.id, () => saveFollowUp({ customerId: 客户, projectId: P.id, type: "PHONE", title: "", content: "组员电话聊了预算", status: "已完成", occurredAt: new Date().toISOString() }));
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty("自动推进");
    expect(r).not.toHaveProperty("领取了");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: P.id } })).node).toBe("痛点挖掘");
    expect(await prisma.projectNodeLog.count({ where: { projectId: P.id } })).toBe(0);
  });

  it("项目上记沟通：这次刚写的下一步不被这次自动推进清掉；回 推前（推之前的节点和下一步）", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const p = await 画像齐了的项目({ nextStepText: "旧的下一步" });
    const 时 = 北京日期(2);
    const r = await 记项目沟通({ id: 乙.id, role: "SALES" }, p.id, { type: "PHONE", content: "电话聊了预算和排期", occurredAt: new Date().toISOString(), 下一步: "下周报方案", 下一步时间: 时, 阶段: "商机" });
    expect(r).toMatchObject({ ok: true, 自动推到: ["方案敲定"], 推前: { phase: "商机", node: "痛点挖掘", 下一步文字: "下周报方案" } });
    const 后 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(后.node).toBe("方案敲定");
    expect(后.nextStepText).toBe("下周报方案");
    expect(后.nextStepAt).not.toBeNull();
  });

  it("撤销自动推进：回到推之前的节点、带回被清掉的下一步；项目已经被改过就不撤，说一句", async () => {
    await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
    const 旧时 = new Date(Date.now() + 3 * 86400_000);
    const p = await 画像齐了的项目({ nextStepText: "旧的下一步", nextStepAt: 旧时 });
    // 这次没写下一步：推进照旧清掉旧的（旧值记在推进那行备注里），推前 带回旧的
    const r = await 记项目沟通({ id: 乙.id, role: "SALES" }, p.id, { type: "PHONE", content: "电话聊了预算和排期", occurredAt: new Date().toISOString(), 阶段: "商机" });
    expect(r).toMatchObject({ ok: true, 自动推到: ["方案敲定"], 推前: { phase: "商机", node: "痛点挖掘", 下一步文字: "旧的下一步", 下一步时间: 旧时.toISOString() } });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).nextStepText).toBeNull();
    const 前 = (r as { 推前: { phase: string; node: string; 下一步文字: string | null; 下一步时间: string | null } }).推前;
    当(乙);
    // 期望现在在哪对不上（被人改过）：不撤
    const 错 = await 以谁的身份(乙.id, () => 改项目节点(p.id, { phase: 前.phase, node: 前.node, result: null }, null, { 期望在: { phase: "商机", node: "成交推进", result: null }, 下一步: { 文字: 前.下一步文字, 时间: 前.下一步时间 } }));
    expect(错).toMatchObject({ ok: false, error: expect.stringContaining("已经被改过") });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).node).toBe("方案敲定");
    const 撤 = await 以谁的身份(乙.id, () => 改项目节点(p.id, { phase: 前.phase, node: 前.node, result: null }, null, { 期望在: { phase: "商机", node: "方案敲定", result: null }, 下一步: { 文字: 前.下一步文字, 时间: 前.下一步时间 } }));
    expect(撤).toMatchObject({ ok: true, 变了: true });
    const 回 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(回).toMatchObject({ phase: "商机", node: "痛点挖掘", nextStepText: "旧的下一步" });
    expect(回.nextStepAt?.toISOString()).toBe(旧时.toISOString());
  });

  it("完成节点（手动往前推）照旧清下一步；回 原（推之前的节点和下一步），撤销同一写法带回来", async () => {
    const p = await prisma.project.create({ data: { name: "手动推", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "痛点挖掘", nextStepText: "手动前的下一步" } });
    当(乙);
    const r = await 以谁的身份(乙.id, () => 改项目节点(p.id, { phase: "商机", node: "方案敲定", result: null }));
    expect(r).toMatchObject({ ok: true, 变了: true, 原: { phase: "商机", node: "痛点挖掘", result: null, 下一步文字: "手动前的下一步", 下一步时间: null } });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).nextStepText).toBeNull();
    const 撤 = await 以谁的身份(乙.id, () => 改项目节点(p.id, { phase: "商机", node: "痛点挖掘", result: null }, null, { 期望在: { phase: "商机", node: "方案敲定", result: null }, 下一步: { 文字: "手动前的下一步", 时间: null } }));
    expect(撤.ok).toBe(true);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ node: "痛点挖掘", nextStepText: "手动前的下一步" });
  });

  it("项目来源：项目没选、跟客户来源走的，节点必填不再报缺、项目页显示同客户来源；客户也没来源才算缺", async () => {
    await setSetting("orgRules", 开着({ 潜客培育: ["项目来源"] }));
    const 渠道 = await prisma.channel.create({ data: { name: "展会", channelOwnerId: 乙.id } });
    await prisma.customer.update({ where: { id: 客户 }, data: { channelId: 渠道.id } });
    const 跟客户 = await prisma.project.create({ data: { name: "跟客户的", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    const 规 = 开着({ 潜客培育: ["项目来源"] });
    const 差of = async (id: string) => 还差(规, await prisma.$transaction(async (tx) => 读必填数据(tx, (await tx.project.findUniqueOrThrow({ where: { id } })) as never, 规)) as 必填数据);
    expect(await 差of(跟客户.id)).toEqual([]);
    const 详 = await 以谁的身份(乙.id, () => 读项目详情(mocks.user as never, 跟客户.id));
    expect(详.种 === "有" && 详.props.p.项目来源).toEqual({ name: "展会", 跟客户: true });
    expect(详.种 === "有" && 详.props.p.必填?.还差).toEqual([]);
    // 客户也没来源：两边都说没有
    const 客2 = (await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 乙.id } })).id;
    const 空 = await prisma.project.create({ data: { name: "都没有", customerId: 客2, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    expect(await 差of(空.id)).toEqual(["项目来源"]);
    const 详2 = await 以谁的身份(乙.id, () => 读项目详情(mocks.user as never, 空.id));
    expect(详2.种 === "有" && 详2.props.p.项目来源).toBeNull();
    expect(详2.种 === "有" && 详2.props.p.必填?.还差).toEqual(["项目来源"]);
  });

  it("项目来源：看不到客户的组员，项目没选、客户有来源 → 必填算齐，那格写「随客户来源」（只露有无、不露渠道名，11-20 总控判定）", async () => {
    await setSetting("orgRules", 开着({ 潜客培育: ["项目来源"] }));
    const 丙 = await 人("bing", "SALES", "sales");
    const 渠道 = await prisma.channel.create({ data: { name: "特征渠道名X", channelOwnerId: 丙.id } });
    const 丙客 = (await prisma.customer.create({ data: { name: "客户丙", phone: "13800000003", salesOwnerId: 丙.id, channelId: 渠道.id } })).id;
    const p = await prisma.project.create({ data: { name: "乙负责的", customerId: 丙客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    当(乙);
    const 详 = await 以谁的身份(乙.id, () => 读项目详情(mocks.user as never, p.id));
    expect(详.种).toBe("有");
    if (详.种 !== "有") return;
    expect(详.props.p.项目来源).toEqual({ name: "", 跟客户: true });
    expect(详.props.p.必填?.还差 ?? []).toEqual([]);
    const { 渠道们: _选项, ...其余 } = 详.props.p as typeof 详.props.p & { 渠道们?: unknown };
    expect(JSON.stringify(其余)).not.toContain("特征渠道名X");
    expect(JSON.stringify(其余)).not.toContain(渠道.id);
  });
});
