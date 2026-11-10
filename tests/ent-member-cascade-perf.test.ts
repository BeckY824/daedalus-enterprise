/**
 * 企业版组员看得到项目所在客户（V3.5.1 组员级联），11-03 速度闸门改法：
 *   - 范围里先算好「组员客户」id 名单，读的时候 id IN 名单，不再每条读都挂项目 + 组员子查询
 *   - 不是任何项目的组员（含只看公海的业务员）：不加这一句
 *   - 同意邀请、移出组员、删项目后马上生效，不等 10 秒范围缓存
 *   - 原生 SQL 的客户数和 Prisma 数一致
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 现在的组员客户, 限定条件 } from "@/lib/team-scope";
import { 看得到的客户数 } from "@/lib/scope-sql";
import { 加组员, 回邀请, 移出组员, 删项目 } from "@/lib/project/db";
import { saveBusiness, getBusiness } from "@/lib/business";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 丙: 人;

async function 造人(email: string, name: string, role: string, bizRole: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  await raw.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, name, role };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 号 = () => `139${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

/** 乙看得到这位客户吗（不手动清缓存：要的就是写完马上生效） */
const 乙看得到 = (c: string) => 以谁的身份(乙.id, async () => !!(await prisma.customer.findUnique({ where: { id: c }, select: { id: true } })));

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss@x", "老板", "ADMIN", "director");
  乙 = await 造人("yi@x", "乙", "SALES", "sales");
  丙 = await 造人("bing@x", "丙", "SALES", "sales");
  当(老板);
  await saveBusiness({ ...(await getBusiness()), projectMode: true });
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: JSON.stringify(true) }, create: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("组员客户名单", () => {
  it("不是组员：范围里没有组员名单，限定条件不挂项目组员子查询", async () => {
    await raw.customer.create({ data: { name: "丙的客户", phone: 号(), salesOwnerId: 丙.id } });
    expect(await 以谁的身份(乙.id, () => 现在的组员客户(raw))).toBeUndefined();
    expect(JSON.stringify(限定条件("Customer", 乙.id))).not.toContain("members");
    expect(JSON.stringify(限定条件("Customer", 乙.id, false, undefined, undefined, undefined, ["c1"]))).toContain('"in":["c1"]');
  });

  it("同意邀请马上看得到，移出马上看不到，删项目也跟着；原生 SQL 数和 Prisma 数一致", async () => {
    const c = (await raw.customer.create({ data: { name: "丙的客户", phone: 号(), salesOwnerId: 丙.id } })).id;
    const p = (await raw.project.create({ data: { name: "一号项目", customerId: c, ownerId: 丙.id, creatorId: 丙.id } })).id;
    await raw.customer.create({ data: { name: "乙自己的", phone: 号(), salesOwnerId: 乙.id } });
    expect(await 乙看得到(c)).toBe(false);

    当(丙);
    expect(await 以谁的身份(丙.id, () => 加组员(丙, p, 乙.id))).toEqual({ ok: true });
    expect(await 乙看得到(c)).toBe(false); // 还没同意

    const m = await raw.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId: p, userId: 乙.id } } });
    当(乙);
    expect((await 以谁的身份(乙.id, () => 回邀请(乙, m.id, true))).ok).toBe(true);
    expect(await 乙看得到(c)).toBe(true);
    expect(await 以谁的身份(乙.id, () => 现在的组员客户(raw))).toEqual([c]);
    const 两边 = await 以谁的身份(乙.id, async () => [await 看得到的客户数(), await prisma.customer.count()]);
    expect(两边).toEqual([2, 2]);

    当(丙);
    expect(await 以谁的身份(丙.id, () => 移出组员(丙, m.id))).toEqual({ ok: true });
    expect(await 乙看得到(c)).toBe(false);

    // 再进组，老板删项目：组员跟着看不到客户
    await raw.projectMember.create({ data: { projectId: p, userId: 乙.id, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    expect(await 乙看得到(c)).toBe(true);
    当(老板);
    // 客户只剩最后一个项目不能单删（X-74）：再挂一个没组员的
    await raw.project.create({ data: { name: "二号项目", customerId: c, ownerId: 丙.id, creatorId: 丙.id } });
    expect((await 以谁的身份(老板.id, () => 删项目(老板, p))).ok).toBe(true);
    expect(await 乙看得到(c)).toBe(false);
  });
});
