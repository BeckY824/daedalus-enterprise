/**
 * 看板「线索流失」拆三列（P-界面-66）：lib/enterprise/lost-split.ts 线索流失细分 + 看板接上（list.ts 拆流失组）。
 *   - 被并（合并单已合并、时间对得上）→ 项目合并；同时也被记成终判重复线索的（合并本身就写终判）只算项目合并
 *   - 终判无效 · 重复线索 → 重复线索；终判别的原因 → 其他（不再看手动原因）
 *   - 没终判、手动结束为线索流失且无效原因选重复线索 → 重复线索；字典改过名照认
 *   - 撤回合并：结局回进行中的不在里面；撤回后又被普通关成线索流失的 → 其他
 *   - 改回进程后普通关：旧的终判 / 合并单和这次的 closedAt 对不上，按这次手动的原因（空号 → 其他；选了重复线索 → 重复线索）
 *   - 容差 2 分钟两侧；closedAt 空的老数据 → 其他
 *   - 看板：列头的数、金额、首屏卡片、「再看」都按判定走，三列加起来 = 原来那一列；查询数不随项目数涨
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
import { 线索流失细分, 归列容差毫秒, 备注里的无效原因 } from "@/lib/enterprise/lost-split";
import { 读项目列表, 读看板一列 } from "@/lib/project/list";
import { 看板分列, 流失细分列键 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";

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

describe("线索流失细分（lib/enterprise/lost-split.ts）", () => {
  it("备注里的无效原因：手动是换行分段，判死 / 合并是「；」分段；不是「无效原因：」开头的不认", () => {
    expect(备注里的无效原因("无效原因：重复线索\n补充")).toBe("重复线索");
    expect(备注里的无效原因("无效原因：重复线索；并入「x」")).toBe("重复线索");
    expect(备注里的无效原因("重复线索")).toBeNull();
    expect(备注里的无效原因(null)).toBeNull();
  });

  it("各情形归类：被并只算合并、终判优先、手动兜底、对不上时间的不算", async () => {
    const 行们 = await prisma.project.findMany({ select: { id: true, name: true, result: true, closedAt: true } });
    const 判 = await 线索流失细分(行们);
    const 名到 = Object.fromEntries(行们.map((r) => [r.name, 判.get(r.id) ?? null]));
    expect(名到).toEqual({
      留下: null,
      被并: "项目合并",
      终判重复: "重复线索",
      终判空号: "其他线索流失",
      手动重复: "重复线索",
      手动新名: "重复线索",
      手动其他: "其他线索流失",
      手动无原因: "其他线索流失",
      撤回回进行: null,
      撤回后普通关: "其他线索流失",
      改回后普通关: "其他线索流失",
      并过改回又手动重复: "重复线索",
      容差内: "重复线索",
      容差外: "其他线索流失",
      老数据: "其他线索流失",
      丢单: null,
    });
  });

  it("撤回合并后项目回进行中：同一批再判，原来的被并项目改回进行中就不在里面（不改历史，下次读自动回原列）", async () => {
    await prisma.project.update({ where: { id: ids.被并 }, data: { result: null, closedAt: null } });
    await prisma.entCustomerMerge.updateMany({ where: { fromId: ids.被并 }, data: { status: "已撤回", undoneAt: T } });
    try {
      expect((await 线索流失细分([{ id: ids.被并, result: null, closedAt: null }])).size).toBe(0);
      // 撤回后（单子已撤回）同一刻又是线索流失（假设恢复成了别的流失）：不再算项目合并，按终判（重复线索）
      expect((await 线索流失细分([{ id: ids.被并, result: "线索流失", closedAt: T }])).get(ids.被并)).toBe("重复线索");
    } finally {
      await prisma.project.update({ where: { id: ids.被并 }, data: { result: "线索流失", closedAt: T } });
      await prisma.entCustomerMerge.updateMany({ where: { fromId: ids.被并 }, data: { status: "已合并", undoneAt: null } });
    }
  });

  it("批量：600 个项目分两段查，每段三句（不按项目查）", async () => {
    const 句: string[] = [];
    const 记 = (名: string) => (a: unknown) => { 句.push(名); return a; };
    const db = {
      entCustomerMerge: { findMany: async (a: unknown) => 记("合并")(a) && [] },
      entLeadVerify: { findMany: async (a: unknown) => 记("验证")(a) && [] },
      projectNodeLog: { findMany: async (a: unknown) => 记("节点")(a) && [] },
      entDictItem: { findUnique: async () => null },
    } as unknown as NonNullable<Parameters<typeof 线索流失细分>[1]>["db"];
    const 判 = await 线索流失细分(Array.from({ length: 600 }, (_, i) => ({ id: `p${i}`, result: "线索流失", closedAt: T })), { db, 名们: ["重复线索"] });
    expect(判.size).toBe(600);
    expect(句.length).toBe(6);
  });
});

describe("看板接上（list.ts 拆流失组）", () => {
  const 字典 = () => 字典of(true);
  const 名们 = (rs: { id: string }[]) => rs.map((r) => Object.keys(ids).find((k) => ids[k] === r.id)).sort();

  it("首屏：线索流失拆成 项目合并 / 重复线索 / 线索流失其余，列头数和金额、卡片都按判定，三列加起来 = 全部线索流失", async () => {
    const d = await 作为(() => 读项目列表(管, {}, undefined, { 每列: true, 要列表页: false }));
    const 列们 = 看板分列(d.行, 字典(), undefined, d.看板合计, d.每列);
    const 列 = (k: string) => 列们.find((c) => c.列 === k)!;
    expect(列们.map((c) => c.名).slice(-5)).toEqual(["交付结清", "项目合并", "重复线索", "线索流失", "商机丢单"]);
    expect(名们(列(流失细分列键.项目合并).行)).toEqual(["被并"]);
    expect(名们(列(流失细分列键.重复线索).行)).toEqual(["容差内", "并过改回又手动重复", "手动新名", "手动重复", "终判重复"].sort());
    expect(名们(列("线索流失").行)).toEqual(["容差外", "手动其他", "手动无原因", "撤回后普通关", "改回后普通关", "终判空号", "老数据"].sort());
    expect([列(流失细分列键.项目合并).数, 列(流失细分列键.重复线索).数, 列("线索流失").数]).toEqual([1, 5, 7]);
    expect(列(流失细分列键.重复线索).合计).toEqual([{ 币种: "CNY", 合计: 500 }]);
    expect(列("丢单").数).toBe(1);
    expect(d.总数).toBe(16);
  });

  it("「再看」：拆出的列和原来那列各取各的，不重不漏；列键白名单认拆出的两列", async () => {
    const 合 = await 作为(() => 读看板一列(管, {}, 流失细分列键.项目合并, 0, 20));
    const 重 = await 作为(() => 读看板一列(管, {}, 流失细分列键.重复线索, 0, 20));
    const 其 = await 作为(() => 读看板一列(管, {}, "线索流失", 0, 20));
    expect([合?.总, 重?.总, 其?.总]).toEqual([1, 5, 7]);
    expect(名们(合!.行)).toEqual(["被并"]);
    expect(名们(重!.行)).toEqual(["容差内", "并过改回又手动重复", "手动新名", "手动重复", "终判重复"].sort());
    expect(名们(其!.行)).toHaveLength(7);
    expect(其!.行.some((r) => r.id === ids.被并 || r.id === ids.手动重复)).toBe(false);
    // 第 2 个起：偏移照常
    expect((await 作为(() => 读看板一列(管, {}, 流失细分列键.重复线索, 4, 20)))!.行).toHaveLength(1);
    expect(await 作为(() => 读看板一列(管, {}, "线索流失·别的", 0, 20))).toBeNull();
  });

  it("后筛（公海 · 收回次数）那条路：候选在手里直接判，列头和卡片、「再看」同样拆", async () => {
    const 放 = [ids.被并, ids.手动重复, ids.终判空号];
    await prisma.project.updateMany({ where: { id: { in: 放 } }, data: { pooledAt: T } });
    try {
      const sp = { pool: "1", recycled: "0" };
      const d = await 作为(() => 读项目列表(管, sp, undefined, { 每列: true, 要列表页: false }));
      const 列们 = 看板分列(d.行, 字典(), undefined, d.看板合计, d.每列);
      const 列 = (k: string) => 列们.find((c) => c.列 === k)!;
      expect([列(流失细分列键.项目合并), 列(流失细分列键.重复线索), 列("线索流失")].map((c) => [c.数, 名们(c.行)])).toEqual([[1, ["被并"]], [1, ["手动重复"]], [1, ["终判空号"]]]);
      const 重 = await 作为(() => 读看板一列(管, sp, 流失细分列键.重复线索, 0, 20));
      expect([重?.总, 名们(重!.行)]).toEqual([1, ["手动重复"]]);
    } finally {
      await prisma.project.updateMany({ where: { id: { in: 放 } }, data: { pooledAt: null } });
    }
  });

  it("筛了商机阶段：没有线索流失那几列，不拆", async () => {
    const d = await 作为(() => 读项目列表(管, { phase: "商机" }, undefined, { 每列: true, 要列表页: false }));
    const 列们 = 看板分列(d.行, 字典(), "商机", d.看板合计, d.每列);
    expect(列们.some((c) => c.列.startsWith("线索流失"))).toBe(false);
    expect(d.看板合计.some((g) => g.细分)).toBe(false);
  });
});
