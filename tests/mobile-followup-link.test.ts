/**
 * 手机记跟进：关联商机（2026-10-19 客户反馈第 8 条）和「微信沟通」类型（第 3 条，存 WECHAT）。
 * 写法要和电脑上一样：商机进 FollowUp.opportunityId。跟进挂订单（FollowUpOrder）2026-10-29 随订单表删了（迁移 066）。
 * 同步到电脑那一段见 tests/team-notice-mobile-create.test.ts
 */
import { describe, expect, it } from "vitest";
import * as 手机 from "@/lib/mobile/sync";
import { 分表, 客户们 } from "@/lib/mobile/view";

const 机 = { teamId: "t1", device: "m_phone", key: "", epoch: 0, keys: {}, userId: "acct_li", 私钥: new Uint8Array() } as unknown as 手机.手机团队;
const 钟 = { 钟: { name: "x" } };
async function 新手机(业务?: Record<string, unknown>) {
  const 库 = new 手机.内存库();
  const 状态 = 手机.新状态();
  const 放 = (t: string, k: string, r: Record<string, unknown>) => 库.放({ t, k, r, ...钟 });
  await 放("User", "acct_li", { id: "acct_li", name: "李娜" });
  if (业务) await 放("Setting", "business", { key: "business", value: JSON.stringify(业务) });
  await 放("Customer", "c1", { id: "c1", name: "Nordlicht", phone: "+491510001111", salesOwnerId: "acct_li" });
  await 放("Customer", "c2", { id: "c2", name: "别家", phone: "+491510002222", salesOwnerId: "acct_li" });
  await 放("Opportunity", "o1", { id: "o1", name: "工矿灯 2000 套", customerId: "c1", status: "OPEN", createdAt: 1 });
  await 放("Opportunity", "o0", { id: "o0", name: "去年的面板灯", customerId: "c1", status: "LOST", createdAt: 0 });
  await 放("Opportunity", "o2", { id: "o2", name: "别家的", customerId: "c2", status: "OPEN", createdAt: 1 });
  return { 库, 状态 };
}
const 外贸 = { template: "trade", currency: "USD" };

describe("手机记跟进：关联商机", () => {
  it("挂商机：写进 FollowUp.opportunityId，只推跟进和日志", async () => {
    const { 库, 状态 } = await 新手机(外贸);
    const { id } = await 手机.记跟进(机, 库, 状态, { customerId: "c1", type: "WHATSAPP", content: "报了价", 关联: "o1" });
    expect((await 库.取("FollowUp", id))?.r).toMatchObject({ opportunityId: "o1", customerId: "c1" });
    expect(状态.待推.map((e) => e.t)).toEqual(["FollowUp", "AuditLog"]);
  });

  it("别家客户的商机、不存在的、老版本手机还发来的「订单:<id>」都挡住，挡住的什么都不写", async () => {
    const { 库, 状态 } = await 新手机(外贸);
    await expect(手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "x", 关联: "o2" })).rejects.toThrow("这个商机不在这位客户名下");
    await expect(手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "x", 关联: "nope" })).rejects.toThrow("这个商机不在这位客户名下");
    await expect(手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "x", 关联: "订单:t1" })).rejects.toThrow("这个商机不在这位客户名下");
    expect(状态.待推).toEqual([]);
  });

  it("不选就不挂（空串、null 一样）", async () => {
    const { 库, 状态 } = await 新手机(外贸);
    const a = await 手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "x", 关联: "" });
    const b = await 手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "y", 关联: null });
    for (const { id } of [a, b]) expect((await 库.取("FollowUp", id))?.r.opportunityId).toBeNull();
    expect(状态.待推.map((e) => e.t)).toEqual(["FollowUp", "AuditLog", "FollowUp", "AuditLog"]);
  });

  it("客户视图：候选列这位客户全部商机（含已结束的），新建的在前；时间线上显示挂着的", async () => {
    const { 库, 状态 } = await 新手机(外贸);
    await 手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "a", 关联: "o1" }, 10);
    await 手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "b", 关联: "o0" }, 20);
    await 手机.记跟进(机, 库, 状态, { customerId: "c1", type: "PHONE", content: "c" }, 30);
    const c = 客户们(分表(库.行.values()), "acct_li", new Set()).find((x) => x.id === "c1")!;
    expect(c.可关联).toEqual({ 商机: [{ id: "o1", name: "工矿灯 2000 套" }, { id: "o0", name: "去年的面板灯" }] });
    expect(c.跟进.map((x) => [x.content, x.关联])).toEqual([["c", ""], ["b", "去年的面板灯"], ["a", "工矿灯 2000 套"]]);
  });
});

describe("手机记跟进：微信沟通", () => {
  it("类型表里有 WECHAT，存的就是 WECHAT，操作日志写「微信沟通」", async () => {
    expect(手机.手机跟进类型).toContain("WECHAT");
    const { 库, 状态 } = await 新手机(外贸);
    const { id } = await 手机.记跟进(机, 库, 状态, { customerId: "c1", type: "WECHAT", content: "加了微信，发了目录" }, 1_760_000_000_000);
    expect((await 库.取("FollowUp", id))?.r.type).toBe("WECHAT");
    expect(状态.待推.find((e) => e.t === "AuditLog")?.r).toMatchObject({ summary: expect.stringContaining("一条微信沟通跟进") });
    expect(JSON.parse(String(状态.待推.find((e) => e.t === "AuditLog")?.r?.detail))).toMatchObject({ 类型: "微信沟通", 来自: "手机" });
  });
});
