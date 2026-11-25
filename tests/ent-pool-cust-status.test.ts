/**
 * 项目进出公海重算客户状态（11-25，B37「公海不动，随领取和项目变动自然落库」、M-状态-01「按项目变动自然更新」）：
 * 「在推项目优先」认的在推 = 没结局、不在公海，项目一进一出公海，客户状态就该跟着变，同一笔事务里落库（cust-status-auto-db.ts 进出公海重算）。
 *   - 领取线索公海里的项目（单个）：名下一条流失线索 + 刚领回的在推线索 → 流失变潜在；放回公海 → 变回流失
 *   - 超时回收回公海：潜在变流失
 *   - 批量分配线索公海里的项目（公海页项目行，总管理分给销售）：几位客户一起从流失变潜在
 *   - 领取客户公海里的客户（名下公海项目一起带出来）→ 潜在；撤销这次领取（项目回公海）→ 流失
 *   - 不是企业版：不算、不改
 * 撤销按原样回滚（P-撤销-01，复审 11-25）：撤销领取 / 分配 / 放进公海，客户状态还回动手前存的值，不按撤完的项目现算。
 * 原值只认服务端留痕（CustomerClaim / pool-claim / CustomerPool 的 prevCustStatus，cust-status-undo.ts），浏览器带什么都不认：
 *   - 零项目存「成交」、存「潜在」只有一条流失线索（M-状态-01 那 566 家：领取时落成流失，撤销回潜在）、存的和现算不一样的：撤销后都回原值
 *   - 伪造原值无效；撤了一半（项目撤不成、前端少带）按重算；撤销放进时事务里没撤成的不写回；老留痕没记 / 导入撤回按重算
 *   - 进出公海重算只在算出 null、库里有值时不写；只有结局项目的照常落库
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  /** 钉住老签约 是撤销放进时事务外的一步：挂一下，模拟「事务外认完、进事务前」有人插进来 */
  钉住时: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/contract-owner", async (原) => {
  const 真 = await 原<typeof import("@/lib/contract-owner")>();
  return {
    ...真,
    钉住老签约: async () => {
      const 挂 = mocks.钉住时;
      mocks.钉住时 = null;
      if (挂) await 挂();
      return 真.钉住老签约();
    },
  };
});
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
import { 撤回项目公海 } from "@/lib/enterprise/pool-undo";
import { 查完再写 } from "@/lib/check-then-write";
import { 看全部 } from "@/lib/team-scope";

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

describe("撤销还回原值（服务端留痕，复审 11-25）", () => {
  /** 客户放进客户公海（原负责人甲放的，老数据） */
  const 进客户公海 = (c: string) => prisma.customerPool.create({ data: { customerId: c, userId: 甲.id, reason: "手动" } });
  /** 存「意向」（导入带的，和现算不一样）、名下一条流失线索 + 一条线索公海里的在推线索 */
  const 存意向的 = async () => {
    const c = await 客户(甲.id, "意向");
    await 项目(c, 甲.id, { result: "线索流失" });
    const 公 = await 公海线索(c);
    return { c, 公 };
  };
  /** 有人在撤销前动了这个项目（改节点留一行）：撤回项目公海 认不到最近一条是 pool-claim，撤不成 */
  const 有人动过 = (projectId: string, userId: string) =>
    prisma.projectNodeLog.create({ data: { projectId, userId, kind: "node", fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "初步沟通" } });

  it("零项目的公海客户存「成交」：领取（补潜客培育）→ 潜在；撤销 → 回到「成交」", async () => {
    const c = await 客户(甲.id, "成交");
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(r.带过来?.培育?.length).toBe(1);
    expect(await 状态(c)).toBe("潜在");
    // 原值记在服务端领取行上，撤销条不再带
    expect((await prisma.customerClaim.findUniqueOrThrow({ where: { customerId: c } })).prevCustStatus).toBe("成交");
    expect(r.原负责人![0]).not.toHaveProperty("状");
    expect(await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
    expect(await 状态(c)).toBe("成交");
  });

  it("存「潜在」、名下只有一条流失线索的公海客户（566 类）：领取时落成「流失」（B37），撤销回到「潜在」", async () => {
    const c = await 客户(甲.id, "潜在");
    await 项目(c, 甲.id, { result: "线索流失" });
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(1);
    expect(await 状态(c)).toBe("流失");
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

  it("伪造原值无效：撤销条里塞 状 / 第 5 个参数，服务端只认留痕", async () => {
    // 客户级：原负责人里塞「成交」，还回的是领取行上记的「意向」
    const { c } = await 存意向的();
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    const 改过 = r.原负责人!.map((x) => ({ ...x, 状: "成交" }));
    expect(await 以(丙, () => 撤销公海("领取", 改过, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("意向");
    // 项目级：多传一个原状态清单（老前端的形状）也不认
    const 另 = await 存意向的();
    const r2 = await 以(丙, () => 领取([], undefined, [另.公]));
    if (!r2.ok) throw new Error(r2.error);
    expect(await 状态(另.c)).toBe("潜在");
    const 撤项目 = 撤销公海项目 as (...a: unknown[]) => ReturnType<typeof 撤销公海项目>;
    expect(await 以(丙, () => 撤项目("领取", [另.公], undefined, undefined, [{ id: 另.c, 状: "成交" }]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(另.c)).toBe("意向");
  });

  it("老留痕没记原值（上线前的领取行 / pool-claim）：照旧按项目重算", async () => {
    const { c } = await 存意向的();
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    await prisma.customerClaim.update({ where: { customerId: c }, data: { prevCustStatus: null } });
    await prisma.projectNodeLog.updateMany({ where: { kind: "pool-claim" }, data: { prevCustStatus: null } });
    expect(await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("流失");
    // 项目级同理
    const 另 = await 存意向的();
    const r2 = await 以(丙, () => 领取([], undefined, [另.公]));
    if (!r2.ok) throw new Error(r2.error);
    await prisma.projectNodeLog.updateMany({ where: { projectId: 另.公, kind: "pool-claim" }, data: { prevCustStatus: null } });
    expect(await 以(丙, () => 撤销公海项目("领取", [另.公]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(另.c)).toBe("流失");
  });

  it("导入撤回（直接调 撤回项目公海，不经撤销条）：读不到原值，按项目重算", async () => {
    const { c, 公 } = await 存意向的();
    const r = await 以(丙, () => 领取([], undefined, [公]));
    if (!r.ok) throw new Error(r.error);
    expect(await 看全部(() => 查完再写((tx) => 撤回项目公海(tx, 公, 丙.id, 丙.id)))).toBe(true);
    expect(await 状态(c)).toBe("流失");
  });

  it("客户级撤一半：带出来的项目有一个撤不成（有人动过）、或前端少带了一个，都按重算，不写回原值", async () => {
    for (const 方式 of ["动过", "少带"] as const) {
      const { c, 公 } = await 存意向的();
      const 公2 = await 公海线索(c);
      await 进客户公海(c);
      const r = await 以(丙, () => 领取([c]));
      if (!r.ok) throw new Error(r.error);
      expect([...r.公海项目!].sort()).toEqual([公, 公2].sort());
      expect(await 状态(c)).toBe("潜在");
      if (方式 === "动过") await 有人动过(公2, 丙.id);
      const 带 = 方式 === "少带" ? [公] : r.公海项目;
      expect(await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, 带))).toMatchObject({ ok: true, updated: 1 });
      // 公2 还在外面（在推）：现算是潜在，不是原值意向
      expect((await prisma.project.findUniqueOrThrow({ where: { id: 公2 } })).pooledAt).toBeNull();
      expect(await 状态(c)).toBe("潜在");
    }
  });

  it("项目级撤一半：同一位客户这一批领了两个，只撤成一个，按重算", async () => {
    const { c, 公 } = await 存意向的();
    const 公2 = await 公海线索(c);
    const r = await 以(丙, () => 领取([], undefined, [公, 公2]));
    if (!r.ok) throw new Error(r.error);
    expect(r.项目?.领到).toEqual([公, 公2]);
    // 前端只带一个
    expect(await 以(丙, () => 撤销公海项目("领取", [公]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("潜在");
    // 两个都带、其中一个有人动过：撤成一个，也按重算
    const 另 = await 存意向的();
    const 另2 = await 公海线索(另.c);
    const r2 = await 以(丙, () => 领取([], undefined, [另.公, 另2]));
    if (!r2.ok) throw new Error(r2.error);
    await 有人动过(另2, 丙.id);
    expect(await 以(丙, () => 撤销公海项目("领取", [另.公, 另2]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(另.c)).toBe("潜在");
    // 剩下那一个撤完（第一位）：这一下都撤完了，回到原值
    expect(await 以(丙, () => 撤销公海项目("领取", [公2]))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("意向");
  });

  it("撤销放进公海：回到进公海前存的值；跟着进公海的项目没还回来（前端少带）按重算", async () => {
    // 存「意向」，名下一条流失线索 + 甲自己在推的线索：放进去在推的进线索公海，现算变流失；撤销回「意向」（现算会是潜在）
    const 造 = async () => {
      const c = await 客户(甲.id, "意向");
      await 项目(c, 甲.id, { result: "线索流失" });
      return { c, 推: await 项目(c, 甲.id) };
    };
    const a = await 造();
    const r = await 以(甲, () => 放进公海([a.c], "客户主动终止"));
    if (!r.ok) throw new Error(r.error);
    expect(r.公海项目).toEqual([a.推]);
    expect(r).not.toHaveProperty("原负责人");
    expect(await 状态(a.c)).toBe("流失");
    expect((await prisma.customerPool.findUniqueOrThrow({ where: { customerId: a.c } })).prevCustStatus).toBe("意向");
    // 前端塞了 状 也不认
    expect(await 以(甲, () => 撤销公海("放进", [{ id: a.c, 值: "", 状: "成交" } as { id: string; 值: string }], r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: a.推 } })).pooledAt).toBeNull();
    expect(await 状态(a.c)).toBe("意向");
    // 少带：项目留在线索公海，客户按重算（流失）
    const b = await 造();
    const r2 = await 以(甲, () => 放进公海([b.c], "客户主动终止"));
    if (!r2.ok) throw new Error(r2.error);
    expect(await 以(甲, () => 撤销公海("放进", [{ id: b.c, 值: "" }], r2.带过来, undefined, []))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: b.推 } })).pooledAt).not.toBeNull();
    expect(await 状态(b.c)).toBe("流失");
  });

  it("撤销放进公海：哪几位真撤回在事务里认，事务外认完、进事务前被别人领走的那位不写回", async () => {
    const a = await 客户(甲.id, "意向");
    await 项目(a, 甲.id, { result: "线索流失" });
    const b = await 客户(甲.id, "意向");
    await 项目(b, 甲.id, { result: "线索流失" });
    const 推b = await 项目(b, 甲.id);
    const r = await 以(甲, () => 放进公海([a, b], "客户主动终止"));
    if (!r.ok) throw new Error(r.error);
    // 撤销走到事务外那一步（认过 a、b 都还在公海）时，b 被丙领走（客户公海那一行没了，带出来的项目归丙）：重算成潜在
    mocks.钉住时 = async () => {
      const 领 = await 以谁的身份(丙.id, () => 领取([b]));
      if (!领.ok) throw new Error(领.error);
    };
    const 撤 = await 以(甲, async () => {
      const 先 = mocks.user;
      // 领取 里 requireUser 读 mocks.user：领的那一下换成丙，撤销本身还是甲
      const 挂 = mocks.钉住时!;
      mocks.钉住时 = async () => { mocks.user = { ...丙 }; try { await 挂(); } finally { mocks.user = 先; } };
      return 撤销公海("放进", [{ id: a, 值: "" }, { id: b, 值: "" }], r.带过来, undefined, r.公海项目);
    });
    expect(mocks.钉住时).toBeNull();
    expect(await 状态(b)).toBe("潜在");
    expect(撤).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(a)).toBe("意向");
    expect(await 状态(b)).toBe("潜在");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 推b } })).ownerId).toBe(丙.id);
  });

  it("项目级撤销领取（公海页只勾项目行）：回到原值", async () => {
    const { c, 公 } = await 存意向的();
    const r = await 以(丙, () => 领取([], undefined, [公]));
    if (!r.ok) throw new Error(r.error);
    expect(r.项目?.领到).toEqual([公]);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(丙, () => 撤销公海项目("领取", [公]))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 公 } })).pooledAt).not.toBeNull();
    expect(await 状态(c)).toBe("意向");
  });

  it("项目级撤销分配（总管理分项目行）：回到原值；别的客户不动", async () => {
    const { c, 公 } = await 存意向的();
    const 旁 = await 客户(甲.id, "交付");
    const r = await 以(总管, () => 分配公海项目([公], 丙.id));
    if (!r.ok) throw new Error(r.error);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(总管, () => 撤销公海项目("分配", [公], 丙.id, r.整包))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("意向");
    expect(await 状态(旁)).toBe("交付");
  });

  it("分项目时客户整包出客户公海：撤销整包退回，交给客户那一半还原值", async () => {
    const { c, 公 } = await 存意向的();
    const 公2 = await 公海线索(c);
    await 进客户公海(c);
    const r = await 以(总管, () => 分配公海项目([公], 丙.id));
    if (!r.ok) throw new Error(r.error);
    expect(r.整包?.原.map((x) => x.id)).toEqual([c]);
    expect(r.整包?.公海项目).toEqual([公2]);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(总管, () => 撤销公海项目("分配", [公], 丙.id, r.整包))).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await 状态(c)).toBe("意向");
  });

  it("撤销批量改负责人（一起带出线索公海的项目放回去）：回到原值；前端少带项目按重算", async () => {
    const { c, 公 } = await 存意向的();
    const r = await 以(总管, () => assignSalesOwner([c], 丙.id));
    if (!r.ok) throw new Error(r.error);
    expect(r.带过来?.公海项目).toEqual([公]);
    expect(r.原值).toEqual([{ id: c, 值: 甲.id }]);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(总管, () => 撤销改负责人(r.原值!, 丙.id, r.带过来))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 公 } })).pooledAt).not.toBeNull();
    expect(await 状态(c)).toBe("意向");
    // 两个带出来的只放回一个：另一个还在外面，按重算
    const 另 = await 存意向的();
    const 另2 = await 公海线索(另.c);
    const r2 = await 以(总管, () => assignSalesOwner([另.c], 丙.id));
    if (!r2.ok) throw new Error(r2.error);
    expect(await 以(总管, () => 撤销改负责人(r2.原值!, 丙.id, { ...r2.带过来!, 公海项目: [另.公] }))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 另2 } })).pooledAt).toBeNull();
    expect(await 状态(另.c)).toBe("潜在");
  });

  it("进出公海重算：算出 null、库里有值的不清空；只有结局项目的照常落库", async () => {
    const 零 = await 客户(甲.id, "成交");
    const 只流失 = await 客户(甲.id, "潜在");
    await 项目(只流失, 甲.id, { result: "线索流失" });
    const 删了 = await 客户(甲.id, "意向");
    await 项目(删了, 甲.id, { deletedAt: new Date() });
    const 空 = await 客户(甲.id, null);
    await 项目(空, 甲.id, { result: "线索流失" });
    expect(await 进出公海重算(prisma, [零, 只流失, 删了, 空])).toBe(2);
    expect(await 状态(零)).toBe("成交");
    expect(await 状态(删了)).toBe("意向");
    expect(await 状态(只流失)).toBe("流失");
    expect(await 状态(空)).toBe("流失");
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
    expect(await 以(丙, () => 撤销公海("领取", [...r.原负责人!, { id: 旁.c, 值: 甲.id }], r.带过来, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    expect(await 状态(c)).toBe("意向");
    expect(await 状态(旁.c)).toBe("意向");
  });

  it("撤一半漏判（复审 11-25）：P1 批量领（记原值）、P2 项目页单个领，30 分钟内撤 P1：按项目重算，不写回 P1 的原值", async () => {
    for (const 方式 of ["单个领记了原值", "没记原值的出公海"] as const) {
      const { c, 公: P1 } = await 存意向的();
      const P2 = await 公海线索(c);
      const r = await 以(丙, () => 领取([], undefined, [P1]));
      if (!r.ok) throw new Error(r.error);
      expect((await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: P1, kind: "pool-claim" } })).prevCustStatus).toBe("意向");
      expect(await 以(丙, () => 领取公海项目(丙, P2))).toEqual({ ok: true });
      // 别的出公海的路（老代码、改项目换人出公海）不记原值：pool-claim 上是 NULL，也得算没撤
      if (方式 === "没记原值的出公海") await prisma.projectNodeLog.updateMany({ where: { projectId: P2, kind: "pool-claim" }, data: { prevCustStatus: null } });
      expect(await 状态(c)).toBe("潜在");
      expect(await 以(丙, () => 撤销公海项目("领取", [P1]))).toMatchObject({ ok: true, updated: 1 });
      expect((await prisma.project.findUniqueOrThrow({ where: { id: P1 } })).pooledAt).not.toBeNull();
      // P2 还在外面在推：现算潜在，不是 P1 上记的意向
      expect(await 状态(c)).toBe("潜在");
    }
  });

  it("项目页单个领取也记原值：领了再撤，回到原值", async () => {
    const { c, 公 } = await 存意向的();
    expect(await 以(丙, () => 领取公海项目(丙, 公))).toEqual({ ok: true });
    expect(await 状态(c)).toBe("潜在");
    expect((await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: 公, kind: "pool-claim" } })).prevCustStatus).toBe("意向");
    expect(await 以(丙, () => 撤销公海项目("领取", [公]))).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 公 } })).pooledAt).not.toBeNull();
    expect(await 状态(c)).toBe("意向");
  });

  it("撤销领取时补的潜客培育还在（前端没带回 培育）：算没撤完，按重算，不写回原值", async () => {
    const c = await 客户(甲.id, "成交");
    await 进客户公海(c);
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(r.带过来?.培育?.length).toBe(1);
    expect(await 状态(c)).toBe("潜在");
    expect(await 以(丙, () => 撤销公海("领取", r.原负责人!, { ...r.带过来!, 培育: [] }, undefined, r.公海项目))).toMatchObject({ ok: true, updated: 1 });
    // 培育项目没删、客户回了公海：按剩下的项目重算（潜在），不是领取前的「成交」
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(1);
    expect(await 状态(c)).toBe("潜在");
  });
});

describe("撤销公海领取：领的销售自己退过公海（有原负责人回避，3703 11-25）", () => {
  it("领取 → 撤销：负责人回空、客户回公海、状态回原值、记了审计", async () => {
    // 丙自己放过一位客户进公海：他身上有原负责人回避（回避客户条件 NOT「负责人是他 ∧ 在公海」）
    const 他放的 = await 客户(丙.id, "潜在");
    await 项目(他放的, 丙.id);
    expect(await 以(丙, () => 放进公海([他放的], "客户主动终止"))).toMatchObject({ ok: true, updated: 1 });
    // 甲放进公海的客户：负责人挂占位账号（M-公海-03），名下在推项目一起进线索公海
    const c = await 客户(甲.id, "意向");
    const p = await 项目(c, 甲.id);
    expect(await 以(甲, () => 放进公海([c], "客户主动终止"))).toMatchObject({ ok: true, updated: 1 });
    const 进公海后 = await prisma.customer.findUniqueOrThrow({ where: { id: c }, select: { salesOwnerId: true, custStatus: true } });
    忘掉企业版范围();
    const r = await 以(丙, () => 领取([c]));
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(1);
    expect(r.公海项目).toEqual([p]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(丙.id);
    const 撤 = await 以(丙, () => 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目));
    expect(撤).toMatchObject({ ok: true, updated: 1 });
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: c }, select: { salesOwnerId: true, custStatus: true, pool: { select: { userId: true } } } });
    expect(后.salesOwnerId).toBe(进公海后.salesOwnerId);
    expect(后.pool).not.toBeNull();
    expect(后.custStatus).toBe(进公海后.custStatus);
    expect(await prisma.customerClaim.count({ where: { customerId: c } })).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { userId: 丙.id, summary: { contains: "撤销了刚才的公海领取" } } })).toBe(1);
  });
});
