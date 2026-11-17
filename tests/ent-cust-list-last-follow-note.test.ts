/**
 * 客户列表「最近跟进」一格带上那一句（员工反馈 2I，11-17，从 1C 挪来：「最近跟进（时间 + 一句）」）：
 *   - 时间照旧是 Customer.lastFollowAt（#307「超过 N 天没跟进」筛选、按最近跟进排的同一个字段，全量、不分谁记的）；
 *   - 一句 = 这个时间背后那一条沟通（没删的、发生时间不晚于现在的里最晚的那条）的内容，空白收成一个空格；
 *   - 那一条挂在我看不到的项目上（企业版项目模式，沟通内容按项目可见范围给，同客户页「沟通记录」lib/enterprise/customer-follow-feed.ts）：
 *     只摆时间、不摆一句，也不退回去摆更早那条（时间和一句要对得上）；看全部的人照摆；
 *   - 从没跟进过的不给（列里照旧「—」）；一页一次取，不随行数加查询。
 * 打开页面的量法同 tests/ent-cust-list-country-idle.test.ts：CustomersView 换成空的，拿它收到的 props 看
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  在请求: false,
}));
vi.mock("next/headers", async (原) => ({
  ...(await 原<object>()),
  cookies: async () => {
    if (!mocks.在请求) throw new Error("不在请求里");
    return { get: () => undefined };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/customers/CustomersView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/HandoverPending", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/ProjectsView", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomersPage from "@/app/(app)/customers/page";
import { dayjs } from "@/lib/utils";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};
type 视图参数 = { rows: { id: string; name: string; lastFollowAt: string | null }[]; 最近一句?: Record<string, string> };

async function 打开(sp: Record<string, string>, 谁: 人): Promise<视图参数> {
  mocks.user = { ...谁 };
  mocks.在请求 = true;
  try {
    const el = await 以谁的身份(谁.id, () => (CustomersPage as (a: never) => Promise<unknown>)({ searchParams: Promise.resolve(sp) } as never));
    return (el as { props: 视图参数 }).props;
  } finally { mocks.在请求 = false; }
}
/** 客户名 → 那一句（没有的不出现） */
const 句们 = (p: 视图参数) => Object.fromEntries(p.rows.flatMap((r) => (p.最近一句?.[r.id] ? [[r.name, p.最近一句[r.id]]] : [])));

let 甲: 人, 乙: 人, 老板: 人;
let 号 = 0;
const 前 = (d: number) => dayjs().subtract(d, "day").toDate();
const 客户 = async (name: string, ownerId: string) =>
  (await prisma.customer.create({ data: { name, salesOwnerId: ownerId, phone: `1390000${String(++号).padStart(4, "0")}`, createdAt: 前(400) } })).id;
async function 记(customerId: string, ownerId: string, content: string, occurredAt: Date, 挂: { projectId?: string; 删了?: boolean } = {}) {
  const f = await prisma.followUp.create({ data: { type: "PHONE", title: "", content, customerId, ownerId, occurredAt, ...(挂.删了 ? { deletedAt: new Date() } : {}) } });
  if (挂.projectId) await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: 挂.projectId, node: "lead" } });
}
/** 记沟通时顺手写的那一格：没删的、发生时间不晚于现在的里最晚那条（同 customers/[id]/actions.ts 重算） */
async function 对上最近跟进(customerId: string) {
  const f = await prisma.followUp.findFirst({ where: { customerId, deletedAt: null, occurredAt: { lte: new Date() } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  await prisma.customer.update({ where: { id: customerId }, data: { lastFollowAt: f?.occurredAt ?? null } });
}
const 项目 = async (name: string, customerId: string, ownerId: string) => (await prisma.project.create({ data: { name, customerId, ownerId, creatorId: ownerId } })).id;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  甲 = await 造人("jia", "sales");
  乙 = await 造人("yi", "sales");
  老板 = await 造人("boss", "director");
  忘掉企业版范围();

  const 两条 = await 客户("两条沟通", 甲.id);
  await 记(两条, 甲.id, "早一点的那句", 前(5));
  await 记(两条, 甲.id, "  最新的\n\n一句   话 ", 前(1));
  await 客户("从没跟进", 甲.id);
  // 最晚那条挂在乙负责的项目上（主客户是甲的客户）：甲看不到这个项目（11-01 项目只看负责人范围）
  const 别人项目 = await 客户("最新一条在别人项目上", 甲.id);
  await 记(别人项目, 甲.id, "甲自己更早记的", 前(6));
  await 记(别人项目, 乙.id, "乙项目里的报价细节", 前(2), { projectId: await 项目("乙的项目", 别人项目, 乙.id) });
  const 自己项目 = await 客户("最新一条在自己项目上", 甲.id);
  await 记(自己项目, 甲.id, "自己项目里的一句", 前(3), { projectId: await 项目("甲的项目", 自己项目, 甲.id) });
  // 挂在这位名下删了的项目上：客户页照摆（customer-follow-feed.ts 汇总一页），这里也照给
  const 删项目 = await 客户("最新一条在删了的项目上", 甲.id);
  const 删了的项目 = await 项目("删了的项目", 删项目, 甲.id);
  await 记(删项目, 甲.id, "删了的项目里那句", 前(2), { projectId: 删了的项目 });
  await prisma.project.update({ where: { id: 删了的项目 }, data: { deletedAt: new Date() } });
  // 删了的不算、日期填在以后的不算（最近跟进按「不晚于现在」算）
  const 删了 = await 客户("最晚那条删了", 甲.id);
  await 记(删了, 甲.id, "留着的那句", 前(4));
  await 记(删了, 甲.id, "删掉的那句", 前(1), { 删了: true });
  await 记(删了, 甲.id, "以后的那句", dayjs().add(3, "day").toDate());
  // 超长的一句：截到 120 字，列里一行省略、悬停看全文
  const 长 = await 客户("一句很长", 甲.id);
  await 记(长, 甲.id, "长".repeat(300), 前(2));
  // 同事的客户：甲的列表里本来就没有
  const 同事 = await 客户("同事的客户", 乙.id);
  await 记(同事, 乙.id, "同事的一句", 前(1));
  for (const c of await prisma.customer.findMany({ select: { id: true } })) await 对上最近跟进(c.id);
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("2I 客户列表「最近跟进」带一句", () => {
  it("甲：一句 = 最近跟进那个时间背后那一条，空白收拢；删了的、以后的不算；从没跟进的没有；看不到的项目上那条只给时间不给一句、不退回更早那条", async () => {
    const p = await 打开({}, 甲);
    expect(p.rows.map((r) => r.name).sort()).toEqual(["两条沟通", "从没跟进", "最新一条在别人项目上", "最新一条在自己项目上", "最晚那条删了", "一句很长", "最新一条在删了的项目上"].sort());
    expect(句们(p)).toEqual({
      两条沟通: "最新的 一句 话",
      最新一条在自己项目上: "自己项目里的一句",
      最新一条在删了的项目上: "删了的项目里那句",
      最晚那条删了: "留着的那句",
      一句很长: "长".repeat(120),
    });
    // 看不到的那条：时间照旧给（和 #307 筛选 / 排序同一个字段），内容一个字不露
    const 别人 = p.rows.find((r) => r.name === "最新一条在别人项目上")!;
    expect(dayjs(别人.lastFollowAt).isSame(前(2), "day")).toBe(true);
    expect(JSON.stringify(p.最近一句)).not.toContain("报价细节");
    expect(JSON.stringify(p.最近一句)).not.toContain("甲自己更早记的");
  });

  it("看全部的人（总管理）：别人项目上那条照摆；同事的客户也有", async () => {
    const 句 = 句们(await 打开({}, 老板));
    expect(句["最新一条在别人项目上"]).toBe("乙项目里的报价细节");
    expect(句["同事的客户"]).toBe("同事的一句");
    expect(句["两条沟通"]).toBe("最新的 一句 话");
  });

  it("按最近跟进排、带关键词（快路）时也带一句", async () => {
    for (const sp of [{ sort: "follow-asc" }, { sort: "follow-desc" }, { keyword: "两条" }] as Record<string, string>[]) {
      expect(句们(await 打开(sp, 甲))["两条沟通"], JSON.stringify(sp)).toBe("最新的 一句 话");
    }
  });
});
