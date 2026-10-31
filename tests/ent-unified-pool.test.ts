/**
 * 企业版统一公海（2026-10-29，P7）：lib/enterprise/unified-pool.ts（规矩）+ unified-pool-db.ts（取数）+ app/(app)/pool/actions.ts。
 *   - 公海属性（M-公海-08）：先给客户定状态——有没结束的项目取阶段最高的，都结束了取结局所在阶段最高的；
 *     线索（含线索流失）→ 线索池，商机（含丢单）→ 商机池，其余（订单、没项目）→ 其他；全部 = 线索 + 商机 + 其他
 *   - 当前进程（U-公海-04）：节点 · 状态；其他类前面带阶段
 *   - 入池方式（筛选）：超时回收 / 首次～多次退回 / 无效 / 离职交接，一行只落一个；入池原因（列，M-公海-09）= 退回原因，没选「—」
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
  客户定状态, 进程格, 拆退回原因, 要选退回原因提示, 快捷们, 有数才出的快捷, type 公海行,
} from "@/lib/enterprise/unified-pool";

// ---------- 纯规矩 ----------
describe("公海属性（按阶段定状态）", () => {
  const 未 = (phase: string) => ({ phase, result: null });
  const 结 = (phase: string, result: string) => ({ phase, result });
  // [说明, 名下项目, 应属, 定状态用的是第几个]
  const 表: [string, { phase: string; result: string | null }[], string, number | null][] = [
    ["没有项目", [], "其他", null],
    ["一个线索、没结束", [未("线索")], "线索池", 0],
    ["一个商机、没结束", [未("商机")], "商机池", 0],
    ["一个订单、没结束", [未("订单")], "其他", 0],
    ["线索流失", [结("线索", "线索流失")], "线索池", 0],
    ["丢单", [结("商机", "丢单")], "商机池", 0],
    ["订单结束（交付）", [结("订单", "成功交付")], "其他", 0],
    ["异常状态按订单结局算", [结("商机", "异常状态")], "其他", 0],
    ["多项目：没结束的取最高，订单 > 商机 > 线索", [未("线索"), 未("订单"), 未("商机")], "其他", 1],
    ["多项目：商机 > 线索", [未("线索"), 未("商机")], "商机池", 1],
    ["多项目：两个线索，同阶段取前面那个", [未("线索"), 未("线索")], "线索池", 0],
    ["没结束的优先于结束的：线索进行中 + 订单交付 → 线索", [结("订单", "成功交付"), 未("线索")], "线索池", 1],
    ["没结束的优先于结束的：商机进行中 + 线索流失 → 商机", [结("线索", "线索流失"), 未("商机")], "商机池", 1],
    ["全部结束取最高结局：线索流失 + 丢单 → 商机", [结("线索", "线索流失"), 结("商机", "丢单")], "商机池", 1],
    ["全部结束取最高结局：丢单 + 交付 → 订单（其他）", [结("商机", "丢单"), 结("订单", "成功交付")], "其他", 1],
    ["全部结束：两个线索流失 → 线索", [结("线索", "线索流失"), 结("线索", "线索流失")], "线索池", 0],
  ];
  for (const [说明, 项目们, 应属, 第几] of 表) {
    it(说明, () => {
      const r = 客户定状态(项目们);
      expect(r.属性).toBe(应属);
      expect(客户公海属性(项目们)).toBe(应属);
      expect(r.项目).toBe(第几 === null ? null : 项目们[第几]);
    });
  }
  it("项目行按它自己算，同一条规矩", () => {
    expect(项目公海属性(未("线索"))).toBe("线索池");
    expect(项目公海属性(未("商机"))).toBe("商机池");
    expect(项目公海属性(未("订单"))).toBe("其他");
    expect(项目公海属性(结("线索", "线索流失"))).toBe("线索池");
    expect(项目公海属性(结("商机", "丢单"))).toBe("商机池");
    expect(项目公海属性(结("订单", "成功交付"))).toBe("其他");
  });
  it("筛选顺序 线索池 / 商机池 / 其他；老链接的 attr（公海线索 / 公海商机 / 公海客户、线索 / 商机）认回来，认不出的当全部", () => {
    expect(公海属性们).toEqual(["线索池", "商机池", "其他"]);
    expect(规整公海属性("其他")).toBe("其他");
    expect(规整公海属性("公海客户")).toBe("其他");
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
  it("入池方式：一到三次各一档，多次从常量起；无效优先；离职交接单独一档、只在有数时出", () => {
    expect(归到快捷({ 类: "主动退回", 累计: 0 })).toBe("首次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 1 })).toBe("首次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 2 })).toBe("二次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 3 })).toBe("三次退回");
    expect(归到快捷({ 类: "主动退回", 累计: 多次退回起 })).toBe("多次退回");
    expect(多次退回起).toBe(4);
    expect(归到快捷({ 类: "主动退回", 累计: 9 })).toBe("多次退回");
    expect(归到快捷({ 类: "无效", 累计: 2 })).toBe("无效客户");
    expect(归到快捷({ 类: "超时回收", 累计: 2 })).toBe("超时回收");
    expect(归到快捷({ 类: "离职交接", 累计: 0 })).toBe("离职交接");
    expect(快捷们).toEqual(["超时回收", "首次退回", "二次退回", "三次退回", "多次退回", "无效客户", "离职交接"]);
    expect(有数才出的快捷).toEqual(["离职交接"]);
  });
  it("当前进程：节点 · 状态；线索池 / 商机池不写阶段，其他带阶段", () => {
    expect(进程格("线索池", { 阶段: "线索", 节点: "潜客培育", 结局: null })).toBe("潜客培育 · 进行中");
    expect(进程格("线索池", { 阶段: "线索", 节点: "线索验证", 结局: "线索流失" })).toBe("线索验证 · 线索流失");
    expect(进程格("商机池", { 阶段: "商机", 节点: "需求确认", 结局: "商机丢单" })).toBe("需求确认 · 商机丢单");
    expect(进程格("其他", { 阶段: "订单", 节点: "签约", 结局: null })).toBe("订单 · 签约 · 进行中");
    expect(进程格("其他", { 阶段: "订单", 节点: "交付", 结局: "交付结清" })).toBe("订单 · 交付 · 交付结清");
  });
  it("排序只认三个值，别的回默认", () => {
    expect(规整排序("follow")).toBe("follow");
    expect(规整排序("x")).toBe("pooled");
  });
});

describe("筛排", () => {
  const 行 = (id: string, 补: Partial<公海行>): 公海行 => ({
    id, 种: "客户", customerId: id, projectId: null, 客户名: id, 项目名: null, 进程: null, 进程明细: null, 属性: "其他",
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
    expect(r.属性数).toEqual({ 全部: 3, 线索池: 2, 商机池: 1, 其他: 0 });
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
    expect(r.属性数).toEqual({ 全部: 5, 线索池: 2, 商机池: 1, 其他: 2 });
    expect(r.属性数.全部).toBe(r.属性数.线索池 + r.属性数.商机池 + r.属性数.其他);
    // 带关键词也一样相加
    const 搜 = 筛排(带其他, { keyword: "丁" }).属性数;
    expect(搜).toEqual({ 全部: 1, 线索池: 0, 商机池: 0, 其他: 1 });
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
    expect(await 放进公海([c], "客户主动终止")).toMatchObject({ ok: true, updated: 1 });
    expect(await 退回数(c)).toBe(1);
    expect(await 撤销公海("放进", [{ id: c, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    expect(await 退回数(c)).toBe(0);
    // 再撤一次没东西可撤，也不会扣成负数
    await 撤销公海("放进", [{ id: c, 值: "" }]);
    expect(await 退回数(c)).toBe(0);
  });

  it("放回项目公海 +1，入池原因列写退回原因（没选「—」），入池方式进首次 / 二次退回", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(乙.id, c);
    expect(await 放回公海(乙, p, "线索质量不达标")).toEqual({ ok: true });
    expect(await 退回数(c)).toBe(1);
    当(丙);
    const 页 = await 读公海页(丙, {}, 1, 20);
    // 单项目客户：客户跟着进客户公海，只列一行客户行（领客户即领项目）
    expect(页.行).toHaveLength(1);
    expect(页.行[0]).toMatchObject({ 种: "客户", customerId: c, 属性: "线索池", 入池原因: "线索质量不达标", 快捷: "首次退回" });
    expect(页.快捷数.首次退回).toBe(1);
    // 丙领了、又放回：第二次
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
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
    expect(await 放进公海([c])).toMatchObject({ ok: false, error: expect.stringContaining("只有负责人或管理员") });
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
    // 无效是入池方式（红标），入池原因列照旧写退回原因
    expect(页.行.map((r) => [r.customerId, r.类, r.入池原因])).toEqual([[c, "无效", "客户主动终止"]]);

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
    expect(项目行).toMatchObject({ projectId: p, 属性: "商机池", 入池原因: "—", 进程: "需求确认 · 进行中", 进程明细: null });
    expect(页.属性数.商机池).toBeGreaterThanOrEqual(1);
  });
});

describe("按阶段分池在库里走一遍", () => {
  it("线索流失进线索池、丢单进商机池；订单（进行中 / 交付 / 异常）、没项目进其他；多项目按定状态；全部 = 线索 + 商机 + 其他", async () => {
    const 放 = async (c: string) => prisma.customerPool.create({ data: { customerId: c, reason: "手动" } });
    const 线索们: string[] = [];
    const 商机们: string[] = [];
    const 其他们: string[] = [];
    const 线索客户 = await 客户(乙.id); await 项目(乙.id, 线索客户, { phase: "线索", node: "潜客培育" }); 线索们.push(线索客户);
    const 商机客户 = await 客户(乙.id); await 项目(乙.id, 商机客户, { phase: "商机", node: "需求确认" }); 商机们.push(商机客户);
    const 订单客户 = await 客户(乙.id); await 项目(乙.id, 订单客户, { phase: "订单", node: "签约" }); 其他们.push(订单客户);
    const 流失客户 = await 客户(乙.id); await 项目(乙.id, 流失客户, { phase: "线索", node: "线索验证", result: "线索流失", closedAt: new Date() }); 线索们.push(流失客户);
    const 丢单客户 = await 客户(乙.id); await 项目(乙.id, 丢单客户, { phase: "商机", node: "需求确认", result: "丢单", closedAt: new Date() }); 商机们.push(丢单客户);
    for (const [phase, result] of [["订单", "成功交付"], ["商机", "异常状态"]] as const) {
      const c = await 客户(乙.id); await 项目(乙.id, c, { phase, result, closedAt: new Date() }); 其他们.push(c);
    }
    const 没项目 = await 客户(乙.id); 其他们.push(没项目);
    // 多项目：线索进行中 + 订单已交付 → 没结束的优先 → 线索池；格子里写定状态那个，悬停有每个项目
    const 多项目 = await 客户(乙.id);
    await 项目(乙.id, 多项目, { phase: "订单", node: "签约", result: "成功交付", closedAt: new Date() });
    await 项目(乙.id, 多项目, { phase: "线索", node: "潜客培育" });
    线索们.push(多项目);
    for (const c of [...线索们, ...商机们, ...其他们]) await 放(c);
    当(丙);
    const 全 = await 读公海页(丙, {}, 1, 50);
    expect(全.属性数).toEqual({ 全部: 9, 线索池: 3, 商机池: 2, 其他: 4 });
    expect(全.属性数.全部).toBe(全.属性数.线索池 + 全.属性数.商机池 + 全.属性数.其他);
    const ids = async (属性: string) => (await 读公海页(丙, { 属性 }, 1, 50)).行.map((r) => r.customerId).sort();
    expect(await ids("线索池")).toEqual([...线索们].sort());
    expect(await ids("商机池")).toEqual([...商机们].sort());
    expect(await ids("其他")).toEqual([...其他们].sort());
    const 行of = (c: string) => 全.行.find((r) => r.customerId === c)!;
    expect(行of(线索客户)).toMatchObject({ 进程: "潜客培育 · 进行中", 进程明细: null });
    expect(行of(订单客户).进程).toBe("订单 · 签约 · 进行中");
    expect(行of(没项目).进程).toBeNull();
    expect(行of(多项目).进程).toBe("潜客培育 · 进行中");
    expect(行of(多项目).进程明细).toContain("；");
    // 线索 / 商机池的格子不写阶段
    for (const c of [...线索们, ...商机们]) expect(行of(c).进程, c).not.toMatch(/^(线索|商机|订单) · /);
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
