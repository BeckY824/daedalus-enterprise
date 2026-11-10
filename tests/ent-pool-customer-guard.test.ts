/**
 * 线索 / 项目挂公海客户的共用判断（src/lib/enterprise/pool-customer-guard.ts，P-公海-08）。
 *   客户公海里有这一行才拦，回客户名；不在公海、客户不在了、不是企业版都不拦
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 公海客户要先领取 } from "@/lib/enterprise/pool-customer-guard";

let 张伟 = "";

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  张伟 = (await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } })).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("公海客户要先领取", () => {
  it("在客户公海里回客户名；不在公海、找不到的回 null；事务里同样能用", async () => {
    const 公海 = await prisma.customer.create({ data: { name: "公海客户", phone: "", salesOwnerId: 张伟 } });
    const 有主 = await prisma.customer.create({ data: { name: "有主客户", phone: "", salesOwnerId: 张伟 } });
    await prisma.customerPool.create({ data: { customerId: 公海.id, userId: 张伟 } });
    expect(await 公海客户要先领取(prisma, 公海.id)).toEqual({ 客户名: "公海客户" });
    expect(await 公海客户要先领取(prisma, 有主.id)).toBeNull();
    expect(await 公海客户要先领取(prisma, "没有这位")).toBeNull();
    expect(await prisma.$transaction((tx) => 公海客户要先领取(tx, 公海.id))).toEqual({ 客户名: "公海客户" });
  });

  it("不是企业版：不拦", async () => {
    const 公海 = await prisma.customer.create({ data: { name: "公海客户", phone: "", salesOwnerId: 张伟 } });
    await prisma.customerPool.create({ data: { customerId: 公海.id, userId: 张伟 } });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 公海客户要先领取(prisma, 公海.id)).toBeNull();
  });
});
