/**
 * 企业版复盘页 11-01 版式融合多出来的几块（口径在 review-extras.ts / board-todos.ts，取数在 review-extras-db.ts）：
 *   - 任务看板：挑看板 三列（逾期 / 今天 / 之后）口径同 挑一页，每列最多几条；逾天数；读布局；复盘地址 带 lay=list、m=
 *   - 回收提醒：回收条们 没开超时回收 = 不摆条；开了按节点一条，天数从组织规则读（没设按字典默认）；改过名的节点并到本套名
 *   - 卡点分布：排卡点分布 按主体多的在前、「没填」最后，状态按固定顺序；卡点分布of 的范围同卡点看板（角色开关那一圈，只数未解决的）
 *   - 复盘概况：算回款 只合本位币、丢单 / 线索流失不算待回款、外币只计数；复盘概况of 按 看板的人 那一圈数
 *   - 沟通：沟通条件 / 复盘沟通of 多一个「方式」筛；缺沟通of 同首页「暂未跟进」口径、按负责人圈
 *   - 将回公海of：3 天内要回公海的项目（同首页卡口径）、按负责人圈
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 清首页缓存 } from "@/lib/home-cache";
import { invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { 看板的人 } from "@/lib/project/board-member";
import { 挑看板, 逾天数, 读布局, 复盘地址, 看板列的卡 } from "@/lib/project/board-todos";
import { 沟通条件, 读沟通方式 } from "@/lib/project/review-tabs";
import { 复盘沟通of } from "@/lib/project/review-tabs-db";
import { 卡点看板 } from "@/lib/project/blocker";
import { 负责人条件, 回收条们, 按节点数, 排卡点分布, 算回款 } from "@/lib/project/review-extras";
import { 将回公海of, 缺沟通of, 卡点分布of, 复盘概况of } from "@/lib/project/review-extras-db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 存组织规则 } from "@/lib/project/org-rules-store";
import { 企业版字典 } from "@/lib/project/stage-dict";

const 开超时 = { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 线索验证: 15 } } };

describe("纯函数", () => {
  const now = dayjs("2026-10-28T12:00:00");
  const 项 = (key: string, 时间: string | null, ownerId = "a") => ({ key, 时间, ownerId });

  it("挑看板：三列 = 逾期 / 今天 / 之后（本周 + 以后 + 没定时间），数同四张卡；每列只取前几条；按人筛", () => {
    const 全部 = [
      项("task:没时间", null),
      项("plan:以后", "2026-11-20T10:00:00"),
      项("task:本周", "2026-10-31T10:00:00"),
      项("task:今天", "2026-10-28T18:00:00"),
      项("plan:逾1", "2026-10-27T09:00:00"),
      项("task:逾2", "2026-10-20T09:00:00"),
      项("plan:逾3", "2026-10-21T09:00:00", "b"),
    ];
    const r = 挑看板(全部, { now });
    expect(r.计数).toEqual({ overdue: 3, today: 1, week: 1, all: 7 });
    expect(r.列.overdue.总数).toBe(3);
    expect(r.列.overdue.要.map((x) => x.key)).toEqual(["task:逾2", "plan:逾3", "plan:逾1"]);
    expect(r.列.today.要.map((x) => x.key)).toEqual(["task:今天"]);
    expect(r.列.later.要.map((x) => x.key)).toEqual(["task:本周", "plan:以后", "task:没时间"]);
    const 二 = 挑看板(全部, { now, 每列: 2 });
    expect(二.列.overdue).toMatchObject({ 总数: 3 });
    expect(二.列.overdue.要).toHaveLength(2);
    const a = 挑看板(全部, { now, 只看: "a" });
    expect(a.计数).toEqual({ overdue: 2, today: 1, week: 1, all: 6 });
    expect(a.列.overdue.要.map((x) => x.key)).toEqual(["task:逾2", "plan:逾1"]);
    expect(看板列的卡).toEqual({ overdue: "overdue", today: "today", later: "all" });
  });

  it("逾天数：按日历天，今天到期 / 没时间 / 以后都是 0", () => {
    expect(逾天数("2026-10-20T23:00:00", now)).toBe(8);
    expect(逾天数("2026-10-28T08:00:00", now)).toBe(0);
    expect(逾天数("2026-11-01T08:00:00", now)).toBe(0);
    expect(逾天数(null, now)).toBe(0);
  });

  it("读布局 / 读沟通方式：认不得的回默认（看板 / 全部方式）", () => {
    expect([读布局("list"), 读布局("board"), 读布局("x"), 读布局()]).toEqual(["list", "board", "board", "board"]);
    expect([读沟通方式("PHONE"), 读沟通方式("WECHAT"), 读沟通方式("CALL"), 读沟通方式()]).toEqual(["PHONE", "WECHAT", "", ""]);
  });

  it("复盘地址：任务页签带 lay=list（看板是默认不写）、沟通页签带 m=；别的页签不带；ownerId 照带", () => {
    expect(复盘地址({ lay: "list" })).toBe("/overview?lay=list");
    expect(复盘地址({ lay: "board" })).toBe("/overview");
    expect(复盘地址({ f: "overdue", lay: "list", ownerId: "u1" })).toBe("/overview?ownerId=u1&f=overdue&lay=list");
    expect(复盘地址({ tab: "talk", t: "7", m: "VISIT", ownerId: "u1", lay: "list" })).toBe("/overview?tab=talk&ownerId=u1&t=7&m=VISIT");
    expect(复盘地址({ tab: "block", m: "VISIT", lay: "list" })).toBe("/overview?tab=block");
  });

  it("沟通条件：方式给了按 type 筛，不给不加；卡点条件那几样不动", () => {
    const now2 = dayjs("2026-10-31T15:00:00");
    expect(沟通条件(undefined, "all", now2, "VISIT")).toMatchObject({ type: "VISIT" });
    expect(沟通条件(["u1"], "all", now2)).not.toHaveProperty("type");
  });

  it("负责人条件：不限人 = undefined；一个人 = 等于；一圈人 = in", () => {
    expect(负责人条件(undefined)).toBeUndefined();
    expect(负责人条件("u1")).toEqual({ ownerId: "u1" });
    expect(负责人条件(["u1", "u2"])).toEqual({ ownerId: { in: ["u1", "u2"] } });
    expect(负责人条件([])).toEqual({ ownerId: { in: [] } });
  });

  it("回收条们：没开 = 不摆条、总数 0；开了线索 + 商机每个节点一条，天数按规则、没设按字典默认 7 天；改过名的节点并到本套名", () => {
    expect(回收条们(默认组织规则, 企业版字典, new Map([["潜客培育", 3]]))).toEqual({ 开: false, 条: [], 总数: 0 });
    const 数 = 按节点数([{ node: "潜客培育" }, { node: "潜客培育" }, { node: "线索验证" }], 企业版字典);
    const r = 回收条们(开超时, 企业版字典, 数);
    expect(r.开).toBe(true);
    expect(r.总数).toBe(3);
    expect(r.条.map((c) => c.节点)).toEqual([...企业版字典.节点们.线索, ...企业版字典.节点们.商机]);
    expect(r.条.find((c) => c.节点 === "潜客培育")).toEqual({ 阶段: "线索", 节点: "潜客培育", 天数: 7, 数: 2 });
    expect(r.条.find((c) => c.节点 === "线索验证")).toMatchObject({ 天数: 15, 数: 1 });
    expect(r.条.find((c) => c.节点 === "痛点挖掘")).toMatchObject({ 阶段: "商机", 数: 0 });
  });

  it("排卡点分布：主体多的在前、一样多按名字、空的叫「没填」放最后；状态按 待接受 / 处理中 / 看板 / 已解决，没有的不摆", () => {
    const r = 排卡点分布(
      [
        { obstacle: "客户", _count: { _all: 2 } },
        { obstacle: "", _count: { _all: 5 } },
        { obstacle: "内部", _count: { _all: 3 } },
        { obstacle: "  ", _count: { _all: 1 } },
      ],
      [
        { status: "处理中", _count: { _all: 4 } },
        { status: "待接受", _count: { _all: 7 } },
      ],
    );
    expect(r.按主体).toEqual([{ 主体: "内部", 数: 3 }, { 主体: "客户", 数: 2 }, { 主体: "没填", 数: 6 }]);
    expect(r.按状态).toEqual([{ 状态: "待接受", 数: 7 }, { 状态: "处理中", 数: 4 }]);
    expect(r.总数).toBe(11);
    expect(排卡点分布([], [])).toEqual({ 总数: 0, 按主体: [], 按状态: [] });
  });

  it("算回款：已回款只合本位币；待回款 = 本位币合同 − 已回、不到 0 记 0；丢单 / 线索流失不算待回款；外币只计项目数", () => {
    const r = 算回款(
      [
        { contractAmount: 100, contractCurrency: "CNY", result: null, entPayments: [{ currency: "CNY", amount: 30 }] },
        { contractAmount: 50, contractCurrency: null, currency: "CNY", result: null, entPayments: [{ currency: "CNY", amount: 80 }] },
        { contractAmount: 200, contractCurrency: "CNY", result: "丢单", entPayments: [] },
        { contractAmount: 40, contractCurrency: "CNY", result: "线索流失", entPayments: [{ currency: "CNY", amount: 10 }] },
        { contractAmount: 300, contractCurrency: "USD", result: null, entPayments: [{ currency: "USD", amount: 100 }] },
        { contractAmount: null, contractCurrency: null, result: null, entPayments: [{ currency: "EUR", amount: 5 }, { currency: "CNY", amount: 1 }] },
      ],
      "CNY",
    );
    expect(r).toEqual({ 已回款: 30 + 80 + 10 + 1, 待回款: 70, 外币项目: 2 });
    expect(算回款([], "CNY")).toEqual({ 已回款: 0, 待回款: 0, 外币项目: 0 });
  });
});

describe("库里取数和范围", () => {
  const 老板 = "rx_boss";
  const 经理 = "rx_mgr";
  const 小王 = "rx_wang"; // 经理的下属
  const 外人 = "rx_out";
  const 用户 = [
    { id: 老板, name: "老板", role: "ADMIN" },
    { id: 经理, name: "经理", role: "SALES" },
    { id: 小王, name: "小王", role: "SALES" },
    { id: 外人, name: "外人", role: "SALES" },
  ];
  const 项目: Record<string, string> = {};
  const 客户: Record<string, string> = {};
  let 序 = 0;

  async function 记沟通(谁: string, 项目id: string, type: string, 内容: string) {
    const f = await prisma.followUp.create({ data: { customerId: 客户[谁], ownerId: 谁, type, title: "", content: 内容, status: "已完成", occurredAt: new Date() } });
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: 项目id, node: "潜客培育" } });
  }
  async function 发卡点(谁: string, obstacle: string, status = "待接受") {
    const f = await prisma.followUp.create({ data: { customerId: 客户[谁], ownerId: 谁, type: "PHONE", title: "", content: "发卡点", status: "已完成" } });
    await prisma.entBlocker.create({
      data: {
        code: `KX${String(++序).padStart(4, "0")}`, projectId: 项目[谁], followUpId: f.id, customerId: 客户[谁], phase: "线索",
        type: "需求不清", impact: "一般", obstacle, description: `${谁}-${obstacle}`, dueDays: 3, dueAt: dayjs().add(3, "day").toDate(), creatorId: 谁, status,
      },
    });
  }

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    清首页缓存();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    for (const u of 用户) await prisma.user.create({ data: { ...u, email: `${u.id}@t`, password: "x", title: "" } });
    let i = 0;
    for (const u of 用户) {
      客户[u.id] = (await prisma.customer.create({ data: { name: `${u.name}的客户`, phone: `1390000000${i++}`, salesOwnerId: u.id } })).id;
      // 5 天前建的线索：默认 7 天回收 → 2 天后收回，算「3 天内回公海」
      项目[u.id] = (await prisma.project.create({
        data: { name: `${u.name}的项目`, customerId: 客户[u.id], ownerId: u.id, creatorId: u.id, createdAt: dayjs().subtract(5, "day").toDate() },
      })).id;
    }
    // 11-01 权限只认业务角色：每人都写明业务角色（老板 = 总管理看全部）
    await prisma.entMember.create({ data: { userId: 老板, bizRole: "director" } });
    await prisma.entMember.create({ data: { userId: 经理, bizRole: "sales_mgr" } });
    await prisma.entMember.create({ data: { userId: 小王, bizRole: "sales", managerId: 经理 } });
    await prisma.entMember.create({ data: { userId: 外人, bizRole: "sales" } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });
  afterAll(() => prisma.$disconnect());

  it("沟通按方式筛：只留这一类，范围照旧按项目负责人", async () => {
    await 记沟通(小王, 项目[小王], "PHONE", "小王打电话");
    await 记沟通(小王, 项目[小王], "VISIT", "小王上门");
    await 记沟通(外人, 项目[外人], "VISIT", "外人上门");
    const 经 = await 看板的人({ id: 经理, role: "SALES" });
    const 上门 = await 以谁的身份(经理, () => 复盘沟通of(经.谁, { 段: "all", 方式: "VISIT" }));
    expect(上门.行.map((x) => x.内容)).toEqual(["小王上门"]);
    expect((await 复盘沟通of(undefined, { 段: "all", 方式: "VISIT" })).总数).toBe(2);
    expect((await 复盘沟通of(undefined, { 段: "all" })).总数).toBe(3);
  });

  it("缺沟通：在推、一条沟通都没挂的项目，按负责人圈；记过沟通的、有结局的、在公海的不算", async () => {
    await 记沟通(经理, 项目[经理], "PHONE", "经理聊了");
    await prisma.project.create({ data: { name: "小王丢了的", customerId: 客户[小王], ownerId: 小王, creatorId: 小王, result: "线索流失" } });
    await prisma.project.create({ data: { name: "小王进公海的", customerId: 客户[小王], ownerId: 小王, creatorId: 小王, pooledAt: new Date() } });
    const 经 = await 看板的人({ id: 经理, role: "SALES" });
    const r = await 以谁的身份(经理, () => 缺沟通of(经.只看 ?? 经.谁));
    expect(r.总数).toBe(1);
    expect(r.行).toEqual([expect.objectContaining({ id: 项目[小王], 名: "小王的项目", 客户: "小王的客户", 负责人: "小王", 节点: "潜客培育" })]);
    const 全 = await 缺沟通of(undefined);
    expect(全.总数).toBe(3);
    expect(全.行.map((x) => x.名).sort()).toEqual(["外人的项目", "小王的项目", "老板的项目"].sort());
  });

  it("卡点分布：和卡点看板同一圈（角色开关），只数未解决的，按主体 / 状态数；不是企业版给空", async () => {
    await 发卡点(小王, "客户");
    await 发卡点(小王, "内部", "处理中");
    await 发卡点(小王, "", "处理中");
    await 发卡点(经理, "客户", "处理中");
    await 发卡点(外人, "客户");
    await 发卡点(小王, "客户", "已解决");
    const 经 = { id: 经理, role: "SALES" };
    const 分 = await 以谁的身份(经理, () => 卡点分布of(经));
    const 板 = await 以谁的身份(经理, () => 卡点看板(经));
    expect(分.总数).toBe(板.统计.未解决);
    expect(分.总数).toBe(4);
    expect(分.按主体).toEqual([{ 主体: "客户", 数: 2 }, { 主体: "内部", 数: 1 }, { 主体: "没填", 数: 1 }]);
    expect(分.按状态).toEqual([{ 状态: "待接受", 数: 1 }, { 状态: "处理中", 数: 3 }]);
    const 全 = await 卡点分布of({ id: 老板, role: "SALES" });
    expect(全.总数).toBe(5);
    expect(全.按主体.at(-1)).toEqual({ 主体: "没填", 数: 1 });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 卡点分布of({ id: 老板, role: "SALES" })).toEqual({ 总数: 0, 按主体: [], 按状态: [] });
  });

  it("将回公海：没开超时回收 = 不摆条、预警空；开了按负责人圈数 3 天内要收的、回收日早的在前", async () => {
    const 关 = await 将回公海of(undefined);
    expect(关).toEqual({ 提醒: { 开: false, 条: [], 总数: 0 }, 预警: [] });

    await 存组织规则(开超时);
    // 老板的项目今天才动过 → 7 天后收，不在 3 天内
    await prisma.project.update({ where: { id: 项目[老板] }, data: { createdAt: new Date() } });
    const 经 = await 看板的人({ id: 经理, role: "SALES" });
    const r = await 以谁的身份(经理, () => 将回公海of(经.只看 ?? 经.谁));
    expect(r.提醒.总数).toBe(2);
    expect(r.提醒.条.find((c) => c.节点 === "潜客培育")).toMatchObject({ 天数: 7, 数: 2 });
    expect(r.预警.map((x) => x.名).sort()).toEqual(["小王的项目", "经理的项目"].sort());
    expect(r.预警[0].回收日).toBe(dayjs().subtract(5, "day").add(7, "day").format("YYYY-MM-DD"));
    expect((await 将回公海of(undefined)).提醒.总数).toBe(3);
    expect((await 将回公海of(小王)).预警.map((x) => x.负责人)).toEqual(["小王"]);
  });

  it("复盘概况：在跟（不算公海、有结局的）、未解决卡点、回款按 看板的人 那一圈；超时回收没开 = null", async () => {
    await prisma.project.update({ where: { id: 项目[小王] }, data: { contractAmount: 1000, contractCurrency: "CNY" } });
    await prisma.entProjectPayment.create({ data: { projectId: 项目[小王], paidAt: new Date(), currency: "CNY", amount: 400 } });
    await prisma.entProjectPayment.create({ data: { projectId: 项目[外人], paidAt: new Date(), currency: "CNY", amount: 999 } });
    await prisma.project.create({ data: { name: "经理赢了的", customerId: 客户[经理], ownerId: 经理, creatorId: 经理, result: "交付结清" } });
    await 发卡点(小王, "客户");
    await 发卡点(外人, "客户");
    const 经 = await 看板的人({ id: 经理, role: "SALES" });
    const r = await 以谁的身份(经理, () => 复盘概况of(经.只看 ?? 经.谁, { id: 经理, role: "SALES" }, "CNY"));
    expect(r.概况).toMatchObject({ 在跟: 2, 未解决卡点: 1, 已回款: 400, 待回款: 600, 外币项目: 0, 将回公海: null });
    expect(r.预警).toEqual([]);
    expect(r.分布.按主体).toEqual([{ 主体: "客户", 数: 1 }]);

    await 存组织规则(开超时);
    const 开 = await 以谁的身份(经理, () => 复盘概况of(经.只看 ?? 经.谁, { id: 经理, role: "SALES" }, "CNY"));
    expect(开.概况.将回公海).toBe(2);
    expect(开.预警).toHaveLength(2);
  });

  it("范围同项目列表：最下级只数自己；没设业务角色 = 谁都不数（各块都是 0）；公海里的项目不算", async () => {
    await 存组织规则(开超时);
    await 发卡点(小王, "客户");
    await 发卡点(外人, "客户");
    await 记沟通(外人, 项目[外人], "VISIT", "外人上门");
    await prisma.project.create({ data: { name: "外人进公海的", customerId: 客户[外人], ownerId: 外人, creatorId: 外人, pooledAt: new Date() } });
    忘掉企业版范围();
    const 外 = await 看板的人({ id: 外人, role: "SALES" });
    expect(外).toMatchObject({ 只看: 外人, 谁: [外人], 选项: null });
    const 自己 = await 以谁的身份(外人, () => 复盘概况of(外.只看 ?? 外.谁, { id: 外人, role: "SALES" }, "CNY"));
    expect(自己.概况).toMatchObject({ 在跟: 1, 未解决卡点: 1, 将回公海: 1 });

    await prisma.entMember.delete({ where: { userId: 外人 } });
    忘掉企业版范围();
    const 无 = await 看板的人({ id: 外人, role: "SALES" });
    expect(无).toEqual({ 谁: [], 选项: null });
    const 圈 = 无.只看 ?? 无.谁;
    const r = await 以谁的身份(外人, () => 复盘概况of(圈, { id: 外人, role: "SALES" }, "CNY"));
    expect(r.概况).toMatchObject({ 在跟: 0, 未解决卡点: 0, 已回款: 0, 待回款: 0, 将回公海: 0 });
    expect(r.预警).toEqual([]);
    expect((await 缺沟通of(圈)).总数).toBe(0);
    expect((await 卡点分布of({ id: 外人, role: "SALES" })).总数).toBe(0);
    expect((await 将回公海of(圈)).提醒.总数).toBe(0);
    expect((await 复盘沟通of(无.谁, { 段: "all" })).总数).toBe(0);
  });
});
