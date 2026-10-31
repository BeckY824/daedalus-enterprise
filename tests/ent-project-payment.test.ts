/**
 * 企业版项目回款（2026-10-31，迁移 100）。
 *
 * 钉的是：
 *   - 一笔要有回款时间、币种、金额（> 0，不超上限），金额留两位小数；不对回一句人话、一行不写
 *   - 当前回款按币种加，不换汇；金额大的币种排前
 *   - 负责人能记、能删；同事（不是负责人）记、删都拦；公海里的先领取；项目删了不让记
 *   - 字段权限「商机金额」锁了：记、删都拦
 *   - 节点必填配了「回款」：记了第一笔就自动推；删了不往回退
 *   - 节点必填配了「合同附件」：传了合同才推，传别的附件不推
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 金额锁了: false }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/enterprise/field-perm", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/field-perm")>();
  return { ...m, 字段权限of: async () => (名: string) => (mocks.金额锁了 && 名 === "商机金额" ? "看" : "改") };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 规整回款, 当前回款, 记回款, 删回款, 列回款, 合同附件后推进, 单笔上限 } from "@/lib/project/payment-db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";

let 乙: { id: string; role: string }, 丙: { id: string; role: string }, 项目id: string;
const 一笔 = { paidAt: "2026-10-31", currency: "USD", amount: 1000 };
const 节点 = async () => (await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).node;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.金额锁了 = false;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  const 人 = async (email: string) => ({ id: (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id, role: "SALES" });
  乙 = await 人("pay-yi");
  丙 = await 人("pay-bing");
  const 客户id = (await prisma.customer.create({ data: { name: "QA-回款客户", phone: "", salesOwnerId: 乙.id } })).id;
  项目id = (await prisma.project.create({ data: { name: "QA-回款项目", customerId: 客户id, ownerId: 乙.id, creatorId: 乙.id } })).id;
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("规整一笔", () => {
  it("时间、币种、金额都要对；金额留两位", () => {
    expect(规整回款(一笔)).toMatchObject({ currency: "USD", amount: 1000 });
    expect(规整回款({ ...一笔, amount: 12.345 })).toMatchObject({ amount: 12.35 });
    expect(规整回款({ ...一笔, paidAt: "" })).toEqual({ error: "回款时间要选一天" });
    expect(规整回款({ ...一笔, paidAt: "2026-02-30" })).toEqual({ error: "回款时间要选一天" });
    expect(规整回款({ ...一笔, currency: "XXX" })).toEqual({ error: "币种要选一个" });
    expect(规整回款({ ...一笔, amount: 0 })).toEqual({ error: "回款金额要大于 0" });
    expect(规整回款({ ...一笔, amount: "100" })).toEqual({ error: "回款金额要大于 0" });
    expect(规整回款({ ...一笔, amount: 单笔上限 * 10 })).toMatchObject({ error: expect.stringMatching(/太大/) });
    expect(规整回款(null)).toMatchObject({ error: expect.any(String) });
  });

  it("当前回款按币种加，不换汇，大的排前", () => {
    expect(当前回款([{ currency: "USD", amount: 100 }, { currency: "EUR", amount: 500 }, { currency: "USD", amount: 50 }])).toEqual([
      { 币种: "EUR", 合计: 500 },
      { 币种: "USD", 合计: 150 },
    ]);
  });
});

describe("记、删", () => {
  it("负责人记两笔、删一笔；列出来按回款时间排", async () => {
    const 一 = await 记回款(乙, 项目id, { ...一笔, paidAt: "2026-11-02" });
    const 二 = await 记回款(乙, 项目id, { ...一笔, paidAt: "2026-10-01", currency: "EUR", amount: 20 });
    expect(一).toMatchObject({ ok: true, name: "QA-回款项目" });
    expect(二.ok).toBe(true);
    const 们 = await 列回款(项目id);
    expect(们.map((x) => x.currency)).toEqual(["EUR", "USD"]);
    expect(们[1].userId).toBe(乙.id);
    expect(await 删回款(乙, 们[0].id)).toMatchObject({ ok: true, projectId: 项目id });
    expect(await 列回款(项目id)).toHaveLength(1);
    expect(await 删回款(乙, 们[0].id)).toMatchObject({ ok: false, error: expect.stringMatching(/不在了/) });
  });

  it("填错了一行不写", async () => {
    expect(await 记回款(乙, 项目id, { ...一笔, amount: -1 })).toMatchObject({ ok: false });
    expect(await prisma.entProjectPayment.count()).toBe(0);
  });

  it("同事记、删都拦；公海里的先领取；项目删了不让记", async () => {
    expect(await 记回款(丙, 项目id, 一笔)).toMatchObject({ ok: false, error: expect.stringMatching(/负责人/) });
    const r = await 记回款(乙, 项目id, 一笔);
    expect(await 删回款(丙, r.id!)).toMatchObject({ ok: false });
    await prisma.project.update({ where: { id: 项目id }, data: { pooledAt: new Date() } });
    expect(await 记回款(丙, 项目id, 一笔)).toMatchObject({ ok: false, error: expect.stringMatching(/公海/) });
    expect(await prisma.entProjectPayment.count()).toBe(1);
    await prisma.project.update({ where: { id: 项目id }, data: { pooledAt: null, deletedAt: new Date() } });
    expect(await 记回款(乙, 项目id, 一笔)).toMatchObject({ ok: false, error: expect.stringMatching(/不在了/) });
  });

  it("字段权限「商机金额」锁了：记、删都拦", async () => {
    const r = await 记回款(乙, 项目id, 一笔);
    mocks.金额锁了 = true;
    expect(await 记回款(乙, 项目id, 一笔)).toMatchObject({ ok: false });
    expect(await 删回款(乙, r.id!)).toMatchObject({ ok: false });
    expect(await prisma.entProjectPayment.count()).toBe(1);
  });
});

describe("节点必填", () => {
  it("配了「回款」：记第一笔就推；删了不往回退", async () => {
    const 起 = await 节点();
    await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { [起]: ["回款"] } } });
    const r = await 记回款(乙, 项目id, 一笔);
    expect(r).toMatchObject({ ok: true, 自动推到: [expect.any(String)] });
    const 推后 = await 节点();
    expect(推后).not.toBe(起);
    await 删回款(乙, r.id!);
    expect(await 节点()).toBe(推后);
  });

  it("配了「合同附件」：没传合同不推；传了合同（tag=合同）才推", async () => {
    const 起 = await 节点();
    await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { [起]: ["合同附件"] } } });
    const 附件 = (tag: string | null) => prisma.attachment.create({ data: { projectId: 项目id, name: "a.pdf", mime: "application/pdf", size: 1, sha256: "x", userId: 乙.id, tag } });
    await 附件(null);
    await 附件("其它");
    expect(await 合同附件后推进(乙, 项目id)).toEqual([]);
    expect(await 节点()).toBe(起);
    await 附件("合同");
    expect((await 合同附件后推进(乙, 项目id)).length).toBeGreaterThan(0);
    expect(await 节点()).not.toBe(起);
  });
});
