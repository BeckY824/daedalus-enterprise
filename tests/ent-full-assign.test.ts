/**
 * 上线前全面测试 · 自动分配（11-02）：按 c1 的开关组合（按组织看客户、线索分配、市场复核、不设配额全开，内贸 / 外贸各勾部门）
 *   - 勾了的部门（连下级）里、有销售业务角色、在职的才挑；自动分配只给「销售」，销售管理只能手动指派（11-02）；没勾的兄弟部门、渠道运营、没业务角色、停用的都不挑
 *   - 公平：三个能接的人连分 9 条 = 各 3 条，相邻两条不给同一个人；批量和单条一样
 *   - 手动指派给停用 / 没勾部门的人：拒
 *   - 铃铛只给接手人，点的人和旁人收不到
 *   - 一个能接的人都没有：回「待分配」不抛错，项目原样不动
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "市场", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));

import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/settings";
import { resetDb } from "./reset";
import { 分配线索, 自动分配线索, 批量自动分配, 项目分配线, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";

const 当 = (id: string, name: string, role = "SALES") => { mocks.user = { ...mocks.user, id, name, role }; };

let 老板: string, 市场: string;
let 外一: string, 外二: string, 外三: string, 外组长: string, 档口销售: string, 外客服: string, 外没角色: string, 外停用: string;
let 内一: string, 内二: string;
let 客户号 = 0;
let 外贸部: string, 外贸一组: string, 外贸一组下: string, 外贸二组: string, 档口: string, 内贸部: string, 内贸组: string, 内贸小组: string;

// 一条线索一位客户：市场分给销售算转客户（11-09 第五节问题 1），同一位客户的别的项目会一起过去，那种情况不是这里钉的公平轮询
const 建项目 = async (name: string, bizLine: string | null) => {
  const 客户 = (await prisma.customer.create({ data: { name: `客户${++客户号}`, phone: `1390000${String(客户号).padStart(4, "0")}`, salesOwnerId: 市场 } })).id;
  return (await prisma.project.create({ data: { name, customerId: 客户, ownerId: 市场, creatorId: 市场, bizLine } })).id;
};
const 负责人 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;

beforeEach(async () => {
  await resetDb();
  const 部 = async (name: string, parentId: string | null = null) => (await prisma.entDept.create({ data: { name, parentId } })).id;
  外贸部 = await 部("外贸部");
  外贸一组 = await 部("外贸一组", 外贸部);
  外贸一组下 = await 部("外贸一组下", 外贸一组);
  外贸二组 = await 部("外贸二组", 外贸部);
  档口 = await 部("档口", 外贸部);
  内贸部 = await 部("内贸部");
  内贸组 = await 部("内贸组", 内贸部);
  内贸小组 = await 部("内贸小组", 内贸组);

  let 第几 = 0;
  const 人 = async (email: string, name: string, bizRole: string, deptId: string | null, extra: { line?: string; active?: boolean } = {}) => {
    第几++;
    const id = (await prisma.user.create({
      data: { email, name, title: "", role: "SALES", password: "x", active: extra.active ?? true, createdAt: new Date(2026, 0, 第几) },
    })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, deptId, line: extra.line ?? null } });
    return id;
  };
  老板 = await 人("boss", "老板", "director", null);
  市场 = await 人("mkt", "市场", "marketing_mgr", null);
  外一 = await 人("w1", "外贸销售一", "sales", 外贸一组);
  外二 = await 人("w2", "外贸销售二", "sales", 外贸二组);
  外三 = await 人("w3", "外贸销售三", "sales", 外贸一组下);
  外组长 = await 人("wl", "外贸组长", "sales_mgr", 外贸二组);
  档口销售 = await 人("dk", "档口销售", "sales", 档口, { line: "外贸" });
  外客服 = await 人("wcs", "外贸客服", "channel_ops", 外贸一组);
  外没角色 = await 人("wnr", "没角色的", "", 外贸一组);
  外停用 = await 人("woff", "停用销售", "sales", 外贸二组, { active: false });
  内一 = await 人("n1", "内贸销售一", "sales", 内贸小组);
  内二 = await 人("n2", "内贸销售二", "sales", 内贸部);

  // c1 开关组合
  for (const k of [规则.按组织看客户.key, 规则.线索分配.key, 规则.市场复核.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  // 组长（销售管理）自动分配本来就不分（11-02 只给销售）；再禁掉一层，钉公平时更干净
  await setSetting(自动分配不参与key, { [外组长]: "禁止" });

  当(老板, "老板");
  const r = await 设线部门({ 内贸: [内贸部], 外贸: [外贸一组, 外贸二组] });
  expect(r).toEqual({ ok: true });
  当(市场, "市场");
});

describe("按部门挑人：谁进候选", () => {
  it("外贸线：只有勾了的两个组（连下级）里、在职、销售角色的；档口 / 渠道运营 / 没角色 / 停用 都不进", async () => {
    const P = await 建项目("外看", "外贸");
    const 线 = await 项目分配线(P);
    expect([...(线?.可选 ?? [])].sort()).toEqual([外一, 外二, 外三].sort());
  });

  it("内贸线：内贸部连孙部门的人都进，不混外贸的人", async () => {
    const P = await 建项目("内看", "内贸");
    expect([...((await 项目分配线(P))?.可选 ?? [])].sort()).toEqual([内一, 内二].sort());
  });

  it("组长（销售管理）在勾了的组里、没禁掉 = 手动指派能挑他", async () => {
    await setSetting(自动分配不参与key, {});
    const P = await 建项目("组长看", "外贸");
    expect(((await 项目分配线(P))?.可选 ?? [])).toContain(外组长);
  });

  it("自动分配只给销售（11-02「只给销售」）：组长没禁掉也一条拿不到", async () => {
    await setSetting(自动分配不参与key, {});
    const 拿到: string[] = [];
    for (let i = 0; i < 8; i++) {
      const P = await 建项目(`只销售${i}`, "外贸");
      expect(await 自动分配线索(P, { 项目: true })).toMatchObject({ ok: true });
      拿到.push((await 负责人(P))!);
    }
    expect(拿到).not.toContain(外组长);
    expect(new Set(拿到)).toEqual(new Set([外一, 外二, 外三]));
  });

  it("勾的组里只剩组长能接：自动分配回待分配，不分给他", async () => {
    await setSetting(自动分配不参与key, { [外一]: "暂停", [外二]: "禁止", [外三]: "暂停" });
    const P = await 建项目("只剩组长", "外贸");
    expect(await 自动分配线索(P, { 项目: true })).toMatchObject({ ok: false, 待分配: true });
    expect(await 负责人(P)).toBe(市场);
  });
});

describe("公平轮流（不设配额）", () => {
  it("外贸 9 条单条自动分配：三人各 3 条，相邻两条不给同一个人，排除的人一条没拿到", async () => {
    const 拿到: string[] = [];
    for (let i = 0; i < 9; i++) {
      const r = await 自动分配线索(await 建项目(`外${i}`, "外贸"), { 项目: true });
      if (!r.ok) throw new Error(r.error);
      拿到.push(r.toUserId);
    }
    const 数 = (id: string) => 拿到.filter((x) => x === id).length;
    expect([数(外一), 数(外二), 数(外三)]).toEqual([3, 3, 3]);
    for (let i = 1; i < 拿到.length; i++) expect(拿到[i]).not.toBe(拿到[i - 1]);
    for (const 不该 of [外组长, 档口销售, 外客服, 外没角色, 外停用, 内一, 内二, 市场, 老板]) expect(拿到).not.toContain(不该);
    // 分配记录 9 条、项目负责人和返回的一致
    expect(await prisma.entLeadAssign.count()).toBe(9);
  });

  it("批量自动分配 6 条外贸：各 2 条，和单条点 6 次一样", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await 建项目(`批${i}`, "外贸"));
    const r = await 批量自动分配(ids, { 项目: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.结果.every((x) => x.ok)).toBe(true);
    const 主 = await Promise.all(ids.map(负责人));
    expect([外一, 外二, 外三].map((id) => 主.filter((x) => x === id).length)).toEqual([2, 2, 2]);
  });

  it("人停用了：下一条就不再分给他，剩下两人轮", async () => {
    await prisma.user.update({ where: { id: 外三 }, data: { active: false } });
    const 拿到: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await 自动分配线索(await 建项目(`停${i}`, "外贸"), { 项目: true });
      if (!r.ok) throw new Error(r.error);
      拿到.push(r.toUserId);
    }
    expect(拿到).not.toContain(外三);
    expect(拿到.filter((x) => x === 外一)).toHaveLength(2);
  });
});

describe("手动指派挡人", () => {
  it("停用的、没勾部门的、渠道运营、没角色的、另一条线的：都拒，负责人不变", async () => {
    const P = await 建项目("手动", "外贸");
    for (const 谁 of [外停用, 档口销售, 外客服, 外没角色, 内一]) {
      const r = await 分配线索({ projectId: P, toUserId: 谁, 原负责人: 市场 });
      expect(r.ok, `分给 ${谁} 应被拒`).toBe(false);
    }
    expect(await 负责人(P)).toBe(市场);
    expect(await prisma.entLeadAssign.count()).toBe(0);
    expect(await 分配线索({ projectId: P, toUserId: 外二, 原负责人: 市场 })).toEqual({ ok: true });
    expect(await 负责人(P)).toBe(外二);
  });

  it("停用的人报的是「停用」这类具体原因，不是泛泛一句", async () => {
    const P = await 建项目("手动二", "外贸");
    const r = await 分配线索({ projectId: P, toUserId: 外停用, 原负责人: 市场 });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("停用") });
  });
});

describe("分配通知只给接手人", () => {
  it("自动分配：接手人一条「自动分配」，点的人、旁人都没有", async () => {
    const P = await 建项目("通知自动", "外贸");
    const r = await 自动分配线索(P, { 项目: true });
    if (!r.ok) throw new Error(r.error);
    const 全部 = await prisma.entNotice.findMany();
    expect(全部).toHaveLength(1);
    expect(全部[0]).toMatchObject({ userId: r.toUserId, kind: "自动分配", link: `/projects/${P}` });
    expect(全部[0].title).toContain("通知自动");
  });

  it("手动指派：接手人一条「分配」，标题带点的人", async () => {
    const P = await 建项目("通知手动", "内贸");
    expect(await 分配线索({ projectId: P, toUserId: 内二, 原负责人: 市场 })).toEqual({ ok: true });
    const 全部 = await prisma.entNotice.findMany();
    expect(全部).toHaveLength(1);
    expect(全部[0]).toMatchObject({ userId: 内二, kind: "分配" });
    expect(全部[0].title).toContain("市场");
  });

  it("批量 3 条同一人只会有一条合并的；三人各一条", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await 建项目(`批通知${i}`, "外贸"));
    const r = await 批量自动分配(ids, { 项目: true });
    if (!r.ok) throw new Error(r.error);
    const 全部 = await prisma.entNotice.findMany();
    expect(全部.map((n) => n.userId).sort()).toEqual([外一, 外二, 外三].sort());
    expect(全部.every((n) => n.kind === "自动分配")).toBe(true);
  });
});

describe("挑不到人", () => {
  it("外贸三人都暂停 / 禁止：回待分配，不抛错，项目负责人不动，没有分配记录；标成待分配，只发待分配提醒（X-85）", async () => {
    await setSetting(自动分配不参与key, { [外一]: "暂停", [外二]: "禁止", [外三]: "暂停", [外组长]: "禁止" });
    const P = await 建项目("没人", "外贸");
    const r = await 自动分配线索(P, { 项目: true });
    expect(r).toMatchObject({ ok: false, 待分配: true });
    expect(await 负责人(P)).toBe(市场);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: P } })).awaitAssignAt).toEqual(expect.any(Date));
    expect(await prisma.entLeadAssign.count()).toBe(0);
    expect(await prisma.entNotice.count({ where: { kind: { not: "待分配" } } })).toBe(0);
  });

  it("勾的部门里的人全停用：同样待分配", async () => {
    await prisma.user.updateMany({ where: { id: { in: [外一, 外二, 外三, 外组长] } }, data: { active: false } });
    const r = await 自动分配线索(await 建项目("全停", "外贸"), { 项目: true });
    expect(r).toMatchObject({ ok: false, 待分配: true });
  });

  it("暂不分配的项目：不自动分，回暂不分配", async () => {
    const r = await 自动分配线索(await 建项目("暂不", "暂不分配"), { 项目: true });
    expect(r).toMatchObject({ ok: false, 暂不分配: true });
  });

  it("批量里混着挑不到的：能分的照分，挑不到的单列失败，不整批失败", async () => {
    const 好 = await 建项目("好的", "内贸");
    const 坏 = await 建项目("暂不的", "暂不分配");
    const r = await 批量自动分配([好, 坏], { 项目: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.结果.find((x) => x.leadId === 好)?.ok).toBe(true);
    expect(r.结果.find((x) => x.leadId === 坏)?.ok).toBe(false);
    expect([内一, 内二]).toContain(await 负责人(好));
    expect(await 负责人(坏)).toBe(市场);
  });
});
