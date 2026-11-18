/**
 * 审核 11-18「通知与定时任务」P1-3：定时分配到点执行时分配那一步抛错（SQLite 写锁忙这类），原来定时已清、谁都不知道，
 * 线索静悄悄停在待分配。现在：记日志、站内通知系统管理员（不推飞书），录入人照「没分出去」收提醒（lib/enterprise/scheduled-assign.ts）
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/app/(app)/leads/assign-actions", () => ({
  定时分出去: vi.fn(async () => {
    throw new Error("SQLITE_BUSY: database is locked");
  }),
}));

import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/settings";
import { resetDb } from "./reset";
import { 定时分配扫一遍 } from "@/lib/enterprise/scheduled-assign";
import { 规则 } from "@/lib/enterprise/rules";

beforeEach(async () => {
  await resetDb();
});

describe("定时分配执行抛错", () => {
  it("系统管理员收到站内「定时分配出错」（只一次）；录入人收到「没分出去」；日志记一笔", async () => {
    const 人 = async (email: string, bizRole: string) => {
      const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
      await prisma.entMember.create({ data: { userId: id, bizRole } });
      return id;
    };
    const 录入人 = await 人("m@x", "marketing_mgr");
    const 管理员 = await 人("boss@x", "director");
    await setSetting(规则.线索分配.key, true);
    const c = await prisma.customer.create({ data: { name: "客户", phone: "13900000001", salesOwnerId: 录入人 } });
    const 原定 = new Date(Date.now() - 60_000);
    await prisma.project.create({
      data: { name: "定时线索", customerId: c.id, ownerId: 录入人, creatorId: 录入人, awaitAssignAt: new Date(Date.now() - 3_600_000), scheduledAssignAt: 原定, scheduledAssignTo: null },
    });
    const 错 = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await 定时分配扫一遍(new Date());
    expect(r.没分出去).toBe(1);
    expect(错.mock.calls.some((c) => String(c[0]).includes("[定时分配]"))).toBe(true);
    错.mockRestore();
    const 管 = await prisma.entNotice.findMany({ where: { userId: 管理员, kind: "定时分配出错" } });
    expect(管).toHaveLength(1);
    expect(管[0].title).toContain("定时线索");
    expect(await prisma.entNotice.count({ where: { userId: 录入人, kind: "待分配", title: { contains: "定时分配没分出去" } } })).toBe(1);
  });
});
