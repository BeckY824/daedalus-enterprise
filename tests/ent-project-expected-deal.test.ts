/**
 * 企业版预计成交日期从客户挪到项目（2026-10-27，lib/project/expected-deal.ts + 改项目）。
 *   - 老数据回填：客户名下只有一个进行中项目才搬；好几个不猜；项目上已有的不盖；只做一次
 *   - 项目上能填、能清、格式不对拦下；填了能触发节点必填「预计成交日期」自动推进
 *   - 不是企业版：回填不跑，改项目不收这一格
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改项目 } from "@/lib/project/db";
import { 回填预计成交, 回填记号键, 忘掉回填 } from "@/lib/project/expected-deal";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { getSetting, setSetting, invalidateSettingsCache } from "@/lib/settings";

let 乙: { id: string; role: string };

async function 客户(name: string, expectedSignAt: Date | null) {
  return (await prisma.customer.create({ data: { name, phone: "", salesOwnerId: 乙.id, expectedSignAt } })).id;
}
async function 项目(customerId: string, 补: Record<string, unknown> = {}) {
  return prisma.project.create({ data: { name: "一号项目", customerId, ownerId: 乙.id, creatorId: 乙.id, ...补 } });
}
const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
const 签 = new Date("2026-12-01T00:00:00");

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉回填();
  const u = await prisma.user.create({ data: { email: "yi", name: "yi", title: "", role: "SALES", password: "x" } });
  乙 = { id: u.id, role: "SALES" };
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("老数据回填", () => {
  it("只有一个进行中项目的搬过去；好几个不猜；有结局的不算；已填的不盖；做完记号、第二遍不动", async () => {
    const 单 = await 项目(await 客户("一个", 签));
    const 甲 = await 客户("两个", 签);
    const [两一, 两二] = [await 项目(甲), await 项目(甲)];
    const 丙 = await 客户("一开一关", 签);
    const 开 = await 项目(丙);
    const 关 = await 项目(丙, { result: "丢单", closedAt: new Date() });
    const 已填 = await 项目(await 客户("已填", 签), { expectedDealAt: new Date("2027-01-05T00:00:00") });
    const 没签 = await 项目(await 客户("没填", null));

    expect(await 回填预计成交()).toBe(2);
    expect((await 现(单.id)).expectedDealAt).toEqual(签);
    expect((await 现(开.id)).expectedDealAt).toEqual(签);
    for (const p of [两一, 两二, 关, 没签]) expect((await 现(p.id)).expectedDealAt).toBeNull();
    expect((await 现(已填.id)).expectedDealAt).toEqual(new Date("2027-01-05T00:00:00"));
    expect(await getSetting(回填记号键)).toBe(true);

    // 记号在：之后新来的老数据不再搬（只做一次）
    const 后来 = await 项目(await 客户("后来", 签));
    expect(await 回填预计成交()).toBe(0);
    expect((await 现(后来.id)).expectedDealAt).toBeNull();
    // 客户上的预计签约不动
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 甲 } })).expectedSignAt).toEqual(签);
  });

  it("不是企业版：不搬、不记号", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const 单 = await 项目(await 客户("一个", 签));
    expect(await 回填预计成交()).toBe(0);
    expect((await 现(单.id)).expectedDealAt).toBeNull();
    expect(await getSetting(回填记号键)).toBeFalsy();
  });
});

describe("项目上填预计成交日期", () => {
  it("填、改、清都记；格式不对拦下不存", async () => {
    const p = await 项目(await 客户("甲", null));
    expect(await 改项目(乙, p.id, { name: "一号项目", amount: 0, expectedDealAt: "2026-11-20" })).toMatchObject({ ok: true });
    expect((await 现(p.id)).expectedDealAt).toEqual(new Date("2026-11-20T00:00:00"));
    expect(await 改项目(乙, p.id, { name: "一号项目", amount: 0, expectedDealAt: "下个月吧" })).toMatchObject({ ok: false, error: expect.stringContaining("预计成交日期") });
    expect((await 现(p.id)).expectedDealAt).toEqual(new Date("2026-11-20T00:00:00"));
    // 不带这一格 = 不动
    await 改项目(乙, p.id, { name: "一号项目", amount: 5 });
    expect((await 现(p.id)).expectedDealAt).toEqual(new Date("2026-11-20T00:00:00"));
    await 改项目(乙, p.id, { name: "一号项目", amount: 5, expectedDealAt: "" });
    expect((await 现(p.id)).expectedDealAt).toBeNull();
  });

  it("节点必填配了预计成交日期：在项目上填了就自动推", async () => {
    await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { 潜客培育: ["预计成交日期"] } } });
    // 客户上填了预计签约不算（10-27 起读项目）
    const p = await 项目(await 客户("甲", 签));
    const 半 = await 改项目(乙, p.id, { name: "一号项目", amount: 0 });
    expect(半).not.toHaveProperty("自动推到");
    expect(await 改项目(乙, p.id, { name: "一号项目", amount: 0, expectedDealAt: "2026-11-20" })).toMatchObject({ ok: true, 自动推到: ["线索验证"] });
  });

  it("不是企业版：改项目不收这一格", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const p = await 项目(await 客户("甲", null));
    expect(await 改项目(乙, p.id, { name: "一号项目", amount: 0, expectedDealAt: "2026-11-20" })).toMatchObject({ ok: true });
    expect((await 现(p.id)).expectedDealAt).toBeNull();
  });
});
