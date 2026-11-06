/**
 * 企业版项目进公海清负责人（11-01 会议 C-01，lib/project/pool-owner.ts）：
 *   - 进公海（放回、超时回收、离职放进公海）把 Project.ownerId 清成空串，原负责人只记在 pool-release 留痕里 = 历史负责人
 *   - 历史负责人领不回、别人能领；只认最后一次进公海前的那位
 *   - 历史负责人看不到：项目列表、统一公海页、按单个项目认权限（详情 / 附件）都挡；老板、主管不挡
 *   - 进公海时历史负责人在这个项目上没做完的待办关掉（done，记录留着）
 *   - 不是企业版：照旧留着负责人，不回避、不关待办
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 放回公海, 领取公海项目 } from "@/lib/project/db";
import { 读项目列表 } from "@/lib/project/list";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 公海规则, 进公海关待办尾 } from "@/lib/enterprise/pool-rules";
import { 历史负责人, 我回避的公海项目, 原负责人挡着, 公海无负责人 } from "@/lib/project/pool-owner";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 经理: 人;
let 乙: 人;
let 丙: 人;

/** 权限只认业务角色（11-01）：账号 ADMIN = 总管理、MANAGER = 销售管理、SALES = 销售成员 */
const 业务角色of: Record<string, string> = { ADMIN: "director", MANAGER: "sales_mgr", SALES: "sales" };
async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: 业务角色of[role] } });
  return { id: u.id, name, role };
}
async function 客户(ownerId: string, name = "测试客户") {
  return (await prisma.customer.create({ data: { name, phone: `139${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
}
async function 项目(ownerId: string, customerId: string, name = "一号项目") {
  return (await prisma.project.create({ data: { name, customerId, ownerId, creatorId: ownerId } })).id;
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 列表 = (u: 人) => { 当(u); return 以谁的身份(u.id, async () => (await 读项目列表(u, { pool: "1" })).行.map((r) => r.id)); };
const 公海页项目 = (u: 人) => { 当(u); return 以谁的身份(u.id, async () => (await 读公海页(u, {}, 1, 100)).行.filter((r) => r.种 === "项目").map((r) => r.projectId)); };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  公海规则.项目能单独领 = true;
  老板 = await 造人("boss", "老板", "ADMIN");
  经理 = await 造人("mgr", "经理", "MANAGER");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
});
afterEach(() => {
  vi.unstubAllEnvs();
  公海规则.项目能单独领 = false;
  公海规则.原负责人看得到公海项目 = false;
  忘掉企业版范围();
});

describe("公海按客户来源筛不漏客户（11-06 自定义筛选）", () => {
  const 造渠道 = async (name: string) => (await prisma.channel.create({ data: { name, channelOwnerId: 老板.id } })).id;
  const 按来源 = (u: 人, channelId: string) => { 当(u); return 以谁的身份(u.id, async () => (await 读项目列表(u, { pool: "1", channelId })).行.map((r) => r.id)); };
  const 公海页按来源 = (u: 人, 来源: string) => { 当(u); return 以谁的身份(u.id, async () => (await 读公海页(u, { 来源 }, 1, 100)).行.filter((r) => r.种 === "项目").map((r) => r.projectId)); };

  it("公海里同事客户的项目：业务员看不到客户，就不能用客户的来源筛中它；项目自己选的来源能筛；老板都能", async () => {
    // 规则「按组织看客户」关着时谁都看得到客户，要开着才分得出来
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    const [客户来源, 项目来源] = [await 造渠道("客户的来源"), await 造渠道("项目的来源")];
    // 客户归丙、项目归丁：放回项目时客户不跟进公海（负责人不同，pool-link.ts），乙就看不到这位客户。
    // 项目各挂一位客户，否则同负责人的多项目客户会整体连带进公海（X-12）
    const 丁 = await 造人("ding", "丁", "SALES");
    const [c1, c2] = [await 客户(丙.id, "客户一"), await 客户(丙.id, "客户二")];
    await prisma.customer.updateMany({ where: { id: { in: [c1, c2] } }, data: { channelId: 客户来源 } });
    const 没选 = await 项目(丁.id, c1, "没选来源");
    const 选了 = await 项目(丁.id, c2, "选了来源");
    await prisma.project.update({ where: { id: 选了 }, data: { channelId: 项目来源 } });
    当(丁);
    expect(await 放回公海(丁, 没选)).toEqual({ ok: true });
    expect(await 放回公海(丁, 选了)).toEqual({ ok: true });

    expect(await 列表(乙)).toEqual(expect.arrayContaining([没选, 选了]));
    expect(await 按来源(乙, 客户来源)).toEqual([]);
    expect(await 公海页按来源(乙, 客户来源)).toEqual([]);
    expect(await 按来源(乙, 项目来源)).toEqual([选了]);
    expect(await 公海页按来源(乙, 项目来源)).toEqual([选了]);

    expect(await 按来源(老板, 客户来源)).toEqual([没选]);
    expect(await 公海页按来源(老板, 客户来源)).toEqual([没选]);
  });
});

describe("进公海清负责人", () => {
  it("放回公海：负责人清空，留痕记乙 = 历史负责人", async () => {
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p)).toEqual({ ok: true });
    const 现 = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    expect(现.pooledAt).not.toBeNull();
    expect(现.ownerId).toBe(公海无负责人);
    expect(await 历史负责人(prisma, p)).toBe(乙.id);
  });

  it("不是企业版：负责人照旧留着，不回避", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p)).toEqual({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(乙.id);
    expect(await 我回避的公海项目(prisma, 乙.id)).toEqual([]);
  });
});

describe("领取：只认历史负责人", () => {
  it("原负责人领不回，别人能领；领取留痕的 from 是历史负责人", async () => {
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 领取公海项目(乙, p)).toEqual({ ok: false, error: "原负责人不能领回" });
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ ownerId: 丙.id, pooledAt: null });
    expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p, kind: "pool-claim" } })).toMatchObject({ fromOwnerId: 乙.id, toOwnerId: 丙.id });
  });

  it("只认最后一次进公海前的那位：丙领了再放回，乙能领、丙领不回", async () => {
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    await 领取公海项目(丙, p);
    await 放回公海(丙, p);
    expect(await 历史负责人(prisma, p)).toBe(丙.id);
    expect(await 领取公海项目(丙, p)).toEqual({ ok: false, error: "原负责人不能领回" });
    expect(await 领取公海项目(乙, p)).toEqual({ ok: true });
  });
});

describe("历史负责人看不到", () => {
  it("项目公海列表、统一公海页、单个项目认权限都挡乙；丙、老板、主管看得到", async () => {
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 我回避的公海项目(prisma, 乙.id)).toEqual([p]);

    expect(await 列表(乙)).not.toContain(p);
    expect(await 列表(丙)).toContain(p);
    expect(await 列表(老板)).toContain(p);
    expect(await 列表(经理)).toContain(p);

    expect(await 公海页项目(乙)).not.toContain(p);
    expect(await 公海页项目(丙)).toContain(p);

    const 公海里 = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    expect(await 原负责人挡着(prisma, 乙, 公海里)).toBe(true);
    expect(await 原负责人挡着(prisma, 丙, 公海里)).toBe(false);
    expect(await 原负责人挡着(prisma, 老板, 公海里)).toBe(false);
    expect(await 原负责人挡着(prisma, 经理, 公海里)).toBe(false);
  });

  it("别人领走后就不在公海了，乙也不再回避；开关「原负责人看得到公海项目」开着不挡", async () => {
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    公海规则.原负责人看得到公海项目 = true;
    expect(await 我回避的公海项目(prisma, 乙.id)).toEqual([]);
    expect(await 列表(乙)).toContain(p);
    公海规则.原负责人看得到公海项目 = false;
    await 领取公海项目(丙, p);
    expect(await 我回避的公海项目(prisma, 乙.id)).toEqual([]);
    expect(await 原负责人挡着(prisma, 乙, await prisma.project.findUniqueOrThrow({ where: { id: p } }))).toBe(false);
  });
});

describe("进公海关原负责人待办", () => {
  it("客户归别人：乙在这位客户上没做完的待办都关掉，记录留着；做完的、别人的、别的客户上的不动", async () => {
    const c = await 客户(老板.id);
    const 别的客户 = await 客户(乙.id, "另一位客户");
    const p = await 项目(乙.id, c);
    await 项目(乙.id, 别的客户, "别的项目");
    const 没做完 = await prisma.task.create({ data: { title: "回个电话", customerId: c, ownerId: 乙.id } });
    const 做完了 = await prisma.task.create({ data: { title: "发资料", customerId: c, ownerId: 乙.id, done: true } });
    const 别人的 = await prisma.task.create({ data: { title: "约见面", customerId: c, ownerId: 丙.id } });
    const 别处的 = await prisma.task.create({ data: { title: "送样品", customerId: 别的客户, ownerId: 乙.id } });
    await 放回公海(乙, p);
    const 看 = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    expect(await 看(没做完.id)).toMatchObject({ done: true, ownerId: 乙.id, title: `回个电话${进公海关待办尾}` });
    expect((await 看(没做完.id)).doneAt).not.toBeNull();
    expect(await 看(做完了.id)).toMatchObject({ done: true, title: "发资料" });
    expect(await 看(别人的.id)).toMatchObject({ done: false, title: "约见面" });
    expect(await 看(别处的.id)).toMatchObject({ done: false, title: "送样品" });
  });

  it("客户还归乙（名下有没结束的订单项目，客户不进公海）：只关标题点了这个项目名的", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, "一号项目");
    const 订单 = await 项目(乙.id, c, "二号项目");
    await prisma.project.update({ where: { id: 订单 }, data: { phase: "订单", node: "合同签订" } });
    const 这个 = await prisma.task.create({ data: { title: "「一号项目」该跟进了", customerId: c, ownerId: 乙.id } });
    const 那个 = await prisma.task.create({ data: { title: "「二号项目」该跟进了", customerId: c, ownerId: 乙.id } });
    const 客户上的 = await prisma.task.create({ data: { title: "回个电话", customerId: c, ownerId: 乙.id } });
    await 放回公海(乙, p);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 这个.id } })).done).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 那个.id } })).done).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 客户上的.id } })).done).toBe(false);
  });

  it("开关关了 / 不是企业版：不关", async () => {
    公海规则.进公海关原负责人待办 = false;
    try {
      const c = await 客户(老板.id);
      const p = await 项目(乙.id, c);
      const t = await prisma.task.create({ data: { title: "回个电话", customerId: c, ownerId: 乙.id } });
      await 放回公海(乙, p);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).done).toBe(false);
    } finally {
      公海规则.进公海关原负责人待办 = true;
    }
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c2 = await 客户(老板.id);
    const p2 = await 项目(乙.id, c2);
    const t2 = await prisma.task.create({ data: { title: "回个电话", customerId: c2, ownerId: 乙.id } });
    await 放回公海(乙, p2);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t2.id } })).done).toBe(false);
  });
});
