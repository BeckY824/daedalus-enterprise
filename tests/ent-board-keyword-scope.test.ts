/**
 * 客户页「看板 + 关键词」提速（11-26）：宽词时客户关键词条件的编号名单上万个，看板 groupBy、每个大列、带 include 的各一句都把它重绑一遍。
 * 改成：①名单先按我看得到的客户收窄（customers/query.ts 看得到的关键词条件，scope-sql.ts 看得到的）；
 *       ②名单长（超 客户名单一次取全线）时看板一句按默认序取全分列要的几列，列头、每列前 20 在内存里算，卡片按 id 再一句（lib/project/list.ts）。
 * 钉的是：逐身份（系统管理员、总管理、销售管理、销售、市场、教练、只负责项目的销售、组员）× 页签 × 关键词（单字、三字以上、搜不到、联系人号码 / 微信）
 * × 要不要列表页 × 列表排序，新路（收窄 + 一句取全）和老路（不收窄的名单 + 分列各取）列头的数、每列卡片、列表页那几行、总数逐个一样；
 * 再数一次请求的 SQL 条数和绑定参数个数：只许少不许多。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
const 记 = vi.hoisted(() => ({ 开: false, 句: [] as { query: string; 参: number }[], 们: new Set<{ $queryRawUnsafe: (sql: string) => Promise<unknown> }>() }));
vi.mock("@/generated/prisma", async (原) => {
  const m = await 原<typeof import("@/generated/prisma")>();
  class 记数Client extends m.PrismaClient {
    async $disconnect() {
      记.们.delete(this as never);
      return super.$disconnect();
    }
    constructor(o: ConstructorParameters<typeof m.PrismaClient>[0] = {}) {
      super({ ...o, log: [{ emit: "event", level: "query" }, ...((o?.log as never[]) ?? [])] } as never);
      (this as unknown as { $on: (e: string, f: (x: { query: string; params: string }) => void) => void }).$on("query", (e) => {
        if (!记.开) return;
        let 参 = 0;
        try { 参 = (JSON.parse(e.params) as unknown[]).length; } catch { 参 = 0; }
        记.句.push({ query: e.query, 参 });
      });
      记.们.add(this as never);
    }
  }
  return { ...m, PrismaClient: 记数Client };
});
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 都等齐 } from "./query-log";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读项目列表, 绑定名单长度, 设客户名单一次取全线 } from "@/lib/project/list";
import { 客户页看板条件 } from "@/app/(app)/customers/board-query";
import { 客户筛选条件, 只按页签 } from "@/app/(app)/customers/query";
import { 市场成员key } from "@/lib/enterprise/market";

type 人 = { id: string; name: string; role: string };
const 人们: Record<string, 人> = {};
const 作为 = <T,>(谁: 人, fn: () => Promise<T>) => {
  mocks.user = { ...mocks.user, id: 谁.id, name: 谁.name, role: 谁.role };
  忘掉企业版范围();
  return 以谁的身份(谁.id, fn);
};

async function 数句<T>(fn: () => Promise<T>): Promise<{ 句: { query: string; 参: number }[]; r: T }> {
  记.句 = []; 记.开 = true; await 都等齐(记.们, 记.句); 记.句 = [];
  try { const r = await fn(); await 都等齐(记.们, 记.句); return { 句: 记.句, r }; } finally { 记.开 = false; }
}

/** 一次客户页看板：新 = 现在的写法（收窄的名单 + 一句取全）；老 = 不收窄的名单 + 分列各取（改前的写法） */
async function 看板(谁: 人, sp: Record<string, string>, 新: boolean, 要列表页 = false, 量?: { 句: { query: string; 参: number }[] }) {
  return 作为(谁, async () => {
    设客户名单一次取全线(新 ? 0 : 1e9);
    try {
      const b = await 客户页看板条件(sp);
      const { phase: _p, node: _n, page: _pg, pageSize: _ps, sort: _s, ...客户的 } = sp;
      const 老w = 新 ? null : await 客户筛选条件(客户的);
      const 客户 = 新 ? b.客户 : 只按页签(老w!) ? null : 老w;
      const 读 = () => 读项目列表(谁, { ...b.项目, 客户, 仅项目客户: b.仅项目客户 }, undefined, { 每列: true, 要列表页 });
      const d = 量 ? await 数句(读).then((x) => { 量.句 = x.句; return x.r; }) : await 读();
      return {
        总数: d.总数,
        页: d.页,
        合计: d.看板合计.map((g) => `${g.phase}|${g.node}|${g.result}|${g.currency}|${g.数}|${g.amount}`).sort(),
        每列: Object.fromEntries(Object.entries(d.每列 ?? {}).map(([k, rs]) => [k, rs.map((r) => r.id)])),
        行: d.行.map((r) => r.id),
        名单: 绑定名单长度(客户),
      };
    } finally { 设客户名单一次取全线(2000); }
  });
}

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
  await 建人("总管", "SALES", "director");
  await 建人("经理", "SALES", "sales_mgr");
  await 建人("甲", "SALES", "sales", 人们.经理.id);
  await 建人("丙", "SALES", "sales", 人们.经理.id);
  await 建人("乙", "SALES", "sales");
  await 建人("市场", "SALES", "channel_ops");
  await 建人("教练", "SALES", "coach");
  await setSetting("business", { projectMode: true });
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting(市场成员key, [人们.市场.id]);
  invalidateSettingsCache();

  const 节点: [string, string][] = [["线索", "潜客培育"], ["线索", "线索验证"], ["线索", "线索推进"], ["商机", "痛点挖掘"], ["商机", "方案敲定"]];
  const 基 = Date.now() - 30 * 86400_000;
  let n = 0;
  const 客户们: Record<string, string[]> = {};
  for (const 谁 of ["甲", "丙", "乙"] as const) {
    客户们[谁] = [];
    for (let k = 0; k < 8; k++) {
      n++;
      const c = await prisma.customer.create({
        data: { name: `${谁}测试客户${k}`, phone: `1393000${String(n).padStart(4, "0")}`, salesOwnerId: 人们[谁].id, remark: k % 3 === 0 ? "备注里有测试客" : null },
      });
      客户们[谁].push(c.id);
      if (k % 2 === 0) await prisma.contact.create({ data: { customerId: c.id, name: `联系人${n}`, phone: `1588800${String(n).padStart(4, "0")}`, wechat: `wx_lx${n}` } });
      // 每位客户 1–4 个项目，散在几个节点上（同一时刻的不少，按主键兜底）
      for (let j = 0; j <= k % 4; j++) {
        n++;
        const [phase, node] = 节点[(n * 7) % 节点.length];
        await prisma.project.create({
          data: {
            name: `${谁}项目${k}-${j}`, customerId: c.id, ownerId: 人们[谁].id, creatorId: k === 5 ? 人们.市场.id : 人们[谁].id, phase, node, amount: n * 10,
            updatedAt: new Date(基 + (n % 5) * 3600_000), currency: n % 6 === 0 ? "USD" : "CNY",
          },
        });
      }
    }
  }
  // 公海客户（带项目，项目也在公海）
  for (let k = 0; k < 4; k++) {
    const c = await prisma.customer.create({ data: { name: `公海测试客户${k}`, phone: `1397700${k}000`, salesOwnerId: 人们.乙.id } });
    await prisma.customerPool.create({ data: { customerId: c.id, userId: 人们.乙.id } });
    await prisma.project.create({ data: { name: `公海项目${k}`, customerId: c.id, ownerId: "", creatorId: 人们.乙.id, phase: "线索", node: "潜客培育", pooledAt: new Date(基), updatedAt: new Date(基 + k * 60_000) } });
  }
  // 只负责项目的：丙负责乙客户上的项目（丙看不到这位客户）
  await prisma.project.create({ data: { name: "丙在乙客户上的项目", customerId: 客户们.乙[1], ownerId: 人们.丙.id, creatorId: 人们.乙.id, phase: "线索", node: "线索验证", updatedAt: new Date(基) } });
  // 组员：甲进了乙客户上的一个项目
  const 进组 = await prisma.project.findFirstOrThrow({ where: { customerId: 客户们.乙[2] } });
  await prisma.projectMember.create({ data: { projectId: 进组.id, userId: 人们.甲.id, inviteStatus: "JOINED" } });
  // 回收站里的客户（软删）挂着的项目
  await prisma.customer.update({ where: { id: 客户们.丙[7] }, data: { deletedAt: new Date() } });
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

const 词们 = ["测", "测试客户", "测试客", "甲测试客户3", "无此词xyz", "158880", "wx_lx", "项目"];
const 身份们 = ["管理员", "总管", "经理", "甲", "丙", "乙", "市场", "教练"];

describe("看板 + 关键词：新路 = 老路", () => {
  it("逐身份 × 关键词 × 页签：列头的数、每列卡片、总数一样", async () => {
    let 比过 = 0;
    for (const 谁 of 身份们) for (const keyword of 词们) for (const tab of [{}, { pool: "1" }] as Record<string, string>[]) {
      const sp = { keyword, ...tab };
      const 老 = await 看板(人们[谁], sp, false);
      const 新 = await 看板(人们[谁], sp, true);
      const { 名单: _a, ...老比 } = 老;
      const { 名单: _b, ...新比 } = 新;
      expect(新比, `${谁} ${JSON.stringify(sp)}`).toEqual(老比);
      // 收窄只会更短
      expect(新.名单, `${谁} ${keyword}`).toBeLessThanOrEqual(老.名单);
      if (老.总数) 比过++;
    }
    // 不是全空对全空
    expect(比过).toBeGreaterThan(30);
  });

  it("要列表页（能分配时）× 列表排序：列表页那几行也一样", async () => {
    for (const 谁 of ["管理员", "经理", "甲"]) for (const sort of ["", "created-desc", "owner-asc", "deal-asc"]) for (const page of ["1", "2"]) {
      const sp = { keyword: "测试", sort, page, pageSize: "10" };
      expect(await 看板(人们[谁], sp, true, true), `${谁} ${sort} ${page}`).toEqual({ ...(await 看板(人们[谁], sp, false, true)), 名单: expect.any(Number) });
    }
  });

  it("名单按范围收窄：销售的名单只剩看得到的；看全部的不收窄", async () => {
    const 甲老 = await 看板(人们.甲, { keyword: "测试客户" }, false);
    const 甲新 = await 看板(人们.甲, { keyword: "测试客户" }, true);
    // 全库 24 位 + 公海 4 位都对上；甲看得到：自己 8 位 + 组员 1 位 + 公海 4 位，回收站里那 1 位照旧留着（不比老路少）
    expect(甲老.名单).toBe(28);
    expect(甲新.名单).toBe(14);
    const 管老 = await 看板(人们.管理员, { keyword: "测试客户" }, false);
    const 管新 = await 看板(人们.管理员, { keyword: "测试客户" }, true);
    expect(管新.名单).toBe(管老.名单);
  });
});

describe("查询条数、绑定参数", () => {
  it("宽词一次看板：条数不增，绑定参数少", async () => {
    // 宽词：再添 3000 位对得上的客户（乙名下，没挂项目，同正式库那种一个词对上几万位客户），名单远比这一屏的卡片多
    await prisma.customer.createMany({ data: Array.from({ length: 3000 }, (_, i) => ({ name: `批量测试客户${i}`, phone: `1366600${String(i).padStart(4, "0")}`, salesOwnerId: 人们.乙.id })) });
    // 再凑两个大列（超过每列 20 张）：甲的一位客户在潜客培育、痛点挖掘各挂 25 个
    const 甲客 = await prisma.customer.findFirstOrThrow({ where: { name: "甲测试客户0" } });
    for (const [phase, node] of [["线索", "潜客培育"], ["商机", "痛点挖掘"]]) {
      await prisma.project.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ name: `甲大列${node}${i}`, customerId: 甲客.id, ownerId: 人们.甲.id, creatorId: 人们.甲.id, phase, node })) });
    }
    const 报: string[] = [];
    for (const 谁 of ["总管", "甲"]) {
      const 量老 = { 句: [] as { query: string; 参: number }[] }, 量新 = { 句: [] as { query: string; 参: number }[] };
      const 老 = { r: await 看板(人们[谁], { keyword: "测试客户" }, false, false, 量老), 句: [] as { query: string; 参: number }[] };
      const 新 = { r: await 看板(人们[谁], { keyword: "测试客户" }, true, false, 量新), 句: [] as { query: string; 参: number }[] };
      老.句 = 量老.句; 新.句 = 量新.句;
      // 只数读项目列表那一段（名单前面各算一句：老路一句不收窄的、新路一句收窄的，条数相同）
      const 项目句 = (句: { query: string; 参: number }[]) => 句;
      const 带名单 = (句: { query: string; 参: number }[]) => 项目句(句).filter((s) => s.参 >= 老.r.名单 && 老.r.名单 > 0);
      const 参 = (句: { query: string; 参: number }[]) => 项目句(句).reduce((n, s) => n + s.参, 0);
      报.push(`${谁}: 项目句 ${项目句(老.句).length} → ${项目句(新.句).length}，带整份名单的 ${带名单(老.句).length} → ${带名单(新.句).length}，项目句绑定参数 ${参(老.句)} → ${参(新.句)}（名单 ${老.r.名单} → ${新.r.名单}）`);
      expect(项目句(新.句).length).toBeLessThanOrEqual(项目句(老.句).length);
      expect(参(新.句)).toBeLessThan(参(老.句));
      expect(带名单(新.句).length).toBeLessThanOrEqual(1);
    }
    console.log(报.join("\n"));
  });
});
