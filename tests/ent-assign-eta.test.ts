/**
 * 自动分配「快轮到我」（11-18 客户定第 1、2 题 A；lib/enterprise/assign-eta.ts + lead-assign 前面几条）：
 *   - 估算复用挑人规则：前面几条 = 按 挑接手人 一条条往下挑；算出来的 N，真自动分配 N 条都不给他、第 N+1 条给他
 *   - 一条分配记录都没有 = 暂无法估算；有了才给数。不参加的（暂停 / 禁止、销售管理、不在任何一条线）没有这一行
 *   - 谁能看：本人；分配线索的人（市场管理、总管理）看全部；销售管理只看本组；别的销售看不到同事的
 *   - 推送边沿触发：进 3 条以内铃铛 + 飞书各一次（站内一条，飞书由 notify 跟着推）；被分到一条后重新计数、下一次进 3 条以内再推；
 *     数字来回跳（有人暂停又恢复）不重复推；只推销售本人，管理只看不推
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
import { 分配线索, 自动分配线索, 本月分配情况, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { 前面几条, 自动分配不参与key, 不设配额key, type 候选人 } from "@/lib/enterprise/lead-assign";
import { 估算轮到, 我的轮到, 能看轮到, 快轮到kind, 轮到话, 快轮到提醒 } from "@/lib/enterprise/assign-eta";
import { 读组织 } from "@/lib/enterprise/org";
import { 规则 } from "@/lib/enterprise/rules";

const 当 = (id: string, name: string) => { mocks.user = { ...mocks.user, id, name }; };

describe("前面几条（纯函数，复用 挑接手人）", () => {
  const 人 = (userId: string, 已分: number, 第几: number, 配额: number | null = null): 候选人 => ({ userId, 已分, 配额, 进池: new Date(2026, 0, 第几) });

  it("不限额：比我少的先补到和我一样多，一样多按进池先后", () => {
    // A 已分 2（最早）、B 0、C 1：B → B → C → 轮到 A（三人都是 2，A 最早）
    const 候选 = [人("A", 2, 1), 人("B", 0, 2), 人("C", 1, 3)];
    expect(前面几条(候选, new Set(), true, true, "A")).toBe(3);
    expect(前面几条(候选, new Set(), true, true, "B")).toBe(0);
    expect(前面几条(候选, new Set(), true, true, "C")).toBe(2); // B → B（和 C 一样多时 B 进池早）→ C
    // 原数组不被改
    expect(候选.map((c) => c.已分)).toEqual([2, 0, 1]);
  });

  it("暂停 / 禁止的人不进轮转：前面的人跳过他；他自己 = null", () => {
    const 候选 = [人("A", 2, 1), 人("B", 0, 2), 人("C", 1, 3)];
    expect(前面几条(候选, new Set(["B"]), true, true, "A")).toBe(1);
    expect(前面几条(候选, new Set(["B"]), true, true, "B")).toBeNull();
    expect(前面几条(候选, new Set(), true, true, "不在里面")).toBeNull();
  });

  it("按配额：分满了永远轮不到 = null；比例低的先", () => {
    const 候选 = [人("A", 2, 1, 2), 人("B", 1, 2, 4), 人("C", 0, 3, 1)];
    expect(前面几条(候选, new Set(), true, false, "A")).toBeNull();
    // C 0/1 先（比例 0）、然后 C 满了，B 1/4 → B 2/4 → B 3/4 → B 4/4 满 → 只剩 A（已满）= null；B 自己：C 先一条
    expect(前面几条(候选, new Set(), true, false, "B")).toBe(1);
  });

  it("说法：0 = 下一条就轮到你；暂无法估算原样", () => {
    expect(轮到话({ 数: 0 })).toBe("下一条就轮到你");
    expect(轮到话({ 数: 5 })).toBe("前面约 5 条轮到你");
    expect(轮到话("暂无法估算")).toBe("暂无法估算");
  });
});

let 老板: string, 市场: string, 组长: string, 外组长: string;
let 内: string[] = [];
let 外一: string, 外二: string;
let 客户号 = 0;
let 内贸一组: string, 内贸二组: string;

// 市场成员点自动分配按客户区域定线（P-转-26）：内贸客户 = 中国浙江
const 建项目 = async (name: string, 外贸 = false) => {
  const 客户 = (await prisma.customer.create({ data: { name: `客户${++客户号}`, phone: `1390000${String(客户号).padStart(4, "0")}`, salesOwnerId: 市场, ...(外贸 ? { addrCountry: "美国" } : { addrCountry: "中国", addrProvince: "浙江省" }) } })).id;
  return (await prisma.project.create({ data: { name, customerId: 客户, ownerId: 市场, creatorId: 市场, bizLine: 外贸 ? "外贸" : "内贸" } })).id;
};
const 自动分一条 = async (外贸 = false) => {
  当(市场, "市场");
  const r = await 自动分配线索(await 建项目(`线索${客户号 + 1}`, 外贸), { 项目: true });
  if (!r.ok) throw new Error(r.error);
  return r.toUserId;
};
const 估 = async () => 估算轮到(await 读组织());
const 快轮到们 = async (userId?: string) => prisma.entNotice.findMany({ where: { kind: 快轮到kind, ...(userId ? { userId } : {}) }, orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  await resetDb();
  客户号 = 0;
  const 部 = async (name: string, parentId: string | null = null) => (await prisma.entDept.create({ data: { name, parentId } })).id;
  const 内贸部 = await 部("内贸部");
  内贸一组 = await 部("内贸一组", 内贸部);
  内贸二组 = await 部("内贸二组", 内贸部);
  const 外贸部 = await 部("外贸部");
  let 第几 = 0;
  const 人 = async (name: string, bizRole: string, deptId: string | null) => {
    第几++;
    const id = (await prisma.user.create({ data: { email: `u${第几}@x`, name, title: "", role: "SALES", password: "x", createdAt: new Date(2026, 0, 第几) } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, deptId } });
    return id;
  };
  老板 = await 人("老板", "director", null);
  市场 = await 人("市场", "marketing_mgr", null);
  组长 = await 人("内贸一组组长", "sales_mgr", 内贸一组);
  外组长 = await 人("外贸组长", "sales_mgr", 外贸部);
  // 内贸 6 人：一组 3 个、二组 3 个，按开号先后
  内 = [];
  for (let i = 1; i <= 6; i++) 内.push(await 人(`内贸销售${i}`, "sales", i <= 3 ? 内贸一组 : 内贸二组));
  外一 = await 人("外贸销售一", "sales", 外贸部);
  外二 = await 人("外贸销售二", "sales", 外贸部);
  for (const k of [规则.按组织看客户.key, 规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  // 内贸销售管理 11-18 起、外贸销售管理 11-23 起参加自动分配：这里的用例只看销售，先把两位组长设成禁止；参加时的样子见「销售管理参加」
  await setSetting(自动分配不参与key, { [组长]: "禁止", [外组长]: "禁止" });
  当(老板, "老板");
  expect(await 设线部门({ 内贸: [内贸部], 外贸: [外贸部] })).toEqual({ ok: true });
});

describe("销售管理参加（内贸 11-18 第 9 题 B、外贸 11-23）", () => {
  it("参与状态正常的内贸、外贸销售管理在本线估算里各有一行；被暂停的没有", async () => {
    await setSetting(自动分配不参与key, {});
    const m = await 估();
    expect(m.get(组长)).toBe("暂无法估算");
    expect(m.get(外组长)).toBe("暂无法估算");
    await setSetting(自动分配不参与key, { [外组长]: "暂停" });
    const m2 = await 估();
    expect(m2.has(外组长)).toBe(false);
    expect(m2.get(组长)).toBe("暂无法估算");
  });
});

describe("估算", () => {
  it("一条分配记录都没有：参加的人都是「暂无法估算」；销售管理、规则关着都没有这一行", async () => {
    const m = await 估();
    expect([...m.keys()].sort()).toEqual([...内, 外一, 外二].sort());
    expect([...m.values()].every((x) => x === "暂无法估算")).toBe(true);
    expect(m.has(组长)).toBe(false);
    expect(m.has(外组长)).toBe(false);
    await setSetting(规则.线索分配.key, false);
    expect((await 估()).size).toBe(0);
  });

  it("有了记录给数，和真自动分配对得上：算出 N，接着 N 条都不给他、第 N+1 条给他", async () => {
    await 自动分一条(); // 给 内[0]（都 0 条，开号最早）
    const m = await 估();
    expect(m.get(内[0])).toEqual({ 数: 5 });
    expect(m.get(内[1])).toEqual({ 数: 0 });
    expect(m.get(内[5])).toEqual({ 数: 4 });
    // 外贸那条线照样有数（全公司有记录了），外一 下一条就是他
    expect(m.get(外一)).toEqual({ 数: 0 });
    const N = (m.get(内[4]) as { 数: number }).数;
    expect(N).toBe(3);
    for (let i = 0; i < N; i++) expect(await 自动分一条()).not.toBe(内[4]);
    expect(await 自动分一条()).toBe(内[4]);
  });

  it("指定分配也算数：手动给 内[1] 一条，他往后排", async () => {
    await 自动分一条(); // 内[0]
    当(市场, "市场");
    expect(await 分配线索({ projectId: await 建项目("指定"), toUserId: 内[1], 原负责人: 市场 })).toEqual({ ok: true });
    const m = await 估();
    // 内[2..5] 0 条在前，然后 内[0]、内[1] 都 1 条按开号
    expect(m.get(内[1])).toEqual({ 数: 5 });
    expect(m.get(内[2])).toEqual({ 数: 0 });
  });

  it("暂停的人不在表里，前面的人跳过他", async () => {
    await 自动分一条(); // 内[0]
    await setSetting(自动分配不参与key, { [内[1]]: "暂停", [组长]: "禁止", [外组长]: "禁止" });
    const m = await 估();
    expect(m.has(内[1])).toBe(false);
    expect(m.get(内[2])).toEqual({ 数: 0 });
    expect(m.get(内[0])).toEqual({ 数: 4 });
  });

  it("首页：本人是参加的销售才有；销售管理、市场没有", async () => {
    await 自动分一条();
    const org = await 读组织();
    expect(await 我的轮到(org, 内[3])).toEqual({ 数: 2 });
    expect(await 我的轮到(org, 组长)).toBeNull();
    expect(await 我的轮到(org, 市场)).toBeNull();
  });
});

describe("谁能看", () => {
  it("本人、市场管理、总管理看全部；销售管理只看本组；别的销售看不到同事", async () => {
    const org = await 读组织();
    const 我 = (id: string) => ({ id, role: "SALES" });
    expect(能看轮到(org, 我(内[3]), 内[3])).toBe(true);
    expect(能看轮到(org, 我(内[3]), 内[4])).toBe(false);
    expect(能看轮到(org, 我(市场), 内[4])).toBe(true);
    expect(能看轮到(org, 我(老板), 外一)).toBe(true);
    expect(能看轮到(org, 我(组长), 内[0])).toBe(true);
    expect(能看轮到(org, 我(组长), 内[3])).toBe(false);
    expect(能看轮到(org, 我(组长), 外一)).toBe(false);
    // 账号 ADMIN 不放行：只认业务角色
    expect(能看轮到(org, { id: 内[3], role: "ADMIN" }, 内[4])).toBe(false);
  });

  it("设置「线索分配」那一屏：组长那一屏只有本组几行带数，别的写空；市场那一屏全有", async () => {
    await 自动分一条();
    当(组长, "组长");
    const 组长看 = (await 本月分配情况())!;
    const 格 = (行们: typeof 组长看, id: string) => 行们.find((r) => r.userId === id)?.轮到;
    expect(格(组长看, 内[1])).toEqual({ 数: 0 });
    expect(格(组长看, 内[4])).toBeNull();
    expect(格(组长看, 外一)).toBeNull();
    当(市场, "市场");
    const 市场看 = (await 本月分配情况())!;
    expect(格(市场看, 内[4])).toEqual({ 数: 3 });
    expect(格(市场看, 外一)).toEqual({ 数: 0 });
    // 销售管理自己不参加自动分配：他那一行没有数
    expect(格(市场看, 组长)).toBeNull();
  });
});

describe("推送（边沿触发）", () => {
  it("进 3 条以内推一次；被分到一条后重新计数，下一次进 3 条以内才推第二次；只推销售本人", async () => {
    // 第 1 条给 内[0]：内[1..4] 前面 0..3 条 → 各推一次；内[5] 前面 4 条、内[0] 前面 5 条不推
    expect(await 自动分一条()).toBe(内[0]);
    const 第一轮 = (await 快轮到们()).map((n) => n.userId);
    expect(第一轮).toEqual(expect.arrayContaining([内[1], 内[2], 内[3], 内[4]]));
    expect(第一轮).not.toContain(内[5]);
    expect(第一轮).not.toContain(内[0]);
    for (const 管 of [老板, 市场, 组长, 外组长]) expect(第一轮).not.toContain(管);
    const 一条 = (await 快轮到们(内[4]))[0];
    expect(一条.title).toBe("自动分配快轮到你了：前面约 3 条轮到你");
    expect(一条.body).toContain("这是估算");
    expect(一条.link).toBe("/dashboard");

    // 第 2 条给 内[1]：内[5] 进 3 条以内 → 推；内[2..4] 已推过，不重复；内[1] 刚分到、前面 5 条不推
    expect(await 自动分一条()).toBe(内[1]);
    expect((await 快轮到们(内[5])).length).toBe(1);
    for (const id of [内[2], 内[3], 内[4]]) expect((await 快轮到们(id)).length).toBe(1);
    expect((await 快轮到们(内[1])).length).toBe(1);

    // 内[2] 分到一条（第 3 条）：内[0] 前面 3 条 → 第一次推；内[2] 自己重新计数，前面 5 条不推
    expect(await 自动分一条()).toBe(内[2]);
    expect((await 快轮到们(内[0])).length).toBe(1);
    expect((await 快轮到们(内[2])).length).toBe(1);

    // 接着分两条（内[3]、内[4]）：内[1] 前面降到 3 条以内 → 这一轮第一次，推第二次（总共 2 条）
    expect(await 自动分一条()).toBe(内[3]);
    expect(await 自动分一条()).toBe(内[4]);
    expect((await 快轮到们(内[1])).length).toBe(2);
    // 内[5] 还没被分到：一直在 3 条以内，只有当初那一次
    expect((await 快轮到们(内[5])).length).toBe(1);
  });

  it("数字来回跳不重复推：有人暂停（变近）又恢复（变远），再分一条也不再推", async () => {
    expect(await 自动分一条()).toBe(内[0]);
    expect(await 自动分一条()).toBe(内[1]);
    // 内[0] 前面 4 条（内[2..5]）：没推
    expect((await 快轮到们(内[0])).length).toBe(0);
    // 内[2] 暂停：外贸那条线分一条触发重算，内[0] 前面 3 条 → 推一次
    await setSetting(自动分配不参与key, { [内[2]]: "暂停", [组长]: "禁止", [外组长]: "禁止" });
    await 自动分一条(true);
    expect((await 快轮到们(内[0])).length).toBe(1);
    // 恢复：前面又是 4 条；再分一条给 内[2] → 前面 3 条，还是同一轮，不重复
    await setSetting(自动分配不参与key, { [组长]: "禁止", [外组长]: "禁止" });
    expect(await 自动分一条()).toBe(内[2]);
    expect((await 快轮到们(内[0])).length).toBe(1);
  });

  it("换月清零后重新排：上个月推过的同一轮（总收到条数没变）这个月照样推（去重键带月份，11-18 通知审核）", async () => {
    expect(await 自动分一条()).toBe(内[0]);
    expect((await 快轮到们(内[1])).length).toBe(1);
    // 拨到下个月（北京时间）1 号上午：本月已分全是 0，按开号先后 内[0] 前面 0、内[1] 前面 1……
    const 现在 = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.UTC(现在.getUTCFullYear(), 现在.getUTCMonth() + 1, 1, 2)));
      expect(await 快轮到提醒(await 读组织())).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
    // 内[1] 这一个月里没被分到（总收到 0 条，和上个月推的时候一样），照样又推一次
    expect((await 快轮到们(内[1])).length).toBe(2);
    expect((await 快轮到们(内[0])).length).toBe(1);
  });

  it("暂停的人不推；首页加载（现算）不推，只在分配以后推", async () => {
    await setSetting(自动分配不参与key, { [内[1]]: "暂停", [组长]: "禁止", [外组长]: "禁止" });
    expect(await 自动分一条()).toBe(内[0]);
    expect(await 快轮到们(内[1])).toEqual([]);
    expect((await 快轮到们(内[2])).length).toBe(1);
    await prisma.entNotice.deleteMany({});
    expect(await 我的轮到(await 读组织(), 内[3])).toEqual({ 数: 1 });
    expect(await 快轮到们()).toEqual([]);
  });
});
