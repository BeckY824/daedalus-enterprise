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
  return { ...m, 完成卡点Action: vi.fn(m.完成卡点Action) };
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
import { 不可撤销, 跨阶段提醒, type 项目卡 } from "@/lib/agent/project-proposals";
import { applyProposal, undoProposal } from "@/app/(app)/dashboard/apply";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import * as 项目动作 from "@/app/(app)/projects/actions";
import * as 卡点动作 from "@/app/(app)/projects/blocker-actions";
import * as 回款动作 from "@/app/(app)/projects/payment-actions";
import * as 联系人动作 from "@/app/(app)/customers/[id]/actions";
import * as 客户动作 from "@/app/(app)/customers/actions";
import { 记回款 as 库记回款 } from "@/lib/project/payment-db";
import { 记项目沟通 } from "@/lib/project/db";
import { 发卡点判断, 能发卡点 } from "@/lib/project/blocker";
import { 本轮点名 } from "@/lib/agent/project-tools";
import { 北京日期 } from "./helpers/beijing-date";

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
async function 出(name: string, args: Record<string, unknown>, me: 人 = 乙, 问题?: string) {
  当(me);
  const c = { ...ctx(me), ...(问题 ? { 问题 } : {}) };
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
  // 11-01 权限只认业务角色：老板也要有总管理（删除只给总管理）
  await prisma.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }] });
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

  it("跨阶段推（线索→商机、商机→订单）卡上带「进了 X 就退不回 Y」；同阶段、定结局不带", async () => {
    const 跨 = await 出("propose_project_node", { project: "云帆一期", 目标: "痛点挖掘", reason: "人说聊到痛点了" });
    expect(跨.卡).toMatchObject({ kind: "project_node", 到: { phase: "商机", node: "痛点挖掘" }, 从阶段: "线索" });
    expect(跨阶段提醒(跨.卡!)).toBe("进了商机就退不回线索");
    const 同 = await 出("propose_project_node", { project: "云帆一期", 目标: "下一步", reason: "往前推" });
    expect(同.卡).toMatchObject({ 到: { phase: "线索" } });
    expect(跨阶段提醒(同.卡!)).toBeNull();
    const 终 = await 出("propose_project_node", { project: "云帆一期", 目标: "终止", 原因: "x", reason: "y" });
    expect(跨阶段提醒(终.卡!)).toBeNull();
    await prisma.project.update({ where: { id: 项目id }, data: { phase: "商机", node: "首款到账" } });
    const 进订单 = await 出("propose_project_node", { project: "云帆一期", 目标: "下一步", reason: "首款到了" });
    expect(进订单.卡).toMatchObject({ 到: { phase: "订单" } });
    expect(跨阶段提醒(进订单.卡!)).toBe("进了订单就退不回商机");
    // 往回（商机 → 线索节点）不算「进了就退不回」
    expect(跨阶段提醒({ ...进订单.卡!, 到: { phase: "线索", node: "潜客培育" } } as 项目卡)).toBeNull();
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
  it("收卡：卡点类型不认得拒；没填下一步算缺（11-05 起不问明确回复）；11-19 没填阻碍原因算缺", () => {
    expect(收("project_followup", { targetId: 项目id, content: "x", 要卡点: true, 卡点类型: "超级卡点" })).toMatchObject({ ok: false });
    const r = 收("project_followup", { targetId: 项目id, targetName: "x", content: "聊了报价", 要卡点: true, 卡点类型: "" });
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["下一步计划", "卡点类型", "阻碍原因"]);
    // 空白不算；一串字符串按顿号拆开、去重
    const 空白 = 收("project_followup", { targetId: 项目id, targetName: "x", content: "聊了", 下一步: "再聊", 要卡点: true, 卡点类型: "轻度卡点", 阻碍原因: ["  ", ""] });
    expect(missingFields((空白 as { proposal: Proposal }).proposal)).toEqual(["阻碍原因"]);
    const 串 = 收("project_followup", { targetId: 项目id, targetName: "x", content: "聊了", 下一步: "再聊", 要卡点: true, 卡点类型: "轻度卡点", 阻碍原因: "需求变更、需求变更、自填一条" });
    expect((串 as { proposal: { 阻碍原因: string[] } }).proposal.阻碍原因).toEqual(["需求变更", "自填一条"]);
    // 不要卡点的沟通卡：不问阻碍原因
    const 不要 = 收("project_followup", { targetId: 项目id, targetName: "x", content: "聊了", 下一步: "再聊" });
    expect(missingFields((不要 as { proposal: Proposal }).proposal)).toEqual([]);
  });

  it("负责人确认：转给 记项目沟通Action（带卡点）；沟通、卡点各一条；同事确认一行不写", async () => {
    const { 卡 } = await 出("propose_blocker_add", { project: "云帆一期", 卡点类型: "中度卡点", 影响等级: "短期不影响", 阻碍原因: ["价格预算分歧"], content: "客户嫌贵", 明确回复: "否", 下一步: "下周再报价", reason: "人说卡在价格" });
    // 卡上带阻碍原因和下拉选项（设置里启用的原因）
    expect(卡).toMatchObject({ kind: "project_followup", 要卡点: true, 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"], 原因可选们: expect.arrayContaining(["价格预算分歧", "其他"]) });
    expect(卡).not.toHaveProperty("卡点描述");

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.entBlocker.count()).toBe(0);

    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(项目动作.记项目沟通Action).toHaveBeenCalledWith(
      项目id,
      expect.objectContaining({ content: "客户嫌贵", 下一步: "下周再报价", 阶段: "线索" }),
      { type: "中度卡点", impact: "短期不影响", reasons: ["价格预算分歧"] },
    );
    expect(await prisma.followUp.count()).toBe(1);
    expect(await prisma.entBlocker.count()).toBe(1);
  });
});

describe("沟通 + 卡点：原因字典、旧卡（11-19）", () => {
  it("出卡时把启用的原因名告诉模型；不在字典里的原因点名说会进待审核；零宽字符清掉", async () => {
    const { r, 卡 } = await 出("propose_blocker_add", { project: "云帆一期", 卡点类型: "轻度卡点", 阻碍原因: ["需求变更\u200b", "自造的原因"], content: "客户要改需求", 下一步: "下周再聊", reason: "人说的" });
    expect(卡).toMatchObject({ 阻碍原因: ["需求变更", "自造的原因"] });
    const note = (r.data as { note: string }).note;
    expect(note).toContain("设置里启用的阻碍原因：");
    expect(note).toContain("需求变更");
    expect(note).toContain("「自造的原因」不在里面");
    expect(note).not.toContain("「需求变更」不在里面");
  });

  it("组员让 AI 加卡点：发不了卡点的项目不出卡（出了也是死路），直接报错指路去只记沟通；几个候选的剔掉发不了的", async () => {
    await prisma.projectMember.create({ data: { projectId: 项目id, userId: 丙.id, inviteStatus: "JOINED" } });
    const { r, 卡 } = await 出("propose_blocker_add", { projectId: 项目id, 卡点类型: "中度卡点", 阻碍原因: ["其他"], content: "丙聊了", 下一步: "再聊", reason: "人说的" }, 丙);
    expect(卡).toBeUndefined();
    expect((r.data as { error: string }).error).toBe("你不能在这个项目上新建卡点，只能记沟通（propose_project_followup）");
    // 只记沟通照样出卡（组员记）
    expect((await 出("propose_project_followup", { projectId: 项目id, content: "丙聊了", reason: "人说的" }, 丙)).卡).toMatchObject({ 组员记: true, 要卡点: false });
    // 两个候选：一个是别人的（丙只是组员）、一个是丙自己的 → 剔掉一期，只剩二期也照候选出、不替人选；返回写明剔掉了哪个
    const 二期 = (await prisma.project.create({ data: { name: "云帆二期", customerId: 客户id, ownerId: 丙.id, creatorId: 丙.id, phase: "线索", node: "潜客培育" } })).id;
    const 两个 = await 出("propose_blocker_add", { project: "云帆", 卡点类型: "中度卡点", 阻碍原因: ["其他"], content: "丙聊了", 下一步: "再聊", reason: "人说的" }, 丙);
    expect(两个.卡).toMatchObject({ targetId: "", 要卡点: true });
    expect(两个.卡!.候选!.map((c) => c.id)).toEqual([二期]);
    expect(两个.卡!.候选![0].补).toMatchObject({ projectId: 二期, 组员记: false });
    const note = (两个.r.data as { note: string }).note;
    expect(note).toContain("另有 1 个项目你不能新建卡点，已去掉：云帆一期");
    expect(note).toContain("卡上列了它让人自己点选");
    // 只找到一个、能发的：照旧直接指向，不列候选
    const 一个 = await 出("propose_blocker_add", { project: "云帆二期", 卡点类型: "中度卡点", 阻碍原因: ["其他"], content: "丙聊了", 下一步: "再聊", reason: "人说的" }, 丙);
    expect(一个.卡).toMatchObject({ targetId: 二期, 要卡点: true });
    expect(一个.卡!.候选 ?? []).toEqual([]);
    expect((一个.r.data as { note: string }).note).not.toContain("已去掉");
  });

  /*
    11-19 3703 实操：客户名和其中一个项目名一样、名下两个项目，「给 X 那个项目加个卡点」模型先查客户、自己挑了「X（2）」出卡，
    卡上又换不了项目。工具层堵住：没点名、名下还有别的能加卡点的项目 → 和模糊名同一条路列候选，不替人选（名字都是虚构的）
  */
  it("客户名和项目名撞、名下两个项目：模型按项目名或自己查来的 id 出卡，照样列候选、确认拦下；人挑了才能确认", async () => {
    const 客 = (await prisma.customer.create({ data: { name: "青禾", phone: "13900000009", salesOwnerId: 乙.id } })).id;
    const 甲项 = (await prisma.project.create({ data: { name: "青禾", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    const 乙项 = (await prisma.project.create({ data: { name: "青禾（2）", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    const 话 = "给青禾那个项目加个卡点，客户预算还没批下来";
    const 参 = { 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"], content: "客户预算还没批下来", 下一步: "下周再问", reason: "人说的" };
    for (const 指 of [{ project: "青禾（2）" }, { projectId: 乙项 }, { projectId: 甲项 }, { project: "青禾" }]) {
      const { r, 卡 } = await 出("propose_blocker_add", { ...指, ...参 }, 乙, 话);
      expect(卡).toMatchObject({ kind: "project_followup", targetId: "", 要卡点: true });
      expect(卡!.候选!.map((c) => c.id).sort()).toEqual([甲项, 乙项].sort());
      expect(missingFields(卡!)).toContain("选哪一个");
      expect((r.data as { note: string }).note).toContain("不要替人选");
      expect(await 确认(卡!, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("选哪一个") });
    }
    expect(项目动作.记项目沟通Action).not.toHaveBeenCalled();
    // 人在卡上挑了「青禾（2）」：补 合进卡里，能确认，卡点发在挑的那个项目上
    const { 卡 } = await 出("propose_blocker_add", { project: "青禾（2）", ...参 }, 乙, 话);
    const c = 卡!.候选!.find((x) => x.id === 乙项)!;
    const 挑了 = { ...卡!, targetId: c.id, targetName: c.名, ...(c.补 ?? {}) } as 项目卡;
    expect(missingFields(挑了)).toEqual([]);
    expect(await 确认(挑了, 乙)).toMatchObject({ ok: true });
    expect(项目动作.记项目沟通Action).toHaveBeenCalledWith(乙项, expect.anything(), expect.objectContaining({ type: "中度卡点" }));
    expect(await prisma.entBlocker.count({ where: { projectId: 乙项 } })).toBe(1);
  });

  it("这一轮人点名了是哪个项目（名字或 id）：直接出卡；名下只有一个项目：照常直接出卡", async () => {
    const 客 = (await prisma.customer.create({ data: { name: "青禾", phone: "13900000009", salesOwnerId: 乙.id } })).id;
    await prisma.project.create({ data: { name: "青禾", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    const 乙项 = (await prisma.project.create({ data: { name: "青禾（2）", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    const 参 = { 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"], content: "预算没批", 下一步: "下周再问", reason: "人说的" };
    // 从候选里挑定（下一轮说了名字 / 带着 id）后模型带 id 来：直接指向，卡上不再列候选
    for (const 话 of ["就加在青禾（2）上", `选 ${乙项}`]) {
      const { r, 卡 } = await 出("propose_blocker_add", { projectId: 乙项, ...参 }, 乙, 话);
      expect(卡).toMatchObject({ targetId: 乙项, 要卡点: true });
      expect(卡!.候选 ?? []).toEqual([]);
      expect(missingFields(卡!)).toEqual([]);
      expect((r.data as { note: string }).note).toContain("卡上换不了");
    }
    // 名下只有一个项目（beforeEach 的云帆科技 · 云帆一期）：按客户名、按项目 id 都直接指向
    for (const 指 of [{ project: "云帆科技" }, { projectId: 项目id }]) {
      const { 卡 } = await 出("propose_blocker_add", { ...指, ...参 }, 乙, "给云帆科技加个卡点");
      expect(卡).toMatchObject({ targetId: 项目id, 要卡点: true });
      expect(卡!.候选 ?? []).toEqual([]);
    }
  });

  it("同名兄弟项目、项目名是客户全称的一截：模型带 projectId 来，人说的名字分不清是哪个 → 照样列候选、确认拦下", async () => {
    const 参 = { 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"], content: "预算没批", 下一步: "下周再问", reason: "人说的" };
    // 同一位客户名下两个都叫「青禾工程」
    const 客1 = (await prisma.customer.create({ data: { name: "青禾", phone: "13900000009", salesOwnerId: 乙.id } })).id;
    const 同1 = (await prisma.project.create({ data: { name: "青禾工程", customerId: 客1, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    const 同2 = (await prisma.project.create({ data: { name: "青禾工程", customerId: 客1, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    // 客户全称「甲方-乙方-丙方」，项目「甲方」是它的一截
    const 客2 = (await prisma.customer.create({ data: { name: "甲方-乙方-丙方", phone: "13900000008", salesOwnerId: 乙.id } })).id;
    const 截 = (await prisma.project.create({ data: { name: "甲方", customerId: 客2, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    const 截2 = (await prisma.project.create({ data: { name: "二期改造", customerId: 客2, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    for (const [id, 话, 该有] of [[同1, "给青禾工程加个卡点", [同1, 同2]], [截, "给甲方-乙方-丙方加个卡点", [截, 截2]]] as const) {
      const { 卡 } = await 出("propose_blocker_add", { projectId: id, ...参 }, 乙, 话);
      expect(卡).toMatchObject({ targetId: "", 要卡点: true });
      expect(卡!.候选!.map((c) => c.id).sort()).toEqual([...该有].sort());
      expect(await 确认(卡!, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("选哪一个") });
    }
    expect(项目动作.记项目沟通Action).not.toHaveBeenCalled();
    // 项目名在客户名之外单独说了：算点名，直接指向
    const { 卡 } = await 出("propose_blocker_add", { projectId: 截, ...参 }, 乙, "甲方-乙方-丙方的甲方那个项目加个卡点");
    expect(卡).toMatchObject({ targetId: 截, 要卡点: true });
  });

  it("本轮点名：名字和客户名撞不算；说「X（2）」时只认 X（2），不认 X；没原话不算", () => {
    const 客 = { name: "青禾", shortName: null };
    const 甲 = { id: "p1", name: "青禾", customer: 客 }, 乙p = { id: "p2", name: "青禾（2）", customer: 客 };
    const 设备 = { id: "p3", name: "设备", customer: { name: "某厂", shortName: null } }, 设备2 = { id: "p4", name: "设备（2）", customer: { name: "某厂", shortName: null } };
    expect(本轮点名(甲, [甲, 乙p], "给青禾那个项目加卡点")).toBe(false);
    expect(本轮点名(乙p, [甲, 乙p], "给青禾那个项目加卡点")).toBe(false);
    expect(本轮点名(乙p, [甲, 乙p], "加在青禾（2）上")).toBe(true);
    expect(本轮点名(设备, [设备, 设备2], "给设备（2）加卡点")).toBe(false);
    expect(本轮点名(设备2, [设备, 设备2], "给设备（2）加卡点")).toBe(true);
    expect(本轮点名(设备, [设备, 设备2], "给某厂的设备加卡点")).toBe(true);
    expect(本轮点名(设备, [设备, 设备2], `就是 p3`)).toBe(true);
    expect(本轮点名(设备, [设备, 设备2], undefined)).toBe(false);
    // 同名兄弟：说了这个名字也分不清
    const 同a = { id: "p5", name: "设备", customer: { name: "某厂", shortName: null } };
    expect(本轮点名(设备, [设备, 同a], "给设备加卡点")).toBe(false);
    // 项目名只是客户全称（或简称）的一截：说客户名不算；项目名比客户名长不误伤
    const 截 = { id: "p6", name: "甲方", customer: { name: "甲方-乙方-丙方", shortName: "甲乙" } };
    expect(本轮点名(截, [截], "给甲方-乙方-丙方加卡点")).toBe(false);
    expect(本轮点名(截, [截], "甲方-乙方-丙方的甲方项目")).toBe(true);
    expect(本轮点名({ id: "p7", name: "甲乙", customer: 截.customer }, [], "给甲乙加卡点")).toBe(false);
    expect(本轮点名({ id: "p8", name: "甲方-乙方-丙方二期", customer: 截.customer }, [], "给甲方-乙方-丙方二期加卡点")).toBe(true);
  });

  it("发卡点判断（读一次权限和组织、每个项目同步判断）和 能发卡点 结果一致", async () => {
    const 二期 = (await prisma.project.create({ data: { name: "云帆二期", customerId: 客户id, ownerId: 丙.id, creatorId: 丙.id, phase: "线索", node: "潜客培育" } })).id;
    const 公海 = (await prisma.project.create({ data: { name: "云帆三期", customerId: 客户id, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育", pooledAt: new Date() } })).id;
    const 项目们 = await prisma.project.findMany({ where: { id: { in: [项目id, 二期, 公海] } }, select: { id: true, ownerId: true, pooledAt: true } });
    const 表 = async (me: 人) => {
      当(me);
      return 以谁的身份(me.id, async () => {
        const 判 = await 发卡点判断(me);
        return Promise.all(项目们.map(async (p) => [p.id, !!判 && 判(p), await 能发卡点(me, p.id)] as const));
      });
    };
    const 全 = [...(await 表(老板)), ...(await 表(乙)), ...(await 表(丙))];
    for (const [, 同步, 查库] of 全) expect(同步).toBe(查库);
    // 不是全 false 糊过去：乙能发一期、丙能发二期，公海的谁都不能
    expect(全.filter(([, x]) => x).length).toBeGreaterThanOrEqual(2);
    expect(全.filter(([id, x]) => id === 公海 && x)).toEqual([]);
  });

  it("模型还传了卡点描述：并进沟通内容（已经写在内容里的不重复）", () => {
    const 有 = 收("project_followup", { targetId: 项目id, targetName: "x", content: "客户嫌贵", 下一步: "再聊", 要卡点: true, 卡点类型: "轻度卡点", 阻碍原因: ["其他"], 卡点描述: "财务卡着" });
    expect((有 as { proposal: { content: string } }).proposal.content).toBe("客户嫌贵\n卡点：财务卡着");
    const 重 = 收("project_followup", { targetId: 项目id, targetName: "x", content: "客户嫌贵，财务卡着", 下一步: "再聊", 要卡点: true, 卡点类型: "轻度卡点", 阻碍原因: ["其他"], 卡点描述: "财务卡着" });
    expect((重 as { proposal: { content: string } }).proposal.content).toBe("客户嫌贵，财务卡着");
  });

  it("老对话里的旧卡带着卡点描述、没有阻碍原因：要人补原因；补了确认时描述接在沟通内容后面，不丢", async () => {
    const { 卡 } = await 出("propose_blocker_add", { project: "云帆一期", 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"], content: "客户嫌贵", 下一步: "下周再报价", reason: "人说的" });
    const 旧 = { ...卡!, 阻碍原因: undefined, 原因可选们: undefined, 卡点描述: "报价比别家高一成" } as unknown as 项目卡;
    expect(missingFields(旧 as Proposal)).toContain("阻碍原因");
    expect(await 确认({ ...旧, 阻碍原因: ["价格预算分歧"] } as Proposal, 乙)).toMatchObject({ ok: true });
    expect(项目动作.记项目沟通Action).toHaveBeenCalledWith(
      项目id,
      expect.objectContaining({ content: "客户嫌贵\n卡点：报价比别家高一成" }),
      { type: "中度卡点", impact: undefined, reasons: ["价格预算分歧"] },
    );
    expect(await prisma.entBlocker.count()).toBe(1);
  });
});

describe("沟通：组员记不改项目下一步（11-19 客户答复）", () => {
  it("组员出的卡不要求下一步、标着组员记；确认后沟通记上，项目下一步不动；负责人的卡照旧要下一步", async () => {
    await prisma.project.update({ where: { id: 项目id }, data: { nextStepText: "乙定的下一步" } });
    await prisma.projectMember.create({ data: { projectId: 项目id, userId: 丙.id, inviteStatus: "JOINED" } });
    const 组员卡 = (await 出("propose_project_followup", { projectId: 项目id, content: "丙打了电话", 下一步: "丙想改", reason: "人说的" }, 丙)).卡;
    expect(组员卡).toMatchObject({ kind: "project_followup", 组员记: true });
    expect(missingFields({ ...组员卡!, 下一步: "" } as Proposal)).toEqual([]);
    expect(await 确认({ ...组员卡!, 下一步: "" } as Proposal, 丙)).toMatchObject({ ok: true });
    expect(await prisma.followUp.count({ where: { ownerId: 丙.id } })).toBe(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).nextStepText).toBe("乙定的下一步");

    const 负责人卡 = (await 出("propose_project_followup", { projectId: 项目id, content: "乙打了电话", reason: "人说的" }, 乙)).卡;
    expect(负责人卡).not.toHaveProperty("组员记");
    expect(missingFields(负责人卡 as Proposal)).toEqual(["下一步计划"]);
  });
});

describe("解决卡点", () => {
  async function 一个处理中的卡点(handler: string) {
    const f = await 记项目沟通({ id: 乙.id, role: "SALES" }, 项目id, { type: "PHONE", content: "聊了", occurredAt: 北京日期(), 阶段: "线索", 明确回复: true });
    return prisma.entBlocker.create({
      data: {
        code: "BLK-20261101-001", title: "报价高", projectId: 项目id, followUpId: f.followUpId!, customerId: 客户id, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格", description: "报价高", dueDays: 3, dueAt: new Date(), creatorId: 乙.id, status: "处理中",
        claims: { create: { userId: handler } },
      },
    });
  }

  it("收卡：没写方案、结果算缺", () => {
    const r = 收("blocker_resolve", { targetId: "b1", targetName: "BLK" });
    expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["解决方案", "解决结果"]);
  });

  it("唯一认领人确认：转给 完成卡点Action（我已完成），变已解决；不是认领人的确认一行不写", async () => {
    const k = await 一个处理中的卡点(乙.id);
    const { 卡 } = await 出("propose_blocker_resolve", { project: "云帆一期", reason: "人说解决了" });
    expect(卡).toMatchObject({ kind: "blocker_resolve", targetId: k.id });
    const 填好 = { ...卡!, solution: "降价 5%", result: "客户接受" } as 项目卡;

    const 拒 = await 确认(填好, 丙);
    expect(拒.ok).toBe(false);
    expect((await prisma.entBlocker.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("处理中");

    const r = await 确认(填好, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(卡点动作.完成卡点Action).toHaveBeenCalledWith(k.id, { note: "客户接受", solution: "降价 5%", result: "客户接受" });
    expect((await prisma.entBlocker.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("已解决");
  });
});

describe("解决卡点：方案 / 结果只有最后一个完成的人必填（11-01 定稿）", () => {
  it("收卡：最后一个 = false 不缺方案 / 结果；缺省按最后一个算", () => {
    const 不是 = 收("blocker_resolve", { targetId: "b1", targetName: "BLK", 最后一个: false });
    expect((不是 as { proposal: Proposal }).proposal).toMatchObject({ 最后一个: false });
    expect(missingFields((不是 as { proposal: Proposal }).proposal)).toEqual([]);
    // 模型乱填 true / 字符串：都不当「不是最后一个」
    for (const v of [true, "false", undefined]) {
      const r = 收("blocker_resolve", { targetId: "b1", targetName: "BLK", 最后一个: v });
      expect(missingFields((r as { proposal: Proposal }).proposal)).toEqual(["解决方案", "解决结果"]);
    }
  });

  it("两人认领：别人没完成时我的卡不要方案、点完成只记说明；别人完成了我的卡就要方案；旧卡被抢先时落库再挡一次", async () => {
    const f = await 记项目沟通({ id: 乙.id, role: "SALES" }, 项目id, { type: "PHONE", content: "聊了", occurredAt: 北京日期(), 阶段: "线索", 明确回复: true });
    const k = await prisma.entBlocker.create({
      data: {
        code: "BLK-20261101-002", title: "交期紧", projectId: 项目id, followUpId: f.followUpId!, customerId: 客户id, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "其他", description: "交期紧", dueDays: 3, dueAt: new Date(), creatorId: 乙.id, status: "处理中",
        claims: { create: [{ userId: 乙.id }, { userId: 丙.id }] },
      },
    });
    const { 卡: 早 } = await 出("propose_blocker_resolve", { project: "云帆一期", result: "催了工厂", reason: "人说他那份做完了" });
    expect(早).toMatchObject({ kind: "blocker_resolve", targetId: k.id, 最后一个: false });
    expect(missingFields(早!)).toEqual([]);

    // 另一位先点了完成：再出卡就是最后一个，方案 / 结果必填
    await prisma.entBlockerClaim.updateMany({ where: { blockerId: k.id, userId: 丙.id }, data: { done: true } });
    const { 卡: 晚 } = await 出("propose_blocker_resolve", { project: "云帆一期", reason: "人说解决了" });
    expect(晚).toMatchObject({ targetId: k.id });
    expect((晚 as { 最后一个?: boolean }).最后一个).not.toBe(false);
    expect(missingFields(晚!)).toEqual(["解决方案", "解决结果"]);

    // 早出的那张卡（当时不是最后一个）现在点确认：完成卡点按当时的人数再挡，不会空着方案就解决
    const 拒 = await 确认(早!, 乙);
    expect(拒.ok).toBe(false);
    expect((await prisma.entBlocker.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("处理中");
    expect(await prisma.entBlockerClaim.findFirstOrThrow({ where: { blockerId: k.id, userId: 乙.id } })).toMatchObject({ done: false });

    expect(await 确认({ ...晚!, solution: "换了备选工厂", result: "按期交付" } as 项目卡, 乙)).toMatchObject({ ok: true });
    expect(await prisma.entBlocker.findUniqueOrThrow({ where: { id: k.id } })).toMatchObject({ status: "已解决", solution: "换了备选工厂", result: "按期交付" });
  });

  it("不是最后一个：点完成只写自己的处理说明，卡点还在处理中", async () => {
    const f = await 记项目沟通({ id: 乙.id, role: "SALES" }, 项目id, { type: "PHONE", content: "聊了", occurredAt: 北京日期(), 阶段: "线索", 明确回复: true });
    const k = await prisma.entBlocker.create({
      data: {
        code: "BLK-20261101-003", title: "样品没到", projectId: 项目id, followUpId: f.followUpId!, customerId: 客户id, phase: "线索", type: "轻度卡点", impact: "短期不影响", obstacle: "其他", description: "样品没到", dueDays: 3, dueAt: new Date(), creatorId: 乙.id, status: "处理中",
        claims: { create: [{ userId: 乙.id }, { userId: 丙.id }] },
      },
    });
    const { 卡 } = await 出("propose_blocker_resolve", { project: "云帆一期", reason: "人说他那份做完了" });
    expect(卡).toMatchObject({ targetId: k.id, 最后一个: false });
    expect(await 确认({ ...卡!, result: "已寄出" } as 项目卡, 乙)).toMatchObject({ ok: true });
    expect(await prisma.entBlockerClaim.findFirstOrThrow({ where: { blockerId: k.id, userId: 乙.id } })).toMatchObject({ done: true, note: "已寄出" });
    expect(await prisma.entBlocker.findUniqueOrThrow({ where: { id: k.id } })).toMatchObject({ status: "处理中", solution: null, result: null });
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
    // 删了不能恢复：卡上先写日期、金额，项目名放后面（窄屏截也只截项目名；「删除」那格折行，11-20 审查）
    expect(卡!.targetName).toBe("2026-10-20 CNY 800 · 云帆一期");

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(await prisma.entProjectPayment.count()).toBe(1);

    expect(await 确认(卡!, 乙)).toMatchObject({ ok: true });
    expect(回款动作.删回款).toHaveBeenCalledWith(笔.id);
    expect(await prisma.entProjectPayment.count()).toBe(0);
  });

  it("按金额字串找要删的那笔（审查 11-20）：「0.08万」按万算；「800元」只找人民币那笔，「US$800」不拿同数目的人民币那笔", async () => {
    const 人民币 = await 库记回款({ id: 乙.id, role: "SALES" }, 项目id, { paidAt: "2026-10-20", currency: "CNY", amount: 800 });
    const 美元 = await 库记回款({ id: 乙.id, role: "SALES" }, 项目id, { paidAt: "2026-10-21", currency: "USD", amount: 800 });
    await 库记回款({ id: 乙.id, role: "SALES" }, 项目id, { paidAt: "2026-10-22", currency: "CNY", amount: 8000 });
    const { 卡: 两笔 } = await 出("propose_payment_delete", { project: "云帆一期", amount: "0.08万", reason: "人说记错了" });
    expect(两笔).toMatchObject({ kind: "payment_delete", targetId: "" });
    expect(两笔?.候选?.map((x) => x.id).sort()).toEqual([人民币.id, 美元.id].sort());
    const { 卡: 元 } = await 出("propose_payment_delete", { project: "云帆一期", amount: "800元", reason: "人说记错了" });
    expect(元).toMatchObject({ kind: "payment_delete", targetId: 人民币.id });
    const { 卡: 刀 } = await 出("propose_payment_delete", { project: "云帆一期", amount: "US$800", reason: "人说记错了" });
    expect(刀).toMatchObject({ kind: "payment_delete", targetId: 美元.id });
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

  it("负责人初判无效：转给 线索初判Action；创建人是销售，初判即终判记无效线索；不归他判的人确认一行不写", async () => {
    const { 卡 } = await 出("propose_lead_verify", { project: "云帆一期", 判: "无效", 无效原因: "联系方式无效", 说明: "打了三次", reason: "人说是空号" });
    expect(卡).toMatchObject({ kind: "lead_verify", targetId: 项目id, 步: "初判", 判: "无效" });

    const 拒 = await 确认(卡!, 丙);
    expect(拒.ok).toBe(false);
    expect(await prisma.entLeadVerify.count()).toBe(0);

    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(项目动作.线索初判Action).toHaveBeenLastCalledWith(项目id, "无效", expect.objectContaining({ invalidReason: "联系方式无效", verifyNote: "打了三次" }));
    expect(await prisma.entLeadVerify.findUnique({ where: { projectId: 项目id } })).toMatchObject({ verdict: "无效线索" });
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

  it("销管确认改下属客户的联系人：看得到但不能改，saveContact 拒、一行不写（11-18 审核 P0-1）", async () => {
    const 经 = await 造人("jing", "经理", "SALES");
    await prisma.entMember.create({ data: { userId: 经.id, bizRole: "sales_mgr" } });
    await prisma.entMember.update({ where: { userId: 乙.id }, data: { managerId: 经.id } });
    const 人 = await prisma.contact.create({ data: { name: "王经理", position: "采购", phone: "13700000001", customerId: 客户id } });
    const { 卡 } = await 出("propose_contact_update", { contact: "王经理", 改: [{ field: "position", value: "采购总监" }], reason: "人说升职了" });
    expect(卡).toMatchObject({ kind: "contact_update", targetId: 人.id });

    expect(await 确认(卡!, 经)).toMatchObject({ ok: false });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: 人.id } })).position).toBe("采购");
    expect(await prisma.auditLog.count({ where: { action: "ai_apply" } })).toBe(0);
  });
});

describe("删客户", () => {
  it("卡上写「删除」和名字，不可撤销", async () => {
    const { r, 卡 } = await 出("propose_customer_delete", { customer: "云帆科技", reason: "人说是重复的" });
    expect(r.summary).toContain("删除客户「云帆科技」");
    expect(卡).toMatchObject({ kind: "customer_delete", targetId: 客户id });
    expect(不可撤销("customer_delete")).toBe(true);
  });

  it("负责人本人确认：转给 deleteCustomers，进回收站；看不到的同事确认一行不删", async () => {
    const { 卡 } = await 出("propose_customer_delete", { customer: "云帆科技", reason: "人说是重复的" });

    expect((await 确认(卡!, 丙)).ok).toBe(false);
    expect(客户动作.deleteCustomers).not.toHaveBeenCalled();
    expect(await prisma.customer.count()).toBe(1);

    // V3.5.1：删除给负责人本人或系统管理员
    const r = await 确认(卡!, 乙);
    expect(r).toMatchObject({ ok: true });
    expect(客户动作.deleteCustomers).toHaveBeenCalledWith([客户id]);
    expect(await prisma.customer.count()).toBe(0);
  });
});

/*
  11-20：首页 AI 记沟通卡（propose_project_followup）补上 #374 那层保护；两张卡的候选只列在推项目（P-沟通-03）；
  模型看到的候选和卡上的是同一份（工具返回里带候选清单，回答只许提这几个）。名字都是虚构的
*/
describe("记沟通卡：多个在推项目列候选、只列在推的、回话只提卡上的（11-20）", () => {
  const 沟通参 = { content: "电话聊了排期", 下一步: "下周再报价", reason: "人说的" };
  async function 一客两项() {
    const 客 = (await prisma.customer.create({ data: { name: "青禾", phone: "13900000009", salesOwnerId: 乙.id } })).id;
    const 甲项 = (await prisma.project.create({ data: { name: "青禾", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    const 乙项 = (await prisma.project.create({ data: { name: "青禾（2）", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    return { 客, 甲项, 乙项 };
  }

  it("客户名下两个在推项目、没点名：模型按项目名或 id 出记沟通卡，照样列候选、确认拦下；挑了才能确认", async () => {
    const { 甲项, 乙项 } = await 一客两项();
    const 话 = "给青禾记一下，电话聊了排期";
    for (const 指 of [{ project: "青禾（2）" }, { projectId: 乙项 }, { projectId: 甲项 }, { project: "青禾" }]) {
      const { r, 卡 } = await 出("propose_project_followup", { ...指, ...沟通参 }, 乙, 话);
      expect(卡).toMatchObject({ kind: "project_followup", targetId: "", 要卡点: false });
      expect(卡!.候选!.map((c) => c.id).sort()).toEqual([甲项, 乙项].sort());
      expect(missingFields(卡!)).toContain("选哪一个");
      expect((r.data as { note: string }).note).toContain("不要替人选");
      expect(await 确认(卡!, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("选哪一个") });
    }
    expect(项目动作.记项目沟通Action).not.toHaveBeenCalled();
    const { 卡 } = await 出("propose_project_followup", { project: "青禾（2）", ...沟通参 }, 乙, 话);
    const c = 卡!.候选!.find((x) => x.id === 乙项)!;
    const 挑了 = { ...卡!, targetId: c.id, targetName: c.名, ...(c.补 ?? {}) } as 项目卡;
    expect(missingFields(挑了)).toEqual([]);
    expect(await 确认(挑了, 乙)).toMatchObject({ ok: true });
    expect(项目动作.记项目沟通Action).toHaveBeenCalledWith(乙项, expect.anything(), undefined);
  });

  it("点名了是哪个项目、或名下只有一个在推项目：直接出卡，不列候选", async () => {
    const { 乙项 } = await 一客两项();
    const { 卡 } = await 出("propose_project_followup", { projectId: 乙项, ...沟通参 }, 乙, "记在青禾（2）上");
    expect(卡).toMatchObject({ targetId: 乙项 });
    expect(卡!.候选 ?? []).toEqual([]);
    const 一个 = await 出("propose_project_followup", { project: "云帆科技", ...沟通参 }, 乙, "给云帆科技记一下");
    expect(一个.卡).toMatchObject({ targetId: 项目id });
    expect(一个.卡!.候选 ?? []).toEqual([]);
  });

  it("兄弟项目只算我能记的在推项目：已结束、在公海、进了回收站、我记不了（同事负责、我没进组）的不进候选", async () => {
    const { 客, 甲项 } = await 一客两项();
    // 把（2）结掉（丢单；交付结清的 11-25 起能记售后回访、进候选，见下一条）；另加一个公海里的、一个丙负责的
    await prisma.project.updateMany({ where: { customerId: 客, name: "青禾（2）" }, data: { result: "线索流失" } });
    await prisma.project.create({ data: { name: "青禾（公海）", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育", pooledAt: new Date() } });
    await prisma.project.create({ data: { name: "青禾（丙的）", customerId: 客, ownerId: 丙.id, creatorId: 丙.id, phase: "线索", node: "潜客培育" } });
    // 进了回收站的（软删）也不算
    await prisma.project.create({ data: { name: "青禾（删了）", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育", deletedAt: new Date() } });
    const { 卡 } = await 出("propose_project_followup", { projectId: 甲项, ...沟通参 }, 乙, "给青禾记一下");
    expect(卡).toMatchObject({ targetId: 甲项 });
    expect(卡!.候选 ?? []).toEqual([]);
  });

  it("候选只列在推项目：已交付结清（更近改过）不排在前面；加卡点卡不列它，记沟通卡把它列成售后回访（11-25）", async () => {
    const 客 = (await prisma.customer.create({ data: { name: "远山", phone: "13900000019", salesOwnerId: 乙.id } })).id;
    const 推1 = (await prisma.project.create({ data: { name: "远山一期", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    const 推2 = (await prisma.project.create({ data: { name: "远山二期", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "痛点挖掘" } })).id;
    // 最后改的是已结束那个（updatedAt 最新），原来按 updatedAt 排它在最前
    await prisma.project.create({ data: { name: "远山三期", customerId: 客, ownerId: 乙.id, creatorId: 乙.id, phase: "订单", node: "尾款结算", result: "交付结清" } });
    for (const 工具 of ["propose_project_followup", "propose_blocker_add"]) {
      const 参 = 工具 === "propose_blocker_add" ? { ...沟通参, 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"] } : 沟通参;
      const { r, 卡 } = await 出(工具, { project: "远山", ...参 }, 乙);
      // 记沟通卡：交付结清的「远山三期」我能记售后回访（项目负责人、客户不在公海），进候选、排在在推的后面也行，候选上明写 售后回访
      const 售后 = 工具 === "propose_project_followup";
      const 名们 = 售后 ? ["远山一期", "远山三期", "远山二期"] : ["远山一期", "远山二期"];
      expect(卡!.候选!.map((c) => c.名).sort()).toEqual(名们);
      if (!售后) expect(卡!.候选!.map((c) => c.id).sort()).toEqual([推1, 推2].sort());
      else expect(Object.fromEntries(卡!.候选!.map((c) => [c.名, (c.补 as { 售后回访?: boolean }).售后回访]))).toEqual({ 远山一期: false, 远山二期: false, 远山三期: true });
      // 回话和卡对得上：返回里就是卡上那一份候选，并说只能提这几个
      const d = r.data as { note: string; 候选清单: string[] };
      expect(d.候选清单.map((x) => x.split("（")[0]).sort()).toEqual(名们);
      expect(d.note).toContain(`卡上的候选只有这 ${名们.length} 个`);
      expect(d.note).toContain("别的一概不提");
      if (!售后) expect(d.note).not.toContain("远山三期");
    }
    // 直接点名交付结清的：加卡点卡照旧说已结束；记沟通卡出一张售后回访卡（锁着标记、不要下一步）
    const 结 = await 出("propose_blocker_add", { project: "远山三期", ...沟通参, 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"] }, 乙);
    expect(结.卡).toBeUndefined();
    expect((结.r.data as { error: string }).error).toBe("项目「远山三期」已结束或在公海，沟通只能记在还在推进的项目上（没结局、不在公海）；交付结清的不能加卡点，只能记售后回访（propose_project_followup）");
    const 访 = await 出("propose_project_followup", { project: "远山三期", ...沟通参 }, 乙, "给远山三期记一条售后回访");
    expect(访.卡).toMatchObject({ 售后回访: true });
    expect(missingFields({ ...(访.卡 as Extract<项目卡, { kind: "project_followup" }>), 下一步: "" })).toEqual([]);
  });

  it("只指向一个：返回里说回答只提它这一个", async () => {
    const { r } = await 出("propose_project_followup", { project: "云帆一期", ...沟通参 }, 乙);
    expect((r.data as { note: string }).note).toContain("回答里只说「云帆一期」这一个");
  });

  it("精确名字对上的项目都已结束：直接说已结束，不落到「包含」去模糊匹配别的在推项目（11-20 审查）", async () => {
    // 远山：已结束（丢单）的「远山三期」和在推的「远山三期扩建」同一位客户（交付结清的 11-25 起记沟通卡认成售后回访，见上一条）
    const 远 = (await prisma.customer.create({ data: { name: "远山", phone: "13900000029", salesOwnerId: 乙.id } })).id;
    await prisma.project.create({ data: { name: "远山三期", customerId: 远, ownerId: 乙.id, creatorId: 乙.id, phase: "订单", node: "尾款结算", result: "丢单" } });
    const 扩建 = (await prisma.project.create({ data: { name: "远山三期扩建", customerId: 远, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } })).id;
    // 华东：名下全已结束；另一位客户「华东展具」有在推项目
    const 华 = (await prisma.customer.create({ data: { name: "华东", phone: "13900000039", salesOwnerId: 乙.id } })).id;
    await prisma.project.create({ data: { name: "华东一期", customerId: 华, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育", result: "线索流失" } });
    const 展 = (await prisma.customer.create({ data: { name: "华东展具", phone: "13900000049", salesOwnerId: 乙.id } })).id;
    await prisma.project.create({ data: { name: "展具采购", customerId: 展, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    for (const 工具 of ["propose_project_followup", "propose_blocker_add"]) {
      const 参 = 工具 === "propose_blocker_add" ? { ...沟通参, 卡点类型: "中度卡点", 阻碍原因: ["价格预算分歧"] } : 沟通参;
      const 三期 = await 出(工具, { project: "远山三期", ...参 }, 乙, "给远山三期记一条沟通");
      expect(三期.卡).toBeUndefined();
      // 记沟通（企业版）补半句交付结清的可以记售后回访（11-25 复审 S4）；加卡点不说
      const 尾 = 工具 === "propose_project_followup" ? "；交付结清的可以记售后回访" : "";
      expect((三期.r.data as { error: string }).error).toBe(`项目「远山三期」已结束或在公海，沟通只能记在还在推进的项目上（没结局、不在公海）${尾}`);
      const 华东 = await 出(工具, { project: "华东", ...参 }, 乙, "给华东记一条沟通");
      expect(华东.卡).toBeUndefined();
      expect((华东.r.data as { error: string }).error).toBe(`项目「华东一期」已结束或在公海，沟通只能记在还在推进的项目上（没结局、不在公海）${尾}`);
    }
    // 精确一个都没对上，才去「包含」找（只找在推的）
    const 包含 = await 出("propose_project_followup", { project: "三期扩", ...沟通参 }, 乙, "给三期扩建记一条");
    expect(包含.卡).toMatchObject({ targetId: 扩建 });
  });

  it("名字直接对上的主候选也要我能记沟通（同兄弟项目一个口径）：上级看得到下属的项目，但记不了，不出卡 / 不进候选", async () => {
    const 经 = await 造人("jing", "经理", "SALES");
    await prisma.entMember.create({ data: { userId: 经.id, bizRole: "sales_mgr" } });
    await prisma.entMember.update({ where: { userId: 乙.id }, data: { managerId: 经.id } });
    // 只对上乙的项目：经理记不了，直接说
    const 单 = await 出("propose_project_followup", { project: "云帆一期", ...沟通参 }, 经);
    expect(单.卡).toBeUndefined();
    expect((单.r.data as { error: string }).error).toContain("只有项目负责人或项目组员能把沟通记到这个项目上");
    // 同名对上两个：乙的、经理自己的 → 只留经理自己的
    const 客 = (await prisma.customer.create({ data: { name: "松石", phone: "13900000059", salesOwnerId: 经.id } })).id;
    const 自己 = (await prisma.project.create({ data: { name: "松石改造", customerId: 客, ownerId: 经.id, creatorId: 经.id, phase: "线索", node: "潜客培育" } })).id;
    await prisma.project.create({ data: { name: "松石改造", customerId: 客户id, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    const 两 = await 出("propose_project_followup", { project: "松石改造", ...沟通参 }, 经);
    const ids = 两.卡!.targetId ? [两.卡!.targetId] : 两.卡!.候选!.map((c) => c.id);
    expect(ids).toEqual([自己]);
  });
});
