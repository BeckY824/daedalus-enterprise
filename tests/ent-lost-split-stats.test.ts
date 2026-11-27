/**
 * 线索流失拆项目合并 / 重复线索第二段（P-界面-66）：数据页线索瀑布、结局分布、项目详情、看板卡片小字接上 lib/enterprise/lost-split.ts。
 *   - 瀑布（项目现在 / 项目一段）的项目合并、重复线索两项 = 结局分布拆出的两个数 = 看板两列的数（同一批造数，造数同 ent-board-lost-split.test.ts）
 *   - 剩下的里有无效终判的算判无效（同拆列前，不看时间对不对得上：旧终判、容差外、closedAt 空的老数据照算判无效，P-界面-66 不改历史）
 *   - 库里先按 细分候选条件 筛再判，和把全部线索流失交 线索流失细分详 判的结果一样
 *   - 项目详情：被并 → 线索流失・项目合并；重复线索 → 线索流失・重复线索；其他线索流失不带；不是线索流失的不查
 *   - 卡片小字：拆出列里写「项目合并 · 进程」，原来那列照写「线索流失 · 进程」
 * 数据全是编造的。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 线索流失细分详, 细分候选条件, 归列容差毫秒 } from "@/lib/enterprise/lost-split";
import { 读项目列表 } from "@/lib/project/list";
import { 看板分列, 流失细分列键, 卡片小字, 拆出的流失of, type 看板卡片 } from "@/lib/project/board";
import { 字典of, 带流失细分 } from "@/lib/project/stage-dict";
import { 项目现在, 项目一段, type 线索节点格 } from "@/app/(app)/overview/project-stats";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";

type 人 = { id: string; name: string; role: string };
let 管: 人;
let 客户id = "";
const 作为 = <T,>(fn: () => Promise<T>) => { mocks.user = { ...mocks.user, id: 管.id, name: 管.name, role: 管.role }; 忘掉企业版范围(); return 以谁的身份(管.id, fn); };
const T = new Date("2026-11-20T03:00:00.000Z");
const 秒 = (n: number) => new Date(T.getTime() + n * 1000);
const ids: Record<string, string> = {};

async function 建(名: string, 带: { result?: string | null; closedAt?: Date | null; phase?: string; node?: string; amount?: number } = {}) {
  const p = await prisma.project.create({
    data: { name: 名, customerId: 客户id, ownerId: 管.id, creatorId: 管.id, phase: 带.phase ?? "线索", node: 带.node ?? "线索验证", amount: 带.amount ?? 100,
      result: 带.result === undefined ? "线索流失" : 带.result, closedAt: 带.closedAt === undefined ? T : 带.closedAt },
  });
  ids[名] = p.id;
  return p.id;
}
const 并单 = (fromId: string, at: Date, status = "已合并") =>
  prisma.entCustomerMerge.create({ data: { kind: "项目", fromId, intoId: ids.留下, status, byUserId: 管.id, fromName: "被并", detail: "{}", at } });
const 终判 = (projectId: string, 原因: string, 时: { finalAt?: Date; reviewedAt?: Date; verifiedAt?: Date }) =>
  prisma.entLeadVerify.create({ data: { projectId, verdict: "无效线索", finalResult: "无效线索", invalidReason: 原因, ...时 } });
const 手动关 = (projectId: string, at: Date, reason: string) =>
  prisma.projectNodeLog.create({ data: { projectId, userId: 管.id, at, fromPhase: "线索", fromNode: "线索验证", toPhase: "线索", toNode: "线索验证", toResult: "线索流失", reason } });

beforeAll(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const u = await prisma.user.create({ data: { email: "gl@t", name: "管理员", title: "", role: "ADMIN", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: "director" } });
  管 = { id: u.id, name: u.name, role: "ADMIN" };
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
  客户id = (await prisma.customer.create({ data: { name: "编造客户", phone: "13900000001", salesOwnerId: 管.id } })).id;
  // 字典「重复线索」那一项（dict-invalid-5）后台改过名：老记录存原名，新记录存新名，两个都认
  await prisma.entDictItem.create({ data: { id: "dict-invalid-5", kind: "invalid", name: "重复咨询线索", sort: 5 } });

  await 建("留下", { result: null, closedAt: null });
  // 1 被并：合并单 + 合并写的终判（重复线索）+ 节点变更，三样同一刻 → 只算项目合并
  await 建("被并");
  await 并单(ids.被并, T);
  await 终判(ids.被并, "重复线索", { finalAt: T });
  await 手动关(ids.被并, T, "无效原因：重复线索；并入「留下」");
  // 2 终判重复（市场复核判死：reviewedAt 比 closedAt 早几秒）
  await 建("终判重复");
  await 终判(ids.终判重复, "重复线索", { verifiedAt: 秒(-3600), reviewedAt: 秒(-3) });
  // 2b 终判别的原因：手动原因不看
  await 建("终判空号");
  await 终判(ids.终判空号, "空号", { finalAt: 秒(-1) });
  // 3 没终判、手动选了重复线索（原名 / 改过的新名）
  await 建("手动重复");
  await 手动关(ids.手动重复, T, "无效原因：重复线索\n和上一条同一需求");
  await 建("手动新名");
  await 手动关(ids.手动新名, T, "无效原因：重复咨询线索");
  await 建("手动其他");
  await 手动关(ids.手动其他, T, "无效原因：空号");
  await 建("手动无原因");
  await 手动关(ids.手动无原因, T, "客户说不要了");
  // 5 撤回合并：回到进行中；撤回后又被普通关成线索流失
  await 建("撤回回进行", { result: null, closedAt: null });
  await 并单(ids.撤回回进行, 秒(-7200), "已撤回");
  await 建("撤回后普通关");
  await 并单(ids.撤回后普通关, 秒(-7200), "已撤回");
  await 手动关(ids.撤回后普通关, T, "无效原因：空号");
  // 6 改回进程后普通关：旧终判（重复线索）在 1 小时前，这次手动关的原因是空号 → 其他；这次手动选了重复线索 → 重复线索
  await 建("改回后普通关");
  await 终判(ids.改回后普通关, "重复线索", { finalAt: 秒(-3600) });
  await 手动关(ids.改回后普通关, 秒(-3600), "无效原因：重复线索；总管理终判判无效");
  await 手动关(ids.改回后普通关, T, "无效原因：空号");
  await 建("并过改回又手动重复");
  await 并单(ids.并过改回又手动重复, 秒(-86400 * 40));
  await 手动关(ids.并过改回又手动重复, T, "无效原因：重复线索");
  // 容差两侧、closedAt 空的老数据
  await 建("容差内");
  await 终判(ids.容差内, "重复线索", { finalAt: new Date(T.getTime() - 归列容差毫秒) });
  await 建("容差外");
  await 终判(ids.容差外, "重复线索", { finalAt: new Date(T.getTime() - 归列容差毫秒 - 1000) });
  await 建("老数据", { closedAt: null });
  await 终判(ids.老数据, "重复线索", { finalAt: T });
  // 不是线索流失的：交付结清、丢单（不在回的 Map 里）
  await 建("丢单", { result: "丢单", phase: "商机", node: "痛点挖掘" });
}, 60_000);

const 合 = (节点: 线索节点格[], k: "count" | "流失" | "判无效" | "项目合并" | "重复线索" | "退回公海") => 节点.reduce((s, n) => s + n[k], 0);

describe("数据页接上（overview/project-stats.ts）", () => {
  it("瀑布两项 = 结局分布拆出的两个数 = 看板两列；剩下的有无效终判就算判无效（同拆列前）；加起来 = 全部线索流失", async () => {
    const 板 = await 作为(() => 读项目列表(管, {}, undefined, { 每列: true, 要列表页: false }));
    const 列们 = 看板分列(板.行, 字典of(true), undefined, 板.看板合计, 板.每列);
    const 列数 = (k: string) => 列们.find((c) => c.列 === k)!.数;
    const 数 = await 作为(() => 项目现在("CNY"));
    expect([合(数.线索节点, "项目合并"), 合(数.线索节点, "重复线索")]).toEqual([列数(流失细分列键.项目合并), 列数(流失细分列键.重复线索)]);
    expect(数.流失拆出).toEqual({ 项目合并: 列数(流失细分列键.项目合并), 重复线索: 列数(流失细分列键.重复线索) });
    expect(数.流失拆出).toEqual({ 项目合并: 1, 重复线索: 5 });
    // 看板「线索流失」那列 7 个 = 瀑布的判无效 4 个（有无效终判、没归到两列的：终判空号、改回后普通关、容差外、老数据）
    //   + 流失 3 个（没有无效终判的：手动其他、手动无原因、撤回后普通关）
    expect([合(数.线索节点, "判无效"), 合(数.线索节点, "流失")]).toEqual([4, 3]);
    expect(合(数.线索节点, "判无效") + 合(数.线索节点, "流失")).toBe(列数("线索流失"));
    expect(数.结局.find((r) => r.result === "线索流失")?.count).toBe(13);
    // 都停在线索验证
    const 验证 = 数.线索节点.find((n) => n.node === "线索验证")!;
    expect([验证.流失, 验证.判无效, 验证.项目合并, 验证.重复线索]).toEqual([3, 4, 1, 5]);
  });

  it("项目一段：这一段新建的同一口径", async () => {
    const 今 = Date.now();
    const 一段 = await 作为(() => 项目一段(new Date(今 - 86_400_000), new Date(今 + 86_400_000), "day", "CNY"));
    expect([合(一段.线索节点, "项目合并"), 合(一段.线索节点, "重复线索"), 合(一段.线索节点, "判无效"), 合(一段.线索节点, "流失")]).toEqual([1, 5, 4, 3]);
  });

  it("库里先筛候选再判 = 全部线索流失都交 线索流失细分详 判（没进候选的都是手动点、没终判的）", async () => {
    const 全 = await prisma.project.findMany({ where: { result: "线索流失" }, select: { id: true, result: true, closedAt: true } });
    const 全判 = await 线索流失细分详(全);
    const 候选 = new Set((await prisma.project.findMany({ where: await 细分候选条件(), select: { id: true } })).map((r) => r.id));
    for (const r of 全) {
      const d = 全判.get(r.id)!;
      if (!候选.has(r.id)) expect(d, `${r.id} 没进候选就该是手动点的其他线索流失`).toEqual({ 类: "其他线索流失", 终判: false });
    }
    // 候选确实筛掉了一些（手动其他、手动无原因、撤回后普通关）
    expect(全.length - 候选.size).toBeGreaterThanOrEqual(3);
  });

  it("容差外的重复线索终判挪进容差：判无效 −1、重复线索 +1（时间对齐只管两列归不归，改的是同一份判定）", async () => {
    const 前 = await 作为(() => 项目现在("CNY"));
    await prisma.entLeadVerify.update({ where: { projectId: ids.容差外 }, data: { finalAt: new Date(T.getTime() - 归列容差毫秒) } });
    try {
      const 后 = await 作为(() => 项目现在("CNY"));
      const 差 = (k: "判无效" | "重复线索" | "流失") => 合(后.线索节点, k) - 合(前.线索节点, k);
      expect([差("判无效"), 差("重复线索"), 差("流失")]).toEqual([-1, 1, 0]);
    } finally {
      await prisma.entLeadVerify.update({ where: { projectId: ids.容差外 }, data: { finalAt: new Date(T.getTime() - 归列容差毫秒 - 1000) } });
    }
  });
});

describe("项目详情接上（projects/[id]/load.ts）", () => {
  const 读 = async (名: string) => {
    const 载 = await 作为(() => 读项目详情(mocks.user as never, ids[名]));
    if (载.种 !== "有") throw new Error(`没给详情：${载.种}`);
    return 载.props.p;
  };

  it("三种情形：项目合并、重复线索带细分，其他线索流失不带；不是线索流失的不带", async () => {
    expect((await 读("被并")).流失细分).toBe("项目合并");
    expect((await 读("手动重复")).流失细分).toBe("重复线索");
    expect((await 读("终判空号")).流失细分).toBeUndefined();
    expect((await 读("留下")).流失细分).toBeUndefined();
  });

  it("结局字：线索流失・项目合并 / 线索流失・重复线索；其他线索流失、别的结局照原样", () => {
    expect(带流失细分("线索流失", "线索流失", "项目合并")).toBe("线索流失・项目合并");
    expect(带流失细分("线索流失", "线索流失", "重复线索")).toBe("线索流失・重复线索");
    expect(带流失细分("线索流失", "线索流失", undefined)).toBe("线索流失");
    expect(带流失细分("商机丢单", "丢单", "重复线索")).toBe("商机丢单");
    expect(带流失细分(null, null, undefined)).toBeNull();
  });
});

describe("看板卡片小字（board.ts 卡片小字）", () => {
  it("拆出列里写列名 · 进程，原来那列照写线索流失 · 进程", () => {
    const 企 = 字典of(true);
    const r = { phase: "线索", node: "线索验证", result: "线索流失" } as unknown as 看板卡片;
    expect(卡片小字(r, 企, 拆出的流失of(流失细分列键.项目合并))).toBe("项目合并 · 线索验证");
    expect(卡片小字(r, 企, 拆出的流失of(流失细分列键.重复线索))).toBe("重复线索 · 线索验证");
    expect(卡片小字(r, 企, 拆出的流失of("线索流失"))).toBe("线索流失 · 线索验证");
    expect(卡片小字(r, 企)).toBe("线索流失 · 线索验证");
  });
});
