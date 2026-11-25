/**
 * 合并客户第一批 · 服务端审查（11-25，PR #457）：
 *   - 必改 1：合并、撤回合并都拦「离职交接待确认」（两家本身被盖住、或两家名下项目在离职交接里；同项目换客户）
 *   - 必改 2：撤回时整组留在 A 的联系人 / 项目，名下的号码、挂靠、沟通、卡点不单独改回 B
 *   - 建议 1：撤回后 A 留下的项目引用了回 B 的联系人：给这几位挂靠到 A
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
import { 合并预览, 执行合并, 撤回合并 } from "@/lib/enterprise/customer-merge";
import { 挂靠说明 } from "@/lib/enterprise/project-move-customer";

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


const 离职 = (way: string, 补: Record<string, unknown> = {}) =>
  raw.entHandover.create({ data: { kind: "离职", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 老板.id, way, ...补 } });

describe("必改 1 离职交接待确认", () => {
  it("B 被离职交接盖住（一键全部交给 / 交这位客户）、或 B 名下项目在交项目里：预览、执行都拦；撤回交接后能并", async () => {
    const a = await 客户(丙.id);
    const b = await 客户(乙.id);
    const p = await 项目(乙.id, b);
    for (const 补 of [{ way: "全部" }, { way: "客户", customerIds: JSON.stringify([b]) }, { way: "项目", projectIds: JSON.stringify([p]) }]) {
      const h = await 离职(补.way, 补);
      expect(await 合并预览(prisma, a, b, 老板)).toMatchObject({ 能并: false, 原因: [expect.stringContaining("离职交接中")] });
      expect(await 执行合并(prisma, a, b, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("离职交接中") });
      await raw.entHandover.update({ where: { id: h.id }, data: { status: "已撤回" } });
    }
    // 别人（丙）名下的离职交接不盖 B
    await raw.entHandover.create({ data: { kind: "离职", fromUserId: 丙.id, toUserId: 老板.id, byUserId: 老板.id, way: "项目", projectIds: "[]" } });
    expect(await 合并预览(prisma, a, b, 老板)).toMatchObject({ 能并: true });
    expect((await 执行合并(prisma, a, b, 老板)).ok).toBe(true);
    expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).customerId).toBe(a);
  });

  it("合并之后 B 有离职交接待确认（交客户 B / 交挪过去的项目）：撤回被拦；撤回交接后能撤", async () => {
    const a = await 客户(丙.id);
    const b = await 客户(乙.id);
    const p = await 项目(乙.id, b);
    const mergeId = await 并成(a, b, 老板);
    for (const 补 of [{ way: "客户", customerIds: JSON.stringify([b]) }, { way: "项目", projectIds: JSON.stringify([p]) }]) {
      const h = await 离职(补.way, 补);
      expect(await 撤回合并(prisma, mergeId, 老板)).toMatchObject({ ok: false, error: expect.stringContaining("离职交接中") });
      await raw.entHandover.update({ where: { id: h.id }, data: { status: "已撤回" } });
    }
    expect((await 撤回合并(prisma, mergeId, 老板)).ok).toBe(true);
    expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).customerId).toBe(b);
  });
});

describe("必改 2 整组留在 A 的联系人 / 项目，名下的行不单独改回 B", () => {
  it("B 来的关键联系人合并后设成 A 的关键：撤回后人留 A，他的号码、挂靠也还在 A", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const b1 = await 主联系人(b);
    const cm = await 号(b, b1, "13855556666");
    const 挂 = await raw.contactCustomer.create({ data: { contactId: b1, customerId: b } });
    const mergeId = await 并成(a, b, 乙);
    expect((await raw.contact.findUniqueOrThrow({ where: { id: b1 } })).isPrimary).toBe(false);
    await raw.contact.update({ where: { id: b1 }, data: { isPrimary: true } });
    const u = await 撤回合并(prisma, mergeId, 乙);
    if (!u.ok) throw new Error(u.error);
    expect(await raw.contact.findUniqueOrThrow({ where: { id: b1 } })).toMatchObject({ customerId: a, isPrimary: true });
    expect((await raw.contactMethod.findUniqueOrThrow({ where: { id: cm.id } })).customerId).toBe(a);
    expect((await raw.contactCustomer.findUniqueOrThrow({ where: { id: 挂.id } })).customerId).toBe(a);
    expect(u.没还原).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: b1, 类: "联系人" }),
      expect.objectContaining({ id: cm.id, 原因: "随联系人留在原处" }),
      expect.objectContaining({ id: 挂.id, 原因: "随联系人留在原处" }),
    ]));
  });

  it("B 的项目合并后被改过、整组留 A：它的沟通、卡点也留 A；B 别的沟通照样回 B", async () => {
    const ch = await raw.channel.create({ data: { name: "测试渠道|甲", channelOwnerId: 丙.id } });
    const ch2 = await raw.channel.create({ data: { name: "测试渠道|乙", channelOwnerId: 丙.id } });
    const a = await 客户(乙.id);
    const b = await 客户(乙.id, { channelId: ch.id });
    const p = await 项目(乙.id, b);
    const f = await 沟通(b);
    await raw.followUpProject.create({ data: { followUpId: f.id, projectId: p, node: "x" } });
    const 别的 = await 沟通(b);
    const 卡 = await raw.entBlocker.create({ data: { code: "BLK-3", projectId: p, customerId: b, phase: "商机", type: "轻度卡点", impact: "短期不影响", obstacle: "x", description: "x", dueDays: 3, dueAt: new Date(), creatorId: 乙.id } });
    const r = await 执行合并(prisma, a, b, 乙, { 已核对: true });
    if (!r.ok) throw new Error(r.error);
    expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).channelId).toBe(ch.id);
    await raw.project.update({ where: { id: p }, data: { channelId: ch2.id } });
    const u = await 撤回合并(prisma, r.mergeId, 乙);
    if (!u.ok) throw new Error(u.error);
    expect((await raw.project.findUniqueOrThrow({ where: { id: p } })).customerId).toBe(a);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: f.id } })).customerId).toBe(a);
    expect((await raw.entBlocker.findUniqueOrThrow({ where: { id: 卡.id } })).customerId).toBe(a);
    expect((await raw.followUp.findUniqueOrThrow({ where: { id: 别的.id } })).customerId).toBe(b);
    expect(u.没还原).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: p, 类: "项目" }),
      expect.objectContaining({ id: f.id, 原因: "随项目留在原处" }),
      expect.objectContaining({ id: 卡.id, 原因: "随项目留在原处" }),
    ]));
  });
});

describe("建议 1 A 留下的项目引用了回 B 的人", () => {
  it("合并后在 A 上新建的项目把 B 来的人设成主联系人 / 项目联系人：撤回后人回 B、项目留 A，这几位挂靠到 A", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(乙.id);
    const b1 = await 主联系人(b);
    const b2 = (await raw.contact.create({ data: { name: "b2", customerId: b } })).id;
    const mergeId = await 并成(a, b, 乙);
    const 新 = await 项目(乙.id, a, { contactId: b1 });
    await raw.projectContact.create({ data: { projectId: 新, contactId: b2 } });
    expect(await 撤回合并(prisma, mergeId, 乙)).toMatchObject({ ok: true, 没还原: [] });
    expect((await raw.project.findUniqueOrThrow({ where: { id: 新 } })).customerId).toBe(a);
    for (const c of [b1, b2]) {
      expect((await raw.contact.findUniqueOrThrow({ where: { id: c } })).customerId).toBe(b);
      expect(await raw.contactCustomer.findFirst({ where: { contactId: c, customerId: a } })).toMatchObject({ note: 挂靠说明 });
    }
  });
});
