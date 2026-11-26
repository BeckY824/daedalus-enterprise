/**
 * 离职交接带走在职同事「待分配」项目时通知这位同事（E-339）：
 *   - 交一位客户、一键全部交给（接手人确认时）两条路都发
 *   - 文案写「待分配」「接手」，不能读成项目被拿走
 *   - 同一位同事一次被带走多个，合成一条「N 个待分配项目」
 *   - 已停用的同事不发，离职的人本人不发
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, requireAdmin: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { deactivateUser } from "@/app/(app)/settings/actions";
import { 交接客户, 交接全部 } from "@/app/(app)/projects/handover/actions";
import { 确认交接 } from "@/app/(app)/customers/handover-actions";

let 系统: string, 上级: string, 离职: string, 接手: string, 同事: string, 停用同事: string;
let 号 = 0;
const 名: Record<string, string> = {};
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: 名[id] ?? id }; };
const 建人 = async (email: string, bizRole: string, managerId: string | null = null, role = "SALES") => {
  const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, managerId } });
  名[id] = email;
  return id;
};
const 建客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进" } });
const 建待分配 = (customerId: string, ownerId: string) =>
  prisma.project.create({ data: { name: `待分配项目${++号}`, customerId, ownerId, creatorId: ownerId, awaitAssignAt: new Date() } });
const 交接号 = (r: { ok: boolean; 交接?: string } | { ok: false; error: string }) => { expect(r.ok).toBe(true); return (r as { 交接?: string }).交接!; };
const 收到 = async (userId: string) => { await 等通知推完(); return prisma.entNotice.findMany({ where: { userId, kind: "交接", title: { contains: "待分配" } }, orderBy: { createdAt: "asc" } }); };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  系统 = await 建人("sys", "director", null, "ADMIN");
  上级 = await 建人("mgr", "sales_mgr");
  离职 = await 建人("leaver", "sales", 上级);
  接手 = await 建人("taker", "sales", 上级);
  同事 = await 建人("colleague", "sales", 上级);
  停用同事 = await 建人("gone", "sales", 上级);
});
afterEach(() => { vi.unstubAllEnvs(); });

const 办离职 = async () => { 当(系统, "ADMIN"); await deactivateUser(离职, ""); 当(上级); };

describe("交一位客户，接手人确认", () => {
  it("在职同事收到一条：写明待分配被接手；项目换了人；离职的人、接手人不收", async () => {
    const c = await 建客户(离职);
    const p = await 建待分配(c.id, 同事);
    await 办离职();
    const r = await 交接客户(离职, c.id, 接手);
    expect(r).toMatchObject({ ok: true });
    当(接手);
    expect(await 确认交接(交接号(r))).toMatchObject({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(接手);
    const 条 = await 收到(同事);
    expect(条).toHaveLength(1);
    expect(条[0].title).toContain("待分配");
    expect(条[0].title).toContain("接手");
    expect(条[0].title).toContain(p.name);
    expect(条[0].title).toContain(c.name);
    expect(条[0].title).toContain("taker");
    expect(条[0].body).toContain("不是你的项目被拿走");
    expect(await prisma.entNotice.count({ where: { userId: { in: [离职, 接手] }, title: { contains: "待分配" } } })).toBe(0);
  });

  it("同一位同事被带走多个，合成一条「N 个待分配项目」", async () => {
    const c1 = await 建客户(离职), c2 = await 建客户(离职);
    await 建待分配(c1.id, 同事);
    await 建待分配(c1.id, 同事);
    await 建待分配(c2.id, 同事);
    await 办离职();
    const r = await 交接全部(离职, 接手);
    expect(r).toMatchObject({ ok: true });
    当(接手);
    expect(await 确认交接(交接号(r))).toMatchObject({ ok: true });
    const 条 = await 收到(同事);
    expect(条).toHaveLength(1);
    expect(条[0].title).toContain("3 个待分配项目");
    expect(条[0].title).toContain("接手");
  });

  it("全部交给：已停用的同事不收", async () => {
    const c = await 建客户(离职);
    await 建待分配(c.id, 停用同事);
    await prisma.user.update({ where: { id: 停用同事 }, data: { active: false } });
    await 办离职();
    const r = await 交接全部(离职, 接手);
    当(接手);
    await 确认交接(交接号(r));
    expect(await 收到(停用同事)).toHaveLength(0);
  });
});
