/**
 * 公海页量时（11-18，历史沟通分析回填前置 ⑤）：6.5 万位公海客户、每位挂 1 个历史分析回填项目（进行中 / 线索流失 / 丢单 / 订单阶段结束），
 * 外加 1.7 千位平常的公海客户和 300 个项目公海里的项目，按总管理身份连读 公海页第一页 N 次，打印 p50 / p95。
 * 标准：公海页 p95 < 500ms。只在 POOL_BENCH=1 时跑（造数要十几秒，不进日常单测）：
 *   POOL_BENCH=1 npx vitest run --maxWorkers=1 tests/ent-pool-history-bench.test.ts
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
import { 规则 } from "@/lib/enterprise/rules";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 历史分析来源, 补建创建人 } from "@/lib/project/system-created";

const 跑 = process.env.POOL_BENCH === "1";
const 回填几位 = Number(process.env.POOL_BENCH_N ?? 65_000);
const 平常几位 = 1_700;
const 次数 = 30;

let 总管理: { id: string; name: string; role: string };

async function 分批<T>(们: T[], 写: (批: T[]) => Promise<unknown>, 一批 = 5_000) {
  for (let i = 0; i < 们.length; i += 一批) await 写(们.slice(i, i + 一批));
}

describe.skipIf(!跑)("公海页量时：6.5 万历史分析回填", () => {
  beforeAll(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    vi.stubEnv("CRM_READ_POOL", "0");
    await resetDb();
    invalidateSettingsCache();
    await prisma.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
    const u = await raw.user.create({ data: { email: "director@test", name: "总管理", title: "", role: "SALES", password: "x" } });
    await raw.entMember.create({ data: { userId: u.id, bizRole: "director" } });
    总管理 = { id: u.id, name: "总管理", role: "SALES" };
    const 销售 = await raw.user.create({ data: { email: "sales@test", name: "销售", title: "", role: "SALES", password: "x" } });
    await raw.entMember.create({ data: { userId: 销售.id, bizRole: "sales" } });
    const 占位 = await raw.user.create({ data: { email: 无负责人占位邮箱, name: "占位", title: "", role: "SALES", password: "x", active: false } });
    const t0 = Date.UTC(2026, 0, 1);
    const 客户们 = Array.from({ length: 回填几位 + 平常几位 }, (_, i) => ({
      id: `c${i}`, name: `客户${i}`, phone: `1${String(i).padStart(10, "0")}`, salesOwnerId: 占位.id,
      lastFollowAt: i % 3 ? new Date(t0 + i * 60_000) : null, createdAt: new Date(t0 + (i % 997) * 3_600_000),
    }));
    await 分批(客户们, (批) => raw.customer.createMany({ data: 批 }));
    await 分批(客户们.map((c, i) => ({ customerId: c.id, userId: null, reason: i < 回填几位 ? "历史沟通分析" : "手动", at: new Date(t0 + i * 1_000) })), (批) => raw.customerPool.createMany({ data: 批 }));
    const 摆法 = [["线索", "潜客培育", null], ["线索", "线索验证", "线索流失"], ["商机", "共识方案", "丢单"], ["商机", "明确需求", null], ["订单", "生产备货", "异常状态"]] as const;
    const 回填们 = Array.from({ length: 回填几位 }, (_, i) => {
      const [phase, node, result] = 摆法[i % 摆法.length];
      return {
        id: `h${i}`, name: `历史${i}`, customerId: `c${i}`, ownerId: "", creatorId: 补建创建人, phase, node, result,
        closedAt: result ? new Date(Date.UTC(2023, i % 36, 1)) : null, pooledAt: new Date(t0 + i * 1_000),
        createdAt: new Date(Date.UTC(2022, i % 40, 1)), source: 历史分析来源, importBatch: "bench-1",
      };
    });
    await 分批(回填们, (批) => raw.project.createMany({ data: 批 }));
    // 平常的公海客户一半带项目；另有 300 位有负责人的客户各放 1 个项目进项目公海（客户池）
    await 分批(Array.from({ length: 平常几位 / 2 }, (_, i) => ({ name: `平常${i}`, customerId: `c${回填几位 + i}`, ownerId: "", creatorId: 销售.id, phase: i % 2 ? "商机" : "线索", node: "明确需求", pooledAt: new Date() })), (批) => raw.project.createMany({ data: 批 }));
    const 有主 = Array.from({ length: 300 }, (_, i) => ({ id: `o${i}`, name: `有主${i}`, phone: `2${String(i).padStart(10, "0")}`, salesOwnerId: 销售.id }));
    await raw.customer.createMany({ data: 有主 });
    await raw.project.createMany({ data: 有主.map((c, i) => ({ name: `公海项目${i}`, customerId: c.id, ownerId: "", creatorId: 销售.id, phase: "线索", node: "线索验证", pooledAt: new Date() })) });
    忘掉企业版范围();
  }, 600_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
    await resetDb();
    await prisma.$disconnect();
  });

  it("总管理读公海页第一页：p95", async () => {
    mocks.user = { ...mocks.user, id: 总管理.id, name: 总管理.name, role: 总管理.role };
    const 读 = (sp: Record<string, string> = {}) => 以谁的身份(总管理.id, () => 读公海页(总管理, sp, 1, 50));
    const 头 = await 读();
    // 先热一遍（缓存、预编译）
    for (let i = 0; i < 3; i++) await 读();
    const 量 = async (sp: Record<string, string>) => {
      const 时: number[] = [];
      for (let i = 0; i < 次数; i++) {
        const t = performance.now();
        await 读(sp);
        时.push(performance.now() - t);
      }
      时.sort((a, b) => a - b);
      return { p50: Math.round(时[Math.floor(次数 * 0.5)]), p95: Math.round(时[Math.ceil(次数 * 0.95) - 1]) };
    };
    const 默认 = await 量({});
    const 商机池 = await 量({ 属性: "商机池" });
    const 第二页 = await 量({ 排序: "follow" });
    console.log(`[公海页量时] 公海客户 ${回填几位 + 平常几位} 位 / 回填项目 ${回填几位} 个；总数 ${头.总数}；属性数 ${JSON.stringify(头.属性数)}`);
    console.log(`[公海页量时] 默认 p50 ${默认.p50}ms p95 ${默认.p95}ms；商机池 p50 ${商机池.p50}ms p95 ${商机池.p95}ms；按跟进排 p50 ${第二页.p50}ms p95 ${第二页.p95}ms`);
    expect(头.行.length).toBe(50);
    expect(默认.p95).toBeLessThan(500);
  }, 600_000);
});
