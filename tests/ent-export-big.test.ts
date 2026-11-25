import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath() {} }));
const 当前 = vi.hoisted(() => ({ 我: { id: "big-boss", name: "总管理", role: "ADMIN" }, 打码: false }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => 当前.我, getCurrentUser: async () => 当前.我 }));
// 打码走的还是 号码脱敏器 这一个出口：这里只换掉「藏不藏」的判断，看主联系人另查以后号码照样过它
vi.mock("@/lib/enterprise/phone-mask", () => ({ 号码脱敏器: async () => (p: string | null) => (当前.打码 && p ? `***${p.slice(-4)}` : p) }));
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 开始完整导出, 读取完整导出批次, 校验完整导出, 导出客户 } from "@/app/(app)/customers/export-action";
import { 客户行字段, 成客户行 } from "@/app/(app)/customers/query";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 主联系人号码选, 客户电话 } from "@/lib/enterprise/primary-contact-phone";
import { 全称或显名 } from "@/lib/enterprise/customer-title";
import { 客户附件个数 } from "@/lib/attachments";

/*
  11-25 3703 实操：总管理「客户完整导出」1.5 万 / 1.95 万位失败（Prisma 查询引擎 panic：record.rs:69 no entry found for key）。
  根因：一句查询里嵌套带 orderBy / take 的关系（主联系人号码选）父记录过 999 条。客户每批 1001 条、跟进每批涉及上千位客户，都过线。
  这里造 1,200 位客户（每位一条跟进）：客户批、跟进批都过 999 线；修之前第一批就 panic
*/
const 位数 = 1200;
const 客户id = (i: number) => `big-${String(i).padStart(5, "0")}`;
/**
  每位客户的联系人摆法（按先后判，前面的优先）：
  - 每 7 位：没有联系人
  - 每 11 位：主联系人进了回收站（deletedAt 有值）→ 落到下一位（次要那位）
  - 每 13 位：两位都不是主联系人，后插的那位建得早 → 按 createdAt 取建得早的（次要那位）
  - 每 17 位：两位都不是主联系人、建的时刻相同，先插的 id 大 → 按 id 取 id 小的（c1）
  - 其余：c1 是主联系人
*/
type 情形 = "无" | "主删" | "都非主按时间" | "都非主按id" | "常规";
function 情形of(i: number): 情形 {
  if (i % 7 === 0) return "无";
  if (i % 11 === 0) return "主删";
  if (i % 13 === 0) return "都非主按时间";
  if (i % 17 === 0) return "都非主按id";
  return "常规";
}
/** c1 的号：主表空（每 10 位）就取他号码几行的第一个号码类 */
const c1号 = (i: number) => (i % 10 === 0 ? `139${String(i).padStart(8, "0")}` : `138${String(i).padStart(8, "0")}`);
const c2号 = (i: number) => `137${String(i).padStart(8, "0")}`;
/** 每位客户预期的「联系电话」：排在第一位的联系人的号（主表空就取号码几行的第一个号码类） */
function 预期电话(i: number) {
  const 情 = 情形of(i);
  if (情 === "无") return "";
  if (情 === "主删" || 情 === "都非主按时间") return c2号(i);
  return c1号(i);
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
  const 联系人: { id: string; customerId: string; name: string; phone: string | null; isPrimary: boolean; createdAt: Date; deletedAt?: Date }[] = [];
  const 号码们: { customerId: string; contactId: string; kind: string; value: string; numberKey: string; createdAt: Date }[] = [];
  const 晚 = new Date(at.getTime() + 1000);
  for (let i = 0; i < 位数; i++) {
    const 情 = 情形of(i);
    if (情 === "无") continue;
    const 主 = `${客户id(i)}-c1`;
    const c1 = { id: 主, customerId: 客户id(i), name: "主", phone: i % 10 === 0 ? null : c1号(i), isPrimary: 情 === "常规" || 情 === "主删", createdAt: 情 === "都非主按id" ? at : 晚, ...(情 === "主删" ? { deletedAt: at } : {}) };
    const c2 = { id: `${客户id(i)}-c2`, customerId: 客户id(i), name: "次要", phone: c2号(i), isPrimary: false, createdAt: at };
    // 插入先后和预期相反：常规 / 主删 / 按 id 先插 c2（要靠 isPrimary、deletedAt、id 排到对的那位）；按时间先插 c1（要靠 createdAt）
    if (情 === "都非主按时间") 联系人.push(c1, c2);
    else 联系人.push(c2, c1);
    if (i % 10 === 0) {
      号码们.push({ customerId: 客户id(i), contactId: 主, kind: "email", value: `x${i}@local`, numberKey: `x${i}@local`, createdAt: at });
      号码们.push({ customerId: 客户id(i), contactId: 主, kind: "phone", value: c1号(i), numberKey: c1号(i), createdAt: 晚 });
    }
  }
  await prisma.contact.createMany({ data: 联系人 });
  await prisma.contactMethod.createMany({ data: 号码们 });
  await prisma.followUp.createMany({ data: Array.from({ length: 位数 }, (_, i) => ({ id: `big-f-${String(i).padStart(5, "0")}`, customerId: 客户id(i), ownerId: "big-boss", type: "PHONE", title: "回电", content: "内容", occurredAt: at, createdAt: at, updatedAt: at })) });
}, 60_000);

async function 导出全部() {
  const start = await 开始完整导出({});
  const fingerprints: { 类别: "客户" | "跟进"; 指纹: string }[] = [];
  const 客户: Record<string, unknown>[] = [];
  const 跟进: Record<string, unknown>[] = [];
  for (const kind of ["客户", "跟进"] as const) {
    let cursor: string | undefined;
    do {
      const r = await 读取完整导出批次({}, start.截止, kind, cursor);
      (kind === "客户" ? 客户 : 跟进).push(...(r.rows as Record<string, unknown>[]));
      fingerprints.push({ 类别: kind, 指纹: r.指纹 });
      cursor = r.游标 ?? undefined;
    } while (cursor);
  }
  return { start, fingerprints, 客户, 跟进 };
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

it("列不变：小批（不过 999 线）用原来的一句嵌套查询，和导出的同 id 行整行一致（客户表、跟进表，打不打码都一样）", async () => {
  // 小批里五种联系人摆法都有（7、11、13、17 的倍数和常规）
  const ids = Array.from({ length: 300 }, (_, i) => 客户id(i));
  expect(new Set(ids.map((_, i) => 情形of(i)))).toEqual(new Set(["无", "主删", "都非主按时间", "都非主按id", "常规"]));
  for (const 打码 of [false, true]) {
    当前.打码 = 打码;
    const r = await 导出全部();
    const 号 = await 号码脱敏器();
    // 客户表：原来的 select（带 contacts: 主联系人号码选）一句取，套 成客户行
    const 原客户 = await prisma.customer.findMany({ where: { id: { in: ids } }, select: 客户行字段 });
    expect(原客户).toHaveLength(ids.length);
    const 附件 = await 客户附件个数(prisma, ids, true);
    const 导出客户 = new Map(r.客户.map((x) => [x.id as string, x]));
    for (const c of 原客户) {
      const 预期 = { ...成客户行(c, 号), 附件数: 附件.get(c.id) ?? null };
      const 实际 = 导出客户.get(c.id);
      expect(实际).toEqual(预期);
      // 指纹按 JSON 原样字节算：键的先后也要一样
      expect(Object.keys(实际!)).toEqual(Object.keys(预期));
    }
    // 跟进表：原来的 select（customer 下带 contacts: 主联系人号码选）一句取，照原来的映射
    const 原跟进 = await prisma.followUp.findMany({
      where: { customerId: { in: ids } },
      select: { id: true, customerId: true, customer: { select: { id: true, name: true, shortName: true, phone: true, customerNo: true, contacts: 主联系人号码选 } }, occurredAt: true, type: true, method: true, title: true, content: true, status: true, owner: { select: { name: true } } },
    });
    expect(原跟进).toHaveLength(ids.length);
    const 导出跟进 = new Map(r.跟进.map((x) => [x.id as string, x]));
    for (const f of 原跟进) {
      const 预期 = { id: f.id, customerId: f.customerId, customerName: 全称或显名(f.customer), phone: 号(客户电话(f.customer)), customerNo: f.customer.customerNo, occurredAt: f.occurredAt.toISOString(), type: f.type, method: f.method, title: f.title, content: f.content, status: f.status, ownerName: f.owner.name };
      const 实际 = 导出跟进.get(f.id);
      expect(实际).toEqual(预期);
      expect(Object.keys(实际!)).toEqual(Object.keys(预期));
    }
  }
}, 120_000);

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
