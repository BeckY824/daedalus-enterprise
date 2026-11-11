/**
 * 客户列表 11-11 补的筛选：
 * - 「手机号」（地址栏 phone=）：只比号码，和搜索框像号码的那一半同一套——去空格、横杠、括号、明写的 +86 / 0086，包含就算；
 *   比客户电话、WhatsApp、没删的联系人的电话、联系人号码子表里的手机号 / WhatsApp；删进回收站的联系人的号不算；
 *   电话「藏」着的人（字段权限 Y27）不按号码比（当没筛），可见范围不因筛选放宽；
 * - 「创建时间」（createdFrom / createdTo）：北京日 00:00 到 23:59:59.999，两头都算，和手机号叠加；
 * - 搜索框（关键词）：联系人电话按号键比、子表里的手机号也搜得到；
 * - 行上带 createdAt，号码照旧过 号码脱敏器（成客户行 的 号）。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 字段权限key } from "@/lib/enterprise/field-perm";
import { 客户筛选条件, 客户行字段, 成客户行, 关键词分页, type 客户条件 } from "@/app/(app)/customers/query";
import { 号码片段 } from "@/lib/search-keyword";
import { maskPhone } from "@/lib/utils";

let 老板: string, 销售: string, 销售乙: string, 藏号的: string;

const 名们 = async (谁: string, sp: 客户条件) =>
  以谁的身份(谁, async () => (await prisma.customer.findMany({ where: await 客户筛选条件(sp, 谁), select: { name: true }, orderBy: { name: "asc" } })).map((r) => r.name));

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 建人 = async (email: string, role: string, bizRole: string, managerId?: string) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, ...(managerId ? { managerId } : {}) } });
    return id;
  };
  老板 = await 建人("boss", "ADMIN", "director");
  销售 = await 建人("s1", "SALES", "sales");
  销售乙 = await 建人("s2", "SALES", "sales");
  藏号的 = await 建人("cs", "SALES", "sales_ops");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.字段权限.key, true);
  await setSetting(字段权限key, { 电话: { sales_ops: "藏" } });
  invalidateSettingsCache();
  忘掉企业版范围();

  const 客 = (name: string, phone: string, owner: string, createdAt: string) =>
    prisma.customer.create({ data: { name, phone, salesOwnerId: owner, createdAt: new Date(createdAt) } });
  // 北京 03-01 00:00 = UTC 02-28 16:00
  await 客("A主号", "13912345678", 销售, "2026-02-28T16:00:00.000Z");
  const b = await 客("B联系人", "15000000101", 销售, "2026-02-28T15:59:59.999Z");
  // 老库里联系人电话带着格式存的
  await prisma.contact.create({ data: { name: "家长", phone: "137-2222-3333", customerId: b.id } });
  const c = await 客("C子表", "15000000102", 销售, "2026-06-30T15:59:59.999Z");
  const 联 = await prisma.contact.create({ data: { name: "采购", phone: null, customerId: c.id } });
  await prisma.contactMethod.create({ data: { customerId: c.id, contactId: 联.id, kind: "phone", value: "13644445555", numberKey: "13644445555" } });
  await prisma.contactMethod.create({ data: { customerId: c.id, contactId: 联.id, kind: "whatsapp", value: "+86 135 6666 7777", numberKey: "8613566667777" } });
  // 座机不算手机号
  await prisma.contactMethod.create({ data: { customerId: c.id, contactId: 联.id, kind: "landline", value: "02188889999", numberKey: "02188889999" } });
  const d = await 客("D删了的联系人", "15000000103", 销售, "2026-06-30T16:00:00.000Z");
  const 删 = await prisma.contact.create({ data: { name: "离职的", phone: "13377778888", customerId: d.id, deletedAt: new Date() } });
  await prisma.contactMethod.create({ data: { customerId: d.id, contactId: 删.id, kind: "phone", value: "13377778888", numberKey: "13377778888" } });
  await prisma.customer.create({ data: { name: "E外贸", phone: "15000000104", salesOwnerId: 销售, extra: { create: { whatsapp: "+86 131-1111-2222" } }, createdAt: new Date("2026-04-01T00:00:00Z") } });
  // 别人的客户：同一个号段，销售甲按号码筛不出来
  await 客("F同事的", "13912349999", 销售乙, "2026-04-01T00:00:00Z");
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});
afterAll(() => prisma.$disconnect());

describe("手机号筛选", () => {
  it("客户电话：完整号、后 4 位、带空格横杠、+86 / 0086 写法都中", async () => {
    for (const k of ["13912345678", "5678", "139 1234 5678", "139-1234-5678", "+86 139 1234 5678", "0086-13912345678", "(+86)1391234", "+86 1391"]) {
      expect(await 名们(老板, { phone: k }), k).toContain("A主号");
    }
  });

  it("有：联系人电话（带格式存的）、子表手机号 / WhatsApp、外贸 WhatsApp 都中；座机不算", async () => {
    expect(await 名们(老板, { phone: "13722223333" })).toEqual(["B联系人"]);
    expect(await 名们(老板, { phone: "4445555" })).toEqual(["C子表"]);
    expect(await 名们(老板, { phone: "135 6666" })).toEqual(["C子表"]);
    expect(await 名们(老板, { phone: "1311111" })).toEqual(["E外贸"]);
    expect(await 名们(老板, { phone: "88889999" })).toEqual([]);
  });

  it("没有：删进回收站的联系人的号不算；不像号码的、不到 3 位的谁都不中", async () => {
    expect(await 名们(老板, { phone: "13377778888" })).toEqual([]);
    expect(await 名们(老板, { phone: "abc" })).toEqual([]);
    expect(await 名们(老板, { phone: "12" })).toEqual([]);
  });

  it("不放宽可见范围：销售甲按号段筛不出同事的客户；老板两位都中", async () => {
    expect(await 名们(销售, { phone: "1391234" })).toEqual(["A主号"]);
    expect(await 名们(老板, { phone: "1391234" })).toEqual(["A主号", "F同事的"]);
  });

  it("电话藏着的人（Y27）不按号码比：phone 当没筛，搜索框按号码也搜不到", async () => {
    await prisma.customer.updateMany({ data: { salesOwnerId: 藏号的 } });
    const 全部 = await 名们(藏号的, {});
    expect(await 名们(藏号的, { phone: "13912345678" })).toEqual(全部);
    expect(await 名们(藏号的, { keyword: "13912345678" })).toEqual([]);
  });

  it("和创建时间叠加；关键词快路径遇到这两样退回老路", async () => {
    expect(await 名们(老板, { phone: "1391234", createdFrom: "2026-03-01", createdTo: "2026-03-31" })).toEqual(["A主号"]);
    expect(await 名们(老板, { phone: "1391234", createdFrom: "2026-04-01", createdTo: "2026-04-30" })).toEqual(["F同事的"]);
    expect(await 关键词分页({ keyword: "A", phone: "139" }, 1, 20)).toBeNull();
    expect(await 关键词分页({ keyword: "A", createdFrom: "2026-03-01" }, 1, 20)).toBeNull();
  });
});

describe("搜索框按号码", () => {
  it("联系人电话按号键比、子表里的手机号也搜得到；删了的联系人不算", async () => {
    expect(await 名们(老板, { keyword: "137 2222 3333" })).toEqual(["B联系人"]);
    expect(await 名们(老板, { keyword: "13644445555" })).toEqual(["C子表"]);
    expect(await 名们(老板, { keyword: "13377778888" })).toEqual([]);
  });

  it("号码片段：明写的 +86 / 0086 去掉，只裸写 86 的短片段不猜", () => {
    expect(号码片段("+86 138")).toBe("138");
    expect(号码片段("0086-1380000")).toBe("1380000");
    expect(号码片段("(+86) 138 0000")).toBe("1380000");
    expect(号码片段("86138")).toBe("86138");
    expect(号码片段("8613800001111")).toBe("13800001111");
  });
});

describe("创建时间筛选（北京日）", () => {
  it("开始日 00:00 进、前一刻不进；结束日 23:59:59.999 进、次日 00:00 不进", async () => {
    expect(await 名们(老板, { createdFrom: "2026-03-01", createdTo: "2026-06-30" })).toEqual(["A主号", "C子表", "E外贸", "F同事的"]);
    expect(await 名们(老板, { createdTo: "2026-02-28" })).toEqual(["B联系人"]);
    expect(await 名们(老板, { createdFrom: "2026-07-01" })).toEqual(["D删了的联系人"]);
    expect(await 名们(销售, { createdFrom: "2026-03-01", createdTo: "2026-06-30" })).toEqual(["A主号", "C子表", "E外贸"]);
  });
});

describe("行", () => {
  it("带创建时间；号码照旧过 号码脱敏器，列表那一格照旧打码", async () => {
    const r = await prisma.customer.findFirstOrThrow({ where: { name: "A主号" }, select: 客户行字段 });
    const 行 = 成客户行(r, (p) => (p ? "已打码" : p) as typeof p);
    expect(行.createdAt).toBe("2026-02-28T16:00:00.000Z");
    expect(行.phone).toBe("已打码");
    expect(maskPhone("13912345678")).toBe("139****5678");
  });
});
