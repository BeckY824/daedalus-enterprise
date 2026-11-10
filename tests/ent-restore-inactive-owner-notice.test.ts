/**
 * P-删-06：从回收站恢复客户时原负责人已停用——系统里没有「上级指定的接手人」，一律清空负责人进客户公海（同 P-转-14）：
 * 挂占位账号、原负责人记历史、他自己负责的线索 / 商机项目一起进线索公海（M-公海-02）。
 *   - 例外（M-公海-02 / X-31）：名下有没结束的订单阶段项目、或有同事负责还没结束的项目 → 不进公海、照原样恢复，
 *     通知停用负责人的直属上级（没有就系统管理员）去离职交接看板指定接手人
 *   - 进了公海的：给同一批收件人发一条知会
 *   - 负责人在职照原样、不发；操作恢复的人自己不收；一次回来几位按收件人合成一条
 *   - 查重「捞回」同一条路，一样办
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

import { defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 恢复回收站 } from "@/app/(app)/settings/trash-actions";
import { 从回收站捞回 } from "@/app/(app)/customers/number-actions";
import { saveBusiness, getBusiness } from "@/lib/business";
import { 恢复进公海理由 } from "@/lib/offboard-db";
import { 恢复到停用负责人通知 } from "@/lib/enterprise/notice-sources";

type 人 = { id: string; name: string; role: string };
let 总管: 人;
let 总管二: 人;
let 上级: 人;
let 乙: 人;
let 丙: 人;
let 占位: string;

async function 造人(email: string, name: string, role: string, bizRole: string, managerId?: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  await raw.entMember.create({ data: { userId: u.id, bizRole, managerId: managerId ?? null } });
  return { id: u.id, name, role };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { 当(u); return 以谁的身份(u.id, fn); };
let 序号 = 0;
/** 造一位已经在回收站里的客户 */
const 删于 = new Date();
const 删了的客户 = async (ownerId: string, name: string) => {
  const phone = `139${String(++序号).padStart(8, "0")}`;
  const c = await raw.customer.create({ data: { name, phone, salesOwnerId: ownerId, deletedAt: 删于 } });
  return { id: c.id, phone };
};
/** 跟着客户一起删的项目（同一个删除时刻，恢复客户时一起回来） */
const 删了的项目 = async (ownerId: string, customerId: string, name: string, phase = "线索") =>
  (await raw.project.create({ data: { name, customerId, ownerId, creatorId: ownerId, phase, deletedAt: 删于 } })).id;
const 客户现状 = (id: string) => raw.customer.findUnique({ where: { id }, select: { salesOwnerId: true, deletedAt: true, pool: { select: { reason: true, userId: true } } } });
const 停用 = async (u: 人) => { await raw.user.update({ where: { id: u.id }, data: { active: false } }); 忘掉企业版范围(); };
const 通知of = async (u: 人) => {
  await 等通知推完();
  return raw.entNotice.findMany({ where: { userId: u.id }, orderBy: { createdAt: "asc" }, select: { kind: true, title: true, body: true, link: true } });
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir@x", "总管某", "ADMIN", "director");
  总管二 = await 造人("dir2@x", "总管二", "ADMIN", "director");
  上级 = await 造人("mgr@x", "上级某", "MANAGER", "sales_mgr");
  乙 = await 造人("yi@x", "销售乙", "SALES", "sales", 上级.id);
  丙 = await 造人("bing@x", "销售丙", "SALES", "sales", 上级.id);
  占位 = (await raw.user.create({ data: { email: "no-owner@placeholder.local", name: "无负责人", role: "SALES", password: "x", active: false } })).id;
  当(总管);
  await saveBusiness({ ...(await getBusiness()), projectMode: true });
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("P-删-06 恢复客户、原负责人已停用：清空负责人进客户公海", () => {
  it("进客户公海、挂占位账号、原负责人记历史；他自己负责的线索项目一起进线索公海；直属上级收到知会", async () => {
    const c = await 删了的客户(乙.id, "恢复回来的客户");
    const p = await 删了的项目(乙.id, c.id, "跟着回来的项目");
    await 停用(乙);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true, 连带: 1 });
    const 现 = await 客户现状(c.id);
    expect(现?.deletedAt).toBeNull();
    expect(现?.salesOwnerId).toBe(占位);
    expect(现?.pool).toEqual({ reason: 恢复进公海理由, userId: 总管.id });
    expect(await raw.customerOwnerLog.findMany({ where: { customerId: c.id }, select: { fromOwnerId: true, toOwnerId: true, kind: true } })).toEqual([{ fromOwnerId: 乙.id, toOwnerId: 占位, kind: "pool-release" }]);
    const 项 = await raw.project.findUnique({ where: { id: p }, select: { deletedAt: true, pooledAt: true, ownerId: true } });
    expect(项?.deletedAt).toBeNull();
    expect(项?.pooledAt).not.toBeNull();
    expect(项?.ownerId).not.toBe(乙.id);
    expect(await raw.projectNodeLog.findMany({ where: { projectId: p, kind: "pool-release" }, select: { fromOwnerId: true, reason: true } })).toEqual([{ fromOwnerId: 乙.id, reason: 恢复进公海理由 }]);
    const 收到 = await 通知of(上级);
    expect(收到).toHaveLength(1);
    expect(收到[0].title).toContain("总管某");
    expect(收到[0].title).toContain("恢复回来的客户");
    expect(收到[0].title).toContain("公海");
    expect(`${收到[0].title}${收到[0].body}`).toContain("销售乙");
    expect(收到[0].link).not.toBe("/projects/handover");
    for (const u of [总管, 总管二, 丙, 乙]) expect(await 通知of(u)).toHaveLength(0);
  });

  it("没填直属上级 / 上级也停用：系统管理员收到知会（操作恢复的那位不收）", async () => {
    const 丁 = await 造人("ding@x", "销售丁", "SALES", "sales");
    const c = await 删了的客户(丁.id, "没上级的人的客户");
    const d = await 删了的客户(乙.id, "上级也走了的客户");
    for (const u of [丁, 乙, 上级]) await 停用(u);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    expect(await 以(总管, () => 恢复回收站("Customer", d.id))).toMatchObject({ ok: true });
    expect((await 客户现状(c.id))?.pool).not.toBeNull();
    expect((await 客户现状(d.id))?.pool).not.toBeNull();
    expect(await 通知of(总管二)).toHaveLength(2);
    expect(await 通知of(总管)).toHaveLength(0);
    expect(await 通知of(上级)).toHaveLength(0);
  });

  it("负责人在职：照原样恢复，不进公海、不发", async () => {
    const c = await 删了的客户(乙.id, "在职的人的客户");
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    expect(await 客户现状(c.id)).toMatchObject({ salesOwnerId: 乙.id, pool: null });
    for (const u of [上级, 总管, 总管二, 乙]) expect(await 通知of(u)).toHaveLength(0);
  });

  it("操作恢复的人自己就是直属上级：照样进公海，不发，也不转给别的系统管理员", async () => {
    await raw.entMember.update({ where: { userId: 乙.id }, data: { managerId: 总管.id } });
    const c = await 删了的客户(乙.id, "自己下属的客户");
    await 停用(乙);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    expect((await 客户现状(c.id))?.salesOwnerId).toBe(占位);
    for (const u of [总管, 总管二, 上级]) expect(await 通知of(u)).toHaveLength(0);
  });

  it("查重捞回也一样：销售撞号捞回停用同事的客户，进客户公海，停用的人的直属上级收到知会", async () => {
    const c = await 删了的客户(乙.id, "捞回来的客户");
    await 停用(乙);
    const r = await 以(丙, () => 从回收站捞回("手机号", c.phone));
    expect(r).toMatchObject({ ok: true });
    expect(await 客户现状(c.id)).toMatchObject({ deletedAt: null, salesOwnerId: 占位, pool: { reason: 恢复进公海理由, userId: 丙.id } });
    const 收到 = await 通知of(上级);
    expect(收到).toHaveLength(1);
    expect(收到[0].title).toContain("销售丙");
    expect(收到[0].title).toContain("捞回来的客户");
    expect(await 通知of(丙)).toHaveLength(0);
  });
});

describe("P-删-06 例外（M-公海-02 / X-31）：不能进公海的照原样恢复，通知去离职交接看板指定接手人", () => {
  it("名下有没结束的订单阶段项目：不进公海、负责人不动；直属上级收到去看板的通知", async () => {
    const c = await 删了的客户(乙.id, "有订单的客户");
    const p = await 删了的项目(乙.id, c.id, "订单里的项目", "订单");
    await 停用(乙);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    expect(await 客户现状(c.id)).toMatchObject({ salesOwnerId: 乙.id, pool: null });
    expect(await raw.project.findUnique({ where: { id: p }, select: { ownerId: true, pooledAt: true } })).toEqual({ ownerId: 乙.id, pooledAt: null });
    const 收到 = await 通知of(上级);
    expect(收到).toHaveLength(1);
    expect(收到[0].kind).toBe("交接");
    expect(收到[0].title).toContain("有订单的客户");
    expect(`${收到[0].title}${收到[0].body}`).toContain("销售乙");
    expect(收到[0].body).toContain("离职交接");
    expect(收到[0].link).toBe("/projects/handover");
    for (const u of [总管, 总管二, 丙, 乙]) expect(await 通知of(u)).toHaveLength(0);
  });

  it("名下有同事负责、还没结束的项目：不进公海；没直属上级时系统管理员收到去看板的通知", async () => {
    const 丁 = await 造人("ding@x", "销售丁", "SALES", "sales");
    const c = await 删了的客户(丁.id, "同事在推的客户");
    const p = await 删了的项目(丙.id, c.id, "同事的项目");
    await 停用(丁);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    expect(await 客户现状(c.id)).toMatchObject({ salesOwnerId: 丁.id, pool: null });
    expect(await raw.project.findUnique({ where: { id: p }, select: { ownerId: true, pooledAt: true } })).toEqual({ ownerId: 丙.id, pooledAt: null });
    const 收到 = await 通知of(总管二);
    expect(收到).toHaveLength(1);
    expect(收到[0].link).toBe("/projects/handover");
    expect(await 通知of(总管)).toHaveLength(0);
  });

  it("一次回来几位：按收件人合成一条，进公海的和留在停用的人名下的分开说", async () => {
    const 丁 = await 造人("ding@x", "销售丁", "SALES", "sales");
    const a = await 删了的客户(乙.id, "客户甲");
    const b = await 删了的客户(丙.id, "客户乙");
    const d = await 删了的客户(丁.id, "客户丙");
    const e = await 删了的客户(乙.id, "客户丁");
    await raw.customer.updateMany({ data: { deletedAt: null } });
    for (const u of [乙, 丙, 丁]) await 停用(u);
    await 恢复到停用负责人通知(总管, [
      { id: a.id, 原: 乙.id, 进了公海: false }, { id: b.id, 原: 丙.id, 进了公海: false },
      { id: d.id, 原: 丁.id, 进了公海: false }, { id: e.id, 原: 乙.id, 进了公海: true },
    ]);
    const 上级收 = await 通知of(上级);
    expect(上级收).toHaveLength(2);
    const 看板 = 上级收.find((n) => n.link === "/projects/handover")!;
    expect(看板.title).toContain("2 位客户");
    expect(看板.body).toContain("客户甲");
    expect(看板.body).toContain("客户乙");
    expect(看板.body).not.toContain("客户丙");
    expect(看板.body).not.toContain("客户丁");
    expect(上级收.find((n) => n.link !== "/projects/handover")!.title).toContain("客户丁");
    const 管收 = await 通知of(总管二);
    expect(管收).toHaveLength(1);
    expect(管收[0].title).toContain("客户丙");
  });
});
