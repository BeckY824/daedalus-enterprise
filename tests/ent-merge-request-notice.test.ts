/**
 * 合并客户第二批 2b-3 第二段 · 合并申请的 7 种通知（lib/enterprise/merge-request.ts「通知」一节；P-界面-67）：
 *   - 收到申请、有人同意、有人拒绝、已失效、已合并、已作废、已撤回，站内铃铛（EntNotice）一条 = 飞书同一份
 *   - 句式「谁 + 对哪张申请 + 结果」，不带号码，链到合并申请页；做这件事的人自己不收（已合并除外）
 *   - 同一人同一张申请按 key 去重：重复扫过期、重复点不会多发；按申请执行的合并不再另发第一批「已并入」那条给发起人和同意人
 *   - 按号放行进来、发起人看不到的那家：给发起人的通知不写它的名字（拒绝原因里提到也换掉），同意人照常看到名字
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
const 登录 = vi.hoisted(() => ({ 人: null as null | { id: string; name: string; role: string } }));
/** 执行那一刻才进交接：从第 从第几次 次查「交接中的客户」起，把 客户id 算进交接中（0 = 照原样查） */
const 交接钩 = vi.hoisted(() => ({ 客户id: "", 从第几次: 0, 已查: 0 }));
vi.mock("@/lib/enterprise/handover-db", async (orig) => {
  const 原 = await orig<typeof import("@/lib/enterprise/handover-db")>();
  return {
    ...原,
    交接中的客户: async (...a: Parameters<typeof 原.交接中的客户>) => {
      const 中 = await 原.交接中的客户(...a);
      if (交接钩.从第几次 && ++交接钩.已查 >= 交接钩.从第几次 && a[0].includes(交接钩.客户id)) 中.add(交接钩.客户id);
      return 中;
    },
  };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), requireUser: async () => ({ email: "", title: "", ...登录.人! }) }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围, 以谁的身份 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 合并通知种类, 撤回期限天数, 并掉看不到话 } from "@/lib/enterprise/customer-merge";
import {
  发起合并申请, 处理合并申请, 撤回合并申请, 作废合并申请, 扫过期合并申请, 申请状态, 合并申请通知种类, 看不到那家叫法, 申请两家话, 给发起人藏名, 到期话,
} from "@/lib/enterprise/merge-request";
import { 发起客户合并申请, 处理客户合并申请, 我发起的合并申请, 等我同意的合并申请 } from "@/app/(app)/customers/merge-actions";
import { 合并申请页, 撤回天数, 拒绝原因上限 } from "@/app/(app)/customers/merge-request-words";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 乙: 人, 丙: 人, 丁: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string, 补: Record<string, unknown> = {}) {
  序++;
  return (await raw.customer.create({
    data: { name: `测试客户${序}`, phone: "", salesOwnerId: ownerId, contacts: { create: { name: `联系人${序}`, phone: `1390002${String(序).padStart(4, "0")}`, isPrimary: true } }, ...补 },
  })).id;
}
async function 项目(ownerId: string, customerId: string) {
  return (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId } })).id;
}
/** 某人收到的合并申请通知（标题、正文、链接），按先后 */
async function 收到(u: 人) {
  await 等通知推完();
  return raw.entNotice.findMany({ where: { userId: u.id, kind: 合并申请通知种类 }, orderBy: { createdAt: "asc" }, select: { title: true, body: true, link: true } });
}
const 标题们 = async (u: 人) => (await 收到(u)).map((n) => n.title);
const 周五下午 = new Date("2026-11-27T07:00:00Z");

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  丁 = await 造人("ding", "丁", "SALES");
  await raw.entMember.createMany({
    data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }, { userId: 丁.id, bizRole: "sales" }],
  });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  Object.assign(交接钩, { 客户id: "", 从第几次: 0, 已查: 0 });
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

/** 乙发起：B（丙负责）并进 A（乙负责），A 名下有丁的项目 → 丙、丁要同意 */
async function 一张(现在?: Date) {
  const a = await 客户(乙.id), b = await 客户(丙.id);
  await 项目(丁.id, a);
  const r = await 发起合并申请(prisma, a, b, 乙, { 现在 });
  if (!r.ok) throw new Error(r.error);
  const 名 = async (id: string) => (await raw.customer.findUniqueOrThrow({ where: { id } })).name;
  return { a, b, id: r.requestId, 两家: `「${await 名(b)}」并进「${await 名(a)}」` };
}

describe("七种通知：谁收、怎么说", () => {
  it("收到申请 → 有人同意 → 已合并：每位同意人收到申请（写明身份、到期），发起人收同意进度，合并后人人一条；都链合并申请页、不带号码", async () => {
    const { id, 两家 } = await 一张(new Date("2026-11-26T02:00:00Z"));
    const 丙收 = await 收到(丙);
    expect(丙收).toEqual([{ title: `乙发来合并申请：${两家}，要你同意`, body: "你是并进来那家的客户负责人。2026-12-03 10:00 前没全部同意，申请失效", link: 合并申请页 }]);
    expect((await 收到(丁))[0]).toMatchObject({ title: `乙发来合并申请：${两家}，要你同意`, body: expect.stringMatching(/^你是项目负责人，涉及你的 1 个项目。/) });
    expect(await 收到(乙)).toEqual([]);

    expect(await 处理合并申请(prisma, id, 丙, "同意")).toMatchObject({ ok: true, 状态: 申请状态.待同意 });
    expect(await 收到(乙)).toEqual([{ title: `丙同意了你的合并申请：${两家}`, body: "还差 1 位同意", link: 合并申请页 }]);
    expect(await 标题们(丙)).toHaveLength(1);

    expect(await 处理合并申请(prisma, id, 丁, "同意")).toMatchObject({ ok: true, 状态: 申请状态.已合并 });
    expect((await 标题们(乙)).at(-1)).toBe(`你发起的合并申请${两家}已合并`);
    expect((await 收到(乙)).at(-1)!.body).toMatch(/30 天内可在留下那家的「历史变更」里整单撤回/);
    // 最后点同意的丁也收一条（原型），没有多出「丁同意了」那条给乙
    expect((await 标题们(丁)).at(-1)).toBe(`你同意的合并申请${两家}已合并`);
    expect((await 标题们(丙)).at(-1)).toBe(`你同意的合并申请${两家}已合并`);
    expect((await 标题们(乙)).filter((t) => t.startsWith("丁同意了"))).toEqual([]);
    // 第一批「已并入」那条不再给发起人、同意人重复发
    expect(await raw.entNotice.count({ where: { kind: 合并通知种类, userId: { in: [乙.id, 丙.id, 丁.id] } } })).toBe(0);
    // 全部不带号码
    const 全 = await raw.entNotice.findMany({ where: { kind: 合并申请通知种类 } });
    expect(全.every((n) => !/1390002/.test(n.title + n.body))).toBe(true);
  });

  it("有人拒绝：发起人收原因，其余同意人（已同意的、还没处理的）收「不用再处理」，拒绝的人自己不收", async () => {
    const a = await 客户(乙.id), b = await 客户(丙.id);
    await 项目(丁.id, b);
    const 戊 = await 造人("wu", "戊", "SALES");
    await raw.entMember.create({ data: { userId: 戊.id, bizRole: "sales" } });
    await 项目(戊.id, a);
    忘掉企业版范围();
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    await 处理合并申请(prisma, r.requestId, 丁, "同意");
    expect(await 处理合并申请(prisma, r.requestId, 丙, "拒绝", { 原因: "不是同一家" })).toMatchObject({ ok: true, 状态: 申请状态.已拒绝 });
    const 乙最后 = (await 收到(乙)).at(-1)!;
    expect(乙最后.title).toMatch(/^丙拒绝了你的合并申请：「测试客户\d+」并进「测试客户\d+」$/);
    expect(乙最后.body).toBe("原因：不是同一家。要并可以改了再发一张");
    expect((await 收到(丁)).at(-1)).toMatchObject({ title: expect.stringMatching(/^丙拒绝了合并申请：/), body: "原因：不是同一家。不用再处理" });
    expect((await 收到(戊)).at(-1)).toMatchObject({ title: expect.stringMatching(/^丙拒绝了合并申请：/) });
    expect((await 标题们(丙)).filter((t) => t.includes("拒绝"))).toEqual([]);
  });

  it("没写原因：发起人那条写「没写原因」", async () => {
    const { id } = await 一张();
    await 处理合并申请(prisma, id, 丙, "拒绝");
    expect((await 收到(乙)).at(-1)!.body).toBe("没写原因。要并可以改了再发一张");
  });

  it("已失效（到期扫）：发起人和同意人各一条；再扫一遍不重复", async () => {
    const { id, 两家 } = await 一张(周五下午);
    expect(await 扫过期合并申请(prisma, new Date("2026-12-04T07:00:00Z"))).toBe(1);
    expect(await 扫过期合并申请(prisma, new Date("2026-12-04T07:05:00Z"))).toBe(0);
    expect((await 收到(乙)).at(-1)).toMatchObject({ title: `你发起的合并申请${两家}没在 5 个工作日内全部同意，已失效`, body: "要并请重新发起" });
    expect((await 收到(丙)).at(-1)).toMatchObject({ title: `合并申请${两家}没在 5 个工作日内全部同意，已失效`, body: "不用再处理" });
    expect((await 标题们(丁)).filter((t) => t.includes("已失效"))).toHaveLength(1);
    expect((await raw.entMergeRequest.findUniqueOrThrow({ where: { id } })).status).toBe(申请状态.已失效);
  });

  it("到期那一刻点同意：点的人看到报错、不收通知，发起人和别的同意人收已失效", async () => {
    const { id } = await 一张(周五下午);
    expect(await 处理合并申请(prisma, id, 丙, "同意", { 现在: new Date("2026-12-04T07:00:00Z") })).toMatchObject({ ok: false });
    expect((await 标题们(乙)).at(-1)).toMatch(/已失效$/);
    expect((await 标题们(丁)).at(-1)).toMatch(/已失效$/);
    expect((await 标题们(丙)).filter((t) => t.includes("已失效"))).toEqual([]);
  });

  it("已作废：四项有变（同意那一刻判出来）写明原因；系统管理员作废写明谁作废，作废的人自己不收", async () => {
    const { id, a } = await 一张();
    const p = (await raw.project.findFirstOrThrow({ where: { customerId: a } })).id;
    await raw.entProjectPayment.create({ data: { projectId: p, paidAt: new Date(), currency: "CNY", amount: 1 } });
    expect((await 处理合并申请(prisma, id, 丙, "同意")).ok).toBe(false);
    expect((await 收到(乙)).at(-1)).toMatchObject({ title: expect.stringMatching(/^你发起的合并申请「.+」并进「.+」已作废$/), body: expect.stringMatching(/有变，申请已失效/) });
    expect((await 收到(丁)).at(-1)!.body).toMatch(/有变，申请已失效.*。不用再处理$/);

    const 二 = await 一张();
    expect(await 作废合并申请(prisma, 二.id, 老板)).toEqual({ ok: true });
    expect((await 收到(乙)).at(-1)).toMatchObject({ title: `你发起的合并申请${二.两家}已作废`, body: "系统管理员老板作废了申请" });
    expect((await 收到(丙)).at(-1)).toMatchObject({ title: `合并申请${二.两家}已作废`, body: "系统管理员老板作废了申请。不用再处理" });
    expect(await raw.entNotice.count({ where: { userId: 老板.id, kind: 合并申请通知种类 } })).toBe(0);
  });

  it("已撤回：同意人收「不用再处理」，发起人自己不收", async () => {
    const { id, 两家 } = await 一张();
    expect(await 撤回合并申请(prisma, id, 乙)).toEqual({ ok: true });
    expect((await 收到(丙)).at(-1)).toMatchObject({ title: `乙撤回了合并申请：${两家}`, body: "不用再处理", link: 合并申请页 });
    expect((await 标题们(丁)).at(-1)).toBe(`乙撤回了合并申请：${两家}`);
    expect((await 标题们(乙)).filter((t) => t.includes("撤回"))).toEqual([]);
  });

  it("客户名是号码：通知里换成客户编号，不带号码", async () => {
    const a = await 客户(乙.id, { name: "13900021234", customerNo: 77 });
    const b = await 客户(丙.id);
    const r = await 发起合并申请(prisma, a, b, 乙);
    if (!r.ok) throw new Error(r.error);
    const t = (await 标题们(丙))[0];
    expect(t).not.toMatch(/13900021234/);
    expect(t).toMatch(/并进「客户 /);
  });
});

describe("按号放行进来、发起人看不到的那家", () => {
  it("给发起人的通知、「我发起的」列表不写它的名字（拒绝原因里提到也换掉）；同意人照常看到名字", async () => {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id, { name: "看不到的同事客户", customerNo: 42 });
    登录.人 = 乙;
    await setSetting(规则.按组织看客户.key, true);
    忘掉企业版范围();
    const 号 = (await raw.contact.findFirstOrThrow({ where: { customerId: b } })).phone!;
    const id = await 以谁的身份(乙.id, async () => {
      expect(await prisma.customer.count({ where: { id: b } })).toBe(0);
      const r = await 发起客户合并申请(a, b, { 按号: 号 });
      if (!r.ok) throw new Error(r.error);
      return r.requestId;
    });
    const 单 = await raw.entMergeRequest.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(单.choices)).toMatchObject({ 并掉看不到: true, 并掉编号: 42 });
    expect(申请两家话(单, true)).toMatch(/^「同事负责的客户（号码撞上） 42」并进「测试客户\d+」$/);
    expect(看不到那家叫法(null)).toBe("同事负责的客户（号码撞上）");
    expect(给发起人藏名(单, "原因：看不到的同事客户还在跟")).toBe("原因：同事负责的客户（号码撞上） 42还在跟");
    // 同意人丙看得到自己那家：收到申请里写名字
    expect((await 标题们(丙))[0]).toContain("「看不到的同事客户」");

    登录.人 = 丙;
    expect((await 等我同意的合并申请())[0].并掉.名).toBe("看不到的同事客户");
    expect(await 处理客户合并申请(id, "拒绝", "看不到的同事客户还在跟")).toMatchObject({ ok: true });
    const 乙收 = await 收到(乙);
    expect(乙收).toHaveLength(1);
    expect(JSON.stringify(乙收)).not.toContain("看不到的同事客户");
    expect(乙收[0].title).toContain("同事负责的客户（号码撞上） 42");
    expect(乙收[0].body).toBe("原因：同事负责的客户（号码撞上） 42还在跟。要并可以改了再发一张");

    登录.人 = 乙;
    const 我的 = await 以谁的身份(乙.id, () => 我发起的合并申请());
    expect(我的[0].并掉.名).toBe("同事负责的客户（号码撞上） 42");
    expect(JSON.stringify(我的)).not.toContain("看不到的同事客户");
  });
});

describe("按号进来、发起后那家状态变了：失效 / 作废原因不带它的名字和状态（2b-3 第二段审查第 1、2 条）", () => {
  /** 乙按号发起：B（丙负责、乙看不到、名下有丙的项目）并进 A（乙负责）→ 只等丙同意 */
  async function 按号一张() {
    const a = await 客户(乙.id);
    const b = await 客户(丙.id, { name: "编造的看不到客户", customerNo: 42 });
    const p = (await raw.project.create({ data: { name: "编造的保密项目", customerId: b, ownerId: 丙.id, creatorId: 丙.id } })).id;
    await setSetting(规则.按组织看客户.key, true);
    忘掉企业版范围();
    登录.人 = 乙;
    const 号 = (await raw.contact.findFirstOrThrow({ where: { customerId: b } })).phone!;
    const id = await 以谁的身份(乙.id, async () => {
      expect(await prisma.customer.count({ where: { id: b } })).toBe(0);
      const r = await 发起客户合并申请(a, b, { 按号: 号 });
      if (!r.ok) throw new Error(r.error);
      return r.requestId;
    });
    // 发起后 B 改了名
    await raw.customer.update({ where: { id: b }, data: { name: "编造的改后名字" } });
    return { a, b, p, id };
  }
  const 漏了 = /编造的看不到客户|编造的改后名字|转让交接|编造的保密项目/;
  async function 发起人那边都没漏(a: string, b: string, p: string, id: string) {
    const 乙收 = await 收到(乙);
    expect(乙收.at(-1)).toMatchObject({ title: expect.stringMatching(/已作废$/), body: `${并掉看不到话}，申请已失效` });
    expect(JSON.stringify(乙收)).not.toMatch(漏了);
    const 单 = await raw.entMergeRequest.findUniqueOrThrow({ where: { id } });
    expect(单.reason).toBe(`${并掉看不到话}，申请已失效`);
    const 日志 = await raw.auditLog.findMany({ where: { entityId: { in: [a, b] }, action: "merge-request-void" } });
    expect(日志).toHaveLength(2);
    expect(JSON.stringify(日志)).not.toMatch(漏了);
    登录.人 = 乙;
    const 我的 = await 以谁的身份(乙.id, () => 我发起的合并申请());
    expect(我的[0]).toMatchObject({ id, 状态: 申请状态.已失效, 显示状态: "已作废", 原因: `${并掉看不到话}，申请已失效` });
    const 串 = JSON.stringify(我的);
    expect(串).not.toMatch(漏了);
    expect(串).not.toContain(p);
    expect(串).not.toContain(`"customerId":"${b}"`);
  }

  it("看不到那家进了转让交接、改了名：同意那一刻判出作废，发起人的通知、「我发起的」、两家日志都不写它的名字和状态", async () => {
    const { a, b, p, id } = await 按号一张();
    await raw.entHandover.create({ data: { kind: "转让", fromUserId: 丙.id, toUserId: 丁.id, byUserId: 老板.id, customerIds: JSON.stringify([b]) } });
    expect(await 处理合并申请(prisma, id, 丙, "同意")).toEqual({ ok: false, error: `${并掉看不到话}，申请已失效` });
    await 发起人那边都没漏(a, b, p, id);
  });

  it("最后一位同意、再判过了、执行时才被拦（这时进了交接）：作废通知、原因、日志都不写它的名字和状态", async () => {
    const { a, b, p, id } = await 按号一张();
    // 第 1 次查交接是同意那一刻的再判，第 2 次是执行合并事务里那一遍
    Object.assign(交接钩, { 客户id: b, 从第几次: 2, 已查: 0 });
    expect(await 处理合并申请(prisma, id, 丙, "同意")).toEqual({ ok: false, error: `${并掉看不到话}，申请已失效` });
    expect(交接钩.已查).toBe(2);
    expect(await raw.customer.count({ where: { id: b, deletedAt: null } })).toBe(1);
    await 发起人那边都没漏(a, b, p, id);
  });

  it("「我发起的」：同意人涉及的项目在看不到那家名下 → 项目给 []、项目数照实；同意人那边照常列", async () => {
    const { p, id } = await 按号一张();
    登录.人 = 乙;
    const 我的 = await 以谁的身份(乙.id, () => 我发起的合并申请());
    expect(我的[0].同意人).toMatchObject([{ userId: 丙.id, 项目: [], 项目数: 1 }]);
    expect(JSON.stringify(我的)).not.toMatch(漏了);
    expect(JSON.stringify(我的)).not.toContain(p);
    登录.人 = 丙;
    const 等我 = await 等我同意的合并申请();
    expect(等我.find((x) => x.id === id)!.同意人[0]).toMatchObject({ 项目: [{ id: p, name: "编造的保密项目" }], 项目数: 1 });
  });
});

describe("显示状态：已失效里分出已作废（2b-3 第二段审查第 4 条）", () => {
  it("到期 = 已失效；系统管理员作废、四项有变 = 已作废；拒绝、待同意同 状态", async () => {
    const 到期 = await 一张(周五下午);
    await 扫过期合并申请(prisma, new Date("2026-12-04T07:00:00Z"));
    const 管作废 = await 一张();
    await 作废合并申请(prisma, 管作废.id, 老板);
    const 有变 = await 一张();
    const pid = (await raw.project.findFirstOrThrow({ where: { customerId: 有变.a } })).id;
    await raw.entProjectPayment.create({ data: { projectId: pid, paidAt: new Date(), currency: "CNY", amount: 1 } });
    await 处理合并申请(prisma, 有变.id, 丙, "同意");
    const 拒 = await 一张();
    await 处理合并申请(prisma, 拒.id, 丙, "拒绝");
    const 等 = await 一张();
    登录.人 = 乙;
    const 们 = new Map((await 以谁的身份(乙.id, () => 我发起的合并申请())).map((x) => [x.id, x]));
    expect(们.get(到期.id)).toMatchObject({ 状态: 申请状态.已失效, 显示状态: 申请状态.已失效, 原因: 到期话 });
    expect(们.get(管作废.id)).toMatchObject({ 状态: 申请状态.已失效, 显示状态: "已作废" });
    expect(们.get(有变.id)).toMatchObject({ 状态: 申请状态.已失效, 显示状态: "已作废" });
    expect(们.get(拒.id)).toMatchObject({ 状态: 申请状态.已拒绝, 显示状态: 申请状态.已拒绝 });
    expect(们.get(等.id)).toMatchObject({ 状态: 申请状态.待同意, 显示状态: 申请状态.待同意 });
  });
});

describe("界面常量和服务端一致；拒绝原因上限服务端也拦", () => {
  it("数据层 处理合并申请 也按上限拒收、回同一句话，不截断；100 字原样存", async () => {
    const { id } = await 一张();
    expect(await 处理合并申请(prisma, id, 丙, "拒绝", { 原因: "字".repeat(拒绝原因上限 + 1) })).toEqual({ ok: false, error: "拒绝原因最多 100 字" });
    expect((await raw.entMergeRequest.findUniqueOrThrow({ where: { id } })).status).toBe(申请状态.待同意);
    expect(await 处理合并申请(prisma, id, 丙, "拒绝", { 原因: `  ${"字".repeat(拒绝原因上限)}  ` })).toMatchObject({ ok: true, 状态: 申请状态.已拒绝 });
    const 行 = await raw.entMergeApprover.findFirstOrThrow({ where: { requestId: id, userId: 丙.id } });
    expect(行.note).toBe("字".repeat(拒绝原因上限));
  });

  it("撤回天数 = 撤回期限天数；拒绝原因超 100 字动作层拒、不悄悄截，100 字照收", async () => {
    expect(撤回天数).toBe(撤回期限天数);
    const { id } = await 一张();
    登录.人 = 丙;
    expect(await 处理客户合并申请(id, "拒绝", "字".repeat(拒绝原因上限 + 1))).toEqual({ ok: false, error: "拒绝原因最多 100 字" });
    expect((await raw.entMergeRequest.findUniqueOrThrow({ where: { id } })).status).toBe(申请状态.待同意);
    expect(await 处理客户合并申请(id, "拒绝", "字".repeat(拒绝原因上限))).toMatchObject({ ok: true, 状态: 申请状态.已拒绝 });
  });
});
