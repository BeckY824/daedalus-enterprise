/**
 * 再导一份和上次一模一样的表（11-03 完成度 D7-5、D7-9）：
 * 试跑报告里这些算「没变」，不算会写；正式导入写完什么都没动时不留一个空批次（同 sync 写完）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "总管", email: "dir@x", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 试跑, 重新试跑 } from "@/lib/enterprise-import/report";
import { 正式导入一段 } from "@/app/(app)/settings/enterprise-import-actions";
import type { 读出的表 } from "@/lib/enterprise-import/excel";

const 客户表 = (): 读出的表 => ({
  名: "客户.xlsx",
  实体: "customer",
  表头: ["记录ID", "客户名称", "手机号码", "客户负责人"],
  行: [
    ["C1", "云帆科技有限公司", "13800000001", "张伟"],
    ["C2", "海川贸易", "13800000002", "张伟"],
  ],
  行号: [2, 3],
  提醒: [],
});

let 张伟 = "";
async function 跑() {
  const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: mocks.user.id, 表: [客户表()], 建议器: null });
  return 重新试跑(批次Id, { 默认负责人Id: 张伟 }, mocks.user.id);
}
async function 导完(批次Id: string) {
  for (;;) {
    const w = await 正式导入一段(批次Id, "外贸");
    if (w.完了) return w;
  }
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.user.id = (await prisma.user.create({ data: { email: "dir", name: "总管", title: "", role: "SALES", password: "x" } })).id;
  张伟 = (await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: mocks.user.id, bizRole: "director" }, { userId: 张伟, bizRole: "sales" }] });
});

describe("再导一份一样的表", () => {
  it("试跑报告里算没变；正式导入什么都没写，不留空批次", async () => {
    const 首 = await 跑();
    const w1 = await 导完(首.批次Id);
    expect(w1).toMatchObject({ 新建: 2 });
    expect(w1.没留批次).toBeUndefined();

    const 再 = await 跑();
    expect(再.报告.按类.customer.没变).toBe(2);
    expect(再.报告.合计.待写 - 再.报告.按类.customer.没变).toBe(0);
    const w2 = await 导完(再.批次Id);
    expect(w2).toMatchObject({ 新建: 0, 更新: 0, 冲突: 0, 失败: 0, 没留批次: true });
    expect(await prisma.entImportBatch.findUnique({ where: { id: 再.批次Id } })).toBeNull();
    expect(await prisma.entImportBatch.count()).toBe(1);
  });
});
