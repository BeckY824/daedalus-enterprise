/**
 * 企业版统一公海（2026-10-29，P7）：lib/enterprise/unified-pool.ts（规矩）+ unified-pool-db.ts（取数）+ app/(app)/pool/actions.ts。
 *   - 公海属性（M-公海-08）：先给客户定状态——有没结束的项目取阶段最高的，都结束了取结局所在阶段最高的；
 *     线索（含线索流失）→ 线索池，商机（含丢单）→ 商机池，订单（含交付结清 / 异常）→ 订单池，没项目 → 客户池（11-11 四池，暂定归法，都在 归池）；
 *     全部 = 四池之和
 *   - 当前进程（U-公海-04）：节点 · 状态；其他类前面带阶段
 *   - 入池方式（筛选）：超时回收 / 首次～多次退回 / 无效，一行最多落一个；离职交接不算入池方式（A-14 / P-转-14）；入池原因（列，M-公海-09）= 退回原因，没选「—」
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
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 无主入池理由 } from "@/lib/enterprise-import/project-target";
import { 放回公海, 领取公海项目 } from "@/lib/project/db";
import { 放进公海, 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 标无效客户, 恢复有效客户 } from "@/app/(app)/pool/actions";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import {
  客户公海属性, 项目公海属性, 规整公海属性, 公海属性们, 客户入池类, 项目入池类, 入池原因文字, 归到快捷, 筛排, 多次退回起, 规整排序,
  客户定状态, 进程格, 拆退回原因, 归池, 要选退回原因提示, 快捷们, type 公海行,
} from "@/lib/enterprise/unified-pool";

// ---------- 纯规矩 ----------
describe("公海属性（按阶段定状态）", () => {
  const 未 = (phase: string) => ({ phase, result: null });
  const 结 = (phase: string, result: string) => ({ phase, result });
  // [说明, 名下项目, 应属, 定状态用的是第几个]
  const 表: [string, { phase: string; result: string | null }[], string, number | null][] = [
    ["没有项目", [], "客户池", null],
    ["一个线索、没结束", [未("线索")], "线索池", 0],
    ["一个商机、没结束", [未("商机")], "商机池", 0],
    ["一个订单、没结束", [未("订单")], "订单池", 0],
    ["线索流失", [结("线索", "线索流失")], "线索池", 0],
    ["丢单", [结("商机", "丢单")], "商机池", 0],
    ["订单结束（交付）", [结("订单", "成功交付")], "订单池", 0],
    ["异常状态按订单结局算", [结("商机", "异常状态")], "订单池", 0],
    ["多项目：没结束的取最高，订单 > 商机 > 线索", [未("线索"), 未("订单"), 未("商机")], "订单池", 1],
    ["多项目：商机 > 线索", [未("线索"), 未("商机")], "商机池", 1],
    ["多项目：两个线索，同阶段取前面那个", [未("线索"), 未("线索")], "线索池", 0],
    ["没结束的优先于结束的：线索进行中 + 订单交付 → 线索", [结("订单", "成功交付"), 未("线索")], "线索池", 1],
    ["没结束的优先于结束的：商机进行中 + 线索流失 → 商机", [结("线索", "线索流失"), 未("商机")], "商机池", 1],
    ["全部结束取最高结局：线索流失 + 丢单 → 商机", [结("线索", "线索流失"), 结("商机", "丢单")], "商机池", 1],
    ["全部结束取最高结局：丢单 + 交付 → 订单池", [结("商机", "丢单"), 结("订单", "成功交付")], "订单池", 1],
    ["全部结束：两个线索流失 → 线索", [结("线索", "线索流失"), 结("线索", "线索流失")], "线索池", 0],
  ];
  for (const [说明, 项目们, 应属, 第几] of 表) {
    it(说明, () => {
      const r = 客户定状态(项目们);
      expect(r.属性).toBe(应属);
      expect(客户公海属性(项目们)).toBe(应属);
      expect(归池({ 种: "客户", 项目们 })).toBe(应属);
      expect(r.项目).toBe(第几 === null ? null : 项目们[第几]);
    });
  }
  it("项目行按它自己的阶段：线索 → 线索池、商机 → 商机池（项目公海只收这两个阶段）；导入自动建的标记暂时不影响", () => {
    expect(项目公海属性(未("线索"))).toBe("线索池");
    expect(项目公海属性(未("商机"))).toBe("商机池");
    expect(项目公海属性(结("线索", "线索流失"))).toBe("线索池");
    expect(项目公海属性(结("商机", "丢单"))).toBe("商机池");
    expect(归池({ 种: "项目", 项目们: [{ ...未("线索"), 导入自动建: true }] })).toBe("线索池");
    expect(归池({ 种: "客户", 项目们: [{ ...未("线索"), 导入自动建: true }] })).toBe("线索池");
  });
  it("每行恰好落一个池（四池之一），不会落到别的", () => {
    for (const 项目们 of [[], [未("线索")], [未("商机")], [未("订单")], [结("订单", "交付结清")], [结("商机", "异常状态")], [{ phase: "乱写", result: null }]]) {
      for (const 种 of ["客户", "项目"] as const) {
        if (种 === "项目" && !项目们.length) continue;
        expect(公海属性们).toContain(归池({ 种, 项目们 }));
      }
    }
  });
  it("筛选顺序 线索池 / 商机池 / 订单池 / 客户池；老链接的 attr（公海线索 / 公海商机、线索 / 商机）认回来；老的「其他」「公海客户」拆成了两个池，认回全部", () => {
    expect(公海属性们).toEqual(["线索池", "商机池", "订单池", "客户池"]);
    expect(规整公海属性("其他")).toBe("");
    expect(规整公海属性("公海客户")).toBe("");
    expect(规整公海属性("订单池")).toBe("订单池");
    expect(规整公海属性("客户池")).toBe("客户池");
    expect(规整公海属性("公海线索")).toBe("线索池");
    expect(规整公海属性("公海商机")).toBe("商机池");
    expect(规整公海属性("线索")).toBe("线索池");
    expect(规整公海属性("商机")).toBe("商机池");
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
  it("入池原因列：主动退回写退回原因，没选「—」；超时回收、离职交接写自己", () => {
    expect(入池原因文字("主动退回", "回收原因：客户主动终止")).toBe("客户主动终止");
    expect(入池原因文字("主动退回", "名下唯一的项目进了项目公海，客户一起放进公海；回收原因：其他：预算砍了")).toBe("其他：预算砍了");
    expect(入池原因文字("主动退回", "手动")).toBe("—");
    expect(入池原因文字("主动退回", null)).toBe("—");
    expect(入池原因文字("超时回收", "回收原因：超时未跟进")).toBe("超时回收");
    expect(入池原因文字("离职交接", "成员停用，放进公海")).toBe("离职交接");
    expect(拆退回原因("回收原因：  ")).toBeNull();
    expect(拆退回原因(undefined)).toBeNull();
  });
  it("入池方式：一到三次各一档，多次从常量起；无效优先；离职交接不算入池方式、筛选里没有（A-14 / P-转-14）", () => {
    expect(归到快捷({ 类: "主动退回", 累计: 0 })).toBe("首次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 1 })).toBe("首次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 2 })).toBe("二次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 3 })).toBe("三次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 多次退回起 })).toBe("多次退回");
    expect(多次退回起).toBe(4);
    expect(归到快捷({ 类: "主动退回", 累计: 9 })).toBe("多次退回");
    expect(归到快捷({ 类: "无效", 累计: 2 })).toBe("无效客户");
    expect(归到快捷({ 类: "超时回收", 累计: 2 })).toBe("超时回收");
    expect(归到快捷({ 类: "离职交接", 累计: 0 })).toBeNull();
    expect(快捷们).toEqual(["超时回收", "首次退回", "二次退回", "三次退回", "多次退回", "无效客户"]);
  });
  it("当前进程：阶段-节点，有结局再带结局", () => {
    expect(进程格("线索池", { 阶段: "线索", 节点: "潜客培育", 结局: null })).toBe("线索-潜客培育");
    expect(进程格("线索池", { 阶段: "线索", 节点: "线索验证", 结局: "线索流失" })).toBe("线索-线索验证 · 线索流失");
    expect(进程格("商机池", { 阶段: "商机", 节点: "需求确认", 结局: "商机丢单" })).toBe("商机-需求确认 · 商机丢单");
    expect(进程格("订单池", { 阶段: "订单", 节点: "签约", 结局: null })).toBe("订单-签约");
    expect(进程格("订单池", { 阶段: "订单", 节点: "交付", 结局: "交付结清" })).toBe("订单-交付 · 交付结清");
  });
  it("排序只认三个值，别的回默认", () => {
    expect(规整排序("follow")).toBe("follow");
    expect(规整排序("x")).toBe("pooled");
  });
});

describe("筛排", () => {
  const 行 = (id: string, 补: Partial<公海行>): 公海行 => ({
    id, 种: "客户", customerId: id, projectId: null, 客户名: id, 项目名: null, 进程: null, 进程明细: null, 属性: "客户池",
    最后跟进: null, 入池时间: "2026-10-01T00:00:00Z", 创建时间: "2026-09-01T00:00:00Z",
    类: "主动退回", 累计: 1, 入池原因: "", 快捷: "首次退回", 原负责人是我: false, ...补,
  });
  const 全部 = [
    行("甲", { 属性: "线索池", 快捷: "超时回收", 入池时间: "2026-10-03T00:00:00Z", 最后跟进: "2026-09-01T00:00:00Z" }),
    行("乙", { 属性: "线索池", 快捷: "首次退回", 入池时间: "2026-10-02T00:00:00Z", 最后跟进: "2026-09-20T00:00:00Z" }),
    行("丙", { 属性: "商机池", 快捷: "无效客户", 入池时间: "2026-10-01T00:00:00Z", 项目名: "大单" }),
  ];
  it("属性数按关键词数，快捷数按属性数，不受快捷本身影响", () => {
    const r = 筛排(全部, { 属性: "线索池", 快捷: "超时回收" });
    expect(r.属性数).toEqual({ 全部: 3, 线索池: 2, 商机池: 1, 订单池: 0, 客户池: 0 });
    expect(r.快捷数.超时回收).toBe(1);
    expect(r.快捷数.首次退回).toBe(1);
    expect(r.快捷数.无效客户).toBe(0);
    expect(r.行.map((x) => x.id)).toEqual(["甲"]);
  });
  it("筛订单池 / 客户池只出它；老链接 attr=其他 / 公海客户 认回全部；全部 = 四池之和", () => {
    const 带四池 = [...全部, 行("丁", { 属性: "订单池" }), 行("戊", { 属性: "客户池", 快捷: null }), 行("己", { 属性: "客户池", 种: "项目", projectId: "p己" })];
    expect(筛排(带四池, { 属性: "订单池" }).行.map((x) => x.id)).toEqual(["丁"]);
    expect(筛排(带四池, { 属性: "客户池" }).行.map((x) => x.id).sort()).toEqual(["己", "戊"].sort());
    for (const 老 of ["其他", "公海客户"]) expect(筛排(带四池, { 属性: 老 }).行).toHaveLength(带四池.length);
    const r = 筛排(带四池, {});
    expect(r.属性数).toEqual({ 全部: 6, 线索池: 2, 商机池: 1, 订单池: 1, 客户池: 2 });
    const 和 = (x: typeof r.属性数) => 公海属性们.reduce((s, k) => s + x[k], 0);
    expect(r.属性数.全部).toBe(和(r.属性数));
    // 带关键词、来源、快捷也一样相加
    for (const sp of [{ keyword: "丁" }, { keyword: "大单" }, { 来源: "c1" }, { 快捷: "首次退回" }, { 属性: "订单池" }]) {
      const x = 筛排(带四池, sp).属性数;
      expect([sp, x.全部]).toEqual([sp, 和(x)]);
    }
    expect(筛排(带四池, { keyword: "丁" }).属性数).toEqual({ 全部: 1, 线索池: 0, 商机池: 0, 订单池: 1, 客户池: 0 });
  });
  it("关键词搜客户名和项目名", () => {
    expect(筛排(全部, { keyword: "大单" }).行.map((x) => x.id)).toEqual(["丙"]);
  });
  it("客户来源（11-06 自定义筛选）：只留这个来源的，属性数、快捷数跟着；没来源的不出；和关键词叠加", () => {
    const 带来源 = [
      行("甲", { 属性: "线索池", 快捷: "超时回收", 来源id: "c1" }),
      行("乙", { 属性: "线索池", 快捷: "首次退回", 来源id: "c2" }),
      行("丙", { 属性: "商机池", 快捷: "无效客户", 来源id: "c1", 项目名: "大单" }),
      行("丁", { 属性: "订单池", 来源id: null }),
    ];
    const r = 筛排(带来源, { 来源: "c1" });
    expect(r.行.map((x) => x.id).sort()).toEqual(["甲", "丙"].sort());
    expect(r.属性数).toEqual({ 全部: 2, 线索池: 1, 商机池: 1, 订单池: 0, 客户池: 0 });
    expect(r.快捷数.超时回收).toBe(1);
    expect(r.快捷数.首次退回).toBe(0);
    expect(筛排(带来源, { 来源: "c1", keyword: "大单" }).行.map((x) => x.id)).toEqual(["丙"]);
    expect(筛排(带来源, { 来源: "没有这个" }).行).toEqual([]);
    expect(筛排(带来源, {}).行).toHaveLength(4);
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
/** 权限只认业务角色（11-01）：账号 ADMIN = 总管理、MANAGER = 销售管理、SALES = 销售成员 */
const 业务角色of: Record<string, string> = { ADMIN: "director", MANAGER: "sales_mgr", SALES: "sales" };
async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: 业务角色of[role] } });
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
    expect(await 放进公海([c], "客户主动终止")).toMatchObject({ ok: true, updated: 1 });
    expect(await 退回数(c)).toBe(1);
    expect(await 撤销公海("放进", [{ id: c, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    expect(await 退回数(c)).toBe(0);
    // 再撤一次没东西可撤，也不会扣成负数
    await 撤销公海("放进", [{ id: c, 值: "" }]);
    expect(await 退回数(c)).toBe(0);
  });

  it("放回线索公海 +1，入池原因列写退回原因（没选「—」），入池方式进首次 / 二次退回", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p, "线索质量不达标")).toEqual({ ok: true });
    expect(await 退回数(c)).toBe(1);
    当(丙);
    const 页 = await 读公海页(丙, {}, 1, 20);
    // 项目退回只进线索公海，客户不动（M-公海-02）：列一行项目行
    expect(页.行).toHaveLength(1);
    expect(页.行[0]).toMatchObject({ 种: "项目", customerId: c, projectId: p, 属性: "线索池", 入池原因: "线索质量不达标", 快捷: "首次退回" });
    expect(页.快捷数.首次退回).toBe(1);
    // 丙领了、又放回：第二次
    expect(await 领取公海项目(丙, p)).toEqual({ ok: true });
    expect(await 放回公海(丙, p)).toEqual({ ok: true });
    expect(await 退回数(c)).toBe(2);
    const 页2 = await 读公海页(老板, { 快捷: "二次退回" }, 1, 20);
    expect(页2.行.map((r) => r.customerId)).toEqual([c]);
    expect(页2.行[0].入池原因).toBe("—");
  });

  it("开关关着（非企业版）不记次数", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 客户(乙.id);
    当(乙);
    await 放进公海([c]);
    expect(await 退回数(c)).toBe(0);
  });
});

describe("客户放回公海选退回原因（M-公海-09）", () => {
  it("企业版不选不让放；选了存下来，入池原因列显示它；「其他」要写具体", async () => {
    const c = await 客户(乙.id);
    当(乙);
    expect(await 放进公海([c])).toEqual({ ok: false, error: 要选退回原因提示 });
    expect(await 放进公海([c], "其他")).toMatchObject({ ok: false });
    expect(await 放进公海([c], "瞎写的")).toMatchObject({ ok: false });
    expect(await prisma.customerPool.findUnique({ where: { customerId: c } })).toBeNull();
    expect(await 退回数(c)).toBe(0);
    expect(await 放进公海([c], "其他：预算砍了")).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.customerPool.findUniqueOrThrow({ where: { customerId: c } })).reason).toBe("回收原因：其他：预算砍了");
    当(丙);
    const 页 = await 读公海页(丙, {}, 1, 20);
    expect(页.行.map((r) => [r.customerId, r.入池原因, r.快捷])).toEqual([[c, "其他：预算砍了", "首次退回"]]);
  });

  it("没权限的那句照旧先说，不先要原因", async () => {
    const c = await 客户(乙.id);
    当(丙);
    expect(await 放进公海([c])).toMatchObject({ ok: false, error: expect.stringContaining("只有负责人、直属上级或总管理") });
  });

  it("不是企业版：不问原因，照旧记「手动」", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 客户(乙.id);
    当(乙);
    expect(await 放进公海([c])).toMatchObject({ ok: true, updated: 1 });
    expect((await prisma.customerPool.findUniqueOrThrow({ where: { customerId: c } })).reason).toBe("手动");
  });
});

describe("无效客户", () => {
  it("业务员标不了、主管能标；标了谁都领不了、分不了；只有老板能恢复；都留审计", async () => {
    const c = await 客户(乙.id);
    当(乙);
    await 放进公海([c], "客户主动终止");

    当(丙);
    expect(await 标无效客户([c])).toEqual({ ok: false, error: "只有总管理和销售管理能标无效客户" });
    当(经理);
    expect(await 标无效客户([c])).toEqual({ ok: true, updated: 1, unchanged: 0 });
    expect(await 标无效客户([c])).toEqual({ ok: true, updated: 0, unchanged: 1 });

    当(丙);
    const 领 = await 领取([c]);
    expect(领).toEqual({ ok: false, error: "标了无效的客户不能领取，要系统管理员先恢复" });
    expect(await 负责人(c)).toBe((await prisma.user.findUniqueOrThrow({ where: { email: 无负责人占位邮箱 } })).id); // 进公海负责人已清空（M-公海-03），被拦不动
    当(老板);
    expect(await 分配公海([c], 丙.id)).toMatchObject({ ok: false });
    const 页 = await 读公海页(老板, { 快捷: "无效客户" }, 1, 20);
    // 无效是入池方式（红标），入池原因列照旧写退回原因
    expect(页.行.map((r) => [r.customerId, r.类, r.入池原因])).toEqual([[c, "无效", "客户主动终止"]]);

    当(经理);
    expect(await 恢复有效客户([c])).toEqual({ ok: false, error: "只有系统管理员或回收站副手能恢复无效客户" });
    当(老板);
    expect(await 恢复有效客户([c])).toEqual({ ok: true, updated: 1, unchanged: 0 });
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(c)).toBe(丙.id);

    const 审计 = await prisma.auditLog.findMany({ where: { action: { in: ["pool-invalid", "pool-restore"] } }, orderBy: { at: "asc" } });
    expect(审计.map((a) => a.action)).toEqual(["pool-invalid", "pool-restore"]);
  });

  it("客户标了无效：从线索公海领它的项目也被拦", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    当(乙);
    await 放进公海([c], "客户主动终止");
    当(老板);
    await 标无效客户([c]);
    const r = await 领取公海项目(丙, p);
    expect(r).toEqual({ ok: false, error: "这位客户已标成无效客户，领不了，要系统管理员先恢复" });
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
    expect(项目行).toMatchObject({ projectId: p, 属性: "商机池", 入池原因: "—", 进程: "商机-需求确认", 进程明细: null });
    expect(页.属性数.商机池).toBeGreaterThanOrEqual(1);
  });
});

describe("按阶段分池在库里走一遍", () => {
  it("线索流失进线索池、丢单进商机池；订单（进行中 / 交付 / 异常）进订单池、没项目进客户池；多项目按定状态；全部 = 四池之和", async () => {
    const 放 = async (c: string) => prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    const 线索们: string[] = [];
    const 商机们: string[] = [];
    const 订单们: string[] = [];
    const 客户池们: string[] = [];
    const 线索客户 = await 客户(乙.id); await 项目(乙.id, 线索客户, { phase: "线索", node: "潜客培育" }); 线索们.push(线索客户);
    const 商机客户 = await 客户(乙.id); await 项目(乙.id, 商机客户, { phase: "商机", node: "需求确认" }); 商机们.push(商机客户);
    const 订单客户 = await 客户(乙.id); await 项目(乙.id, 订单客户, { phase: "订单", node: "签约" }); 订单们.push(订单客户);
    const 流失客户 = await 客户(乙.id); await 项目(乙.id, 流失客户, { phase: "线索", node: "线索验证", result: "线索流失", closedAt: new Date() }); 线索们.push(流失客户);
    const 丢单客户 = await 客户(乙.id); await 项目(乙.id, 丢单客户, { phase: "商机", node: "需求确认", result: "丢单", closedAt: new Date() }); 商机们.push(丢单客户);
    for (const [phase, result] of [["订单", "成功交付"], ["商机", "异常状态"]] as const) {
      const c = await 客户(乙.id); await 项目(乙.id, c, { phase, result, closedAt: new Date() }); 订单们.push(c);
    }
    const 没项目 = await 客户(乙.id); 客户池们.push(没项目);
    // 多项目：线索进行中 + 订单已交付 → 没结束的优先 → 线索池；格子里写定状态那个，悬停有每个项目
    const 多项目 = await 客户(乙.id);
    await 项目(乙.id, 多项目, { phase: "订单", node: "签约", result: "成功交付", closedAt: new Date() });
    await 项目(乙.id, 多项目, { phase: "线索", node: "潜客培育" });
    线索们.push(多项目);
    for (const c of [...线索们, ...商机们, ...订单们, ...客户池们]) await 放(c);
    // 项目行（客户有负责人、项目在项目公海）：按项目自己的阶段
    const 有主客户 = await 客户(乙.id);
    const 公海线索项目 = await 项目(乙.id, 有主客户, { phase: "线索", node: "线索验证" });
    expect(await 放回公海(乙, 公海线索项目)).toEqual({ ok: true });
    当(丙);
    const 全 = await 读公海页(丙, {}, 1, 50);
    expect(全.属性数).toEqual({ 全部: 10, 线索池: 4, 商机池: 2, 订单池: 3, 客户池: 1 });
    expect(全.属性数.全部).toBe(公海属性们.reduce((s, k) => s + 全.属性数[k], 0));
    const ids = async (属性: string) => (await 读公海页(丙, { 属性 }, 1, 50)).行.map((r) => r.customerId).sort();
    expect(await ids("线索池")).toEqual([...线索们, 有主客户].sort());
    expect(await ids("商机池")).toEqual([...商机们].sort());
    expect(await ids("订单池")).toEqual([...订单们].sort());
    expect(await ids("客户池")).toEqual([...客户池们].sort());
    // 老链接 attr=其他 认回全部
    expect((await 读公海页(丙, { 属性: "其他" }, 1, 50)).总数).toBe(10);
    const 行of = (c: string) => 全.行.find((r) => r.customerId === c)!;
    expect(行of(有主客户)).toMatchObject({ 种: "项目", projectId: 公海线索项目, 属性: "线索池" });
    expect(行of(线索客户)).toMatchObject({ 进程: "线索-潜客培育", 进程明细: null });
    expect(行of(订单客户).进程).toBe("订单-签约");
    expect(行of(没项目).进程).toBeNull();
    expect(行of(多项目).进程).toBe("线索-潜客培育");
    expect(行of(多项目).进程明细).toContain("；");
    // 线索 / 商机池的格子不写阶段
    for (const c of [...线索们, ...商机们]) expect(行of(c).进程, c).not.toMatch(/^(线索|商机|订单) · /);
  });
});

describe("订单池的客户行：领取 / 分配（11-11 核实，不改判定）", () => {
  /** 导入的旧数据：客户挂占位账号进客户公海，名下订单阶段的项目没负责人进项目公海（enterprise-import/apply.ts 无主客户进公海、无主项目进公海） */
  async function 导入式订单客户(result: string | null = null) {
    const 占位 = await 无负责人占位Id(prisma);
    const c = await 客户(占位);
    await prisma.customerPool.create({ data: { customerId: c, userId: 占位, reason: 无主入池理由 } });
    const p = await 项目("", c, { phase: "订单", node: "生产备货", pooledAt: new Date(), creatorId: 老板.id, ...(result ? { result, closedAt: new Date() } : {}) });
    return { c, p };
  }
  it("领取：客户归我，名下在项目公海的订单项目（没结束的、已结束的）一起归我、出公海；持有上限不数订单阶段", async () => {
    const { c, p } = await 导入式订单客户();
    const 结束的 = await 项目("", c, { phase: "订单", node: "尾款结算", result: "交付结清", closedAt: new Date(), pooledAt: new Date(), creatorId: 老板.id });
    当(丙);
    expect((await 读公海页(丙, { 属性: "订单池" }, 1, 20)).行.map((r) => r.customerId)).toEqual([c]);
    const r = await 领取([c]);
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(c)).toBe(丙.id);
    for (const id of [p, 结束的]) expect(await prisma.project.findUniqueOrThrow({ where: { id }, select: { ownerId: true, pooledAt: true } })).toEqual({ ownerId: 丙.id, pooledAt: null });
  });
  it("分配给…：同样整包给那位", async () => {
    const { c, p } = await 导入式订单客户();
    当(老板);
    expect(await 分配公海([c], 丙.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 负责人(c)).toBe(丙.id);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p }, select: { ownerId: true, pooledAt: true } })).toEqual({ ownerId: 丙.id, pooledAt: null });
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
    expect(页.属性数.线索池).toBe(数);
  });
});
