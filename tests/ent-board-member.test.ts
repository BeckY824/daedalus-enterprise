/**
 * 企业版复盘页（P15）：按成员看 + 线索瀑布 + 「待办」页签（10-29 改成两个页签：待办 | 数据）。
 *   - 看板范围of（纯函数）：老板 / 主管 / 管理员类别 / 手下有人 = 管理层；老板、总管理员全看，别的上级 = 自己 + 直接 / 间接 + 虚线下属；
 *     业务员只有自己。只按组织架构定，不看「按组织看客户」开没开（10-29 定稿）
 *   - 看板的人：业务员强制只看自己（地址栏带了别人也不认）；管理层默认看全部、选范围外的当没选；能选的只有一个人时不给下拉
 *   - 项目现在 / 项目一段 带只看：只数那个人负责的（公海的不算）；线索节点按潜客培育 → 线索验证 → 线索推进铺开
 *   - 挑一页：逾期在前、按时间从早到晚、没时间的最后；四张卡的条数跟着人和类型走；卡筛、类型筛；每页 20 条、页码超了落末页
 *   - 复盘待办of：业务员只看到自己的；按组织看开着时经理看不到范围外的；管理层选了谁只看到谁的；点一行去项目页 / 客户页、带项目名
 *   - 读页签 / 复盘地址 / 计划页链接：地址栏怎么读、怎么写（首页「今日待办」落到待办页签的今天到期）
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 建组织 } from "@/lib/enterprise/org-core";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { setSetting } from "@/lib/settings";
import { 清首页缓存 } from "@/lib/home-cache";
import { dayjs } from "@/lib/utils";
import { 看板范围of, 看板的人 } from "@/lib/project/board-member";
import { 挑一页, 计划页链接, 状态of, 复盘待办每页, 读页签, 读卡, 读类型, 读页码, 复盘地址 } from "@/lib/project/board-todos";
import { 复盘待办of } from "@/lib/project/board-todos-db";
import { 项目现在, 项目一段, 线索节点of } from "../src/app/(app)/overview/project-stats";

const 老板 = "b_boss";
const 主管 = "b_mgr_role";
const 经理 = "b_mgr";
const 小王 = "b_wang"; // 经理的实线下属
const 小张 = "b_zhang"; // 经理的虚线下属
const 外人 = "b_out";

describe("看板范围of（纯函数）", () => {
  const org = () =>
    建组织(
      [老板, 主管, 经理, 小王, 小张, 外人].map((id) => ({ id, role: id === 老板 ? "ADMIN" : id === 主管 ? "MANAGER" : "SALES", active: true })),
      [
        { userId: 小王, deptId: null, bizRole: "sales", line: null, managerId: 经理, dottedManagerId: null },
        { userId: 小张, deptId: null, bizRole: "sales", line: null, managerId: null, dottedManagerId: 经理 },
      ],
      [],
    );
  const 排 = (r: { 管理层: boolean; 全看: boolean; 可选: string[] }) => ({ ...r, 可选: [...r.可选].sort() });
  const 全部 = [老板, 主管, 经理, 小王, 小张, 外人].sort();

  it("业务员：不是管理层，只有自己", () => {
    expect(看板范围of(org(), "SALES", 外人)).toEqual({ 管理层: false, 全看: false, 可选: [外人] });
    expect(看板范围of(org(), "SALES", 小王)).toEqual({ 管理层: false, 全看: false, 可选: [小王] });
  });
  it("老板：全看，能选全部人；主管账号不是总管理员，算别的上级——手下没人就只有自己", () => {
    expect(排(看板范围of(org(), "ADMIN", 老板))).toEqual({ 管理层: true, 全看: true, 可选: 全部 });
    expect(看板范围of(org(), "MANAGER", 主管)).toEqual({ 管理层: true, 全看: false, 可选: [主管] });
  });
  it("手下有人的经理：自己 + 实线 + 虚线下属，看不到外人", () => {
    expect(排(看板范围of(org(), "SALES", 经理))).toEqual({ 管理层: true, 全看: false, 可选: [经理, 小王, 小张].sort() });
  });
  it("间接下属也算：经理的下属再带人，经理的范围一路往下", () => {
    const 链 = 建组织(
      [经理, 小王, 外人].map((id) => ({ id, role: "SALES", active: true })),
      [
        { userId: 小王, deptId: null, bizRole: "sales", line: null, managerId: 经理, dottedManagerId: null },
        { userId: 外人, deptId: null, bizRole: "sales", line: null, managerId: 小王, dottedManagerId: null },
      ],
      [],
    );
    expect(排(看板范围of(链, "SALES", 经理))).toEqual({ 管理层: true, 全看: false, 可选: [经理, 小王, 外人].sort() });
    expect(排(看板范围of(链, "SALES", 小王))).toEqual({ 管理层: true, 全看: false, 可选: [小王, 外人].sort() });
  });
});

describe("线索节点of（纯函数）", () => {
  it("停着的只数进行中、不在公海的线索，按节点先后铺开，没有的摆 0", () => {
    const r = 线索节点of([
      { phase: "线索", node: "潜客培育", result: null },
      { phase: "线索", node: "潜客培育", result: null },
      { phase: "线索", node: "线索推进", result: null },
      { phase: "线索", node: "潜客培育", result: "丢单" },
      { phase: "商机", node: "共识方案", result: null },
    ]);
    expect(r.map((x) => x.node)).toEqual(["潜客培育", "线索验证", "线索推进"]);
    expect(r.map((x) => x.count)).toEqual([2, 0, 1]);
    expect(r.every((x) => x.流失 + x.判无效 + x.退回公海 === 0)).toBe(true);
  });
  it("每个节点流出去的：线索流失、判无效（拆出来，不重算进流失）、退回公海（还没结局）各数各的", () => {
    const r = 线索节点of([
      { phase: "线索", node: "潜客培育", result: "线索流失" },
      { phase: "线索", node: "潜客培育", result: null, pooledAt: new Date() },
      { phase: "线索", node: "线索验证", result: "线索流失", 判无效: true },
      { phase: "线索", node: "线索验证", result: "线索流失", pooledAt: new Date() }, // 流失后又进了公海：算流失，不重算退回
      { phase: "线索", node: "线索推进", result: null },
    ]);
    expect(r.map((x) => [x.count, x.流失, x.判无效, x.退回公海])).toEqual([[0, 1, 0, 1], [0, 1, 1, 0], [1, 0, 0, 0]]);
  });
  it("线索转商机of：进了商机 / 订单的，有结局也算（丢单、成功交付），线索流失的不算", async () => {
    const { 线索转商机of } = await import("../src/app/(app)/overview/project-stats");
    expect(线索转商机of([
      { phase: "线索", node: "潜客培育", result: null },
      { phase: "商机", node: "共识方案", result: null },
      { phase: "商机", node: "共识方案", result: "丢单" },
      { phase: "订单", node: "生产备货", result: "成功交付" },
      { phase: "线索", node: "潜客培育", result: "线索流失" },
    ])).toBe(3);
  });
});

describe("挑一页（纯函数）", () => {
  // 周三中午，本周还剩几天
  const now = dayjs("2026-10-28T12:00:00");
  const 项 = (key: string, 时间: string | null, ownerId = "a") => ({ key, 时间, ownerId });
  const 七条 = [
    项("task:没时间", null),
    项("plan:以后", "2026-11-20T10:00:00"),
    项("task:本周晚", "2026-10-31T10:00:00"),
    项("plan:本周早", "2026-10-29T10:00:00"),
    项("task:今天", "2026-10-28T18:00:00"),
    项("plan:逾期近", "2026-10-27T09:00:00"),
    项("task:逾期远", "2026-10-20T09:00:00"),
  ];

  it("逾期在前，再今天、本周、以后，同组按时间从早到晚，没时间的最后；四张卡各数各的", () => {
    const r = 挑一页(七条, { now });
    expect(r.要.map((x) => x.key)).toEqual(["task:逾期远", "plan:逾期近", "task:今天", "plan:本周早", "task:本周晚", "plan:以后", "task:没时间"]);
    expect(r.计数).toEqual({ overdue: 2, today: 1, week: 2, all: 7 });
    expect(r.总数).toBe(7);
    expect(r.页).toBe(1);
    expect(r.要.map((x) => 状态of(x.组))).toEqual(["逾期", "逾期", "今天", "之后", "之后", "之后", "之后"]);
  });

  it("点哪张卡就只列哪张的；卡上的数不跟着卡变", () => {
    const 逾 = 挑一页(七条, { now, 卡: "overdue" });
    expect(逾.要.map((x) => x.key)).toEqual(["task:逾期远", "plan:逾期近"]);
    expect(逾.总数).toBe(2);
    expect(逾.计数).toEqual({ overdue: 2, today: 1, week: 2, all: 7 });
    expect(挑一页(七条, { now, 卡: "today" }).要.map((x) => x.key)).toEqual(["task:今天"]);
    expect(挑一页(七条, { now, 卡: "week" }).要.map((x) => x.key)).toEqual(["plan:本周早", "task:本周晚"]);
  });

  it("类型：任务只留 Task、跟进计划只留 FollowPlan，四张卡的数也只数这一类", () => {
    const 任 = 挑一页(七条, { now, 类型: "task" });
    expect(任.要.map((x) => x.key)).toEqual(["task:逾期远", "task:今天", "task:本周晚", "task:没时间"]);
    expect(任.计数).toEqual({ overdue: 1, today: 1, week: 1, all: 4 });
    const 计 = 挑一页(七条, { now, 类型: "plan", 卡: "overdue" });
    expect(计.要.map((x) => x.key)).toEqual(["plan:逾期近"]);
    expect(计.计数).toEqual({ overdue: 1, today: 0, week: 1, all: 3 });
  });

  it("只看：只留这个人的，条数也只数他的", () => {
    const r = 挑一页([项("task:a1", null, "a"), 项("plan:b1", "2026-10-20T09:00:00", "b"), 项("plan:a2", "2026-10-20T09:00:00", "a")], { 只看: "a", now });
    expect(r.要.map((x) => x.key)).toEqual(["plan:a2", "task:a1"]);
    expect(r.计数).toEqual({ overdue: 1, today: 0, week: 0, all: 2 });
  });

  it("分页：每页 20 条，第 2 页接着第 1 页；页码超出落到最后一页；一条没有时是第 1 页", () => {
    const 全部 = [
      ...Array.from({ length: 30 }, (_, i) => 项(`plan:逾${String(i).padStart(2, "0")}`, dayjs("2026-10-01T09:00:00").add(i, "hour").toISOString())),
      ...Array.from({ length: 5 }, (_, i) => 项(`task:今${i}`, dayjs("2026-10-28T13:00:00").add(i, "minute").toISOString())),
    ];
    expect(复盘待办每页).toBe(20);
    const 一 = 挑一页(全部, { now });
    expect(一.要).toHaveLength(20);
    expect(一.要.every((x) => x.组 === "逾期")).toBe(true);
    const 二 = 挑一页(全部, { now, 页: 2 });
    expect(二.页).toBe(2);
    expect(二.要.map((x) => x.key)).toEqual([...Array.from({ length: 10 }, (_, i) => `plan:逾${i + 20}`), ...Array.from({ length: 5 }, (_, i) => `task:今${i}`)]);
    expect(挑一页(全部, { now, 页: 9 }).页).toBe(2);
    expect(挑一页(全部, { now, 卡: "today", 页: 3 })).toMatchObject({ 页: 1, 总数: 5 });
    expect(挑一页([], { now, 页: 4 })).toMatchObject({ 页: 1, 总数: 0, 要: [] });
  });
});

describe("地址栏：读页签 / 读卡 / 读类型 / 读页码 / 复盘地址 / 计划页链接", () => {
  it("没写 tab 默认待办；只带 view（首页信号、/reports 跳过来）落数据；tab 明写的照写的", () => {
    expect(读页签()).toBe("todo");
    expect(读页签("data")).toBe("data");
    expect(读页签(undefined, "本月")).toBe("data");
    expect(读页签("todo", "本月")).toBe("todo");
    expect(读页签("乱写")).toBe("todo");
    // U-复盘-01：卡点、沟通两个页签
    expect(读页签("block")).toBe("block");
    expect(读页签("talk", "本月")).toBe("talk");
  });

  it("卡、类型、页码：认不得的回默认", () => {
    expect([读卡("today"), 读卡("x"), 读卡()]).toEqual(["today", "all", "all"]);
    expect([读类型("plan"), 读类型("x"), 读类型()]).toEqual(["plan", "all", "all"]);
    expect([读页码("3"), 读页码("0"), 读页码("-2"), 读页码("1.5"), 读页码("abc"), 读页码()]).toEqual([3, 1, 1, 1, 1, 1]);
  });

  it("复盘地址：默认值不写；数据页签不带待办的筛选；待办页签带了 view 要明写 tab=todo", () => {
    expect(复盘地址({})).toBe("/overview");
    expect(复盘地址({ f: "today" })).toBe("/overview?f=today");
    expect(复盘地址({ f: "today", ownerId: "u1" })).toBe("/overview?ownerId=u1&f=today");
    expect(复盘地址({ f: "all", kind: "all", p: 1 })).toBe("/overview");
    expect(复盘地址({ f: "week", kind: "task", p: 3 })).toBe("/overview?f=week&kind=task&p=3");
    expect(复盘地址({ tab: "data", view: "本月", f: "today", p: 2 })).toBe(`/overview?tab=data&view=${encodeURIComponent("本月")}`);
    expect(复盘地址({ tab: "todo", view: "本月" })).toBe(`/overview?tab=todo&view=${encodeURIComponent("本月")}`);
    expect(读页签("todo", "本月")).toBe("todo");
  });

  it("复盘地址（U-复盘-01）：卡点 / 沟通页签只带自己的筛选，默认值（未解决、全部时间）不写，页码照带", () => {
    expect(复盘地址({ tab: "block" })).toBe("/overview?tab=block");
    expect(复盘地址({ tab: "block", bs: "open", f: "today", t: "7" })).toBe("/overview?tab=block");
    expect(复盘地址({ tab: "block", bs: "done", ownerId: "u1", p: 2 })).toBe("/overview?tab=block&ownerId=u1&bs=done&p=2");
    expect(复盘地址({ tab: "talk", t: "all", bs: "done" })).toBe("/overview?tab=talk");
    expect(复盘地址({ tab: "talk", t: "30", p: 3 })).toBe("/overview?tab=talk&t=30&p=3");
    expect(复盘地址({ tab: "talk", view: "本月" })).toBe(`/overview?tab=talk&view=${encodeURIComponent("本月")}`);
  });

  it("去计划页：看自己不带参数，看全员 / 选了别人带 scope=all", () => {
    expect(计划页链接("自己")).toBe("/follow-ups/plans");
    expect(计划页链接("全员")).toBe("/follow-ups/plans?scope=all");
  });
});

describe("库里取数和权限", () => {
  const 客户: Record<string, string> = {};
  const 用户 = [
    { id: 老板, name: "老板", role: "ADMIN" },
    { id: 经理, name: "经理", role: "SALES" },
    { id: 小王, name: "小王", role: "SALES" },
    { id: 外人, name: "外人", role: "SALES" },
  ];

  beforeEach(async () => {
    await resetDb();
    清首页缓存();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    for (const u of 用户) await prisma.user.create({ data: { ...u, email: `${u.id}@t`, password: "x", title: "" } });
    let i = 0;
    for (const u of 用户) {
      客户[u.id] = (await prisma.customer.create({ data: { name: `${u.name}的客户`, phone: `1390000000${i++}`, salesOwnerId: u.id } })).id;
      // 一条逾期计划 + 一条没时间的待办
      await prisma.followPlan.create({ data: { subject: `${u.name}回访`, plannedAt: dayjs().subtract(2, "day").toDate(), customerId: 客户[u.id], ownerId: u.id } });
      await prisma.task.create({ data: { title: `${u.name}发资料`, dueAt: null, customerId: 客户[u.id], ownerId: u.id } });
    }
    // 做完的不算
    await prisma.followPlan.create({ data: { subject: "做完了", plannedAt: new Date(), done: true, customerId: 客户[老板], ownerId: 老板 } });
    await prisma.entMember.create({ data: { userId: 经理 } });
    await prisma.entMember.create({ data: { userId: 小王, managerId: 经理 } });
    await prisma.entMember.create({ data: { userId: 外人 } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });
  afterAll(() => prisma.$disconnect());

  const 内容 = (d: { 行: { 内容: string }[] }) => d.行.map((x) => x.内容).sort();

  it("看板的人：业务员强制只看自己，带了别人也不认；不是企业版不给选", async () => {
    expect(await 看板的人({ id: 外人, role: "SALES" }, 老板)).toEqual({ 只看: 外人, 谁: [外人], 选项: null });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 看板的人({ id: 老板, role: "ADMIN" }, 外人)).toEqual({ 选项: null });
  });

  it("看板的人：老板默认看全部，能选所有人（自己排第一）；选的人不在范围里当没选", async () => {
    const r = await 看板的人({ id: 老板, role: "ADMIN" });
    expect(r.只看).toBeUndefined();
    expect(r.谁).toBeUndefined(); // 全部 = 不限
    expect(r.选项?.map((o) => o.value)[0]).toBe(老板);
    expect(r.选项?.map((o) => o.value).sort()).toEqual([老板, 经理, 小王, 外人].sort());
    expect((await 看板的人({ id: 老板, role: "ADMIN" }, 小王)).只看).toBe(小王);
    expect((await 看板的人({ id: 老板, role: "ADMIN" }, "nobody")).只看).toBeUndefined();
  });

  it("看板的人：经理只能选自己和下属，「全部」= 这一圈，选外人当没选；开没开按组织看都一样", async () => {
    for (const 开 of [true, false]) {
      await setSetting("enterprise.rule.org_scope", 开);
      忘掉企业版范围();
      const r = await 看板的人({ id: 经理, role: "SALES" }, 外人);
      expect(r.只看).toBeUndefined();
      expect([...(r.谁 ?? [])].sort()).toEqual([经理, 小王].sort());
      expect(r.选项?.map((o) => o.value)).toEqual([经理, 小王]); // 自己排第一
      expect(await 看板的人({ id: 经理, role: "SALES" }, 小王)).toMatchObject({ 只看: 小王, 谁: [小王] });
    }
  });

  it("复盘待办of 服务端兜底：按组织看没开（数据层不拦人）时，经理的「全部」也只数自己 + 下属", async () => {
    const { 谁 } = await 看板的人({ id: 经理, role: "SALES" });
    const 经 = await 以谁的身份(经理, () => 复盘待办of(谁));
    expect(内容(经)).toEqual(["小王发资料", "小王回访", "经理发资料", "经理回访"].sort());
    expect(经.计数).toEqual({ overdue: 2, today: 0, week: 0, all: 4 });
  });

  it("复盘待办of：老板看全员、选了谁只看到谁的；做完的不算；逾期在前、没时间的最后", async () => {
    const 全 = await 复盘待办of();
    expect(全.计数).toEqual({ overdue: 4, today: 0, week: 0, all: 8 });
    expect(全.总数).toBe(8);
    expect(全.行.slice(0, 4).every((x) => x.组 === "逾期")).toBe(true);
    expect(全.行.slice(4).every((x) => x.时间 === null)).toBe(true);
    const 王 = await 复盘待办of(小王);
    expect(内容(王)).toEqual(["小王发资料", "小王回访"]);
    expect(王.计数.all).toBe(2);
    // 卡 + 类型 + 分页一起：逾期的跟进计划只有一条；每页 1 条时第 2 页是第二条
    expect(内容(await 复盘待办of(undefined, { 卡: "overdue", 类型: "plan" }))).toEqual(["外人回访", "小王回访", "经理回访", "老板回访"].sort());
    expect(内容(await 复盘待办of(小王, { 类型: "task" }))).toEqual(["小王发资料"]);
    const 第二 = await 复盘待办of(小王, { 每页: 1, 页: 2 });
    expect(第二).toMatchObject({ 页: 2, 总数: 2 });
    expect(内容(第二)).toEqual(["小王发资料"]);
    expect(王.行.every((x) => x.ownerId === 小王 && x.ownerName === "小王" && x.customerName === "小王的客户")).toBe(true);
  });

  it("复盘待办of 权限：按组织看开着时，业务员只看到自己的；经理看到自己 + 下属的，看不到外人的", async () => {
    await setSetting("enterprise.rule.org_scope", true);
    const 外 = await 以谁的身份(外人, async () => 复盘待办of((await 看板的人({ id: 外人, role: "SALES" }, 老板)).只看));
    expect(内容(外)).toEqual(["外人发资料", "外人回访"]);
    const 经 = await 以谁的身份(经理, () => 复盘待办of());
    expect(内容(经)).toEqual(["小王发资料", "小王回访", "经理发资料", "经理回访"].sort());
    // 地址栏硬塞外人：看板的人 不认，查库那层也兜着
    expect(内容(await 以谁的身份(经理, () => 复盘待办of(外人)))).toEqual([]);
  });

  it("点一行：客户有进行中的项目去最近动过的那个项目，没有去客户页；完成了的项目不算", async () => {
    const 旧 = await prisma.project.create({ data: { name: "旧", customerId: 客户[小王], ownerId: 小王, creatorId: 小王, updatedAt: dayjs().subtract(3, "day").toDate() } });
    const 新 = await prisma.project.create({ data: { name: "新", customerId: 客户[小王], ownerId: 小王, creatorId: 小王 } });
    await prisma.project.update({ where: { id: 旧.id }, data: { updatedAt: dayjs().subtract(3, "day").toDate() } });
    await prisma.project.create({ data: { name: "结了", customerId: 客户[外人], ownerId: 外人, creatorId: 外人, result: "成功交付" } });
    const 全 = await 复盘待办of();
    const 去of = (who: string) => [...new Set(全.行.filter((x) => x.ownerId === who).map((x) => x.去))];
    expect(去of(小王)).toEqual([`/projects/${新.id}`]);
    expect(去of(外人)).toEqual([`/customers/${客户[外人]}`]);
    expect([...new Set(全.行.filter((x) => x.ownerId === 小王).map((x) => x.projectName))]).toEqual(["新"]);
    expect(全.行.filter((x) => x.ownerId === 外人).every((x) => x.projectName === null)).toBe(true);
  });

  it("项目现在 / 项目一段 带只看：只数这个人负责的，公海的不算停着、算退回公海；线索节点跟着走", async () => {
    const 建 = (ownerId: string, phase: string, node: string, extra: Record<string, unknown> = {}) =>
      prisma.project.create({ data: { name: `${ownerId}-${node}`, customerId: 客户[ownerId], ownerId, creatorId: ownerId, phase, node, ...extra } });
    await 建(小王, "线索", "潜客培育");
    await 建(小王, "线索", "线索验证");
    await 建(小王, "商机", "共识方案");
    await 建(小王, "线索", "潜客培育", { pooledAt: new Date() });
    await 建(外人, "线索", "潜客培育");
    await 建(外人, "订单", "生产备货");

    const 判了 = await 建(外人, "线索", "线索验证", { result: "线索流失" });
    await prisma.entLeadVerify.create({ data: { projectId: 判了.id, finalResult: "无效线索" } });
    await 建(外人, "线索", "潜客培育", { result: "线索流失" });

    const 全 = await 项目现在("CNY");
    expect(全.线索节点.map((x) => [x.count, x.流失, x.判无效, x.退回公海])).toEqual([[2, 1, 0, 1], [1, 0, 1, 0], [0, 0, 0, 0]]);
    expect(全.线索转商机).toBe(2);
    const 王 = await 项目现在("CNY", 小王);
    expect(王.阶段.map((x) => [x.phase, x.count])).toEqual([["线索", 2], ["商机", 1], ["订单", 0]]);
    expect(王.线索节点.map((x) => [x.count, x.退回公海])).toEqual([[1, 1], [1, 0], [0, 0]]);
    expect(王.线索转商机).toBe(1);
    // 一串人（上级的「全部」）= 这几个人的合起来
    const 两人 = await 项目现在("CNY", [小王, 外人]);
    expect(两人.线索节点.map((x) => x.count)).toEqual(全.线索节点.map((x) => x.count));
    expect(两人.线索转商机).toBe(2);

    const from = dayjs().startOf("month").toDate();
    const to = dayjs().endOf("month").toDate();
    const 段王 = await 项目一段(from, to, "day", "CNY", 小王);
    const 段全 = await 项目一段(from, to, "day", "CNY");
    expect(段王.线索节点.map((x) => x.count)).toEqual([1, 1, 0]); // 公海那个不算停在小王这里
    expect(段王.线索节点.map((x) => x.退回公海)).toEqual([1, 0, 0]); // 算成从潜客培育退回公海
    expect(段王.线索转商机).toBe(1);
    expect(段全.线索节点.reduce((s, x) => s + x.count, 0)).toBeGreaterThan(段王.线索节点.reduce((s, x) => s + x.count, 0));
  });
});

describe("首页「+」摆哪几项（lib/enterprise/composer-plus.ts）", () => {
  it("桌面：附件、名片、查重、背调（粘一段聊天 10-29 拿掉了）；手机：没有文本附件，名片叫拍名片；不摆的键不进菜单", async () => {
    const { 加号菜单项 } = await import("@/lib/enterprise/composer-plus");
    expect(加号菜单项({ 摆附件: true, 拍照: false, 摆背调: true }).map((x) => x.label)).toEqual(["附件", "名片", "查重", "背调"]);
    expect(加号菜单项({ 摆附件: false, 拍照: true, 摆背调: false }).map((x) => x.label)).toEqual(["拍名片", "查重"]);
  });
});
