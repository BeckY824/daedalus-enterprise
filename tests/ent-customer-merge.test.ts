/**
 * 合并客户第一批 · 数据层（lib/enterprise/customer-merge.ts；方案 docs/合并客户-第一批-落地.md；客户 E-277 / E-280）：
 *   - 谁能并：两家负责人和两家没结束项目的负责人都是自己；项目公海里的不算同事的；系统管理员可代并
 *   - 其余拦法：交接中、业务线不同、一家在公海、标了无效
 *   - 来源 / 创建人不同要勾「已核对」
 *   - 逐表挪；联系人挂靠、项目关联客户、关联客户去重
 *   - 撤回后完全复原；之后被改过的留下并说清；30 天外不能撤；别人不能撤
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 合并预览, 执行合并, 撤回合并, 并入去向, 已核对话, 合并通知种类 } from "@/lib/enterprise/customer-merge";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 丙: 人;
let 市场: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string, 补: Record<string, unknown> = {}) {
  序++;
  return (await raw.customer.create({
    data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId, contacts: { create: { name: `联系人${序}`, phone: `1390000${String(序).padStart(4, "0")}`, isPrimary: true } }, ...补 },
  })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId || 老板.id, ...补 } })).id;
}
const 不能 = async (me: 人, a: string, b: string) => (await 合并预览(prisma, a, b, me)).原因.join("；");

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  市场 = await 造人("mk", "市场甲", "SALES");
  await raw.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }, { userId: 市场.id, bizRole: "market" }] });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("谁能并", () => {
  it("两家都是自己的、项目也都是自己的：能并，来源创建人一样不出勾选", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    await 项目(乙.id, a);
    await 项目(乙.id, b);
    const p = await 合并预览(prisma, a, b, 乙);
    expect(p).toMatchObject({ 能并: true, 原因: [], 要勾选: false });
    expect(p.条数).toMatchObject({ 联系人: 1, 项目: 1 });
  });

  it("名下有同事负责、没结束的项目：拦住；同事结束了的、项目公海里的不算", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    await 项目(丙.id, b, { result: "丢单" });
    await 项目(丙.id, b, { pooledAt: new Date() });
    await 项目("", a, { pooledAt: new Date() });
    expect((await 合并预览(prisma, a, b, 乙)).能并).toBe(true);
    await 项目(丙.id, a);
    expect(await 不能(乙, a, b)).toMatch(/名下有 1 个同事在推的项目，不能直接合并；可以发合并申请，要同意的人都同意后合并/);
    expect(await 执行合并(prisma, a, b, 乙)).toMatchObject({ ok: false });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
  });

  it("另一家是同事负责的：拦住；系统管理员能代并（同事的项目也一起挪、负责人不变）", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const 丙的 = await 项目(丙.id, b);
    expect(await 不能(乙, a, b)).toMatch(/不是你负责的，只能直接合并两家都由你负责的客户；要并同事的客户，可以发合并申请/);
    expect(await 不能(乙, a, b)).not.toMatch(/代并/);
    const r = await 执行合并(prisma, a, b, 老板);
    expect(r.ok).toBe(true);
    expect(await raw.project.findUniqueOrThrow({ where: { id: 丙的 } })).toMatchObject({ customerId: a, ownerId: 丙.id });
    // 代并：两家负责人（不是操作人）各收到通知
    const 收 = (await raw.entNotice.findMany({ where: { kind: 合并通知种类 } })).map((n) => n.userId).sort();
    expect(收).toEqual([乙.id, 丙.id].sort());
  });

  it("市场角色当负责人不能并（同 P-删-01）", async () => {
    const a = await 客户(市场.id);
    const b = await 客户(市场.id);
    expect(await 不能(市场, a, b)).toMatch(/不是你负责的/);
  });

  it("交接中、业务线不同、一家在公海、标了无效、和自己并：都拦", async () => {
    const a = await 客户(乙.id, { bizLine: "内贸" });
    const b = await 客户(乙.id, { bizLine: "外贸" });
    expect(await 不能(乙, a, b)).toMatch(/业务线不同/);
    expect(await 不能(乙, a, a)).toMatch(/不能和自己合并/);
    const c = await 客户(乙.id);
    const d = await 客户(乙.id);
    await raw.entHandover.create({ data: { kind: "转让", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 乙.id, customerIds: JSON.stringify([d]) } });
    expect(await 不能(乙, c, d)).toMatch(/正在转让交接中/);
    const e = await 客户(老板.id); // 公海里的客户负责人是占位账号（必填外键），这里借老板的号
    await raw.customerPool.create({ data: { customerId: e } });
    expect(await 不能(乙, c, e)).toMatch(/在公海里，先领出来再并/);
    expect(await 不能(老板, c, e)).toMatch(/在公海里，先领出来再并/);
    const f = await 客户(乙.id, { poolInvalidAt: new Date() });
    expect(await 不能(乙, c, f)).toMatch(/标了无效客户/);
  });

  it("两家都在公海：只有系统管理员能并，B 的公海行删掉、撤回建回", async () => {
    const a = await 客户(老板.id);
    const b = await 客户(老板.id);
    await raw.customerPool.createMany({ data: [{ customerId: a }, { customerId: b }] });
    expect(await 不能(乙, a, b)).toMatch(/只有系统管理员能合并/);
    const r = await 执行合并(prisma, a, b, 老板);
    expect(r.ok).toBe(true);
    expect(await raw.customerPool.findUnique({ where: { customerId: b } })).toBeNull();
    expect(await raw.customerPool.findUnique({ where: { customerId: a } })).not.toBeNull();
    if (!r.ok) return;
    expect((await 撤回合并(prisma, r.mergeId, 老板)).ok).toBe(true);
    expect(await raw.customerPool.findUnique({ where: { customerId: b } })).not.toBeNull();
  });
});

describe("来源 / 创建人不同要勾已核对", () => {
  it("创建人不同：标红、要勾选；没勾不并，勾了才并", async () => {
    const a = await 客户(乙.id, { creator: { create: { userId: 乙.id } } });
    const b = await 客户(乙.id, { creator: { create: { userId: 市场.id } } });
    const p = await 合并预览(prisma, a, b, 乙);
    expect(p.要勾选).toBe(true);
    expect(p.并排.find((x) => x.格 === "创建人")).toMatchObject({ 留下: "乙", 并掉: "市场甲", 不同: true, 标红: true });
    expect(await 执行合并(prisma, a, b, 乙)).toEqual({ ok: false, error: `两家的来源或创建人不一样，请先勾选「${已核对话}」` });
    expect((await 执行合并(prisma, a, b, 乙, { 已核对: true })).ok).toBe(true);
    // 被并那家的创建人收到通知；操作人自己不发
    expect((await raw.entNotice.findMany({ where: { kind: 合并通知种类 } })).map((n) => n.userId)).toEqual([市场.id]);
  });
});

/** 造一组两家都挂满东西的数据；返回 A、B、C 和几个要核的 id */
async function 造满(): Promise<Record<string, string>> {
  const ch = await raw.channel.create({ data: { name: "测试渠道|来源", channelOwnerId: 丙.id } });
  const a = await 客户(乙.id, { shortName: null, creator: { create: { userId: 乙.id } }, poolReturns: 1 });
  const b = await 客户(乙.id, { shortName: "B简称", customerType: "贸易商", addrCountry: "中国", addrCity: "测试市", channelId: ch.id, channelOwnerId: 丙.id, creator: { create: { userId: 乙.id } }, poolReturns: 2, extra: { create: { country: "中国", website: "example.test" } } });
  const c = await 客户(丙.id, { referrerCustomerId: b });
  await raw.customer.update({ where: { id: a }, data: { referrerCustomerId: b } });
  const 联a = (await raw.contact.findFirstOrThrow({ where: { customerId: a } })).id;
  const 联b = (await raw.contact.findFirstOrThrow({ where: { customerId: b } })).id;
  // 挂靠：联a 同时挂在 B（去重）；两位的主客户行
  await raw.contactCustomer.createMany({ data: [{ contactId: 联a, customerId: a }, { contactId: 联a, customerId: b }, { contactId: 联b, customerId: b }] });
  await raw.contactMethod.create({ data: { customerId: b, contactId: 联b, kind: "手机", value: "13900009999", numberKey: "13900009999" } });
  const pa = await 项目(乙.id, a);
  const pb = await 项目(乙.id, b, { phase: "订单" });
  const pb2 = await 项目(乙.id, b, { result: "丢单", repeatOfCustomerId: b, repeatSeq: 1 });
  const pa2 = await 项目(乙.id, a, { repeatOfCustomerId: a, repeatSeq: 1 });
  const pc = await 项目(丙.id, c);
  // 项目关联客户：pb 关联 A（改指后是主客户，删）；pa 关联 B（同上）；pc 两家都关联（留 A 那条）
  await raw.projectCustomer.createMany({ data: [{ projectId: pb, customerId: a }, { projectId: pa, customerId: b }, { projectId: pc, customerId: a }, { projectId: pc, customerId: b }] });
  await raw.entProjectPayment.create({ data: { projectId: pb, paidAt: new Date(), currency: "CNY", amount: 100 } });
  await raw.followUp.create({ data: { type: "电话", title: "打过电话", content: "测试", customerId: b, ownerId: 乙.id, occurredAt: new Date(Date.now() - 3600_000) } });
  const 删了的 = await raw.followUp.create({ data: { type: "电话", title: "删了的", content: "测试", customerId: b, ownerId: 乙.id, deletedAt: new Date() } });
  await raw.task.create({ data: { title: "待办", customerId: b, ownerId: 乙.id } });
  await raw.followPlan.create({ data: { subject: "计划", plannedAt: new Date(), customerId: b, ownerId: 乙.id } });
  await raw.customerOwnerLog.create({ data: { customerId: b, userId: 老板.id, toOwnerId: 乙.id } });
  // 关联客户：A—B（删）、B—C（改成 A—C）
  const [x, y] = [a, b].sort();
  await raw.entCustomerLink.create({ data: { customerId: x, otherId: y, userId: 乙.id } });
  const [m, n] = [b, c].sort();
  const 链 = await raw.entCustomerLink.create({ data: { customerId: m, otherId: n, userId: 乙.id } });
  const 撞 = await raw.entDupeHit.create({ data: { userId: 丙.id, keyType: "手机", keyValue: "13900009999", customerId: b, ownerId: 乙.id, status: "待处理", approverId: 乙.id } });
  const 对照 = await raw.entExternalRef.create({ data: { source: "feishu", entity: "customer", externalId: "rec-1", targetId: b, fingerprint: "f", written: "{}", raw: "{}" } });
  return { a, b, c, ch: ch.id, 联a, 联b, pa, pb, pb2, pa2, pc, 链: 链.id, 撞: 撞.id, 对照: 对照.id, 删了的: 删了的.id };
}

/** 两家相关的整套数据拍个照：撤回后要和合并前一模一样（updatedAt、自动重算的格除外） */
async function 拍照() {
  return 看已删(async () => ({
    客户: await raw.customer.findMany({ orderBy: { id: "asc" }, select: { id: true, deletedAt: true, shortName: true, customerType: true, addrCountry: true, addrCity: true, referrerCustomerId: true, poolReturns: true, channelId: true } }),
    档案: await raw.customerExtra.findMany({ orderBy: { customerId: "asc" } }),
    联系人: await raw.contact.findMany({ orderBy: { id: "asc" }, select: { id: true, customerId: true, isPrimary: true, deletedAt: true } }),
    挂靠: (await raw.contactCustomer.findMany({ select: { contactId: true, customerId: true } })).map((x) => `${x.contactId}|${x.customerId}`).sort(),
    号: await raw.contactMethod.findMany({ select: { id: true, customerId: true } }),
    项目: await raw.project.findMany({ orderBy: { id: "asc" }, select: { id: true, customerId: true, ownerId: true, channelId: true, repeatOfCustomerId: true, repeatSeq: true } }),
    项目关联: (await raw.projectCustomer.findMany({ select: { projectId: true, customerId: true } })).map((x) => `${x.projectId}|${x.customerId}`).sort(),
    沟通: await raw.followUp.findMany({ orderBy: { id: "asc" }, select: { id: true, customerId: true, deletedAt: true } }),
    待办: await raw.task.findMany({ select: { id: true, customerId: true } }),
    计划: await raw.followPlan.findMany({ select: { id: true, customerId: true } }),
    负责人日志: await raw.customerOwnerLog.findMany({ select: { id: true, customerId: true } }),
    关联客户: (await raw.entCustomerLink.findMany({ select: { customerId: true, otherId: true } })).map((x) => `${x.customerId}|${x.otherId}`).sort(),
    撞号: await raw.entDupeHit.findMany({ select: { id: true, customerId: true, approverId: true } }),
    对照: await raw.entExternalRef.findMany({ select: { id: true, targetId: true } }),
  }));
}

describe("逐表挪、去重", () => {
  it("B 名下的都挪到 A；只补空；B 软删、显示已并入；合并单和两条日志", async () => {
    const d = await 造满();
    // 丙（客户 C 的负责人）的待处理挂靠申请审批人要换成 A 的负责人：这里 A、B 都是乙，审批人不变
    const r = await 执行合并(prisma, d.a, d.b, 乙, { 已核对: true });
    expect(r).toMatchObject({ ok: true, 条数: { 联系人: 1, 项目: 2, 订单项目: 1, 回款: 1, 沟通: 1, 待办: 1, 跟进计划: 1 } });
    const 照 = await 拍照();
    const 客 = new Map(照.客户.map((c) => [c.id, c]));
    expect(客.get(d.b)!.deletedAt).not.toBeNull();
    expect(客.get(d.a)).toMatchObject({ shortName: "B简称", customerType: "贸易商", addrCountry: "中国", addrCity: "测试市", referrerCustomerId: null, poolReturns: 3, channelId: null });
    expect(客.get(d.c)!.referrerCustomerId).toBe(d.a);
    expect(照.档案.find((x) => x.customerId === d.a)).toMatchObject({ country: "中国", website: "example.test" });
    // 联系人：B 的关键联系人去掉关键（A 已有一位）
    expect(照.联系人.find((c) => c.id === d.联b)).toMatchObject({ customerId: d.a, isPrimary: false });
    expect(照.挂靠).toEqual([`${d.联a}|${d.a}`, `${d.联b}|${d.a}`].sort());
    expect(照.号.every((x) => x.customerId === d.a)).toBe(true);
    // 项目：挪到 A、负责人不变；来源空的补 B 的主渠道；重复咨询改指 A、序号接 A 最大号
    const 项 = new Map(照.项目.map((p) => [p.id, p]));
    expect(项.get(d.pb)).toMatchObject({ customerId: d.a, ownerId: 乙.id, channelId: d.ch });
    expect(项.get(d.pb2)).toMatchObject({ customerId: d.a, repeatOfCustomerId: d.a, repeatSeq: 2 });
    expect(项.get(d.pa)!.channelId).toBeNull();
    // 项目关联客户去重：只剩 pc—A
    expect(照.项目关联).toEqual([`${d.pc}|${d.a}`]);
    // 沟通（含回收站里的）、待办、计划、负责人日志都挪了
    expect(照.沟通.every((f) => f.customerId === d.a)).toBe(true);
    expect(照.沟通.find((f) => f.id === d.删了的)!.deletedAt).not.toBeNull();
    expect([...照.待办, ...照.计划, ...照.负责人日志].every((x) => x.customerId === d.a)).toBe(true);
    // 关联客户：A—B 删了，B—C 变成 A—C
    expect(照.关联客户).toEqual([[d.a, d.c].sort().join("|")]);
    expect(照.撞号[0].customerId).toBe(d.a);
    expect(照.对照[0].targetId).toBe(d.a);
    // 回款跟着项目
    expect((await raw.entProjectPayment.findFirstOrThrow({})).projectId).toBe(d.pb);
    // 最近跟进按合起来的沟通重算
    expect((await raw.customer.findUniqueOrThrow({ where: { id: d.a } })).lastFollowAt).not.toBeNull();
    if (!r.ok) return;
    expect(await 并入去向(prisma, d.b)).toMatchObject({ mergeId: r.mergeId, intoId: d.a });
    const 单 = await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: r.mergeId } });
    expect(单).toMatchObject({ kind: "客户", status: "已合并", fromId: d.b, intoId: d.a, byUserId: 乙.id, fromChannelId: d.ch, fromCreatorId: 乙.id });
    const 日志 = await raw.auditLog.findMany({ where: { action: "merge" } });
    expect(日志.map((l) => l.entityId).sort()).toEqual([d.a, d.b].sort());
    // 通知：B 的来源渠道负责人（丙）；创建人是操作人自己不发
    expect((await raw.entNotice.findMany({ where: { kind: 合并通知种类 } })).map((x) => x.userId)).toEqual([丙.id]);
  });

  it("来源不同时没勾选：整单不动", async () => {
    const d = await 造满();
    const 前 = await 拍照();
    const r = await 执行合并(prisma, d.a, d.b, 乙, { 已核对: false });
    // 造满里 B 有主渠道、A 没有，来源不同
    expect(r.ok).toBe(false);
    expect(await 拍照()).toEqual(前);
  });

  it("待处理的挂靠申请：审批人换成 A 的负责人；撤回换回", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const h = await raw.entDupeHit.create({ data: { userId: 市场.id, keyType: "手机", keyValue: "13900008888", customerId: b, ownerId: 丙.id, status: "待处理", approverId: 丙.id } });
    const r = await 执行合并(prisma, a, b, 老板);
    expect(await raw.entDupeHit.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ customerId: a, approverId: 乙.id });
    if (!r.ok) throw new Error(r.error);
    await 撤回合并(prisma, r.mergeId, 老板);
    expect(await raw.entDupeHit.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ customerId: b, approverId: 丙.id });
  });
});

describe("撤回", () => {
  it("撤回后完全复原（B 回来、挪过的都回 B、去重删掉的建回、补的格清空）", async () => {
    const d = await 造满();
    const 前 = await 拍照();
    const r = await 执行合并(prisma, d.a, d.b, 乙, { 已核对: true });
    if (!r.ok) throw new Error(r.error);
    const u = await 撤回合并(prisma, r.mergeId, 乙);
    expect(u).toEqual({ ok: true, 没还原: [] });
    expect(await 拍照()).toEqual(前);
    expect(await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: r.mergeId } })).toMatchObject({ status: "已撤回", undoneById: 乙.id });
    expect(await 并入去向(prisma, d.b)).toBeNull();
    expect(await raw.auditLog.count({ where: { action: "merge-undo" } })).toBe(2);
    expect(await 撤回合并(prisma, r.mergeId, 乙)).toEqual({ ok: false, error: "这张合并单已经撤回过了" });
  });

  it("合并之后被改过的留下并说清；之后在 A 上新记的不跟着回去；项目换了负责人照样回 B", async () => {
    const d = await 造满();
    const r = await 执行合并(prisma, d.a, d.b, 乙, { 已核对: true });
    if (!r.ok) throw new Error(r.error);
    await raw.project.update({ where: { id: d.pb }, data: { ownerId: 丙.id } });
    await raw.project.update({ where: { id: d.pb2 }, data: { customerId: d.c } });
    await raw.customer.update({ where: { id: d.a }, data: { shortName: "后来改的" } });
    const 新沟通 = await raw.followUp.create({ data: { type: "电话", title: "合并后记的", content: "测试", customerId: d.a, ownerId: 乙.id } });
    const u = await 撤回合并(prisma, r.mergeId, 乙);
    if (!u.ok) throw new Error(u.error);
    expect(u.没还原).toEqual(expect.arrayContaining([
      { 类: "项目", id: d.pb2, 原因: "合并之后被改过（换了客户或删了）" },
      { 类: "客户资料", id: "客户简称", 原因: "合并之后被改过，保留现在的值" },
    ]));
    expect(await raw.project.findUniqueOrThrow({ where: { id: d.pb } })).toMatchObject({ customerId: d.b, ownerId: 丙.id });
    expect(await raw.project.findUniqueOrThrow({ where: { id: d.pb2 } })).toMatchObject({ customerId: d.c, repeatOfCustomerId: d.a });
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: 新沟通.id } })).customerId).toBe(d.a);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: d.a } })).shortName).toBe("后来改的");
  });

  it("30 天外不能撤；别人不能撤；系统管理员能撤", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    const 单 = await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: r.mergeId } });
    expect(await 撤回合并(prisma, r.mergeId, 乙, new Date(单.at.getTime() + 31 * 86_400_000))).toEqual({ ok: false, error: "合并已超过 30 天，不能整单撤回" });
    expect(await 撤回合并(prisma, r.mergeId, 丙)).toEqual({ ok: false, error: "只有合并的人或系统管理员能撤回合并" });
    expect((await 撤回合并(prisma, r.mergeId, 老板, new Date(单.at.getTime() + 29 * 86_400_000))).ok).toBe(true);
  });

  it("留下那家进了回收站：先恢复再撤", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    await raw.customer.update({ where: { id: a }, data: { deletedAt: new Date() } });
    expect((await 撤回合并(prisma, r.mergeId, 乙)).ok).toBe(false);
  });
});
