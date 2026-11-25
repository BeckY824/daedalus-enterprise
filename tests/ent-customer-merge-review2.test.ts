/**
 * 合并客户第一批 · 独立审查第二单（11-25；方案 docs/合并客户-第一批-落地.md）。审查复现的场景改写成正式用例：
 *   - M3：合并后又单独合成过联系人（留 A 的人 / 留 B 来的人），撤回合并时先把这些单独合成拆开再撤，号码、沟通不错位
 *   - M4：合并后挂在挪过来的项目 / 联系人上的新沟通、卡点、号码，撤回时跟着回 B；新加的 A 的人的项目联系人挂靠到 B
 *   - M6：被并那家档案里的查重号码（WhatsApp / 微信 / 邮箱 / 阿里国际站买家 ID）：A 空的补上、B 的清空，撤回换回；A 有值的预览里列出
 *   - 建议 4–8：项目来历合并这条路也判看不看得到原客户；没还原叫中文、存进合并单；备注补空；撤回后原负责人已停用走 P-删-06；
 *     待补建记录的客户编号现读
 *   - 第一单遗留：系统管理员代换客户后撤销，同一批人收到「撤销了」通知；撤回合成拦交接中
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
import { 合并预览, 执行合并, 撤回合并, 合成联系人, 项目来历, 联系人单 } from "@/lib/enterprise/customer-merge";
import { 项目换客户, 撤销换客户, 挂靠说明, 换客户通知种类 } from "@/lib/enterprise/project-move-customer";
import { 并进来的合并单 } from "@/app/(app)/customers/merge-actions";
import { 读待补建栏 } from "@/lib/enterprise/repeat-unbuilt";
import { 无负责人占位邮箱 } from "@/lib/pool";

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
const 号 = (customerId: string, contactId: string, v: string) => raw.contactMethod.create({ data: { customerId, contactId, kind: "phone", value: v, numberKey: v } });
const 沟通 = (customerId: string, 补: Record<string, unknown> = {}) =>
  raw.followUp.create({ data: { type: "PHONE", title: "沟通", content: "x", customerId, ownerId: 乙.id, occurredAt: new Date(), ...补 } });
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

describe("M3 合并后单独合成过联系人，撤回合并", () => {
  it("留 A 的人、合掉 B 来的人：先拆开那次合成，号码、沟通回到 B 来的那位，B 来的那位回 B、不在回收站", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const a1 = await 主联系人(a);
    const b1 = await 主联系人(b);
    const m = await 号(b, b1, "13811112222");
    const f = await 沟通(b, { contactId: b1 });
    const mergeId = await 并成(a, b, 乙);
    const 合成单 = await 合成(a1, b1, 乙);
    const u = await 撤回合并(prisma, mergeId, 乙);
    expect(u).toMatchObject({ ok: true, 没还原: [], 提示: "先拆开了 1 次联系人合成" });
    expect(await raw.contactMethod.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ contactId: b1, customerId: b });
    expect(await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ contactId: b1, customerId: b });
    expect(await raw.contact.findUniqueOrThrow({ where: { id: b1 } })).toMatchObject({ customerId: b, deletedAt: null });
    expect(await raw.contact.findUniqueOrThrow({ where: { id: a1 } })).toMatchObject({ customerId: a, deletedAt: null });
    expect(await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 合成单 } })).toMatchObject({ kind: 联系人单, status: "已撤回" });
    expect((await raw.auditLog.findFirstOrThrow({ where: { action: "merge-undo", entityId: a } })).summary).toContain("先拆开了 1 次联系人合成");
  });

  it("反过来留 B 来的人、合掉 A 的人：A 的人回到 A、号码还是他的；B 来的人回 B", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const a1 = await 主联系人(a);
    const b1 = await 主联系人(b);
    const ma = await 号(a, a1, "13822223333");
    const mb = await 号(b, b1, "13844445555");
    const mergeId = await 并成(a, b, 乙);
    await 合成(b1, a1, 乙);
    expect(await 撤回合并(prisma, mergeId, 乙)).toMatchObject({ ok: true, 没还原: [] });
    expect(await raw.contactMethod.findUniqueOrThrow({ where: { id: ma.id } })).toMatchObject({ contactId: a1, customerId: a });
    expect(await raw.contactMethod.findUniqueOrThrow({ where: { id: mb.id } })).toMatchObject({ contactId: b1, customerId: b });
    expect(await raw.contact.findUniqueOrThrow({ where: { id: a1 } })).toMatchObject({ customerId: a, deletedAt: null, isPrimary: true });
    expect(await raw.contact.findUniqueOrThrow({ where: { id: b1 } })).toMatchObject({ customerId: b, deletedAt: null, isPrimary: true });
  });

  it("不连锁拆：B 来的人合进 A 的人之后，A 的人又合进 A 自家另一位——后一次不拆，号码留在原处记没还原", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const a1 = await 主联系人(a);
    const a2 = (await raw.contact.create({ data: { name: "a2", customerId: a } })).id;
    const b1 = await 主联系人(b);
    const m = await 号(b, b1, "13866667777");
    const mergeId = await 并成(a, b, 乙);
    await 合成(a1, b1, 乙);
    const 连锁 = await 合成(a2, a1, 乙);
    const u = await 撤回合并(prisma, mergeId, 乙);
    expect(u).toMatchObject({ ok: true, 提示: "先拆开了 1 次联系人合成" });
    expect((u as { 没还原: { id: string }[] }).没还原.filter((x) => x.id === m.id)).toHaveLength(1);
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 连锁 } })).status).toBe("已合并");
    expect(await raw.contactMethod.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ contactId: a2, customerId: a });
  });

  it("合并之前 B 自己合成过的不拆；只有 A 自己两位之间的合成也不拆", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const b1 = await 主联系人(b);
    const b2 = (await raw.contact.create({ data: { name: "b2", customerId: b } })).id;
    const a1 = await 主联系人(a);
    const a2 = (await raw.contact.create({ data: { name: "a2", customerId: a } })).id;
    const 早 = await 合成(b1, b2, 乙);
    await raw.entCustomerMerge.update({ where: { id: 早 }, data: { at: new Date(Date.now() - 60_000) } });
    const mergeId = await 并成(a, b, 乙);
    const 自家 = await 合成(a1, a2, 乙);
    const u = await 撤回合并(prisma, mergeId, 乙);
    expect(u).toMatchObject({ ok: true, 没还原: [] });
    expect((u as { 提示?: string }).提示).toBeUndefined();
    for (const id of [早, 自家]) expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id } })).status).toBe("已合并");
    expect(await raw.contact.findUniqueOrThrow({ where: { id: b2 } })).toMatchObject({ customerId: b });
    expect((await raw.contact.findUniqueOrThrow({ where: { id: b2 } })).deletedAt).not.toBeNull();
  });
});

describe("M4 挂在挪过来的项目、联系人上的新行跟着回去", () => {
  it("合并后在挪来的项目上记的沟通、发的卡点、给 B 来的人加的号：撤回后都回 B；挂在 A 本身的不回；新加的 A 的人挂靠到 B", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const a1 = await 主联系人(a);
    const b1 = await 主联系人(b);
    const p = await 项目(乙.id, b);
    const mergeId = await 并成(a, b, 乙);
    const f = await 沟通(a);
    await raw.followUpProject.create({ data: { followUpId: f.id, projectId: p, node: "x" } });
    const 只在A = await 沟通(a);
    const 卡 = await raw.entBlocker.create({ data: { code: "BLK-1", projectId: p, customerId: a, phase: "商机", type: "轻度卡点", impact: "短期不影响", obstacle: "x", description: "x", dueDays: 3, dueAt: new Date(), creatorId: 乙.id } });
    const cm = await 号(a, b1, "13833334444");
    await raw.projectContact.create({ data: { projectId: p, contactId: a1 } });
    expect(await 撤回合并(prisma, mergeId, 乙)).toMatchObject({ ok: true, 没还原: [] });
    expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).customerId).toBe(b);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).customerId).toBe(b);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: 只在A.id } })).customerId).toBe(a);
    expect((await raw.entBlocker.findUniqueOrThrow({ where: { id: 卡.id } })).customerId).toBe(b);
    expect((await raw.contactMethod.findUniqueOrThrow({ where: { id: cm.id } })).customerId).toBe(b);
    expect(await raw.contactCustomer.findFirst({ where: { contactId: a1, customerId: b } })).toMatchObject({ note: 挂靠说明 });
  });
});

describe("M6 档案里的查重号码", () => {
  it("A 空的用 B 的补上、B 的清空；A 有值的不动、预览列出；撤回换回去", async () => {
    const a = await 客户(乙.id, { extra: { create: { email: "a@x.com" } } });
    const b = await 客户(乙.id, { extra: { create: { whatsapp: "+8613900001111", email: "b@x.com", alibabaId: "ali-b" } } });
    const pv = await 合并预览(prisma, a, b, 乙);
    expect(pv.补空).toEqual(expect.arrayContaining(["WhatsApp", "阿里国际站买家 ID"]));
    expect(pv.号格留下有值).toEqual(["邮箱"]);
    const mergeId = await 并成(a, b, 乙);
    expect(await raw.customerExtra.findUniqueOrThrow({ where: { customerId: a } })).toMatchObject({ whatsapp: "+8613900001111", email: "a@x.com", alibabaId: "ali-b" });
    expect(await raw.customerExtra.findUniqueOrThrow({ where: { customerId: b } })).toMatchObject({ whatsapp: null, email: "b@x.com", alibabaId: null });
    expect(await 撤回合并(prisma, mergeId, 乙)).toMatchObject({ ok: true, 没还原: [] });
    expect(await raw.customerExtra.findUniqueOrThrow({ where: { customerId: a } })).toMatchObject({ whatsapp: null, email: "a@x.com", alibabaId: null });
    expect(await raw.customerExtra.findUniqueOrThrow({ where: { customerId: b } })).toMatchObject({ whatsapp: "+8613900001111", email: "b@x.com", alibabaId: "ali-b" });
  });

  it("A 没有档案行：合并时新建，撤回清完删掉；A 补进去的号之后改过的留着、B 的照样换回", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id, { extra: { create: { wechat: "wx-b" } } });
    const mergeId = await 并成(a, b, 乙);
    expect((await raw.customerExtra.findUniqueOrThrow({ where: { customerId: a } })).wechat).toBe("wx-b");
    expect(await 撤回合并(prisma, mergeId, 乙)).toMatchObject({ ok: true, 没还原: [] });
    expect(await raw.customerExtra.findUnique({ where: { customerId: a } })).toBeNull();
    expect((await raw.customerExtra.findUniqueOrThrow({ where: { customerId: b } })).wechat).toBe("wx-b");

    const m2 = await 并成(a, b, 乙);
    await raw.customerExtra.update({ where: { customerId: a }, data: { wechat: "wx-a-new" } });
    const u = await 撤回合并(prisma, m2, 乙);
    expect(u).toMatchObject({ ok: true, 没还原: [{ 类: "客户资料", id: "微信" }] });
    expect((await raw.customerExtra.findUniqueOrThrow({ where: { customerId: a } })).wechat).toBe("wx-a-new");
    expect((await raw.customerExtra.findUniqueOrThrow({ where: { customerId: b } })).wechat).toBe("wx-b");
  });
});

describe("建议 6 备注", () => {
  it("A 备注空的用 B 的补、撤回清回空；A 有备注的不合并文字，B 的备注记进合并单，合并单列表读得出", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id, { remark: "B 的备注" });
    const m1 = await 并成(a, b, 乙);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: a } })).remark).toBe("B 的备注");
    expect((await 合并预览(prisma, a, await 客户(乙.id, { remark: "x" }), 乙)).补空).not.toContain("备注");
    expect((await 撤回合并(prisma, m1, 乙)).ok).toBe(true);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: a } })).remark).toBeNull();
    expect((await raw.customer.findUniqueOrThrow({ where: { id: b } })).remark).toBe("B 的备注");

    await raw.customer.update({ where: { id: a }, data: { remark: "A 的备注" } });
    const m2 = await 并成(a, b, 乙);
    expect((await raw.customer.findUniqueOrThrow({ where: { id: a } })).remark).toBe("A 的备注");
    expect(JSON.parse((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: m2 } })).detail).被并备注).toBe("B 的备注");
    登录.人 = 乙;
    expect((await 并进来的合并单(a)).find((x) => x.id === m2)).toMatchObject({ 被并备注: "B 的备注" });
  });
});

describe("建议 4 项目来历合并这条路判看不看得到原客户", () => {
  it("看不到原客户只给编号", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id, { name: "被并的乙家", customerNo: 77 });
    const p = await 项目(乙.id, b);
    await 并成(a, b, 乙);
    const 问了: string[] = [];
    const 看不到 = async (id: string) => { 问了.push(id); return false; };
    const r = await 项目来历(prisma, p, a, 看不到);
    expect(r).toMatchObject({ 怎么来: "合并客户" });
    expect(r!.话).not.toContain("被并的乙家");
    expect(r!.话).toMatch(/^从 NO\.?0*77 并入$/);
    expect(问了).toEqual([b]);
    expect((await 项目来历(prisma, p, a, async () => true))!.话).toContain("被并的乙家");
  });
});

describe("建议 5 没还原叫中文、存进合并单", () => {
  it("沟通之后换到别家：没还原写「沟通」；刷新后合并单列表照样读得出", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const c = await 客户(乙.id);
    const f = await 沟通(b);
    const mergeId = await 并成(a, b, 乙);
    await raw.followUp.update({ where: { id: f.id }, data: { customerId: c } });
    const u = await 撤回合并(prisma, mergeId, 乙);
    expect(u).toMatchObject({ ok: true, 没还原: [{ 类: "沟通", id: f.id }] });
    for (const x of (u as { 没还原: { 类: string }[] }).没还原) expect(x.类).not.toMatch(/[a-z]/);
    登录.人 = 乙;
    expect((await 并进来的合并单(a)).find((x) => x.id === mergeId)).toMatchObject({ status: "已撤回", 没还原: [{ 类: "沟通", 原因: expect.any(String) }] });
  });
});

describe("建议 7 撤回后原负责人已停用", () => {
  it("B 的原负责人已停用：B 回来后清空负责人进客户公海（P-删-06）", async () => {
    await raw.user.create({ data: { email: 无负责人占位邮箱, name: "无负责人", role: "SALES", password: "x", active: false } });
    const a = await 客户(丙.id);
    const b = await 客户(丙.id);
    const mergeId = await 并成(a, b, 老板);
    await raw.user.update({ where: { id: 丙.id }, data: { active: false } });
    忘掉企业版范围();
    expect((await 撤回合并(prisma, mergeId, 老板)).ok).toBe(true);
    const B = await raw.customer.findUniqueOrThrow({ where: { id: b }, select: { deletedAt: true, salesOwnerId: true, pool: true } });
    expect(B.deletedAt).toBeNull();
    expect(B.pool).not.toBeNull();
    expect(B.salesOwnerId).not.toBe(丙.id);
    // A 没动（不是这次恢复回来的）
    expect((await raw.customer.findUniqueOrThrow({ where: { id: a }, select: { salesOwnerId: true } })).salesOwnerId).toBe(丙.id);
  });

  it("知会一声用撤回合并的话：系统管理员收到「撤回了合并……拆回来了」，不说从回收站恢复；撤回的人自己不收", async () => {
    await raw.user.create({ data: { email: 无负责人占位邮箱, name: "无负责人", role: "SALES", password: "x", active: false } });
    const 老板二 = await 造人("boss2", "老板二", "ADMIN");
    await raw.entMember.create({ data: { userId: 老板二.id, bizRole: "director" } });
    const a = await 客户(丙.id);
    const b = await 客户(丙.id);
    const mergeId = await 并成(a, b, 老板);
    await raw.user.update({ where: { id: 丙.id }, data: { active: false } });
    忘掉企业版范围();
    expect((await 撤回合并(prisma, mergeId, 老板)).ok).toBe(true);
    await 等通知推完();
    const 收到 = (await raw.entNotice.findMany({ where: { userId: 老板二.id }, select: { title: true } })).map((n) => n.title).filter((t) => t.includes("已停用"));
    expect(收到).toHaveLength(1);
    expect(收到[0]).toContain("老板 撤回了合并");
    expect(收到[0]).toContain("拆回来了");
    expect(收到[0]).toContain("丙");
    expect(收到[0]).not.toContain("回收站");
    expect((await raw.entNotice.findMany({ where: { userId: 老板.id, title: { contains: "已停用" } } }))).toHaveLength(0);
  });
});

describe("建议 8 待补建记录的客户编号现读", () => {
  it("B 名下的待补建记录随合并到 A：栏里显示 A 的编号", async () => {
    const a = await 客户(乙.id, { customerNo: 11 });
    const b = await 客户(乙.id, { customerNo: 22 });
    const 记录 = {
      状态: "待补建", 类: "没人接", 客户编号: "NO.00022", 渠道: { id: "", 名: "官网" }, 对接人: { 新建: { 名字: "张", 职务: null } },
      沟通: { 方式: null, 类型: "PHONE", 发起方: null, 时间: new Date().toISOString(), 内容: "x" }, 没建原因: "没人接", 线: null,
      客户负责人: { id: 乙.id, 名: 乙.name }, 通知了: { 类别: null, 人: [] }, 交的人: { id: 丙.id, 名: 丙.name }, 交的时间: new Date().toISOString(),
    };
    await raw.entDupeHit.create({ data: { userId: 丙.id, keyType: "手机号", keyValue: "1", customerId: b, result: "没人接", unbuilt: JSON.stringify(记录) } });
    await 并成(a, b, 乙);
    const 栏 = await 读待补建栏(丙);
    expect(栏.我交的.map((x) => x.客户编号)).toEqual(["NO.00011"]);
  });
});

describe("第一单遗留", () => {
  it("系统管理员代换客户后撤销：换客户时收到通知的同一批人再收一条「撤销了」", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id);
    const p = await 项目(乙.id, b);
    const r = await 项目换客户(prisma, p, a, 老板);
    if (!r.ok) throw new Error(r.error);
    await 等通知推完();
    const 换时 = (await raw.entNotice.findMany({ where: { kind: 换客户通知种类 } })).map((n) => n.userId).sort();
    expect(换时).toEqual([乙.id, 丙.id].sort());
    expect((await 撤销换客户(prisma, r.logId, 老板)).ok).toBe(true);
    await 等通知推完();
    const 撤时 = await raw.entNotice.findMany({ where: { kind: 换客户通知种类, title: { contains: "撤销" } } });
    expect(撤时.map((n) => n.userId).sort()).toEqual(换时);
  });

  it("撤回单独合成：客户在转让交接中拦（同撤回合并）", async () => {
    const a = await 客户(乙.id);
    const a1 = await 主联系人(a);
    const a2 = (await raw.contact.create({ data: { name: "a2", customerId: a } })).id;
    const id = await 合成(a1, a2, 乙);
    await raw.entHandover.create({ data: { kind: "转让", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 乙.id, customerIds: JSON.stringify([a]) } });
    expect(await 撤回合并(prisma, id, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("转让交接中") });
  });
});
