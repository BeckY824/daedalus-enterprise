/**
 * 12-22 客户转让逐项选：上级直接转走一部分客户时，作废负责人本人等确认的移交申请（handover-void.ts）。
 * 覆盖：部分作废 → 剩下的又被作废，发起人要收到新通知；连续两次部分作废各有通知；原接手人已读过也要更新标题、置回未读（累计位数）；
 * 调用方快照过时（两位上级同时直转同一份申请里的不同客户）也照库里现值去掉、发通知。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 等确认的申请移交, 作废申请移交 } from "@/lib/enterprise/handover-void";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 销售: 人, 接手: 人, 同事: 人;
let 号 = 0;

async function 建(email: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进" } });
const 一笔 = () => prisma.entHandover.findFirstOrThrow();
const 我 = () => ({ id: 组长.id, name: "lead" });
/** 上级直转了这几位（不真改负责人，只走作废这一步） */
async function 直转(ids: string[], 快照?: Awaited<ReturnType<typeof 等确认的申请移交>>["行"]) {
  const 行 = 快照 ?? (await 等确认的申请移交(ids)).行;
  await 作废申请移交(我(), 行, ids, 同事.id);
}
const 本人通知 = () => prisma.entNotice.findMany({ where: { userId: 销售.id, dedupeKey: { startsWith: `handover:` }, NOT: { dedupeKey: { endsWith: ":发起" } } }, orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  await resetDb();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales");
  接手 = await 建("taker");
  同事 = await 建("peer");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 销售.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 接手.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 同事.id, managerId: 组长.id, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting("enterprise.rule.handover_confirm", false);
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

async function 发起(n: number) {
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(await 客户(销售.id));
  await assignSalesOwner(cs.map((c) => c.id), 接手.id, null, undefined, { 说明: "测试原因" });
  return cs.map((c) => c.id);
}

describe("部分作废、全部作废的通知", () => {
  it("先部分作废、后来剩下的也被作废：发起人收到「已作废」的新通知", async () => {
    const [a, b] = await 发起(2);
    await 直转([a]);
    expect(await 本人通知()).toHaveLength(1);
    expect((await 本人通知())[0].title).toContain("其余仍待对方确认");
    expect((await 一笔()).status).toBe("待确认");
    await 直转([b]);
    expect((await 一笔()).status).toBe("已作废");
    const 们 = await 本人通知();
    expect(们).toHaveLength(2);
    expect(们.some((n) => n.title.includes("已作废"))).toBe(true);
  });

  it("连续两次部分作废：第二次也有新通知；原接手人那条累计位数、已读的置回未读", async () => {
    const [a, b, c] = await 发起(3);
    await 直转([a]);
    const 发起通知 = () => prisma.entNotice.findFirstOrThrow({ where: { userId: 接手.id, dedupeKey: { endsWith: ":发起" } } });
    expect((await 发起通知()).title).toContain("其中 1 位");
    await prisma.entNotice.updateMany({ where: { userId: 接手.id, dedupeKey: { endsWith: ":发起" } }, data: { readAt: new Date() } });
    await 直转([b]);
    expect(await 本人通知()).toHaveLength(2);
    const 接 = await 发起通知();
    expect(接.title).toContain("其中 2 位");
    expect(接.title).toContain("其余仍待你确认");
    expect(接.readAt).toBeNull();
    expect(JSON.parse((await 一笔()).customerIds)).toEqual([c]);
  });

  it("快照过时（两位上级同时直转不同客户）：传旧的快照，照库里现值去掉、发通知", async () => {
    const [a, b, c] = await 发起(3);
    const 旧 = (await 等确认的申请移交([a, b])).行;
    await 直转([a]); // 另一位上级先转走了 a，库里已变；旧快照里还有 a、b、c
    await 直转([b], 旧);
    expect(JSON.parse((await 一笔()).customerIds)).toEqual([c]);
    expect(await 本人通知()).toHaveLength(2);
    expect((await 一笔()).status).toBe("待确认");
  });
});
