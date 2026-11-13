/**
 * 持有上限核在写入的同一个事务里（M-公海-18，11-11，#245 的续）：
 *   1. 确认交接（转让、离职）    2. 直接转客户的接待分配（assignSalesOwner）
 *   3. 离职交接看板（交一位客户 / 交一个项目 / 全部交给；11-13 起在接手人确认那一刻核）    4. 给客户建项目指派给别人
 *   5. 总管理在公海页同时勾客户行和项目行一起分配（分配公海 带 项目ids）
 * 每处：超限 → 一个都没做、数据没变、提示说清上限 / 现有 / 这次要几个 / 最多还能几个；刚好到上限 → 成功；
 * 和另一个领取 / 分配并发、合计超限 → 恰好一个成功、另一个整批失败（跑 5 轮）；回滚时没有留下通知、待办没被搬
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
import { 不设配额key } from "@/lib/enterprise/lead-assign";
import { 持有数 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 待确认的交接, 确认交接, 撤回交接 } from "@/app/(app)/customers/handover-actions";
import { 领取, 分配公海 } from "@/app/(app)/customers/pool-actions";
import { 交接客户 as 真交接客户, 交接项目 as 真交接项目, 交接全部 as 真交接全部 } from "@/app/(app)/projects/handover/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人;
let 市场: 人;
let 甲: 人;
let 乙: 人;
let 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };

let 序号 = 0;
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) => {
  序号 += 1;
  return (await prisma.project.create({ data: { name: `项目${序号}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
};
const 待办 = async (customerId: string, ownerId: string) => (await prisma.task.create({ data: { title: "打电话", customerId, ownerId } })).id;
const 客户负责人 = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId;
const 负责人of = async (p: string) => (await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId;
const 先有 = async (u: 人, n: number) => { for (let i = 0; i < n; i++) await 项目(await 客户(u.id), u.id); };
const 上限 = async (n: number) => {
  await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: n } });
  invalidateSettingsCache();
};
/** 客户公海里的客户（原负责人 乙），名下 n 个线索公海里的项目：领 / 分客户一起带走 */
const 公海客户 = async (n: number) => {
  const c = await 客户(乙.id);
  for (let i = 0; i < n; i++) await 项目(c, 乙.id, { pooledAt: new Date() });
  await prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
  return c;
};
/** 线索公海里的项目（客户不在客户公海，归 乙） */
const 公海项目 = async () => 项目(await 客户(乙.id), 乙.id, { pooledAt: new Date() });
const 通知数 = () => prisma.entNotice.count();
const 开项目模式 = async () => { await setSetting("business", { projectMode: true }); invalidateSettingsCache(); };

async function 起步() {
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
}
beforeEach(起步);
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("1. 确认交接：核和转在同一个事务里", () => {
  /** 甲申请把自己名下一位客户（带 n 个他自己的项目、一条待办）移交给 丙，返回交接 id */
  const 甲移交给丙 = async (n: number) => {
    invalidateSettingsCache();
    const c = await 客户(甲.id);
    const ps: string[] = [];
    for (let i = 0; i < n; i++) ps.push(await 项目(c, 甲.id));
    const t = await 待办(c, 甲.id);
    expect(await 以(甲, () => assignSalesOwner([c], 丙.id))).toMatchObject({ ok: true, 交接中: 1 });
    const [h] = (await 以(丙, () => 待确认的交接())).等我确认;
    return { c, ps, t, h: h.id };
  };

  it("转让超限：交接还是待确认、客户项目待办都没动、没发通知；提示说清上限、现有、要交接几个、最多还能几个", async () => {
    await 上限(2);
    await 先有(丙, 1);
    const x = await 甲移交给丙(2);
    const 通知前 = await 通知数();
    const r = await 以(丙, () => 确认交接(x.h));
    expect(r).toEqual({ ok: false, error: "销售丙某名下现在有 1 个线索 / 商机阶段的项目，持有上限 2 个，这次要交接 2 个，最多还能交接 1 个；超了上限，这笔交接没有确认、还在等你确认；先推进或放回一些再确认，或者请发起人撤回后换人" });
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: x.h } })).status).toBe("待确认");
    expect(await 客户负责人(x.c)).toBe(甲.id);
    for (const p of x.ps) expect(await 负责人of(p)).toBe(甲.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: x.t } })).ownerId).toBe(甲.id);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: x.c, toOwnerId: 丙.id } })).toBe(0);
    expect(await 通知数()).toBe(通知前);
    expect(await 持有数(prisma, 丙.id)).toBe(1);
  });

  it("转让刚好到上限：确认成功", async () => {
    await 上限(3);
    await 先有(丙, 1);
    const x = await 甲移交给丙(2);
    expect(await 以(丙, () => 确认交接(x.h))).toEqual({ ok: true, 客户: 1 });
    expect(await 持有数(prisma, 丙.id)).toBe(3);
  });

  it("离职超限：同样整笔回滚、交接还挂着；放宽后能确认", async () => {
    await 上限(2);
    await 先有(丙, 1);
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    await 项目(c, 甲.id);
    await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
    const h = await prisma.entHandover.create({ data: { kind: "离职", way: "转交", fromUserId: 甲.id, toUserId: 丙.id, byUserId: 总管.id, customerIds: JSON.stringify([c]), counts: JSON.stringify({ 客户: 1 }) } });
    const 通知前 = await 通知数();
    const r = await 以(丙, () => 确认交接(h.id));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("这次要交接 2 个，最多还能交接 1 个");
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("待确认");
    expect(await 客户负责人(c)).toBe(甲.id);
    expect(await 通知数()).toBe(通知前);
    await 上限(3);
    expect(await 以(丙, () => 确认交接(h.id))).toEqual({ ok: true, 客户: 1 });
    expect(await 持有数(prisma, 丙.id)).toBe(3);
  });

  it("和领取公海并发、合计超限：恰好一个成功，另一个整批没做（跑 5 轮）", async () => {
    for (let 轮 = 0; 轮 < 5; 轮++) {
      if (轮) await 起步();
      await 上限(3);
      await 先有(丙, 1);
      const x = await 甲移交给丙(2);
      const 公海们 = [await 公海客户(1), await 公海客户(1)];
      const [a, b] = await Promise.all([以(丙, () => 确认交接(x.h)), 以(丙, () => 领取(公海们))]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect(await 持有数(prisma, 丙.id)).toBe(3);
      if (a.ok) {
        expect((b as { error: string }).error).toContain("这次要领 2 个，最多还能领 0 个");
        expect(await prisma.customerPool.count({ where: { customerId: { in: 公海们 } } })).toBe(2);
      } else {
        expect(a.error).toContain("这次要交接 2 个，最多还能交接 0 个");
        expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: x.h } })).status).toBe("待确认");
        expect(await 客户负责人(x.c)).toBe(甲.id);
      }
    }
  });
});

describe("2. 直接转客户的接待分配（assignSalesOwner）：核和写在同一个事务里", () => {
  /** 市场名下一位客户，挂着 丙 占着的待分配项目 n 个（= 接待分配，算进手）、一条市场的待办 */
  const 市场客户 = async (n: number) => {
    const c = await 客户(市场.id);
    const ps: string[] = [];
    for (let i = 0; i < n; i++) ps.push(await 项目(c, 丙.id, { awaitAssignAt: new Date() }));
    const t = await 待办(c, 市场.id);
    return { c, ps, t };
  };

  it("超限：一个都没转、待分配还挂着、没发通知；提示用「分配」", async () => {
    await 上限(2);
    await 先有(甲, 1);
    const x = await 市场客户(1);
    const y = await 市场客户(1);
    const 通知前 = await 通知数();
    const r = await 以(市场, () => assignSalesOwner([x.c, y.c], 甲.id));
    expect(r).toEqual({ ok: false, error: "销售甲某名下现在有 1 个线索 / 商机阶段的项目，持有上限 2 个，这次要分配 2 个，最多还能分配 1 个；超了上限，这一批一个都没分配，先推进或放回一些，或者少选几个再分配" });
    for (const z of [x, y]) {
      expect(await 客户负责人(z.c)).toBe(市场.id);
      expect(await prisma.project.findUniqueOrThrow({ where: { id: z.ps[0] } })).toMatchObject({ ownerId: 丙.id, awaitAssignAt: expect.any(Date) });
    }
    expect(await 通知数()).toBe(通知前);
    expect(await 持有数(prisma, 甲.id)).toBe(1);
  });

  it("刚好到上限：转成", async () => {
    await 上限(3);
    await 先有(甲, 1);
    const x = await 市场客户(1);
    const y = await 市场客户(1);
    expect(await 以(市场, () => assignSalesOwner([x.c, y.c], 甲.id))).toMatchObject({ ok: true, updated: 2 });
    expect(await 持有数(prisma, 甲.id)).toBe(3);
  });

  it("两次同时转给同一人、合计超限：恰好一次成功，另一次一个都没转（跑 5 轮）", async () => {
    for (let 轮 = 0; 轮 < 5; 轮++) {
      if (轮) await 起步();
      await 上限(2);
      await 先有(甲, 1);
      const x = await 市场客户(1);
      const y = await 市场客户(1);
      const [a, b] = await Promise.all([以(市场, () => assignSalesOwner([x.c], 甲.id)), 以(市场, () => assignSalesOwner([y.c], 甲.id))]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect((a.ok ? b : a) as { error: string }).toMatchObject({ error: expect.stringContaining("这次要分配 1 个，最多还能分配 0 个") });
      const 没转的 = a.ok ? y : x;
      expect(await 客户负责人(没转的.c)).toBe(市场.id);
      expect(await 负责人of(没转的.ps[0])).toBe(丙.id);
      expect(await 持有数(prisma, 甲.id)).toBe(2);
    }
  });
});

describe("3. 离职交接看板：核和交在同一个事务里", () => {
  const 场景 = async () => {
    await 开项目模式();
    const c = await 客户(甲.id);
    const ps = [await 项目(c, 甲.id), await 项目(c, 甲.id)];
    const 挂别处 = await 项目(await 客户(乙.id), 甲.id);
    const t = await 待办(c, 甲.id);
    await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
    return { c, ps, 挂别处, t };
  };

  /** 11-13 起离职交接要接手人确认：发起只记一行，上限在接手人确认那一刻核，超了整笔回滚、交接还在等确认 */
  const 发起 = async (r: Promise<{ ok: boolean; 交接?: string; error?: string }>) => {
    const x = await r;
    expect(x).toMatchObject({ ok: true });
    return x.交接!;
  };
  const 超限话 = "超了上限，这笔交接没有确认、还在等你确认；先推进或放回一些再确认，或者请发起人撤回后换人";

  it("交一位客户超限：接手人确认时失败，客户、项目、待办都没动，交接还在等确认，除了「等你确认」没发别的通知", async () => {
    const x = await 场景();
    await 上限(2);
    await 先有(丙, 1);
    const 通知前 = await 通知数();
    const id = await 发起(以(总管, () => 真交接客户(甲.id, x.c, 丙.id)));
    expect(await 通知数()).toBe(通知前 + 1);
    const r = await 以(丙, () => 确认交接(id));
    expect(r).toEqual({ ok: false, error: `销售丙某名下现在有 1 个线索 / 商机阶段的项目，持有上限 2 个，这次要交接 2 个，最多还能交接 1 个；${超限话}` });
    expect(await 客户负责人(x.c)).toBe(甲.id);
    for (const p of x.ps) expect(await 负责人of(p)).toBe(甲.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: x.t } })).ownerId).toBe(甲.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: x.c } })).remark ?? "").not.toContain("离职交接");
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id } })).status).toBe("待确认");
    expect(await 通知数()).toBe(通知前 + 1);
  });

  it("交一个项目、全部交给超限：确认时同样不动；放宽上限后再确认就能转", async () => {
    const x = await 场景();
    await 上限(1);
    await 先有(丙, 1);
    const p1 = await 发起(以(总管, () => 真交接项目(甲.id, x.挂别处, 丙.id)));
    expect(((await 以(丙, () => 确认交接(p1))) as { error: string }).error).toContain("这次要交接 1 个，最多还能交接 0 个");
    expect(await 负责人of(x.挂别处)).toBe(甲.id);
    // 单条在等时不能全部交给：先撤回
    expect(await 以(总管, () => 真交接全部(甲.id, 丙.id))).toMatchObject({ ok: false, error: expect.stringContaining("笔单条交接在等接手人确认") });
    expect(await 以(总管, () => 撤回交接(p1))).toMatchObject({ ok: true });
    await 上限(3);
    const 全 = await 发起(以(总管, () => 真交接全部(甲.id, 丙.id)));
    expect(((await 以(丙, () => 确认交接(全))) as { error: string }).error).toContain("这次要交接 3 个，最多还能交接 2 个");
    expect(await 客户负责人(x.c)).toBe(甲.id);
    await 上限(4);
    expect(await 以(丙, () => 确认交接(全))).toMatchObject({ ok: true });
    expect(await 持有数(prisma, 丙.id)).toBe(4);
    expect(await 客户负责人(x.c)).toBe(丙.id);
  });

  it("接手人确认交一位客户和自己领取公海并发、合计超限：恰好一个成功（跑 5 轮）", async () => {
    for (let 轮 = 0; 轮 < 5; 轮++) {
      if (轮) await 起步();
      const x = await 场景();
      await 上限(3);
      await 先有(丙, 1);
      const 公海们 = [await 公海客户(1), await 公海客户(1)];
      const id = await 发起(以(总管, () => 真交接客户(甲.id, x.c, 丙.id)));
      const [a, b] = await Promise.all([以(丙, () => 确认交接(id)), 以(丙, () => 领取(公海们))]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect(await 持有数(prisma, 丙.id)).toBe(3);
      if (a.ok) expect(await prisma.customerPool.count({ where: { customerId: { in: 公海们 } } })).toBe(2);
      else {
        expect(a.error).toContain("这次要交接 2 个，最多还能交接 0 个");
        expect(await 客户负责人(x.c)).toBe(甲.id);
      }
    }
  });
});

describe("4. 给客户建项目指派给别人：核和建在同一个事务里", () => {
  const 建 = (customerId: string, ownerId: string) => 以(市场, () => 给客户建项目({
    customerId, 项目: { name: `页新建${++序号}`, amount: 0, currency: "CNY", ownerId, 分配方式: 0, 业务线: "内贸" },
    跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
  } as Parameters<typeof 给客户建项目>[0]));

  it("超限：项目没建、客户没转、没发通知；市场转客户时客户上同事待分配的一起数", async () => {
    await 开项目模式();
    await 上限(2);
    await 先有(甲, 1);
    const c = await 客户(市场.id);
    const 待分配 = await 项目(c, 丙.id, { awaitAssignAt: new Date() });
    const 项目前 = await prisma.project.count();
    const 通知前 = await 通知数();
    const r = await 建(c, 甲.id);
    expect(r).toEqual({ ok: false, error: "销售甲某名下现在有 1 个线索 / 商机阶段的项目，持有上限 2 个，这次要分配 2 个，最多还能分配 1 个；超了上限，项目没有建；先推进或放回一些，或者换一位负责人" });
    expect(await prisma.project.count()).toBe(项目前);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await 客户负责人(c)).toBe(市场.id);
    expect(await 负责人of(待分配)).toBe(丙.id);
    expect(await 通知数()).toBe(通知前);
  });

  it("刚好到上限：建成", async () => {
    await 开项目模式();
    await 上限(2);
    await 先有(甲, 1);
    expect(await 建(await 客户(市场.id), 甲.id)).toMatchObject({ ok: true });
    expect(await 持有数(prisma, 甲.id)).toBe(2);
  });

  it("两次同时指派给同一人、合计超限：恰好一次建成（跑 5 轮）", async () => {
    for (let 轮 = 0; 轮 < 5; 轮++) {
      if (轮) await 起步();
      await 开项目模式();
      await 上限(2);
      await 先有(甲, 1);
      const [c1, c2] = [await 客户(市场.id), await 客户(市场.id)];
      const [a, b] = await Promise.all([建(c1, 甲.id), 建(c2, 甲.id)]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect((a.ok ? b : a) as { error: string }).toMatchObject({ error: expect.stringContaining("这次要分配 1 个，最多还能分配 0 个") });
      expect(await prisma.project.count({ where: { customerId: a.ok ? c2 : c1 } })).toBe(0);
      expect(await 持有数(prisma, 甲.id)).toBe(2);
    }
  });
});

describe("5. 公海页客户行 + 项目行一起分配：一个事务、合起来核", () => {
  it("项目那批会超限：客户也没分出去（还在公海），项目还在公海；放宽后一次全分", async () => {
    await 开项目模式();
    await 上限(2);
    await 先有(丙, 1);
    const c = await 公海客户(1);
    const ps = [await 公海项目()];
    const 通知前 = await 通知数();
    const r = await 以(总管, () => 分配公海([c], 丙.id, undefined, ps));
    expect(r).toEqual({ ok: false, error: "销售丙某名下现在有 1 个线索 / 商机阶段的项目，持有上限 2 个，这次要接 2 个，最多还能接 1 个；超了上限，这一批一个都没接，先推进或放回一些，或者少选几个再接" });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.project.count({ where: { pooledAt: { not: null } } })).toBe(2);
    expect(await 通知数()).toBe(通知前);
    await 上限(3);
    const r2 = await 以(总管, () => 分配公海([c], 丙.id, undefined, ps));
    expect(r2).toMatchObject({ ok: true, updated: 1, 项目: { 领到: ps, 没领到: [] }, 给谁: { id: 丙.id } });
    expect(await 持有数(prisma, 丙.id)).toBe(3);
  });

  it("分到的项目行能撤销（撤销条照旧走 撤销公海项目），客户行照旧走 撤销公海", async () => {
    await 开项目模式();
    const c = await 公海客户(1);
    const ps = [await 公海项目()];
    const r = await 以(总管, () => 分配公海([c], 丙.id, undefined, ps));
    expect(r).toMatchObject({ ok: true, updated: 1, 原负责人: [{ id: c }], 项目: { 领到: ps } });
  });

  it("和他自己领取并发、合计超限：恰好一个成功（跑 5 轮）", async () => {
    for (let 轮 = 0; 轮 < 5; 轮++) {
      if (轮) await 起步();
      await 开项目模式();
      await 上限(3);
      await 先有(丙, 1);
      const c = await 公海客户(1);
      const ps = [await 公海项目()];
      const 公海们 = [await 公海客户(1), await 公海客户(1)];
      const [a, b] = await Promise.all([以(总管, () => 分配公海([c], 丙.id, undefined, ps)), 以(丙, () => 领取(公海们))]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect(await 持有数(prisma, 丙.id)).toBe(3);
      if (!a.ok) {
        expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
        expect(await prisma.project.count({ where: { id: { in: ps }, pooledAt: { not: null } } })).toBe(1);
      }
    }
  });
});
