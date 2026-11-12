/**
 * 客户三态 · S4（客户 11-12 第二轮答复）：「号码不全」只提示不拦——
 * 三态到期自动收回时打了「号码不全」的客户，公海领取、分配照常成，列表数据里带着这个标记给界面提示。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 领取, 分配公海 } from "@/app/(app)/customers/pool-actions";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, line: string | null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line } });
  return { id: u.id, name: key, email: `${key}@x`, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { ...u };
  return 以谁的身份(u.id, fn);
};
let 甲: 人, 乙: 人, 总: 人;
/** 三态自动收回的样子：负责人清成占位账号、公海那行不记操作人、打了号码不全 */
async function 号码不全的公海客户(名: string) {
  const 占位 = await prisma.user.upsert({ where: { email: 无负责人占位邮箱 }, update: {}, create: { email: 无负责人占位邮箱, name: "无负责人", title: "", role: "SALES", password: "x", active: false } });
  const c = await prisma.customer.create({ data: { name: 名, phone: "", salesOwnerId: 占位.id } });
  await prisma.customerOwnerLog.create({ data: { customerId: c.id, userId: 甲.id, fromOwnerId: 甲.id, toOwnerId: 占位.id, kind: "pool-release" } });
  await prisma.customerPool.create({ data: { customerId: c.id, userId: null, reason: "待回收满 30 天、3 次提醒都没人处理，自动进客户公海", phoneIncomplete: true } });
  return c.id;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = await 造人("jia", "sales", "内贸");
  乙 = await 造人("yi", "sales", "内贸");
  总 = await 造人("zong", "director", null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("S4 号码不全只提示不拦", () => {
  it("列表行带着号码不全；别人领取照常成", async () => {
    const c = await 号码不全的公海客户("号码不全甲");
    const 页 = await 以(乙, () => 读公海页(乙, {}, 1, 20));
    expect(页.行.find((r) => r.customerId === c)).toMatchObject({ 号码不全: true });
    const r = await 以(乙, () => 领取([c]));
    expect(r).toMatchObject({ ok: true });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(乙.id);
  });

  it("总管理分配照常成", async () => {
    const c = await 号码不全的公海客户("号码不全乙");
    const r = await 以(总, () => 分配公海([c], 乙.id));
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.customerPool.findUnique({ where: { customerId: c } })).toBeNull();
  });
});
