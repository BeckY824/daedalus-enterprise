/**
 * 客户档案「客户分配」（Customer.assignWay，字典 custAssign）系统自动写（11-17，customer-assign-way.ts）：
 * 市场交给销售 → 非自持（只补空）；客户出客户公海归销售 → 公海领取（覆盖）；销售自己建档 → 自持（只补空）。
 * 撤销按原样还（P-撤销-01）。项目上的「分配方式」不跟客户走（客户 11-17 Q3）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 分配线索, 自动分配线索, 撤销自动分配, type 自动分配结果 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key } from "@/lib/enterprise/lead-assign";
import { assignSalesOwner, saveCustomer, 撤销改负责人 } from "@/app/(app)/customers/actions";
import { 领取, 撤销公海, 分配公海 } from "@/app/(app)/customers/pool-actions";
import { 领取公海项目 } from "@/lib/project/db";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 企业字典 } from "@/lib/enterprise/dict";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人, 市场: 人, 甲: 人, 乙: 人, 丙: 人;
const 造人 = async (key: string, name: string, role: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
let 序号 = 0;
const 客户 = async (ownerId: string, assignWay: string | null = null) =>
  (await prisma.customer.create({ data: { name: `客户${++序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId, assignWay } })).id;
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: `项目${++序号}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
const 分配of = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c }, select: { assignWay: true } })).assignWay;
const 方式of = async (p: string) => (await prisma.project.findUniqueOrThrow({ where: { id: p }, select: { assignMode: true } })).assignMode;
const 成了 = (r: 自动分配结果) => { if (!r.ok) throw new Error(r.error); return r; };
const 只留参与 = async (...们: 人[]) => {
  const 全部 = await prisma.entMember.findMany({ select: { userId: true } });
  await setSetting(自动分配不参与key, 全部.map((x) => x.userId).filter((id) => !们.some((u) => u.id === id)));
  invalidateSettingsCache();
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  市场 = await 造人("mkt", "市场同事", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales");
  乙 = await 造人("yi", "销售乙某", "SALES", "sales");
  丙 = await 造人("bing", "销售丙某", "SALES", "sales");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("市场交给销售：客户分配空着补「非自持」，已有值不改", () => {
  it("分配线索（指定）：补非自持；项目分配方式照旧是这次的指定分配，不跟客户", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 别的 = await 项目(c, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 分配of(c)).toBe("非自持");
    expect(await 方式of(别的)).toBe("指定分配");
  });

  it("已有值（自持 / 公海领取）不覆盖", async () => {
    for (const 原 of ["自持", "公海领取"]) {
      const c = await 客户(市场.id, 原);
      const p = await 项目(c, 市场.id);
      expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
      expect(await 分配of(c)).toBe(原);
    }
  });

  it("自动分配：补非自持；撤销自动分配还成空", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const r = 成了(await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id })));
    expect(await 分配of(c)).toBe("非自持");
    expect(await 以(市场, () => 撤销自动分配(p, JSON.parse(JSON.stringify(r.还原))))).toEqual({ ok: true });
    expect(await 分配of(c)).toBeNull();
  });

  it("自动分配撤销：客户分配原来就有值的，撤销不清掉", async () => {
    await 只留参与(甲);
    const c = await 客户(市场.id, "自持");
    const p = await 项目(c, 市场.id);
    const r = 成了(await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id })));
    expect(await 以(市场, () => 撤销自动分配(p, r.还原))).toEqual({ ok: true });
    expect(await 分配of(c)).toBe("自持");
  });

  it("市场在客户层转给销售（批量转）：补非自持；撤销改负责人还成空", async () => {
    const c = await 客户(市场.id);
    await 项目(c, 市场.id);
    const r = await 以(市场, () => assignSalesOwner([c], 甲.id));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(await 分配of(c)).toBe("非自持");
    if (!r.ok) throw new Error("没转成");
    expect(r.带过来?.补分配).toEqual([c]);
    expect(await 以(市场, () => 撤销改负责人(r.原值 ?? [], 甲.id, r.带过来))).toMatchObject({ ok: true, updated: 1 });
    expect(await 分配of(c)).toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(市场.id);
  });

  it("撤销时这一格已被人手改过：不动", async () => {
    const c = await 客户(市场.id);
    const r = await 以(市场, () => assignSalesOwner([c], 甲.id));
    if (!r.ok) throw new Error("没转成");
    await prisma.customer.update({ where: { id: c }, data: { assignWay: "自持" } });
    await 以(市场, () => 撤销改负责人(r.原值 ?? [], 甲.id, r.带过来));
    expect(await 分配of(c)).toBe("自持");
  });

  it("销售转销售（不是市场交给销售）：不写", async () => {
    const c = await 客户(乙.id);
    expect(await 以(总管, () => assignSalesOwner([c], 甲.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 分配of(c)).toBeNull();
  });

  it("销售自己领线索公海项目、客户还在市场手里（P-公海-11）：客户归销售，补非自持", async () => {
    const c = await 客户(市场.id);
    await prisma.customerCreator.create({ data: { customerId: c, userId: 市场.id } });
    const p = await 项目(c, 市场.id, { pooledAt: new Date(), phase: "线索" });
    expect(await 以(甲, () => 领取公海项目(甲, p, true))).toEqual({ ok: true });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(甲.id);
    expect(await 分配of(c)).toBe("非自持");
  });

  it("字典里「非自持」改了名：写改后的叫法；停用了不写", async () => {
    await 企业字典("custAssign");
    await prisma.entDictItem.update({ where: { id: "dict-custAssign-1" }, data: { name: "市场分配" } });
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 分配of(c)).toBe("市场分配");

    await prisma.entDictItem.update({ where: { id: "dict-custAssign-1" }, data: { active: false } });
    const c2 = await 客户(市场.id);
    const p2 = await 项目(c2, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: p2, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 分配of(c2)).toBeNull();
  });

  it("不是企业版：不写", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    忘掉企业版范围();
    const c = await 客户(乙.id);
    expect(await 以(总管, () => assignSalesOwner([c], 甲.id))).toMatchObject({ ok: true });
    expect(await 分配of(c)).toBeNull();
  });
});

describe("出客户公海归销售：记「公海领取」，原值盖掉，撤销还回原值", () => {
  const 公海客户 = async (原: string | null) => {
    const c = await 客户(乙.id, 原);
    await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    return c;
  };

  it("销售领取：盖成公海领取；撤销领取还回非自持", async () => {
    const c = await 公海客户("非自持");
    const r = await 以(丙, () => 领取([c]));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(await 分配of(c)).toBe("公海领取");
    if (!r.ok) throw new Error("没领成");
    expect(r.原负责人).toEqual([{ id: c, 值: 乙.id, 分: "非自持" }]);
    // 浏览器带回来的（过一遍 JSON）
    expect(await 以(丙, () => 撤销公海("领取", JSON.parse(JSON.stringify(r.原负责人)), r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 分配of(c)).toBe("非自持");
  });

  it("原来空着：领取记公海领取，撤销还成空", async () => {
    const c = await 公海客户(null);
    const r = await 以(丙, () => 领取([c]));
    expect(await 分配of(c)).toBe("公海领取");
    if (!r.ok) throw new Error("没领成");
    await 以(丙, () => 撤销公海("领取", r.原负责人 ?? [], r.带过来, undefined, r.公海项目));
    expect(await 分配of(c)).toBeNull();
  });

  it("撤销时带回来的原值不在字典里：不还，留公海领取", async () => {
    const c = await 公海客户("非自持");
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error("没领成");
    await 以(丙, () => 撤销公海("领取", [{ id: c, 值: 乙.id, 分: "乱填的" }], r.带过来, undefined, r.公海项目));
    expect(await 分配of(c)).toBe("公海领取");
  });

  it("总管理分配公海：同样记公海领取", async () => {
    const c = await 公海客户("自持");
    expect(await 以(总管, () => 分配公海([c], 丙.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 分配of(c)).toBe("公海领取");
  });

  it("总管理分客户公海里客户的项目（P-公海-10 整包出公海）：记公海领取，整包撤销单带着原值", async () => {
    const c = await 公海客户("非自持");
    const p = await 项目(c, 乙.id, { pooledAt: new Date(), phase: "线索", ownerId: "" });
    const r = await 以(总管, () => 分配公海项目([p], 丙.id));
    expect(r).toMatchObject({ ok: true, 分到: [p] });
    expect(await 分配of(c)).toBe("公海领取");
    expect((r as { 整包?: { 原: unknown[] } }).整包?.原).toEqual([{ id: c, 值: 乙.id, 分: "非自持" }]);
  });
});

describe("销售自己建档：记「自持」，只补空", () => {
  const 入参 = (salesOwnerId: string, 改: Record<string, unknown> = {}) => ({
    name: `新客户${++序号}`, phone: `137${String(序号).padStart(8, "0")}`, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId, channelId: null, referrerCustomerId: null, 企业资料: { bizLine: "内贸" }, ...改,
  }) as Parameters<typeof saveCustomer>[0];

  it("销售建在自己名下：自持", async () => {
    const r = await 以(甲, () => saveCustomer(入参(甲.id)));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok || !("id" in r)) throw new Error("没建成");
    expect(await 分配of(r.id as string)).toBe("自持");
  });

  it("表单里已经选了：不改", async () => {
    const r = await 以(甲, () => saveCustomer(入参(甲.id, { 企业资料: { bizLine: "内贸", assignWay: "非自持" } })));
    if (!r.ok || !("id" in r)) throw new Error("没建成");
    expect(await 分配of(r.id as string)).toBe("非自持");
  });

  it("市场成员建档：不写（交给销售时再补非自持）", async () => {
    const r = await 以(市场, () => saveCustomer(入参(市场.id)));
    if (!r.ok || !("id" in r)) throw new Error("没建成");
    expect(await 分配of(r.id as string)).toBeNull();
  });

  it("总管理建给别人：不写", async () => {
    const r = await 以(总管, () => saveCustomer(入参(甲.id)));
    if (!r.ok || !("id" in r)) throw new Error("没建成");
    expect(await 分配of(r.id as string)).toBeNull();
  });
});
