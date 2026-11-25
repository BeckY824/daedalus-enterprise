/**
 * 守卫（跳转优化 PR-B 审查 11-25）：客户页上这几处保存后界面不再 router.refresh，靠动作自己 revalidatePath 把这页重新渲染好带回来。
 * 哪个成功分支哪天漏了 revalidatePath，界面就停在旧值上（不报错，只是像没存上），所以逐个钉住：
 *   patchCustomer 各成功分支（外贸档案那几格、普通格、负责人直接换、渠道负责人、日期、电话；企业版的全称、简称）、
 *   patchCustomerRegion、三态的 3 个动作、saveFollowUp 存成了。
 * 企业版主路径：记项目沟通Action、saveTask、savePlan、completePlan 成功后也各钉一条（11-25 复审补）。
 * 没改动的那几支（值和原来一样）不写库也不 revalidate，界面本来就是对的，不在这里钉。
 * 例外：负责人走交接那一支直接回、没 revalidate 客户详情，界面（InlineField）按 交接中 / 交接已在路上 自己 refresh。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const m = vi.hoisted(() => ({
  revalidatePath: vi.fn((..._: unknown[]) => {}),
  user: { id: "", name: "甲", email: "jia", role: "ADMIN", title: "管理员", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => m.user, requireAdmin: async () => m.user }));
// 企业版主路径（记项目沟通Action）要项目模式开着
vi.mock("@/lib/business", async (原) => {
  const b = await 原<typeof import("@/lib/business")>();
  return { ...b, getBusiness: async () => ({ ...(await b.getBusiness()), projectMode: true }) };
});
vi.mock("@/lib/enterprise/tri-state-hold", async (原) => ({
  ...(await 原<object>()),
  继续持有: async () => ({ ok: true, 剩次数: 1 }),
  暂缓回收动作: async () => ({ ok: true }),
  让同事结束项目动作: async () => ({ ok: true, 通知了: 1 }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { patchCustomer, patchCustomerRegion, type PatchableKey } from "@/app/(app)/customers/actions";
import { saveFollowUp, saveTask, savePlan, completePlan } from "@/app/(app)/customers/[id]/actions";
import { 记项目沟通Action } from "@/app/(app)/projects/actions";
import { 三态继续持有, 三态暂缓回收, 三态让同事结束项目 } from "@/app/(app)/customers/tri-state-actions";

let 客户: string;
let 乙: string;
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  const 甲 = await prisma.user.create({ data: { email: "jia", name: "甲", title: "销售", role: "ADMIN", password: "x" } });
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "销售", role: "SALES", password: "x" } })).id;
  m.user = { id: 甲.id, name: "甲", email: "jia", role: "ADMIN", title: "管理员", avatar: null };
  客户 = (await prisma.customer.create({ data: { name: "守卫客户", phone: "13800001111", salesOwnerId: 甲.id } })).id;
  m.revalidatePath.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});
/** 企业版：甲要有业务角色（销售）才改得了客户 */
async function 开企业版() {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.entMember.create({ data: { userId: m.user.id, bizRole: "sales" } });
  忘掉企业版范围();
}

const 刷了详情 = () => expect(m.revalidatePath.mock.calls.map((c) => c[0])).toContain(`/customers/${客户}`);

describe("patchCustomer 成功分支都 revalidatePath 这位客户", () => {
  const 格们: [PatchableKey, () => string | null][] = [
    ["remark", () => "新备注"],
    ["school", () => "某中学"],
    ["followStatus", () => "跟进中"],
    ["decisionStatus", () => "对比中"],
    ["expectedSignAt", () => "2026-12-01"],
    ["phone", () => "13900002222"],
    ["salesOwnerId", () => 乙],
    ["channelOwnerId", () => 乙],
    ["country", () => "美国"],
    ["email", () => "a@b.com"],
  ];
  it.each(格们.map(([k, v]) => [k, v] as const))("%s", async (k, v) => {
    const r = await patchCustomer(客户, k, v());
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    刷了详情();
  });

  it("企业版：全称、简称", async () => {
    await 开企业版();
    for (const [k, v] of [["name", "守卫客户改名"], ["shortName", "守卫"]] as const) {
      m.revalidatePath.mockClear();
      const r = await patchCustomer(客户, k, v);
      expect(r, `${k}: ${JSON.stringify(r)}`).toMatchObject({ ok: true });
      刷了详情();
    }
  });
});

it("patchCustomerRegion（企业版）存成了 revalidatePath 这位客户", async () => {
  await 开企业版();
  const r = await patchCustomerRegion(客户, { addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市", addrDistrict: null });
  expect(r, JSON.stringify(r)).toEqual({ ok: true });
  刷了详情();
});

it.each([
  ["三态继续持有", () => 三态继续持有(客户, "还在谈")],
  ["三态暂缓回收", () => 三态暂缓回收(客户, null)],
  ["三态让同事结束项目", () => 三态让同事结束项目(客户)],
] as const)("%s 成了 revalidatePath 这位客户", async (_, 做) => {
  expect(await 做()).toMatchObject({ ok: true });
  刷了详情();
});

it("saveFollowUp 存成了 revalidatePath 这位客户（新记、改）", async () => {
  const r = await saveFollowUp({ customerId: 客户, type: "PHONE", title: null, content: "聊了预算", status: "已完成", occurredAt: new Date().toISOString() });
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  刷了详情();
  m.revalidatePath.mockClear();
  const f = await prisma.followUp.findFirstOrThrow({ where: { customerId: 客户 } });
  const 改 = await saveFollowUp({ id: f.id, customerId: 客户, type: "PHONE", title: null, content: "改过的", status: "已完成", occurredAt: f.occurredAt.toISOString() });
  expect(改, JSON.stringify(改)).toMatchObject({ ok: true });
  刷了详情();
});

describe("企业版主路径（项目上记沟通、待办、计划）成功后 revalidatePath 这位客户", () => {
  it("记项目沟通Action", async () => {
    await 开企业版();
    const 项目 = await prisma.project.create({ data: { customerId: 客户, ownerId: m.user.id, creatorId: m.user.id, name: "守卫项目", phase: "线索", node: "潜客培育" } });
    m.revalidatePath.mockClear();
    const r = await 记项目沟通Action(项目.id, { type: "PHONE", content: "聊了预算", occurredAt: "2026-10-20 10:00", 阶段: "线索", 下一步: "周五前发报价单" });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    刷了详情();
  });

  it("saveTask（新建、改）", async () => {
    await 开企业版();
    const r = await saveTask({ customerId: 客户, title: "发资料" });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    刷了详情();
    m.revalidatePath.mockClear();
    const t = await prisma.task.findFirstOrThrow({ where: { customerId: 客户 } });
    const 改 = await saveTask({ id: t.id, customerId: 客户, title: "改过的待办" });
    expect(改, JSON.stringify(改)).toMatchObject({ ok: true });
    刷了详情();
  });

  it("savePlan（新建、改）", async () => {
    await 开企业版();
    const 约 = new Date(Date.now() + 86400000).toISOString();
    const r = await savePlan({ customerId: 客户, subject: "回访", plannedAt: 约, method: "PHONE" });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    刷了详情();
    m.revalidatePath.mockClear();
    const p = await prisma.followPlan.findFirstOrThrow({ where: { customerId: 客户 } });
    const 改 = await savePlan({ id: p.id, customerId: 客户, subject: "改过的回访", plannedAt: 约, method: "PHONE" });
    expect(改, JSON.stringify(改)).toMatchObject({ ok: true });
    刷了详情();
  });

  it("completePlan（完成、撤销）", async () => {
    await 开企业版();
    const p = await prisma.followPlan.create({ data: { customerId: 客户, subject: "回访", plannedAt: new Date(Date.now() + 86400000), method: "PHONE", ownerId: m.user.id } });
    m.revalidatePath.mockClear();
    expect(await completePlan(p.id)).toMatchObject({ ok: true });
    刷了详情();
    m.revalidatePath.mockClear();
    expect(await completePlan(p.id, false)).toMatchObject({ ok: true });
    刷了详情();
  });
});
