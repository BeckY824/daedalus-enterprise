/**
 * 企业版统一公海（2026-10-29，P7）：lib/enterprise/unified-pool.ts（规矩）+ unified-pool-db.ts（取数）+ app/(app)/pool/actions.ts。
 *   - 公海属性：客户名下正好 1 个线索 / 商机阶段没结局的项目才是线索 / 商机，其余其他（订单、有结局、没项目、多项目）；全部 = 线索 + 商机 + 其他
 *   - 入池原因：超时回收 / 主动退回（第 N 次）/ 无效 / 离职交接；快捷按钮一行只落一个
 *   - 退回次数：放进公海 +1、放回项目公海 +1、撤销放进 −1（不到 0）；超时回收不算
 *   - 无效：老板、主管能标；标了领不了、分不了；只有老板能恢复；都留审计
 *   - 筛排：属性 → 关键词 → 快捷 → 排序；按钮上的数不受快捷本身影响
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 放回公海, 领取公海项目 } from "@/lib/project/db";
import { 放进公海, 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 标无效客户, 恢复有效客户 } from "@/app/(app)/pool/actions";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import {
  客户公海属性, 项目公海属性, 规整公海属性, 公海属性们, 客户入池类, 项目入池类, 入池原因文字, 归到快捷, 筛排, 多次退回起, 规整排序,
  type 公海行,
} from "@/lib/enterprise/unified-pool";

// ---------- 纯规矩 ----------
describe("公海属性", () => {
  it("正好一个线索 / 商机阶段、没结局的项目才是线索 / 商机", () => {
    expect(客户公海属性([{ phase: "线索", result: null }])).toBe("线索");
    expect(客户公海属性([{ phase: "商机", result: null }])).toBe("商机");
    expect(项目公海属性({ phase: "线索", result: null })).toBe("线索");
    expect(项目公海属性({ phase: "商机", result: null })).toBe("商机");
  });
  it("没有项目、多个项目、订单阶段、有结局的都是其他", () => {
    expect(客户公海属性([])).toBe("其他");
    expect(客户公海属性([{ phase: "线索", result: null }, { phase: "线索", result: null }])).toBe("其他");
    expect(客户公海属性([{ phase: "订单", result: null }])).toBe("其他");
    expect(客户公海属性([{ phase: "商机", result: "lost" }])).toBe("其他");
  });
  it("「其他」：订单阶段、四种结局（线索流失 / 丢单 / 成功交付 / 异常状态）的项目都进，线索 / 商机不进", () => {
    expect(项目公海属性({ phase: "订单", result: null })).toBe("其他");
    for (const [phase, result] of [["线索", "线索流失"], ["商机", "丢单"], ["订单", "成功交付"], ["商机", "异常状态"], ["线索", "异常状态"]] as const) {
      expect(项目公海属性({ phase, result }), `${phase} / ${result}`).toBe("其他");
      expect(客户公海属性([{ phase, result }]), `${phase} / ${result}`).toBe("其他");
    }
    expect(项目公海属性({ phase: "线索", result: null })).not.toBe("其他");
    expect(项目公海属性({ phase: "商机", result: null })).not.toBe("其他");
  });
  it("筛选顺序 线索 / 商机 / 其他；老链接的 attr（公海线索 / 公海商机 / 公海客户）认回来，认不出的当全部", () => {
    expect(公海属性们).toEqual(["线索", "商机", "其他"]);
    expect(规整公海属性("其他")).toBe("其他");
    expect(规整公海属性("公海客户")).toBe("其他");
    expect(规整公海属性("公海线索")).toBe("线索");
    expect(规整公海属性("公海商机")).toBe("商机");
    expect(规整公海属性("乱写")).toBe("");
    expect(规整公海属性(undefined)).toBe("");
  });
});

describe("入池原因与快捷", () => {
  it("客户：离职交接 / 没操作人或自动理由 = 超时回收 / 有人放的 = 主动退回", () => {
    expect(客户入池类({ reason: "成员停用，放进公海", userId: "u" })).toBe("离职交接");
    expect(客户入池类({ reason: "项目超时", userId: null })).toBe("超时回收");
    expect(客户入池类({ reason: "30 天没跟进，自动放进公海", userId: "u" })).toBe("超时回收");
    expect(客户入池类({ reason: "", userId: "u" })).toBe("主动退回");
  });
  it("项目：系统记的 = 超时回收；没留痕按主动退回", () => {
    expect(项目入池类({ userId: "system", reason: null })).toBe("超时回收");
    expect(项目入池类({ userId: "u", reason: "客户没需求" })).toBe("主动退回");
    expect(项目入池类(null)).toBe("主动退回");
  });
  it("主动退回写第几次，老数据（0 次）至少第 1 次", () => {
    expect(入池原因文字("主动退回", 0)).toBe("主动退回（第 1 次）");
    expect(入池原因文字("主动退回", 3)).toBe("主动退回（第 3 次）");
    expect(入池原因文字("超时回收", 5)).toBe("超时回收");
    // 「无效」页面上叫「无效线索」（10-29 P16），类名不变
    expect(入池原因文字("无效", 2)).toBe("无效线索");
    expect(入池原因文字("离职交接", 0)).toBe("离职交接");
  });
  it("快捷：一到三次各一档，多次从常量起；无效优先；离职交接不进任何按钮", () => {
    expect(归到快捷({ 类: "主动退回", 累计: 1 })).toBe("首次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 2 })).toBe("二次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 3 })).toBe("三次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 多次退回起 })).toBe("多次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 9 })).toBe("多次退回");
    expect(归到快捷({ 类: "无效", 累计: 2 })).toBe("无效客户");
    expect(归到快捷({ 类: "超时回收", 累计: 2 })).toBe("超时回收");
    expect(归到快捷({ 类: "离职交接", 累计: 0 })).toBeNull();
  });
  it("排序只认三个值，别的回默认", () => {
    expect(规整排序("follow")).toBe("follow");
    expect(规整排序("x")).toBe("pooled");
  });
});

describe("筛排", () => {
  const 行 = (id: string, 补: Partial<公海行>): 公海行 => ({
    id, 种: "客户", customerId: id, projectId: null, 客户名: id, 项目名: null, 进程: null, 属性: "其他",
    最后跟进: null, 入池时间: "2026-10-01T00:00:00Z", 创建时间: "2026-09-01T00:00:00Z",
    类: "主动退回", 累计: 1, 入池原因: "", 快捷: "首次退回", 原负责人是我: false, ...补,
  });
  const 全部 = [
    行("甲", { 属性: "线索", 快捷: "超时回收", 入池时间: "2026-10-03T00:00:00Z", 最后跟进: "2026-09-01T00:00:00Z" }),
    行("乙", { 属性: "线索", 快捷: "首次退回", 入池时间: "2026-10-02T00:00:00Z", 最后跟进: "2026-09-20T00:00:00Z" }),
    行("丙", { 属性: "商机", 快捷: "无效客户", 入池时间: "2026-10-01T00:00:00Z", 项目名: "大单" }),
  ];
  it("属性数按关键词数，快捷数按属性数，不受快捷本身影响", () => {
    const r = 筛排(全部, { 属性: "线索", 快捷: "超时回收" });
    expect(r.属性数).toEqual({ 全部: 3, 线索: 2, 商机: 1, 其他: 0 });
    expect(r.快捷数.超时回收).toBe(1);
    expect(r.快捷数.首次退回).toBe(1);
    expect(r.快捷数.无效客户).toBe(0);
    expect(r.行.map((x) => x.id)).toEqual(["甲"]);
  });
  it("筛「其他」只出其他；老链接 公海客户 = 其他；全部 = 线索 + 商机 + 其他", () => {
    const 带其他 = [...全部, 行("丁", { 属性: "其他" }), 行("戊", { 属性: "其他", 快捷: null })];
    const r = 筛排(带其他, { 属性: "其他" });
    expect(r.行.map((x) => x.id).sort()).toEqual(["丁", "戊"]);
    expect(筛排(带其他, { 属性: "公海客户" }).行.map((x) => x.id).sort()).toEqual(["丁", "戊"]);
    expect(r.属性数).toEqual({ 全部: 5, 线索: 2, 商机: 1, 其他: 2 });
    expect(r.属性数.全部).toBe(r.属性数.线索 + r.属性数.商机 + r.属性数.其他);
    // 带关键词也一样相加
    const 搜 = 筛排(带其他, { keyword: "丁" }).属性数;
    expect(搜).toEqual({ 全部: 1, 线索: 0, 商机: 0, 其他: 1 });
  });
  it("关键词搜客户名和项目名", () => {
    expect(筛排(全部, { keyword: "大单" }).行.map((x) => x.id)).toEqual(["丙"]);
  });
  it("默认按入池时间新的在前；按跟进时间时没跟进过的排最后", () => {
    expect(筛排(全部, {}).行.map((x) => x.id)).toEqual(["甲", "乙", "丙"]);
    expect(筛排(全部, { 排序: "follow" }).行.map((x) => x.id)).toEqual(["乙", "甲", "丙"]);
  });
});

// ---------- 库里走一遍 ----------
type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 经理: 人;
let 乙: 人;
let 丙: 人;
let 序 = 0;
async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(ownerId: string) {
  序++;
  return (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1391000${String(序).padStart(4, "0")}`, salesOwnerId: ownerId } })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return (await prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, ...补 } })).id;
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name, role: u.role }; };
const 退回数 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).poolReturns;
const 负责人 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  经理 = await 造人("mgr", "经理", "MANAGER");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  当(老板);
  await setSetting("business", { projectMode: true, poolDays: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("退回次数", () => {
  it("放进公海 +1，撤销放进 −1，不到 0", async () => {
    const c = await 客户(乙.id);
    当(乙);
    expect(await 放进公海([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 退回数(c)).toBe(1);
    expect(await 撤销公海("放进", [{ id: c, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    expect(await 退回数(c)).toBe(0);
    // 再撤一次没东西可撤，也不会扣成负数
    await 撤销公海("放进", [{ id: c, 值: "" }]);
    expect(await 退回数(c)).toBe(0);
  });

  it("放回项目公海 +1，页面上写「主动退回（第 N 次）」，进首次 / 二次退回", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p)).toEqual({ ok: true });
    expect(await 退回数(c)).toBe(1);
    当(丙);
    const 页 = await 读公海页(丙, {}, 1, 20);
    // 单项目客户：客户跟着进客户公海，只列一行客户行（领客户即领项目）
    expect(页.行).toHaveLength(1);
    expect(页.行[0]).toMatchObject({ 种: "客户", customerId: c, 属性: "线索", 入池原因: "主动退回（第 1 次）", 快捷: "首次退回" });
    expect(页.快捷数.首次退回).toBe(1);
    // 丙领了、又放回：第二次
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 放回公海(丙, p)).toEqual({ ok: true });
    expect(await 退回数(c)).toBe(2);
    const 页2 = await 读公海页(老板, { 快捷: "二次退回" }, 1, 20);
    expect(页2.行.map((r) => r.customerId)).toEqual([c]);
  });

  it("开关关着（非企业版）不记次数", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 客户(乙.id);
    当(乙);
    await 放进公海([c]);
    expect(await 退回数(c)).toBe(0);
  });
});

describe("无效客户", () => {
  it("业务员标不了、主管能标；标了谁都领不了、分不了；只有老板能恢复；都留审计", async () => {
    const c = await 客户(乙.id);
    当(乙);
    await 放进公海([c]);

    当(丙);
    expect(await 标无效客户([c])).toEqual({ ok: false, error: "只有老板和主管能标无效客户" });
    当(经理);
    expect(await 标无效客户([c])).toEqual({ ok: true, updated: 1, unchanged: 0 });
    expect(await 标无效客户([c])).toEqual({ ok: true, updated: 0, unchanged: 1 });

    当(丙);
    const 领 = await 领取([c]);
    expect(领).toEqual({ ok: false, error: "标了无效的客户不能领取，要老板先恢复" });
    expect(await 负责人(c)).toBe(乙.id);
    当(老板);
    expect(await 分配公海([c], 丙.id)).toMatchObject({ ok: false });
    const 页 = await 读公海页(老板, { 快捷: "无效客户" }, 1, 20);
    expect(页.行.map((r) => [r.customerId, r.入池原因])).toEqual([[c, "无效线索"]]);

    当(经理);
    expect(await 恢复有效客户([c])).toEqual({ ok: false, error: "只有老板能恢复无效客户" });
    当(老板);
    expect(await 恢复有效客户([c])).toEqual({ ok: true, updated: 1, unchanged: 0 });
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(c)).toBe(丙.id);

    const 审计 = await prisma.auditLog.findMany({ where: { action: { in: ["pool-invalid", "pool-restore"] } }, orderBy: { at: "asc" } });
    expect(审计.map((a) => a.action)).toEqual(["pool-invalid", "pool-restore"]);
  });

  it("单项目客户标了无效：从项目公海领项目也被拦", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    await 放回公海(乙, p);
    当(老板);
    await 标无效客户([c]);
    const r = await 领取公海项目(丙, p);
    expect(r).toEqual({ ok: false, error: "这位客户已标成无效客户，领不了，要老板先恢复" });
  });

  it("不在公海的客户标不上", async () => {
    const c = await 客户(乙.id);
    expect(await 标无效客户([c])).toEqual({ ok: true, updated: 0, unchanged: 1 });
  });

  it("不是企业版（企业版项目模式锁死开着）：两个动作都不做", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 标无效客户(["x"])).toMatchObject({ ok: false });
    expect(await 恢复有效客户(["x"])).toMatchObject({ ok: false });
  });
});

describe("项目行", () => {
  it("客户不在客户公海、项目在项目公海：列成项目行，按项目阶段算属性", async () => {
    const c = await 客户(乙.id);
    // 两个项目：一个订单阶段没结束（客户不跟着进），一个商机放回
    await 项目(乙.id, c, { phase: "订单", node: "签约" });
    const p = await 项目(乙.id, c, { phase: "商机", node: "需求确认" });
    expect(await 放回公海(乙, p)).toEqual({ ok: true });
    const 页 = await 读公海页(丙, {}, 1, 20);
    const 项目行 = 页.行.find((r) => r.种 === "项目");
    expect(项目行).toMatchObject({ projectId: p, 属性: "商机", 入池原因: "主动退回（第 1 次）" });
    expect(页.属性数.商机).toBeGreaterThanOrEqual(1);
  });
});

describe("「其他」在库里走一遍", () => {
  it("订单阶段、四种结局、没项目的公海客户都进其他，线索 / 商机不进；全部 = 线索 + 商机 + 其他", async () => {
    const 放 = async (c: string) => prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    const 线索客户 = await 客户(乙.id); await 项目(乙.id, 线索客户, { phase: "线索", node: "潜客培育" }); await 放(线索客户);
    const 商机客户 = await 客户(乙.id); await 项目(乙.id, 商机客户, { phase: "商机", node: "需求确认" }); await 放(商机客户);
    const 其他们: string[] = [];
    const 订单客户 = await 客户(乙.id); await 项目(乙.id, 订单客户, { phase: "订单", node: "签约" }); 其他们.push(订单客户);
    for (const [phase, result] of [["线索", "线索流失"], ["商机", "丢单"], ["订单", "成功交付"], ["商机", "异常状态"]] as const) {
      const c = await 客户(乙.id); await 项目(乙.id, c, { phase, result, closedAt: new Date() }); 其他们.push(c);
    }
    const 没项目 = await 客户(乙.id); 其他们.push(没项目);
    for (const c of 其他们) await 放(c);
    当(丙);
    const 全 = await 读公海页(丙, {}, 1, 50);
    expect(全.属性数).toEqual({ 全部: 8, 线索: 1, 商机: 1, 其他: 6 });
    expect(全.属性数.全部).toBe(全.属性数.线索 + 全.属性数.商机 + 全.属性数.其他);
    const 其他 = await 读公海页(丙, { 属性: "其他" }, 1, 50);
    expect(其他.行.map((r) => r.customerId).sort()).toEqual([...其他们].sort());
    expect(其他.行.map((r) => r.customerId)).not.toContain(线索客户);
    expect(其他.行.map((r) => r.customerId)).not.toContain(商机客户);
    expect((await 读公海页(丙, { 属性: "线索" }, 1, 50)).行.map((r) => r.customerId)).toEqual([线索客户]);
    expect((await 读公海页(丙, { 属性: "商机" }, 1, 50)).行.map((r) => r.customerId)).toEqual([商机客户]);
  });
});

describe("公海客户过 999 个", () => {
  it("每个都带项目也能读：Prisma 把 IN 拆批再合，orderBy 字段没 select 会 panic（10-30 8702）", async () => {
    const 数 = 1005;
    const ids = Array.from({ length: 数 }, (_, i) => `big-${String(i).padStart(4, "0")}`);
    await prisma.customer.createMany({ data: ids.map((id, i) => ({ id, name: `大客户${i}`, phone: `1380000${String(i).padStart(4, "0")}`, salesOwnerId: 老板.id })) });
    await prisma.customerPool.createMany({ data: ids.map((customerId) => ({ customerId, reason: "手动" })) });
    await prisma.project.createMany({ data: ids.map((customerId, i) => ({ name: `大项目${i}`, customerId, ownerId: 老板.id, creatorId: 老板.id, phase: "线索", node: "潜客培育" })) });
    const 页 = await 读公海页(老板, {}, 1, 20);
    expect(页.行.length).toBe(20);
    expect(页.属性数.线索).toBe(数);
  });
});
