/**
 * 客户页看板每列各自取数（11-12 用户：以销售视角看看板，「线索验证」列头写 4 却一张卡都没有——「如果有的话为什么不安排在首页？」→「按建议改，每列各自取数」）。
 *   - 首屏每列各取按当前排序的前 20：30 个的列出 20、4 个的列全出、0 个的列是空态；不取整页共用的那一页
 *   - 列底「再看」（读看板一列 / customers/board-actions.ts 再看一列）取的是这一列第 21–40，不重不漏；默认、创建时间、预计成交、负责人几种排序都对
 *   - 可见范围：销售在任何一列、任何一次「再看」里都看不到同事的项目（直接调动作传同事的节点、大偏移也一样）；列键白名单、偏移 / 条数有上限
 *   - 后筛（收回次数）每列也各取前 20；列表视图（不传 看板）和原来一样
 *   - 三态开着：「再看」那一批卡片也带色点；关着不带
 * 对照：同一组筛选下列表视图一次取全（每页 100）、按列分开的序（列表的序就是服务端排序，tests/ent-project-list-paging.test.ts 钉过）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读项目列表, 读看板一列, 每列条数 } from "@/lib/project/list";
import { 看板分列, 看板落列, 看板列键们, type 项目行 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { 加天 } from "@/lib/enterprise/tri-state";
import { beijingDay } from "@/lib/business-clock";
import { 再看一列 } from "@/app/(app)/customers/board-actions";

type 人 = { id: string; name: string; role: string };
const 人们: Record<string, 人> = {};
const 设身份 = (谁: 人) => { mocks.user = { ...mocks.user, id: 谁.id, name: 谁.name, role: 谁.role }; };
const 作为 = <T,>(谁: 人, fn: () => Promise<T>) => { 设身份(谁); 忘掉企业版范围(); return 以谁的身份(谁.id, fn); };
const 字典 = () => 字典of(true);
const 落 = (r: 项目行) => 看板落列(字典())(r);

/** 看板首屏（客户页模式：每列各自取数、不要列表页） */
const 首屏 = (谁: 人, sp: Record<string, string> = {}) => 作为(谁, () => 读项目列表(谁, sp, undefined, { 每列: true, 要列表页: false }));
/** 对照：列表视图一次取全（≤ 100 条），按列分开 */
async function 对照(谁: 人, sp: Record<string, string> = {}): Promise<Map<string, string[]>> {
  const d = await 作为(谁, () => 读项目列表(谁, { ...sp, pageSize: "100" }));
  expect(d.总数).toBeLessThanOrEqual(100);
  const 分 = new Map<string, string[]>();
  for (const r of d.行) 分.set(落(r), [...(分.get(落(r)) ?? []), r.id]);
  return 分;
}
const 名of = new Map<string, string>();
const 名们 = (ids: string[]) => ids.map((id) => 名of.get(id) ?? id);

beforeAll(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (名: string, role: string, bizRole: string, managerId?: string) => {
    const id = (await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, ...(managerId ? { managerId } : {}) } });
    人们[名] = { id, name: 名, role };
  };
  await 建人("管理员", "ADMIN", "admin");
  await 建人("经理", "SALES", "sales_mgr");
  await 建人("甲", "SALES", "sales", 人们.经理.id);
  await 建人("丙", "SALES", "sales", 人们.经理.id);
  await 建人("乙", "SALES", "sales");
  await setSetting("business", { projectMode: true });
  await setSetting("enterprise.rule.org_scope", true);
  invalidateSettingsCache();

  const 客户们: Record<string, string[]> = { 甲: [], 丙: [], 乙: [] };
  let 号 = 0;
  for (const 谁 of ["甲", "丙", "乙"] as const) {
    for (let k = 0; k < 5; k++) {
      号++;
      客户们[谁].push((await prisma.customer.create({ data: { name: `${谁}的客户${k}`, phone: `1393000${String(号).padStart(4, "0")}`, salesOwnerId: 人们[谁].id } })).id);
    }
  }
  const 基 = Date.now() - 30 * 86400_000;
  let n = 0;
  const 建项目 = async (谁: "甲" | "丙" | "乙" | "公海", phase: string, node: string, 个: number) => {
    for (let i = 0; i < 个; i++) {
      n++;
      // 最近改过、创建时间都有大量同值（同值按主键兜底，翻页不重不漏）；预计成交有空的（总在最后）
      const p = await prisma.project.create({
        data: {
          name: `${谁}-${node}-${i}`, customerId: 客户们[谁 === "公海" ? "乙" : 谁][i % 5], ownerId: 谁 === "公海" ? "" : 人们[谁].id, creatorId: 人们[谁 === "公海" ? "乙" : 谁].id,
          phase, node, amount: n * 10,
          updatedAt: new Date(基 + (n % 7) * 3600_000), createdAt: new Date(基 - ((n * 37) % 11) * 60_000),
          expectedDealAt: n % 5 === 0 ? null : new Date(基 + (n % 9) * 86400_000),
          ...(谁 === "公海" ? { pooledAt: new Date(基) } : {}),
        },
      });
      名of.set(p.id, p.name);
    }
  };
  await 建项目("甲", "线索", "潜客培育", 30);
  await 建项目("甲", "线索", "线索验证", 4);
  await 建项目("丙", "线索", "潜客培育", 12);
  await 建项目("丙", "线索", "线索推进", 2);
  await 建项目("乙", "线索", "潜客培育", 10);
  await 建项目("乙", "线索", "线索验证", 3);
  await 建项目("乙", "商机", "方案敲定", 5);
  await 建项目("公海", "线索", "潜客培育", 25);
  await 建项目("公海", "线索", "线索验证", 3);
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("首屏每列各取前 20", () => {
  it("销售甲：30 个的列出 20（按当前排序的前 20）、4 个的列全出、0 个的列是空的；不取整页共用的那一页", async () => {
    const d = await 首屏(人们.甲);
    expect(d.行).toEqual([]);
    expect(d.页).toBe(1);
    const 列们 = 看板分列(d.行, 字典(), undefined, d.看板合计, d.每列);
    const 列 = (k: string) => 列们.find((c) => c.列 === k)!;
    expect(列("潜客培育").数).toBe(30);
    expect(列("潜客培育").行).toHaveLength(每列条数);
    expect(列("线索验证").数).toBe(4);
    expect(列("线索验证").行).toHaveLength(4);
    expect(列("方案敲定").数).toBe(0);
    expect(列("方案敲定").行).toEqual([]);
    const 照 = await 对照(人们.甲);
    expect(名们(列("潜客培育").行.map((r) => r.id))).toEqual(名们(照.get("潜客培育")!.slice(0, 20)));
    expect(名们(列("线索验证").行.map((r) => r.id))).toEqual(名们(照.get("线索验证")!));
    // 每张卡都是甲自己的
    expect(new Set(列们.flatMap((c) => c.行.map((r) => r.ownerId)))).toEqual(new Set([人们.甲.id]));
  });

  it("要列表页（客户页看板能「分配」时）：列表页那几行和不带看板时一模一样，每列照样给", async () => {
    const 原 = await 作为(人们.经理, () => 读项目列表(人们.经理, { sort: "created-desc" }));
    const 带 = await 作为(人们.经理, () => 读项目列表(人们.经理, { sort: "created-desc" }, undefined, { 每列: true, 要列表页: true }));
    expect(原.每列).toBeUndefined();
    expect(带.行).toEqual(原.行);
    expect(带.总数).toBe(原.总数);
    expect(带.看板合计).toEqual(原.看板合计);
    expect(带.每列!["潜客培育"]).toHaveLength(20);
  });
});

describe("「再看」接着取：第 21–40，不重不漏，几种排序都对", () => {
  for (const sort of ["", "created-asc", "created-desc", "deal-asc", "deal-desc", "owner-asc", "owner-desc"]) {
    it(`经理看「潜客培育」（42 个，甲 30 + 丙 12）sort=${sort || "默认"}：首屏 20 + 再看 20 + 再看 2 = 列表里这一列的序`, async () => {
      const sp: Record<string, string> = sort ? { sort } : {};
      const 照 = (await 对照(人们.经理, sp)).get("潜客培育")!;
      expect(照).toHaveLength(42);
      const d = await 首屏(人们.经理, sp);
      const 首 = d.每列!["潜客培育"].map((r) => r.id);
      const 二 = await 作为(人们.经理, () => 读看板一列(人们.经理, sp, "潜客培育", 20));
      const 三 = await 作为(人们.经理, () => 读看板一列(人们.经理, sp, "潜客培育", 40));
      expect(二!.总).toBe(42);
      expect(二!.行).toHaveLength(20);
      expect(三!.行).toHaveLength(2);
      const 拼 = [...首, ...二!.行.map((r) => r.id), ...三!.行.map((r) => r.id)];
      expect(名们(拼)).toEqual(名们(照));
      expect(new Set(拼).size).toBe(42);
      // 到头了再要：空的
      expect((await 作为(人们.经理, () => 读看板一列(人们.经理, sp, "潜客培育", 42)))!.行).toEqual([]);
      // 小列（线索推进 2 个）首屏全出、序同列表
      expect(名们(d.每列!["线索推进"].map((r) => r.id))).toEqual(名们((await 对照(人们.经理, sp)).get("线索推进")!));
    });
  }

  it("后筛（收回次数）：每列也各取前 20，再看接着取，和列表同一个序", async () => {
    const sp = { pool: "1", recycled: "0" };
    const 照 = await 对照(人们.管理员, sp);
    expect(照.get("潜客培育")).toHaveLength(25);
    const d = await 首屏(人们.管理员, sp);
    expect(d.每列!["潜客培育"].map((r) => r.id)).toEqual(照.get("潜客培育")!.slice(0, 20));
    expect(d.每列!["线索验证"].map((r) => r.id)).toEqual(照.get("线索验证"));
    const 二 = await 作为(人们.管理员, () => 读看板一列(人们.管理员, sp, "潜客培育", 20));
    expect(二!.总).toBe(25);
    expect(二!.行.map((r) => r.id)).toEqual(照.get("潜客培育")!.slice(20));
  });
});

describe("可见范围、参数兜底", () => {
  it("销售甲：首屏、再看都只有自己的；直接要同事才有的列、大偏移、一次 100 个都看不到同事的", async () => {
    const 甲 = 人们.甲;
    const 一列 = (列: string, 偏移: number, 条数?: number) => 作为(甲, () => 读看板一列(甲, {}, 列, 偏移, 条数));
    expect(await 一列("方案敲定", 0)).toEqual({ 行: [], 总: 0 });
    const 全 = await 一列("潜客培育", 0, 100);
    expect(全!.总).toBe(30);
    expect(全!.行).toHaveLength(30);
    expect(new Set(全!.行.map((r) => r.ownerId))).toEqual(new Set([甲.id]));
    expect((await 一列("线索验证", 0, 100))!.行.map((r) => r.ownerId)).toEqual(Array(4).fill(甲.id));
    expect(await 一列("潜客培育", 99_999)).toEqual({ 行: [], 总: 30 });
    // 白名单、上限
    expect(await 一列("不存在的列", 0)).toBeNull();
    expect(await 一列("潜客培育", -1)).toBeNull();
    expect(await 一列("潜客培育", 1.5)).toBeNull();
    expect(await 一列("潜客培育", 100_001)).toBeNull();
    expect(await 一列("潜客培育", 0, 101)).toBeNull();
    expect(await 一列("潜客培育", 0, 0)).toBeNull();
    // 筛了阶段：别的阶段的列不在这一屏，不认
    expect(await 作为(甲, () => 读看板一列(甲, { phase: "商机" }, "潜客培育", 0))).toBeNull();
    expect(看板列键们(字典(), "商机")).not.toContain("潜客培育");
  });

  it("动作 再看一列：带客户页的筛选（地址栏）取；乱传参数拒；按同事的客户筛也只是空的", async () => {
    设身份(人们.甲);
    const 调 = (...a: unknown[]) => 以谁的身份(人们.甲.id, () => (再看一列 as (...x: unknown[]) => ReturnType<typeof 再看一列>)(...a));
    const r = await 调("", "潜客培育", 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.总).toBe(30);
    expect(r.行).toHaveLength(10);
    expect(new Set(r.行.map((x) => x.ownerId))).toEqual(new Set([人们.甲.id]));
    // 客户页「负责人」筛到同事：这一列一个都没有
    const 同事 = await 调(`?salesOwnerId=${人们.乙.id}`, "潜客培育", 0);
    expect(同事).toMatchObject({ ok: true, 行: [], 总: 0 });
    // 客户名搜索：只剩这位客户名下的
    const 搜 = await 调(`?keyword=${encodeURIComponent("甲的客户1")}`, "潜客培育", 0);
    expect(搜.ok && 搜.行.every((x) => x.customerName === "甲的客户1")).toBe(true);
    expect(搜.ok && 搜.总).toBe(6);
    for (const 坏 of [[], [null, "潜客培育", 0], ["", 1, 0], ["", "潜客培育", "20"], ["", "潜客培育", 0, 500], ["", "乱写", 0], ["?batch=b1", "潜客培育", 0]]) {
      expect((await 调(...坏)).ok, JSON.stringify(坏)).toBe(false);
    }
  });
});

describe("三态色点", () => {
  it("开着：「再看」那一批卡片的客户也带色点；关着不带", async () => {
    const 照 = (await 对照(人们.甲)).get("潜客培育")!;
    // 第 21 个之后那批里的一位客户
    const 第25 = await prisma.project.findUniqueOrThrow({ where: { id: 照[24] }, select: { customerId: true } });
    await prisma.entCustomerClock.create({ data: { customerId: 第25.customerId, state: "沉睡", enteredDay: 加天(beijingDay(new Date()), -3) } });
    设身份(人们.甲);
    const 调 = () => 以谁的身份(人们.甲.id, () => 再看一列("", "潜客培育", 20));
    const 关 = await 调();
    expect(关.ok && 关.三态点).toBeUndefined();
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: true } });
    invalidateSettingsCache();
    try {
      const 开 = await 调();
      expect(开.ok && 开.三态点?.[第25.customerId]).toEqual({ 态: "沉睡" });
    } finally {
      await setSetting("orgRules", 默认组织规则);
      invalidateSettingsCache();
    }
  });
});
