/**
 * 企业版离职原地不动 + 离职交接看板（11-03 C4-4 / B7-2 / C4-5）：
 *   - 办离职只停用：名下客户、项目、线索、渠道原地不动（负责人仍是他），「放进公海」被拒；上级不用开「按组织看客户」也能办
 *   - 看板只给他手填的直属上级和系统管理员；别的销售、只读管理员 FORBIDDEN、一行不改
 *   - 单条交客户（记 deactivate 历史负责人，项目模式下项目跟着走）、单条交项目（记转让痕）、一键全部交给（线索、渠道一起走）
 *   - 接手人候选同 B2-7：停用的、只读的不能接
 *   - 没开项目模式：看板只列客户、交客户不动项目、交项目回 false
 *   - 查重撞到离职负责人的客户：提示「负责人已离职，请联系 直属上级」，没上级 = 系统管理员
 *   - 重新启用：没交走的还在他名下，不动
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile } from "node:fs/promises";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
  项目模式: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.项目模式 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { deactivateUser, reactivateUser, 停用清点 } from "@/app/(app)/settings/actions";
import { 交接客户, 交接项目, 交接全部 } from "@/app/(app)/projects/handover/actions";
import { 读离职交接, 离职交接入口 } from "@/lib/enterprise/offboard-handover";
import { checkDuplicate } from "@/app/(app)/customers/actions";
import { 撞号结论 } from "@/lib/enterprise/contact-dedupe";

let 系统: string, 上级: string, 离职: string, 接手: string, 别的销售: string, 只读: string;
let 号 = 0;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: id }; };
const 建人 = async (email: string, bizRole: string, managerId: string | null = null, role = "SALES") => {
  const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, managerId } });
  return id;
};
const 建客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进" } });
const 建项目 = (customerId: string, ownerId: string) =>
  prisma.project.create({ data: { name: `项目${++号}`, customerId, ownerId, creatorId: ownerId } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 项目归谁 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  mocks.项目模式 = true;
  号 = 0;
  系统 = await 建人("sys", "director", null, "ADMIN");
  上级 = await 建人("mgr", "sales_mgr");
  离职 = await 建人("leaver", "sales", 上级);
  接手 = await 建人("taker", "sales", 上级);
  别的销售 = await 建人("other", "sales");
  只读 = await 建人("ro", "admin", null, "ADMIN");
});
afterEach(() => { vi.unstubAllEnvs(); });

/** 离职的人名下：一位客户（带一个项目、一条待办）、一个挂在别人客户上的项目、一条线索、一个渠道 */
async function 摆数据() {
  const c = await 建客户(离职);
  const p跟客户 = await 建项目(c.id, 离职);
  const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 离职 } });
  const 别人客户 = await 建客户(接手);
  const p单独 = await 建项目(别人客户.id, 离职);
  const lead = await prisma.lead.create({ data: { name: "线索甲", ownerId: 离职 } });
  const ch = await prisma.channel.create({ data: { name: "渠道甲|其他", channelOwnerId: 离职 } });
  return { c, p跟客户, t, 别人客户, p单独, lead, ch };
}

describe("办离职：原地不动", () => {
  it("系统管理员办离职：只停用，客户、项目、线索、渠道负责人仍是他；不记历史负责人", async () => {
    const d = await 摆数据();
    当(系统, "ADMIN");
    expect(await 停用清点(离职)).toEqual({ ok: true, 原地: { 客户: 1, 项目: 2 } });
    expect(await deactivateUser(离职, "")).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 离职 } })).active).toBe(false);
    expect(await 归谁(d.c.id)).toBe(离职);
    expect(await 项目归谁(d.p跟客户.id)).toBe(离职);
    expect(await 项目归谁(d.p单独.id)).toBe(离职);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: d.t.id } })).ownerId).toBe(离职);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: d.lead.id } })).ownerId).toBe(离职);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: d.ch.id } })).channelOwnerId).toBe(离职);
    expect(await prisma.customerOwnerLog.count()).toBe(0);
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("离职不进公海：方式「公海」被拒，人还在职、客户没进公海", async () => {
    const c = await 建客户(离职);
    当(系统, "ADMIN");
    const r = await deactivateUser(离职, 接手, "公海");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("不再放进公海") });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 离职 } })).active).toBe(true);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, select: { pool: true } })).toEqual({ pool: null });
    expect(await 归谁(c.id)).toBe(离职);
  });

  it("传了接手人也不转：企业版办离职不当场交", async () => {
    const c = await 建客户(离职);
    当(系统, "ADMIN");
    expect(await deactivateUser(离职, 接手, "转交")).toEqual({ ok: true });
    expect(await 归谁(c.id)).toBe(离职);
  });

  it("手填直属上级能办，不用开「按组织看客户」；别的销售、只读管理员不能", async () => {
    for (const [id, role] of [[别的销售, "SALES"], [只读, "ADMIN"], [接手, "SALES"]] as const) {
      当(id, role);
      await expect(deactivateUser(离职, "")).rejects.toThrow("FORBIDDEN");
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 离职 } })).active).toBe(true);
    当(上级);
    expect(await deactivateUser(离职, "")).toEqual({ ok: true });
  });

  it("没开项目模式：清点不数项目", async () => {
    mocks.项目模式 = false;
    await 摆数据();
    当(系统, "ADMIN");
    expect(await 停用清点(离职)).toEqual({ ok: true, 原地: { 客户: 1, 项目: 0 } });
  });

  it("重新启用：没交走的还在他名下，不动", async () => {
    const d = await 摆数据();
    当(系统, "ADMIN");
    await deactivateUser(离职, "");
    当(上级);
    expect((await 交接客户(离职, d.c.id, 接手)).ok).toBe(true);
    当(系统, "ADMIN");
    expect(await reactivateUser(离职)).toEqual({ ok: true });
    expect(await 归谁(d.c.id)).toBe(接手);
    expect(await 项目归谁(d.p单独.id)).toBe(离职);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: d.lead.id } })).ownerId).toBe(离职);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: d.ch.id } })).channelOwnerId).toBe(离职);
    // 人回来了：看板上不再有他
    当(上级);
    expect(await 读离职交接({ id: 上级, role: "SALES" })).toEqual([]);
  });
});

describe("离职交接看板", () => {
  beforeEach(async () => {
    当(系统, "ADMIN");
  });

  it("看板：上级、系统管理员看得到他名下的客户、单独的项目、其余数；别的销售、只读看不到", async () => {
    const d = await 摆数据();
    await deactivateUser(离职, "");
    for (const me of [{ id: 上级, role: "SALES" }, { id: 系统, role: "ADMIN" }]) {
      const 们 = await 读离职交接(me);
      expect(们).toHaveLength(1);
      expect(们[0]).toMatchObject({
        id: 离职, 上级: "mgr", 交接中: false,
        客户: [{ id: d.c.id, 项目数: 1 }],
        项目: [{ id: d.p单独.id }],
        其余: { 线索: 1, 渠道: 1, 待办: 0 },
      });
    }
    expect(await 读离职交接({ id: 别的销售, role: "SALES" })).toEqual([]);
    expect(await 读离职交接({ id: 只读, role: "ADMIN" })).toEqual([]);
  });

  it("入口：上级、系统管理员有待交接时带人数；有下属没待交接的上级摆 0；销售、只读不摆", async () => {
    expect(await 离职交接入口({ id: 上级, role: "SALES" })).toBe(0);
    expect(await 离职交接入口({ id: 系统, role: "ADMIN" })).toBeNull();
    await 建客户(离职);
    await deactivateUser(离职, "");
    expect(await 离职交接入口({ id: 上级, role: "SALES" })).toBe(1);
    expect(await 离职交接入口({ id: 系统, role: "ADMIN" })).toBe(1);
    expect(await 离职交接入口({ id: 别的销售, role: "SALES" })).toBeNull();
    expect(await 离职交接入口({ id: 只读, role: "ADMIN" })).toBeNull();
  });

  it("交接动作：别的销售、只读、在职的人 FORBIDDEN，一行不改", async () => {
    const d = await 摆数据();
    await deactivateUser(离职, "");
    for (const [id, role] of [[别的销售, "SALES"], [只读, "ADMIN"]] as const) {
      当(id, role);
      await expect(交接客户(离职, d.c.id, 接手)).rejects.toThrow("FORBIDDEN");
      await expect(交接项目(离职, d.p单独.id, 接手)).rejects.toThrow("FORBIDDEN");
      await expect(交接全部(离职, 接手)).rejects.toThrow("FORBIDDEN");
    }
    // 在职的人不在看板上，上级也不能拿这一页转他的客户
    const 在职的 = await 建客户(接手);
    当(上级);
    await expect(交接客户(接手, 在职的.id, 别的销售)).rejects.toThrow("FORBIDDEN");
    expect(await 归谁(d.c.id)).toBe(离职);
    expect(await 归谁(在职的.id)).toBe(接手);
  });

  it("接手人候选同 B2-7：停用的、只读的接不了；不能交给自己", async () => {
    const c = await 建客户(离职);
    const 也走了 = await 建人("gone", "sales", 上级);
    await prisma.user.update({ where: { id: 也走了 }, data: { active: false } });
    await deactivateUser(离职, "");
    当(上级);
    for (const to of [也走了, 只读, 离职, ""]) {
      expect((await 交接客户(离职, c.id, to)).ok).toBe(false);
    }
    expect(await 归谁(c.id)).toBe(离职);
  });

  it("单条交客户：项目、待办跟着走，记 deactivate 历史负责人；单独的项目不动", async () => {
    const d = await 摆数据();
    await deactivateUser(离职, "");
    当(上级);
    expect(await 交接客户(离职, d.c.id, 接手)).toMatchObject({ ok: true });
    expect(await 归谁(d.c.id)).toBe(接手);
    expect(await 项目归谁(d.p跟客户.id)).toBe(接手);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: d.t.id } })).ownerId).toBe(接手);
    expect(await 项目归谁(d.p单独.id)).toBe(离职);
    expect(await prisma.customerOwnerLog.findFirst({ where: { customerId: d.c.id } })).toMatchObject({ fromOwnerId: 离职, toOwnerId: 接手, kind: "deactivate", userId: 上级 });
    // 再交一次：已不在他名下
    expect((await 交接客户(离职, d.c.id, 别的销售)).ok).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "handover" } })).toBe(1);
  });

  it("单条交项目：记转让痕", async () => {
    const d = await 摆数据();
    await deactivateUser(离职, "");
    expect(await 交接项目(离职, d.p单独.id, 接手)).toMatchObject({ ok: true });
    expect(await 项目归谁(d.p单独.id)).toBe(接手);
    expect(await prisma.projectNodeLog.findFirst({ where: { projectId: d.p单独.id, kind: "transfer" } })).toMatchObject({ fromOwnerId: 离职, toOwnerId: 接手 });
    expect(await 归谁(d.c.id)).toBe(离职);
  });

  it("一键全部交给：客户、项目、待办、线索、渠道一起走，交完看板上没有他", async () => {
    const d = await 摆数据();
    await deactivateUser(离职, "");
    当(上级);
    const r = await 交接全部(离职, 接手);
    expect(r).toMatchObject({ ok: true });
    expect(await 归谁(d.c.id)).toBe(接手);
    expect(await 项目归谁(d.p跟客户.id)).toBe(接手);
    expect(await 项目归谁(d.p单独.id)).toBe(接手);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: d.t.id } })).ownerId).toBe(接手);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: d.lead.id } })).ownerId).toBe(接手);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: d.ch.id } })).channelOwnerId).toBe(接手);
    expect(await 读离职交接({ id: 上级, role: "SALES" })).toEqual([]);
    expect(await 离职交接入口({ id: 上级, role: "SALES" })).toBe(0);
  });

  it("没开项目模式：只列客户；交客户、全部交给都不动项目；交项目回不成", async () => {
    mocks.项目模式 = false;
    const d = await 摆数据();
    await deactivateUser(离职, "");
    const [p] = await 读离职交接({ id: 上级, role: "SALES" });
    expect(p.项目).toEqual([]);
    expect(p.客户).toEqual([{ id: d.c.id, name: d.c.name, 项目数: 0 }]);
    当(上级);
    expect((await 交接项目(离职, d.p单独.id, 接手)).ok).toBe(false);
    expect((await 交接客户(离职, d.c.id, 接手)).ok).toBe(true);
    expect(await 项目归谁(d.p跟客户.id)).toBe(离职);
    expect((await 交接全部(离职, 接手)).ok).toBe(true);
    expect(await 项目归谁(d.p单独.id)).toBe(离职);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: d.lead.id } })).ownerId).toBe(接手);
  });
});

describe("查重：负责人已离职指直属上级（C4-5）", () => {
  it("撞号结论、checkDuplicate：指他的直属上级", async () => {
    const c = await 建客户(离职);
    当(系统, "ADMIN");
    await deactivateUser(离职, "");
    当(别的销售);
    const r = await 撞号结论(prisma, [c.id], 别的销售, 别的销售);
    expect(r.状态).toBe("重复");
    expect(r.提示).toContain("负责人已离职，请联系 mgr");
    expect(r.撞).toMatchObject({ 负责人已离职找: "mgr" });
    expect(await checkDuplicate(c.phone)).toMatchObject({ 负责人已离职找: "mgr" });
  });

  it("没填上级、上级也走了：指系统管理员；负责人在职照原来的说法", async () => {
    const c = await 建客户(离职);
    const 在职的 = await 建客户(接手);
    当(系统, "ADMIN");
    await deactivateUser(离职, "");
    await prisma.user.update({ where: { id: 上级 }, data: { active: false } });
    当(别的销售);
    expect((await 撞号结论(prisma, [c.id], 别的销售, 别的销售)).提示).toContain("请联系 系统管理员");
    const 照旧 = await 撞号结论(prisma, [在职的.id], 别的销售, 别的销售);
    expect(照旧.提示).not.toContain("已离职");
    expect(照旧.撞).not.toHaveProperty("负责人已离职找");
    expect(await checkDuplicate(在职的.phone)).not.toHaveProperty("负责人已离职找");
  });
});

describe("页面", () => {
  it("设置成员页企业版办离职不再给「放进公海」；离职交接页只读、共享区、不是谁上级的人 404", async () => {
    const members = await readFile("src/app/(app)/settings/MembersTab.tsx", "utf8");
    expect(members).toContain("deactivateUser(r.id, \"\")");
    expect(members).not.toMatch(/value[:=]\s*"公海"/);
    const page = await readFile("src/app/(app)/projects/handover/page.tsx", "utf8");
    expect(page).toContain("只读角色(me, org)");
    expect(page).toContain("当前是共享区()");
    expect(page).toContain("notFound()");
    expect(page).toContain("managerId: me.id, userId: { not: me.id }");
  });
});
