/**
 * 11-18 第四波追加第 13 条（3703 实点发现，P-转-26 指定那一半）：市场成员给「暂不分配」的客户选「指定分配」，也先定方向——
 *   - 内贸：内贸事业部的销售 + 销售管理；外贸：外贸事业部的销售 + 销售管理（11-23 起含外贸销售管理）；销售管理只进本人事业部那条线；再叠参与状态正常
 *   - 默认方向同自动分配那份（客户区域 → 电话 → 本人事业部），可改；服务端 assignSalesOwner 同口径拒，不信前端
 *   - 只管市场成员发起的：系统管理员照旧随便指定（X-141 ④ 还在等客户）
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
import { 批量客户自动分配预看, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 自动分配不参与key, 不设配额key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";

const 当 = (id: string, name: string, role = "SALES") => { mocks.user = { ...mocks.user, id, name, role }; };

let 老板: string, 市场管: string, 外组长: string, 内组长: string;
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
  await 人("ch", "渠运", "channel_ops", 市场部, "SALES", 市场管);
  外一 = await 人("w1", "外贸一", "sales", 外贸部);
  外二 = await 人("w2", "外贸二", "sales", 外贸部);
  外组长 = await 人("wl", "外贸组长", "sales_mgr", 外贸部, "ADMIN");
  内一 = await 人("n1", "内贸一", "sales", 内贸部);
  内二 = await 人("n2", "内贸二", "sales", 内贸部);
  内组长 = await 人("nl", "内贸组长", "sales_mgr", 内贸部, "MANAGER");

  for (const k of [规则.按组织看客户.key, 规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  当(老板, "老板", "ADMIN");
  expect(await 设线部门({ 内贸: [内贸部], 外贸: [外贸部] })).toEqual({ ok: true });
  当(市场管, "市场管理");
});

const 马来西亚: 址 = { addrCountry: "马来西亚" };

describe("市场成员指定分配暂不分配的客户：按方向挑人（P-转-26）", () => {
  it("马来西亚客户（默认外贸）：指定给内贸销售、内贸销售管理都拒，客户不动；外贸销售、外贸销售管理（11-23）照转", async () => {
    const { c } = await 建客户({ 地址: 马来西亚, 号: null });
    expect(await assignSalesOwner([c], 内一, null, undefined, { 说明: "测试原因" })).toMatchObject({ ok: false, error: expect.stringContaining("外贸事业部的销售、销售管理") });
    expect(await assignSalesOwner([c], 内组长, null, undefined, { 说明: "测试原因" })).toMatchObject({ ok: false });
    expect(await 客户负责人(c)).toBe(市场管);
    expect(await assignSalesOwner([c], 外一, null, undefined, { 说明: "测试原因" })).toMatchObject({ ok: true });
    expect(await 客户负责人(c)).toBe(外一);
    const d = await 建客户({ 地址: 马来西亚, 号: null });
    expect(await assignSalesOwner([d.c], 外组长, null, undefined, { 说明: "测试原因" })).toMatchObject({ ok: true });
    expect(await 客户负责人(d.c)).toBe(外组长);
  });

  it("外贸销售管理被暂停：外贸方向指定不到他", async () => {
    await setSetting(自动分配不参与key, { [外组长]: "暂停" });
    const { c } = await 建客户({ 地址: 马来西亚, 号: null });
    expect(await assignSalesOwner([c], 外组长, null, undefined, { 说明: "测试原因" })).toMatchObject({ ok: false });
    expect(await 客户负责人(c)).toBe(市场管);
  });

  it("改了方向（交 内贸）：内贸销售、内贸销售管理都能指定；暂停参与的不行", async () => {
    const { c } = await 建客户({ 地址: 马来西亚, 号: null });
    await setSetting(自动分配不参与key, { [内二]: "暂停" });
    expect(await assignSalesOwner([c], 内二, null, "内贸", { 说明: "测试原因" })).toMatchObject({ ok: false });
    expect(await assignSalesOwner([c], 内组长, null, "内贸", { 说明: "测试原因" })).toMatchObject({ ok: true });
    expect(await 客户负责人(c)).toBe(内组长);
  });

  it("批量预看带上定向：候选表按方向分好，默认线是这几位共同的默认", async () => {
    const a = await 建客户({ 地址: 马来西亚, 号: null }), b = await 建客户({ 地址: 美国, 号: null });
    const r = await 批量客户自动分配预看([a.c, b.c]);
    if (!r.ok) throw new Error(r.error);
    expect(r.定向?.默认线).toBe("外贸");
    expect(new Set(r.定向?.候选表.外贸)).toEqual(new Set([外一, 外二, 外组长]));
    expect(new Set(r.定向?.候选表.内贸)).toEqual(new Set([内一, 内二, 内组长]));
  });

  it("对照：不是暂不分配的客户、系统管理员指定，都不按方向拦", async () => {
    const { c } = await 建客户({ 地址: 马来西亚, 号: null, 方式: "指定分配", 项目线: "外贸" });
    expect(await assignSalesOwner([c], 内一, null, undefined, { 说明: "测试原因" })).toMatchObject({ ok: true });
    const d = await 建客户({ 地址: 马来西亚, 号: null });
    当(老板, "老板", "ADMIN");
    expect(await assignSalesOwner([d.c], 内一, null, undefined, { 说明: "测试原因" })).toMatchObject({ ok: true });
  });
});
