/**
 * 项目详情里一条沟通的「…」→ 修改 / 删除，和项目「下一步」= 自己写的一句话 + 可选时间（10-29，projects/actions.ts、lib/project/wizard.ts）。
 * 钉的是：改只动方式 / 时间 / 内容，别的格子原样；版本对不上不盖；删是软删、进回收站、能撤销也能在回收站恢复；
 * 不挂在这个项目上的、同事的客户改不了删不了；AI 记的沟通点撤销也是软删；下一步文字必填、限 100 字、时间可空。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 记项目沟通Action, 改项目沟通, 删项目沟通, 撤销删项目沟通 } from "@/app/(app)/projects/actions";
import { 回收站列表, 恢复 } from "@/lib/enterprise/soft-delete";
import { 规整沟通, 要下一步文字 } from "@/lib/project/wizard";
import { undoProposal } from "@/app/(app)/dashboard/apply";
import { 版本冲突 } from "@/lib/edit-version";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";

let 老板: string, 销售: string, 同事: string, 客户: string, 项目: string, 别的项目: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 沟通 = (x: Record<string, unknown> = {}) => ({ type: "PHONE", content: "电话聊了报价", occurredAt: "2026-10-20 10:00", 阶段: "线索", 明确回复: true, 下一步: "周五前发报价单", ...x });
const 最新沟通 = async (projectId: string) =>
  (await prisma.followUpProject.findFirst({ where: { projectId }, orderBy: { followUp: { createdAt: "desc" } }, select: { followUpId: true } }))!.followUpId;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 人 = async (email: string, name: string, role = "SALES", bizRole?: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 人("boss", "老板", "ADMIN");
  销售 = await 人("s1", "小王", "SALES", "sales");
  同事 = await 人("s2", "小李", "SALES", "sales");
  客户 = (await prisma.customer.create({ data: { name: "示例客户", phone: "13800000001", salesOwnerId: 销售 } })).id;
  项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "示例项目", phase: "线索", node: "潜客培育" } })).id;
  别的项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "另一个项目", phase: "线索", node: "潜客培育" } })).id;
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("下一步：自己写一句话，时间可空", () => {
  it("规整沟通：要下一步文字时空的挡、超 100 字挡、去掉首尾空白", () => {
    const 基 = { type: "PHONE", content: "聊了", occurredAt: "2026-10-20 10:00" };
    expect(规整沟通({ ...基 }, { 要下一步: false, 要下一步文字: true })).toEqual({ error: 要下一步文字 });
    expect(规整沟通({ ...基, 下一步: "   " }, { 要下一步: false, 要下一步文字: true })).toEqual({ error: 要下一步文字 });
    expect(规整沟通({ ...基, 下一步: "字".repeat(101) }, { 要下一步: false, 要下一步文字: true })).toMatchObject({ error: expect.stringContaining("100") });
    expect(规整沟通({ ...基, 下一步: "  回电  " }, { 要下一步: false, 要下一步文字: true })).toMatchObject({ nextStepText: "回电", nextStepAt: null });
    // 老入口（向导、线索转化、AI 卡）不要求文字
    expect(规整沟通({ ...基 }, { 要下一步: false })).not.toHaveProperty("error");
  });

  it("项目上记一条：不写下一步做什么存不了；只写文字不填时间能存，项目上留文字、时间空", async () => {
    expect(await 记项目沟通Action(项目, 沟通({ 下一步: "" }))).toEqual({ ok: false, error: 要下一步文字 });
    expect(await prisma.followUpProject.count({ where: { projectId: 项目 } })).toBe(0);
    expect(await 记项目沟通Action(项目, 沟通())).toMatchObject({ ok: true });
    expect(await prisma.project.findUnique({ where: { id: 项目 }, select: { nextStepText: true, nextStepAt: true } })).toEqual({ nextStepText: "周五前发报价单", nextStepAt: null });
  });

  it("文字 + 时间一起存；下一条只写文字，时间跟着清掉（整体换成这一条的）", async () => {
    expect(await 记项目沟通Action(项目, 沟通({ 下一步时间: "2026-11-06" }))).toMatchObject({ ok: true });
    const 一 = await prisma.project.findUnique({ where: { id: 项目 }, select: { nextStepText: true, nextStepAt: true } });
    expect(一!.nextStepText).toBe("周五前发报价单");
    expect(一!.nextStepAt).not.toBeNull();
    expect(await 记项目沟通Action(项目, 沟通({ 下一步: "等对方回复" }))).toMatchObject({ ok: true });
    expect(await prisma.project.findUnique({ where: { id: 项目 }, select: { nextStepText: true, nextStepAt: true } })).toEqual({ nextStepText: "等对方回复", nextStepAt: null });
  });
});

describe("改项目上的一条沟通", () => {
  it("改方式 / 时间 / 内容；标题、状态这些原样；拿旧版本再改报冲突、不盖", async () => {
    await 记项目沟通Action(项目, 沟通());
    const id = await 最新沟通(项目);
    const 前 = (await prisma.followUp.findUnique({ where: { id } }))!;
    expect(await 改项目沟通(项目, id, { type: "WECHAT", content: "改成微信聊的", occurredAt: "2026-10-19 09:30", 版本: 前.updatedAt.toISOString() })).toEqual({ ok: true });
    const 后 = (await prisma.followUp.findUnique({ where: { id } }))!;
    expect(后).toMatchObject({ type: "WECHAT", content: "改成微信聊的", title: 前.title, status: 前.status, customerId: 客户, ownerId: 前.ownerId });
    expect(后.occurredAt.getTime()).not.toBe(前.occurredAt.getTime());
    // 还挂在原项目上
    expect(await prisma.followUpProject.findUnique({ where: { followUpId: id }, select: { projectId: true } })).toEqual({ projectId: 项目 });
    // 拿改之前的版本再交一次：别人已经改过了，不盖
    expect(await 改项目沟通(项目, id, { type: "PHONE", content: "旧页面上的改动", occurredAt: "2026-10-19 09:30", 版本: 前.updatedAt.toISOString() })).toEqual({ ok: false, error: 版本冲突 });
    expect((await prisma.followUp.findUnique({ where: { id } }))!.content).toBe("改成微信聊的");
  });

  it("不挂在这个项目上的、同事的客户：改不了也删不了", async () => {
    await 记项目沟通Action(项目, 沟通());
    const id = await 最新沟通(项目);
    expect(await 改项目沟通(别的项目, id, { type: "PHONE", content: "x", occurredAt: "2026-10-19 09:30" })).toMatchObject({ ok: false, error: expect.stringContaining("不在这个项目上") });
    expect(await 删项目沟通(别的项目, id)).toMatchObject({ ok: false, error: expect.stringContaining("不在这个项目上") });
    // 同事：企业版「按组织看客户」开着时看不到这位客户，也就碰不到这条
    await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
    忘掉企业版范围();
    当(同事);
    expect(await 以谁的身份(同事, () => 改项目沟通(项目, id, { type: "PHONE", content: "同事改", occurredAt: "2026-10-19 09:30" }))).toMatchObject({ ok: false });
    expect(await 以谁的身份(同事, () => 删项目沟通(项目, id))).toMatchObject({ ok: false });
    当(销售);
    expect(await prisma.followUp.findUnique({ where: { id }, select: { content: true } })).toEqual({ content: "电话聊了报价" });
  });
});

describe("删项目上的一条沟通：软删进回收站", () => {
  it("删了项目上看不到、行还在；提示条上撤销能拿回来", async () => {
    await 记项目沟通Action(项目, 沟通());
    const id = await 最新沟通(项目);
    const r = await 删项目沟通(项目, id);
    expect(r).toMatchObject({ ok: true, 快照: { id, customerId: 客户 } });
    expect(await prisma.followUp.findUnique({ where: { id } })).toBeNull();
    const 项目页 = await prisma.project.findUnique({ where: { id: 项目 }, select: { followUps: { select: { followUpId: true } } } });
    expect(项目页!.followUps).toEqual([]);
    const 行 = await raw.followUp.findUnique({ where: { id }, select: { deletedAt: true } });
    expect(行?.deletedAt).toBeInstanceOf(Date);

    if (!r.ok) throw new Error(r.error);
    expect(await 撤销删项目沟通(项目, r.快照)).toEqual({ ok: true });
    expect(await prisma.followUp.findUnique({ where: { id }, select: { id: true } })).toEqual({ id });
    expect((await prisma.project.findUnique({ where: { id: 项目 }, select: { followUps: { select: { followUpId: true } } } }))!.followUps).toEqual([{ followUpId: id }]);
  });

  it("老板在回收站里看得到这一条，恢复后回到项目上", async () => {
    await 记项目沟通Action(项目, 沟通());
    const id = await 最新沟通(项目);
    expect(await 删项目沟通(项目, id)).toMatchObject({ ok: true });
    const 我 = { id: 老板, role: "ADMIN" };
    const 列 = await 回收站列表(我);
    expect(列.map((x) => x.id)).toContain(id);
    expect(await 恢复(我, "FollowUp", id)).toMatchObject({ ok: true });
    expect((await prisma.project.findUnique({ where: { id: 项目 }, select: { followUps: { select: { followUpId: true } } } }))!.followUps).toEqual([{ followUpId: id }]);
  });
});

describe("AI 记的沟通点撤销", () => {
  it("企业版也是软删：项目 / 客户上看不到，回收站里还在", async () => {
    const f = await prisma.followUp.create({ data: { customerId: 客户, ownerId: 销售, type: "PHONE", title: "", content: "AI 记的", status: "已完成", occurredAt: new Date() } });
    expect(await undoProposal({ kind: "add_followup", id: f.id, customerId: 客户 } as never)).toMatchObject({ ok: true });
    expect(await prisma.followUp.findUnique({ where: { id: f.id } })).toBeNull();
    expect((await raw.followUp.findUnique({ where: { id: f.id }, select: { deletedAt: true } }))?.deletedAt).toBeInstanceOf(Date);
    expect((await 回收站列表({ id: 老板, role: "ADMIN" })).map((x) => x.id)).toContain(f.id);
  });
});
