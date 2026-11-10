/**
 * 客户列表按「归档档位」筛（M-导入-23 / X-63：列表可按档位筛选）。
 *   - 企业版认 archiveTier 参数：老路（客户筛选条件）、关键词快路径（关键词分页）一个口径
 *   - 开关关着地址栏带了也当没带
 * 名字、号码全是编造的
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 客户筛选条件, 关键词分页 } from "@/app/(app)/customers/query";

async function 筛(条件: Parameters<typeof 客户筛选条件>[0]) {
  const rows = await prisma.customer.findMany({ where: await 客户筛选条件(条件), select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => r.name);
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: "u-1", email: "u1@local", name: "示例销售", role: "ADMIN", password: "x" } });
  await prisma.customer.createMany({
    data: [
      { name: "示例甲", phone: "13900001101", salesOwnerId: "u-1", archiveTier: "A1" },
      { name: "示例乙", phone: "13900001102", salesOwnerId: "u-1", archiveTier: "A1" },
      { name: "示例丙", phone: "13900001103", salesOwnerId: "u-1", archiveTier: "E" },
      { name: "示例丁", phone: "13900001104", salesOwnerId: "u-1" },
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());

it("企业版：按档位筛出这一档的客户；不带档位全给", async () => {
  expect(await 筛({ archiveTier: "A1" })).toEqual(["示例乙", "示例甲"]);
  expect(await 筛({ archiveTier: "E" })).toEqual(["示例丙"]);
  expect(await 筛({ archiveTier: "B" })).toEqual([]);
  expect(await 筛({})).toHaveLength(4);
});

it("关键词快路径和老路一个口径", async () => {
  const r = await 关键词分页({ keyword: "示例", archiveTier: "A1" }, 1, 20);
  expect(r?.total).toBe(2);
  const 名 = (await prisma.customer.findMany({ where: { id: { in: r?.ids ?? [] } }, select: { name: true } })).map((c) => c.name).sort();
  expect(名).toEqual(["示例乙", "示例甲"]);
});

it("开关关着：地址栏带了档位也当没带", async () => {
  vi.stubEnv("CRM_ENTERPRISE", "");
  expect(await 筛({ archiveTier: "A1" })).toHaveLength(4);
  const r = await 关键词分页({ keyword: "示例", archiveTier: "A1" }, 1, 20);
  expect(r?.total).toBe(4);
});
