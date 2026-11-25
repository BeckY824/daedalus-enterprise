/**
 * X-147「仅记录用」（客户 11-17 提、11-18 第二轮选 A）：为记一条沟通新建的项目标来源 仅记录用、停在潜客培育，
 * 「不算在推、不进任何转化率的分母」；超时回收默认不收（组织规则 超时回收.仅记录用也回收）；建它要组织规则 阶段.仅记录用 开着（默认关）。
 *   - 常量：是仅记录用 / 仅记录用的 / 不进统计 / 不算补建；推进出潜客培育就不再算
 *   - 数据页 现在（阶段、节点、按人、漏斗、结局）、一段（新建、漏斗、结局）不算它；推进出去的照算
 *   - 持有数、首页卡（本月新增、重点、暂未跟进）、渠道项目条件不算它
 *   - 超时回收日：默认不收，开了「仅记录用也回收」照收；推进出去的照收
 *   - 客户页新建项目（给客户建项目）：开关关着交了仅记录用也当普通项目；开着记来源、只能潜客培育
 *   - 待定 5：单个指派 / 领取核持有上限时仅记录用的不 +1（算一个持有、超上限，同持有数）
 *   - 待定 6：仅记录用的不回收时记沟通不强制下一步时间（记沟通要下一步时间、记项目沟通、给客户建项目）；仅记录用也回收 开着照旧要
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "王", email: "w@t", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 项目现在, 项目一段 } from "../src/app/(app)/overview/project-stats";
import {
  仅记录用来源, 仅记录用的, 是仅记录用, 不进统计, 不算补建, 来源字, 历史分析来源,
} from "@/lib/project/system-created";
import { 持有数, 算一个持有, 超上限, 记项目沟通 } from "@/lib/project/db";
import { 首页卡条件 } from "@/lib/project/home-cards";
import { 渠道项目条件 } from "@/lib/enterprise/channel-stats-db";
import { 超时回收日, 记沟通要下一步时间 } from "@/lib/project/timeout";
import { 默认组织规则, 规整组织规则, 合上改动, type 组织规则 } from "@/lib/project/org-rules";
import { 企业版字典 } from "@/lib/project/nodes";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { 组织规则改动 } from "@/lib/project/org-rules-diff";

let 王: string, 客户: string, 渠道: string;

type 建参 = { name: string; phase?: string; node?: string; result?: string | null; source?: string | null; createdAt?: Date; closedAt?: Date; level?: string; channelId?: string };
const 建 = (o: 建参) => prisma.project.create({ data: { customerId: 客户, ownerId: 王, creatorId: 王, phase: "线索", node: "潜客培育", ...o } });
/** 为记沟通建的：仅记录用来源、潜客培育 */
const 记录用 = (o: Partial<建参> = {}) => 建({ name: "记录用", source: 仅记录用来源, ...o });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  王 = (await prisma.user.create({ data: { email: "w@t", password: "x", name: "王", title: "", role: "SALES" } })).id;
  await prisma.entMember.create({ data: { userId: 王, bizRole: "sales" } });
  渠道 = (await prisma.channel.create({ data: { name: "展会", channelOwnerId: 王 } })).id;
  客户 = (await prisma.customer.create({ data: { name: "云帆科技", phone: "", salesOwnerId: 王, channelId: 渠道 } })).id;
  mocks.user = { ...mocks.user, id: 王 };
});
afterAll(async () => void (await prisma.$disconnect()));

describe("常量", () => {
  it("是仅记录用：来源 + 还停在线索 · 潜客培育；推进出去、别的来源都不算", () => {
    expect(是仅记录用({ source: 仅记录用来源, phase: "线索", node: "潜客培育" })).toBe(true);
    expect(是仅记录用({ source: 仅记录用来源, phase: "线索", node: "线索验证" })).toBe(false);
    expect(是仅记录用({ source: 仅记录用来源, phase: "商机", node: "明确需求" })).toBe(false);
    expect(是仅记录用({ source: null, phase: "线索", node: "潜客培育" })).toBe(false);
    expect(是仅记录用({ source: 历史分析来源, phase: "线索", node: "潜客培育" })).toBe(false);
    expect(来源字(仅记录用来源)).toBe("仅记录用");
  });

  it("不进统计排历史分析和仅记录用（source 空的照算）；不算补建也排它；NOT 仅记录用的 对 source 空的不丢行", async () => {
    await 建({ name: "普通" });
    await 建({ name: "别的来源", source: "repeat-inquiry" });
    await 记录用();
    await 记录用({ node: "线索验证" }); // 推进出去了
    await 建({ name: "回填", source: 历史分析来源 });
    expect(await prisma.project.count({ where: 不进统计 })).toBe(3);
    expect(await prisma.project.count({ where: 不算补建 })).toBe(3);
    expect(await prisma.project.count({ where: { NOT: 仅记录用的 } })).toBe(4);
    expect(await prisma.project.count({ where: 仅记录用的 })).toBe(1);
  });
});

describe("数据页", () => {
  it("现在：仅记录用的不进阶段、节点、按人、漏斗、结局；推进出潜客培育的照算", async () => {
    await 建({ name: "普通" });
    const 改前 = await 项目现在("CNY");
    await 记录用();
    await 记录用({ result: "线索流失", closedAt: new Date() });
    expect(await 项目现在("CNY")).toEqual(改前);
    await 记录用({ node: "线索验证" });
    const 推了 = await 项目现在("CNY");
    expect(推了.阶段.find((x) => x.phase === "线索")?.count).toBe(改前.阶段.find((x) => x.phase === "线索")!.count + 1);
    expect(推了.漏斗[0].count).toBe(改前.漏斗[0].count + 1);
  });

  it("一段：仅记录用的不算新建、不进漏斗、结局不落段", async () => {
    const from = new Date(Date.now() - 86400_000), to = new Date(Date.now() + 86400_000);
    await 建({ name: "普通" });
    const 改前 = await 项目一段(from, to, "day", "CNY");
    await 记录用();
    await 记录用({ result: "线索流失", closedAt: new Date() });
    const 改后 = await 项目一段(from, to, "day", "CNY");
    expect(改后.合计).toEqual(改前.合计);
    expect(改后.漏斗).toEqual(改前.漏斗);
    expect(改前.合计.新建).toBe(1);
  });
});

describe("持有数、首页卡、渠道", () => {
  it("持有数不算仅记录用的；推进出去的算", async () => {
    await 建({ name: "普通" });
    await 记录用();
    expect(await 持有数(prisma, 王)).toBe(1);
    await 记录用({ node: "线索验证" });
    expect(await 持有数(prisma, 王)).toBe(2);
  });

  it("首页卡本月新增、重点、暂未跟进不数仅记录用的", async () => {
    await 建({ name: "普通", level: "A" });
    await 记录用({ level: "A" });
    const 数 = async (键: "month-new" | "key" | "no-follow") => prisma.project.count({ where: 首页卡条件(键, 默认组织规则, 企业版字典, new Date(), [王]) });
    expect(await 数("month-new")).toBe(1);
    expect(await 数("key")).toBe(1);
    expect(await 数("no-follow")).toBe(1);
  });

  it("渠道项目条件不算仅记录用的（看板「全部」和各档、点进来的名单同一个条件）", async () => {
    await 建({ name: "普通" });
    await 记录用();
    expect(await prisma.project.count({ where: 渠道项目条件([渠道]) })).toBe(1);
  });
});

describe("超时回收", () => {
  const 开了: 组织规则 = { ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 开: true, 节点天数: { 潜客培育: 7, 线索验证: 7 }, 起算日: null } };
  const 起点 = new Date("2026-11-01T02:00:00Z");
  it("默认不收仅记录用的；开了「仅记录用也回收」照收；推进出去的、普通的照收", () => {
    const p = { phase: "线索", node: "潜客培育", source: 仅记录用来源 };
    expect(超时回收日(开了, p, 起点, 企业版字典)).toBeNull();
    expect(超时回收日({ ...开了, 超时回收: { ...开了.超时回收, 仅记录用也回收: true } }, p, 起点, 企业版字典)).not.toBeNull();
    expect(超时回收日(开了, { ...p, node: "线索验证" }, 起点, 企业版字典)).not.toBeNull();
    expect(超时回收日(开了, { ...p, source: null }, 起点, 企业版字典)).not.toBeNull();
  });

  it("组织规则：两个开关默认关、只认 true、改动只收开或关；改动记成 record_only / record_only_recall", () => {
    expect(默认组织规则.阶段.仅记录用).toBe(false);
    expect(默认组织规则.超时回收.仅记录用也回收).toBe(false);
    expect(规整组织规则({ 阶段: { 仅记录用: "yes" }, 超时回收: { 仅记录用也回收: 1 } }).阶段.仅记录用).toBe(false);
    const 开 = 规整组织规则({ 阶段: { 仅记录用: true }, 超时回收: { 仅记录用也回收: true } });
    expect([开.阶段.仅记录用, 开.超时回收.仅记录用也回收]).toEqual([true, true]);
    expect(合上改动(默认组织规则, { 阶段: { 仅记录用: "开" as never } })).toMatchObject({ error: expect.stringContaining("仅记录用") });
    expect(合上改动(默认组织规则, { 超时回收: { 仅记录用也回收: "开" as never } })).toMatchObject({ error: expect.stringContaining("仅记录用也回收") });
    const 新 = 合上改动(默认组织规则, { 阶段: { 仅记录用: true }, 超时回收: { 仅记录用也回收: true } });
    if ("error" in 新) throw new Error(新.error);
    expect(组织规则改动(默认组织规则, 新).map((x) => x.开关).sort()).toEqual(["record_only", "record_only_recall"]);
  });
});

describe("客户页新建项目（给客户建项目）", () => {
  const 建项目 = (o: { 仅记录用?: boolean; 节点?: string } = {}) => 给客户建项目({
    customerId: 客户,
    项目: { name: "为记沟通", amount: 0, currency: "CNY", ownerId: 王 },
    跟进: { type: "PHONE", content: "问了价格", occurredAt: "2026-11-20 10:00", 节点: o.节点 ?? "潜客培育" },
    ...(o.仅记录用 !== undefined ? { 仅记录用: o.仅记录用 } : {}),
  });
  const 开开关 = () => setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 仅记录用: true } });

  it("开关关着（c2 现状）：交了仅记录用也建普通项目", async () => {
    const r = await 建项目({ 仅记录用: true });
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } })).source).toBeNull();
  });

  it("开关开着：勾着的记来源仅记录用、停在潜客培育；没勾的照旧普通项目", async () => {
    await 开开关();
    const r = await 建项目({ 仅记录用: true });
    if (!r.ok) throw new Error(r.error);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: r.projectId }, select: { source: true, phase: true, node: true } }))
      .toEqual({ source: 仅记录用来源, phase: "线索", node: "潜客培育" });
    const 普 = await 建项目();
    if (!普.ok) throw new Error(普.error);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 普.projectId } })).source).toBeNull();
  });

  it("开关开着、勾着仅记录用却交了别的进程：拦下说清楚，不悄悄改，一个都不建", async () => {
    await 开开关();
    const r = await 建项目({ 仅记录用: true, 节点: "线索验证" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("仅记录用") });
    expect(await prisma.project.count()).toBe(0);
  });
});

describe("待定 5：核持有上限时仅记录用的不 +1", () => {
  const 上限1: 组织规则 = { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: 1 } };
  it("算一个持有：仅记录用的不算，推进出去 / 普通的算，有结局 / 订单阶段不算", () => {
    expect(算一个持有({ phase: "线索", node: "潜客培育", result: null, source: 仅记录用来源 })).toBe(false);
    expect(算一个持有({ phase: "线索", node: "线索验证", result: null, source: 仅记录用来源 })).toBe(true);
    expect(算一个持有({ phase: "线索", node: "潜客培育", result: null, source: null })).toBe(true);
    expect(算一个持有({ phase: "线索", result: null })).toBe(true);
    expect(算一个持有({ phase: "线索", result: "线索流失" })).toBe(false);
    expect(算一个持有({ phase: "订单", result: null })).toBe(false);
  });

  it("超上限：到了上限再给一个仅记录用的不拦，普通的照拦", async () => {
    await 建({ name: "普通" });
    const 记 = await 记录用();
    expect(await 超上限(prisma, 上限1, 王, 记)).toBeNull();
    expect(await 超上限(prisma, 上限1, 王, { phase: "线索", node: "潜客培育", result: null, source: null })).toContain("持有上限");
  });
});

describe("待定 6：仅记录用的不回收时记沟通不强制下一步时间", () => {
  const 开了: 组织规则 = { ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 开: true, 节点天数: { 潜客培育: 7 }, 起算日: null } };
  const 也回收: 组织规则 = { ...开了, 超时回收: { ...开了.超时回收, 仅记录用也回收: true } };
  const 记 = { phase: "线索", node: "潜客培育", result: null, source: 仅记录用来源 };
  it("记沟通要下一步时间：仅记录用也回收 关着不要；开着要；推进出去的、普通的照要；超时回收整个关着都不要", () => {
    expect(记沟通要下一步时间(开了, 记)).toBe(false);
    expect(记沟通要下一步时间(也回收, 记)).toBe(true);
    expect(记沟通要下一步时间(开了, { ...记, node: "线索验证" })).toBe(true);
    expect(记沟通要下一步时间(开了, { ...记, source: null })).toBe(true);
    expect(记沟通要下一步时间(默认组织规则, { ...记, source: null })).toBe(false);
    expect(记沟通要下一步时间(开了, { ...记, source: null, result: "线索流失" })).toBe(false);
  });

  it("记项目沟通：仅记录用的不填下一步时间也能记；打开仅记录用也回收后照普通项目拦", async () => {
    await setSetting("orgRules", 开了);
    const p = await 记录用();
    const 沟通 = { type: "PHONE", content: "又问了一次价格", occurredAt: "2026-11-20 10:00", 阶段: "线索", 明确回复: true, 下一步: "下周再问" };
    const r = await 记项目沟通({ id: 王, role: "SALES" }, p.id, 沟通 as never);
    expect(r).toMatchObject({ ok: true });
    const 普 = await 建({ name: "普通" });
    expect(await 记项目沟通({ id: 王, role: "SALES" }, 普.id, 沟通 as never)).toMatchObject({ ok: false, error: expect.stringContaining("下一步") });
    await setSetting("orgRules", 也回收);
    invalidateSettingsCache();
    expect(await 记项目沟通({ id: 王, role: "SALES" }, p.id, 沟通 as never)).toMatchObject({ ok: false, error: expect.stringContaining("下一步") });
  });

  it("给客户建项目：勾着仅记录用、不回收时首条沟通不填下一步也能建；不勾照旧要填", async () => {
    await setSetting("orgRules", { ...开了, 阶段: { ...开了.阶段, 仅记录用: true } });
    const 建项目 = (仅记录用: boolean) => 给客户建项目({
      customerId: 客户,
      项目: { name: "为记沟通", amount: 0, currency: "CNY", ownerId: 王 },
      跟进: { type: "PHONE", content: "问了价格", occurredAt: "2026-11-20 10:00", 节点: "潜客培育" },
      仅记录用,
    });
    expect(await 建项目(true)).toMatchObject({ ok: true });
    expect(await 建项目(false)).toMatchObject({ ok: false, error: expect.stringContaining("下一步") });
  });
});
