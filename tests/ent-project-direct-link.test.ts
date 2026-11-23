/**
 * 跳转优化 PR-A 补：站内入口去项目时直接给 /projects/<id> 会跳去的最终地址（lib/project/customer-detail-direct.ts），
 * 不经过 Next 的 RedirectBoundary（它接住重定向先把正文渲染成空，约 130ms 空白）。
 * 钉的是：入口生成的地址 = 项目页那条重定向的落点，一种人、一种项目都不多露——
 *   - 项目链接们 逐个对拍 项目页去向 + 真打开 ProjectPage 抛出的 REDIRECT（自己的、同事的、没有的、公海里的、我是公海项目上一任的、只负责项目的、关联到别家客户的）
 *   - 改直达链接们（通知存着的链接）：?giveup=1 跟着带过去，别的参数照项目页那条跳转丢掉；不是项目页的链接原样
 *   - 各入口的取数真带上了：通知铃（读我的通知）、复盘「还没沟通过的项目」、待复核、首页待办的「新分到你的线索」
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import { 项目页去向 } from "@/app/(app)/projects/[id]/load";
import { 项目链接们, 改直达链接们, 补项目去, 项目页地址 } from "@/lib/project/customer-detail-direct";
import { 读我的通知 } from "@/app/(app)/notice-actions";
import { 缺沟通of } from "@/lib/project/review-extras-db";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, managerId?: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(managerId ? { managerId } : {}) } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
/** 真打开 /projects/<id>（可带 ?giveup=1）：跳了 = 跳去的地址；没跳 = 照原样给的那个链接（留在项目页、404、放弃不了的那句） */
const 打开落点 = async (u: 人, id: string, giveup = false): Promise<string> => {
  const 原 = `/projects/${encodeURIComponent(id)}${giveup ? "?giveup=1" : ""}`;
  try {
    await 以(u, () => ProjectPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(giveup ? { giveup: "1" } : {}) } as never));
    return 原;
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    return m ? m[1] : 原;
  }
};

let 总管: 人, 经理: 人, 甲: 人, 乙: 人, 丙: 人;
let 客户: string, 别家: string;
const 项: Record<string, string> = {};
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  总管 = await 造人("zong", "admin");
  经理 = await 造人("jingli", "sales_manager");
  甲 = await 造人("jia", "sales", 经理.id);
  乙 = await 造人("yi", "sales");
  丙 = await 造人("bing", "sales");
  客户 = (await prisma.customer.create({ data: { name: "直达客户", phone: "13900000021", salesOwnerId: 甲.id } })).id;
  别家 = (await prisma.customer.create({ data: { name: "别家客户", phone: "13900000022", salesOwnerId: 乙.id } })).id;
  const 建 = (name: string, customerId: string, ownerId: string, x: object = {}) =>
    prisma.project.create({ data: { name, customerId, ownerId, creatorId: ownerId, phase: "商机", node: "需求确认", ...x } }).then((p) => p.id);
  项.我的 = await 建("甲的项目", 客户, 甲.id);
  项.结束的 = await 建("甲结束的项目", 客户, 甲.id, { result: "丢单" });
  项.同事的 = await 建("乙在甲客户上的项目", 客户, 乙.id);
  项.别家的 = await 建("乙自己客户的项目", 别家, 乙.id);
  // 丙只负责项目、客户归甲：丙看不到客户，进受限客户详情（仅项目）
  项.丙的 = await 建("丙负责的项目", 客户, 丙.id);
  // 公海里的：乙放进去的（甲不是上一任）；甲放进去的（甲是上一任，回避）；没有放公海痕、负责人格还是甲的
  项.公海乙放 = await 建("乙放公海的项目", 客户, 乙.id, { pooledAt: new Date() });
  项.公海甲放 = await 建("甲放公海的项目", 客户, 乙.id, { pooledAt: new Date() });
  项.公海无痕 = await 建("公海里没痕的项目", 客户, 甲.id, { pooledAt: new Date() });
  await prisma.projectNodeLog.createMany({ data: [
    { projectId: 项.公海乙放, userId: 乙.id, toPhase: "商机", toNode: "需求确认", kind: "pool-release", fromOwnerId: 乙.id },
    { projectId: 项.公海甲放, userId: 甲.id, toPhase: "商机", toNode: "需求确认", kind: "pool-release", fromOwnerId: 甲.id },
  ] });
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("项目链接们 = /projects/<id> 重定向的落点", () => {
  it("每个人 × 每个项目：入口给的地址和真打开项目页跳去的一样；跳客户页的才换，别的照旧 /projects/<id>", async () => {
    const ids = [...Object.values(项), "没有这个"];
    let 换了 = 0;
    for (const u of [总管, 经理, 甲, 乙, 丙]) {
      const 链 = await 以(u, () => 项目链接们(u as never, ids));
      for (const id of ids) {
        const 去向 = await 以(u, () => 项目页去向(u as never, id));
        const 落点 = await 打开落点(u, id);
        const 该给 = 去向.种 === "客户页" ? 去向.到 : 项目页地址(id);
        expect({ 人: u.name, id, 给: 链.get(id) }).toEqual({ 人: u.name, id, 给: 该给 });
        // 给的是客户页 ⇔ 项目页真跳了客户页（不多露：项目页不跳的，入口也不给客户页）
        if (链.get(id) !== 项目页地址(id)) {
          换了++;
          expect({ 人: u.name, id, 落点 }).toEqual({ 人: u.name, id, 落点: 链.get(id) });
        } else expect(落点.startsWith("/customers/") && 落点.includes("project=")).toBe(false);
      }
    }
    // 对拍不能全是「照旧」：这几种必须真换成客户页
    expect(换了).toBeGreaterThan(5);
    const 甲链 = await 以(甲, () => 项目链接们(甲 as never, [项.我的, 项.结束的, 项.同事的, 项.公海乙放, 项.公海甲放, 项.公海无痕]));
    expect(甲链.get(项.我的)).toBe(`/customers/${客户}?project=${项.我的}`);
    expect(甲链.get(项.结束的)).toBe(`/customers/${客户}?project=${项.结束的}`);
    expect(甲链.get(项.同事的)).toBe(`/projects/${项.同事的}`);
    // 公海：上一任是我的回避（项目页 404），别人放的照样跳客户页
    expect(甲链.get(项.公海甲放)).toBe(`/projects/${项.公海甲放}`);
    expect(甲链.get(项.公海无痕)).toBe(`/projects/${项.公海无痕}`);
    expect(await 打开落点(甲, 项.公海甲放)).toBe(`/projects/${项.公海甲放}`);
    // 只负责项目的人：受限客户详情
    expect((await 以(丙, () => 项目链接们(丙 as never, [项.丙的]))).get(项.丙的)).toBe(`/customers/${客户}?project=${项.丙的}`);
  });

  it("总管理（回避豁免）：公海里上一任是自己的也跳客户页，和项目页一致", async () => {
    const 总管放 = await prisma.project.create({ data: { name: "总管放公海的", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "需求确认", pooledAt: new Date() } });
    await prisma.projectNodeLog.create({ data: { projectId: 总管放.id, userId: 总管.id, toPhase: "商机", toNode: "需求确认", kind: "pool-release", fromOwnerId: 总管.id } });
    const 给 = (await 以(总管, () => 项目链接们(总管 as never, [总管放.id]))).get(总管放.id);
    expect(给).toBe(await 打开落点(总管, 总管放.id));
  });

  it("关联到别家客户的项目（客户页「参与的项目」）：落到项目主客户的客户页，不是当前这位", async () => {
    const 链 = await 以(乙, () => 项目链接们(乙 as never, [项.别家的]));
    expect(链.get(项.别家的)).toBe(`/customers/${别家}?project=${项.别家的}`);
    expect(await 打开落点(乙, 项.别家的)).toBe(链.get(项.别家的));
  });

  it("非企业版：一律照旧 /projects/<id>（项目页不跳）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect((await 以(甲, () => 项目链接们(甲 as never, [项.我的]))).get(项.我的)).toBe(`/projects/${项.我的}`);
  });
});

describe("改直达链接们（通知存着的链接）", () => {
  it("带 ?giveup=1 的跟项目页一样带过去；别的参数照项目页那条跳转丢；不是项目页 / 带 # / 拿不准的原样", async () => {
    const 链接们 = [
      `/projects/${项.我的}`,
      `/projects/${项.我的}?giveup=1`,
      `/projects/${项.我的}?crec=x1`,
      `/projects/${项.同事的}`,
      `/projects/${项.我的}#project-follow`,
      "/projects",
      `/customers/${客户}`,
      null,
    ];
    const 到 = await 以(甲, () => 改直达链接们(甲 as never, 链接们));
    expect(到).toEqual([
      `/customers/${客户}?project=${项.我的}`,
      `/customers/${客户}?project=${项.我的}&giveup=1`,
      `/customers/${客户}?project=${项.我的}`,
      `/projects/${项.同事的}`,
      `/projects/${项.我的}#project-follow`,
      "/projects",
      `/customers/${客户}`,
      null,
    ]);
    // 和真打开项目页一致（带 giveup 的那条也是）
    expect(到[0]).toBe(await 打开落点(甲, 项.我的));
    expect(到[1]).toBe(await 打开落点(甲, 项.我的, true));
  });
});

describe("各入口的取数带上了最终地址", () => {
  it("通知铃（读我的通知）：去项目页的换成客户页地址，同事的照旧；放弃项目 照原链接认", async () => {
    await prisma.entNotice.createMany({ data: [
      { userId: 甲.id, kind: "项目组", title: "我的", body: "", link: `/projects/${项.我的}`, dedupeKey: "t1" },
      { userId: 甲.id, kind: "项目组", title: "同事的", body: "", link: `/projects/${项.同事的}`, dedupeKey: "t2" },
      { userId: 甲.id, kind: "项目组", title: "列表", body: "", link: "/projects", dedupeKey: "t3" },
    ] });
    const r = await 以(甲, () => 读我的通知());
    const 按题 = Object.fromEntries(r.行们.map((x) => [x.title, x.link]));
    expect(按题).toEqual({ 我的: `/customers/${客户}?project=${项.我的}`, 同事的: `/projects/${项.同事的}`, 列表: "/projects" });
    expect(按题.我的).toBe(await 打开落点(甲, 项.我的));
  });

  it("复盘「还没沟通过的项目」：给了 我 就每行带 项目去，和项目页落点一致；没给照原样", async () => {
    const 带 = await 以(甲, () => 缺沟通of(甲.id, 甲 as never));
    const 我的行 = 带.行.find((x) => x.id === 项.我的);
    expect(我的行?.项目去).toBe(`/customers/${客户}?project=${项.我的}`);
    expect(我的行?.项目去).toBe(await 打开落点(甲, 项.我的));
    const 不带 = await 以(甲, () => 缺沟通of(甲.id));
    expect(不带.行.every((x) => !("项目去" in x))).toBe(true);
  });

  it("补项目去：只给跳客户页的补，拿不准的不补（界面退回 /projects/<id>）", async () => {
    const 行们 = await 以(甲, () => 补项目去(甲 as never, [{ p: 项.我的 }, { p: 项.同事的 }, { p: null }], (r) => r.p));
    expect(行们.map((r) => r.项目去 ?? 项目页地址(r.p ?? ""))).toEqual([`/customers/${客户}?project=${项.我的}`, `/projects/${项.同事的}`, "/projects/"]);
  });
});
