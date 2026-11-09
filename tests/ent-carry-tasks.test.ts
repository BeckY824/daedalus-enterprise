/**
 * 企业版换负责人带待办（11-01 C-06，lib/project/carry-tasks.ts）：
 *   - 转让（改项目 换负责人）：勾着 = 原负责人没做完的待办改给新负责人；不勾 = 关掉、标题接 转让关待办尾
 *   - 领公海（领取公海项目、领客户带走公海项目）：勾着 = 进公海时关掉的那一批重新打开给新负责人；不勾 = 照旧关着
 *   - 分配（分配公海项目）：同领公海
 *   - 原负责人没有待办：不出错，留痕写 0 条；进公海前就做完的待办不会被重新打开
 *   - 没传勾（自动分配那条路）、不是企业版：不碰待办，留痕不写这句
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 放回公海, 领取公海项目, 改项目 } from "@/lib/project/db";
import { 领客户带走公海项目 } from "@/lib/enterprise/pool-link";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 公海规则, 进公海关待办尾, 转让关待办尾 } from "@/lib/enterprise/pool-rules";
import { 撞号提醒尾 } from "@/lib/enterprise/contact-format";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 丙: 人;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name, role };
}
async function 客户(ownerId: string, name = "测试客户") {
  return (await prisma.customer.create({ data: { name, phone: `139${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
}
async function 项目(ownerId: string, customerId: string, name = "一号项目") {
  return (await prisma.project.create({ data: { name, customerId, ownerId, creatorId: ownerId } })).id;
}
const 待办 = (customerId: string, ownerId: string, title: string, 做完 = false) =>
  prisma.task.create({ data: { title, customerId, ownerId, done: 做完, ...(做完 ? { doneAt: new Date("2026-10-01T08:00:00Z") } : {}), dueOn: "2026-11-20" } });
const 看 = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
const 痕 = async (projectId: string, kind: string) =>
  (await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId, kind }, orderBy: [{ at: "desc" }, { id: "desc" }] })).reason;

/** 乙负责、客户归老板的项目，乙在客户上有一条没做完、一条早就做完的待办 */
async function 底子() {
  const c = await 客户(老板.id);
  const p = await 项目(乙.id, c);
  const 没做完 = await 待办(c, 乙.id, "回个电话");
  const 做完了 = await 待办(c, 乙.id, "发资料", true);
  return { c, p, 没做完, 做完了 };
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  公海规则.项目能单独领 = true;
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  // 11-01 权限只认业务角色：老板要有总管理才能转让、分配公海项目，乙、丙要有销售才能领
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 乙.id, bizRole: "sales" },
      { userId: 丙.id, bizRole: "sales" },
    ],
  });
  mocks.user = { ...mocks.user, id: 老板.id, name: 老板.name, role: 老板.role };
});
afterEach(() => {
  vi.unstubAllEnvs();
  公海规则.项目能单独领 = false;
  忘掉企业版范围();
});

describe("转让（改项目 换负责人）", () => {
  it("勾着：乙没做完的待办改给丙，到期日、内容不动；做完的不动；留痕记带过来 1 条", async () => {
    const { p, 没做完, 做完了 } = await 底子();
    expect(await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true)).toMatchObject({ ok: true });
    expect(await 看(没做完.id)).toMatchObject({ ownerId: 丙.id, done: false, title: "回个电话", dueOn: "2026-11-20" });
    expect(await 看(做完了.id)).toMatchObject({ ownerId: 乙.id, done: true, title: "发资料" });
    expect(await 痕(p, "transfer")).toContain("原负责人没做完的待办带过来 1 条");
  });

  it("AI 建档撞号提醒是给原负责人本人的（11-04）：勾着转让也留在乙名下、不关", async () => {
    const { c, p, 没做完 } = await 底子();
    const 撞号 = await 待办(c, 乙.id, `某某疑似与您负责的测试客户${撞号提醒尾}`);
    await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true);
    expect(await 看(撞号.id)).toMatchObject({ ownerId: 乙.id, done: false });
    expect((await 看(没做完.id)).ownerId).toBe(丙.id);
  });

  it("不勾：乙没做完的待办关掉、标题说明原因，还在乙名下；留痕记关掉 1 条", async () => {
    const { p, 没做完, 做完了 } = await 底子();
    expect(await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, false)).toMatchObject({ ok: true });
    const t = await 看(没做完.id);
    expect(t).toMatchObject({ ownerId: 乙.id, done: true, title: `回个电话${转让关待办尾}`, dueOn: "2026-11-20" });
    expect(t.doneAt).not.toBeNull();
    expect(await 看(做完了.id)).toMatchObject({ title: "发资料", doneAt: new Date("2026-10-01T08:00:00Z") });
    expect(await 痕(p, "transfer")).toContain("原负责人没做完的待办没带，关掉 1 条");
  });

  it("转项目客户不动（P-转-04）：点了项目名的待办归丙，客户上的待办和客户负责人还是乙", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, "一号项目");
    const 这个 = await 待办(c, 乙.id, "「一号项目」该跟进了");
    const 客户上的 = await 待办(c, 乙.id, "回个电话");
    await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true);
    expect((await 看(这个.id)).ownerId).toBe(丙.id);
    expect((await 看(客户上的.id)).ownerId).toBe(乙.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(乙.id);
  });

  it("转让一个项目（P-转-04）：客户不动，客户名下别的项目照旧归乙", async () => {
    const c = await 客户(乙.id);
    const p1 = await 项目(乙.id, c, "一号项目");
    const p2 = await 项目(乙.id, c, "二号项目");
    await 改项目(老板, p1, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p1 } })).ownerId).toBe(丙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).ownerId).toBe(乙.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(乙.id);
  });

  it("转让项目时客户在公海（P-转-04）：客户不出公海，客户负责人不变，项目归丙", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c, "一号项目");
    await prisma.customerPool.create({ data: { customerId: c } });
    await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true);
    expect(await prisma.customerPool.findUnique({ where: { customerId: c } })).not.toBeNull();
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(乙.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
  });

  it("原负责人没有待办：照样转，留痕写 0 条", async () => {
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    expect(await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true)).toMatchObject({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).ownerId).toBe(丙.id);
    expect(await 痕(p, "transfer")).toContain("带过来 0 条");
  });

  it("没传勾（老路子）/ 不是企业版：不碰待办，留痕不写", async () => {
    const { p, 没做完 } = await 底子();
    await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 });
    expect(await 看(没做完.id)).toMatchObject({ ownerId: 乙.id, done: false });
    expect(await 痕(p, "transfer") ?? "").not.toContain("待办");

    vi.stubEnv("CRM_ENTERPRISE", "");
    const c2 = await 客户(老板.id);
    const p2 = await 项目(乙.id, c2);
    const t2 = await 待办(c2, 乙.id, "回个电话");
    await 改项目(老板, p2, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true);
    expect(await 看(t2.id)).toMatchObject({ ownerId: 乙.id, done: false });
  });
});

describe("领公海（领取公海项目）", () => {
  it("勾着：进公海时关掉的那条重新打开给丙、去掉标题尾巴；进公海前就做完的不重开", async () => {
    const { p, 没做完, 做完了 } = await 底子();
    await 放回公海(乙, p);
    expect(await 看(没做完.id)).toMatchObject({ done: true, title: `回个电话${进公海关待办尾}` });
    expect(await 领取公海项目(丙, p, true)).toEqual({ ok: true });
    expect(await 看(没做完.id)).toMatchObject({ ownerId: 丙.id, done: false, doneAt: null, title: "回个电话", dueOn: "2026-11-20" });
    expect(await 看(做完了.id)).toMatchObject({ ownerId: 乙.id, done: true, title: "发资料" });
    expect(await 痕(p, "pool-claim")).toContain("原负责人没做完的待办带过来 1 条");
  });

  it("不勾：照旧关着、还在乙名下；留痕记没带", async () => {
    const { p, 没做完 } = await 底子();
    await 放回公海(乙, p);
    expect(await 领取公海项目(丙, p, false)).toEqual({ ok: true });
    expect(await 看(没做完.id)).toMatchObject({ ownerId: 乙.id, done: true, title: `回个电话${进公海关待办尾}` });
    expect(await 痕(p, "pool-claim")).toBe("原负责人没做完的待办没带");
  });

  it("只认最近一次进公海那一批：丙领了不带、再放回，乙领回时不会把第一批也打开", async () => {
    const { p, 没做完 } = await 底子();
    await 放回公海(乙, p);
    await 领取公海项目(丙, p, false);
    const 丙的 = await 待办((await prisma.project.findUniqueOrThrow({ where: { id: p } })).customerId, 丙.id, "再约一次");
    await 放回公海(丙, p);
    expect(await 领取公海项目(乙, p, true)).toEqual({ ok: true });
    expect(await 看(丙的.id)).toMatchObject({ ownerId: 乙.id, done: false, title: "再约一次" });
    expect(await 看(没做完.id)).toMatchObject({ done: true, title: `回个电话${进公海关待办尾}` });
  });

  it("领客户带走公海里的项目：同样按勾", async () => {
    const { c, p, 没做完 } = await 底子();
    await 放回公海(乙, p);
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 丙.id } });
    expect(await 领客户带走公海项目([c], 丙.id, 丙.id, true)).toEqual([p]);
    expect(await 看(没做完.id)).toMatchObject({ ownerId: 丙.id, done: false, title: "回个电话" });
    expect(await 痕(p, "pool-claim")).toContain("带过来 1 条");
  });
});

describe("分配（分配公海项目）", () => {
  it("勾着：老板把公海项目分给丙，那一批重新打开给丙", async () => {
    const { p, 没做完, 做完了 } = await 底子();
    await 放回公海(乙, p);
    expect(await 分配公海项目([p], 丙.id, true)).toMatchObject({ ok: true, 分到: [p] });
    expect(await 看(没做完.id)).toMatchObject({ ownerId: 丙.id, done: false, title: "回个电话" });
    expect(await 看(做完了.id)).toMatchObject({ ownerId: 乙.id, done: true });
    expect(await 痕(p, "pool-claim")).toContain("带过来 1 条");
  });

  it("不勾：照旧关着", async () => {
    const { p, 没做完 } = await 底子();
    await 放回公海(乙, p);
    expect(await 分配公海项目([p], 丙.id, false)).toMatchObject({ ok: true, 分到: [p] });
    expect(await 看(没做完.id)).toMatchObject({ ownerId: 乙.id, done: true, title: `回个电话${进公海关待办尾}` });
    expect(await 痕(p, "pool-claim")).toBe("原负责人没做完的待办没带");
  });

  it("没传勾按默认勾（带）；原负责人没有待办时写 0 条", async () => {
    const c = await 客户(老板.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    expect(await 分配公海项目([p], 丙.id)).toMatchObject({ ok: true, 分到: [p] });
    expect(await 痕(p, "pool-claim")).toBe("原负责人没做完的待办带过来 0 条");
  });
});
