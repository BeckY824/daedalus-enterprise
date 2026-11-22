/**
 * 数据页按「导入批次」（Project.importBatch）挑出 / 排掉一批项目（11-19）。
 *
 *   全部（不带 batch）= 原来的数，一个不差
 *   只看某批：新建、线索池（公海）、漏斗、线索瀑布、阶段只数这一批
 *   排掉某批：importBatch 为空的项目照旧留着（SQL 不写成 importBatch <> ? 一句）
 *   补建批次：选「只看」时新建数还是 0（补建的不算新建，system-created.ts 那条不变）
 *   卡片点进列表（项目列表 / 新线索 / 公海页）带同一个 batch=，条数和卡上的数对得上
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 项目现在, 项目一段, 导入批次们, 数据页批次 } from "../src/app/(app)/overview/project-stats";
import { 看板的人 } from "@/lib/project/board-member";
import { 读公海页筛, 按名单 } from "../src/app/(app)/pool/filters";
import { 读批次, 批次参数, 批次条件, 批次名, 批次下拉项, 带批次 } from "@/lib/project/import-batch";
import { 补建批次, 补建创建人, 历史分析来源 } from "@/lib/project/system-created";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 读项目列表 } from "@/lib/project/list";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";

const 增量 = "xbm-incr-20261119";
const 公海批 = "xbm-incr-20261119-pool";

describe("批次参数（纯函数）", () => {
  it("batch=x 只看、batch=-x 排掉；认不出的当全部", () => {
    expect(读批次(公海批)).toEqual({ 批: 公海批, 排: false });
    expect(读批次(`-${公海批}`)).toEqual({ 批: 公海批, 排: true });
    for (const v of [undefined, "", "-", "--x", "a b", "x'; drop", "批次", "x".repeat(81), ["x"]]) expect(读批次(v), String(v)).toBeNull();
    expect(批次参数(读批次(`-${增量}`))).toBe(`-${增量}`);
    expect(批次参数(null)).toBe("");
  });
  it("排掉写成「空 或 不是这一批」；只看就是等于", () => {
    expect(批次条件(null)).toBeUndefined();
    expect(批次条件({ 批: 增量, 排: false })).toEqual({ importBatch: 增量 });
    expect(批次条件({ 批: 增量, 排: true })).toEqual({ AND: [{ OR: [{ importBatch: null }, { importBatch: { not: 增量 } }] }] });
  });
  it("显示名表里有的用叫法，没有的显示原值；下拉 = 全部 + 每批只看 / 排掉；链接带上 batch", () => {
    expect(批次名(公海批)).toBe("销帮帮增量 11-19 · 公海客户项目");
    expect(批次名(补建批次)).toBe("补建潜客培育 11-17");
    expect(批次名("other-20260101")).toBe("other-20260101");
    expect(批次下拉项([增量])).toEqual([
      { value: "", label: "全部批次" },
      { value: 增量, label: "只看 销帮帮增量 11-19" },
      { value: `-${增量}`, label: "排掉 销帮帮增量 11-19" },
    ]);
    expect(带批次("/leads", undefined)).toBe("/leads");
    expect(带批次("/pool?open=1", `-${增量}`)).toBe(`/pool?open=1&batch=-${增量}`);
  });
});

/** 上个月（已过完） */
const 上月 = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to, 日: (n: number) => new Date(d.getFullYear(), d.getMonth(), n, 10) };
};

type 人 = { id: string; name: string; role: string };
let 老板: 人, 销售: 人, 主管: 人;
let 公海客户: string, 普通客户: string;

const 设 = (谁: 人) => { mocks.user = { ...mocks.user, id: 谁.id, name: 谁.name, role: 谁.role }; };
const 列表总数 = async (谁: 人, sp: Record<string, string>, 阶段?: "线索") => { 设(谁); return (await 以谁的身份(谁.id, () => 读项目列表(谁, sp, 阶段))).总数; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  const 建人 = async (email: string, name: string, role: string, bizRole: string, managerId?: string): Promise<人> => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, managerId } });
    return { id, name, role };
  };
  老板 = await 建人("boss", "老板", "ADMIN", "director");
  主管 = await 建人("m1", "主管", "SALES", "sales_mgr");
  销售 = await 建人("s1", "销售甲", "SALES", "sales", 主管.id);
  invalidateSettingsCache();
  忘掉企业版范围();
  普通客户 = (await prisma.customer.create({ data: { name: "云帆科技", phone: "13900000001", salesOwnerId: 销售.id } })).id;
  公海客户 = (await prisma.customer.create({ data: { name: "公海客户", phone: "13900000002", salesOwnerId: 销售.id } })).id;
  await prisma.customerPool.create({ data: { customerId: 公海客户, userId: 销售.id, reason: "手动" } });

  const m = 上月();
  const 项 = (o: Record<string, unknown>) =>
    prisma.project.create({ data: { name: "p", customerId: 普通客户, ownerId: 销售.id, creatorId: 销售.id, phase: "线索", node: "潜客培育", currency: "CNY", createdAt: m.日(5), ...o } });
  // 没批次的（系统里建的）：3 个在跟、1 个在公海
  await 项({ name: "自建线索" });
  await 项({ name: "自建商机", phase: "商机", node: "共识方案", amount: 1000 });
  await 项({ name: "自建流失", result: "线索流失", closedAt: m.日(9) });
  await 项({ name: "自建公海", ownerId: "", pooledAt: new Date() });
  // 增量批次（有负责人的潜客培育）：2 个
  await 项({ name: "增量一", importBatch: 增量 });
  await 项({ name: "增量二", importBatch: 增量, createdAt: m.日(20) });
  // 公海客户项目批次：13 个，全在公海、没负责人、在公海客户名下
  for (let i = 0; i < 13; i++) await 项({ name: `公海批${i}`, customerId: 公海客户, ownerId: "", pooledAt: new Date(), importBatch: 公海批, createdAt: m.日(1 + (i % 28)) });
  // 补建批次：改过创建人的（creatorId 是真人，只剩批次认得出）、没改的
  await 项({ name: "补建改过", importBatch: 补建批次 });
  await 项({ name: "补建没改", creatorId: 补建创建人, importBatch: 补建批次 });
  // 历史分析回填的：带自己的批次号，哪个数都不算，下拉也不列
  await 项({ name: "历史", source: 历史分析来源, importBatch: "history-20261118", ownerId: "", pooledAt: new Date() });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(() => prisma.$disconnect());

const 漏斗头 = (g: { 漏斗: { count: number }[] }) => g.漏斗[0].count;
const 退回公海 = (g: { 线索节点: { 退回公海: number }[] }) => g.线索节点.reduce((s, n) => s + n.退回公海, 0);

describe("现在：线索池、漏斗、线索瀑布", () => {
  it("全部 = 不带批次时的数，一个不差", async () => {
    const 原 = await 项目现在("CNY");
    expect(await 项目现在("CNY", undefined, null)).toEqual(原);
    // 公海 = 自建公海 + 13 个公海批（历史分析的不算）
    expect(原.公海).toBe(14);
    expect(漏斗头(原)).toBe(1 + 1 + 1 + 1 + 2 + 13 + 2);
  });

  it("只看公海客户项目那批：线索池 13，漏斗、瀑布只数这 13 个，在跟的阶段都是 0", async () => {
    const 数 = await 项目现在("CNY", undefined, { 批: 公海批, 排: false });
    expect(数.公海).toBe(13);
    expect(漏斗头(数)).toBe(13);
    expect(退回公海(数)).toBe(13);
    expect(数.阶段.map((s) => s.count)).toEqual([0, 0, 0]);
    expect(数.按人).toEqual([]);
  });

  it("排掉公海批：没批次的公海项目还在（null 不被误排），别的批次照算", async () => {
    const 数 = await 项目现在("CNY", undefined, { 批: 公海批, 排: true });
    expect(数.公海).toBe(1);
    expect(漏斗头(数)).toBe(4 + 2 + 2);
    // 在跟的线索：自建线索 + 增量两个 + 补建两个
    expect(数.阶段.find((s) => s.phase === "线索")?.count).toBe(5);
  });

  it("按人看时照旧按人数，批次再收窄", async () => {
    const 数 = await 项目现在("CNY", 销售.id, { 批: 增量, 排: false });
    expect(数.阶段.find((s) => s.phase === "线索")?.count).toBe(2);
    expect(数.公海).toBe(0);
  });
});

describe("一段：新建数", () => {
  it("全部 = 原来的数：补建的、历史分析的不算新建", async () => {
    const m = 上月();
    const 原 = await 项目一段(m.from, m.to, "day", "CNY");
    expect(await 项目一段(m.from, m.to, "day", "CNY", undefined, null)).toEqual(原);
    expect(原.合计.新建).toBe(4 + 2 + 13);
  });

  it("只看公海批：新建 13，漏斗、线索瀑布同一批；走势各天加起来也是 13", async () => {
    const m = 上月();
    const 数 = await 项目一段(m.from, m.to, "day", "CNY", undefined, { 批: 公海批, 排: false });
    expect(数.合计.新建).toBe(13);
    expect(漏斗头(数)).toBe(13);
    expect(退回公海(数)).toBe(13);
    expect(数.trend.reduce((s, b) => s + b.新建, 0)).toBe(13);
  });

  it("排掉增量批：没批次的照算（null 不被误排）、公海批照算；线索流失照数", async () => {
    const m = 上月();
    const 数 = await 项目一段(m.from, m.to, "day", "CNY", undefined, { 批: 增量, 排: true });
    expect(数.合计.新建).toBe(4 + 13);
    expect(数.合计.线索流失).toBe(1);
    const 只看增量 = await 项目一段(m.from, m.to, "day", "CNY", undefined, { 批: 增量, 排: false });
    expect(只看增量.合计.新建).toBe(2);
    expect(只看增量.合计.线索流失).toBe(0);
  });

  it("补建批次照旧不进新建：只看补建批次 = 0，排掉它 = 全部", async () => {
    const m = 上月();
    expect((await 项目一段(m.from, m.to, "day", "CNY", undefined, { 批: 补建批次, 排: false })).合计.新建).toBe(0);
    expect((await 项目一段(m.from, m.to, "day", "CNY", undefined, { 批: 补建批次, 排: true })).合计.新建).toBe(19);
  });

  it("转商机按项目的批次挑", async () => {
    const m = 上月();
    const 增量一 = await prisma.project.findFirstOrThrow({ where: { name: "增量一" } });
    const 自建 = await prisma.project.findFirstOrThrow({ where: { name: "自建商机" } });
    for (const p of [增量一, 自建]) {
      await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 销售.id, fromPhase: "线索", fromNode: "线索推进", toPhase: "商机", toNode: "痛点挖掘", at: m.日(12) } });
    }
    expect((await 项目一段(m.from, m.to, "day", "CNY")).合计.转商机).toBe(2);
    expect((await 项目一段(m.from, m.to, "day", "CNY", undefined, { 批: 增量, 排: false })).合计.转商机).toBe(1);
    expect((await 项目一段(m.from, m.to, "day", "CNY", undefined, { 批: 增量, 排: true })).合计.转商机).toBe(1);
  });
});

describe("下拉候选", () => {
  it("只列有项目的批次，新的在前；历史分析的不列", async () => {
    expect(await 导入批次们()).toEqual([公海批, 增量, 补建批次]);
  });
});

describe("卡片点进列表，条数对得上", () => {
  it("新线索 / 项目列表 / 公海页按同一个 batch= 筛", async () => {
    设(老板);
    const 数 = await 以谁的身份(老板.id, () => 项目现在("CNY", undefined, { 批: 增量, 排: false }));
    const 线索 = 数.阶段.find((s) => s.phase === "线索")!.count;
    expect(线索).toBe(2);
    expect(await 列表总数(老板, { batch: 增量 }, "线索")).toBe(线索);
    // 排掉：没批次的照列
    expect(await 列表总数(老板, { batch: `-${增量}` }, "线索")).toBe((await 列表总数(老板, {}, "线索")) - 2);
    // 回显给页头标签；认不出的不回显、不筛
    const d = await 以谁的身份(老板.id, () => 读项目列表(老板, { batch: `-${增量}` }));
    expect(d.filters.batch).toBe(`-${增量}`);
    const 乱 = await 以谁的身份(老板.id, () => 读项目列表(老板, { batch: "x y" }));
    expect(乱.filters.batch).toBe("");
    expect(乱.总数).toBe(await 列表总数(老板, {}));

    // 「公海里还有 N 个」点进公海页（/pool?open=1&batch=…）：按项目一条一行，条数 = 线索池数
    const 池 = await 以谁的身份(老板.id, () => 项目现在("CNY", undefined, { 批: 公海批, 排: false }));
    const 公海页 = await 以谁的身份(老板.id, () => 读公海页(老板, {}, 1, 100, { batch: 公海批, open: "1" }));
    expect(公海页.总数).toBe(池.公海);
    const 排掉 = await 以谁的身份(老板.id, () => 读公海页(老板, {}, 1, 100, { batch: `-${公海批}`, open: "1" }));
    expect(排掉.行.map((r) => r.项目名)).toEqual(["自建公海"]);
  });
});

describe("公海页从数据页点进来（open=1&batch=…）", () => {
  it("open、onlyNew 随筛选回显（翻页、换池按它重拼地址）；翻到第 2 页总数不变，已结束的不混进来", async () => {
    // 公海批里多一个已结束的：不带 open 会列出来，数据页的线索池数不算它
    await prisma.project.create({ data: { name: "公海批流失", customerId: 公海客户, ownerId: "", creatorId: 销售.id, phase: "线索", node: "潜客培育", result: "线索流失", pooledAt: new Date(), importBatch: 公海批 } });
    const 筛 = 读公海页筛({ open: "1", onlyNew: "1", batch: 公海批, page: "2" });
    expect(筛).toMatchObject({ open: "1", onlyNew: "1", batch: 公海批 });
    expect(按名单(筛)).toBe(true);
    expect(读公海页筛({ open: "x", batch: "a b" })).toMatchObject({ open: "", onlyNew: "", batch: "" });

    设(老板);
    const 池 = await 以谁的身份(老板.id, () => 项目现在("CNY", undefined, { 批: 公海批, 排: false }));
    expect(池.公海).toBe(13);
    const 名单 = { batch: 筛.batch, open: 筛.open, onlyNew: 筛.onlyNew };
    const 一 = await 以谁的身份(老板.id, () => 读公海页(老板, {}, 1, 10, 名单));
    const 二 = await 以谁的身份(老板.id, () => 读公海页(老板, {}, 2, 10, 名单));
    expect([一.总数, 二.总数]).toEqual([13, 13]);
    expect(一.行.length + 二.行.length).toBe(13);
    expect([...一.行, ...二.行].some((r) => r.项目名 === "公海批流失")).toBe(false);
    // 丢了 open 就是 14（审查 #368 复现的样子）
    expect((await 以谁的身份(老板.id, () => 读公海页(老板, {}, 2, 10, { batch: 公海批 }))).总数).toBe(14);
  });
});

describe("公海页从数据页点进来（没选批次，只带 open=1）", () => {
  it("按项目一条一行，条数 = 数据页「公海里还有 N 个」：不算历史分析回填的、已结束的（3703 实操：原来去 /pool 列的是全部公海客户）", async () => {
    await prisma.project.create({ data: { name: "自建公海流失", customerId: 普通客户, ownerId: "", creatorId: 销售.id, phase: "线索", node: "潜客培育", result: "线索流失", pooledAt: new Date() } });
    const 筛 = 读公海页筛({ open: "1" });
    expect(筛.open).toBe("1");
    expect(按名单(筛)).toBe(true);
    设(老板);
    const 数 = await 以谁的身份(老板.id, () => 项目现在("CNY"));
    expect(数.公海).toBe(14);
    const 页 = await 以谁的身份(老板.id, () => 读公海页(老板, {}, 1, 100, { open: 筛.open }));
    expect(页.总数).toBe(数.公海);
    const 名 = 页.行.map((r) => r.项目名);
    expect(名).toContain("自建公海");
    expect(名).not.toContain("历史");
    expect(名).not.toContain("自建公海流失");
  });
});

describe("谁能按批次看", () => {
  it("总管理：摆下拉、认 batch=；库里没有的批次当全部", async () => {
    const 人 = await 看板的人(老板);
    expect(人.全看).toBe(true);
    const d = await 数据页批次(人.全看, `-${公海批}`);
    expect(d.批).toEqual({ 批: 公海批, 排: true });
    expect(d.下拉?.当前).toBe(`-${公海批}`);
    expect(d.下拉?.选项[0]).toEqual({ value: "", label: "全部批次" });
    expect(await 数据页批次(人.全看, "no-such-batch")).toMatchObject({ 批: null, 下拉: { 当前: "" } });
  });

  it("主管、业务员带 batch= 打开数据页：不出下拉，数和不带时一样", async () => {
    const m = 上月();
    for (const 谁 of [主管, 销售]) {
      设(谁);
      const 人 = await 以谁的身份(谁.id, () => 看板的人(谁));
      expect(人.全看, 谁.name).toBeFalsy();
      const 范围 = 人.只看 ?? 人.谁;
      for (const b of [增量, `-${增量}`, 公海批]) {
        const d = await 以谁的身份(谁.id, () => 数据页批次(人.全看, b));
        expect(d, `${谁.name} ${b}`).toEqual({ 批: null });
        expect(await 以谁的身份(谁.id, () => 项目现在("CNY", 范围, d.批))).toEqual(await 以谁的身份(谁.id, () => 项目现在("CNY", 范围)));
        expect(await 以谁的身份(谁.id, () => 项目一段(m.from, m.to, "day", "CNY", 范围, d.批))).toEqual(await 以谁的身份(谁.id, () => 项目一段(m.from, m.to, "day", "CNY", 范围)));
      }
    }
  });
});
