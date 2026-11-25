import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath() {} }));
const 当前 = vi.hoisted(() => ({ 我: { id: "big-boss", name: "总管理", role: "ADMIN" }, 打码: false }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => 当前.我, getCurrentUser: async () => 当前.我 }));
// 打码走的还是 号码脱敏器 这一个出口：这里只换掉「藏不藏」的判断，看主联系人另查以后号码照样过它
vi.mock("@/lib/enterprise/phone-mask", () => ({ 号码脱敏器: async () => (p: string | null) => (当前.打码 && p ? `***${p.slice(-4)}` : p) }));
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 开始完整导出, 读取完整导出批次, 校验完整导出, 导出客户 } from "@/app/(app)/customers/export-action";
import { 客户行字段 } from "@/app/(app)/customers/query";

/*
  11-25 3703 实操：总管理「客户完整导出」1.5 万 / 1.95 万位失败（Prisma 查询引擎 panic：record.rs:69 no entry found for key）。
  根因：一句查询里嵌套带 orderBy / take 的关系（主联系人号码选）父记录过 999 条。客户每批 1001 条、跟进每批涉及上千位客户，都过线。
  这里造 1,200 位客户（每位一条跟进）：客户批、跟进批都过 999 线；修之前第一批就 panic
*/
const 位数 = 1200;
const 客户id = (i: number) => `big-${String(i).padStart(5, "0")}`;
/** 每位客户预期的「联系电话」：主联系人的号（主表空就取号码几行的第一个号码类）；每 7 位一位没有联系人 */
function 预期电话(i: number) {
  if (i % 7 === 0) return "";
  if (i % 10 === 0) return `139${String(i).padStart(8, "0")}`;
  return `138${String(i).padStart(8, "0")}`;
}

beforeAll(() => { vi.stubEnv("CRM_ENTERPRISE", "1"); });
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

beforeEach(async () => {
  await resetDb();
  当前.我 = { id: "big-boss", name: "总管理", role: "ADMIN" };
  当前.打码 = false;
  await prisma.user.createMany({ data: [
    { id: "big-boss", name: "总管理", email: "big-boss@local", password: "x", role: "ADMIN" },
    { id: "big-sales", name: "销售", email: "big-sales@local", password: "x", role: "SALES" },
  ] });
  await prisma.entMember.create({ data: { userId: "big-boss", bizRole: "director" } });
  const at = new Date("2026-01-01T00:00:00Z");
  const 客户 = Array.from({ length: 位数 }, (_, i) => ({ id: 客户id(i), name: `大批客户${i}`, phone: "", salesOwnerId: "big-boss", createdAt: at, updatedAt: at }));
  await prisma.customer.createMany({ data: 客户 });
  const 联系人: { id: string; customerId: string; name: string; phone: string | null; isPrimary: boolean; createdAt: Date }[] = [];
  const 号码们: { customerId: string; contactId: string; kind: string; value: string; numberKey: string; createdAt: Date }[] = [];
  for (let i = 0; i < 位数; i++) {
    if (i % 7 === 0) continue;
    // 先建的是非主联系人：排序要靠 isPrimary 把主联系人顶到前面
    联系人.push({ id: `${客户id(i)}-c2`, customerId: 客户id(i), name: "次要", phone: `137${String(i).padStart(8, "0")}`, isPrimary: false, createdAt: at });
    const 主 = `${客户id(i)}-c1`;
    联系人.push({ id: 主, customerId: 客户id(i), name: "主", phone: i % 10 === 0 ? null : 预期电话(i), isPrimary: true, createdAt: new Date(at.getTime() + 1000) });
    if (i % 10 === 0) {
      号码们.push({ customerId: 客户id(i), contactId: 主, kind: "email", value: `x${i}@local`, numberKey: `x${i}@local`, createdAt: at });
      号码们.push({ customerId: 客户id(i), contactId: 主, kind: "phone", value: 预期电话(i), numberKey: 预期电话(i), createdAt: new Date(at.getTime() + 1000) });
    }
  }
  await prisma.contact.createMany({ data: 联系人 });
  await prisma.contactMethod.createMany({ data: 号码们 });
  await prisma.followUp.createMany({ data: Array.from({ length: 位数 }, (_, i) => ({ id: `big-f-${String(i).padStart(5, "0")}`, customerId: 客户id(i), ownerId: "big-boss", type: "PHONE", title: "回电", content: "内容", occurredAt: at, createdAt: at, updatedAt: at })) });
}, 60_000);

async function 导出全部() {
  const start = await 开始完整导出({});
  const fingerprints: { 类别: "客户" | "跟进"; 指纹: string }[] = [];
  const 客户: Awaited<ReturnType<typeof 读取完整导出批次>>["rows"] = [];
  const 跟进: typeof 客户 = [];
  for (const kind of ["客户", "跟进"] as const) {
    let cursor: string | undefined;
    do {
      const r = await 读取完整导出批次({}, start.截止, kind, cursor);
      (kind === "客户" ? 客户 : 跟进).push(...r.rows);
      fingerprints.push({ 类别: kind, 指纹: r.指纹 });
      cursor = r.游标 ?? undefined;
    } while (cursor);
  }
  return { start, fingerprints, 客户: 客户 as Record<string, unknown>[], 跟进: 跟进 as Record<string, unknown>[] };
}

it("过 999 线的客户批、跟进批照样导完，复核通过，主联系人电话一位不差", async () => {
  const r = await 导出全部();
  expect(r.start.客户数).toBe(位数);
  expect(r.start.跟进数).toBe(位数);
  expect(r.客户).toHaveLength(位数);
  expect(r.跟进).toHaveLength(位数);
  // 客户批 1000 + 200，跟进一批 1200 条（1200 位不同客户）
  expect(r.fingerprints.map((f) => f.类别)).toEqual(["客户", "客户", "跟进"]);
  for (const row of r.客户) expect(row.phone).toBe(预期电话(Number(String(row.id).slice(4))));
  for (const f of r.跟进) expect(f.phone).toBe(预期电话(Number(String(f.customerId).slice(4))));
  await expect(校验完整导出({}, r.start, r.fingerprints)).resolves.toEqual({ ok: true });
}, 60_000);

it("列不变：客户表每行的键和原来带 contacts 一句取的一模一样", async () => {
  const r = await 导出全部();
  // 原样一句取（小批、不过线）对照：列、值都应一致
  const 小批 = await prisma.customer.findMany({ where: { id: { in: [客户id(1), 客户id(7), 客户id(10)] } }, select: 客户行字段 });
  expect(小批.map((x) => x.contacts.length)).toEqual([1, 0, 1]);
  const 导出的 = r.客户.find((x) => x.id === 客户id(10))!;
  expect(Object.keys(导出的)).toEqual(Object.keys(r.客户[0]));
  expect(Object.keys(导出的)).toContain("phone");
  expect(Object.keys(导出的)).toContain("附件数");
  expect(Object.keys(r.跟进[0]).sort()).toEqual(["content", "customerId", "customerName", "customerNo", "id", "method", "occurredAt", "ownerName", "phone", "status", "title", "type"]);
}, 60_000);

it("打码照旧：电话藏着时两张表的号码都打码", async () => {
  当前.打码 = true;
  const r = await 导出全部();
  const 有号 = r.客户.find((x) => x.id === 客户id(1))!;
  expect(有号.phone).toBe(`***${预期电话(1).slice(-4)}`);
  expect(r.跟进.find((f) => f.customerId === 客户id(10))!.phone).toBe(`***${预期电话(10).slice(-4)}`);
  expect(r.客户.find((x) => x.id === 客户id(7))!.phone).toBe("");
}, 60_000);

it("权限照旧：不是总管理的导不了", async () => {
  当前.我 = { id: "big-sales", name: "销售", role: "SALES" };
  await expect(开始完整导出({})).rejects.toThrow(/只有总管理/);
  await expect(读取完整导出批次({}, new Date().toISOString(), "客户")).rejects.toThrow(/只有总管理/);
});

it("旧的有界出口 导出客户 过线也不 panic，电话同一口径", async () => {
  const r = await 导出客户({});
  if (!r.ok) throw new Error(r.error);
  expect(r.rows).toHaveLength(位数);
  expect(r.跟进).toHaveLength(位数);
  for (const row of r.rows) expect(row.phone).toBe(预期电话(Number(String(row.id).slice(4))));
}, 60_000);
