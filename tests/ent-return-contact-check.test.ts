/**
 * 退回公海前查联系方式（企业版 V3.5.1 M-公海-15，11-05，lib/enterprise/return-contact-check.ts）：
 *   11-05 用户：「只要有人要把手上的线索、商机或订单扔回去（比如退回公海），一定一定要先检查联系方式是否为空。
 *   如果不为空且正确的话，可以退；如果为空、不为空但错误，则都退不了。」「也包括客户联系人、项目」
 *   - 查：客户电话 + 客户名下联系人的每个号码 + 项目挂的联系人（主联系人、项目联系人表，可能是别家的）
 *   - 一个都没有 → 拦；有一个不对 → 拦；全对 → 放行
 *   - 所有角色；客户放回公海（单个 / 批量跳过）、项目放回项目公海、线索验证退回公海都管
 *   - 建项目向导公海捞取（分配放行）不管
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 放回公海 } from "@/lib/project/db";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";
import { 联系方式空话 } from "@/lib/enterprise/return-contact-check";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(phone: string, ownerId = 乙.id) {
  return (await prisma.customer.create({ data: { name: `客户${++序}`, phone, salesOwnerId: ownerId } })).id;
}
async function 联系人(customerId: string, 补: { phone?: string; email?: string; wechat?: string; name?: string } = {}) {
  return (await prisma.contact.create({ data: { name: 补.name ?? `联系人${++序}`, customerId, phone: 补.phone ?? null, email: 补.email ?? null, wechat: 补.wechat ?? null } })).id;
}
async function 项目(customerId: string, 补: Record<string, unknown> = {}) {
  return (await prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId: 乙.id, creatorId: 乙.id, ...补 } })).id;
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 在客户公海 = async (id: string) => !!(await raw.customerPool.findUnique({ where: { customerId: id } }));
const 在项目公海 = async (id: string) => !!(await raw.project.findUniqueOrThrow({ where: { id } })).pooledAt;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  await prisma.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }] });
  await setSetting("business", { projectMode: true });
  当(乙);
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("客户放回公海", () => {
  it("客户电话空、没有联系人：拦，说联系方式是空的", async () => {
    const id = await 客户("");
    const r = await 放进公海([id], "客户主动终止");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(联系方式空话);
    expect(await 在客户公海(id)).toBe(false);
  });

  it("客户电话填了但不对：拦，说哪个号不对", async () => {
    const id = await 客户("12");
    const r = await 放进公海([id], "客户主动终止");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/客户电话「12」不对.*改好再退回公海/);
    expect(await 在客户公海(id)).toBe(false);
  });

  it("客户电话对：放行", async () => {
    const id = await 客户("13900001234");
    const r = await 放进公海([id], "客户主动终止");
    expect(r.ok).toBe(true);
    expect(await 在客户公海(id)).toBe(true);
  });

  it("客户电话空、联系人有对的号：放行（联系人的号也算联系方式）", async () => {
    const id = await 客户("");
    await 联系人(id, { phone: "13900001234" });
    expect((await 放进公海([id], "客户主动终止")).ok).toBe(true);
    expect(await 在客户公海(id)).toBe(true);
  });

  it("客户电话对、但有一位联系人的邮箱不对：拦（要全部正确）", async () => {
    const id = await 客户("13900001234");
    await 联系人(id, { name: "王五", email: "不是邮箱" });
    const r = await 放进公海([id], "客户主动终止");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/联系人「王五」的.*改好再退回公海/);
    expect(await 在客户公海(id)).toBe(false);
  });

  it("删了的联系人不查", async () => {
    const id = await 客户("13900001234");
    const 删 = await 联系人(id, { email: "不是邮箱" });
    await raw.contact.update({ where: { id: 删 }, data: { deletedAt: new Date() } });
    expect((await 放进公海([id], "客户主动终止")).ok).toBe(true);
  });

  it("跟着进项目公海的项目挂了别家联系人、号不对：拦", async () => {
    const id = await 客户("13900001234");
    const 别家 = await 客户("13900005678");
    const 外 = await 联系人(别家, { name: "外援", phone: "abc" });
    const p = await 项目(id);
    await prisma.projectContact.create({ data: { projectId: p, contactId: 外 } });
    const r = await 放进公海([id], "客户主动终止");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/联系人「外援」/);
  });

  it("批量：号码有问题的跳过并数出来，其余照放", async () => {
    const 好 = await 客户("13900001234");
    const 空 = await 客户("");
    const 错 = await 客户("1");
    const r = await 放进公海([好, 空, 错], "客户主动终止");
    expect(r.ok).toBe(true);
    expect(r.ok && r.联系方式不全).toBe(2);
    expect(await 在客户公海(好)).toBe(true);
    expect(await 在客户公海(空)).toBe(false);
    expect(await 在客户公海(错)).toBe(false);
  });

  it("批量全都退不了：报第一位的错，前面带客户名", async () => {
    const 空 = await 客户("");
    const 错 = await 客户("1");
    const r = await 放进公海([空, 错], "客户主动终止");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^「客户\d+」/);
  });

  it("所有角色都一样：系统管理员放别人的客户也拦", async () => {
    当(老板);
    const id = await 客户("");
    const r = await 放进公海([id], "客户主动终止");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(联系方式空话);
  });
});

describe("项目放回项目公海", () => {
  it("客户电话空、没联系人：拦，项目不动", async () => {
    const c = await 客户("");
    const p = await 项目(c);
    const r = await 放回公海(乙, p);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(联系方式空话);
    expect(await 在项目公海(p)).toBe(false);
  });

  it("项目主联系人是别家的、号不对：拦", async () => {
    const c = await 客户("13900001234");
    const 别家 = await 客户("13900005678");
    const 外 = await 联系人(别家, { name: "外援", wechat: "" , phone: "12" });
    const p = await 项目(c, { contactId: 外 });
    const r = await 放回公海(乙, p);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/联系人「外援」/);
    expect(await 在项目公海(p)).toBe(false);
  });

  it("全对：放行", async () => {
    const c = await 客户("13900001234");
    const p = await 项目(c);
    expect((await 放回公海(乙, p)).ok).toBe(true);
    expect(await 在项目公海(p)).toBe(true);
  });

  it("分配放行（建项目向导公海捞取）不查", async () => {
    const c = await 客户("");
    const p = await 项目(c);
    expect((await 放回公海(乙, p, undefined, { 分配放行: true })).ok).toBe(true);
  });
});
