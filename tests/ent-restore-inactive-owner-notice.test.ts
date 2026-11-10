/**
 * P-删-06 通知缺口：从回收站恢复客户时原负责人已停用——客户照原样挂回停用的人名下，
 * 只出现在离职交接看板里，没人知道。恢复成功后告诉停用负责人的直属上级（在职的）；没有就告诉系统管理员。
 *   - 链接到离职交接看板（上级、系统管理员都打得开）
 *   - 负责人在职不发；操作恢复的人自己不收；一次回来几位按收件人合成一条
 *   - 查重「捞回」同一条路，一样发
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
import { 恢复到停用负责人通知 } from "@/lib/enterprise/notice-sources";

type 人 = { id: string; name: string; role: string };
let 总管: 人;
let 总管二: 人;
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
/** 造一位已经在回收站里的客户 */
const 删了的客户 = async (ownerId: string, name: string) => {
  const phone = `139${String(++序号).padStart(8, "0")}`;
  const c = await raw.customer.create({ data: { name, phone, salesOwnerId: ownerId, deletedAt: new Date() } });
  return { id: c.id, phone };
};
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
  await raw.user.create({ data: { email: "no-owner@placeholder.local", name: "无负责人", role: "SALES", password: "x", active: false } });
  当(总管);
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("P-删-06 从回收站恢复客户、原负责人已停用", () => {
  it("停用负责人的直属上级收到一条：哪位客户、挂在谁名下、去离职交接看板；操作人、同事、停用的人不收", async () => {
    const c = await 删了的客户(乙.id, "恢复回来的客户");
    await 停用(乙);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    expect((await raw.customer.findUnique({ where: { id: c.id } }))?.salesOwnerId).toBe(乙.id); // 归属照原样
    const 收到 = await 通知of(上级);
    expect(收到).toHaveLength(1);
    expect(收到[0].kind).toBe("交接");
    expect(收到[0].title).toContain("总管某");
    expect(收到[0].title).toContain("恢复回来的客户");
    expect(`${收到[0].title}${收到[0].body}`).toContain("销售乙");
    expect(收到[0].body).toContain("离职交接");
    expect(收到[0].link).toBe("/projects/handover");
    for (const u of [总管, 总管二, 丙, 乙]) expect(await 通知of(u)).toHaveLength(0);
  });

  it("没填直属上级：系统管理员收到（操作恢复的那位不收）", async () => {
    const 丁 = await 造人("ding@x", "销售丁", "SALES", "sales");
    const c = await 删了的客户(丁.id, "没上级的人的客户");
    await 停用(丁);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    const 收到 = await 通知of(总管二);
    expect(收到).toHaveLength(1);
    expect(收到[0].link).toBe("/projects/handover");
    expect(await 通知of(总管)).toHaveLength(0);
    expect(await 通知of(上级)).toHaveLength(0);
  });

  it("直属上级也停用了：系统管理员收到", async () => {
    const c = await 删了的客户(乙.id, "上级也走了的客户");
    await 停用(乙);
    await 停用(上级);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    expect(await 通知of(总管二)).toHaveLength(1);
    expect(await 通知of(上级)).toHaveLength(0);
  });

  it("负责人在职：不发", async () => {
    const c = await 删了的客户(乙.id, "在职的人的客户");
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    for (const u of [上级, 总管, 总管二, 乙]) expect(await 通知of(u)).toHaveLength(0);
  });

  it("操作恢复的人自己就是直属上级：不发，也不转给别的系统管理员", async () => {
    await raw.entMember.update({ where: { userId: 乙.id }, data: { managerId: 总管.id } });
    const c = await 删了的客户(乙.id, "自己下属的客户");
    await 停用(乙);
    expect(await 以(总管, () => 恢复回收站("Customer", c.id))).toMatchObject({ ok: true });
    for (const u of [总管, 总管二, 上级]) expect(await 通知of(u)).toHaveLength(0);
  });

  it("一次回来几位：按收件人合成一条，各列各的", async () => {
    const 丁 = await 造人("ding@x", "销售丁", "SALES", "sales");
    const a = await 删了的客户(乙.id, "客户甲");
    const b = await 删了的客户(丙.id, "客户乙");
    const d = await 删了的客户(丁.id, "客户丙");
    await raw.customer.updateMany({ data: { deletedAt: null } });
    for (const u of [乙, 丙, 丁]) await 停用(u);
    await 恢复到停用负责人通知(总管, [a.id, b.id, d.id]);
    const 上级收 = await 通知of(上级);
    expect(上级收).toHaveLength(1);
    expect(上级收[0].title).toContain("2 位客户");
    expect(上级收[0].body).toContain("客户甲");
    expect(上级收[0].body).toContain("客户乙");
    expect(上级收[0].body).not.toContain("客户丙");
    const 管收 = await 通知of(总管二);
    expect(管收).toHaveLength(1);
    expect(管收[0].title).toContain("客户丙");
  });

  it("查重捞回也一样：销售撞号捞回停用同事的客户，停用的人的直属上级收到", async () => {
    const c = await 删了的客户(乙.id, "捞回来的客户");
    await 停用(乙);
    const r = await 以(丙, () => 从回收站捞回("手机号", c.phone));
    expect(r).toMatchObject({ ok: true });
    expect((await raw.customer.findUnique({ where: { id: c.id } }))?.deletedAt).toBeNull();
    const 收到 = await 通知of(上级);
    expect(收到).toHaveLength(1);
    expect(收到[0].title).toContain("销售丙");
    expect(收到[0].title).toContain("捞回来的客户");
    expect(await 通知of(丙)).toHaveLength(0);
  });
});
