/**
 * 企业版沟通方式（10-31，dict-kinds.ts followMethod + lib/follow-method.ts + dict.ts 定沟通方式 / 认跟进方式）。
 * 钉的是：默认 19 种；选方式定 type（对不上的记 OTHER）；没带方式按 type 补；改旧记录没带方式、type 没变留原方式；
 * 停用的、不在字典里的不认；任务提醒没有方式；记项目沟通和客户页记跟进都把方式存进 FollowUp.method；开关关着不管方式。
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

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 企业字典, 改字典项, 定沟通方式, 认跟进方式 } from "@/lib/enterprise/dict";
import { 方式对类型, 类型对方式, 对得上的方式, 跟进方式名 } from "@/lib/follow-method";
import { 记项目沟通Action } from "@/app/(app)/projects/actions";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";

let 老板: string, 销售: string, 客户: string, 项目: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 沟通 = (x: Record<string, unknown> = {}) => ({ type: "PHONE", content: "聊了报价", occurredAt: "2026-10-20 10:00", 阶段: "线索", 明确回复: true, 下一步: "周五前发报价单", ...x });
const 最新 = () => prisma.followUp.findFirst({ orderBy: { createdAt: "desc" }, select: { type: true, method: true } });

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
  客户 = (await prisma.customer.create({ data: { name: "示例客户", phone: "13800000001", salesOwnerId: 销售 } })).id;
  项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "示例项目", phase: "线索", node: "潜客培育" } })).id;
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("纯函数", () => {
  it("方式 ↔ 类型；对不上的记 OTHER；任务提醒没有方式；显示有方式叫方式", () => {
    expect(方式对类型("微信沟通")).toBe("WECHAT");
    expect(方式对类型("客户来访")).toBe("VISIT");
    expect(方式对类型("Telegram")).toBe("OTHER");
    expect(类型对方式("EMAIL")).toBe("邮件沟通");
    expect(类型对方式("OTHER")).toBe("其他方式");
    expect(类型对方式("TASK")).toBeNull();
    expect(对得上的方式("WECHAT", "微信沟通")).toBe("微信沟通");
    expect(对得上的方式("PHONE", "微信沟通")).toBeUndefined();
    expect(跟进方式名({ type: "OTHER", method: "Telegram" })).toBe("Telegram");
    expect(跟进方式名({ type: "PHONE" })).toBe("电话沟通");
  });
});

describe("字典与校验", () => {
  it("默认 19 种，「其他方式」在里面", async () => {
    const 项 = await 企业字典("followMethod");
    expect(项).toHaveLength(19);
    expect(项.map((x) => x.name)).toContain("其他方式");
  });

  it("定沟通方式：选的定 type、没带按 type 补、改旧的留原方式、不认的拦、任务没有方式", async () => {
    expect(await 定沟通方式("Telegram", "PHONE")).toEqual({ ok: true, method: "Telegram", type: "OTHER" });
    expect(await 定沟通方式(" 微信沟通 ", "PHONE")).toEqual({ ok: true, method: "微信沟通", type: "WECHAT" });
    expect(await 定沟通方式(undefined, "EMAIL")).toEqual({ ok: true, method: "邮件沟通", type: "EMAIL" });
    expect(await 定沟通方式(null, "OTHER", "Telegram")).toEqual({ ok: true, method: "Telegram", type: "OTHER" });
    expect(await 定沟通方式(null, "PHONE", "Telegram")).toEqual({ ok: true, method: "手机通话", type: "PHONE" });
    expect(await 定沟通方式("飞鸽传书", "PHONE")).toMatchObject({ ok: false, error: expect.stringContaining("不在") });
    expect(await 定沟通方式("微信沟通", "TASK")).toEqual({ ok: true, method: null, type: "TASK" });
  });

  it("停用的方式新记不认；旧记录原来就是它的照留", async () => {
    const t = (await 企业字典("followMethod")).find((x) => x.name === "Telegram")!;
    当(老板, "ADMIN");
    expect(await 改字典项({ id: 老板, role: "ADMIN" }, t.id, { active: false })).toMatchObject({ ok: true });
    expect(await 定沟通方式("Telegram", "OTHER")).toMatchObject({ ok: false });
    expect(await 定沟通方式("Telegram", "OTHER", "Telegram")).toEqual({ ok: true, method: "Telegram", type: "OTHER" });
  });

  it("认跟进方式：不认的回 error；开关关着原样回去", async () => {
    expect(await 认跟进方式({ type: "PHONE", method: "飞鸽传书" })).toMatchObject({ error: expect.stringContaining("不在") });
    expect(await 认跟进方式({ type: "PHONE", method: "LinkedIn" })).toEqual({ type: "OTHER", method: "LinkedIn" });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 认跟进方式({ type: "PHONE", method: "飞鸽传书" })).toEqual({ type: "PHONE", method: "飞鸽传书" });
  });
});

describe("存进库", () => {
  it("项目上记沟通：方式存 method、type 跟着方式走；没带方式按 type 补", async () => {
    expect(await 记项目沟通Action(项目, 沟通({ method: "WhatsApp" }))).toMatchObject({ ok: true });
    expect(await 最新()).toEqual({ type: "WHATSAPP", method: "WhatsApp" });
    expect(await 记项目沟通Action(项目, 沟通({ type: "EMAIL" }))).toMatchObject({ ok: true });
    expect(await 最新()).toEqual({ type: "EMAIL", method: "邮件沟通" });
    expect(await 记项目沟通Action(项目, 沟通({ method: "飞鸽传书" }))).toMatchObject({ ok: false });
  });

  it("客户页记跟进：方式存 method；改的时候没带方式、type 没变不冲掉", async () => {
    const base = { customerId: 客户, type: "PHONE", content: "打了个电话", status: "已完成", occurredAt: new Date().toISOString() };
    expect(await saveFollowUp({ ...base, method: "展会面聊" })).toMatchObject({ ok: true });
    const f = (await prisma.followUp.findFirst({ orderBy: { createdAt: "desc" } }))!;
    expect({ type: f.type, method: f.method }).toEqual({ type: "OTHER", method: "展会面聊" });
    expect(await saveFollowUp({ ...base, id: f.id, type: "OTHER", content: "改了内容" })).toMatchObject({ ok: true });
    expect(await prisma.followUp.findUnique({ where: { id: f.id }, select: { method: true, content: true } })).toEqual({ method: "展会面聊", content: "改了内容" });
  });
});
