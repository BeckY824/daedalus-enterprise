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

let 总管理: 人, 销售: 人, 同事: 人, 只读管理员: 人, 条线总管理: 人;
const 渠道id = "fch0001";
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 新 = (u: 人) => { 当(u); return 以谁的身份(u.id, () => 读公海页(u, {}, 1, 1000)); };
const 旧 = (u: 人) => { 当(u); return 以谁的身份(u.id, () => 旧读公海页(u, {}, 1, 1000)); };
const 新名单 = (u: 人) => { 当(u); return 以谁的身份(u.id, () => 读公海页(u, {}, 1, 1000, { channelId: 渠道id })); };
/** 旧写法没有名单入口：取旧的全量项目行，按渠道（项目来源）筛，和新的名单逐行对（项目 id、入池原因、原负责人是我、顺序） */
const 旧名单行 = async (u: 人) => (await 旧(u)).行.filter((r) => r.种 === "项目" && r.来源id === 渠道id).map((r) => ({ id: r.projectId, 原因: r.入池原因, 我放的: r.原负责人是我 }));
const 新名单行 = async (u: 人) => (await 新名单(u)).行.map((r) => ({ id: r.projectId, 原因: r.入池原因, 我放的: r.原负责人是我 }));
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
  只读管理员 = await 造人("admin", { bizRole: "admin" });
  条线总管理 = await 造人("director-line", { bizRole: "director" });
  await raw.entMember.update({ where: { userId: 条线总管理.id }, data: { line: "内贸" } });
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
  // 只读管理员（不受回避，应看得到）、条线总管理（照样回避，应看不到）各有自己放回的项目：把这几个项目最近一次放回改成他们
  const 他们放回: [人, number[]][] = [[只读管理员, [0, 1, 2]], [条线总管理, [3, 4, 5]]];
  for (const [人, 们] of 他们放回) for (const i of 们) {
    await raw.projectNodeLog.updateMany({ where: { projectId: pid(i), reason: { contains: "晚" } }, data: { fromOwnerId: 人.id, userId: 人.id } });
  }
  // 渠道：一批项目带渠道（渠道名单对拍用，名单里既有他们放回的、也有别人放回的）
  await raw.channel.create({ data: { id: 渠道id, name: "测试渠道", channelOwnerId: 总管理.id } });
  await raw.project.updateMany({ where: { id: { in: Array.from({ length: 40 }, (_, i) => pid(i)) } }, data: { channelId: 渠道id } });
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
    it(`缓存${缓存 ? "开" : "关"}：总管理、销售、同事、只读管理员、条线总管理读到的整个返回值和改前写法一样（${项目数} 个项目，两次放回、不同人）`, async () => {
      测试里开公海分组缓存(缓存);
      for (const u of [总管理, 销售, 同事, 只读管理员, 条线总管理]) {
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

describe("回避按角色：只读管理员看得到自己放回的，条线总管理看不到；渠道名单对拍", () => {
  for (const 缓存 of [false, true]) {
    it(`缓存${缓存 ? "开" : "关"}：只读管理员看得到自己放回的 3 个，条线总管理看不到自己放回的 3 个`, async () => {
      测试里开公海分组缓存(缓存);
      const 项目id们 = async (u: 人) => new Set((await 新(u)).行.filter((r) => r.种 === "项目").map((r) => r.projectId));
      const 读 = await 项目id们(只读管理员);
      for (const i of [0, 1, 2]) expect(读.has(pid(i))).toBe(true);
      expect(读.size).toBe(项目数);
      const 线 = await 项目id们(条线总管理);
      for (const i of [3, 4, 5]) expect(线.has(pid(i))).toBe(false);
      expect(线.size).toBe(项目数 - 3);
      expect(await 新(只读管理员)).toEqual(await 旧(只读管理员));
      expect(await 新(条线总管理)).toEqual(await 旧(条线总管理));
    }, 120_000);

    it(`缓存${缓存 ? "开" : "关"}：带渠道名单（只要 有值）读公海页和旧读公海页（按渠道筛）逐项相同`, async () => {
      测试里开公海分组缓存(缓存);
      for (const u of [总管理, 销售, 同事, 只读管理员, 条线总管理]) {
        const [n, o] = [await 新名单行(u), await 旧名单行(u)];
        expect(n.length).toBeGreaterThan(0);
        expect(n).toEqual(o);
      }
      const 线 = new Set((await 新名单(条线总管理)).行.map((r) => r.projectId));
      expect(线.has(pid(3))).toBe(false);
      const 读 = new Set((await 新名单(只读管理员)).行.map((r) => r.projectId));
      expect(读.has(pid(0))).toBe(true);
    }, 120_000);
  }
  it("缓存开、关两遍的渠道名单结果相同", async () => {
    测试里开公海分组缓存(false);
    const 关 = await 新名单(总管理);
    测试里开公海分组缓存(true);
    expect(await 新名单(总管理)).toEqual(关);
    expect(await 新名单(总管理)).toEqual(关);
  }, 120_000);
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
