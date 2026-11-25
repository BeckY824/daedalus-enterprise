/**
 * 合并客户第一批 · 服务端审查第二单 b（11-25，PR #457）剩下的建议：
 *   - 建议 2：撤回合成联系人同撤回合并——客户现在不归撤回的人负责（换了负责人、进了公海）只有系统管理员能撤；界面「能撤」同一判断
 *   - 建议 3：撤回合并只拆还在 A 名下的单独合成；B 来的人后来换主客户到 C、在 C 名下合成过的不拆
 *   - 建议 4：同步冲突指着被并那家（对照行已改指 A）：定冲突时说「已并入」，不说「原系统这条又变了」
 *   - 建议 5：撤销项目换客户时原序号已被原客户新建的重复咨询占了：回一句话，不报 500
 * （建议 1 守卫认人正则在 tests/sync-tables.test.ts）
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
import { 执行合并, 撤回合并, 合成联系人 } from "@/lib/enterprise/customer-merge";
import { 项目换客户, 撤销换客户, 序号被占话 } from "@/lib/enterprise/project-move-customer";
import { 并进来的合并单 } from "@/app/(app)/customers/merge-actions";
import { 定冲突, 已并入话 } from "@/lib/enterprise-import/resolve";

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
const 再一位 = async (customerId: string) => (await raw.contact.create({ data: { customerId, name: `联系人${++序}`, phone: `1380000${String(序).padStart(4, "0")}` } })).id;
const 并成 = async (a: string, b: string, me: 人) => {
  const r = await 执行合并(prisma, a, b, me);
  if (!r.ok) throw new Error(r.error);
  return r.mergeId;
};
const 合成 = async (留: string, 并: string, me: 人) => {
  const r = await 合成联系人(prisma, 留, 并, me);
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
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("建议 2 撤回合成联系人：客户现在不归本人负责的只有系统管理员能撤", () => {
  it("合成之后客户换了负责人：本人撤不了、界面不摆撤回；系统管理员能撤", async () => {
    const a = await 客户(乙.id);
    const 留 = await 主联系人(a);
    const 并 = await 再一位(a);
    const m = await 合成(留, 并, 乙);
    登录.人 = 乙;
    expect((await 并进来的合并单(a)).find((x) => x.id === m)).toMatchObject({ 能撤: true });

    await raw.customer.update({ where: { id: a }, data: { salesOwnerId: 丙.id } });
    expect((await 并进来的合并单(a)).find((x) => x.id === m)).toMatchObject({ 能撤: false });
    expect(await 撤回合并(prisma, m, 乙)).toEqual({ ok: false, error: expect.stringContaining("现在不归你负责，请找系统管理员撤回") });
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: m } })).status).toBe("已合并");

    登录.人 = 老板;
    expect((await 并进来的合并单(a)).find((x) => x.id === m)).toMatchObject({ 能撤: true });
    expect(await 撤回合并(prisma, m, 老板)).toMatchObject({ ok: true });
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: m } })).status).toBe("已撤回");
  });

  it("合成之后客户进了公海（负责人还是本人）：本人撤不了、界面不摆撤回", async () => {
    const a = await 客户(乙.id);
    const m = await 合成(await 主联系人(a), await 再一位(a), 乙);
    await raw.customerPool.create({ data: { customerId: a } });
    登录.人 = 乙;
    expect((await 并进来的合并单(a)).find((x) => x.id === m)).toMatchObject({ 能撤: false });
    expect(await 撤回合并(prisma, m, 乙)).toEqual({ ok: false, error: expect.stringContaining("现在不归你负责") });
  });
});

describe("建议 3 撤回合并只拆还在 A 名下的单独合成", () => {
  it("B 来的人后来换主客户到 C、在 C 名下合成过：撤回 B→A 不拆 C 的合成，这位留在 C；A 名下的照拆", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const c = await 客户(乙.id);
    const b1 = await 主联系人(b);
    const b2 = await 再一位(b);
    const a1 = await 主联系人(a);
    const c1 = await 主联系人(c);
    const mergeId = await 并成(a, b, 乙);
    // b2 在 A 名下合成进 a1（该拆）；b1 换到 C、合成进 c1（不该拆）
    const 在A = await 合成(a1, b2, 乙);
    await raw.contact.update({ where: { id: b1 }, data: { customerId: c, isPrimary: false } });
    const 在C = await 合成(c1, b1, 乙);

    const r = await 撤回合并(prisma, mergeId, 乙);
    expect(r).toMatchObject({ ok: true, 提示: "先拆开了 1 次联系人合成" });
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 在A } })).status).toBe("已撤回");
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 在C } })).status).toBe("已合并");
    // C 的合成还在：b1 照旧合成掉、挂在 C；b2 拆回后随合并回 B
    expect(await raw.contact.findUniqueOrThrow({ where: { id: b1 } })).toMatchObject({ customerId: c, deletedAt: expect.any(Date) });
    expect(await raw.contact.findUniqueOrThrow({ where: { id: b2 } })).toMatchObject({ customerId: b, deletedAt: null });
    expect(r.ok && r.没还原).toEqual(expect.arrayContaining([expect.objectContaining({ 类: "联系人", id: b1 })]));
  });
});

describe("建议 4 待定的同步冲突指着被并那家", () => {
  it("合并后定冲突：说「已并入」，不说「原系统这条又变了」；照旧标已过时", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    await raw.entExternalRef.create({ data: { source: "excel", entity: "customer", externalId: "C1", targetId: b, fingerprint: "fp1", written: "{}", raw: "{}" } });
    const 冲 = await raw.entConflict.create({
      data: { source: "excel", entity: "customer", externalId: "C1", targetId: b, fields: JSON.stringify({ remark: { 原系统: "新", 我们: "旧", 上次: "" } }), incoming: JSON.stringify({ 实体: "customer", 外部ID: "C1", 值: { name: "x", remark: "新" }, 指纹: "fp1" }) },
    });
    await 并成(a, b, 乙);
    expect((await raw.entExternalRef.findFirstOrThrow({ where: { externalId: "C1" } })).targetId).toBe(a);

    const r = await 定冲突([冲.id], "保留我们", 老板);
    expect(r).toMatchObject({ 定了: 0, 过时: 1, 没定: [{ 冲突Id: 冲.id, 原因: 已并入话 }] });
    expect((await raw.entConflict.findUniqueOrThrow({ where: { id: 冲.id } })).status).toBe("已过时");
  });

  it("对照行换了别的客户但不是合并（没有合并单）：照旧说「原系统这条又变了」", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    await raw.entExternalRef.create({ data: { source: "excel", entity: "customer", externalId: "C1", targetId: a, fingerprint: "fp1", written: "{}", raw: "{}" } });
    const 冲 = await raw.entConflict.create({
      data: { source: "excel", entity: "customer", externalId: "C1", targetId: b, fields: "{}", incoming: JSON.stringify({ 实体: "customer", 外部ID: "C1", 值: { name: "x" }, 指纹: "fp1" }) },
    });
    const r = await 定冲突([冲.id], "保留我们", 老板);
    expect(r.没定).toEqual([expect.objectContaining({ 原因: "记下之后原系统这条又变了" })]);
  });
});

describe("建议 5 撤销项目换客户撞序号", () => {
  it("换走之后原客户又建了重复咨询占了原序号：撤销回一句话、整笔不动", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const p = await 项目(乙.id, b, { repeatOfCustomerId: b, repeatSeq: 2 });
    const r = await 项目换客户(prisma, p, a, 乙);
    if (!r.ok) throw new Error(r.error);
    await 项目(乙.id, b, { repeatOfCustomerId: b, repeatSeq: 2 });

    expect(await 撤销换客户(prisma, r.logId, 乙)).toEqual({ ok: false, error: 序号被占话 });
    expect(await raw.project.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ customerId: a, repeatOfCustomerId: a });
    expect(await raw.auditLog.count({ where: { action: "project-move-customer-undo" } })).toBe(0);
  });
});
