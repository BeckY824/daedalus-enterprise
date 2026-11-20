/**
 * 客户列表「联系电话」全显（29Q，11-20 客户管理员：展会大量现场加的客户要逐个加微信）：
 *   - 看得到这位客户、又不在公海的：列表行上是完整号码（浏览器那头带一键复制，见 ent-cust-list-phone-state.ui.test.ts）；
 *   - 公海里的客户照旧打码（用户 11-20 定「不显示」）；
 *   - 销售教练照旧打码（P-教练-05，规则开不开都打），字段权限里电话设成「看不到」的角色照旧打码；
 *   - 都在服务端打（query.ts 成列表行 + 号码脱敏器），浏览器拿不到原号。
 */
import { it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 字段权限key } from "@/lib/enterprise/field-perm";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 客户行字段, 成列表行 } from "@/app/(app)/customers/query";
import { maskPhone } from "@/lib/utils";

const 手上的号 = "13912345678";
const 公海的号 = "15000000101";
const 座机 = "02166668888";
let 销售: string, 教练: string, 藏号的: string;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 建人 = async (email: string, role: string, bizRole: string) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  销售 = await 建人("s1", "SALES", "sales");
  教练 = await 建人("coach", "SALES", "coach");
  藏号的 = await 建人("cs", "SALES", "sales_ops");
  await prisma.customer.create({ data: { name: "手上的", phone: 手上的号, salesOwnerId: 销售 } });
  await prisma.customer.create({ data: { name: "座机的", phone: 座机, salesOwnerId: 销售 } });
  const 公海 = await prisma.customer.create({ data: { name: "公海的", phone: 公海的号, salesOwnerId: 销售 } });
  await prisma.customerPool.create({ data: { customerId: 公海.id } });
  await prisma.customer.create({ data: { name: "没号的", phone: "", salesOwnerId: 销售 } });
  invalidateSettingsCache();
  忘掉企业版范围();
});

/** 用这个人的脱敏器出列表行，按客户名取电话 */
async function 号们(谁: string) {
  const 号 = await 号码脱敏器(谁);
  const rows = await prisma.customer.findMany({ select: 客户行字段 });
  return Object.fromEntries(rows.map((r) => [r.name, 成列表行(r, 号).phone]));
}

it("字段权限关着：销售看到完整号码（手机、座机）；公海里的照旧打码；没号的还是空", async () => {
  expect(await 号们(销售)).toEqual({ 手上的: 手上的号, 座机的: 座机, 公海的: maskPhone(公海的号), 没号的: "" });
});

it("销售教练：规则关着也一律打码（P-教练-05）；公海里的同样打码、不会被打两遍", async () => {
  expect(await 号们(教练)).toEqual({ 手上的: maskPhone(手上的号), 座机的: maskPhone(座机), 公海的: maskPhone(公海的号), 没号的: "" });
});

it("字段权限开着、电话设成「看不到」的角色照旧打码；没设的销售照旧完整", async () => {
  await setSetting(规则.字段权限.key, true);
  await setSetting(字段权限key, { 电话: { sales_ops: "藏" } });
  invalidateSettingsCache();
  忘掉企业版范围();
  expect(await 号们(藏号的)).toEqual({ 手上的: maskPhone(手上的号), 座机的: maskPhone(座机), 公海的: maskPhone(公海的号), 没号的: "" });
  expect((await 号们(销售)).手上的).toBe(手上的号);
});
