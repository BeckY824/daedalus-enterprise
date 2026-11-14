/**
 * 离职交接转完在客户备注留一行（客户 11-13：「接手人＋日期」，避免悄悄转过去没人知道）：
 *   - 格式「YYYY-MM-DD 离职交接：原负责人 X → 接手人 Y（操作人 Z）」，日期按上海日
 *   - 备注空 = 就这一行；有内容 = 原内容不动、末尾空白规整后换行追加；同一行已经有了不重复加
 *   - 单条交客户、一键全部交给都写（同一个事务）；单条交项目不碰客户备注；不刷最近跟进
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { deactivateUser } from "@/app/(app)/settings/actions";
import { 交接客户, 交接项目, 交接全部 } from "./helpers/offboard-auto-confirm";
import { 交接备注行, 追加备注行 } from "@/lib/enterprise/offboard-handover";
import { beijingDay } from "@/lib/business-clock";

let 系统: string, 上级: string, 离职: string, 接手: string;
let 号 = 0;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: id }; };
const 建人 = async (email: string, name: string, bizRole: string, managerId: string | null = null, role = "SALES") => {
  const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, managerId } });
  return id;
};
const 建客户 = (salesOwnerId: string, remark: string | null = null, lastFollowAt: Date | null = null) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进", remark, lastFollowAt } });
const 备注 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).remark;
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 今天的行 = (操作人 = "组长") => 交接备注行(beijingDay(new Date()), "离职员", "接手员", 操作人);

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  系统 = await 建人("sys", "系统员", "director", null, "ADMIN");
  上级 = await 建人("mgr", "组长", "sales_mgr");
  离职 = await 建人("leaver", "离职员", "sales", 上级);
  接手 = await 建人("taker", "接手员", "sales", 上级);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("备注行（纯函数）", () => {
  it("格式；空备注就这一行；有内容末尾空白规整后换行追加；已有同一行回 null", () => {
    const 行 = 交接备注行("2026-11-13", "甲", "乙", "丙");
    expect(行).toBe("2026-11-13 离职交接：原负责人 甲 → 接手人 乙（操作人 丙）");
    expect(追加备注行(null, 行)).toBe(行);
    expect(追加备注行("  \n", 行)).toBe(行);
    expect(追加备注行("  老客户\n第二行\n\n  ", 行)).toBe(`  老客户\n第二行\n${行}`);
    expect(追加备注行(`老客户\n${行}\n`, 行)).toBeNull();
  });

  it("日期按上海日：伦敦 11-12 晚上 = 上海 11-13", () => {
    expect(beijingDay(new Date("2026-11-12T17:30:00Z"))).toBe("2026-11-13");
  });
});

describe("离职交接留备注", () => {
  beforeEach(() => { 当(系统, "ADMIN"); });

  it("单条交客户：备注空 → 就这一行；不刷最近跟进", async () => {
    const 跟进 = new Date("2026-10-01T02:00:00Z");
    const c = await 建客户(离职, null, 跟进);
    await deactivateUser(离职, "");
    当(上级);
    expect(await 交接客户(离职, c.id, 接手)).toMatchObject({ ok: true });
    expect(await 备注(c.id)).toBe(今天的行());
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).lastFollowAt).toEqual(跟进);
  });

  it("单条交客户：备注已有内容 → 原内容不动，末尾换行追加", async () => {
    const c = await 建客户(离职, "喜欢电话联系\n预算 10 万\n\n");
    await deactivateUser(离职, "");
    当(上级);
    expect(await 交接客户(离职, c.id, 接手)).toMatchObject({ ok: true });
    expect(await 备注(c.id)).toBe(`喜欢电话联系\n预算 10 万\n${今天的行()}`);
  });

  it("重复转（同一天、同一对人）：不重复加行", async () => {
    const c = await 建客户(离职, "原备注");
    await deactivateUser(离职, "");
    当(上级);
    expect(await 交接客户(离职, c.id, 接手)).toMatchObject({ ok: true });
    // 又回到他名下（比如手工退回），同一天再交一次
    await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 离职 } });
    expect(await 交接客户(离职, c.id, 接手)).toMatchObject({ ok: true });
    expect(await 归谁(c.id)).toBe(接手);
    expect(await 备注(c.id)).toBe(`原备注\n${今天的行()}`);
  });

  it("一键全部交给：每位客户各留一行，同一个事务；已有这一行的不重复；操作人是系统管理员", async () => {
    const 行 = 今天的行("系统员");
    const a = await 建客户(离职);
    const b = await 建客户(离职, "老备注 ");
    const c = await 建客户(离职, `老备注\n${行}`);
    const 别人的 = await 建客户(接手, "别动");
    await deactivateUser(离职, "");
    expect(await 交接全部(离职, 接手)).toMatchObject({ ok: true });
    expect(await 备注(a.id)).toBe(行);
    expect(await 备注(b.id)).toBe(`老备注\n${行}`);
    expect(await 备注(c.id)).toBe(`老备注\n${行}`);
    expect(await 备注(别人的.id)).toBe("别动");
  });

  it("单条交项目：不碰客户备注", async () => {
    const 别人客户 = await 建客户(接手, "接手人的客户");
    const p = await prisma.project.create({ data: { name: "项目甲", customerId: 别人客户.id, ownerId: 离职, creatorId: 离职 } });
    await deactivateUser(离职, "");
    expect(await 交接项目(离职, p.id, 接手)).toMatchObject({ ok: true });
    expect(await 备注(别人客户.id)).toBe("接手人的客户");
  });
});
