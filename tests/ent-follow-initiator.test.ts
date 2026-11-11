/**
 * 企业版发起主体（11-01 客户答复 #2，dict-kinds.ts followInitiator + dict.ts 定发起主体 / 认跟进方式）。
 * 钉的是：默认 4 项；新记没带补「我方发起」；不在字典的、停用的不认；改旧记录没带留原值、和原来一样的停用了也能存；
 * 任务提醒没有发起主体；记项目沟通和客户页记跟进都存进 FollowUp.initiator；开关关着不写这一列。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 企业字典, 改字典项, 定发起主体 } from "@/lib/enterprise/dict";
import { 记项目沟通Action } from "@/app/(app)/projects/actions";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";

let 老板: string, 销售: string, 客户: string, 项目: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 沟通 = (x: Record<string, unknown> = {}) => ({ type: "PHONE", content: "聊了报价", occurredAt: "2026-10-20 10:00", 阶段: "线索", 明确回复: true, 下一步: "周五前发报价单", ...x });
const 最新 = () => prisma.followUp.findFirst({ orderBy: { createdAt: "desc" }, select: { type: true, initiator: true } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 人 = async (email: string, name: string, role = "SALES", bizRole?: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  // 11-01 权限只认业务角色：老板 = 总管理（改字典、改沟通都只认 director）
  老板 = await 人("boss", "老板", "ADMIN", "director");
  // M-权限-09 原口径（11-09）：改沟通只给身为负责人的管理，这里的负责人用销售管理
  销售 = await 人("s1", "小王", "SALES", "sales_mgr");
  客户 = (await prisma.customer.create({ data: { name: "示例客户", phone: "13800000001", salesOwnerId: 销售 } })).id;
  项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "示例项目", phase: "线索", node: "潜客培育" } })).id;
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("字典与校验", () => {
  it("默认 4 项", async () => {
    expect((await 企业字典("followInitiator")).map((x) => x.name)).toEqual(["双方约定", "我方发起", "客户发起", "内部会议"]);
  });

  it("定发起主体：新记没带补默认、改旧的没带不动、不认的拦、任务提醒没有", async () => {
    expect(await 定发起主体(undefined, "PHONE")).toEqual({ ok: true, initiator: "我方发起" });
    expect(await 定发起主体(" 客户发起 ", "PHONE")).toEqual({ ok: true, initiator: "客户发起" });
    expect(await 定发起主体(null, "PHONE", { 有: true, 值: "双方约定" })).toEqual({ ok: true });
    expect(await 定发起主体("对方老板", "PHONE")).toMatchObject({ ok: false, error: expect.stringContaining("不在") });
    expect(await 定发起主体("我方发起", "TASK")).toEqual({ ok: true, initiator: null });
    expect(await 定发起主体("我方发起", "REMIND")).toEqual({ ok: true, initiator: null });
  });

  it("停用的新记不认；旧记录原来就是它的照留；开关关着不管", async () => {
    const t = (await 企业字典("followInitiator")).find((x) => x.name === "内部会议")!;
    当(老板, "ADMIN");
    expect(await 改字典项({ id: 老板, role: "ADMIN" }, t.id, { active: false })).toMatchObject({ ok: true });
    expect(await 定发起主体("内部会议", "PHONE")).toMatchObject({ ok: false });
    expect(await 定发起主体("内部会议", "PHONE", { 有: true, 值: "内部会议" })).toEqual({ ok: true, initiator: "内部会议" });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 定发起主体("对方老板", "PHONE")).toEqual({ ok: true });
  });
});

describe("存进库", () => {
  it("项目上记沟通：选的存进去、没带存「我方发起」、不认的拦", async () => {
    expect(await 记项目沟通Action(项目, 沟通({ initiator: "客户发起" }))).toMatchObject({ ok: true });
    expect((await 最新())?.initiator).toBe("客户发起");
    expect(await 记项目沟通Action(项目, 沟通())).toMatchObject({ ok: true });
    expect((await 最新())?.initiator).toBe("我方发起");
    expect(await 记项目沟通Action(项目, 沟通({ initiator: "对方老板" }))).toMatchObject({ ok: false });
  });

  it("客户页记跟进：存 initiator；改的时候没带不冲掉；任务没有发起主体", async () => {
    const base = { customerId: 客户, type: "PHONE", content: "打了个电话", status: "已完成", occurredAt: new Date().toISOString() };
    expect(await saveFollowUp({ ...base, initiator: "双方约定" })).toMatchObject({ ok: true });
    const f = (await prisma.followUp.findFirst({ orderBy: { createdAt: "desc" } }))!;
    expect(f.initiator).toBe("双方约定");
    // 11-02 改沟通是负责人的事：销售自己改
    expect(await saveFollowUp({ ...base, id: f.id, content: "改了内容" })).toMatchObject({ ok: true });
    expect(await prisma.followUp.findUnique({ where: { id: f.id }, select: { initiator: true, content: true } })).toEqual({ initiator: "双方约定", content: "改了内容" });
    expect(await saveFollowUp({ ...base, type: "TASK", content: "周五回访", initiator: "我方发起" })).toMatchObject({ ok: true });
    expect((await 最新())?.initiator).toBeNull();
  });

  it("不是企业版：不写这一列", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const base = { customerId: 客户, type: "PHONE", content: "打了个电话", status: "已完成", occurredAt: new Date().toISOString() };
    expect(await saveFollowUp({ ...base, initiator: "客户发起" })).toMatchObject({ ok: true });
    expect((await 最新())?.initiator).toBeNull();
  });
});
