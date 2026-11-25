/**
 * 合并客户第一批 · 第二阶段（服务端；方案 docs/合并客户-第一批-落地.md 第七节；客户 E-277 / E-280）：
 *   - 合成联系人：合并时勾「是同一个人」、单独合成；号码规整后相同的只留一行；撤回分回两位
 *   - 项目换客户：沟通、卡点跟着走，项目联系人挂靠过去；拦法同合并；系统管理员可代换
 *   - 回收站：已并入 / 已合成的标「已并入 → 留下那位」，不能单独恢复、不能单独彻底删除
 *   - 导入整批撤回：这一批的客户已并入别家的跳过，报告写「已并入 → A，未撤」
 *   - 旧链接：去 A 的地址带 ?merged=B，A 页提示；全局搜索搜 B 给 A
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
const 登录 = vi.hoisted(() => ({ 人: null as null | { id: string; name: string; role: string } }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), requireUser: async () => ({ email: "", title: "", ...登录.人! }) }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 执行合并, 撤回合并, 合成联系人, 并入后去处, 并入提示, 联系人单, 项目来历, 已核对话, 撤回期限天数 } from "@/lib/enterprise/customer-merge";
import { readFileSync } from "node:fs";
import { 项目换客户, 项目换客户预览, 挂靠说明 } from "@/lib/enterprise/project-move-customer";
import { 恢复, 彻底删除, 回收站列表 } from "@/lib/enterprise/soft-delete";
import { 撤回一批 } from "@/lib/enterprise-import/revert";
import { 预览合并, 合并客户, 搜合并候选, 并进来的合并单 } from "@/app/(app)/customers/merge-actions";
import { 全局搜索 } from "@/app/(app)/global-search";

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
  return (await raw.customer.create({ data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId, ...补 } })).id;
}
async function 联系人(customerId: string, 号: string, 补: Record<string, unknown> = {}) {
  const c = await raw.contact.create({ data: { name: `联系人${++序}`, customerId, phone: 号, ...补 } });
  await raw.contactMethod.create({ data: { customerId, contactId: c.id, kind: "phone", value: 号, numberKey: 号 } });
  await raw.contactCustomer.create({ data: { contactId: c.id, customerId } });
  return c.id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId || 老板.id, ...补 } })).id;
}
const 号们 = async (contactId: string) => (await raw.contactMethod.findMany({ where: { contactId }, orderBy: { value: "asc" } })).map((m) => m.value);

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
  登录.人 = 乙;
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("合成联系人", () => {
  it("合并时勾「是同一个人」：号码、沟通、项目联系人收到留下那位，相同的号只留一行；撤回分回两位", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const 留 = await 联系人(a, "13900000001", { isPrimary: true });
    const 并 = await 联系人(b, "13900000002", { isPrimary: true, email: "x@example.com" });
    // 存量跨类型同号：并那位多挂一行和留一样的号（规整后相同）
    const 重 = await raw.contactMethod.create({ data: { customerId: b, contactId: 并, kind: "phone", value: "13900000001", numberKey: "13900000001" } });
    const f = await raw.followUp.create({ data: { type: "PHONE", title: "沟通", customerId: b, contactId: 并, ownerId: 乙.id, content: "聊过", occurredAt: new Date() } });
    const pb = await 项目(乙.id, b, { contactId: 并 });
    await raw.projectContact.create({ data: { projectId: pb, contactId: 并 } });

    const r = await 执行合并(prisma, a, b, 乙, { 同一个人: [{ 留, 并 }] });
    if (!r.ok) throw new Error(r.error);
    expect(r.合成).toBe(1);
    expect(await 号们(留)).toEqual(["13900000001", "13900000002"]);
    expect(await raw.contactMethod.findUnique({ where: { id: 重.id } })).toBeNull();
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).contactId).toBe(留);
    expect((await raw.project.findUniqueOrThrow({ where: { id: pb } })).contactId).toBe(留);
    expect(await raw.projectContact.count({ where: { projectId: pb, contactId: 留 } })).toBe(1);
    const 并后 = await raw.contact.findUniqueOrThrow({ where: { id: 并 } });
    expect(并后).toMatchObject({ deletedAt: expect.any(Date), phone: null, email: null, isPrimary: false });
    expect((await raw.contact.findUniqueOrThrow({ where: { id: 留 } })).email).toBe("x@example.com");
    const 子 = await raw.entCustomerMerge.findFirstOrThrow({ where: { kind: 联系人单, parentId: r.mergeId } });
    expect(子).toMatchObject({ fromId: 并, intoId: 留, status: "已合并" });

    const u = await 撤回合并(prisma, r.mergeId, 乙);
    expect(u).toEqual({ ok: true, 没还原: [] });
    expect(await raw.contact.findUniqueOrThrow({ where: { id: 并 } })).toMatchObject({ customerId: b, deletedAt: null, phone: "13900000002", email: "x@example.com", isPrimary: true });
    expect((await raw.contact.findUniqueOrThrow({ where: { id: 留 } })).email).toBeNull();
    expect(await 号们(并)).toEqual(["13900000001", "13900000002"]);
    expect(await 号们(留)).toEqual(["13900000001"]);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).contactId).toBe(并);
    expect(await raw.project.findUniqueOrThrow({ where: { id: pb } })).toMatchObject({ customerId: b, contactId: 并 });
    expect(await raw.contactCustomer.count({ where: { contactId: 并, customerId: b } })).toBe(1);
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 子.id } })).status).toBe("已撤回");
  });

  it("勾的「是同一个人」对不上两家（两位都是 A 的）：整单不并", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const x = await 联系人(a, "13900000011");
    const y = await 联系人(a, "13900000012");
    const r = await 执行合并(prisma, a, b, 乙, { 同一个人: [{ 留: x, 并: y }] });
    expect(r).toEqual({ ok: false, error: "勾的「是同一个人」对不上两家的联系人，刷新再勾" });
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).deletedAt).toBeNull();
  });

  it("单独合成：负责人本人能合成，同事不能；不同客户的不能；撤回分回；合成单挂在合并单下的不能单独撤", async () => {
    const a = await 客户(乙.id);
    const 留 = await 联系人(a, "13900000021", { isPrimary: true });
    const 并 = await 联系人(a, "13900000022");
    const 别家 = await 联系人(await 客户(乙.id), "13900000023");
    expect((await 合成联系人(prisma, 留, 并, 丙)).ok).toBe(false);
    expect(await 合成联系人(prisma, 留, 别家, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("同一位客户") });
    const r = await 合成联系人(prisma, 留, 并, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 号们(留)).toEqual(["13900000021", "13900000022"]);
    expect((await 撤回合并(prisma, r.mergeId, 丙)).ok).toBe(false);
    expect(await 撤回合并(prisma, r.mergeId, 乙)).toEqual({ ok: true, 没还原: [] });
    expect(await 号们(并)).toEqual(["13900000022"]);
    expect((await raw.contact.findUniqueOrThrow({ where: { id: 并 } })).deletedAt).toBeNull();
  });
});

describe("项目换客户", () => {
  it("项目连沟通、卡点挪到目标客户，项目联系人挂靠过去，负责人不变；关联客户里的目标那行删掉", async () => {
    const 原 = await 客户(乙.id);
    const 目标 = await 客户(乙.id);
    const 人 = await 联系人(原, "13900000031");
    const p = await 项目(乙.id, 原, { contactId: 人, phase: "订单" });
    const 另一个 = await 项目(乙.id, 原);
    await raw.projectCustomer.create({ data: { projectId: p, customerId: 目标 } });
    const f = await raw.followUp.create({ data: { type: "PHONE", title: "沟通", customerId: 原, ownerId: 乙.id, content: "项目上的", occurredAt: new Date() } });
    await raw.followUpProject.create({ data: { followUpId: f.id, projectId: p, node: "x" } });
    const g = await raw.followUp.create({ data: { type: "PHONE", title: "沟通", customerId: 原, ownerId: 乙.id, content: "客户上的", occurredAt: new Date() } });
    const pre = await 项目换客户预览(prisma, p, 目标, 乙);
    expect(pre).toMatchObject({ 能换: true, 条数: { 沟通: 1, 订单: true, 联系人: 1, 回款: 0 } });
    const r = await 项目换客户(prisma, p, 目标, 乙);
    expect(r).toMatchObject({ ok: true, 沟通: 1, 挂靠: 1 });
    expect(await raw.project.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ customerId: 目标, ownerId: 乙.id, contactId: 人 });
    expect((await raw.project.findUniqueOrThrow({ where: { id: 另一个 } })).customerId).toBe(原);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).customerId).toBe(目标);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: g.id } })).customerId).toBe(原);
    expect(await raw.contactCustomer.findFirst({ where: { contactId: 人, customerId: 目标 } })).toMatchObject({ note: 挂靠说明 });
    expect(await raw.projectCustomer.count({ where: { projectId: p } })).toBe(0);
    expect(await raw.auditLog.count({ where: { action: "project-move-customer" } })).toBe(3);
  });

  it("拦法同合并：目标是同事的、项目是同事在推的拦；系统管理员能代换", async () => {
    const 原 = await 客户(乙.id);
    const 同事的 = await 客户(丙.id);
    const 我的 = await 客户(乙.id);
    const p = await 项目(乙.id, 原);
    const q = await 项目(丙.id, 原);
    expect((await 项目换客户(prisma, p, 同事的, 乙)).ok).toBe(false);
    expect(await 项目换客户(prisma, q, 我的, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("同事负责") });
    expect(await 项目换客户(prisma, q, 原, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("已经在这位客户名下") });
    expect((await 项目换客户(prisma, q, 同事的, 老板)).ok).toBe(true);
    expect((await raw.project.findUniqueOrThrow({ where: { id: q } })).ownerId).toBe(丙.id);
  });
});

describe("回收站、旧链接、搜索", () => {
  it("已并入的 B：回收站标「已并入 → A」，不能单独恢复、彻底删除；撤回后照常", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    const 条 = (await 回收站列表(老板)).find((x) => x.id === b);
    expect(条?.已并入).toEqual({ id: a, 名: expect.stringContaining("测试客户") });
    expect(await 恢复(老板, "Customer", b)).toMatchObject({ ok: false, error: expect.stringContaining("已并入") });
    expect(await 彻底删除(老板, "Customer", b)).toMatchObject({ ok: false, error: expect.stringContaining("已并入") });
    expect(await raw.customer.findUnique({ where: { id: b } })).not.toBeNull();
  });

  it("合成掉的联系人：回收站不能单独恢复", async () => {
    const a = await 客户(乙.id);
    const 留 = await 联系人(a, "13900000041");
    const 并 = await 联系人(a, "13900000042");
    expect((await 合成联系人(prisma, 留, 并, 乙)).ok).toBe(true);
    expect((await 回收站列表(老板)).find((x) => x.id === 并)?.已并入?.id).toBe(留);
    expect(await 恢复(老板, "Contact", 并)).toMatchObject({ ok: false, error: expect.stringContaining("已合成进") });
  });

  it("旧链接去 A 带 ?merged=B、别的参数照带；A 页提示只认对得上的合并单", async () => {
    const a = await 客户(乙.id, { customerNo: 123 });
    const b = await 客户(乙.id, { customerNo: 456 });
    expect(并入后去处(a, b, { focus: "plan:x", merged: "旧" })).toBe(`/customers/${a}?focus=plan%3Ax&merged=${b}`);
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 并入提示(prisma, a, b)).toMatch(/已并入这位客户/);
    expect(await 并入提示(prisma, b, a)).toBeNull();
    await 撤回合并(prisma, r.mergeId, 乙);
    expect(await 并入提示(prisma, a, b)).toBeNull();
  });

  it("全局搜索搜 B 的名字：给 A，附注「已并入」，去处带 merged", async () => {
    const a = await 客户(乙.id, { name: "甲方公司" });
    const b = await 客户(乙.id, { name: "乙字号公司" });
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    const s = await 全局搜索("乙字号");
    expect(s.客户).toEqual([{ id: a, name: "甲方公司", 附注: "「乙字号公司」已并入这位客户", 去: `/customers/${a}?merged=${b}` }]);
  });
});

describe("导入整批撤回", () => {
  it("这一批建的客户已并入别家：跳过不撤，报告写「已并入 → A，未撤」", async () => {
    const a = await 客户(乙.id, { name: "留下的" });
    const b = await 客户(乙.id, { name: "导进来的" });
    const 批 = await raw.entImportBatch.create({ data: { source: "excel", status: "done" } });
    await raw.entImportRow.create({ data: { batchId: 批.id, entity: "customer", externalId: "x1", targetId: b, kind: "create", written: JSON.stringify({ name: "导进来的" }) } });
    await raw.entExternalRef.create({ data: { source: "excel", entity: "customer", externalId: "x1", targetId: b, fingerprint: "f", written: "{}", raw: "{}", batchId: 批.id } });
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    const 结 = await 撤回一批(批.id, { id: 老板.id, name: 老板.name });
    expect(结.留下).toEqual([expect.objectContaining({ 实体: "customer", 原因: expect.stringContaining("已并入 → 「留下的」，未撤") })]);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: a } })).deletedAt).toBeNull();
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: r.mergeId } })).status).toBe("已合并");
  });
});

describe("服务端动作", () => {
  it("预览要两家都看得到（查不到的不给）；只认 id，已核对要是 true；候选只搜自己能并的；合并单列表给能撤", async () => {
    const a = await 客户(乙.id, { name: "我的甲" });
    const b = await 客户(乙.id, { name: "我的乙", creator: { create: { userId: 丙.id } } });
    await 客户(丙.id, { name: "我的丙" });
    登录.人 = 乙;
    expect((await 搜合并候选(a, "我的")).map((x) => x.name)).toEqual(["我的乙"]);
    // 看不到的（限定层查不到；测试里没登录态，用回收站里的代替）不给预览
    const 删了的 = await 客户(乙.id, { deletedAt: new Date() });
    expect(await 预览合并(a, 删了的)).toEqual({ ok: false, error: "客户不存在或你看不到，刷新看看" });
    const p = await 预览合并(a, b);
    expect(p).toMatchObject({ ok: true, 预览: { 能并: true, 要勾选: true } });
    expect(await 合并客户(a, b, { 已核对: "true" as unknown as boolean })).toMatchObject({ ok: false });
    expect(await 合并客户(a, b, { 已核对: true, 同一个人: [{ 留: 1 }] })).toEqual({ ok: false, error: "参数不对，刷新再试" });
    const r = await 合并客户(a, b, { 已核对: true });
    expect(r.ok).toBe(true);
    expect(await 并进来的合并单(a)).toEqual([expect.objectContaining({ 从: "我的乙", status: "已合并", 能撤: true })]);
  });

  it("合并单 能撤 和服务端撤回拦法对齐（PR #457 界面审查第 1 条）：留下那家不归本人 / 进了公海、两家有一家在交接中、只读角色都不摆", async () => {
    const 丁 = await 造人("ding", "丁", "SALES");
    await raw.entMember.create({ data: { userId: 丁.id, bizRole: "admin" } });
    忘掉企业版范围();
    const a = await 客户(乙.id, { name: "留下甲" });
    const b = await 客户(乙.id, { name: "被并乙" });
    const 留人 = await 联系人(a, "13900000051");
    const 并人 = await 联系人(a, "13900000052");
    const 合 = await 合成联系人(prisma, 留人, 并人, 乙);
    if (!合.ok) throw new Error(合.error);
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    const 撤得了 = async (who: 人) => {
      登录.人 = who;
      忘掉企业版范围();
      const 们 = await 并进来的合并单(a);
      return { 客户: 们.find((x) => x.id === r.mergeId)?.能撤, 联系人: 们.find((x) => x.id === 合.mergeId)?.能撤 };
    };
    expect(await 撤得了(乙)).toEqual({ 客户: true, 联系人: true });
    // 只读角色（管理员）：看得到，两张都不给撤
    expect(await 撤得了(丁)).toEqual({ 客户: false, 联系人: false });
    // 留下那家转给了丙：乙的客户单、合成单都不摆（服务端「现在不归你负责」，合成单同撤回合并，第二单 b 建议 2）；系统管理员照样能撤
    await raw.customer.update({ where: { id: a }, data: { salesOwnerId: 丙.id } });
    expect(await 撤得了(乙)).toEqual({ 客户: false, 联系人: false });
    登录.人 = 乙;
    expect(await 撤回合并(prisma, r.mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("不归你负责") });
    expect(await 撤得了(老板)).toEqual({ 客户: true, 联系人: true });
    // 回到乙名下、进了公海：同样不摆
    await raw.customer.update({ where: { id: a }, data: { salesOwnerId: 乙.id } });
    await raw.customerPool.create({ data: { customerId: a } });
    expect((await 撤得了(乙)).客户).toBe(false);
    await raw.customerPool.delete({ where: { customerId: a } });
    expect((await 撤得了(乙)).客户).toBe(true);
    // 被并那家（在回收站里）在转让交接中：系统管理员也不摆，合成单（只看留下这家）照旧
    const 交 = await raw.entHandover.create({ data: { kind: "转让", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 乙.id, customerIds: JSON.stringify([b]) } });
    expect(await 撤得了(老板)).toEqual({ 客户: false, 联系人: true });
    expect(await 撤回合并(prisma, r.mergeId, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("转让交接中") });
    await raw.entHandover.update({ where: { id: 交.id }, data: { status: "已撤回" } });
    // 留下这家在转让交接中：两张都不摆
    const 交2 = await raw.entHandover.create({ data: { kind: "转让", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 乙.id, customerIds: JSON.stringify([a]) } });
    expect(await 撤得了(乙)).toEqual({ 客户: false, 联系人: false });
    await raw.entHandover.update({ where: { id: 交2.id }, data: { status: "已撤回" } });
    // 乙在离职交接中（一键全部交给）：客户单不摆（同服务端 离职交接拦），合成单照旧
    await raw.entHandover.create({ data: { kind: "离职", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 老板.id, way: "全部" } });
    expect(await 撤得了(乙)).toEqual({ 客户: false, 联系人: true });
    expect(await 撤回合并(prisma, r.mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("离职交接中") });
  });
});

describe("第三阶段界面要的（11-25）", () => {
  const 都看得到 = async () => true;
  it("界面抄的两句和服务端一致：「已核对…」那句、撤回期限天数（MergeHost.tsx 不能引 customer-merge.ts，抄了一份）", () => {
    const 源 = readFileSync("src/app/(app)/customers/[id]/MergeHost.tsx", "utf8");
    expect(源).toContain(`export const 已核对话 = "${已核对话}";`);
    expect(源).toContain(`const 撤回天数 = ${撤回期限天数};`);
  });
  it("项目来历：合并挪过来的写「从 NO.xxxxx「B」并入」；之后又换客户的以最近一次为准，原客户看不到只给编号；撤回合并后不再说", async () => {
    const a = await 客户(乙.id, { name: "留下甲", customerNo: 11 });
    const b = await 客户(乙.id, { name: "被并乙", customerNo: 12 });
    const c = await 客户(乙.id, { name: "第三家丙", customerNo: 13 });
    const p = await 项目(乙.id, b);
    const 本来 = await 项目(乙.id, a);
    expect(await 项目来历(prisma, p, b, 都看得到)).toBeNull();
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 项目来历(prisma, p, a, 都看得到)).toMatchObject({ 话: expect.stringMatching(/^从 NO\.?0*12「被并乙」并入$/), 怎么来: "合并客户" });
    expect(await 项目来历(prisma, 本来, a, 都看得到)).toBeNull();
    // 再换到丙：以最近一次（换客户）为准；原客户看不到只给编号
    expect((await 项目换客户(prisma, p, c, 乙)).ok).toBe(true);
    expect(await 项目来历(prisma, p, c, 都看得到)).toMatchObject({ 话: expect.stringMatching(/「留下甲」并入$/), 怎么来: "项目换客户" });
    expect((await 项目来历(prisma, p, c, async () => false))!.话).not.toContain("留下甲");
    // 换回 A：A 这边最近一次是换客户（从丙）
    expect((await 项目换客户(prisma, p, a, 乙)).ok).toBe(true);
    expect(await 项目来历(prisma, p, a, 都看得到)).toMatchObject({ 话: expect.stringContaining("「第三家丙」并入"), 怎么来: "项目换客户" });
  });

  it("撤回合并后，挪过的项目不再说「并入」", async () => {
    const a = await 客户(乙.id, { name: "留下甲" });
    const b = await 客户(乙.id, { name: "被并乙" });
    const p = await 项目(乙.id, b);
    const r = await 执行合并(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    expect(await 项目来历(prisma, p, a, 都看得到)).not.toBeNull();
    expect((await 撤回合并(prisma, r.mergeId, 乙)).ok).toBe(true);
    expect(await 项目来历(prisma, p, a, 都看得到)).toBeNull();
    expect(await 项目来历(prisma, p, b, 都看得到)).toBeNull();
  });

  it("并进来的合并单：带上这位客户名下单独合成的联系人（kind 联系人、到 = 留下那位）；合并时勾的不单列", async () => {
    const a = await 客户(乙.id, { name: "甲" });
    const 留 = await 联系人(a, "13900000041");
    const 并 = await 联系人(a, "13900000042");
    const r = await 合成联系人(prisma, 留, 并, 乙);
    if (!r.ok) throw new Error(r.error);
    const b = await 客户(乙.id, { name: "乙家" });
    const b人 = await 联系人(b, "13900000043");
    const m = await 执行合并(prisma, a, b, 乙, { 同一个人: [{ 留, 并: b人 }] });
    if (!m.ok) throw new Error(m.error);
    登录.人 = 乙;
    const 们 = await 并进来的合并单(a);
    expect(们.map((x) => x.kind).sort()).toEqual(["客户", "联系人"]);
    const 合成单 = 们.find((x) => x.kind === 联系人单)!;
    expect(合成单).toMatchObject({ id: r.mergeId, 编号: null, 能撤: true, status: "已合并" });
    expect(合成单.到).toMatch(/^联系人/);
    登录.人 = 丙;
    expect((await 并进来的合并单(a)).every((x) => !x.能撤)).toBe(true);
  });
});

