/**
 * 企业版项目模式首页四张指标卡（10-29 首页改版 #10 / 待 2，lib/project/home-cards.ts + home-cards-db.ts + list.ts 的 f）：
 *   - 本月新增：这个月（北京时间）新建的项目，不管在不在推
 *   - 重点项目：在推、客户级别 S / A
 *   - 暂未跟进：在推、一条沟通都没挂到项目上
 *   - 即将逾期：在推的线索 / 商机，回收日在 3 天以内；超时回收没开恒为 0
 *   - 本月赢单：这个月有一次「商机 → 订单」节点变更的项目（10-29 会议二2，绿卡）
 *   - 今日待办：我名下今天到期的计划和待办（任务 + 跟进计划），点了去复盘页 /overview?f=today（绿卡）；
 *     逾期的不进大数字，另给 逾期待办（卡下面「另有 M 条逾期」→ /overview?f=overdue）；两个数都 = 落点列表的条数
 *   - 首页摆哪四张只看 首页摆的卡；数首页卡 只数摆着的
 *   - 卡上的数 = 点进 /projects?f=… 列出来的行数；按组织架构看客户开着时业务员只数自己看得到的
 *   - f 乱传当没筛；不是企业版不认 f
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 认首页卡, 本月起止, 即将逾期, 即将逾期粗筛, 首页卡条件, 首页卡键们, 首页卡口径, 首页摆的卡, 首页卡色, 首页卡链接, 逾期待办链接, type 首页卡键 } from "@/lib/project/home-cards";
import { 数首页卡 } from "@/lib/project/home-cards-db";
import { 复盘待办of } from "@/lib/project/board-todos-db";
import { 读项目列表 } from "@/lib/project/list";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 存组织规则 } from "@/lib/project/org-rules-store";
import { 字典of } from "@/lib/project/stage-dict";
import { dayjs } from "@/lib/utils";
import { setSetting } from "@/lib/settings";
import { 以谁的身份 } from "@/lib/enterprise/visibility";

const 开超时 = { ...默认组织规则, 超时回收: { 开: true, 节点天数: {} } };
/** 老的四张（红卡那一版），老用例照旧数这四张 */
const 老四张: 首页卡键[] = ["month-new", "key", "no-follow", "due-soon"];

describe("口径（纯函数）", () => {
  it("卡的键、名字固定，乱传 f 当没筛", () => {
    expect([...首页卡键们]).toEqual(["month-new", "key", "no-follow", "due-soon", "month-won", "today-todo"]);
    expect(首页卡键们.map((k) => 首页卡口径[k].名)).toEqual(["本月新增", "重点项目", "暂未跟进", "即将逾期", "本月赢单", "今日待办"]);
    expect(认首页卡("key")).toBe("key");
    expect(认首页卡("due-soon")).toBe("due-soon");
    expect(认首页卡("month-won")).toBe("month-won");
    // 今日待办不是项目筛选：/projects?f=today-todo 当没筛
    expect(认首页卡("today-todo")).toBe("");
    expect(认首页卡("all")).toBe("");
    expect(认首页卡(["key"])).toBe("");
    expect(认首页卡(undefined)).toBe("");
  });

  it("首页摆的卡：保留本月新增、重点项目，两张绿卡换掉两张红卡；今日待办去复盘页待办页签的「今天到期」", () => {
    expect([...首页摆的卡]).toEqual(["month-new", "key", "today-todo", "month-won"]);
    expect(首页摆的卡.map((k) => 首页卡色[k])).toEqual([undefined, undefined, "good", "good"]);
    expect(首页卡色["no-follow"]).toBe("warn");
    expect(首页卡链接("today-todo")).toBe("/overview?f=today");
    expect(首页卡链接("today-todo", "u1")).toBe("/overview?ownerId=u1&f=today");
    expect(逾期待办链接()).toBe("/overview?f=overdue");
    expect(逾期待办链接("u1")).toBe("/overview?ownerId=u1&f=overdue");
    expect(首页卡链接("month-won")).toBe("/projects?f=month-won");
  });

  it("本月赢单：本月有一条商机 → 订单的节点留痕", () => {
    const 今 = new Date("2026-10-15T04:00:00Z");
    expect(首页卡条件("month-won", 默认组织规则, 字典of(true), 今)).toEqual({
      logs: { some: { kind: "node", fromPhase: "商机", toPhase: "订单", at: { gte: new Date("2026-09-30T16:00:00.000Z"), lt: new Date("2026-10-31T16:00:00.000Z") } } },
    });
  });

  it("本月按北京时间的自然月算：UTC 10-31 17:00 已经是北京 11 月", () => {
    const { 起, 止 } = 本月起止(new Date("2026-10-31T17:00:00Z"));
    expect(起.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(止.toISOString()).toBe("2026-11-30T16:00:00.000Z");
    const 十月 = 本月起止(new Date("2026-10-15T04:00:00Z"));
    expect(十月.起.toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });

  it("即将逾期：回收日离今天 3 天以内（含今天、含已过），没有回收日不算", () => {
    const 今 = new Date("2026-10-29T02:00:00Z"); // 北京 10-29 10:00
    expect(即将逾期(null, 今)).toBe(false);
    expect(即将逾期("2026-10-29", 今)).toBe(true);
    expect(即将逾期("2026-11-01", 今)).toBe(true);
    expect(即将逾期("2026-11-02", 今)).toBe(false);
    expect(即将逾期("2026-10-20", 今)).toBe(true);
  });

  it("超时回收没开：没有粗筛，条件查不出东西", () => {
    const 字典 = 字典of(true);
    expect(即将逾期粗筛(默认组织规则, 字典)).toBeNull();
    expect(首页卡条件("due-soon", 默认组织规则, 字典)).toEqual({ id: { in: [] } });
    // 开了：只看在推的线索 / 商机、客户不在公海
    expect(即将逾期粗筛(开超时, 字典)).toMatchObject({ result: null, pooledAt: null, phase: { in: ["线索", "商机"] }, customer: { pool: { is: null } } });
  });

  it("重点 / 暂未跟进只看在推的；本月新增不管在不在推", () => {
    const 字典 = 字典of(true);
    expect(首页卡条件("key", 默认组织规则, 字典)).toMatchObject({ result: null, pooledAt: null, customer: { extra: { is: { level: { in: ["S", "A"] } } } } });
    expect(首页卡条件("no-follow", 默认组织规则, 字典)).toMatchObject({ result: null, pooledAt: null, followUps: { none: {} } });
    const 新 = 首页卡条件("month-new", 默认组织规则, 字典);
    expect(新).not.toHaveProperty("result");
    expect(新).not.toHaveProperty("pooledAt");
  });
});

describe("取数和项目页筛选", () => {
  let 老板 = "";
  let 业务员 = "";
  const 项: Record<string, string> = {};

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
    业务员 = (await prisma.user.create({ data: { email: "sales", name: "业务员", title: "", role: "SALES", password: "x" } })).id;
    mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
    const 重点客户 = await prisma.customer.create({ data: { name: "客户甲", phone: "13900000001", salesOwnerId: 老板, extra: { create: { level: "A" } } } });
    const 普通客户 = await prisma.customer.create({ data: { name: "客户乙", phone: "13900000002", salesOwnerId: 老板, extra: { create: { level: "C" } } } });
    const 业务员客户 = await prisma.customer.create({ data: { name: "客户丙", phone: "13900000003", salesOwnerId: 业务员, extra: { create: { level: "S" } } } });
    const 建 = async (名: string, customerId: string, ownerId: string, data: Record<string, unknown> = {}) => {
      项[名] = (await prisma.project.create({ data: { name: 名, customerId, ownerId, creatorId: ownerId, ...data } })).id;
    };
    const 上月 = dayjs().startOf("month").subtract(3, "day").toDate();
    await 建("重点新", 重点客户.id, 老板); // 本月新增、重点、暂未跟进
    await 建("重点跟过", 重点客户.id, 老板, { createdAt: 上月 }); // 重点（挂了沟通，不算暂未跟进；上月建的不算本月）
    await 建("普通成交", 普通客户.id, 老板, { result: "成功交付" }); // 本月新增（已有结局也算），不在推
    await 建("普通公海", 普通客户.id, 老板, { pooledAt: new Date() }); // 本月新增，不在推
    await 建("业务员的", 业务员客户.id, 业务员); // 本月新增、重点、暂未跟进——业务员自己的
    const 沟通 = await prisma.followUp.create({ data: { type: "PHONE", title: "电话", content: "聊了", customerId: 重点客户.id, ownerId: 老板 } });
    await prisma.followUpProject.create({ data: { followUpId: 沟通.id, projectId: 项["重点跟过"], node: "潜客培育" } });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => prisma.$disconnect());

  const 列 = async (f: string) => (await 读项目列表({ id: mocks.user.id, name: mocks.user.name, role: mocks.user.role }, { f })).行.map((r) => r.name).sort();

  it("老板看全员：卡上的数和点进去的行对得上", async () => {
    const 数 = await 数首页卡(老板, new Date(), 老四张);
    expect(数).toEqual({ "month-new": 4, key: 3, "no-follow": 2, "due-soon": 0 });
    expect(await 列("month-new")).toEqual(["业务员的", "普通公海", "普通成交", "重点新"]);
    expect(await 列("key")).toEqual(["业务员的", "重点新", "重点跟过"]);
    expect(await 列("no-follow")).toEqual(["业务员的", "重点新"]);
    // 超时回收没开：即将逾期恒为 0，点进去是空列表
    expect(await 列("due-soon")).toEqual([]);
    // 乱传当没筛
    expect((await 列("whatever")).length).toBe(5);
  });

  it("按组织架构看客户开着：业务员只数自己看得到的，老板照旧看全员", async () => {
    await setSetting("enterprise.rule.org_scope", true);
    await prisma.entMember.create({ data: { userId: 业务员 } });
    mocks.user = { ...mocks.user, id: 业务员, name: "业务员", role: "SALES" };
    const 数 = await 以谁的身份(业务员, () => 数首页卡(业务员, new Date(), 老四张));
    // 本月新增里多一个「普通公海」：项目公海里的项目人人看得到
    expect(数).toEqual({ "month-new": 2, key: 1, "no-follow": 1, "due-soon": 0 });
    expect(await 以谁的身份(业务员, () => 列("month-new"))).toEqual(["业务员的", "普通公海"]);
    expect(await 以谁的身份(业务员, () => 列("key"))).toEqual(["业务员的"]);
    expect((await 以谁的身份(老板, () => 数首页卡(老板)))["key"]).toBe(3);
  });

  it("开了超时回收：回收日 3 天以内的才算即将逾期", async () => {
    await 存组织规则(开超时);
    // 默认 7 天：5 天前建的还剩 2 天；下一步明天的 = 后天回收；今天建的还剩 7 天
    await prisma.project.update({ where: { id: 项["重点新"] }, data: { createdAt: dayjs().subtract(5, "day").toDate() } });
    await prisma.project.update({ where: { id: 项["业务员的"] }, data: { nextStepAt: dayjs().add(1, "day").toDate() } });
    // 「重点跟过」上月建的会被先收走，挪到今天，留一个回收日还远的
    await prisma.project.update({ where: { id: 项["重点跟过"] }, data: { createdAt: new Date() } });
    const 数 = await 数首页卡(老板, new Date(), 老四张);
    expect(数["due-soon"]).toBe(2);
    expect(await 列("due-soon")).toEqual(["业务员的", "重点新"]);
  });

  it("默认只数首页摆的四张：本月赢单 = 本月商机 → 订单的项目，点进去行对得上", async () => {
    const 本月 = dayjs().startOf("month").add(1, "hour").toDate();
    const 上月 = dayjs().startOf("month").subtract(3, "day").toDate();
    const 留痕 = (projectId: string, userId: string, from: string, to: string, at: Date) =>
      prisma.projectNodeLog.create({ data: { projectId, userId, kind: "node", fromPhase: from, fromNode: from, toPhase: to, toNode: to, at } });
    await 留痕(项["重点新"], 老板, "商机", "订单", 本月);
    await 留痕(项["重点新"], 老板, "商机", "订单", new Date()); // 来回改：同一个项目只算一个
    await 留痕(项["重点跟过"], 老板, "商机", "订单", 上月); // 上月的不算
    await 留痕(项["普通成交"], 老板, "线索", "商机", 本月); // 只进了商机，不算
    await 留痕(项["业务员的"], 业务员, "商机", "订单", 本月);
    const 数 = await 数首页卡(老板);
    expect(Object.keys(数).sort()).toEqual(["key", "month-new", "month-won", "today-todo", "逾期待办"]); // 摆了今日待办就带上逾期另起的那一行
    expect(数["month-won"]).toBe(2);
    expect(await 列("month-won")).toEqual(["业务员的", "重点新"]);
    // 按组织架构看客户开着：业务员只数自己的
    await setSetting("enterprise.rule.org_scope", true);
    await prisma.entMember.create({ data: { userId: 业务员 } });
    expect((await 以谁的身份(业务员, () => 数首页卡(业务员)))["month-won"]).toBe(1);
  });

  it("今日待办：大数字只算我名下今天到期的计划和待办，逾期的另给；明天的、做完的、别人的都不算；两个数 = 落点列表的条数", async () => {
    const 客户 = await prisma.customer.findFirstOrThrow({ where: { name: "客户甲" } });
    const 今天 = dayjs().startOf("day");
    const 计划 = (ownerId: string, plannedAt: Date, done = false) => prisma.followPlan.create({ data: { subject: "回访", plannedAt, done, customerId: 客户.id, ownerId } });
    const 待办 = (ownerId: string, dueAt: Date | null) => prisma.task.create({ data: { title: "发资料", dueAt, customerId: 客户.id, ownerId } });
    await 计划(老板, 今天.subtract(2, "day").add(10, "hour").toDate()); // 逾期
    await 计划(老板, 今天.add(23, "hour").toDate()); // 今天
    await 待办(老板, 今天.subtract(1, "day").toDate()); // 逾期
    await 计划(老板, 今天.add(1, "day").add(10, "hour").toDate()); // 明天，不算
    await 计划(老板, 今天.subtract(1, "day").toDate(), true); // 做完了，不算
    await 待办(老板, null); // 没排时间，不算
    await 计划(业务员, 今天.subtract(1, "day").toDate()); // 别人的
    await 待办(老板, 今天.add(9, "hour").toDate()); // 今天（任务也算）
    const 老板的 = await 数首页卡(老板);
    expect(老板的["today-todo"]).toBe(2);
    expect(老板的.逾期待办).toBe(2);
    const 业务员的 = await 数首页卡(业务员);
    expect(业务员的["today-todo"]).toBe(0);
    expect(业务员的.逾期待办).toBe(1);

    // 落点：/overview?ownerId=我&f=today（复盘页按 ownerId 只看这个人、类型「全部」）列出来的正好是这几条
    for (const [我, 卡数] of [[老板, 老板的], [业务员, 业务员的]] as const) {
      const 今天到期 = await 复盘待办of(我, { 卡: "today" });
      expect(今天到期.总数).toBe(卡数["today-todo"]);
      expect(今天到期.行.length).toBe(卡数["today-todo"]);
      expect(今天到期.计数.today).toBe(卡数["today-todo"]);
      const 逾期 = await 复盘待办of(我, { 卡: "overdue" });
      expect(逾期.总数).toBe(卡数.逾期待办);
      expect(逾期.行.length).toBe(卡数.逾期待办);
    }
    // 任务、跟进计划两种都算进去（和待办页「全部」类型一致）
    const 行 = (await 复盘待办of(老板, { 卡: "today" })).行;
    expect(行.map((x) => x.kind).sort()).toEqual(["plan", "task"]);

    // 没摆今日待办就不数，也没有 逾期待办
    expect((await 数首页卡(老板, new Date(), 老四张)).逾期待办).toBeUndefined();
  });

  it("不是企业版：不认 f", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const r = await 读项目列表({ id: 老板, name: "老板", role: "ADMIN" }, { f: "key" });
    expect(r.filters.f).toBe("");
    expect(r.行.length).toBe(5);
  });
});
