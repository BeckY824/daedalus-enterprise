/**
 * 项目进出公海重算客户状态（11-25，B37「公海不动，随领取和项目变动自然落库」、M-状态-01「按项目变动自然更新」）：
 * 「在推项目优先」认的在推 = 没结局、不在公海，项目一进一出公海，客户状态就该跟着变，同一笔事务里落库（cust-status-auto-db.ts 进出公海重算）。
 *   - 领取线索公海里的项目（单个）：名下一条流失线索 + 刚领回的在推线索 → 流失变潜在；放回公海 → 变回流失
 *   - 超时回收回公海：潜在变流失
 *   - 批量分配线索公海里的项目（公海页项目行，总管理分给销售）：几位客户一起从流失变潜在
 *   - 领取客户公海里的客户（名下公海项目一起带出来）→ 潜在；撤销这次领取（项目回公海）→ 流失
 *   - 不是企业版：不算、不改
 * 撤销按原样回滚（审查 11-25，P-撤销-01）：撤销领取 / 分配 / 放进公海，客户状态还回动手前存的值（撤销条带回的 状），不按撤完的项目现算：
 *   - 零项目存「成交」、存「潜在」只有一条流失线索（M-状态-01 不修那类）、存的和现算不一样的：撤销后都回原值
 *   - 撤销条带的 状 不认得：不写它，照旧重算；名下没有活项目（没删、没结局）的进出公海不重算、不清空；没被领的公海客户不动
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
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 放回公海, 领取公海项目, 公海超时收回 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 领取, 撤销公海, 放进公海 } from "@/app/(app)/customers/pool-actions";
import { 分配公海项目, 撤销公海项目 } from "@/app/(app)/pool/actions";
import { assignSalesOwner, 撤销改负责人 } from "@/app/(app)/customers/actions";
import { 进出公海重算, 重算客户状态 } from "@/lib/enterprise/cust-status-auto-db";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人;
let 甲: 人;
let 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };

let 序号 = 0;
/** 企业版客户的号记在主要联系人上（放回公海查联系方式按联系人的号判） */
const 客户 = async (ownerId: string, custStatus: string | null = null) => {
  序号 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序号}`, phone: "", salesOwnerId: ownerId, custStatus, contacts: { create: { name: `联系人${序号}`, phone: `139${String(序号).padStart(8, "0")}`, isPrimary: true } } } })).id;
};
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) => {
  序号 += 1;
  return (await prisma.project.create({ data: { name: `项目${序号}`, customerId, ownerId, creatorId: ownerId || 甲.id, phase: "线索", node: "潜客培育", ...extra } })).id;
};
/** 甲放回线索公海的在推线索（负责人清空，原负责人记在 pool-release 上） */
const 公海线索 = async (customerId: string) => {
  const id = await 项目(customerId, "", { pooledAt: new Date(Date.now() - 86400_000) });
  await prisma.projectNodeLog.create({ data: { projectId: id, userId: 甲.id, kind: "pool-release", fromOwnerId: 甲.id, toOwnerId: null, toPhase: "线索", toNode: "潜客培育", at: new Date(Date.now() - 86400_000) } });
  return id;
};
/** 名下一条流失线索（甲的，已结束）+ 一条线索公海里的在推线索：库里存的是「流失」（在推的在公海，不算在推） */
const 流失客户 = async () => {
  const c = await 客户(甲.id, "流失");
  await 项目(c, 甲.id, { result: "线索流失" });
  const 公 = await 公海线索(c);
  return { c, 公 };
};
const 状态 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id }, select: { custStatus: true } })).custStatus;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales");
  丙 = await 造人("bing", "销售丙某", "SALES", "sales");
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("线索公海里的项目：领取 / 放回 / 超时回收", () => {
  it("领取：名下一条流失线索 + 刚领回的在推线索，流失变潜在；放回公海变回流失", async () => {
    const { c, 公 } = await 流失客户();
    // 起点：按新规则现算也是流失（在推的那条在公海里）
    expect(await 重算客户状态(prisma, [c])).toBe(0);
    expect(await 以(丙, () => 领取公海项目(丙, 公))).toEqual({ ok: true });
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(丙, () => 放回公海(丙, 公))).toEqual({ ok: true });
    expect(await 状态(c)).toBe("流失");
  });

  it("超时回收回公海：潜在变流失", async () => {
    const 今 = new Date("2026-10-26T10:00:00+08:00");
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    invalidateSettingsCache();
    const c = await 客户(甲.id, "潜在");
    await 项目(c, 甲.id, { result: "线索流失" });
    await 项目(c, 丙.id, { createdAt: new Date(今.getTime() - 10 * 86400_000) });
    expect(await 以(丙, () => 公海超时收回(丙, 今))).toBe(1);
    expect(await 状态(c)).toBe("流失");
  });
});

describe("批量分配线索公海里的项目", () => {
  it("总管理一次分 3 个（3 位客户）给销售：都从流失变潜在", async () => {
    const 们 = [await 流失客户(), await 流失客户(), await 流失客户()];
    const r = await 以(总管, () => 分配公海项目(们.map((x) => x.公), 丙.id));
    expect(r).toMatchObject({ ok: true, 分到: 们.map((x) => x.公) });
    for (const x of 们) expect(await 状态(x.c)).toBe("潜在");
  });
});

describe("客户公海：领取客户连名下公海项目，撤销反向", () => {
  it("领取 → 潜在；撤销这次领取（项目回公海）→ 流失", async () => {
    const { c, 公 } = await 流失客户();
    await prisma.customerPool.create({ data: { customerId: c, userId: 甲.id, reason: "手动" } });
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(1);
    expect(r.公海项目).toEqual([公]);
    expect(await 状态(c)).toBe("潜在");
    const 撤 = await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目));
    expect(撤).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 公 } })).pooledAt).not.toBeNull();
    expect(await 状态(c)).toBe("流失");
  });
});

describe("开关", () => {
  it("不是企业版：进出公海重算不算、不改", async () => {
    const { c, 公 } = await 流失客户();
    await prisma.project.update({ where: { id: 公 }, data: { pooledAt: null } });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 进出公海重算(prisma, [c])).toBe(0);
    expect(await 状态(c)).toBe("流失");
    vi.stubEnv("CRM_ENTERPRISE", "1");
    expect(await 进出公海重算(prisma, [c])).toBe(1);
    expect(await 状态(c)).toBe("潜在");
  });
});

describe("撤销还回原值（审查 11-25）", () => {
  /** 客户放进客户公海（原负责人甲放的，老数据） */
  const 进客户公海 = (c: string) => prisma.customerPool.create({ data: { customerId: c, userId: 甲.id, reason: "手动" } });
  /** 存「意向」（导入带的，和现算不一样）、名下一条流失线索 + 一条线索公海里的在推线索 */
  const 存意向的 = async () => {
    const c = await 客户(甲.id, "意向");
    await 项目(c, 甲.id, { result: "线索流失" });
    const 公 = await 公海线索(c);
    return { c, 公 };
  };

  it("零项目的公海客户存「成交」：领取（补潜客培育）→ 潜在；撤销 → 回到「成交」", async () => {
    const c = await 客户(甲.id, "成交");
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(r.带过来?.培育?.length).toBe(1);
    expect(await 状态(c)).toBe("潜在");
    expect(r.原负责人).toEqual([expect.objectContaining({ id: c, 状: "成交" })]);
    expect(await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
    expect(await 状态(c)).toBe("成交");
  });

  it("存「潜在」、名下只有一条流失线索的公海客户：领取再撤销，仍是「潜在」", async () => {
    const c = await 客户(甲.id, "潜在");
    await 项目(c, 甲.id, { result: "线索流失" });
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(1);
    expect(await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("潜在");
  });

  it("客户公海领取：存的和现算不一样（意向）→ 领取后潜在，撤销回到「意向」，不是现算的流失", async () => {
    const { c } = await 存意向的();
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("意向");
  });

  it("撤销条里带不认得的 状：不写这个值，照旧按项目重算", async () => {
    const { c } = await 存意向的();
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    const 改过 = r.原负责人!.map((x) => ({ ...x, 状: "随便写的" }));
    expect(await 以(丙, () => 撤销公海("领取", 改过, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    // 不是「随便写的」，也不是原值「意向」：项目回了公海，按剩下的现算 = 流失
    expect(await 状态(c)).toBe("流失");
  });

  it("老撤销条（没带 状）：照旧按项目重算", async () => {
    const { c } = await 存意向的();
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    const 老 = r.原负责人!.map(({ 状: _状, ...x }) => x);
    expect(await 以(丙, () => 撤销公海("领取", 老, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("流失");
  });

  it("撤销放进公海：回到进公海前存的值", async () => {
    // 存「意向」，名下一条流失线索 + 甲自己在推的线索：放进去在推的进线索公海，现算变流失；撤销回「意向」（现算会是潜在）
    const c = await 客户(甲.id, "意向");
    await 项目(c, 甲.id, { result: "线索流失" });
    const 推 = await 项目(c, 甲.id);
    const r = await 以(甲, () => 放进公海([c], "客户主动终止"));
    if (!r.ok) throw new Error(r.error);
    expect(r.公海项目).toEqual([推]);
    expect(await 状态(c)).toBe("流失");
    expect(r.原负责人).toEqual([{ id: c, 值: "", 状: "意向" }]);
    expect(await 以(甲, () => 撤销公海("放进", r.原负责人!, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 推 } })).pooledAt).toBeNull();
    expect(await 状态(c)).toBe("意向");
  });

  it("项目级撤销领取（公海页只勾项目行）：回到原值", async () => {
    const { c, 公 } = await 存意向的();
    const r = await 以(丙, () => 领取([], undefined, [公]));
    if (!r.ok) throw new Error(r.error);
    expect(r.项目?.领到).toEqual([公]);
    expect(r.项目?.原状态).toEqual([{ id: c, 状: "意向" }]);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(丙, () => 撤销公海项目("领取", [公], undefined, undefined, r.项目?.原状态))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 公 } })).pooledAt).not.toBeNull();
    expect(await 状态(c)).toBe("意向");
  });

  it("项目级撤销分配（总管理分项目行）：回到原值；原状态里塞别的客户不认", async () => {
    const { c, 公 } = await 存意向的();
    const 旁 = await 客户(甲.id, "交付");
    const r = await 以(总管, () => 分配公海项目([公], 丙.id));
    if (!r.ok) throw new Error(r.error);
    expect(r.原状态).toEqual([{ id: c, 状: "意向" }]);
    expect(await 状态(c)).toBe("潜在");
    const 塞 = [...r.原状态!, { id: 旁, 状: "流失" }];
    expect(await 以(总管, () => 撤销公海项目("分配", [公], 丙.id, r.整包, 塞))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("意向");
    expect(await 状态(旁)).toBe("交付");
  });

  it("撤销批量改负责人（一起带出线索公海的项目放回去）：回到原值", async () => {
    const { c, 公 } = await 存意向的();
    const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
    if (!r.ok) throw new Error(r.error);
    expect(r.带过来?.公海项目).toEqual([公]);
    expect(r.原值).toEqual([{ id: c, 值: 甲.id, 状: "意向" }]);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(总管, () => 撤销改负责人(r.原值!, 丙.id, r.带过来))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 公 } })).pooledAt).not.toBeNull();
    expect(await 状态(c)).toBe("意向");
  });

  it("名下没有活项目（没删、没结局）：进出公海重算不动、不清空", async () => {
    const 零 = await 客户(甲.id, "成交");
    const 只流失 = await 客户(甲.id, "潜在");
    await 项目(只流失, 甲.id, { result: "线索流失" });
    const 删了 = await 客户(甲.id, "意向");
    await 项目(删了, 甲.id, { deletedAt: new Date() });
    expect(await 进出公海重算(prisma, [零, 只流失, 删了])).toBe(0);
    expect(await 状态(零)).toBe("成交");
    expect(await 状态(只流失)).toBe("潜在");
    expect(await 状态(删了)).toBe("意向");
    // 有活项目的照算（在公海里没结局的也算活项目）
    const { c } = await 存意向的();
    expect(await 进出公海重算(prisma, [c])).toBe(1);
    expect(await 状态(c)).toBe("流失");
  });

  it("没被领取的公海客户不受影响（领取、撤销都不动它）", async () => {
    const { c } = await 存意向的();
    const 旁 = await 存意向的();
    await 进客户公海(c);
    await 进客户公海(旁.c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(await 状态(旁.c)).toBe("意向");
    // 撤销条里塞了没领的那位：不认（不是这次领到的）
    expect(await 以(丙, () => 撤销公海("领取", [...r.原负责人!, { id: 旁.c, 值: 甲.id, 状: "成交" }], r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("意向");
    expect(await 状态(旁.c)).toBe("意向");
  });
});
