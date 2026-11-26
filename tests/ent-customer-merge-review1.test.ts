/**
 * 合并客户第一批 · 独立审查第一单（11-25；方案 docs/合并客户-第一批-落地.md）。审查复现的场景改写成正式用例：
 *   - M1 / M1b：查重领取建的重复咨询序号空（只出口 C 记号，8bb2bffa）：合并、项目换客户都只改原始客户，不分号；撤回照样空
 *   - M2：回收站里同事没结束的项目不算「同事在推」，预览和执行一致
 *   - M5：撤回合并时两家有一家在转让交接中拦；留下那家现在不归撤回的人负责，只有系统管理员能撤
 *   - M7：单独合成联系人在 看已删 里跑，回收站里的沟通、已删项目的主联系人和项目联系人跟着挪
 *   - M8：项目换客户的「撤销」是真的反向操作：挂靠不留残、项目关联客户连身份建回、序号换回原值；只认自己刚换的那一次
 *   - 建议 1 / 3 / 9 / 10：合成拦交接中和无效；撤回提示「已并入 Z，先撤回那次合并」；离职交接中的项目不能换；并发
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 挂靠联系人不能合成, 只有一位联系人不能合成 } from "@/lib/enterprise/merge-hints";
import { 合并预览, 执行合并, 撤回合并, 合成联系人, 刚被改过话 } from "@/lib/enterprise/customer-merge";
import { 项目换客户, 项目换客户预览, 撤销换客户, 挂靠说明 } from "@/lib/enterprise/project-move-customer";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 丙: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string, 补: Record<string, unknown> = {}) {
  序++;
  return (await raw.customer.create({ data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId, contacts: { create: { name: `联系人${序}`, phone: `1390000${String(序).padStart(4, "0")}`, isPrimary: true } }, ...补 } })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId || 老板.id, ...补 } })).id;
}
const 主联系人 = async (customerId: string) => (await raw.contact.findFirstOrThrow({ where: { customerId } })).id;
const 转让交接 = (customerId: string, from: string, to: string) =>
  raw.entHandover.create({ data: { kind: "转让", fromUserId: from, toUserId: to, byUserId: from, customerIds: JSON.stringify([customerId]) } });
const 并成 = async (a: string, b: string, me: 人) => {
  const r = await 执行合并(prisma, a, b, me);
  if (!r.ok) throw new Error(r.error);
  return r.mergeId;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  await raw.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }] });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("M1 重复咨询序号空的不分号", () => {
  it("合并：B 名下查重领取建的（序号空）只改原始客户、序号照旧空；有号的接在 A 最大号后面；撤回都回原样", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    await 项目(乙.id, a, { repeatOfCustomerId: a, repeatSeq: 1 });
    const 空 = await 项目(乙.id, b, { repeatOfCustomerId: b, repeatSeq: null });
    const 有号 = await 项目(乙.id, b, { repeatOfCustomerId: b, repeatSeq: 1 });
    const mergeId = await 并成(a, b, 乙);
    expect(await raw.project.findUniqueOrThrow({ where: { id: 空 } })).toMatchObject({ repeatOfCustomerId: a, repeatSeq: null });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 有号 } })).toMatchObject({ repeatOfCustomerId: a, repeatSeq: 2 });
    const u = await 撤回合并(prisma, mergeId, 乙);
    expect(u).toEqual({ ok: true, 没还原: [] });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 空 } })).toMatchObject({ customerId: b, repeatOfCustomerId: b, repeatSeq: null });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 有号 } })).toMatchObject({ customerId: b, repeatOfCustomerId: b, repeatSeq: 1 });
  });

  it("M1b 项目换客户：序号空的只改原始客户、序号照旧空；有号的接在后面", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    await 项目(乙.id, a, { repeatOfCustomerId: a, repeatSeq: 3 });
    const 空 = await 项目(乙.id, b, { repeatOfCustomerId: b, repeatSeq: null });
    const 有号 = await 项目(乙.id, b, { repeatOfCustomerId: b, repeatSeq: 1 });
    expect((await 项目换客户(prisma, 空, a, 乙)).ok).toBe(true);
    expect((await 项目换客户(prisma, 有号, a, 乙)).ok).toBe(true);
    expect(await raw.project.findUniqueOrThrow({ where: { id: 空 } })).toMatchObject({ customerId: a, repeatOfCustomerId: a, repeatSeq: null });
    expect(await raw.project.findUniqueOrThrow({ where: { id: 有号 } })).toMatchObject({ customerId: a, repeatOfCustomerId: a, repeatSeq: 4 });
  });
});

describe("M2 回收站里的项目不算同事在推", () => {
  it("同事没结束的项目在回收站里：预览能并、执行也能并；没删的照样两边都拦", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const 删了的 = await 项目(丙.id, b, { deletedAt: new Date() });
    const pv = await 合并预览(prisma, a, b, 乙);
    expect(pv.能并).toBe(true);
    expect((await 执行合并(prisma, a, b, 乙)).ok).toBe(true);
    expect((await raw.project.findUniqueOrThrow({ where: { id: 删了的 } })).customerId).toBe(a);

    const c = await 客户(乙.id);
    const d = await 客户(乙.id);
    await 项目(丙.id, d);
    expect((await 合并预览(prisma, c, d, 乙)).能并).toBe(false);
    expect(await 执行合并(prisma, c, d, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("同事") });
  });
});

describe("M5 撤回合并的拦法", () => {
  it("两家有一家在转让交接中：不让撤", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const mergeId = await 并成(a, b, 乙);
    const h = await 转让交接(a, 乙.id, 丙.id);
    expect(await 撤回合并(prisma, mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("正在转让交接中") });
    expect(await 撤回合并(prisma, mergeId, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("正在转让交接中") });
    await raw.entHandover.update({ where: { id: h.id }, data: { status: "已撤回" } });
    expect((await 撤回合并(prisma, mergeId, 乙)).ok).toBe(true);
  });

  it("留下那家现在不归合并的人负责：本人撤不了（请找系统管理员撤回），系统管理员能撤", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const mergeId = await 并成(a, b, 乙);
    await raw.customer.update({ where: { id: a }, data: { salesOwnerId: 丙.id } });
    expect(await 撤回合并(prisma, mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("请找系统管理员撤回") });
    expect((await 撤回合并(prisma, mergeId, 老板)).ok).toBe(true);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
  });

  it("建议 3：留下那家已并进 Z，撤回提示「已并入 Z，先撤回那次合并」；连环合并 C→B→A 撤 C→B 同理", async () => {
    const a = await 客户(乙.id, { name: "甲家" });
    const b = await 客户(乙.id, { name: "乙家" });
    const z = await 客户(乙.id, { name: "终点家" });
    const 第一次 = await 并成(a, b, 乙);
    const 第二次 = await 并成(z, a, 乙);
    expect(await 撤回合并(prisma, 第一次, 乙)).toEqual({ ok: false, error: "「甲家」已并入「终点家」，先撤回那次合并" });
    expect((await 撤回合并(prisma, 第二次, 乙)).ok).toBe(true);
    expect((await 撤回合并(prisma, 第一次, 乙)).ok).toBe(true);
    // 只在回收站里（不是并走的）：照旧「先恢复再撤回」
    const c = await 客户(乙.id, { name: "丙家" });
    const d = await 客户(乙.id, { name: "丁家" });
    const 第三次 = await 并成(c, d, 乙);
    await raw.customer.update({ where: { id: c }, data: { deletedAt: new Date() } });
    expect(await 撤回合并(prisma, 第三次, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("先恢复再撤回") });
  });
});

describe("M7 / 建议 1 单独合成联系人", () => {
  it("回收站里的沟通、已删项目的主联系人和项目联系人跟着挪到留下那位", async () => {
    const a = await 客户(乙.id);
    const 留 = await 主联系人(a);
    const 并 = (await raw.contact.create({ data: { name: "同一个人", customerId: a, phone: "13800000001" } })).id;
    const 删了的沟通 = await raw.followUp.create({ data: { type: "PHONE", title: "删了的", content: "x", customerId: a, contactId: 并, ownerId: 乙.id, occurredAt: new Date(), deletedAt: new Date() } });
    const 删了的项目 = await 项目(乙.id, a, { contactId: 并, deletedAt: new Date() });
    await raw.projectContact.create({ data: { projectId: 删了的项目, contactId: 并 } });
    const r = await 合成联系人(prisma, 留, 并, 乙);
    expect(r.ok).toBe(true);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: 删了的沟通.id } })).contactId).toBe(留);
    expect((await raw.project.findUniqueOrThrow({ where: { id: 删了的项目 } })).contactId).toBe(留);
    expect(await raw.projectContact.findMany({ where: { projectId: 删了的项目 }, select: { contactId: true } })).toEqual([{ contactId: 留 }]);
  });

  it("两位不在同一位客户名下：服务端拒绝话带界面置灰那句（merge-hints 同一个常量）", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const 留 = await 主联系人(a);
    const 外 = await 主联系人(b);
    const r = await 合成联系人(prisma, 留, 外, 乙);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining(挂靠联系人不能合成) });
    expect(挂靠联系人不能合成).toBe("挂靠过来的联系人请到他所属的客户里合成");
    expect(只有一位联系人不能合成).toBe("这位客户只有一位自己的联系人，没有可合成的");
  });

  it("客户在转让交接中、标了无效：不让合成（同合并客户）", async () => {
    const a = await 客户(乙.id);
    const 留 = await 主联系人(a);
    const 并 = (await raw.contact.create({ data: { name: "同一个人", customerId: a, phone: "13800000002" } })).id;
    const h = await 转让交接(a, 乙.id, 丙.id);
    expect(await 合成联系人(prisma, 留, 并, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("正在转让交接中") });
    await raw.entHandover.update({ where: { id: h.id }, data: { status: "已撤回" } });
    await raw.customer.update({ where: { id: a }, data: { poolInvalidAt: new Date() } });
    expect(await 合成联系人(prisma, 留, 并, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("标了无效客户") });
  });
});

describe("M8 项目换客户的撤销", () => {
  it("项目原来就关联着目标客户（业主方）：换过去再撤销，挂靠不留残、关联行连身份建回、序号换回、沟通卡点回原客户", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const b1 = await 主联系人(b);
    await 项目(乙.id, a, { repeatOfCustomerId: a, repeatSeq: 5 });
    const p = await 项目(乙.id, b, { contactId: b1, repeatOfCustomerId: b, repeatSeq: 2 });
    const 关联 = await raw.projectCustomer.create({ data: { projectId: p, customerId: a, roles: JSON.stringify(["业主方"]) } });
    const f = await raw.followUp.create({ data: { type: "PHONE", title: "沟通", customerId: b, ownerId: 乙.id, content: "项目上的", occurredAt: new Date() } });
    await raw.followUpProject.create({ data: { followUpId: f.id, projectId: p, node: "x" } });
    const 已挂 = await raw.contactCustomer.create({ data: { contactId: b1, customerId: b } });
    const r = await 项目换客户(prisma, p, a, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await raw.project.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ customerId: a, repeatOfCustomerId: a, repeatSeq: 6 });
    expect(await raw.contactCustomer.findFirst({ where: { contactId: b1, customerId: a } })).toMatchObject({ note: 挂靠说明 });
    expect(await raw.projectCustomer.count({ where: { projectId: p } })).toBe(0);

    expect(await 撤销换客户(prisma, r.logId, 乙)).toEqual({ ok: true });
    expect(await raw.project.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ customerId: b, repeatOfCustomerId: b, repeatSeq: 2, contactId: b1 });
    expect(await raw.contactCustomer.count({ where: { contactId: b1, customerId: a } })).toBe(0);
    expect(await raw.contactCustomer.findUnique({ where: { id: 已挂.id } })).not.toBeNull();
    expect(await raw.projectCustomer.findMany({ where: { projectId: p } })).toEqual([{ ...关联 }]);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).customerId).toBe(b);
    expect(await raw.auditLog.count({ where: { action: "project-move-customer-undo" } })).toBe(3);
    // 只认一次：再撤一次不行
    expect(await 撤销换客户(prisma, r.logId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("已经撤销过") });
  });

  it("查重领取建的（序号空）：撤销后序号还是空", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const p = await 项目(乙.id, b, { repeatOfCustomerId: b, repeatSeq: null });
    const r = await 项目换客户(prisma, p, a, 乙);
    if (!r.ok) throw new Error(r.error);
    expect((await 撤销换客户(prisma, r.logId, 乙)).ok).toBe(true);
    expect(await raw.project.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ customerId: b, repeatOfCustomerId: b, repeatSeq: null });
  });

  it("挂靠行之后被改过（说明改了）的不删；只认自己刚换的那一次：别人撤不了、过了时限撤不了、之后又换过的撤不了", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const c = await 客户(乙.id);
    const b1 = await 主联系人(b);
    const p = await 项目(乙.id, b, { contactId: b1 });
    const r = await 项目换客户(prisma, p, a, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 撤销换客户(prisma, r.logId, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("只能撤销自己") });
    expect(await 撤销换客户(prisma, r.logId, 乙, new Date(Date.now() + 61_000))).toMatchObject({ ok: false, error: expect.stringContaining("过了撤销时间") });
    await raw.contactCustomer.updateMany({ where: { contactId: b1, customerId: a }, data: { note: "采购经理" } });
    expect((await 撤销换客户(prisma, r.logId, 乙)).ok).toBe(true);
    expect(await raw.contactCustomer.findFirst({ where: { contactId: b1, customerId: a } })).toMatchObject({ note: "采购经理" });

    const r2 = await 项目换客户(prisma, p, a, 乙);
    if (!r2.ok) throw new Error(r2.error);
    const r3 = await 项目换客户(prisma, p, c, 乙);
    if (!r3.ok) throw new Error(r3.error);
    expect(await 撤销换客户(prisma, r2.logId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("又换过客户") });
    expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).customerId).toBe(c);
  });
});

describe("建议 9 项目在离职交接中", () => {
  it("项目在离职交接里等接手人确认：预览、执行都拦；验证中的项目能换", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const p = await 项目(乙.id, b);
    const h = await raw.entHandover.create({ data: { kind: "离职", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 老板.id, way: "项目", projectIds: JSON.stringify([p]) } });
    expect(await 项目换客户预览(prisma, p, a, 老板)).toMatchObject({ 能换: false, 原因: [expect.stringContaining("离职交接中")] });
    expect(await 项目换客户(prisma, p, a, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("离职交接中") });
    await raw.entHandover.update({ where: { id: h.id }, data: { status: "已撤回" } });
    await raw.entLeadVerify.create({ data: { projectId: p, pending: "市场复核" } });
    expect((await 项目换客户(prisma, p, a, 乙)).ok).toBe(true);
  });
});

describe("建议 10 并发", () => {
  it("两边同时合并同一对：只成一次，另一次说清；事务排队等锁超时（P2028）翻成「刚被别人改过，刷新看看」", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const 两次 = await Promise.all([执行合并(prisma, a, b, 乙), 执行合并(prisma, a, b, 乙)]);
    expect(两次.filter((x) => x.ok)).toHaveLength(1);
    expect(两次.find((x) => !x.ok)).toMatchObject({ ok: false, error: expect.stringContaining("刷新看看") });

    // 拿一个真的 maxWait 超时错：一段事务占着唯一的连接，另一段只排 50 毫秒
    let 放开!: () => void;
    const 占着 = raw.$transaction(async (tx) => { await tx.user.count(); await new Promise<void>((r) => { 放开 = r; }); }, { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 50));
    const 原错 = await raw.$transaction(async (tx) => tx.user.count(), { maxWait: 50 }).then(() => null, (e: unknown) => e);
    放开();
    await 占着;
    expect((原错 as { code?: string } | null)?.code).toBe("P2028");
    expect(String((原错 as Error).message)).toMatch(/Unable to start a transaction/i);
    const 排不上 = new Proxy(prisma, { get: (t, k) => (k === "$transaction" ? async () => { throw 原错; } : Reflect.get(t, k)) });
    const c = await 客户(乙.id);
    const d = await 客户(乙.id);
    expect(await 执行合并(排不上, c, d, 乙)).toEqual({ ok: false, error: 刚被改过话 });
    expect(await 撤回合并(排不上, "不存在", 乙)).toEqual({ ok: false, error: 刚被改过话 });
    expect(await 合成联系人(排不上, await 主联系人(c), await 主联系人(d), 乙)).toEqual({ ok: false, error: 刚被改过话 });
    expect(await 项目换客户(排不上, await 项目(乙.id, c), d, 乙)).toEqual({ ok: false, error: 刚被改过话 });
    expect(await 撤销换客户(排不上, "不存在", 乙)).toEqual({ ok: false, error: 刚被改过话 });
  });
});
