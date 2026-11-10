/**
 * 「待分配」标记（Project.awaitAssignAt）换负责人就清（c1 热修，P-转-03 + lib/project/owner-write.ts）：
 *   - 新建选「暂不分配」：记在自己名下，不标待分配（向导、客户页一样）
 *   - 暂不分配建好后，客户层面分给销售（assignSalesOwner → 项目跟着走）：项目换了负责人、标记是空的；老数据已标上的也清掉
 *   - 编辑项目换负责人清标记；只改别的字段不动标记
 *   - 公海项目被领取、被分配：清标记
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围, 以谁的身份 } from "@/lib/enterprise/visibility";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 改项目, 领取公海项目 } from "@/lib/project/db";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 公海规则 } from "@/lib/enterprise/pool-rules";

let 老板: string, 市场: string, 销售经理: string, 销售: string, 另一销售: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 项目of = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
let 号 = 0;

const 向导 = async (项目: Partial<建档向导输入["项目"]>) => {
  号++;
  const 渠 = (await prisma.channel.findFirst()) ?? (await prisma.channel.create({ data: { name: "小红", channelOwnerId: 老板 } }));
  return 建档向导({
    客户: {
      name: `向导客户${号}`, phone: `1391111${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 项目.ownerId ?? mocks.user.id, channelId: 渠.id, referrerCustomerId: null,
    },
    联系人: { name: "王经理", position: "采购", phone: "" },
    项目: { name: `向导项目${号}`, amount: 0, currency: "CNY", ownerId: mocks.user.id, 业务线: "内贸", ...项目 },
    跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
  });
};

async function 公海项目(原负责人: string) {
  号++;
  const c = (await prisma.customer.create({ data: { name: `公海客户${号}`, phone: `1380000${String(号).padStart(4, "0")}`, salesOwnerId: 原负责人 } })).id;
  return (await prisma.project.create({
    data: { name: `公海项目${号}`, customerId: c, ownerId: "", creatorId: 原负责人, phase: "潜客培育", pooledAt: new Date(), awaitAssignAt: new Date() },
  })).id;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 人 = async (email: string, name: string, role = "SALES") => (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
  老板 = await 人("boss", "老板", "ADMIN");
  市场 = await 人("mkt", "市场甲");
  销售经理 = await 人("smgr", "销售管理乙");
  销售 = await 人("s1", "销售丙");
  另一销售 = await 人("s2", "销售丁");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板, bizRole: "director" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 销售经理, bizRole: "sales_mgr" },
      { userId: 销售, bizRole: "sales", managerId: 销售经理 },
      { userId: 另一销售, bizRole: "sales", managerId: 销售经理 },
    ],
  });
  await setSetting(规则.线索分配.key, true);
  当(老板, "ADMIN");
});
afterEach(() => {
  公海规则.项目能单独领 = false;
  忘掉企业版范围();
});

describe("新建选「暂不分配」不标待分配", () => {
  it("向导：记在自己名下，awaitAssignAt 是空的", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 3 });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.assignMode, p.awaitAssignAt]).toEqual([市场, "暂不分配", null]);
  });

  it("客户页给客户建项目：一样不标", async () => {
    当(市场);
    const cid = (await prisma.customer.create({ data: { name: "页客户", phone: "13922220001", salesOwnerId: 市场 } })).id;
    const r = await 以谁的身份(市场, () => 给客户建项目({
      customerId: cid,
      项目: { name: "页项目", amount: 0, currency: "CNY", ownerId: 市场, 分配方式: 3, 业务线: "内贸" },
      跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    }));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.awaitAssignAt]).toEqual([市场, null]);
  });
});

describe("暂不分配之后在客户上分给销售", () => {
  it("项目跟着客户到销售名下，标记是空的", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 3 });
    if (!r.ok) throw new Error(JSON.stringify(r));
    当(老板, "ADMIN");
    expect(await assignSalesOwner([r.customerId], 销售)).toMatchObject({ ok: true, updated: 1 });
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.awaitAssignAt]).toEqual([销售, null]);
  });

  it("老数据已经标上待分配的：分给销售后清掉（线上出问题的那条路）", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 3 });
    if (!r.ok) throw new Error(JSON.stringify(r));
    await prisma.project.update({ where: { id: r.projectId }, data: { awaitAssignAt: new Date() } });
    当(老板, "ADMIN");
    expect(await assignSalesOwner([r.customerId], 销售)).toMatchObject({ ok: true, updated: 1 });
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.awaitAssignAt]).toEqual([销售, null]);
  });
});

describe("编辑项目换负责人", () => {
  it("换了负责人清标记；只改名字不动标记", async () => {
    当(市场);
    const r = await 向导({ 分配方式: 3 });
    if (!r.ok) throw new Error(JSON.stringify(r));
    await prisma.project.update({ where: { id: r.projectId }, data: { awaitAssignAt: new Date() } });
    const 老板身份 = { id: 老板, role: "ADMIN" };
    当(老板, "ADMIN");
    expect(await 改项目(老板身份, r.projectId, { name: "改个名" })).toMatchObject({ ok: true });
    expect((await 项目of(r.projectId)).awaitAssignAt).not.toBeNull();
    expect(await 改项目(老板身份, r.projectId, { ownerId: 销售 })).toMatchObject({ ok: true });
    const p = await 项目of(r.projectId);
    expect([p.ownerId, p.awaitAssignAt]).toEqual([销售, null]);
  });
});

describe("公海项目被领取、被分配", () => {
  it("领取：清标记", async () => {
    公海规则.项目能单独领 = true;
    const id = await 公海项目(另一销售);
    当(销售);
    expect(await 领取公海项目({ id: 销售, role: "SALES" }, id)).toEqual({ ok: true });
    const p = await 项目of(id);
    expect([p.ownerId, p.pooledAt, p.awaitAssignAt]).toEqual([销售, null, null]);
  });

  it("主管分配：清标记", async () => {
    const id = await 公海项目(另一销售);
    当(老板, "ADMIN");
    expect(await 分配公海项目([id], 销售)).toMatchObject({ ok: true });
    const p = await 项目of(id);
    expect([p.ownerId, p.pooledAt, p.awaitAssignAt]).toEqual([销售, null, null]);
  });
});
