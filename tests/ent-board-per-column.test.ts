/**
 * 看板每列各自取数（11-12 用户：以销售视角看看板，「线索验证」列头写 4 却一张卡都没有——「如果有的话为什么不安排在首页？」→「按建议改，每列各自取数」）。
 *   - 首屏每列各取前 20：30 个的列出 20、4 个的列全出、0 个的列是空态；客户页看板不取整页共用的那一页
 *   - 列里恒按最近改过在前（同改动前的看板，审查 Q3）：地址栏的 sort 只管列表，首屏、「再看」都不跟
 *   - 「再看」（读看板一列）取的是这一列第 21–40，不重不漏；读看板一列 仍认各种排序（给临时列表 / 以后），七种排序和列表同序
 *   - 可见范围：销售在任何一列、任何一次「再看」里都看不到同事的项目；市场成员「我分出去的」只看到自己分出去的；列键白名单、偏移 / 条数有上限
 *   - 后筛（收回次数）每列也各取前 20、「再看」与首屏同一圈；/projects 和市场「我分出去的」看板（审查 A）每列各取、列表那一页照旧
 *   - 查询数：按负责人排的一段最多 3 句、不随人数涨（审查 Q1）；最近留痕一句 groupBy、不把留痕整批取回（审查 Q2）
 *   - 三态开着：「再看」那一批卡片也带色点；关着不带
 * 对照：同一组筛选下列表视图一次取全（每页 100）、按列分开的序（列表的序就是服务端排序，tests/ent-project-list-paging.test.ts 钉过）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/app/(app)/projects/ProjectsView", () => ({ default: () => null }));
// 数 SQL（同 tests/ent-customer-list-queries.test.ts）：生成的 PrismaClient 换成带 query 事件的子类
const 记 = vi.hoisted(() => ({ 开: false, 句: [] as string[], 滤: null as null | ((a: { include?: unknown }, r: { id: string }[]) => unknown) }));
vi.mock("@/generated/prisma", async (原) => {
  const m = await 原<typeof import("@/generated/prisma")>();
  class 记数Client extends m.PrismaClient {
    constructor(o: ConstructorParameters<typeof m.PrismaClient>[0] = {}) {
      super({ ...o, log: [{ emit: "event", level: "query" }, ...((o?.log as never[]) ?? [])] } as never);
      (this as unknown as { $on: (e: string, f: (x: { query: string }) => void) => void }).$on("query", (e) => { if (记.开) 记.句.push(e.query); });
      // 记.滤：测「两句之间项目离开了范围」时改写 project.findMany 的返回
      return (this as unknown as { $extends: (x: unknown) => 记数Client }).$extends({
        query: { project: { async findMany({ args, query }: { args: { include?: unknown }; query: (a: unknown) => Promise<{ id: string }[]> }) { const r = await query(args); return 记.滤 ? 记.滤(args, r) : r; } } },
      });
    }
  }
  return { ...m, PrismaClient: 记数Client };
});
async function 数句<T>(fn: () => Promise<T>): Promise<{ 句: string[]; r: T }> {
  记.句 = []; 记.开 = true;
  try { const r = await fn(); return { 句: 记.句, r }; } finally { 记.开 = false; }
}
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
import { 再看项目页一列 } from "@/app/(app)/projects/board-actions";
import { 项目页 } from "@/app/(app)/projects/board-page";
import { 市场成员key } from "@/lib/enterprise/market";
import type { SessionUser } from "@/lib/auth";

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
  await 建人("市场甲", "SALES", "channel_ops");
  await 建人("市场乙", "SALES", "channel_ops");
  await setSetting("business", { projectMode: true });
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting(市场成员key, [人们.市场甲.id, 人们.市场乙.id]);
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
  const 建项目 = async (谁: "甲" | "丙" | "乙" | "公海", phase: string, node: string, 个: number, 建的人?: string) => {
    for (let i = 0; i < 个; i++) {
      n++;
      // 最近改过、创建时间都有大量同值（同值按主键兜底，翻页不重不漏）；预计成交有空的（总在最后）
      const p = await prisma.project.create({
        data: {
          name: `${谁}-${node}-${i}`, customerId: 客户们[谁 === "公海" ? "乙" : 谁][i % 5], ownerId: 谁 === "公海" ? "" : 人们[谁].id, creatorId: 建的人 ?? 人们[谁 === "公海" ? "乙" : 谁].id,
          phase, node, amount: n * 10,
          updatedAt: new Date(基 + (n % 7) * 3600_000), createdAt: new Date(基 - ((n * 37) % 11) * 60_000),
          expectedDealAt: n % 5 === 0 ? null : new Date(基 + (n % 9) * 86400_000),
          ...(谁 === "公海" ? { pooledAt: new Date(基) } : {}),
        },
      });
      名of.set(p.id, p.name);
      // 收回过一次（放回公海留痕）：公海里潜客培育前 22 个、线索验证前 2 个
      if (谁 === "公海" && i < (node === "潜客培育" ? 22 : 2)) {
        await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 人们.乙.id, kind: "pool-release", toPhase: phase, toNode: node, fromOwnerId: 人们.乙.id, at: new Date(基 - 86400_000) } });
      }
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
  // 市场甲建了分给乙的（我分出去的）：痛点挖掘 25 个（大列）、合同审批 3 个（小列）；市场乙建了分给乙的：痛点挖掘 4 个（市场甲看不到）
  await 建项目("乙", "商机", "痛点挖掘", 25, 人们.市场甲.id);
  await 建项目("乙", "商机", "合同审批", 3, 人们.市场甲.id);
  await 建项目("乙", "商机", "痛点挖掘", 4, 人们.市场乙.id);
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("首屏每列各取前 20", () => {
  it("销售甲（客户页看板）：30 个的列出 20（最近改过的前 20）、4 个的列全出、0 个的列是空的；不取整页共用的那一页", async () => {
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

describe("列里恒按最近改过在前（审查 Q3）；「再看」接着取第 21–40，不重不漏", () => {
  for (const sort of ["", "created-asc", "created-desc", "deal-asc", "deal-desc", "owner-asc", "owner-desc"]) {
    it(`经理（甲 30 + 丙 12）地址栏 sort=${sort || "默认"}：首屏 + 动作「再看」两次 = 默认序下这一列的全部；列表那一页照 sort 排`, async () => {
      const 默认 = (await 对照(人们.经理)).get("潜客培育")!;
      expect(默认).toHaveLength(42);
      const sp: Record<string, string> = sort ? { sort } : {};
      // /projects 那种：两份都取，列表那一页跟 sort、看板列不跟
      const d = await 作为(人们.经理, () => 读项目列表(人们.经理, sp, undefined, { 每列: true, 要列表页: true }));
      const 列表 = await 作为(人们.经理, () => 读项目列表(人们.经理, sp));
      expect(d.行.map((r) => r.id)).toEqual(列表.行.map((r) => r.id));
      const 首 = d.每列!["潜客培育"].map((r) => r.id);
      设身份(人们.经理);
      const 再看 = (偏移: number) => 以谁的身份(人们.经理.id, () => 再看项目页一列(sort ? `?sort=${sort}` : "", "潜客培育", 偏移));
      const 二 = await 再看(20), 三 = await 再看(40);
      expect(二.ok && 三.ok).toBe(true);
      if (!二.ok || !三.ok) return;
      expect(二.总).toBe(42);
      const 拼 = [...首, ...二.行.map((r) => r.id), ...三.行.map((r) => r.id)];
      expect(名们(拼)).toEqual(名们(默认));
      expect(new Set(拼).size).toBe(42);
      // 客户页看板的动作同样不跟 sort
      const 客 = await 以谁的身份(人们.经理.id, () => 再看一列(sort ? `?sort=${sort}` : "", "潜客培育", 20));
      expect(客.ok && 名们(客.行.map((r) => r.id))).toEqual(名们(默认.slice(20, 40)));
    });
  }

  for (const sort of ["created-asc", "created-desc", "deal-asc", "deal-desc", "owner-asc", "owner-desc"]) {
    it(`读看板一列 仍认 sort=${sort}（给临时列表 / 以后用）：0 / 20 / 40 三段 = 列表里这一列的序`, async () => {
      const 照 = (await 对照(人们.经理, { sort })).get("潜客培育")!;
      const 段 = (偏移: number) => 作为(人们.经理, () => 读看板一列(人们.经理, { sort }, "潜客培育", 偏移));
      const 拼 = [...(await 段(0))!.行, ...(await 段(20))!.行, ...(await 段(40))!.行].map((r) => r.id);
      expect(名们(拼)).toEqual(名们(照));
      expect((await 段(42))!.行).toEqual([]);
    });
  }

  it("后筛（收回次数）：首屏每列各取前 20，「再看」接着取，与首屏同一圈、和列表同序", async () => {
    for (const recycled of ["0", "1"]) {
      const sp = { pool: "1", recycled };
      const 照 = await 对照(人们.管理员, sp);
      const d = await 首屏(人们.管理员, sp);
      for (const 列 of ["潜客培育", "线索验证"]) {
        const 全 = 照.get(列) ?? [];
        expect(d.每列![列].map((r) => r.id), `${recycled} ${列}`).toEqual(全.slice(0, 20));
        const 二 = await 作为(人们.管理员, () => 读看板一列(人们.管理员, sp, 列, 20));
        expect(二!.总, `${recycled} ${列}`).toBe(全.length);
        expect(二!.行.map((r) => r.id), `${recycled} ${列}`).toEqual(全.slice(20, 40));
      }
      expect(照.get("潜客培育")).toHaveLength(recycled === "1" ? 22 : 3);
    }
  });

  it("/projects 带 pool=1、recycled=1（企业版）：首屏转去公海页，动作也不给（不比首屏看得多）", async () => {
    await expect(作为(人们.管理员, () => 项目页(人们.管理员 as unknown as SessionUser, { pool: "1", recycled: "1" }))).rejects.toThrow("REDIRECT:/pool");
    设身份(人们.管理员);
    expect(await 以谁的身份(人们.管理员.id, () => 再看项目页一列("?pool=1&recycled=1", "潜客培育", 20))).toEqual({ ok: false, error: "这里没有看板" });
  });
});

describe("/projects、市场「我分出去的」看板（审查 A）", () => {
  type 页参 = { 行: 项目行[]; 每列?: Record<string, 项目行[]>; 列: { 列: string; 数: number; 行: 项目行[] }[]; 总数: number };
  const 参of = (el: unknown) => (el as { props: 页参 }).props;
  it("市场甲「我分出去的」：小列（合同审批 3 个）首屏全出、大列（痛点挖掘 25 个）出 20，再看接着取；市场乙分出去的一张都没有", async () => {
    const 市 = 人们.市场甲;
    const p = 参of(await 作为(市, () => 项目页(市 as unknown as SessionUser, {}, undefined, { 基址: "/customers", 标题: "客户", 换回客户列表: true })));
    const 列 = (k: string) => p.列.find((c) => c.列 === k)!;
    expect(列("合同审批").数).toBe(3);
    expect(列("合同审批").行).toHaveLength(3);
    expect(列("痛点挖掘").数).toBe(25);
    expect(列("痛点挖掘").行).toHaveLength(20);
    // 列表那一页照旧给（浏览器里可能切到列表）
    expect(p.行.length).toBe(Math.min(20, p.总数));
    设身份(市);
    const 二 = await 以谁的身份(市.id, () => 再看项目页一列("", "痛点挖掘", 20));
    expect(二.ok && 二.总).toBe(25);
    const 全 = [...列("痛点挖掘").行, ...(二.ok ? 二.行 : [])];
    expect(new Set(全.map((r) => r.id)).size).toBe(25);
    const 建的人 = new Map((await prisma.project.findMany({ where: { id: { in: 全.map((r) => r.id) } }, select: { id: true, creatorId: true } })).map((r) => [r.id, r.creatorId]));
    expect(new Set(全.map((r) => 建的人.get(r.id)))).toEqual(new Set([市.id]));
    // 直接调动作、一次 100 个、要别的列：都只有自己分出去的
    const 大 = await 以谁的身份(市.id, () => 再看项目页一列("", "痛点挖掘", 0, 100));
    expect(大.ok && 大.总).toBe(25);
    expect(await 以谁的身份(市.id, () => 再看项目页一列("", "潜客培育", 0, 100))).toMatchObject({ ok: true, 行: [], 总: 0 });
  });

  it("/projects（销售甲）：两份都取——列表那一页和不带看板时一样；看板小列全出、大列 20", async () => {
    const p = 参of(await 作为(人们.甲, () => 项目页(人们.甲 as unknown as SessionUser, {})));
    const 列表 = await 作为(人们.甲, () => 读项目列表(人们.甲, {}));
    expect(p.行.map((r) => r.id)).toEqual(列表.行.map((r) => r.id));
    expect(p.列.find((c) => c.列 === "线索验证")!.行).toHaveLength(4);
    expect(p.列.find((c) => c.列 === "潜客培育")!.行).toHaveLength(20);
  });
});

describe("查询数", () => {
  it("按负责人排（审查 Q1）：一段落在 20 位负责人名下也最多 3 句；/projects 首屏条数不随负责人多少变", async () => {
    // 管理员看得到的「线索推进」：一人一个，先 22 位
    const 加人 = async (起: number, 个: number) => {
      for (let i = 起; i < 起 + 个; i++) {
        const u = await prisma.user.create({ data: { email: `负责${i}@t`, name: `负责人${String(i).padStart(3, "0")}`, title: "", role: "SALES", password: "x" } });
        await prisma.entMember.create({ data: { userId: u.id, bizRole: "sales" } });
        const c = await prisma.customer.create({ data: { name: `负责${i}的客户`, phone: `1394000${String(i).padStart(4, "0")}`, salesOwnerId: u.id } });
        await prisma.project.create({ data: { name: `负责${i}的项目`, customerId: c.id, ownerId: u.id, creatorId: u.id, phase: "线索", node: "线索推进" } });
      }
    };
    await 加人(0, 22);
    const 管 = 人们.管理员;
    const 段 = () => 作为(管, () => 读看板一列(管, { sort: "owner-desc" }, "线索推进", 0, 20));
    const 一段 = await 数句(段);
    expect(new Set(一段.r!.行.map((r) => r.ownerId)).size).toBe(20);
    const 按人句 = (q: string[]) => q.filter((x) => /FROM `main`\.`Project` WHERE .*`ownerId`/.test(x) && /LIMIT|IN \(/.test(x) && !/GROUP BY|COUNT/.test(x)).length;
    expect(按人句(一段.句)).toBeLessThanOrEqual(3);
    // 中间几位合成的那一句带 take 兜底（= 这几位应取的条数之和），计数之后又进来的不多取
    expect(一段.句.some((q) => /`ownerId` IN \(/.test(q) && /LIMIT/.test(q) && !/GROUP BY/.test(q))).toBe(true);
    const 首屏句 = async () => (await 数句(() => 作为(管, () => 读项目列表(管, { sort: "owner-desc" }, undefined, { 每列: true, 要列表页: true })))).句.length;
    const 少 = await 首屏句();
    await 加人(22, 30);
    expect((await 数句(段)).句.length).toBe(一段.句.length);
    expect(await 首屏句()).toBe(少);
    await prisma.project.deleteMany({ where: { name: { startsWith: "负责" } } });
  });

  it("最近留痕（审查 Q2）：一句 groupBy 取每个项目最近一条，不再把留痕整批取回；回收日照算", async () => {
    // 甲的潜客培育每个项目 30 条留痕
    const ids = (await prisma.project.findMany({ where: { ownerId: 人们.甲.id, node: "潜客培育" }, select: { id: true } })).map((r) => r.id);
    const 最近 = new Date(Date.now() - 3600_000);
    for (const id of ids) {
      await prisma.projectNodeLog.createMany({ data: Array.from({ length: 30 }, (_, k) => ({ projectId: id, userId: 人们.甲.id, kind: "node", toPhase: "线索", toNode: "潜客培育", at: new Date(最近.getTime() - k * 60_000) })) });
    }
    const { 句, r } = await 数句(() => 首屏(人们.甲));
    const 留痕句 = 句.filter((q) => q.includes("`ProjectNodeLog`"));
    // 取留痕时间的只有 MAX 那一句（GROUP BY）；没有原来 include 那种「projectId IN (…) ORDER BY at DESC」整批取（回避名单那几句按 kind 查、不取时间，不算）
    expect(留痕句.filter((q) => /`ProjectNodeLog`\.`at`/.test(q) && !/GROUP BY/.test(q)).map((q) => q.slice(0, 300))).toEqual([]);
    expect(留痕句.filter((q) => /MAX\(/.test(q) && /GROUP BY/.test(q)).length).toBe(1);
    expect(r.每列!["潜客培育"]).toHaveLength(20);
    await prisma.projectNodeLog.deleteMany({ where: { projectId: { in: ids }, kind: "node" } });
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

describe("两句之间项目离开了范围、查询串重复键", () => {
  it("先定 id、再带 include 取行之间少了一个（并发回收 / 转让 / 删掉）：首屏跳过它，不塞 undefined、不报错", async () => {
    const 照 = (await 对照(人们.甲)).get("潜客培育")!;
    const 丢 = 照[0];
    记.滤 = (a, r) => (a?.include ? r.filter((x) => x.id !== 丢) : r);
    try {
      // /projects 那种：列表页先取 id、看板大列先取 id，再一句 include
      const d = await 作为(人们.甲, () => 读项目列表(人们.甲, {}, undefined, { 每列: true, 要列表页: true }));
      expect(d.行.every(Boolean)).toBe(true);
      expect(d.行.map((r) => r.id)).not.toContain(丢);
      const 列 = d.每列!["潜客培育"];
      expect(列.every(Boolean)).toBe(true);
      expect(列).toHaveLength(19);
      expect(列.map((r) => r.id)).toEqual(照.slice(1, 20));
      const 列们 = 看板分列(d.行, 字典(), undefined, d.看板合计, d.每列);
      expect(列们.flatMap((c) => c.行).every((r) => r && typeof r.id === "string")).toBe(true);
      // 「再看」同样跳过
      const 二 = await 作为(人们.甲, () => 读看板一列(人们.甲, {}, "潜客培育", 0));
      expect(二!.行.every(Boolean)).toBe(true);
      expect(二!.行).toHaveLength(19);
    } finally {
      记.滤 = null;
    }
  });

  it("两个「再看」动作：同名参数出现两次及以上直接拒（首屏会当没筛，口径对不上）；不重复的照常", async () => {
    设身份(人们.甲);
    const 客 = (q: string) => 以谁的身份(人们.甲.id, () => 再看一列(q, "潜客培育", 20));
    const 项 = (q: string) => 以谁的身份(人们.甲.id, () => 再看项目页一列(q, "潜客培育", 20));
    expect(await 客("?keyword=甲&keyword=乙")).toEqual({ ok: false, error: "参数不对" });
    expect(await 客("?phase=线索&phase=线索&phase=商机")).toEqual({ ok: false, error: "参数不对" });
    expect(await 项("?ownerId=a&ownerId=b")).toEqual({ ok: false, error: "参数不对" });
    expect(await 项("?keyword=x&keyword=x")).toEqual({ ok: false, error: "参数不对" });
    expect((await 客("?phase=线索")).ok).toBe(true);
    expect((await 项("?phase=线索")).ok).toBe(true);
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
