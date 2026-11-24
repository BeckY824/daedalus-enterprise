/**
 * 导入进客户公海的客户，原负责人按原系统「前负责人」补记一行 CustomerOwnerLog 之后（P-公海-04 原负责人回避、M-公海-03 原负责人记历史）：
 *   - 导入时直接挂占位账号进公海（apply.ts 无主客户入池），一行换负责人记录都没有 → 谁都领得到，原负责人也看得到（这次补的缺口）
 *   - 补记那一行和系统里放进公海记的同一个样子（kind = pool-release，from = 原负责人，to = 占位账号），只是操作人是系统、
 *     时间是导入时进公海那一刻（客户资料文件夹里的 fill-prev-owner.mjs 照这里的 补记 写）。判定代码不改，全部照现规则生效：
 *     原负责人领不回、灰按钮、公海页看不到；别人照常领；领走后历史负责人里有他
 *   - 只认最近一次：导入后在系统里又进出过公海的，认系统里那次
 *   - 系统记的那行谁也撤不了（撤销放进公海只认自己放的）
 *   - 原负责人名下导入客户超过回避名单上限（c2 上 27 位成员各几百到几千位）：走宽条件，照样看不到、领不回
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
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 无主入池理由 } from "@/lib/enterprise-import/project-target";
import { 系统 } from "@/lib/project/timeout";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 放进公海, 领取, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 公海客户原负责人是, 历史负责人of, 我放出去的公海客户 } from "@/lib/owner-log-db";
import { 历史负责人们 } from "@/lib/owner-log";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };

let 甲: 人;
let 乙: 人;
let 丙: 人;
let 占位: string;
let 序号 = 0;

const 造人 = async (key: string, name: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: "sales", line: "内贸" } });
  return { id: u.id, name, email, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { ...u };
  return 以谁的身份(u.id, fn);
};

const 导入时刻 = new Date("2026-11-14T13:00:00Z");

/** 11-14 全量导入的公海客户：负责人挂占位账号、客户公海一行（放的人记占位账号、原因 = 导入时没有负责人），没有换负责人记录 */
async function 导入的公海客户(): Promise<string> {
  序号 += 1;
  // 企业版客户没有电话（E-260）：号记在主要联系人上（放回公海查联系方式按联系人的号判）
  const c = await prisma.customer.create({ data: { name: `导入公海客户${序号}`, phone: "", salesOwnerId: 占位, bizLine: "内贸", contacts: { create: { name: `联系人${序号}`, phone: `137${String(序号).padStart(8, "0")}`, isPrimary: true } } } });
  await prisma.customerPool.create({ data: { customerId: c.id, userId: 占位, reason: 无主入池理由, at: 导入时刻 } });
  return c.id;
}

/** 补记脚本写的那一行（fill-prev-owner.mjs 照这里写：操作人系统、时间 = 进公海那一刻、三态不算） */
async function 补记(customerId: string, 原负责人: string) {
  const pool = await prisma.customerPool.findUniqueOrThrow({ where: { customerId } });
  await prisma.customerOwnerLog.create({
    data: { customerId, userId: 系统.id, at: pool.at, fromOwnerId: 原负责人, toOwnerId: 占位, kind: "pool-release", clockReset: null },
  });
  忘掉企业版范围();
}

const 负责人of = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId;
const 公海页里 = async (u: 人) => new Set((await 以(u, () => 读公海页(u, {}, 1, 500))).行.filter((r) => r.种 === "客户").map((r) => r.customerId));
const 看得到 = async (u: 人, c: string) => !!(await 以(u, () => prisma.customer.findUnique({ where: { id: c }, select: { id: true } })));

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = await 造人("jia", "销售甲某");
  乙 = await 造人("yi", "销售乙某");
  丙 = await 造人("bing", "销售丙某");
  占位 = await 无负责人占位Id(prisma);
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});

afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("导入的公海客户：补记原负责人前后", () => {
  it("没补记：认不出原负责人，原系统的前负责人也领得到（缺口）", async () => {
    const c = await 导入的公海客户();
    expect((await 公海客户原负责人是(prisma, [甲.id], [c])).size).toBe(0);
    expect(await 我放出去的公海客户([{ id: c, 在公海: true, salesOwnerId: 占位 }], 甲.id)).toEqual([]);
    expect(await 公海页里(甲)).toContain(c);
    expect((await 以(甲, () => 领取([c]))).ok).toBe(true);
  });

  it("补记后：原负责人领不回、按钮灰、公海页和详情都看不到；别人照常看得到、领得到，领走后历史负责人里有他", async () => {
    const c = await 导入的公海客户();
    await 补记(c, 甲.id);

    expect([...(await 公海客户原负责人是(prisma, [甲.id, 乙.id], [c])).entries()]).toEqual([[c, 甲.id]]);
    expect(await 我放出去的公海客户([{ id: c, 在公海: true, salesOwnerId: 占位 }], 甲.id)).toEqual([c]);
    expect(await 我放出去的公海客户([{ id: c, 在公海: true, salesOwnerId: 占位 }], 乙.id)).toEqual([]);
    expect(await 公海页里(甲)).not.toContain(c);
    expect(await 看得到(甲, c)).toBe(false);
    expect(await 公海页里(乙)).toContain(c);

    expect(await 以(甲, () => 领取([c]))).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect(await 负责人of(c)).toBe(占位);

    expect((await 以(乙, () => 领取([c]))).ok).toBe(true);
    expect(await 负责人of(c)).toBe(乙.id);
    const 记录 = await 历史负责人of(c);
    expect(历史负责人们(记录, "销售乙某")).toEqual(["销售甲某"]);
    expect(记录[0]).toMatchObject({ 操作人: 系统.name, 从: "销售甲某", kind: "pool-release", at: 导入时刻.toISOString() });
    // 三态：补记那行不算转让（pool-release 不归零、不存 clockReset）
    expect((await prisma.customerOwnerLog.findFirstOrThrow({ where: { customerId: c, kind: "pool-release" } })).clockReset).toBeNull();
  });

  it("只认最近一次：导入后别人领走又放回，补记的原负责人又能领，最近放的人领不回", async () => {
    const c = await 导入的公海客户();
    await 补记(c, 甲.id);
    expect((await 以(乙, () => 领取([c]))).ok).toBe(true);
    expect((await 以(乙, () => 放进公海([c], "客户主动终止"))).ok).toBe(true);
    忘掉企业版范围();

    expect([...(await 公海客户原负责人是(prisma, [甲.id, 乙.id], [c])).entries()]).toEqual([[c, 乙.id]]);
    expect((await 以(乙, () => 领取([c]))).ok).toBe(false);
    expect((await 以(甲, () => 领取([c]))).ok).toBe(true);
    expect(await 负责人of(c)).toBe(甲.id);
  });

  it("系统补记的那行谁也撤不了：原负责人点撤销放进公海，客户还在公海、记录还在", async () => {
    const c = await 导入的公海客户();
    await 补记(c, 甲.id);
    const r = await 以(甲, () => 撤销公海("放进", [{ id: c, 值: 甲.id }]));
    expect(r.ok && r.updated).toBeFalsy();
    expect(await 负责人of(c)).toBe(占位);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c, userId: 系统.id, kind: "pool-release" } })).toBe(1);
  });

  it("原负责人账号停用了也补得进：别人照常领，历史负责人里有他", async () => {
    const c = await 导入的公海客户();
    await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
    await 补记(c, 甲.id);
    expect((await 以(乙, () => 领取([c]))).ok).toBe(true);
    expect(历史负责人们(await 历史负责人of(c), "销售乙某")).toEqual(["销售甲某"]);
  });
});

describe("原负责人名下导入客户超过回避名单上限（宽条件那条路）", () => {
  it("101 位都补记给甲：甲公海页一位都看不到、领不回；丙全看得到；乙放进来的甲照常看得到", async () => {
    const 们: string[] = [];
    for (let i = 0; i < 101; i++) 们.push(await 导入的公海客户());
    for (const c of 们) await 补记(c, 甲.id);
    // 甲名下没补记的一位：乙放进公海的，甲不该被挡
    const 乙的 = (await prisma.customer.create({ data: { name: "乙的客户", phone: "", salesOwnerId: 乙.id, bizLine: "内贸", contacts: { create: { name: "乙的联系人", phone: "13600000001", isPrimary: true } } } })).id;
    expect((await 以(乙, () => 放进公海([乙的], "客户主动终止"))).ok).toBe(true);
    忘掉企业版范围();

    const 甲看 = await 公海页里(甲);
    expect(们.filter((c) => 甲看.has(c))).toEqual([]);
    expect(甲看.has(乙的)).toBe(true);
    const 丙看 = await 公海页里(丙);
    expect(们.every((c) => 丙看.has(c))).toBe(true);
    expect(await 以(甲, () => 领取([们[0], 们[100]]))).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect((await 以(丙, () => 领取([们[100]]))).ok).toBe(true);
  });
});
