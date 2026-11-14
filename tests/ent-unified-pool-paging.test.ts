/**
 * 统一公海不再每翻一页把公海全部的项目名 / 当前进程 / 原负责人 / 客户可见都取一遍（11-10，代码体检 P1）：
 * 这几样只为这一页的行查；筛、数、排的口径不动。
 *   - 对拍：改前的写法原样留在 tests/helpers/unified-pool-old.ts，和现在的 读公海页 对每种身份、每个筛选组合、每一页，整个返回值完全相同
 *     （可见范围、原负责人回避 P-公海-04、排序、总数、按钮上的数、原负责人是我、客户不露时的名字和来源）
 *   - 量：没搜关键词时取回的行数比改前少，翻到哪一页都一样
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "x", email: "x@local", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 现在的公海回避 } from "@/lib/team-scope";
import { 规则 } from "@/lib/enterprise/rules";
import { 市场成员key } from "@/lib/enterprise/market";
import { 无负责人占位邮箱, 自动理由 } from "@/lib/pool";
import { 读公海页, 公海取上限 } from "@/lib/enterprise/unified-pool-db";
import { 内存读公海页, 设内存上限 } from "./helpers/unified-pool-mem";
import { 系统操作人, 快捷们, type 公海筛选 } from "@/lib/enterprise/unified-pool";
import { 旧读公海页 } from "./helpers/unified-pool-old";

type 人 = { id: string; name: string; role: string };

async function 造人(key: string, 业务?: { bizRole: string; line?: string; managerId?: string; dottedManagerId?: string }, 补: { email?: string; active?: boolean } = {}): Promise<人> {
  const u = await raw.user.create({ data: { email: 补.email ?? `${key}@test`, name: key, title: "", role: "SALES", password: "x", active: 补.active ?? true } });
  if (业务) await raw.entMember.create({ data: { userId: u.id, ...业务 } });
  return { id: u.id, name: key, role: "SALES" };
}

let 组: Record<"总管理" | "全看管理员" | "按线管理员" | "销售管理" | "销售" | "同事" | "市场管理" | "没设角色", 人>;
let 占位: 人;
const 来源 = { 甲: "ch-a", 乙: "ch-b" };
const 时刻 = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60_000);
const 取 = <T,>(们: readonly T[], i: number): T => 们[i % 们.length];

/** 客户公海里的客户：各种入池说明、退回次数、无效、来源、跟进时间（有空的、有同一刻的）、负责人（占位 / 还挂着真人的老数据）、名下项目 0～3 个 */
async function 造公海客户(n: number) {
  const 入池 = [
    { userId: null, reason: 自动理由(30) },
    { userId: () => 组.销售.id, reason: "手动" },
    { userId: () => 组.同事.id, reason: "回收原因：客户主动终止" },
    { userId: () => 组.总管理.id, reason: "成员停用，放进公海" },
    { userId: null, reason: "项目超时" },
    { userId: () => 组.销售.id, reason: "名下唯一的项目进了项目公海，客户一起放进公海；回收原因：其他：预算砍了" },
  ];
  // 名下项目的几种摆法：[阶段, 结局, 负责人, 在不在项目公海, 进没进回收站]
  type 摆 = [string, string | null, () => string, boolean?, boolean?];
  const 名下: 摆[][] = [
    [],
    [["线索", null, () => 组.销售.id]],
    [["商机", null, () => 组.同事.id]],
    [["订单", null, () => 组.销售.id], ["线索", null, () => 组.同事.id]],
    [["线索", "线索流失", () => 组.销售.id], ["商机", "丢单", () => 组.同事.id]],
    [["线索", null, () => 组.同事.id, true], ["商机", null, () => 组.销售.id, true]],
    [["线索", null, () => 组.销售.id], ["线索", null, () => 组.销售.id], ["商机", "异常状态", () => 组.同事.id]],
    [["订单", "成功交付", () => 组.同事.id]],
    [["商机", null, () => 组.销售.id, false, true]],
    [["线索", null, () => 组.销售.id], ["订单", null, () => 组.同事.id, false, true]],
  ];
  // 全看管理员也当过负责人：管理员不回避，自己放走的照样看得到、按钮灰着
  const 原负责人 = [() => 组.销售.id, () => 组.同事.id, () => 组.销售管理.id, () => 组.全看管理员.id];
  for (let i = 0; i < n; i++) {
    const 原 = 取(原负责人, i)();
    // 三种挂法：清了负责人挂占位（M-公海-03，原负责人在历史记录里）、还挂着原负责人的老数据、挂占位但历史上最近一次不是他
    const 挂 = i % 3;
    const id = `c${String(i).padStart(3, "0")}`;
    await raw.customer.create({
      data: {
        id,
        // 大小写混着，关键词不分大小写；每 7 位里一位名字带「alpha」
        name: i % 7 === 0 ? `Alpha 客户${i}` : `客户${i}`,
        phone: `13${String(i).padStart(9, "0")}`,
        salesOwnerId: 挂 === 1 ? 原 : 占位.id,
        channelId: i % 4 === 0 ? 来源.甲 : i % 4 === 1 ? 来源.乙 : null,
        // 同一刻的成对出现：排序靠 id 定序
        lastFollowAt: i % 5 === 0 ? null : 时刻(1000 + Math.floor(i / 2)),
        createdAt: 时刻(Math.floor((i * 37) % 50)),
        poolInvalidAt: i % 11 === 0 ? 时刻(5000) : null,
        poolReturns: Math.floor(i / 6) % 6,
        deletedAt: i % 23 === 22 ? 时刻(9000) : null,
      },
    });
    const p = 取(入池, i);
    await raw.customerPool.create({ data: { customerId: id, userId: typeof p.userId === "function" ? p.userId() : null, reason: p.reason, at: 时刻(2000 + Math.floor(i / 3)) } });
    if (挂 !== 1) {
      await raw.customerOwnerLog.create({ data: { customerId: id, fromOwnerId: 原, toOwnerId: 占位.id, userId: 原, kind: "pool-release", at: 时刻(100 + i) } });
      // 后来被别人领走又放回来：最近一次的原负责人是那个人
      if (挂 === 2 && i % 2 === 0) await raw.customerOwnerLog.create({ data: { customerId: id, fromOwnerId: 组.同事.id, toOwnerId: 占位.id, userId: 组.同事.id, kind: "pool-release", at: 时刻(500 + i) } });
    }
    for (const [j, [phase, result, owner, 在公海, 已删]] of 取(名下, i).entries()) {
      await raw.project.create({
        data: {
          id: `${id}-p${j}`, name: j === 1 ? `ALPHA 项目${i}-${j}` : `项目${i}-${j}`, customerId: id, ownerId: owner(), creatorId: owner(),
          phase, node: phase === "线索" ? "线索验证" : phase === "商机" ? "明确需求" : "签订合同", result,
          pooledAt: 在公海 ? 时刻(1500 + i) : null, deletedAt: 已删 ? 时刻(9000) : null,
          // 后建的排前面的也有：名下顺序认创建时间，不认 id
          createdAt: 时刻(300 - j * 10 + (i % 2 ? j * 25 : 0)),
        },
      });
    }
  }
}

/** 项目公海里、客户不在客户公海的项目：客户归不同的人（有的身份看不到客户）、各种放回留痕、来源有的在项目上有的跟客户 */
async function 造公海项目(n: number) {
  const 客户归 = [() => 组.销售.id, () => 组.同事.id, () => 组.销售管理.id, () => 组.市场管理.id];
  const 原负责人 = [() => 组.销售.id, () => 组.同事.id, () => 组.销售管理.id, () => 组.全看管理员.id];
  const 阶段 = [["线索", null], ["商机", null], ["订单", null], ["线索", "线索流失"], ["商机", "丢单"]] as const;
  for (let i = 0; i < n; i++) {
    const cid = `xc${String(i).padStart(3, "0")}`;
    const pid = `xp${String(i).padStart(3, "0")}`;
    const 原 = 取(原负责人, i)();
    await raw.customer.create({
      data: {
        id: cid, name: i % 5 === 0 ? `alpha 老客户${i}` : `老客户${i}`, phone: `15${String(i).padStart(9, "0")}`, salesOwnerId: 取(客户归, i)(),
        channelId: i % 3 === 0 ? 来源.甲 : i % 3 === 1 ? 来源.乙 : null,
        lastFollowAt: i % 4 === 0 ? null : 时刻(1000 + Math.floor(i / 2)), poolReturns: Math.floor(i / 5) % 5,
      },
    });
    const [phase, result] = 取(阶段, i);
    await raw.project.create({
      data: {
        id: pid, name: i % 6 === 0 ? `公海项目 Alpha${i}` : `公海项目${i}`, customerId: cid,
        // 11-01 C-01 起进公海清负责人（只在留痕里）；老数据还留着
        ownerId: i % 4 === 3 ? 原 : "", creatorId: 原, phase, node: phase === "线索" ? "线索验证" : "明确需求", result,
        pooledAt: 时刻(2000 + Math.floor(i / 3)), createdAt: 时刻(Math.floor((i * 29) % 40)),
        channelId: i % 2 === 0 ? null : i % 4 === 1 ? 来源.甲 : 来源.乙,
        deletedAt: i % 17 === 16 ? 时刻(9000) : null,
      },
    });
    // 留痕：没有的（老数据）、本人放的带回收原因、系统收的、离职放回的、先本人后系统两条（认最近一条）
    const 痕 = (userId: string, reason: string | null, at: Date, from = 原) =>
      raw.projectNodeLog.create({ data: { projectId: pid, kind: "pool-release", fromOwnerId: from, userId, reason, toPhase: phase, toNode: "x", at } });
    const 哪 = i % 5;
    if (哪 === 1) await 痕(原, "回收原因：客户没需求", 时刻(1900 + i));
    if (哪 === 2) await 痕(系统操作人, null, 时刻(1900 + i));
    if (哪 === 3) await 痕(组.总管理.id, "成员停用，放回项目公海", 时刻(1900 + i));
    if (哪 === 4) {
      await 痕(组.同事.id, "回收原因：其他", 时刻(1800 + i), 组.同事.id);
      await 痕(系统操作人, null, 时刻(1900 + i));
    }
  }
  // 再来一个客户也在客户公海的公海项目（算在客户行里，不单列）已经在 造公海客户 里有了
}

const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 新 = (u: 人, sp: 公海筛选, page: number, pageSize: number) => { 当(u); return 以谁的身份(u.id, () => 读公海页(u, sp, page, pageSize)); };
const 旧 = (u: 人, sp: 公海筛选, page: number, pageSize: number) => { 当(u); return 以谁的身份(u.id, () => 旧读公海页(u, sp, page, pageSize)); };

/** 这段取回了多少行（含带出来的关联行）、查了几次库 */
async function 量<T>(fn: () => Promise<T>): Promise<{ 值: T; 次: number; 行: number }> {
  // 一行算一行；带出来的关联（列表里的每一行、单个的那一行）也各算一行。带 $type 的是引擎回的日期这类值，不是行
  const 数行 = (x: unknown): number => {
    if (Array.isArray(x)) return x.reduce((s: number, y) => s + 1 + 带出来的(y), 0);
    return 带出来的(x);
  };
  const 带出来的 = (o: unknown): number => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return 0;
    let n = 0;
    for (const v of Object.values(o)) if (v && typeof v === "object" && !("$type" in v)) n += Array.isArray(v) ? 数行(v) : 1 + 带出来的(v);
    return n;
  };
  const 引擎 = (raw as unknown as { _engine: { request: (...a: unknown[]) => Promise<{ data?: unknown }> } })._engine;
  const 原 = 引擎.request;
  let 次 = 0, 行 = 0;
  引擎.request = async function (this: unknown, ...a: unknown[]) {
    次++;
    const r = await 原.apply(this, a);
    行 += 数行(r?.data);
    return r;
  };
  try {
    return { 值: await fn(), 次, 行 };
  } finally {
    引擎.request = 原;
  }
}

const 客户几位 = 46;
const 项目几个 = 34;

beforeAll(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  vi.stubEnv("CRM_READ_POOL", "0");
  await resetDb();
  invalidateSettingsCache();
  await prisma.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  const 总管理 = await 造人("director", { bizRole: "director" });
  const 全看管理员 = await 造人("admin", { bizRole: "admin" });
  const 按线管理员 = await 造人("admin-line", { bizRole: "admin", line: "内贸" });
  const 销售管理 = await 造人("mgr", { bizRole: "sales_mgr" });
  const 销售 = await 造人("sales", { bizRole: "sales", managerId: 销售管理.id });
  const 同事 = await 造人("peer", { bizRole: "sales", line: "外贸" });
  const 市场管理 = await 造人("market", { bizRole: "marketing_mgr" });
  const 没设角色 = await 造人("none");
  await prisma.setting.create({ data: { key: 市场成员key, value: JSON.stringify([市场管理.id]) } });
  组 = { 总管理, 全看管理员, 按线管理员, 销售管理, 销售, 同事, 市场管理, 没设角色 };
  // 占位账号：进公海清负责人后客户挂在它名下（M-公海-03）
  占位 = await 造人("placeholder", undefined, { email: 无负责人占位邮箱, active: false });
  await raw.channel.createMany({ data: [{ id: 来源.甲, name: "来源甲|其他", channelOwnerId: 总管理.id }, { id: 来源.乙, name: "来源乙|其他", channelOwnerId: 总管理.id }] });
  await 造公海客户(客户几位);
  await 造公海项目(项目几个);
  忘掉企业版范围();
}, 120_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
  await prisma.$disconnect();
});

const 属性们 = [undefined, "线索池", "商机池", "订单池", "客户池", "其他", "公海线索"];
const 快捷选 = [undefined, ...快捷们];
const 排序选 = [undefined, "follow", "created"];
const 词们 = [undefined, "alpha", "项目1", "  "];
const 来源们 = [undefined, 来源.甲];

describe("统一公海：和改前的写法对拍", () => {
  it("造的数据各种情况都有：两种行、每种入池方式、四个池、回避、客户不露", async () => {
    const 全 = await 旧(组.总管理, {}, 1, 1000);
    expect(全.行.filter((r) => r.种 === "客户").length).toBe(客户几位 - 2); // 两位进了回收站
    expect(全.行.filter((r) => r.种 === "项目").length).toBe(项目几个 - 2);
    for (const k of 快捷们) expect([k, 全.快捷数[k] > 0]).toEqual([k, true]);
    expect(全.行.some((r) => r.类 === "离职交接")).toBe(true);
    for (const a of ["线索池", "商机池", "订单池", "客户池"] as const) expect([a, 全.属性数[a] > 0]).toEqual([a, true]);
    expect(全.行.some((r) => r.进程明细)).toBe(true);
    // 销售：自己放进公海的客户（P-公海-04）、自己是历史负责人的公海项目都看不到；别人客户上的项目不露客户名；自己还挂着的老数据按钮灰
    const 销售看 = await 旧(组.销售, {}, 1, 1000);
    expect(销售看.总数).toBeLessThan(全.总数);
    expect(销售看.行.filter((r) => r.种 === "客户").length).toBeLessThan(客户几位 - 2);
    expect(销售看.行.filter((r) => r.种 === "项目").length).toBeLessThan(项目几个 - 2);
    expect(销售看.行.some((r) => r.种 === "项目" && r.客户名 === null)).toBe(true);
    expect(销售看.行.some((r) => r.种 === "项目" && r.客户名 !== null)).toBe(true);
    expect(销售看.行.some((r) => r.种 === "客户" && r.项目名 === null) && 销售看.行.some((r) => r.种 === "客户" && r.项目名 !== null)).toBe(true);
    // 管理员不回避，原负责人是我 照样要认出来（挂占位的认历史记录、老数据认负责人）
    const 管理看 = await 旧(组.全看管理员, {}, 1, 1000);
    expect(管理看.总数).toBe(全.总数);
    const 灰 = 管理看.行.filter((r) => r.种 === "客户" && r.原负责人是我).map((r) => r.customerId);
    const 挂占位的 = new Set((await raw.customer.findMany({ where: { salesOwnerId: 占位.id }, select: { id: true } })).map((c) => c.id));
    expect(灰.some((id) => 挂占位的.has(id)) && 灰.some((id) => !挂占位的.has(id))).toBe(true);
    expect(管理看.行.filter((r) => r.种 === "客户" && !r.原负责人是我).length).toBeGreaterThan(灰.length);
    expect(管理看.行.filter((r) => r.种 === "项目" && r.原负责人是我).length).toBeGreaterThan(0);
    // 销售管理不是管理员，一样回避自己放走的
    expect((await 旧(组.销售管理, {}, 1, 1000)).总数).toBeLessThan(全.总数);
  });

  /** 一种身份、一批筛选组合，新旧逐页比。每页都比 = true 时外加第 0 页（当第 1 页）和越界的一页（当最后一页），false 时只比头尾两页 */
  async function 对拍(u: 人, 组合: 公海筛选[], 页大小: number, 每页都比: boolean) {
    let 比了 = 0, 有行的 = 0;
    for (const sp of 组合) {
      const 一 = await 旧(u, sp, 1, 页大小);
      const 页数 = Math.max(1, Math.ceil(一.总数 / 页大小));
      const 页们 = 每页都比 ? [0, ...Array.from({ length: 页数 + 1 }, (_, i) => i + 1)] : [1, 页数];
      for (const page of new Set(页们)) {
        const 应 = page === 1 ? 一 : await 旧(u, sp, page, 页大小);
        expect(await 新(u, sp, page, 页大小), `${u.name} ${JSON.stringify(sp)} 第 ${page} 页`).toEqual(应);
        比了++;
        if (应.行.length) 有行的++;
      }
    }
    return { 比了, 有行的 };
  }
  const 全部组合: 公海筛选[] = [];
  for (const 属性 of 属性们) for (const 快捷 of 快捷选) for (const 排序 of 排序选) for (const keyword of 词们) for (const 来源 of 来源们) 全部组合.push({ 属性, 快捷, 排序, keyword, 来源 });
  // 关键词、来源决定哪几样只查这一页（全取）；属性、入池方式、排序只决定哪些行落在这一页
  const 要紧组合 = 全部组合.filter((sp) => [undefined, "线索池"].includes(sp.属性) && [undefined, "超时回收"].includes(sp.快捷) && sp.排序 !== "created");

  // 条件最多的身份（受限、还要回避自己放走的销售）：每个筛选组合都比
  it(`销售：${全部组合.length} 个筛选组合，头尾两页都和改前一样`, async () => {
    const r = await 对拍(组.销售, 全部组合, 9, false);
    expect(r.比了).toBeGreaterThan(全部组合.length);
    expect(r.有行的).toBeGreaterThan(300);
  }, 120_000);
  // 每种身份：关键词 × 来源 × 排序 × 几种属性和入池方式，每一页都比
  for (const 名 of ["总管理", "全看管理员", "按线管理员", "销售管理", "销售", "同事", "市场管理", "没设角色"] as const) {
    it(`${名}：${要紧组合.length} 个筛选组合，每一页都和改前一样`, async () => {
      const r = await 对拍(组[名], 要紧组合, 20, true);
      expect(r.比了).toBeGreaterThan(要紧组合.length * 2);
      expect(r.有行的).toBeGreaterThan(40);
    }, 120_000);
  }

  it("不筛时每一页逐页对（页大小 7、100，一页装得下全部的也对）", async () => {
    for (const u of [组.全看管理员, 组.销售, 组.市场管理]) {
      for (const 页大小 of [7, 100, 1000]) {
        for (const 排序 of 排序选) {
          const 页数 = Math.ceil((await 旧(u, { 排序 }, 1, 页大小)).总数 / 页大小);
          for (let page = 1; page <= 页数 + 1; page++) {
            expect(await 新(u, { 排序 }, page, 页大小), `${u.name} ${排序} ${页大小} 第 ${page} 页`).toEqual(await 旧(u, { 排序 }, page, 页大小));
          }
        }
      }
    }
  }, 120_000);
});

describe("统一公海：每翻一页少取多少", () => {
  it("没搜关键词：取回的行数比改前少，翻到哪页都一样；查库次数最多比改前多五句", async () => {
    for (const u of [组.全看管理员, 组.销售]) {
      await 新(u, {}, 1, 20); // 热一下：范围、组织、设置缓存
      await 旧(u, {}, 1, 20);
      const 旧量 = await 量(() => 旧(u, {}, 1, 20));
      const 新量 = await 量(() => 新(u, {}, 1, 20));
      const 新量后页 = await 量(() => 新(u, {}, 3, 20));
      expect(新量.值).toEqual(旧量.值);
      // 第四轮（11-14）分组数拆开数：按快捷 + 非线索两句、回避的人再多一句排掉的，多回来的是几组数（最多 3 属性 × 7 快捷 × 3 种号码不全，不随公海大小涨）；
      // 这里公海只有几十位，改前取回的全部行也才两三百，所以给分组行留一截；不随公海涨由下面 2000 位那组钉着
      expect(新量.行).toBeLessThan(旧量.行 + 40);
      // 进公海那一行改成单独一句取，多这一句（换掉的是关联加载那句大 IN，引擎里不算次数）；
      // 11-14 客户行改在库里筛、数、分页：多分组数、取这一段、取这一页客户三句，要回避的人再多圈回避客户两句（都是按页、按人的小句），
      // 换掉的是把公海全部客户行取回内存（取回的行数不随公海大小涨，见下面 2000 位那组）；
      // 第四轮（11-14）分组数拆成按快捷、非线索两句（全部那份人人共用一个缓存键），回避的人再多减排掉的一句：再多两句（测试里缓存关着，句句现数）
      expect(新量.次).toBeLessThanOrEqual(旧量.次 + 7);
      expect(新量后页.次).toBe(新量.次);
    }
  });
});

/**
 * 8.5 万客户（11-14）：客户行改成在库里筛、数、分页，不再只取最近入池的 公海取上限（2000）位。
 * 缺陷（先写的这条）：公海超过 2000 位时，更早入池的搜不到、翻不到，各池数量、快捷数、总数也只数那 2000 位。
 * 对拍对象是改前的内存写法去掉上限（helpers/unified-pool-mem.ts 内存读公海页）：逐个身份、逐个筛选、逐页整个返回值一样；
 * 同一个写法把上限设回 2000（设内存上限）就是改前的样子，用来钉「改前确实错」
 */
describe("统一公海：公海过 2000 位，更早入池的照样搜得到、数得全", () => {
  const 内存 = (u: 人, sp: 公海筛选, page: number, pageSize: number, 选?: { 数号码不全?: boolean }) => { 当(u); return 以谁的身份(u.id, () => 内存读公海页(u, sp, page, pageSize, undefined, 选)); };
  const 新带 = (u: 人, sp: 公海筛选, page: number, pageSize: number, 选?: { 数号码不全?: boolean }) => { 当(u); return 以谁的身份(u.id, () => 读公海页(u, sp, page, pageSize, undefined, 选)); };

  beforeAll(async () => {
    // 再放 公海取上限 位进客户公海，入池时间全是同一刻（同刻的按客户 id 定序）、比前面那些都早；号码不全的隔三位一位
    const 批 = Array.from({ length: 公海取上限 }, (_, i) => ({ id: `t${String(i).padStart(4, "0")}`, name: `同刻客户${i}`, phone: `17${String(i).padStart(9, "0")}`, salesOwnerId: 占位.id, channelId: i % 5 === 0 ? 来源.甲 : null, createdAt: 时刻(i % 40) }));
    await raw.customer.createMany({ data: 批 });
    // 进公海那一行倒着建：同一刻的谁先谁后不能靠插入顺序
    await raw.customerPool.createMany({ data: 批.map((c, i) => ({ customerId: c.id, userId: i % 2 ? 组.同事.id : null, reason: i % 2 ? "回收原因：同刻" : "项目超时", at: 时刻(10), phoneIncomplete: i % 3 === 0 })).reverse() });
    // 最早入池的那一位：全公海排最后
    await raw.customer.create({ data: { id: "t-earliest", name: "最早入池的客户", phone: "16600000000", salesOwnerId: 占位.id } });
    await raw.customerPool.create({ data: { customerId: "t-earliest", reason: "手动", userId: 组.同事.id, at: 时刻(-100000) } });
    忘掉企业版范围();
  }, 120_000);
  afterAll(() => 设内存上限(Number.POSITIVE_INFINITY));

  it("缺陷：搜最早入池的那位，改前（只取最近 2000 位）搜不到，现在搜得到；总数、各池数、快捷数数全了", async () => {
    const 公海客户数 = await raw.customer.count({ where: { deletedAt: null, pool: { isNot: null } } });
    expect(公海客户数).toBeGreaterThan(公海取上限);
    for (const u of [组.总管理, 组.销售]) {
      设内存上限(公海取上限);
      const 改前 = await 内存(u, { keyword: "最早入池" }, 1, 20);
      const 改前全 = await 内存(u, {}, 1, 20);
      设内存上限(Number.POSITIVE_INFINITY);
      expect(改前.总数).toBe(0);
      expect(改前全.截断).toBe(true);
      const 现在 = await 新(u, { keyword: "最早入池" }, 1, 20);
      expect(现在.总数, u.name).toBe(1);
      expect(现在.行.map((r) => r.customerId)).toEqual(["t-earliest"]);
      // 按入池时间排，最早的在最后一页最后一行
      const 全 = await 新(u, {}, 1, 20);
      expect(全.截断).toBe(false);
      expect(全.总数).toBeGreaterThan(改前全.总数);
      const 末页 = await 新(u, {}, Math.ceil(全.总数 / 20), 20);
      expect(末页.行.at(-1)?.customerId).toBe("t-earliest");
      // 快捷数、各池数不再只数 2000 位
      expect(全.属性数.线索池).toBeGreaterThan(改前全.属性数.线索池);
      expect(全.快捷数.超时回收).toBeGreaterThan(改前全.快捷数.超时回收);
    }
  }, 120_000);

  it("取回的行数不随公海大小涨：公海 2000 多位时翻一页取回的行和 46 位时一个量级，改前（去掉上限）要取回全部", async () => {
    for (const u of [组.总管理, 组.销售]) {
      await 新(u, {}, 1, 20);
      const 现在 = await 量(() => 新(u, {}, 1, 20));
      const 改前 = await 量(() => 内存(u, {}, 1, 20));
      expect(现在.值).toEqual(改前.值);
      expect(现在.行, u.name).toBeLessThan(500);
      expect(改前.行, u.name).toBeGreaterThan(公海取上限);
    }
  }, 120_000);

  it("和改前的内存写法（去掉上限）逐个身份、逐个筛选、逐页整个返回值一样，含号码不全数", async () => {
    const 组合: 公海筛选[] = [{}, { 快捷: "超时回收" }, { 快捷: "离职交接" }, { keyword: "同刻客户1" }, { keyword: "alpha" }, { 排序: "created", 来源: 来源.甲 }, { 排序: "follow" }, { 属性: "线索池" }, { 属性: "商机池", 排序: "follow" }, { 号码不全: "1" }];
    let 比了 = 0;
    for (const u of [组.总管理, 组.销售, 组.市场管理, 组.没设角色]) {
      for (const sp of 组合) {
        for (const page of [1, 3, 9999]) {
          expect(await 新(u, sp, page, 50), `${u.name} ${JSON.stringify(sp)} 第 ${page} 页`).toEqual(await 内存(u, sp, page, 50));
          比了++;
        }
        expect(await 新带(u, sp, 2, 50, { 数号码不全: true }), `${u.name} ${JSON.stringify(sp)} 数号码不全`).toEqual(await 内存(u, sp, 2, 50, { 数号码不全: true }));
      }
    }
    expect(比了).toBe(4 * 组合.length * 3);
  }, 300_000);
});

/**
 * 原负责人回避名单过上限（visibility.ts 回避名单上限 100，现在的公海回避 的 客户 = null）：限定层退回按关联写的条件，
 * 库里分页这边的「回避掉的公海客户」也走名单过上限那一支（按留痕圈）。造一个放走过 100 多位公海客户的人，
 * 和改前的内存写法（去掉上限）逐个筛选、逐页整个返回值一样；放走的确实看不到、别人照样看得到
 */
describe("统一公海：回避名单过上限（null）", () => {
  const 内存 = (u: 人, sp: 公海筛选, page: number, pageSize: number) => { 当(u); return 以谁的身份(u.id, () => 内存读公海页(u, sp, page, pageSize)); };
  let 退得多: 人;
  const 放走的: string[] = [];

  beforeAll(async () => {
    退得多 = await 造人("many-release", { bizRole: "sales" });
    // 130 位：进公海清了负责人挂占位、留痕认他（客户级）；隔五位挂一个他退的项目（项目级也过上限）；隔七位后来被同事领走又放回（只认最近一次，他看得到）
    for (let i = 0; i < 130; i++) {
      const id = `r${String(i).padStart(3, "0")}`;
      await raw.customer.create({ data: { id, name: i % 9 === 0 ? `Alpha 放走的${i}` : `放走的${i}`, phone: `18${String(i).padStart(9, "0")}`, salesOwnerId: 占位.id, channelId: i % 4 === 0 ? 来源.甲 : null, lastFollowAt: i % 3 ? 时刻(3000 + i) : null, createdAt: 时刻(i % 30) } });
      await raw.customerPool.create({ data: { customerId: id, userId: i % 2 ? 退得多.id : null, reason: i % 2 ? "手动" : 自动理由(30), at: 时刻(20 + (i % 13)) } });
      await raw.customerOwnerLog.create({ data: { customerId: id, fromOwnerId: 退得多.id, toOwnerId: 占位.id, userId: 退得多.id, kind: "pool-release", at: 时刻(200 + i) } });
      if (i % 7 === 0) await raw.customerOwnerLog.create({ data: { customerId: id, fromOwnerId: 组.同事.id, toOwnerId: 占位.id, userId: 组.同事.id, kind: "pool-release", at: 时刻(900 + i) } });
      else 放走的.push(id);
      if (i % 5 === 0) {
        const pid = `${id}-p0`;
        await raw.project.create({ data: { id: pid, name: `放走的项目${i}`, customerId: id, ownerId: "", creatorId: 退得多.id, phase: "线索", node: "线索验证", pooledAt: 时刻(1500 + i), createdAt: 时刻(i % 20) } });
        await raw.projectNodeLog.create({ data: { projectId: pid, kind: "pool-release", fromOwnerId: 退得多.id, userId: 退得多.id, toPhase: "线索", toNode: "x", at: 时刻(1500 + i) } });
      }
    }
    忘掉企业版范围();
  }, 120_000);

  it("名单确实过上限（客户 = null），放走的看不到、后来别人放回的看得到、同事都看得到", async () => {
    当(退得多);
    const 避 = await 以谁的身份(退得多.id, () => 现在的公海回避(raw));
    expect(避?.客户).toBeNull();
    const 他看 = new Set((await 新(退得多, {}, 1, 5000)).行.map((r) => r.customerId));
    expect(放走的.filter((id) => 他看.has(id))).toEqual([]);
    expect(他看.has("r007")).toBe(true); // 同事后来放回的，最近一次不是他（r000 挂着他退的项目，照样回避）
    const 同事看 = new Set((await 新(组.同事, {}, 1, 5000)).行.map((r) => r.customerId));
    expect(放走的.every((id) => 同事看.has(id))).toBe(true);
  }, 120_000);

  it("和改前的内存写法（去掉上限）逐个筛选、逐页整个返回值一样", async () => {
    const 组合: 公海筛选[] = [{}, { keyword: "放走的" }, { keyword: "alpha" }, { 快捷: "超时回收" }, { 属性: "线索池" }, { 排序: "follow" }, { 排序: "created", 来源: 来源.甲 }];
    let 比了 = 0;
    for (const sp of 组合) {
      for (const page of [1, 2, 9999]) {
        expect(await 新(退得多, sp, page, 50), `${JSON.stringify(sp)} 第 ${page} 页`).toEqual(await 内存(退得多, sp, page, 50));
        比了++;
      }
    }
    expect(比了).toBe(组合.length * 3);
  }, 300_000);
});
