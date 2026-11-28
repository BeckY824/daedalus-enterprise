/**
 * 公海页读公海段提速（O1-N3，叠在 #527 上）：
 *   - 放回留痕改成按项目 id 点名取：每个项目「最近一次放回」的人和原因和改前的写法逐项相同（造两次放回、不同人，含分段取）
 *   - 公海项目行、公海客户属性名单进 3 秒短缓存（pool-count-cache）：开着缓存时，放入 / 领取 / 阶段变化 / 客户恢复后立即作废；
 *     缓存里放的是不分人的全量，原负责人回避在取出后按人排掉（先给别人填满缓存，原负责人再读照样看不到）
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
import { 回填放回人列 } from "./helpers/pool-prev-owner-seed";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 旧读公海页 } from "./helpers/unified-pool-old";
import { 测试里开公海分组缓存 } from "@/lib/enterprise/pool-count-cache";
import { 一批id数 } from "@/lib/project/pool-owner";

type 人 = { id: string; name: string; role: string };
async function 造人(key: string, 业务?: { bizRole: string; managerId?: string }, 补: { email?: string; active?: boolean } = {}): Promise<人> {
  const u = await raw.user.create({ data: { email: 补.email ?? `${key}@test`, name: key, title: "", role: "SALES", password: "x", active: 补.active ?? true } });
  if (业务) await raw.entMember.create({ data: { userId: u.id, ...业务 } });
  return { id: u.id, name: key, role: "SALES" };
}
const 时刻 = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60_000);

let 总管理: 人, 销售: 人, 同事: 人;
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 新 = (u: 人) => { 当(u); return 以谁的身份(u.id, () => 读公海页(u, {}, 1, 1000)); };
const 旧 = (u: 人) => { 当(u); return 以谁的身份(u.id, () => 旧读公海页(u, {}, 1, 1000)); };
/** 以谁的身份写：走带限定层的 prisma（放入、领取这类动作都走它，写库版本由它加） */
const 写 = <T,>(u: 人, fn: () => Promise<T>) => { 当(u); return 以谁的身份(u.id, fn); };

const 项目数 = 一批id数 + 30; // 超过一段，点名取要分两段
const pid = (i: number) => `fp${String(i).padStart(4, "0")}`;

beforeAll(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  vi.stubEnv("CRM_READ_POOL", "0");
  await resetDb();
  invalidateSettingsCache();
  await prisma.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  总管理 = await 造人("director", { bizRole: "director" });
  const 销售管理 = await 造人("mgr", { bizRole: "sales_mgr" });
  销售 = await 造人("sales", { bizRole: "sales", managerId: 销售管理.id });
  同事 = await 造人("peer", { bizRole: "sales" });
  await 造人("placeholder", undefined, { email: 无负责人占位邮箱, active: false });
  // 公海项目（客户不在客户池）：每个都有两次放回，先同事后销售 / 先销售后同事，原因各不同；一半以上的最近一次是同事
  for (let i = 0; i < 项目数; i++) {
    const cid = `fc${String(i).padStart(4, "0")}`;
    await raw.customer.create({ data: { id: cid, name: `客户${i}`, phone: `16${String(i).padStart(9, "0")}`, salesOwnerId: 同事.id } });
    await raw.project.create({ data: { id: pid(i), name: `项目${i}`, customerId: cid, ownerId: "", creatorId: 销售.id, phase: "线索", node: "线索验证", pooledAt: 时刻(2000 + i), createdAt: 时刻(i) } });
    const [甲, 乙] = i % 2 ? [销售, 同事] : [同事, 销售];
    await raw.projectNodeLog.create({ data: { projectId: pid(i), kind: "pool-release", fromOwnerId: 甲.id, userId: 甲.id, reason: `回收原因：早${i}`, toPhase: "线索", toNode: "x", at: 时刻(1000 + i) } });
    await raw.projectNodeLog.create({ data: { projectId: pid(i), kind: "pool-release", fromOwnerId: 乙.id, userId: 乙.id, reason: `回收原因：晚${i}`, toPhase: "线索", toNode: "x", at: 时刻(1500 + i) } });
  }
  // 一位在客户公海里的客户，名下一个线索项目（属性名单用）
  await raw.customer.create({ data: { id: "fcpool", name: "池里客户", phone: "16999999999", salesOwnerId: 同事.id } });
  await raw.customerPool.create({ data: { customerId: "fcpool", userId: null, reason: "手动", at: 时刻(3000) } });
  await raw.project.create({ data: { id: "fpin", name: "池客户项目", customerId: "fcpool", ownerId: 同事.id, creatorId: 同事.id, phase: "线索", node: "线索验证", createdAt: 时刻(5) } });
  await 回填放回人列(raw);
  忘掉企业版范围();
}, 120_000);
afterAll(async () => {
  测试里开公海分组缓存(false);
  vi.unstubAllEnvs();
  忘掉企业版范围();
  await prisma.$disconnect();
});

describe("放回留痕按项目 id 点名取：最近一次放回和改前逐项相同", () => {
  for (const 缓存 of [false, true]) {
    it(`缓存${缓存 ? "开" : "关"}：总管理、销售、同事读到的整个返回值和改前写法一样（${项目数} 个项目，两次放回、不同人）`, async () => {
      测试里开公海分组缓存(缓存);
      for (const u of [总管理, 销售, 同事]) {
        const [n, o] = [await 新(u), await 旧(u)];
        expect(n).toEqual(o);
      }
      // 抽几行直接看：入池原因认最近一条（晚），不是早的
      const 行们 = (await 新(总管理)).行.filter((r) => r.种 === "项目");
      expect(行们.length).toBe(项目数);
      for (const r of 行们) expect(r.入池原因).toContain("晚");
    }, 120_000);
  }
});

describe("短缓存：写后立即作废；回避在取出后按人排", () => {
  it("放入公海 / 领取：同一秒内再读拿到新结果", async () => {
    测试里开公海分组缓存(true);
    const 数 = async (u: 人) => (await 新(u)).行.filter((r) => r.种 === "项目").length;
    expect(await 数(总管理)).toBe(项目数);
    // 放入：把池客户的项目放进项目公海前先让客户离开客户池，再让项目进项目公海
    await 写(总管理, () => prisma.customerPool.delete({ where: { customerId: "fcpool" } }));
    await 写(总管理, () => prisma.project.update({ where: { id: "fpin" }, data: { pooledAt: new Date(), ownerId: "" } }));
    expect(await 数(总管理)).toBe(项目数 + 1);
    // 领取：项目有了负责人、离开公海
    await 写(总管理, () => prisma.project.update({ where: { id: "fpin" }, data: { pooledAt: null, ownerId: 销售.id } }));
    expect(await 数(总管理)).toBe(项目数);
  }, 120_000);

  it("属性名单：阶段变化、客户恢复（离开 / 回到客户池）后立即作废", async () => {
    测试里开公海分组缓存(true);
    const 商机 = async () => (await 新(总管理)).属性数["商机池"];
    await 写(总管理, () => prisma.customerPool.create({ data: { customerId: "fcpool", userId: null, reason: "手动", at: new Date() } }));
    const 前 = await 商机();
    await 写(总管理, () => prisma.project.update({ where: { id: "fpin" }, data: { phase: "商机", node: "明确需求" } }));
    expect(await 商机()).toBe(前 + 1);
    // 恢复：客户离开客户池，不再算
    await 写(总管理, () => prisma.customerPool.delete({ where: { customerId: "fcpool" } }));
    expect(await 商机()).toBe(前);
    await 写(总管理, () => prisma.project.update({ where: { id: "fpin" }, data: { phase: "线索", node: "线索验证" } }));
  }, 120_000);

  it("原负责人回避：缓存先被别人填满，原负责人再读照样看不到自己放回的，别人照样看得到", async () => {
    测试里开公海分组缓存(true);
    const 总 = await 新(总管理);
    const 我放的 = await raw.project.findMany({ where: { poolPrevOwnerId: 销售.id, pooledAt: { not: null } }, select: { id: true } });
    expect(我放的.length).toBeGreaterThan(0);
    const 销 = await 新(销售); // 紧接着、在缓存里
    const ids = new Set(销.行.map((r) => r.projectId));
    for (const p of 我放的) expect(ids.has(p.id)).toBe(false);
    expect(销.行.filter((r) => r.种 === "项目").length).toBe(项目数 - 我放的.length);
    expect(总.行.filter((r) => r.种 === "项目").length).toBe(项目数);
    expect(await 旧(销售)).toEqual(销);
  }, 120_000);
});
