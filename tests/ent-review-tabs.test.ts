/**
 * 企业版复盘页四个页签（U-复盘-01，10-31 会议）：任务 | 卡点 | 沟通 | 数据。这里测新加的「卡点」「沟通」两个页签：
 *   - 卡点条件 / 沟通条件（纯函数）：总管理员不限人；成员 / 经理按 看板的人 的 谁 圈；卡点状态、沟通时间段筛
 *   - 复盘卡点of：成员只看到自己负责项目上的 + 指认给自己的 / 自己发的；经理看到自己 + 下属的、看不到外人的；
 *     总管理员看全部；公海里的项目的卡点不给非总管理员；默认只列未解决；按发布时间倒序；分页；不是企业版给空
 *   - 复盘沟通of：只列挂在项目上的沟通；成员只看到自己记的；经理看到自己 + 下属的；总管理员全部；时间倒序；最近几天筛
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 清首页缓存 } from "@/lib/home-cache";
import { dayjs } from "@/lib/utils";
import { 看板的人 } from "@/lib/project/board-member";
import { 卡点条件, 沟通条件, 读卡点筛, 读沟通段, 夹页 } from "@/lib/project/review-tabs";
import { 复盘卡点of, 复盘沟通of } from "@/lib/project/review-tabs-db";

const 老板 = "rv_boss";
const 经理 = "rv_mgr";
const 小王 = "rv_wang"; // 经理的下属
const 外人 = "rv_out";

describe("纯函数：地址栏、条件", () => {
  it("读卡点筛 / 读沟通段：认不得的回默认（未解决 / 全部时间）；夹页落在 1..末页", () => {
    expect([读卡点筛("done"), 读卡点筛("all"), 读卡点筛("x"), 读卡点筛()]).toEqual(["done", "all", "open", "open"]);
    expect([读沟通段("7"), 读沟通段("90"), 读沟通段("5"), 读沟通段()]).toEqual(["7", "90", "all", "all"]);
    expect([夹页(0, 50), 夹页(9, 50), 夹页(2, 50), 夹页(3, 0)]).toEqual([1, 3, 2, 1]);
  });

  it("卡点条件：总管理员（谁 = undefined）只按状态；经理看下属只按下属负责、不在公海的项目；含自己时加上指认 / 发布 / 参与的", () => {
    expect(卡点条件(undefined, 老板, "open")).toEqual({ status: { not: "已解决" } });
    expect(卡点条件(undefined, 老板, "all")).toEqual({});
    expect(卡点条件([小王], 经理, "done")).toEqual({ status: "已解决", OR: [{ project: { ownerId: { in: [小王] }, pooledAt: null } }] });
    const 自己 = 卡点条件([经理, 小王], 经理, "all");
    expect(自己.OR).toHaveLength(4);
    expect(自己.OR).toContainEqual({ assigneeId: 经理 });
    expect(自己.OR).toContainEqual({ creatorId: 经理 });
  });

  it("沟通条件：只要挂在没删的项目上的；谁 给了按记录人筛；最近 N 天从那天零点算", () => {
    const now = dayjs("2026-10-31T15:00:00");
    expect(沟通条件(undefined, "all", now)).toEqual({ projectNode: { is: { project: { deletedAt: null } } } });
    const w = 沟通条件([小王], "7", now);
    expect(w.ownerId).toEqual({ in: [小王] });
    expect(dayjs((w.occurredAt as { gte: Date }).gte).format("YYYY-MM-DD HH:mm")).toBe("2026-10-25 00:00");
  });
});

describe("库里取数和数据范围", () => {
  const 用户 = [
    { id: 老板, name: "老板", role: "ADMIN" },
    { id: 经理, name: "经理", role: "SALES" },
    { id: 小王, name: "小王", role: "SALES" },
    { id: 外人, name: "外人", role: "SALES" },
  ];
  const 项目: Record<string, string> = {};
  const 客户: Record<string, string> = {};
  let 序 = 0;

  async function 记沟通(谁: string, 内容: string, 几天前: number, 挂项目 = true) {
    const f = await prisma.followUp.create({
      data: { customerId: 客户[谁], ownerId: 谁, type: "CALL", title: "", content: 内容, status: "已完成", occurredAt: dayjs().subtract(几天前, "day").toDate() },
    });
    if (挂项目) await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: 项目[谁], node: "潜客培育" } });
    return f.id;
  }
  async function 发卡点(项目id: string, 客户id: string, 谁发: string, 描述: string, 额外: { status?: string; assigneeId?: string; createdAt?: Date } = {}) {
    const f = await prisma.followUp.create({ data: { customerId: 客户id, ownerId: 谁发, type: "CALL", title: "", content: `发卡点：${描述}`, status: "已完成" } });
    return prisma.entBlocker.create({
      data: {
        code: `KD${String(++序).padStart(4, "0")}`, projectId: 项目id, followUpId: f.id, customerId: 客户id, phase: "线索",
        type: "需求不清", impact: "一般", obstacle: "客户", description: 描述, dueDays: 3, dueAt: dayjs().add(3, "day").toDate(),
        creatorId: 谁发, ...额外,
      },
    });
  }

  beforeEach(async () => {
    await resetDb();
    清首页缓存();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    for (const u of 用户) await prisma.user.create({ data: { ...u, email: `${u.id}@t`, password: "x", title: "" } });
    let i = 0;
    for (const u of 用户) {
      客户[u.id] = (await prisma.customer.create({ data: { name: `${u.name}的客户`, phone: `1380000000${i++}`, salesOwnerId: u.id } })).id;
      项目[u.id] = (await prisma.project.create({ data: { name: `${u.name}的项目`, customerId: 客户[u.id], ownerId: u.id, creatorId: u.id } })).id;
      await 记沟通(u.id, `${u.name}聊了`, 1);
    }
    await prisma.entMember.create({ data: { userId: 经理 } });
    await prisma.entMember.create({ data: { userId: 小王, managerId: 经理 } });
    await prisma.entMember.create({ data: { userId: 外人 } });
    // 每个项目一条未解决卡点（发布时间错开，老板的最新）
    for (const [k, u] of 用户.entries())
      await 发卡点(项目[u.id], 客户[u.id], u.id, `${u.name}的卡点`, { createdAt: dayjs().subtract(10 - k, "hour").toDate() });
    // 外人项目上指认给经理的（经理含自己时看得到，经理只看小王时看不到）
    await 发卡点(项目[外人], 客户[外人], 外人, "外人指给经理", { status: "待接受", assigneeId: 经理 });
    // 小王已解决的
    await 发卡点(项目[小王], 客户[小王], 小王, "小王解决了", { status: "已解决" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });
  afterAll(() => prisma.$disconnect());

  const 描述 = (d: { 行: { description: string }[] }) => d.行.map((x) => x.description).sort();
  const 内容 = (d: { 行: { 内容: string }[] }) => d.行.map((x) => x.内容).sort();

  it("卡点：成员只看到自己项目上的 + 指认给自己的，看不到别人的；带项目、客户、负责人名", async () => {
    const { 谁 } = await 看板的人({ id: 小王, role: "SALES" });
    const r = await 以谁的身份(小王, () => 复盘卡点of(谁, 小王, { 筛: "open" }));
    expect(描述(r)).toEqual(["小王的卡点"]);
    expect(r.行[0]).toMatchObject({ 项目: "小王的项目", 客户: "小王的客户", 负责人: "小王", 经手人: null, projectId: 项目[小王] });
    // 外人：自己的 + 没有别人的
    const 外 = await 看板的人({ id: 外人, role: "SALES" }, 老板);
    expect(描述(await 以谁的身份(外人, () => 复盘卡点of(外.谁, 外人, { 筛: "open" })))).toEqual(["外人指给经理", "外人的卡点"].sort());
  });

  it("卡点：经理看自己 + 下属的、加上指认给自己的；看不到外人自己的；只看小王时不带指认给经理的", async () => {
    const r = await 看板的人({ id: 经理, role: "SALES" });
    const 全 = await 以谁的身份(经理, () => 复盘卡点of(r.谁, 经理, { 筛: "open" }));
    expect(描述(全)).toEqual(["经理的卡点", "小王的卡点", "外人指给经理"].sort());
    expect(全.行.find((x) => x.description === "外人指给经理")).toMatchObject({ 负责人: "外人", 经手人: "经理", status: "待接受" });
    const 王 = await 看板的人({ id: 经理, role: "SALES" }, 小王);
    expect(描述(await 以谁的身份(经理, () => 复盘卡点of(王.谁, 经理, { 筛: "open" })))).toEqual(["小王的卡点"]);
    // 已解决 / 全部
    expect(描述(await 以谁的身份(经理, () => 复盘卡点of(王.谁, 经理, { 筛: "done" })))).toEqual(["小王解决了"]);
    expect(描述(await 以谁的身份(经理, () => 复盘卡点of(王.谁, 经理, { 筛: "all" })))).toEqual(["小王的卡点", "小王解决了"].sort());
  });

  it("卡点：总管理员看全部、按发布时间倒序、分页；公海里的项目只有总管理员看得到；不是企业版给空", async () => {
    const 全 = await 复盘卡点of(undefined, 老板, { 筛: "open" });
    expect(全.总数).toBe(5);
    expect(全.行.map((x) => x.description)).toEqual(["外人指给经理", "外人的卡点", "小王的卡点", "经理的卡点", "老板的卡点"]);
    const 第二 = await 复盘卡点of(undefined, 老板, { 筛: "open", 每页: 2, 页: 2 });
    expect(第二).toMatchObject({ 总数: 5, 页: 2 });
    expect(第二.行.map((x) => x.description)).toEqual(["小王的卡点", "经理的卡点"]);
    expect((await 复盘卡点of(undefined, 老板, { 筛: "open", 每页: 2, 页: 9 })).页).toBe(3);

    await prisma.project.update({ where: { id: 项目[小王] }, data: { pooledAt: new Date() } });
    const 经 = await 看板的人({ id: 经理, role: "SALES" });
    expect(描述(await 以谁的身份(经理, () => 复盘卡点of(经.谁, 经理, { 筛: "open" })))).toEqual(["经理的卡点", "外人指给经理"].sort());
    expect(描述(await 复盘卡点of(undefined, 老板, { 筛: "open" }))).toContain("小王的卡点");

    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 复盘卡点of(undefined, 老板, { 筛: "all" })).toEqual({ 总数: 0, 页: 1, 行: [] });
  });

  it("沟通：只列挂在项目上的；成员只看到自己记的，经理自己 + 下属，总管理员全部；时间倒序，带项目、节点、负责人", async () => {
    await 记沟通(小王, "小王没挂项目", 0, false);
    await 记沟通(小王, "小王上个月", 40);

    const 王 = await 看板的人({ id: 小王, role: "SALES" });
    const 自己 = await 以谁的身份(小王, () => 复盘沟通of(王.谁, { 段: "all" }));
    expect(自己.行.map((x) => x.内容)).toEqual(["小王聊了", "小王上个月"]); // 时间倒序
    expect(自己.行[0]).toMatchObject({ 项目: "小王的项目", 节点: "潜客培育", 客户: "小王的客户", 负责人: "小王", projectId: 项目[小王] });
    expect(内容(await 以谁的身份(小王, () => 复盘沟通of(王.谁, { 段: "30" })))).toEqual(["小王聊了"]);

    const 经 = await 看板的人({ id: 经理, role: "SALES" });
    expect(内容(await 以谁的身份(经理, () => 复盘沟通of(经.谁, { 段: "30" })))).toEqual(["经理聊了", "小王聊了"].sort());

    const 全 = await 复盘沟通of(undefined, { 段: "all" });
    expect(全.总数).toBe(5);
    expect(内容(全)).toEqual(["老板聊了", "经理聊了", "小王聊了", "外人聊了", "小王上个月"].sort());
    // 卡点自带的沟通（没挂项目节点）不进沟通页签
    expect(内容(全).some((x) => x.startsWith("发卡点"))).toBe(false);
  });
});
