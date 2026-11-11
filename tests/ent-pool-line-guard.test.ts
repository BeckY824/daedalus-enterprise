/**
 * 公海操作按业务线（P-公海-07，X-34）：公海分配、撤销分配、标无效、恢复有效时，销管、条线总管理只能动本业务线的客户和项目；系统管理员不限。
 * 客户 / 项目算哪条线：先看业务线标签；标签空按放进公海的历史负责人（pool-release 的 from）判；标签空又没历史的放行。
 * 批量混了别线的：整批不做，提示点名哪几个不是本线。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 不设配额key } from "@/lib/enterprise/lead-assign";
import { 回收站副手键 } from "@/lib/enterprise/org";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 标无效客户, 恢复有效客户, 分配公海项目, 撤销公海项目 } from "@/app/(app)/pool/actions";
import { 改项目 } from "@/lib/project/db";
import { 公海分配候选 } from "@/lib/owners";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 系统管理员: 人, 内贸销管: 人, 外贸条线: 人, 内贸销售: 人, 外贸销售: 人, 没线销售: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string, line: string | null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };

let 序号 = 0;
/**
 * 客户公海里的客户：负责人清空成占位账号（M-公海-03）；标签 = bizLine；放的人 = 记一条 pool-release（from = 放的人），不给 = 没历史
 */
const 公海客户 = async (o: { 标签?: string | null; 放的人?: 人 | null; 无效?: boolean } = {}) => {
  序号 += 1;
  const 占位 = await 无负责人占位Id(prisma);
  const c = await prisma.customer.create({
    data: { name: `公海客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: 占位, bizLine: o.标签 ?? null, ...(o.无效 ? { poolInvalidAt: new Date() } : {}) },
  });
  await prisma.customerPool.create({ data: { customerId: c.id, reason: "手动", userId: o.放的人?.id ?? null } });
  if (o.放的人) await prisma.customerOwnerLog.create({ data: { customerId: c.id, userId: o.放的人.id, fromOwnerId: o.放的人.id, toOwnerId: 占位, kind: "pool-release" } });
  return c;
};
/** 线索公海里的项目（客户不在客户公海，归 内贸销售）：负责人清空；标签 = bizLine；放的人 = 记一条项目 pool-release */
const 公海项目 = async (o: { 标签?: string | null; 放的人?: 人 | null } = {}) => {
  序号 += 1;
  const c = await prisma.customer.create({ data: { name: `客户${序号}`, phone: `138${String(序号).padStart(8, "0")}`, salesOwnerId: 内贸销售.id } });
  const p = await prisma.project.create({ data: { name: `公海项目${序号}`, customerId: c.id, ownerId: "", creatorId: 内贸销售.id, pooledAt: new Date(), bizLine: o.标签 ?? null } });
  if (o.放的人) {
    await prisma.projectNodeLog.create({
      data: { projectId: p.id, userId: o.放的人.id, kind: "pool-release", fromOwnerId: o.放的人.id, toOwnerId: null, fromPhase: "线索", fromNode: "", toPhase: "线索", toNode: "" },
    });
  }
  return p;
};
const 在公海 = async (id: string) => !!(await prisma.customerPool.findUnique({ where: { customerId: id } }));
const 无效了 = async (id: string) => !!(await prisma.customer.findUniqueOrThrow({ where: { id } })).poolInvalidAt;
const 项目在公海 = async (id: string) => !!(await prisma.project.findUniqueOrThrow({ where: { id } })).pooledAt;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  序号 = 0;
  系统管理员 = await 造人("dir", "系统管理员", "ADMIN", "director", null);
  内贸销管 = await 造人("nm", "内贸销管", "SALES", "sales_mgr", "内贸");
  外贸条线 = await 造人("wd", "外贸条线", "SALES", "director", "外贸");
  内贸销售 = await 造人("ns", "内贸销售", "SALES", "sales", "内贸");
  外贸销售 = await 造人("ws", "外贸销售", "SALES", "sales", "外贸");
  没线销售 = await 造人("xs", "没线销售", "SALES", "sales", null);
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(不设配额key, true);
  // 内贸销管兼回收站副手：恢复有效也得按线
  await setSetting(回收站副手键, [内贸销管.id]);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("公海分配按线（客户）", () => {
  it("销管分本线（标签内贸）成功；分别线（标签外贸）被拦、还在公海、提示点名", async () => {
    const 本 = await 公海客户({ 标签: "内贸" });
    const 别 = await 公海客户({ 标签: "外贸" });
    expect(await 以(内贸销管, () => 分配公海([本.id], 内贸销售.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 在公海(本.id)).toBe(false);
    const r = await 以(内贸销管, () => 分配公海([别.id], 内贸销售.id));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining(`「${别.name}」不是内贸线的`) });
    expect(await 在公海(别.id)).toBe(true);
  });

  it("批量混了别线的：整批不分（本线那位也留在公海），提示只点名别线的", async () => {
    const 本 = await 公海客户({ 标签: "内贸" });
    const 别 = await 公海客户({ 标签: "外贸" });
    const r = await 以(内贸销管, () => 分配公海([本.id, 别.id], 内贸销售.id));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain(别.name);
      expect(r.error).not.toContain(`「${本.name}」`);
      expect(r.error).toContain("整批没有分配");
    }
    expect(await 在公海(本.id)).toBe(true);
    expect(await 在公海(别.id)).toBe(true);
  });

  it("标签空：按放进公海的历史负责人判线（外贸的人放进来的算外贸）", async () => {
    const 外贸放的 = await 公海客户({ 放的人: 外贸销售 });
    const 内贸放的 = await 公海客户({ 放的人: 内贸销售 });
    expect(await 以(内贸销管, () => 分配公海([外贸放的.id], 内贸销售.id))).toMatchObject({ ok: false, error: expect.stringContaining("不是内贸线的") });
    expect(await 在公海(外贸放的.id)).toBe(true);
    expect(await 以(内贸销管, () => 分配公海([内贸放的.id], 内贸销售.id))).toMatchObject({ ok: true, updated: 1 });
    // 外贸条线总管理：反过来
    const 又一个内贸放的 = await 公海客户({ 放的人: 内贸销售 });
    expect(await 以(外贸条线, () => 分配公海([又一个内贸放的.id], 外贸销售.id))).toMatchObject({ ok: false, error: expect.stringContaining("不是外贸线的") });
    const 又一个外贸放的 = await 公海客户({ 放的人: 外贸销售 });
    expect(await 以(外贸条线, () => 分配公海([又一个外贸放的.id], 外贸销售.id))).toMatchObject({ ok: true, updated: 1 });
  });

  it("标签空、没有放公海历史：放行（内贸、外贸的都能分）", async () => {
    const a = await 公海客户();
    const b = await 公海客户();
    expect(await 以(内贸销管, () => 分配公海([a.id], 内贸销售.id))).toMatchObject({ ok: true, updated: 1 });
    expect(await 以(外贸条线, () => 分配公海([b.id], 外贸销售.id))).toMatchObject({ ok: true, updated: 1 });
  });

  it("系统管理员不限线；自己没设业务线的销管也不限（同 公海分不给话）", async () => {
    const 外 = await 公海客户({ 标签: "外贸" });
    const 内 = await 公海客户({ 标签: "内贸" });
    expect(await 以(系统管理员, () => 分配公海([外.id, 内.id], 没线销售.id))).toMatchObject({ ok: true, updated: 2 });
  });
});

describe("接手人跨业务线（P-转-08）：限的是动哪条线的，不是分给谁", () => {
  it("销管把本线公海客户、本线公海项目分给别线的销售、没设线的销售：成功", async () => {
    const 客 = await 公海客户({ 标签: "内贸" });
    expect(await 以(内贸销管, () => 分配公海([客.id], 外贸销售.id))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客.id } })).salesOwnerId).toBe(外贸销售.id);
    const 客2 = await 公海客户({ 标签: "内贸" });
    expect(await 以(内贸销管, () => 分配公海([客2.id], 没线销售.id))).toMatchObject({ ok: true, updated: 1 });
    const 项 = await 公海项目({ 标签: "内贸" });
    expect(await 以(内贸销管, () => 分配公海项目([项.id], 外贸销售.id))).toMatchObject({ ok: true, 分到: [项.id] });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 项.id } })).ownerId).toBe(外贸销售.id);
  });

  it("别线的公海客户、项目照旧动不了（P-公海-07），分给哪条线的人都一样", async () => {
    const 别 = await 公海客户({ 标签: "外贸" });
    expect(await 以(内贸销管, () => 分配公海([别.id], 外贸销售.id))).toMatchObject({ ok: false, error: expect.stringContaining("不是内贸线的") });
    expect(await 在公海(别.id)).toBe(true);
    const 别项 = await 公海项目({ 标签: "外贸" });
    expect(await 以(内贸销管, () => 分配公海项目([别项.id], 外贸销售.id))).toMatchObject({ ok: false });
    expect(await 项目在公海(别项.id)).toBe(true);
  });

  it("接手人是只读管理员、停用的、没业务角色的：照拦；下拉里也没有他们，别线的销售在", async () => {
    const 只读 = await 造人("ro", "只读管理员", "ADMIN", "admin", null);
    const 没角色 = await 造人("nr", "没角色", "SALES", "", "外贸");
    const 停用 = await 造人("off", "停用销售", "SALES", "sales", "外贸");
    await prisma.user.update({ where: { id: 停用.id }, data: { active: false } });
    忘掉企业版范围();
    for (const 给 of [只读, 没角色, 停用]) {
      const c = await 公海客户({ 标签: "内贸" });
      expect(await 以(内贸销管, () => 分配公海([c.id], 给.id))).toMatchObject({ ok: false });
      expect(await 在公海(c.id)).toBe(true);
      const p = await 公海项目({ 标签: "内贸" });
      expect(await 以(内贸销管, () => 分配公海项目([p.id], 给.id))).toMatchObject({ ok: false });
    }
    const 候选 = (await 以(内贸销管, () => 公海分配候选(内贸销管))).map((u) => u.id);
    expect(候选).toEqual(expect.arrayContaining([内贸销售.id, 外贸销售.id, 没线销售.id]));
    for (const 不该 of [只读, 没角色, 停用]) expect(候选).not.toContain(不该.id);
  });
});

describe("撤销分配按线", () => {
  it("销管撤自己刚分的本线客户成功；别线的（系统管理员分出去的）撤不了、提示点名", async () => {
    const 本 = await 公海客户({ 标签: "内贸" });
    const r = await 以(内贸销管, () => 分配公海([本.id], 内贸销售.id));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 不套 以谁的身份：撤销里「还归给谁」那一查走范围，这里没配组织架构（分到的销售不是他下属），套了会查不到（和按线无关）
    mocks.user = { ...内贸销管 };
    const 撤 = await 撤销公海("分配", r.原负责人!, r.带过来, r.给谁!.id, r.公海项目);
    expect(撤).toMatchObject({ ok: true, updated: 1 });
    expect(await 在公海(本.id)).toBe(true);

    const 别 = await 公海客户({ 标签: "外贸" });
    const r2 = await 以(系统管理员, () => 分配公海([别.id], 内贸销售.id));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const 撤2 = await 以(内贸销管, () => 撤销公海("分配", r2.原负责人!, r2.带过来, r2.给谁!.id, r2.公海项目));
    expect(撤2).toMatchObject({ ok: false, error: expect.stringContaining(`「${别.name}」不是内贸线的`) });
    expect(await 在公海(别.id)).toBe(false);
  });

  it("项目：撤分配别线的项目被拦", async () => {
    const 别 = await 公海项目({ 标签: "外贸" });
    expect(await 以(系统管理员, () => 分配公海项目([别.id], 内贸销售.id))).toMatchObject({ ok: true, 分到: [别.id] });
    expect(await 以(内贸销管, () => 撤销公海项目("分配", [别.id], 内贸销售.id))).toMatchObject({ ok: false, error: expect.stringContaining(`项目「${别.name}」`) });
    expect(await 项目在公海(别.id)).toBe(false);
  });
});

describe("标无效按线", () => {
  it("销管标本线成功；别线被拦；批量混了别线整批不标", async () => {
    const 本 = await 公海客户({ 标签: "内贸" });
    const 别 = await 公海客户({ 标签: "外贸" });
    expect(await 以(内贸销管, () => 标无效客户([别.id]))).toMatchObject({ ok: false, error: expect.stringContaining("不是内贸线的") });
    expect(await 以(内贸销管, () => 标无效客户([本.id, 别.id]))).toMatchObject({ ok: false, error: expect.stringContaining("整批没有标无效") });
    expect(await 无效了(本.id)).toBe(false);
    expect(await 无效了(别.id)).toBe(false);
    expect(await 以(内贸销管, () => 标无效客户([本.id]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 无效了(本.id)).toBe(true);
    // 系统管理员不限
    expect(await 以(系统管理员, () => 标无效客户([别.id]))).toMatchObject({ ok: true, updated: 1 });
  });
});

describe("恢复有效按线", () => {
  it("设了业务线的回收站副手恢复本线成功、别线被拦；系统管理员不限", async () => {
    const 本 = await 公海客户({ 标签: "内贸", 无效: true });
    const 别 = await 公海客户({ 放的人: 外贸销售, 无效: true });
    expect(await 以(内贸销管, () => 恢复有效客户([本.id, 别.id]))).toMatchObject({ ok: false, error: expect.stringContaining("整批没有恢复") });
    expect(await 无效了(本.id)).toBe(true);
    expect(await 以(内贸销管, () => 恢复有效客户([本.id]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 无效了(本.id)).toBe(false);
    expect(await 以(系统管理员, () => 恢复有效客户([别.id]))).toMatchObject({ ok: true, updated: 1 });
  });
});

describe("公海分配按线（项目）", () => {
  it("分配公海项目：本线成功、别线被拦；标签空按项目放公海历史；没历史放行", async () => {
    const 本 = await 公海项目({ 标签: "内贸" });
    const 别 = await 公海项目({ 标签: "外贸" });
    const 外贸放的 = await 公海项目({ 放的人: 外贸销售 });
    const 没历史 = await 公海项目();
    expect(await 以(内贸销管, () => 分配公海项目([本.id], 内贸销售.id))).toMatchObject({ ok: true, 分到: [本.id] });
    expect(await 以(内贸销管, () => 分配公海项目([别.id], 内贸销售.id))).toMatchObject({ ok: false, error: expect.stringContaining(`项目「${别.name}」`) });
    expect(await 以(内贸销管, () => 分配公海项目([外贸放的.id], 内贸销售.id))).toMatchObject({ ok: false });
    expect(await 项目在公海(外贸放的.id)).toBe(true);
    expect(await 以(内贸销管, () => 分配公海项目([没历史.id], 内贸销售.id))).toMatchObject({ ok: true, 分到: [没历史.id] });
  });

  it("项目详情改负责人（公海里的项目）同样按线拦", async () => {
    const 别 = await 公海项目({ 标签: "外贸" });
    const r = await 以(内贸销管, () => 改项目(内贸销管, 别.id, { ownerId: 内贸销售.id }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("不是内贸线的") });
    expect(await 项目在公海(别.id)).toBe(true);
  });

  it("公海页同时勾客户行和项目行：项目行是别线的，整批不分", async () => {
    const 客 = await 公海客户({ 标签: "内贸" });
    const 别 = await 公海项目({ 标签: "外贸" });
    expect(await 以(内贸销管, () => 分配公海([客.id], 内贸销售.id, undefined, [别.id]))).toMatchObject({ ok: false, error: expect.stringContaining(`项目「${别.name}」`) });
    expect(await 在公海(客.id)).toBe(true);
    expect(await 项目在公海(别.id)).toBe(true);
  });
});
