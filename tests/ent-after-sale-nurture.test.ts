/**
 * 企业版后售培育判定核心（11-25，客户 E-290 / E-292；总表 P-界面-63 / 64、M-节点-10；方案第三节、第六节「0 判定核心」）：
 *   - 客户名下至少一个交付结清（含旧名成功交付）、没软删的项目 → 这位客户停在 线索 · 潜客培育 的项目显示「后售培育」；库里仍存潜客培育
 *   - 随时按现状判、不存：交付结清撤回、软删、项目换客户后名下没有交付结清的 → 回到潜客培育；只有丢单 / 线索流失 / 异常状态的不算
 *   - 仅记录用的项目照样显示后售培育（统计照旧排掉，那是阶段 2 的事）
 *   - 🔍 老项目（交付结清之前就建好、一直停在潜客培育）按「算」做（方案第十一节第 2 条，没回之前）；判定式只在 after-sale.ts 一处可改
 *   - 判定看客户名下全部项目（看全部），销售看不到同事负责的那个交付结清项目，照样判后售
 *   - 批量：一次查询拿全、500 位一批；条件版（列表筛选 / 统计 where 用）后售 + 不含后售 = 停在潜客培育，不重不漏
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "小王", email: "s1", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 看全部 } from "@/lib/team-scope";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 仅记录用来源 } from "@/lib/project/system-created";
import { 企业版字典, 团队版字典, 阶段与进程, 显示节点名, 后售培育名 } from "@/lib/project/stage-dict";
import {
  老项目算后售, 判后售, 交付结清客户们, 后售项目们, 后售条件, 潜客不含后售条件, 停在潜客培育, 是停在潜客培育, 交付结清的项目,
} from "@/lib/project/after-sale";

let 我: string, 同事: string, 客户: string, 别的客户: string;
let 序 = 0;
const 建 = (补: Record<string, unknown> = {}) =>
  raw.project.create({ data: { name: `项目${++序}`, customerId: 客户, ownerId: 我, creatorId: 我, phase: "线索", node: "潜客培育", ...补 } });
const 交付 = (补: Record<string, unknown> = {}) => 建({ phase: "订单", node: "尾款结算", result: "交付结清", closedAt: new Date("2026-06-01T00:00:00Z"), ...补 });
/** 一个项目按批量判定是不是后售 */
const 批量判 = async (id: string) => {
  const p = await raw.project.findUniqueOrThrow({ where: { id }, select: { id: true, customerId: true, phase: true, node: true, result: true, createdAt: true } });
  return (await 后售项目们([p])).has(id);
};
/** 一个项目按条件版判定：落在后售条件里、落在不含后售条件里各几条（应是 1 / 0 或 0 / 1） */
const 条件判 = async (id: string) => {
  const 后 = await 看全部(async () => prisma.project.count({ where: { AND: [{ id }, await 后售条件()] } }));
  const 潜 = await 看全部(async () => prisma.project.count({ where: { AND: [{ id }, await 潜客不含后售条件()] } }));
  return { 后, 潜 };
};
/** 两条路一起核：批量和条件版必须说同一句话 */
const 判 = async (id: string, 后售: boolean) => {
  expect(await 批量判(id)).toBe(后售);
  expect(await 条件判(id)).toEqual(后售 ? { 后: 1, 潜: 0 } : { 后: 0, 潜: 1 });
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  我 = (await raw.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
  同事 = (await raw.user.create({ data: { email: "s2", name: "小李", title: "", role: "SALES", password: "x" } })).id;
  await raw.entMember.createMany({ data: [{ userId: 我, bizRole: "sales" }, { userId: 同事, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 我 };
  客户 = (await raw.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 我 } })).id;
  别的客户 = (await raw.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 我 } })).id;
});
afterAll(async () => void (await prisma.$disconnect()));

describe("显示名（纯函数）", () => {
  it("潜客培育 + 后售 → 后售培育；不后售照旧；别的节点带了后售也不变；旧名照旧对到新名", () => {
    expect(后售培育名).toBe("后售培育");
    expect(显示节点名("潜客培育", true, 企业版字典)).toBe("后售培育");
    expect(显示节点名("潜客培育", false, 企业版字典)).toBe("潜客培育");
    expect(显示节点名("线索验证", true, 企业版字典)).toBe("线索验证");
    expect(显示节点名("明确需求", true, 企业版字典)).toBe("痛点挖掘");
    expect(显示节点名("明确需求", false, 团队版字典)).toBe("明确需求");
  });

  it("阶段与进程多收一个可选的后售：进程写后售培育，阶段、结局不变；不给照旧", () => {
    const p = { phase: "线索", node: "潜客培育", result: null };
    expect(阶段与进程(p, 企业版字典, true)).toEqual({ 阶段: "线索", 进程: "后售培育", 结局: null });
    expect(阶段与进程(p, 企业版字典)).toEqual({ 阶段: "线索", 进程: "潜客培育", 结局: null });
    expect(阶段与进程({ phase: "商机", node: "明确需求", result: null }, 企业版字典, true)).toEqual({ 阶段: "商机", 进程: "痛点挖掘", 结局: null });
  });
});

describe("判定式（纯函数，判后售）", () => {
  const 停 = { phase: "线索", node: "潜客培育", result: null, createdAt: new Date("2026-01-01T00:00:00Z") };
  const 结清 = new Date("2026-06-01T00:00:00Z");

  it("客户没有交付结清（undefined）→ 不是；有 → 停在潜客培育的是", () => {
    expect(判后售(停, undefined)).toBe(false);
    expect(判后售(停, 结清)).toBe(true);
    expect(判后售(停, null)).toBe(true);
  });

  it("不是停在潜客培育的不算：线索验证、商机、潜客培育但已线索流失", () => {
    expect(判后售({ ...停, node: "线索验证" }, 结清)).toBe(false);
    expect(判后售({ ...停, phase: "商机", node: "痛点挖掘" }, 结清)).toBe(false);
    expect(判后售({ ...停, result: "线索流失" }, 结清)).toBe(false);
    expect(是停在潜客培育(停)).toBe(true);
    expect(是停在潜客培育({ ...停, result: "线索流失" })).toBe(false);
  });

  it("🔍 老项目现在按「算」（第十一节第 2 条）：结清之前建的也算；改成不算时只认结清之后建的", () => {
    expect(老项目算后售).toBe(true);
    expect(判后售(停, 结清)).toBe(true);
    // 改成「不算」这一支：结清之前建的不算、之后建的算；结清时间缺的（老数据没 closedAt）照算
    expect(判后售(停, 结清, false)).toBe(false);
    expect(判后售({ ...停, createdAt: new Date("2026-07-01T00:00:00Z") }, 结清, false)).toBe(true);
    expect(判后售(停, null, false)).toBe(true);
  });
});

describe("按库判（批量 + 条件版，两条路说同一句话）", () => {
  it("客户有交付结清的项目 → 停在潜客培育的显示后售；别的客户的潜客培育不受影响", async () => {
    await 交付();
    const 新 = await 建();
    const 别的 = await 建({ customerId: 别的客户 });
    await 判(新.id, true);
    await 判(别的.id, false);
    // 库里存的仍是潜客培育
    expect((await raw.project.findUniqueOrThrow({ where: { id: 新.id } })).node).toBe("潜客培育");
  });

  it("旧名「成功交付」也算", async () => {
    await 交付({ result: "成功交付" });
    await 判((await 建()).id, true);
  });

  it("交付结清撤回（回到进行中）→ 同客户新项目回到潜客培育", async () => {
    const 结 = await 交付();
    const 新 = await 建();
    await 判(新.id, true);
    await raw.project.update({ where: { id: 结.id }, data: { result: null, closedAt: null } });
    await 判(新.id, false);
  });

  it("交付结清的项目软删后，同客户新项目回到潜客培育（去掉条件里手写的 deletedAt: null 就红）", async () => {
    const 结 = await 交付();
    const 新 = await 建();
    await raw.project.update({ where: { id: 结.id }, data: { deletedAt: new Date() } });
    await 判(新.id, false);
    expect(交付结清的项目.deletedAt).toBeNull();
  });

  it("只有丢单 / 线索流失 / 异常状态的 → 潜客培育", async () => {
    await 建({ phase: "商机", node: "成交推进", result: "丢单" });
    await 建({ result: "线索流失" });
    await 建({ phase: "订单", node: "安装实施", result: "异常状态" });
    await 建({ phase: "订单", node: "尾款结算" });
    await 判((await 建()).id, false);
  });

  it("仅记录用的项目照样显示后售培育", async () => {
    await 交付();
    await 判((await 建({ source: 仅记录用来源 })).id, true);
  });

  it("🔍 老项目按「算」：结清之前就建好、一直停在潜客培育的也显示后售", async () => {
    const 老 = await 建({ createdAt: new Date("2025-01-01T00:00:00Z") });
    await 交付({ createdAt: new Date("2025-03-01T00:00:00Z"), closedAt: new Date("2026-06-01T00:00:00Z") });
    await 判(老.id, true);
  });

  it("🔍 判定式改成「老项目不算」那一支：条件版只认结清之后建的，没记结清时间的照算；后售 + 不含后售仍不重不漏", async () => {
    const 老 = await 建({ createdAt: new Date("2026-01-01T00:00:00Z") });
    const 新 = await 建({ createdAt: new Date("2026-07-01T00:00:00Z") });
    await 交付({ closedAt: new Date("2026-06-01T00:00:00Z") });
    const 没时间客户的 = await 建({ customerId: 别的客户, createdAt: new Date("2026-01-01T00:00:00Z") });
    await 交付({ customerId: 别的客户, closedAt: null });
    const 后们 = await 看全部(async () => prisma.project.findMany({ where: await 后售条件(prisma, false), select: { id: true } }));
    const 潜们 = await 看全部(async () => prisma.project.findMany({ where: await 潜客不含后售条件(prisma, false), select: { id: true } }));
    expect(后们.map((p) => p.id).sort()).toEqual([新.id, 没时间客户的.id].sort());
    expect(潜们.map((p) => p.id)).toEqual([老.id]);
  });

  it("项目换客户（合并客户 / 改客户）后原客户名下没有交付结清的 → 回到潜客培育；新客户那边的潜客培育变后售", async () => {
    const 结 = await 交付();
    const 原 = await 建();
    const 那边 = await 建({ customerId: 别的客户 });
    await raw.project.update({ where: { id: 结.id }, data: { customerId: 别的客户 } });
    await 判(原.id, false);
    await 判(那边.id, true);
  });

  it("停在线索验证、已转商机的不显示后售（只换潜客培育那一格）", async () => {
    await 交付();
    for (const p of [await 建({ node: "线索验证" }), await 建({ phase: "商机", node: "痛点挖掘" })]) {
      expect(await 批量判(p.id)).toBe(false);
      expect(await 条件判(p.id)).toEqual({ 后: 0, 潜: 0 });
    }
  });

  it("看不到那位客户项目的销售来判，照样认得交付结清（看全部，不受限定层）", async () => {
    const 外人 = (await raw.user.create({ data: { email: "s3", name: "小张", title: "", role: "SALES", password: "x" } })).id;
    await raw.entMember.create({ data: { userId: 外人, bizRole: "sales" } });
    const 他的客户 = (await raw.customer.create({ data: { name: "客户丙", phone: "13800000003", salesOwnerId: 同事 } })).id;
    const 结 = await 交付({ customerId: 他的客户, ownerId: 同事, creatorId: 同事 });
    const 新 = await 建({ customerId: 他的客户, ownerId: 同事, creatorId: 同事 });
    const p = await raw.project.findUniqueOrThrow({ where: { id: 新.id }, select: { id: true, customerId: true, phase: true, node: true, result: true, createdAt: true } });
    // 按组织看客户开着、按这个销售的范围跑（限定层认 以谁的身份）
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting(规则.按组织看客户.key, true);
    await setSetting("business", { ...DEFAULT_BUSINESS, projectMode: true });
    invalidateSettingsCache();
    忘掉企业版范围();
    try {
      await 以谁的身份(外人, async () => {
        // 前提：他在限定层里看不到那两个项目
        expect(await prisma.project.count({ where: { id: { in: [结.id, 新.id] } } })).toBe(0);
        expect((await 交付结清客户们([他的客户])).has(他的客户)).toBe(true);
        expect([...(await 后售项目们([p]))]).toEqual([新.id]);
      });
    } finally {
      vi.unstubAllEnvs();
      忘掉企业版范围();
    }
  });

  it("交付结清客户们：只回有交付结清的客户、值是最早那次结清时间；空列表不查库", async () => {
    await 交付({ closedAt: new Date("2026-06-01T00:00:00Z") });
    await 交付({ closedAt: new Date("2026-02-01T00:00:00Z") });
    const 表 = await 交付结清客户们([客户, 别的客户, 客户]);
    expect([...表.keys()]).toEqual([客户]);
    expect(表.get(客户)?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect((await 交付结清客户们([])).size).toBe(0);
  });
});

describe("批量：几千行一次判、500 位一批", () => {
  it("1200 位客户、一半有交付结清：后售项目们按批判对；条件版后售 + 不含后售 = 停在潜客培育，不重不漏", async () => {
    const 客户们 = Array.from({ length: 1200 }, (_, i) => ({ id: `c-${String(i).padStart(4, "0")}`, name: `客户${i}`, phone: "", salesOwnerId: 我 }));
    await raw.customer.createMany({ data: 客户们 });
    const 项目们 = 客户们.flatMap((c, i) => [
      { id: `p-${c.id}`, name: `新${i}`, customerId: c.id, ownerId: 我, creatorId: 我, phase: "线索", node: "潜客培育" },
      ...(i % 2 === 0 ? [{ id: `d-${c.id}`, name: `结${i}`, customerId: c.id, ownerId: 我, creatorId: 我, phase: "订单", node: "尾款结算", result: "交付结清", closedAt: new Date() }] : []),
    ]);
    await raw.project.createMany({ data: 项目们 });
    const 停的 = await raw.project.findMany({ where: { id: { startsWith: "p-c-" } }, select: { id: true, customerId: true, phase: true, node: true, result: true, createdAt: true } });
    expect(停的.length).toBe(1200);
    const 后 = await 后售项目们(停的);
    expect(后.size).toBe(600);
    expect(后.has("p-c-0000")).toBe(true);
    expect(后.has("p-c-0001")).toBe(false);
    expect(后.has("p-c-1198")).toBe(true);

    const 全 = await 看全部(() => prisma.project.count({ where: 停在潜客培育 }));
    const 后数 = await 看全部(async () => prisma.project.count({ where: await 后售条件() }));
    const 潜数 = await 看全部(async () => prisma.project.count({ where: await 潜客不含后售条件() }));
    expect(全).toBe(1200);
    expect(后数).toBe(600);
    expect(后数 + 潜数).toBe(全);
  });

  it("超过 2000 位客户（公海全取一类）：不点名、扫一遍全部交付结清再留这几位，判得和点名一样；软删的照旧不算", async () => {
    const 客户们 = Array.from({ length: 2100 }, (_, i) => ({ id: `q-${String(i).padStart(4, "0")}`, name: `客户${i}`, phone: "", salesOwnerId: 我 }));
    await raw.customer.createMany({ data: 客户们 });
    await raw.project.createMany({ data: 客户们.flatMap((c, i) => [
      { id: `p-${c.id}`, name: `新${i}`, customerId: c.id, ownerId: 我, creatorId: 我, phase: "线索", node: "潜客培育" },
      ...(i % 3 === 0 ? [{ id: `d-${c.id}`, name: `结${i}`, customerId: c.id, ownerId: 我, creatorId: 我, phase: "订单", node: "尾款结算", result: "交付结清", closedAt: new Date() }] : []),
    ]) });
    // 名单外的客户也有交付结清：扫全部时不能把它带进来
    await 交付();
    await raw.project.update({ where: { id: "d-q-0003" }, data: { deletedAt: new Date() } });
    const 停的 = await raw.project.findMany({ where: { id: { startsWith: "p-q-" } }, select: { id: true, customerId: true, phase: true, node: true, result: true, createdAt: true } });
    const 表 = await 交付结清客户们(停的.map((p) => p.customerId));
    expect(表.size).toBe(699);
    expect(表.has(客户)).toBe(false);
    const 后 = await 后售项目们(停的);
    expect(后.size).toBe(699);
    expect(后.has("p-q-0000")).toBe(true);
    expect(后.has("p-q-0003")).toBe(false);
    expect(后.has("p-q-0001")).toBe(false);
  });
});
