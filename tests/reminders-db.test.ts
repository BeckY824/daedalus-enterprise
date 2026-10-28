/**
 * R2 · 提醒的服务端口径（lib/reminders.ts 算提醒 + lib/reminders-db.ts 取提醒项）在真库上跑。
 *
 * 用真库（prisma/test.db）跑 saveFollowUp / savePlan / deletePlan，看到点还叫不叫。
 * 壳那一半（desktop/reminders.js 每分钟问一次、睡眠补叫、早报）在桌面端仓库里钉，企业库不带壳。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { 算提醒 } from "@/lib/reminders";
import { prisma } from "@/lib/prisma";
import { 取提醒项 } from "@/lib/reminders-db";
import { resetDb } from "./reset";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

afterAll(async () => {
  await prisma.$disconnect();
});

describe("真库：计划改删、跟进提醒顺带建的待办", () => {
  let customerId: string;
  beforeEach(async () => {
    await resetDb();
    await prisma.user.create({ data: { id: "tester-id", email: "t", name: "测试员", title: "", role: "ADMIN", password: "x" } });
    customerId = (await prisma.customer.create({ data: { name: "王总", phone: "13800000001", salesOwnerId: "tester-id" } })).id;
  });
  const 摘要 = async (now: Date) => 算提醒(await 取提醒项("tester-id"), now);
  const 一小时后 = () => {
    const t = new Date(Math.ceil((Date.now() + 3_600_000) / 60_000) * 60_000 + 7 * 60_000);
    // 落在本机零点整就不算「定了时刻」，挪一分钟
    return t.getHours() === 0 && t.getMinutes() === 0 ? new Date(t.getTime() + 60_000) : t;
  };

  it("savePlan 改时间：定时里换成新时刻；deletePlan 之后定时里没了、数也少了", async () => {
    const { savePlan, deletePlan } = await import("@/app/(app)/customers/[id]/actions");
    const t = 一小时后();
    const r = await savePlan({ customerId, subject: "回电话", plannedAt: t.toISOString(), method: "电话" });
    if (!r.ok) throw new Error(r.error);
    expect((await 摘要(t)).定时.map((x) => x.at)).toEqual([t.toISOString()]);
    const t2 = new Date(t.getTime() + 30 * 60_000);
    await savePlan({ id: r.id, customerId, subject: "回电话", plannedAt: t2.toISOString(), method: "电话" });
    expect((await 摘要(t)).定时.map((x) => x.at)).toEqual([t2.toISOString()]);
    await deletePlan(r.id);
    const 后 = await 摘要(t2);
    expect(后.定时).toEqual([]);
    expect(后.今天 + 后.逾期).toBe(0);
  });

  it("新建「跟进提醒」带时间：顺带的待办到点会叫", async () => {
    const { saveFollowUp } = await import("@/app/(app)/customers/[id]/actions");
    const t = 一小时后();
    await saveFollowUp({ customerId, type: "REMIND", title: "回电话", content: "回电话", status: "待处理", occurredAt: new Date().toISOString(), dueAt: t.toISOString() });
    expect((await 摘要(t)).定时.map((x) => [x.标题, x.at])).toEqual([["回电话", t.toISOString()]]);
  });

  /*
    【B · 真坏】「跟进提醒→待办」只在新建时建、之后两头不再联动（customers/[id]/actions.ts:127）：
      - 改了那条跟进的提醒时间 → 待办还是旧时间，到点按旧时间叫，新时间不叫
      - 把那条跟进标成「已完成」 → 待办没完成，照样叫、照样占 Dock 上的数
      - 删了那条跟进 → 待办还在，照样叫
    人改的是「跟进提醒」那一格，不知道背后还有一条待办。
  */
  it("【B-5 真坏】改了跟进提醒的时间：应当按新时间叫，旧时间不叫", async () => {
    const { saveFollowUp } = await import("@/app/(app)/customers/[id]/actions");
    const t = 一小时后();
    const r = await saveFollowUp({ customerId, type: "REMIND", title: "回电话", content: "回电话", status: "待处理", occurredAt: new Date().toISOString(), dueAt: t.toISOString() });
    const t2 = new Date(t.getTime() + 2 * 3_600_000);
    await saveFollowUp({ id: r.ok ? r.id : "", customerId, type: "REMIND", title: "回电话", content: "回电话", status: "待处理", occurredAt: new Date().toISOString(), dueAt: t2.toISOString() });
    expect((await 摘要(t)).定时.map((x) => x.at)).toEqual([t2.toISOString()]);
  });

  it("【B-5 真坏】跟进提醒标成「已完成」：顺带的待办不该再叫", async () => {
    const { saveFollowUp } = await import("@/app/(app)/customers/[id]/actions");
    const t = 一小时后();
    const r = await saveFollowUp({ customerId, type: "REMIND", title: "回电话", content: "回电话", status: "待处理", occurredAt: new Date().toISOString(), dueAt: t.toISOString() });
    await saveFollowUp({ id: r.ok ? r.id : "", customerId, type: "REMIND", title: "回电话", content: "回电话", status: "已完成", occurredAt: new Date().toISOString(), dueAt: t.toISOString() });
    expect((await 摘要(t)).定时).toEqual([]);
  });

  it("【B-5 真坏】删了那条跟进提醒：顺带的待办不该再叫", async () => {
    const { saveFollowUp, deleteFollowUp } = await import("@/app/(app)/customers/[id]/actions");
    const t = 一小时后();
    const r = await saveFollowUp({ customerId, type: "REMIND", title: "回电话", content: "回电话", status: "待处理", occurredAt: new Date().toISOString(), dueAt: t.toISOString() });
    await deleteFollowUp(r.ok ? r.id : "", customerId);
    expect((await 摘要(t)).定时).toEqual([]);
  });
});
