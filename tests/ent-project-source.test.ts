/**
 * 企业版项目来源与项目字段（10-29 P6）：
 *   - 渠道统计按项目来源算，项目没填的退回客户来源（lib/enterprise/channel-stats.ts 项目算哪个渠道）
 *   - 建档向导：项目来源默认 = 客户来源，可以换；停用的渠道拦下
 *   - 编辑项目：能换、能清；停用的拦下；不是企业版不收这一格
 *   - 已立项天数、按预计成交排、AI 草稿 → 记一条沟通的预填
 *   - AI 解析只出草稿、不写库；项目模式关着时建档向导照旧拦下、什么都不建
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
  开: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 项目算哪个渠道 } from "@/lib/enterprise/channel-stats";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import { 项目来源默认 } from "@/lib/project/wizard";
import { 改项目 } from "@/lib/project/db";
import { 读项目列表 } from "@/lib/project/list";
import { 已立项天数, 按预计成交排, 项目沟通预填 } from "@/lib/project/project-fields";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { parseFollowUpDraft } from "@/app/(app)/customers/[id]/ai";
import type { FollowUpDraft } from "@/lib/ai-draft";

let 甲: string;
let 抖音: string;
let 小红: string;
let 停了: string;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  delete process.env.LLM_API_KEY;
  await resetDb();
  invalidateSettingsCache();
  mocks.开 = true;
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  mocks.user = { ...mocks.user, id: 甲, role: "ADMIN" };
  抖音 = (await prisma.channel.create({ data: { name: "渠道一", channelOwnerId: 甲 } })).id;
  小红 = (await prisma.channel.create({ data: { name: "渠道二", channelOwnerId: 甲 } })).id;
  停了 = (await prisma.channel.create({ data: { name: "停了的", channelOwnerId: 甲, active: false } })).id;
});
afterEach(() => { vi.unstubAllEnvs(); });

const 我 = () => ({ id: 甲, name: "甲", role: "ADMIN" });
async function 客户(channelId: string | null, phone = "13800000001") {
  return (await prisma.customer.create({ data: { name: `客户${phone}`, phone, salesOwnerId: 甲, channelId } })).id;
}
async function 项目(customerId: string, 补: Record<string, unknown> = {}) {
  return prisma.project.create({ data: { name: "一号项目", customerId, ownerId: 甲, creatorId: 甲, ...补 } });
}
const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

describe("统计规则：项目来源优先，退回客户来源", () => {
  it("项目算哪个渠道", () => {
    expect(项目算哪个渠道("项目的", "客户的")).toBe("项目的");
    expect(项目算哪个渠道(null, "客户的")).toBe("客户的");
    expect(项目算哪个渠道(null, null)).toBeNull();
    expect(项目算哪个渠道("", "客户的")).toBe("客户的");
  });

  it("读渠道统计：项目选了别的渠道就算到那边，没选的跟客户来源", async () => {
    const c = await 客户(抖音);
    await 项目(c, { phase: "订单", amount: 1000, currency: "CNY" }); // 没填 → 渠道一
    await 项目(c, { phase: "线索", channelId: 小红 }); // 填了 → 渠道二，不再算到渠道一
    await 项目(await 客户(null, "13800000002"), { phase: "线索", channelId: 抖音 }); // 客户没来源、项目有 → 渠道一
    const 今 = new Date("2026-10-29T12:00:00");
    const 统 = await 读渠道统计([抖音, 小红].map((id) => ({ id, createdAt: new Date("2026-10-01T00:00:00"), endDate: null })), 今);
    expect(统[抖音]).toMatchObject({ 关联项目: 2, 关联订单: 1, 关联线索: 1, 累计成交: [{ 币种: "CNY", 合计: 1000 }] });
    expect(统[小红]).toMatchObject({ 关联项目: 1, 关联线索: 1, 关联订单: 0 });
  });
});

describe("建档向导：项目来源", () => {
  function 输入(项目渠道?: string | null): 建档向导输入 {
    return {
      客户: {
        name: "向导客户", phone: "13900000001", school: null, grade: null, major: null,
        followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
        salesOwnerId: 甲, channelId: 抖音, referrerCustomerId: null,
      },
      联系人: { name: "王经理", position: "采购", phone: "13900000002" },
      项目: { name: "一期", amount: 0, currency: "CNY", ownerId: 甲, ...(项目渠道 !== undefined ? { channelId: 项目渠道 } : {}) },
      跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    } as 建档向导输入;
  }
  const 来源of = async (r: Awaited<ReturnType<typeof 建档向导>>) => (r.ok ? (await 现(r.projectId)).channelId : `没建成：${r.error}`);

  it("默认 = 客户来源；项目选了别的就存别的", async () => {
    expect(项目来源默认(undefined, "客户的")).toBe("客户的");
    expect(项目来源默认("  ", "客户的")).toBe("客户的");
    expect(项目来源默认("项目的", "客户的")).toBe("项目的");
    expect(await 来源of(await 建档向导(输入()))).toBe(抖音);
    await prisma.customer.deleteMany();
    expect(await 来源of(await 建档向导(输入(小红)))).toBe(小红);
  });

  it("项目来源选了停用的渠道：拦下、一行不写", async () => {
    const r = await 建档向导(输入(停了));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("项目来源") });
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
  });

  it("项目模式关着：照旧拦下，什么都不建", async () => {
    mocks.开 = false;
    expect(await 建档向导(输入(小红))).toMatchObject({ ok: false, error: expect.stringContaining("项目模式没开") });
    expect(await prisma.project.count()).toBe(0);
  });
});

describe("编辑项目：项目来源", () => {
  it("能换、能清；停用的拦下；不传不动", async () => {
    const p = await 项目(await 客户(抖音));
    expect(await 改项目(我(), p.id, { name: "一号项目", amount: 0, channelId: 小红 })).toMatchObject({ ok: true });
    expect((await 现(p.id)).channelId).toBe(小红);
    expect(await 改项目(我(), p.id, { name: "一号项目", amount: 0 })).toMatchObject({ ok: true });
    expect((await 现(p.id)).channelId).toBe(小红);
    expect(await 改项目(我(), p.id, { name: "一号项目", amount: 0, channelId: 停了 })).toMatchObject({ ok: false, error: expect.stringContaining("项目来源") });
    expect((await 现(p.id)).channelId).toBe(小红);
    expect(await 改项目(我(), p.id, { name: "一号项目", amount: 0, channelId: null })).toMatchObject({ ok: true });
    expect((await 现(p.id)).channelId).toBeNull();
  });

  it("老项目原来的来源后来停用了：不换来源照样能存别的", async () => {
    const p = await 项目(await 客户(抖音), { channelId: 停了 });
    expect(await 改项目(我(), p.id, { name: "改个名", amount: 0, channelId: 停了 })).toMatchObject({ ok: true });
    expect(await 现(p.id)).toMatchObject({ name: "改个名", channelId: 停了 });
    // 编辑框的渠道清单带上这个停用的（不然选择框里显示不出名字）
    expect((await 可选渠道们(停了)).map((c) => c.id)).toContain(停了);
    expect((await 可选渠道们()).map((c) => c.id)).not.toContain(停了);
  });

  it("不是企业版：不收这一格", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const p = await 项目(await 客户(抖音));
    expect(await 改项目(我(), p.id, { name: "一号项目", amount: 0, channelId: 小红 })).toMatchObject({ ok: true });
    expect((await 现(p.id)).channelId).toBeNull();
  });
});

describe("项目列表的企业版字段", () => {
  it("企业版带预计成交、已立项、项目来源（项目没填跟客户）；不是企业版不带", async () => {
    const c = await 客户(抖音);
    await 项目(c, { name: "跟客户", expectedDealAt: new Date("2026-12-01T00:00:00") });
    await 项目(c, { name: "自己的", channelId: 小红 });
    const { 行 } = await 读项目列表(我(), {});
    const 按名 = new Map(行.map((r) => [r.name, r]));
    expect(按名.get("跟客户")).toMatchObject({ expectedDealAt: "2026-12-01", 已立项天数: 0, 项目来源: "渠道一" });
    expect(按名.get("自己的")).toMatchObject({ expectedDealAt: null, 项目来源: "渠道二" });

    vi.stubEnv("CRM_ENTERPRISE", "");
    const 团队版 = await 读项目列表(我(), {});
    for (const r of 团队版.行) {
      expect(r).not.toHaveProperty("项目来源");
      expect(r).not.toHaveProperty("expectedDealAt");
      expect(r).not.toHaveProperty("已立项天数");
    }
  });
});

describe("小算法", () => {
  it("已立项天数：按自然日，当天 = 0，时钟在前也不出负数", () => {
    expect(已立项天数(new Date("2026-10-29T23:50:00"), new Date("2026-10-29T08:00:00"))).toBe(0);
    expect(已立项天数(new Date("2026-10-28T23:50:00"), new Date("2026-10-29T00:10:00"))).toBe(1);
    expect(已立项天数(new Date("2026-09-29T10:00:00"), new Date("2026-10-29T09:00:00"))).toBe(30);
    expect(已立项天数(new Date("2026-10-30T10:00:00"), new Date("2026-10-29T09:00:00"))).toBe(0);
  });

  it("按预计成交排：早的在前，没填的升序降序都在最后", () => {
    const 日 = ["2026-12-01", null, "2026-11-01", undefined, "2027-01-01"];
    expect([...日].sort((a, b) => 按预计成交排(a, b))).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", null, undefined]);
    // antd 降序 = 比较结果整个取反
    const 降 = [...日].sort((a, b) => -按预计成交排(a, b, true));
    expect(降.slice(0, 3)).toEqual(["2027-01-01", "2026-12-01", "2026-11-01"]);
    expect(降.slice(3).every((x) => !x)).toBe(true);
  });

  it("AI 草稿 → 记一条沟通的预填：类型认得才填、将来的沟通时间不填、过去的下一步不填", () => {
    const 现在 = new Date("2026-10-29T15:00:00");
    const 稿 = (补: Partial<FollowUpDraft["followUp"]> = {}, 外: Partial<FollowUpDraft> = {}): FollowUpDraft => ({
      followUp: { type: "PHONE", title: "电话", content: "聊了交期", status: "", durationMinutes: null, occurredAt: "2026-10-29T10:30:00", contactId: null, opportunityId: null, ...补 },
      tasks: [], plan: null, followStatusSuggestion: null, decisionStatusSuggestion: null, ...外,
    });
    expect(项目沟通预填(稿({}, { plan: { subject: "再聊报价", plannedAt: "2026-11-04T10:00:00", method: "PHONE" } }), ["PHONE", "WECHAT"], 现在))
      .toEqual({ type: "PHONE", content: "聊了交期", occurredAt: "2026-10-29 10:30", 下一步: "再聊报价", 下一步时间: "2026-11-04" });
    expect(项目沟通预填(稿({ type: "TASK", content: "", occurredAt: "2026-10-30T10:00:00" }, { tasks: [{ title: "回电", dueAt: "2026-10-01T00:00:00" }] }), ["PHONE"], 现在))
      .toEqual({ content: "电话", 下一步: "回电" });
    expect(项目沟通预填(稿({ occurredAt: null }, { tasks: [{ title: "x", dueAt: null }, { title: "回电", dueAt: "2026-10-29T18:00:00" }] }), ["PHONE"], 现在))
      .toEqual({ type: "PHONE", content: "聊了交期", 下一步: "回电", 下一步时间: "2026-10-29" });
  });

  it("AI 解析只出草稿：没配模型给一句「未启用」，不写任何沟通", async () => {
    const c = await 客户(抖音);
    const 前 = await prisma.followUp.count();
    const r = await parseFollowUpDraft({ customerId: c, text: "刚和王经理通了电话，下周三再聊报价" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("未启用");
    expect(await prisma.followUp.count()).toBe(前);
  });
});
