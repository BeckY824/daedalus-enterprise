/**
 * 客户转让可选自动分配（客户 11-17：「市场成员对暂不分配的客户进行分配时可选自动和指定」）：
 *   - 市场成员（市场管理、渠道运营，只认业务角色）+ 暂不分配的客户：按新线索的自动分配挑人（本月分得最少、并列给最早建号的；
 *     按客户区域定内贸 / 外贸，P-转-26），客户连名下项目、联系人给挑中的销售，算一次分配（分配记录 + 换负责人记 market-assign），
 *     清待分配（P-转-21），只通知接手人（P-转-17）
 *   - 别的角色（总管理、销售管理、账号是 ADMIN 但业务角色不是市场的）不能用；不是暂不分配的客户不能用
 *   - 一个能接的人都没有：什么都不动、不标待分配，回原因
 *   - 页面摆不摆（页面可自动分配）和服务端同一个判定
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "市场", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/settings";
import { resetDb } from "./reset";
import { 客户自动分配, 批量客户自动分配, 批量客户自动分配预看, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 页面可自动分配, 批量可自动分配, 不是市场话, 不是暂不分配话 } from "@/lib/enterprise/cust-auto-assign";
import { 自动分配不参与key, 不设配额key, 月份 } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";

const 当 = (id: string, name: string, role = "SALES") => { mocks.user = { ...mocks.user, id, name, role }; };

let 老板: string, 市场管: string, 渠运: string, 外组长: string, 内组长: string;
let 外一: string, 外二: string, 内一: string, 内二: string;
let 号 = 0;

type 址 = { addrCountry?: string | null; addrProvince?: string | null; addrCity?: string | null };
const 大陆: 址 = { addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市" };
const 美国: 址 = { addrCountry: "美国" };

/** 市场成员名下一位客户 + 一条项目（默认分配方式「暂不分配」、业务线内贸）+ 一位联系人 */
async function 建客户(o: { 负责人?: string; 地址?: 址; 方式?: string | null; 项目线?: string | null; 客户线?: string | null; 待分配?: boolean; 号?: string | null } = {}) {
  const 负责人 = o.负责人 ?? 市场管;
  号++;
  const c = await prisma.customer.create({
    data: { name: `客户${号}`, phone: o.号 === undefined ? `1390000${String(号).padStart(4, "0")}` : o.号 ?? "", salesOwnerId: 负责人, bizLine: o.客户线 ?? "内贸", ...(o.地址 ?? 大陆) },
  });
  const p = await prisma.project.create({
    data: {
      name: `项目${号}`, customerId: c.id, ownerId: 负责人, creatorId: 负责人, bizLine: o.项目线 === undefined ? "内贸" : o.项目线,
      assignMode: o.方式 === undefined ? "暂不分配" : o.方式, ...(o.待分配 ? { awaitAssignAt: new Date() } : {}),
    },
  });
  const ct = await prisma.contact.create({ data: { customerId: c.id, name: `联系人${号}`, phone: o.号 === undefined ? `1380000${String(号).padStart(4, "0")}` : o.号 } });
  return { c: c.id, p: p.id, ct: ct.id };
}
const 客户负责人 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 项目 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await resetDb();
  const 部 = async (name: string, parentId: string | null = null) => (await prisma.entDept.create({ data: { name, parentId } })).id;
  const 外贸部 = await 部("外贸事业部");
  const 内贸部 = await 部("内贸事业部");
  const 市场部 = await 部("市场运营部", 内贸部);
  let 第几 = 0;
  const 人 = async (email: string, name: string, bizRole: string, deptId: string | null, role = "SALES", managerId: string | null = null) => {
    第几++;
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x", createdAt: new Date(2026, 0, 第几) } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, deptId, managerId } });
    return id;
  };
  老板 = await 人("boss", "老板", "director", null, "ADMIN");
  市场管 = await 人("mkt", "市场管理", "marketing_mgr", 市场部);
  渠运 = await 人("ch", "渠运", "channel_ops", 市场部, "SALES", 市场管);
  外一 = await 人("w1", "外贸一", "sales", 外贸部);
  外二 = await 人("w2", "外贸二", "sales", 外贸部);
  外组长 = await 人("wl", "外贸组长", "sales_mgr", 外贸部, "ADMIN");
  内一 = await 人("n1", "内贸一", "sales", 内贸部);
  内二 = await 人("n2", "内贸二", "sales", 内贸部);
  内组长 = await 人("nl", "内贸组长", "sales_mgr", 内贸部, "MANAGER");

  for (const k of [规则.按组织看客户.key, 规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  // 11-18 第 9 题 B 起内贸销售管理也参与自动分配；这里钉的是销售之间怎么轮，先把内贸组长禁掉（参与另见 ent-wave3a-assign）
  await setSetting(自动分配不参与key, { [内组长]: "禁止" });
  当(老板, "老板", "ADMIN");
  expect(await 设线部门({ 内贸: [内贸部], 外贸: [外贸部] })).toEqual({ ok: true });
  当(市场管, "市场管理");
});

describe("市场成员 + 暂不分配的客户：自动分配", () => {
  it("大陆客户：挑本月分得最少的内贸销售；客户、名下项目、联系人一起给他，算一次分配、清待分配、只通知接手人", async () => {
    // 内一本月已分过 1 条：该轮到内二
    await prisma.entLeadAssign.create({ data: { toUserId: 内一, byUserId: 市场管, month: 月份(), counted: true, kind: "营销" } });
    const { c, p, ct } = await 建客户({ 待分配: true });
    // 同一位客户名下另一条市场自己的项目：随客户一起走
    const 另一 = (await prisma.project.create({ data: { name: "另一条", customerId: c, ownerId: 市场管, creatorId: 市场管, bizLine: "内贸", assignMode: "暂不分配" } })).id;
    expect(await 页面可自动分配(mocks.user, { id: c, salesOwnerId: 市场管, bizLine: "内贸", pool: null })).toBe(true);

    const r = await 客户自动分配(c, null);
    expect(r).toMatchObject({ ok: true, toUserId: 内二, 接手人: "内贸二" });
    if (r.ok) expect(r.为什么).toContain("按客户区域：内贸");
    expect(await 客户负责人(c)).toBe(内二);
    expect((await 项目(p)).ownerId).toBe(内二);
    expect((await 项目(p)).awaitAssignAt).toBeNull();
    expect((await 项目(另一)).ownerId).toBe(内二);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: ct } })).customerId).toBe(c);
    // 算分配：一条分配记录（算数），换负责人记成 market-assign（分配，不算转客户）
    const 记录 = await prisma.entLeadAssign.findMany({ where: { projectId: p } });
    expect(记录).toHaveLength(1);
    expect(记录[0]).toMatchObject({ toUserId: 内二, fromUserId: 市场管, byUserId: 市场管, counted: true });
    expect(await prisma.customerOwnerLog.findMany({ where: { customerId: c }, select: { kind: true, fromOwnerId: true, toOwnerId: true } }))
      .toEqual([{ kind: "market-assign", fromOwnerId: 市场管, toOwnerId: 内二 }]);
    // 只通知接手人（P-转-17）：没有交接待确认，旁人没有铃铛
    const 铃 = await prisma.entNotice.findMany({ where: { kind: { not: "快轮到" } } }); // 快轮到（11-18）另算，见 ent-assign-eta.test.ts
    expect(铃.map((n) => n.userId)).toEqual([内二]);
    expect(铃[0].kind).toBe("自动分配");
    expect(await prisma.entHandover.count()).toBe(0);
  });

  it("并列（本月都 0 条）给最早建号的；非大陆客户只挑外贸销售，不给销售管理", async () => {
    const 一 = await 建客户();
    expect(await 客户自动分配(一.c, null)).toMatchObject({ ok: true, toUserId: 内一 });
    const 二 = await 建客户({ 地址: 美国, 项目线: "外贸" });
    expect(await 客户自动分配(二.c, null)).toMatchObject({ ok: true, toUserId: 外一 });
    const 三 = await 建客户({ 地址: 美国 });
    expect(await 客户自动分配(三.c, null)).toMatchObject({ ok: true, toUserId: 外二 });
    for (const x of [一, 二, 三]) expect([外组长, 内组长]).not.toContain(await 客户负责人(x.c));
  });

  it("渠道运营转自己的暂不分配客户也能自动分配；记一条操作日志", async () => {
    当(渠运, "渠运");
    const { c } = await 建客户({ 负责人: 渠运 });
    const r = await 客户自动分配(c, null);
    expect(r).toMatchObject({ ok: true, toUserId: 内一 });
    expect(await 客户负责人(c)).toBe(内一);
    const 日志 = await prisma.auditLog.findFirst({ where: { entity: "Customer", entityId: c } });
    expect(日志?.summary).toContain("自动分配");
  });

  it("项目分配方式不是暂不分配、但客户业务线标签是「暂不分配」：也算，能自动分", async () => {
    const { c } = await 建客户({ 方式: "个人自持", 客户线: "暂不分配" });
    expect(await 客户自动分配(c, null)).toMatchObject({ ok: true, toUserId: 内一 });
  });

  it("项目业务线是「暂不分配」也算；客户地址全空、号也认不出、我也没事业部：两条线都算", async () => {
    await prisma.entMember.update({ where: { userId: 市场管 }, data: { deptId: null } });
    const { c } = await 建客户({ 方式: "自动分配", 项目线: "暂不分配", 地址: { addrCountry: null }, 号: null });
    const r = await 客户自动分配(c, null);
    expect(r).toMatchObject({ ok: true, 区域未填: true });
    if (r.ok) expect([内一, 内二, 外一, 外二]).toContain(r.toUserId);
  });

  // 分配方向（11-18）：区域 → 电话 → 本人事业部；框里改了按改的
  it("分配方向：区域空看电话（+44 → 外贸）；再空看我的事业部（市场运营部在内贸事业部下 → 内贸）；手动改了按改的", async () => {
    const 甲 = await 建客户({ 地址: { addrCountry: null }, 号: "+447700900123" });
    const r1 = await 客户自动分配(甲.c, null);
    expect(r1).toMatchObject({ ok: true });
    if (r1.ok) { expect([外一, 外二]).toContain(r1.toUserId); expect(r1.为什么).toContain("按电话（国外号码）：外贸"); }
    const 乙 = await 建客户({ 地址: { addrCountry: null }, 号: null });
    const r2 = await 客户自动分配(乙.c, null);
    if (r2.ok) { expect([内一, 内二]).toContain(r2.toUserId); expect(r2.为什么).toContain("按你所在事业部：内贸"); }
    expect(r2).toMatchObject({ ok: true });
    const 丙 = await 建客户();
    const r3 = await 客户自动分配(丙.c, null, "外贸");
    if (r3.ok) { expect([外一, 外二]).toContain(r3.toUserId); expect(r3.为什么).toContain("按选的分配方向：外贸"); }
    expect(r3).toMatchObject({ ok: true });
    expect(await 客户自动分配((await 建客户()).c, null, "火星")).toMatchObject({ ok: false, error: "分配方向只能选内贸或外贸" });
  });
});

describe("不能用自动分配的：服务端拦，什么都不动", () => {
  it("总管理、销售管理（账号 ADMIN / MANAGER）不是市场成员：拦；页面也不摆", async () => {
    const { c, p } = await 建客户();
    for (const [id, name, role] of [[老板, "老板", "ADMIN"], [外组长, "外贸组长", "ADMIN"], [内组长, "内贸组长", "MANAGER"]] as const) {
      当(id, name, role);
      expect(await 客户自动分配(c, null)).toEqual({ ok: false, error: 不是市场话 });
      expect(await 页面可自动分配(mocks.user, { id: c, salesOwnerId: 市场管, bizLine: "内贸", pool: null })).toBe(false);
    }
    expect(await 客户负责人(c)).toBe(市场管);
    expect((await 项目(p)).ownerId).toBe(市场管);
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("不是暂不分配的客户（项目自动分配 / 个人自持、业务线内贸）：拦，页面不摆", async () => {
    const { c } = await 建客户({ 方式: "个人自持" });
    expect(await 客户自动分配(c, null)).toEqual({ ok: false, error: 不是暂不分配话 });
    expect(await 页面可自动分配(mocks.user, { id: c, salesOwnerId: 市场管, bizLine: "内贸", pool: null })).toBe(false);
    expect(await 客户负责人(c)).toBe(市场管);
  });

  it("暂不分配的项目已转商机 / 已结束：不算暂不分配", async () => {
    const { c, p } = await 建客户();
    await prisma.project.update({ where: { id: p }, data: { phase: "商机" } });
    expect(await 客户自动分配(c, null)).toEqual({ ok: false, error: 不是暂不分配话 });
  });

  it("规则「线索分配」关着：拦，页面不摆", async () => {
    await setSetting(规则.线索分配.key, false);
    const { c } = await 建客户();
    expect(await 客户自动分配(c, null)).toMatchObject({ ok: false });
    expect(await 页面可自动分配(mocks.user, { id: c, salesOwnerId: 市场管, bizLine: "内贸", pool: null })).toBe(false);
    expect(await 客户负责人(c)).toBe(市场管);
  });

  it("一个能接的人都没有：不转、不标待分配、不写分配记录、不发铃铛，回原因", async () => {
    await setSetting(自动分配不参与key, { [内一]: "暂停", [内二]: "禁止", [内组长]: "禁止" });
    const { c, p } = await 建客户();
    const r = await 客户自动分配(c, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^没有自动分出去：没有能接的人.*客户还在原负责人名下，没转；可以改用指定分配$/);
    expect(await 客户负责人(c)).toBe(市场管);
    expect((await 项目(p)).ownerId).toBe(市场管);
    expect((await 项目(p)).awaitAssignAt).toBeNull();
    expect(await prisma.entLeadAssign.count()).toBe(0);
    expect(await prisma.entNotice.count()).toBe(0);
  });
});

/*
 * 客户列表勾几位「批量转让」选自动分配（批量客户自动分配；框打开时的 批量客户自动分配预看）：
 *   每位和单个客户的自动分配同一套（同一个挑人、同一份「暂不分配」判定）；批内前面刚分出去的算进本月数，不全给同一个人；
 *   混着勾了不是暂不分配的：那几位不动、回原因，不悄悄自动分；只有市场成员能用
 */
describe("批量转让选自动分配", () => {
  it("一批 3 位大陆 + 1 位外贸客户：按本月分得最少轮着给，批内算上前面刚分的；通知按接手人合成一条", async () => {
    const 们 = [await 建客户(), await 建客户(), await 建客户(), await 建客户({ 地址: 美国 })];
    const r = await 批量客户自动分配(们.map((x) => x.c), "工作量调整");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.结果.map((x) => (x.ok ? x.toUserId : x.error))).toEqual([内一, 内二, 内一, 外一]);
    for (const [i, 谁] of [内一, 内二, 内一, 外一].entries()) {
      expect(await 客户负责人(们[i].c)).toBe(谁);
      expect((await 项目(们[i].p)).ownerId).toBe(谁);
    }
    // 每位一条算数的分配记录（下一位挑人时就是读这个），操作日志每位一行、带原因
    expect(await prisma.entLeadAssign.count({ where: { counted: true } })).toBe(4);
    const 日志 = await prisma.auditLog.findMany({ where: { entity: "Customer", entityId: { in: 们.map((x) => x.c) } } });
    expect(日志).toHaveLength(4);
    for (const l of 日志) expect(l.summary).toMatch(/自动分配.*（工作量调整）$/);
    const 铃 = await prisma.entNotice.findMany({ where: { kind: { not: "快轮到" } }, orderBy: { userId: "asc" } }); // 快轮到（11-18）另算
    expect(铃.map((n) => n.userId).sort()).toEqual([内一, 内二, 外一].sort());
    expect(铃.find((n) => n.userId === 内一)?.title).toContain("2 条");
  });

  it("本月已有分配数的照算：内一已分 2 条，一批 3 位先给内二两位，再轮到内一", async () => {
    for (let i = 0; i < 2; i++) await prisma.entLeadAssign.create({ data: { toUserId: 内一, byUserId: 市场管, month: 月份(), counted: true, kind: "营销" } });
    const 们 = [await 建客户(), await 建客户(), await 建客户()];
    const r = await 批量客户自动分配(们.map((x) => x.c), null);
    // 内一 2、内二 0 → 内二（1）→ 内二（2，和内一并列、内一建号早）→ 内一
    expect(r.ok && r.结果.map((x) => x.ok && x.toUserId)).toEqual([内二, 内二, 内一]);
  });

  it("混着勾了不是暂不分配的、销售名下的：那几位不动、回原因；暂不分配的照分；预看事先说清哪些能分", async () => {
    const 能 = await 建客户();
    const 自持 = await 建客户({ 方式: "个人自持" });
    const 销售的 = await 建客户({ 负责人: 内二 });
    const ids = [能.c, 自持.c, 销售的.c];

    const 看 = await 批量客户自动分配预看(ids);
    expect(看.ok).toBe(true);
    if (看.ok) {
      expect(看.可).toEqual([能.c]);
      expect(看.不可.map((x) => x.customerId)).toEqual([自持.c, 销售的.c]);
      expect(看.不可[0].error).toBe(不是暂不分配话);
    }

    const r = await 批量客户自动分配(ids, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.结果[0]).toMatchObject({ customerId: 能.c, ok: true, toUserId: 内一 });
    expect(r.结果[1]).toEqual({ customerId: 自持.c, name: expect.any(String), ok: false, error: 不是暂不分配话 });
    expect(r.结果[2]).toMatchObject({ customerId: 销售的.c, ok: false });
    expect(await 客户负责人(自持.c)).toBe(市场管);
    expect((await 项目(自持.p)).ownerId).toBe(市场管);
    expect(await 客户负责人(销售的.c)).toBe(内二);
    expect(await prisma.entLeadAssign.count()).toBe(1);
  });

  it("不是市场成员（总管理、销售管理）：预看和批量都拒，什么都不动", async () => {
    const { c } = await 建客户();
    for (const [id, name, role] of [[老板, "老板", "ADMIN"], [内组长, "内贸组长", "MANAGER"]] as const) {
      当(id, name, role);
      expect(await 批量客户自动分配预看([c])).toEqual({ ok: false, error: 不是市场话 });
      expect(await 批量客户自动分配([c], null)).toEqual({ ok: false, error: 不是市场话 });
    }
    expect(await 客户负责人(c)).toBe(市场管);
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("页面递不递：市场成员 + 规则开着才递；总管理、规则关着不递", async () => {
    expect(await 批量可自动分配(mocks.user)).toBe(true);
    当(老板, "老板", "ADMIN");
    expect(await 批量可自动分配(mocks.user)).toBe(false);
    当(市场管, "市场管理");
    await setSetting(规则.线索分配.key, false);
    expect(await 批量可自动分配(mocks.user)).toBe(false);
  });

  it("没勾、超过 200 位：回原因；一个能接的人都没有：每位回原因，不转、不写分配记录、不发铃铛", async () => {
    expect(await 批量客户自动分配([], null)).toEqual({ ok: false, error: "先勾选要分的客户" });
    expect(await 批量客户自动分配(Array.from({ length: 201 }, (_, i) => `x${i}`), null)).toMatchObject({ ok: false, error: expect.stringContaining("200") });
    await setSetting(自动分配不参与key, { [内一]: "暂停", [内二]: "禁止", [内组长]: "禁止" });
    const 们 = [await 建客户(), await 建客户()];
    const r = await 批量客户自动分配(们.map((x) => x.c), null);
    expect(r.ok && r.结果.every((x) => !x.ok && /^没有自动分出去：没有能接的人/.test(x.error))).toBe(true);
    for (const x of 们) expect(await 客户负责人(x.c)).toBe(市场管);
    expect(await prisma.entLeadAssign.count()).toBe(0);
    expect(await prisma.entNotice.count()).toBe(0);
  });
});

// 11-18 定：转让框在「分配」模式下（市场成员分暂不分配的客户）选「指定」，只能指定正常参与的人（同 指定问题）；
// 服务端按「这次是不是市场分配」判，不看前端；普通转让（不是暂不分配、不是市场成员转）不变
describe("市场分配的指定：只能指定正常参与的人", () => {
  it("市场成员把暂不分配的客户指定给暂停 / 禁止的销售：拒，客户不动；给正常的：照转", async () => {
    await setSetting(自动分配不参与key, { [内组长]: "禁止", [内一]: "暂停", [外一]: "禁止" });
    const a = await 建客户();
    for (const 谁 of [内一, 外一]) {
      const r = await assignSalesOwner([a.c], 谁);
      expect(r.ok, String(谁)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/暂停|禁止/);
    }
    expect(await 客户负责人(a.c)).toBe(市场管);
    expect(await assignSalesOwner([a.c], 内二)).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(a.c)).toBe(内二);
  });

  it("批量里混着一位暂不分配的：整批按市场分配判，指定给暂停的拒", async () => {
    await setSetting(自动分配不参与key, { [内组长]: "禁止", [内一]: "暂停" });
    const a = await 建客户(), b = await 建客户({ 方式: "个人自持" });
    expect((await assignSalesOwner([b.c, a.c], 内一)).ok).toBe(false);
    expect(await 客户负责人(a.c)).toBe(市场管);
    expect(await 客户负责人(b.c)).toBe(市场管);
  });

  it("普通转让不变：不是暂不分配的客户、或总管理改派，给暂停的照转", async () => {
    await setSetting(自动分配不参与key, { [内组长]: "禁止", [内一]: "暂停" });
    const 自持 = await 建客户({ 方式: "个人自持" });
    expect(await assignSalesOwner([自持.c], 内一)).toMatchObject({ ok: true, updated: 1 });
    const a = await 建客户();
    当(老板, "老板", "ADMIN");
    expect(await assignSalesOwner([a.c], 内一)).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户负责人(a.c)).toBe(内一);
  });

  it("规则「线索分配」关着：不算市场分配，照转", async () => {
    await setSetting(自动分配不参与key, { [内组长]: "禁止", [内一]: "暂停" });
    await setSetting(规则.线索分配.key, false);
    const a = await 建客户();
    expect(await assignSalesOwner([a.c], 内一)).toMatchObject({ ok: true, updated: 1 });
  });

  it("批量预看带回可指定的人：只列正常参与的销售 / 销售管理", async () => {
    await setSetting(自动分配不参与key, { [内组长]: "禁止", [内一]: "暂停" });
    const a = await 建客户();
    const 看 = await 批量客户自动分配预看([a.c]);
    expect(看.ok).toBe(true);
    if (!看.ok) return;
    expect(new Set(看.可指定)).toEqual(new Set([内二, 外一, 外二, 外组长]));
  });
});
