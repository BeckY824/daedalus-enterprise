/**
 * P-公海-03：别人把我的客户 / 项目放回公海时，通知原负责人（站内 + 飞书通道，走 notify）。
 *   - 自己放回自己的不通知；操作人自己不收；不相干的同事不收（公海里不露原负责人，P-公海-04）
 *   - 原负责人已停用不发
 *   - 批量：按原负责人各发一条
 *   - 撤销放进公海：再告诉原负责人一声客户回来了
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 放进公海, 撤销公海, 退回原因选项 } from "@/app/(app)/customers/pool-actions";
import { 放回项目公海 } from "@/app/(app)/projects/actions";
import { saveBusiness, getBusiness } from "@/lib/business";

type 人 = { id: string; name: string; role: string };
let 总管: 人;
let 上级: 人;
let 乙: 人;
let 丙: 人;

async function 造人(email: string, name: string, role: string, bizRole: string, managerId?: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  await raw.entMember.create({ data: { userId: u.id, bizRole, managerId: managerId ?? null } });
  return { id: u.id, name, role };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { 当(u); return 以谁的身份(u.id, fn); };
let 序号 = 0;
const 客户 = async (ownerId: string, name: string) => (await raw.customer.create({ data: { name, phone: `139${String(++序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
const 项目 = async (ownerId: string, customerId: string, name: string) => (await raw.project.create({ data: { name, customerId, ownerId, creatorId: ownerId } })).id;
const 通知of = async (u: 人) => {
  await 等通知推完();
  return raw.entNotice.findMany({ where: { userId: u.id }, orderBy: { createdAt: "asc" }, select: { kind: true, title: true, body: true, link: true } });
};
const 原因 = async () => (await 退回原因选项())[0];

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir@x", "总管某", "ADMIN", "director");
  上级 = await 造人("mgr@x", "上级某", "MANAGER", "sales_mgr");
  乙 = await 造人("yi@x", "销售乙", "SALES", "sales", 上级.id);
  丙 = await 造人("bing@x", "销售丙", "SALES", "sales", 上级.id);
  await raw.user.create({ data: { email: "no-owner@placeholder.local", name: "无负责人", role: "SALES", password: "x", active: false } });
  当(总管);
  await saveBusiness({ ...(await getBusiness()), projectMode: true });
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: JSON.stringify(true) }, create: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("P-公海-03 客户被别人放回公海", () => {
  it("总管理放回销售的客户：原负责人收到一条，写明谁放的、哪位客户；操作人和不相干的同事不收", async () => {
    const c = await 客户(乙.id, "被放回的客户");
    const r = await 以(总管, async () => 放进公海([c], await 原因()));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    const 收到 = await 通知of(乙);
    expect(收到).toHaveLength(1);
    expect(收到[0].title).toContain("总管某");
    expect(收到[0].title).toContain("被放回的客户");
    expect(收到[0].title).toContain("放回了公海");
    // 放回后他看不到这位客户（P-公海-04）：不给点不开的链接
    expect(收到[0].link).toBeNull();
    expect(await 通知of(总管)).toHaveLength(0);
    expect(await 通知of(丙)).toHaveLength(0);
    expect(await 通知of(上级)).toHaveLength(0);
  });

  it("自己放回自己的不通知", async () => {
    const c = await 客户(乙.id, "自己放的客户");
    expect(await 以(乙, async () => 放进公海([c], await 原因()))).toMatchObject({ ok: true, updated: 1 });
    expect(await 通知of(乙)).toHaveLength(0);
  });

  it("批量放回：按原负责人各发一条，各自只列自己的客户；里头操作人自己的那位不发给自己", async () => {
    const 乙1 = await 客户(乙.id, "乙的甲客户");
    const 乙2 = await 客户(乙.id, "乙的乙客户");
    const 丙1 = await 客户(丙.id, "丙的客户");
    const r = await 以(总管, async () => 放进公海([乙1, 乙2, 丙1], await 原因()));
    expect(r).toMatchObject({ ok: true, updated: 3 });
    const 乙收 = await 通知of(乙);
    expect(乙收).toHaveLength(1);
    expect(乙收[0].title).toContain("2 位客户");
    expect(乙收[0].body).toContain("乙的甲客户");
    expect(乙收[0].body).toContain("乙的乙客户");
    expect(乙收[0].body).not.toContain("丙的客户");
    const 丙收 = await 通知of(丙);
    expect(丙收).toHaveLength(1);
    expect(丙收[0].title).toContain("丙的客户");
    expect(`${丙收[0].title}${丙收[0].body}`).not.toContain("乙的");
  });

  it("客户带着项目一起进线索公海：通知里说一声", async () => {
    const c = await 客户(乙.id, "带项目的客户");
    await 项目(乙.id, c, "在推的项目");
    expect(await 以(总管, async () => 放进公海([c], await 原因()))).toMatchObject({ ok: true, updated: 1 });
    const 收到 = await 通知of(乙);
    expect(收到).toHaveLength(1);
    expect(收到[0].body).toContain("1 个项目");
  });

  it("原负责人已停用：不发", async () => {
    const c = await 客户(乙.id, "停用的人的客户");
    await raw.user.update({ where: { id: 乙.id }, data: { active: false } });
    忘掉企业版范围();
    expect(await 以(总管, async () => 放进公海([c], await 原因()))).toMatchObject({ ok: true, updated: 1 });
    expect(await 通知of(乙)).toHaveLength(0);
  });

  it("撤销放进公海：再告诉原负责人客户回到他名下", async () => {
    const c = await 客户(乙.id, "放了又撤的客户");
    const r = await 以(总管, async () => 放进公海([c], await 原因()));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    const 撤 = await 以(总管, () => 撤销公海("放进", [{ id: c, 值: 乙.id }], undefined, undefined, r.ok ? r.公海项目 : undefined));
    expect(撤).toMatchObject({ ok: true, updated: 1 });
    const 收到 = await 通知of(乙);
    expect(收到).toHaveLength(2);
    expect(收到[1].title).toContain("撤销");
    expect(收到[1].title).toContain("放了又撤的客户");
    expect(收到[1].link).toBe(`/customers/${c}`);
  });
});

describe("P-公海-03 项目被别人放回线索公海", () => {
  it("上级放回下属的项目：原负责人收到一条，写明谁放的、哪个项目；客户还归他，链到客户", async () => {
    const c = await 客户(乙.id, "项目的客户");
    const p = await 项目(乙.id, c, "被放回的项目");
    expect(await 以(上级, () => 放回项目公海(p))).toMatchObject({ ok: true });
    const 收到 = await 通知of(乙);
    expect(收到).toHaveLength(1);
    expect(收到[0].title).toContain("上级某");
    expect(收到[0].title).toContain("被放回的项目");
    expect(收到[0].title).toContain("线索公海");
    expect(收到[0].body).toContain("项目的客户");
    expect(收到[0].link).toBe(`/customers/${c}`);
    expect(await 通知of(上级)).toHaveLength(0);
    expect(await 通知of(丙)).toHaveLength(0);
  });

  it("客户归别人：只通知项目原负责人，不给链接（放回后他打不开这个项目）；客户负责人不收", async () => {
    const c = await 客户(丙.id, "丙的客户");
    const p = await 项目(乙.id, c, "乙在丙客户上的项目");
    expect(await 以(总管, () => 放回项目公海(p))).toMatchObject({ ok: true });
    const 收到 = await 通知of(乙);
    expect(收到).toHaveLength(1);
    expect(收到[0].link).toBeNull();
    expect(await 通知of(丙)).toHaveLength(0);
  });

  it("自己放回自己的项目不通知", async () => {
    const c = await 客户(乙.id, "自己的客户");
    const p = await 项目(乙.id, c, "自己放的项目");
    expect(await 以(乙, () => 放回项目公海(p))).toMatchObject({ ok: true });
    expect(await 通知of(乙)).toHaveLength(0);
  });

  it("原负责人已停用：不发", async () => {
    const c = await 客户(丙.id, "客户");
    const p = await 项目(乙.id, c, "停用的人的项目");
    await raw.user.update({ where: { id: 乙.id }, data: { active: false } });
    忘掉企业版范围();
    expect(await 以(总管, () => 放回项目公海(p))).toMatchObject({ ok: true });
    expect(await 通知of(乙)).toHaveLength(0);
  });
});
