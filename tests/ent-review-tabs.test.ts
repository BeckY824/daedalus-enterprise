/**
 * 企业版复盘页四个页签（U-复盘-01，10-31 会议）：任务 | 卡点 | 沟通 | 数据。这里测新加的「卡点」「沟通」两个页签：
 *   - 读卡点看板筛 / 沟通条件（纯函数）：卡点看板的地址栏只认 bm/bo/br/bt/bi/bp；沟通按 看板的人 的 谁 圈、时间段筛
 *   - 卡点看板（11-01 改成三栏，谁看得到按卡点的角色开关）：成员看自己发的 / 自己项目上的 / 认领的；
 *     经理加上直属下属发的、看不到外人的；总管理员（可看全部）全部；不是企业版给空
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
import { 沟通条件, 读卡点看板筛, 读沟通段, 夹页 } from "@/lib/project/review-tabs";
import { 复盘沟通of } from "@/lib/project/review-tabs-db";
import { 卡点看板, type 卡点看板数 } from "@/lib/project/blocker";

const 老板 = "rv_boss";
const 经理 = "rv_mgr";
const 小王 = "rv_wang"; // 经理的下属
const 外人 = "rv_out";

describe("纯函数：地址栏、条件", () => {
  it("读卡点看板筛 / 读沟通段：认不得的回默认（不筛 / 全部时间）；夹页落在 1..末页", () => {
    expect(读卡点看板筛({})).toEqual({ 我的认领: undefined, 只看自己: undefined, 原因: undefined, 类型: undefined, 影响: undefined, 项目: undefined });
    expect(读卡点看板筛({ bm: "1", bo: "0", br: " r1 ", bt: "重要卡点", bi: "", bp: "p1" })).toEqual({
      我的认领: true, 只看自己: undefined, 原因: "r1", 类型: "重要卡点", 影响: undefined, 项目: "p1",
    });
    expect(读卡点看板筛({ br: "x".repeat(100) }).原因).toHaveLength(64);
    expect([读沟通段("7"), 读沟通段("90"), 读沟通段("5"), 读沟通段()]).toEqual(["7", "90", "all", "all"]);
    expect([夹页(0, 50), 夹页(9, 50), 夹页(2, 50), 夹页(3, 0)]).toEqual([1, 3, 2, 1]);
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
  async function 发卡点(项目id: string, 客户id: string, 谁发: string, 描述: string, 额外: { status?: string; createdAt?: Date; claims?: { create: { userId: string } } } = {}) {
    const f = await prisma.followUp.create({ data: { customerId: 客户id, ownerId: 谁发, type: "CALL", title: "", content: `发卡点：${描述}`, status: "已完成" } });
    return prisma.entBlocker.create({
      data: {
        code: `KD${String(++序).padStart(4, "0")}`, title: 描述, projectId: 项目id, followUpId: f.id, customerId: 客户id, phase: "线索",
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
    await prisma.entMember.create({ data: { userId: 老板, bizRole: "director" } });
    await prisma.entMember.create({ data: { userId: 经理, bizRole: "sales_mgr" } });
    await prisma.entMember.create({ data: { userId: 小王, managerId: 经理, bizRole: "sales" } });
    await prisma.entMember.create({ data: { userId: 外人, bizRole: "sales" } });
    // 每个项目一条未解决卡点（发布时间错开，老板的最新）
    for (const [k, u] of 用户.entries())
      await 发卡点(项目[u.id], 客户[u.id], u.id, `${u.name}的卡点`, { createdAt: dayjs().subtract(10 - k, "hour").toDate() });
    // 外人项目上经理认领了的（经理是认领人，看得到）
    await 发卡点(项目[外人], 客户[外人], 外人, "外人的经理认领", { status: "处理中", claims: { create: { userId: 经理 } } });
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

  const 板描述 = (d: 卡点看板数) => [...d.栏.待接受, ...d.栏.处理中, ...d.栏.已解决].map((x) => x.description).sort();

  it("卡点看板：成员看自己发的 / 自己项目上的；外人看得到自己发的、经理认领了的那条；看不到别人的", async () => {
    const 王 = await 卡点看板({ id: 小王, role: "SALES" });
    expect(王).toMatchObject({ 开: true, 全部: false });
    expect(板描述(王)).toEqual(["小王的卡点", "小王解决了"].sort());
    expect(王.栏.已解决.map((x) => x.description)).toEqual(["小王解决了"]);
    expect(板描述(await 卡点看板({ id: 外人, role: "SALES" }))).toEqual(["外人的卡点", "外人的经理认领"].sort());
  });

  it("卡点看板：经理看自己的 + 直属下属发的 + 自己认领的；看不到外人自己的；只看我的认领", async () => {
    const 全 = await 卡点看板({ id: 经理, role: "SALES" });
    expect(板描述(全)).toEqual(["经理的卡点", "小王的卡点", "小王解决了", "外人的经理认领"].sort());
    expect(全.栏.处理中.map((x) => x.description)).toEqual(["外人的经理认领"]);
    expect(板描述(await 卡点看板({ id: 经理, role: "SALES" }, { 我的认领: true }))).toEqual(["外人的经理认领"]);
  });

  it("卡点看板：总管理员（可看全部）全部、三栏分好、统计对；不是企业版给空", async () => {
    const 全 = await 卡点看板({ id: 老板, role: "ADMIN" });
    expect(全.全部).toBe(true);
    expect(板描述(全)).toEqual(["老板的卡点", "经理的卡点", "小王的卡点", "外人的卡点", "外人的经理认领", "小王解决了"].sort());
    expect(全.栏.待接受).toHaveLength(4);
    expect(全.统计).toMatchObject({ 未解决: 5, 已解决: 1 });
    // 这些都是没挂原因的老卡点：统计全进「未分类（老数据）」
    expect(全.统计.按原因).toEqual([{ id: "__未分类", 名: "未分类（老数据）", 状态: "未分类", 数: 6 }]);
    expect(全.栏.待接受[0].原阻碍主体).toBe("客户");

    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 卡点看板({ id: 老板, role: "ADMIN" })).toMatchObject({ 开: false, 已解决共: 0 });
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
