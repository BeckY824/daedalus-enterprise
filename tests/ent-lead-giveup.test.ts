/**
 * 企业版主动放弃（豁免）（11-20 批次 32H，lib/enterprise/lead-giveup.ts）。钉的是：
 *   - 开关「主动放弃」默认关，关着不给入口、点了也不成
 *   - 只给新分配给我（市场分配、超时转来的）、我还没记有效沟通的；手动转让来的、自己建的、7 天前分的、记过沟通的不给
 *   - 每人每月 1 次（北京自然月）：第二次不成；下个月又能用；验证中不能点
 *   - 原因：只认 外出 / 忙不过来 / 其他（其他要写一句），说线索无效 / 质量不达标的不收、引去判无效
 *   - 点了：按超时转同一套挑人转本线下一位（排除自己），接手人照记一次本月已分（counted），放弃人原来那条照算；
 *     放弃人记 1 条待补，下一条自动分配先补给他（补发 counted = false）；接手人从放弃那一刻起按超时转计时；两边都收通知
 *   - 挑不到人：明确说转不出去，不扣次数、不记待补、负责人不动
 *   - 判无效线索被恢复只作废判无效记的待补，放弃记的不动；回收起点不认放弃转那行（同超时转）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则, 规则开着 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配线索 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key, 月份 } from "@/lib/enterprise/lead-assign";
import { 待补数们, 作废补位, 记补位 } from "@/lib/enterprise/invalid-makeup";
import { 超时转扫一遍, 超时转生效key, 超时通知种类 } from "@/lib/enterprise/reply-overdue";
import { 是超时自动转痕, 放弃转理由 } from "@/lib/project/timeout";
import {
  放弃线索, 放弃资格, 认放弃原因, 新分配时刻, 放弃原因们, 走判无效话, 本月用过话, 放弃通知种类, 在放弃窗口,
} from "@/lib/enterprise/lead-giveup";
import { 放弃线索Action } from "@/app/(app)/projects/[id]/giveup-actions";

/** 北京时间的一个瞬间 */
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人, 市场: 人, 甲: 人, 乙: 人, 丙: 人;
const 造人 = async (key: string, role: string, bizRole: string, line: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line } });
  return { id: u.id, name: key, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
let 序 = 0;
/**
 * 市场新建时直接分给 谁 的一条线索（只有一条分配记录，没有转让留痕；流转线内贸），分于 = 分配时刻（建档同一刻）。
 * 客户也给了 谁（市场首次分给销售客户随行）
 */
async function 分来的(谁: 人, 分于: Date, 补: Record<string, unknown> = {}) {
  序++;
  const cid = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `139${String(序).padStart(8, "0")}`, salesOwnerId: 谁.id } })).id;
  const p = await prisma.project.create({
    data: { name: `线索${序}`, customerId: cid, ownerId: 谁.id, creatorId: 市场.id, phase: "线索", node: "潜客培育", bizLine: "内贸", flowLine: "内贸", createdAt: 分于, ...补 },
  });
  await prisma.entLeadAssign.create({ data: { projectId: p.id, toUserId: 谁.id, fromUserId: 市场.id, byUserId: 市场.id, line: "内贸", month: 月份(分于), way: "自动分配", createdAt: 分于 } });
  return { id: p.id, customerId: cid };
}
const 项目 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, include: { customer: true } });
const 待补 = async (u: 人) => (await 待补数们([u.id])).get(u.id) ?? 0;
const 通知 = (userId: string) => prisma.entNotice.findMany({ where: { userId, kind: { not: "快轮到" } }, orderBy: { createdAt: "asc" } });
const 放弃 = (u: 人, id: string, 现在: Date, 原因: unknown = "外出", 补充: unknown = null) => 以(u, () => 放弃线索(u, id, 原因, 补充, 现在));
const 记沟通 = async (projectId: string, ownerId: string, content: string, at: Date) => {
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const f = await prisma.followUp.create({ data: { type: "PHONE", content, occurredAt: at, createdAt: at, title: "", status: "已完成", customerId: p.customerId, ownerId } });
  await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: p.node } });
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "ADMIN", "director");
  市场 = await 造人("mkt", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "SALES", "sales", "内贸");
  乙 = await 造人("yi", "SALES", "sales", "内贸");
  丙 = await 造人("bing", "SALES", "sales", "内贸");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(规则.主动放弃.key, true);
  await setSetting(不设配额key, true);
  await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止" });
  await setSetting(超时转生效key, 京("2026-01-01 00:00").toISOString());
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); invalidateSettingsCache(); });

describe("纯规则", () => {
  it("原因只认 外出 / 忙不过来 / 其他；选项里没有「线索无效 / 质量不达标」；说线索无效的引去判无效", () => {
    expect(放弃原因们).toEqual(["外出", "忙不过来", "其他"]);
    expect(放弃原因们.some((r) => /无效|质量|不达标/.test(r))).toBe(false);
    expect(认放弃原因("外出", null)).toMatchObject({ ok: true, 文字: "外出" });
    expect(认放弃原因("忙不过来", " 手上 20 条 ")).toMatchObject({ ok: true, 文字: "忙不过来：手上 20 条" });
    expect(认放弃原因("线索无效", null)).toEqual({ ok: false, error: 走判无效话 });
    expect(认放弃原因("质量不达标", null)).toEqual({ ok: false, error: 走判无效话 });
    expect(认放弃原因("其他", "号码是空号")).toEqual({ ok: false, error: 走判无效话 });
    expect(认放弃原因("其他", "线索质量不达标")).toEqual({ ok: false, error: 走判无效话 });
    expect(认放弃原因("其他", "  ")).toMatchObject({ ok: false });
    expect(认放弃原因("其他", "下午要去医院")).toMatchObject({ ok: true, 文字: "其他：下午要去医院" });
    expect(认放弃原因(undefined, null)).toMatchObject({ ok: false, error: "先选放弃原因" });
    expect(认放弃原因("其他", "字".repeat(101))).toMatchObject({ ok: false });
  });

  it("新分配时刻：市场直接分（只有分配记录）、分配入口的转让留痕（含超时转来）算；手动转让、自己领、自己建的不算", () => {
    const t = 京("2026-11-20 10:00");
    const 分 = [{ toUserId: "a", byUserId: "m", createdAt: t }];
    expect(新分配时刻("a", { ownerId: "a", creatorId: "m" }, [], 分)).toEqual(t);
    expect(新分配时刻("a", { ownerId: "a", creatorId: "a" }, [], [])).toBeNull();
    expect(新分配时刻("b", { ownerId: "a", creatorId: "m" }, [], 分)).toBeNull();
    const 痕 = (reason: string, userId = "system", toOwnerId = "a", kind = "transfer") => ({ kind, userId, reason, toOwnerId, at: 京("2026-11-20 11:00") });
    expect(新分配时刻("a", { ownerId: "a", creatorId: "m" }, [痕("分配方式：自动分配；超时未跟进自动转（原负责人 b 超时没记有效沟通）")], 分)).toEqual(京("2026-11-20 11:00"));
    expect(新分配时刻("a", { ownerId: "a", creatorId: "m" }, [痕("分配方式：指定分配", "m")], 分)).toEqual(京("2026-11-20 11:00"));
    expect(新分配时刻("a", { ownerId: "a", creatorId: "m" }, [痕("手动转让", "mgr")], 分)).toBeNull();
    expect(新分配时刻("a", { ownerId: "a", creatorId: "m" }, [痕("从线索公海分配", "mgr", "a", "pool-claim")], 分)).toBeNull();
    expect(新分配时刻("a", { ownerId: "a", creatorId: "m" }, [痕("分配方式：自动分配", "a")], 分)).toBeNull();
    expect(在放弃窗口(京("2026-11-13 10:00"), 京("2026-11-20 10:00"))).toBe(true);
    expect(在放弃窗口(京("2026-11-13 09:59"), 京("2026-11-20 10:00"))).toBe(false);
  });

  it("放弃转那行和超时转一样不重置回收起点", () => {
    expect(是超时自动转痕({ kind: "transfer", userId: "system", reason: `分配方式：自动分配；同事 甲 ${放弃转理由}转给你，原因：外出` })).toBe(true);
    expect(是超时自动转痕({ kind: "transfer", userId: "mgr", reason: `手动转让` })).toBe(false);
  });
});

describe("开关", () => {
  it("默认关：没拨过不给入口、点了也不成", async () => {
    await prisma.setting.deleteMany({ where: { key: 规则.主动放弃.key } });
    invalidateSettingsCache();
    expect(await 规则开着("主动放弃")).toBe(false);
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 以(甲, () => 放弃资格(甲, id, 京("2026-11-20 10:10")))).toBeNull();
    expect(await 放弃(甲, id, 京("2026-11-20 10:10"))).toMatchObject({ ok: false });
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect(await prisma.entLeadGiveUp.count()).toBe(0);
  });
});

describe("给不给入口", () => {
  it("新分配、没记沟通的给；7 天前分的、记过有效沟通的、别人记的不算（只认本人）、不是负责人的不给", async () => {
    const 现在 = 京("2026-11-20 10:10");
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 以(甲, () => 放弃资格(甲, id, 现在))).toMatchObject({ 可: true, 本月已用: false });
    expect(await 以(乙, () => 放弃资格(乙, id, 现在))).toBeNull();
    const 老 = await 分来的(甲, 京("2026-11-12 10:00"));
    expect(await 以(甲, () => 放弃资格(甲, 老.id, 现在))).toBeNull();
    // 别人（市场）记的沟通不算，照样给
    await 记沟通(id, 市场.id, "市场打过一次电话", 京("2026-11-20 10:05"));
    expect(await 以(甲, () => 放弃资格(甲, id, 现在))).toMatchObject({ 可: true });
    // 本人记了有效沟通：不给
    await 记沟通(id, 甲.id, "打通了，客户要报价", 京("2026-11-20 10:06"));
    expect(await 以(甲, () => 放弃资格(甲, id, 现在))).toBeNull();
    expect(await 放弃(甲, id, 现在)).toMatchObject({ ok: false });
  });

  it("自己建的、手动转让来的不给", async () => {
    const 现在 = 京("2026-11-20 10:10");
    const cid = (await prisma.customer.create({ data: { name: "自建客户", phone: "13900000999", salesOwnerId: 甲.id } })).id;
    const 自建 = await prisma.project.create({ data: { name: "自建", customerId: cid, ownerId: 甲.id, creatorId: 甲.id, phase: "线索", node: "潜客培育", bizLine: "内贸", createdAt: 京("2026-11-20 10:00") } });
    expect(await 以(甲, () => 放弃资格(甲, 自建.id, 现在))).toBeNull();
    const { id } = await 分来的(乙, 京("2026-11-20 09:00"));
    await prisma.project.update({ where: { id }, data: { ownerId: 甲.id } });
    await prisma.projectNodeLog.create({ data: { projectId: id, kind: "transfer", userId: 总管.id, fromOwnerId: 乙.id, toOwnerId: 甲.id, reason: "手动转让", fromPhase: "线索", fromNode: "潜客培育", toPhase: "线索", toNode: "潜客培育", at: 京("2026-11-20 10:00") } });
    expect(await 以(甲, () => 放弃资格(甲, id, 现在))).toBeNull();
  });

  it("验证中（X-77）：按钮灰着写为什么，点了不成、不扣次数", async () => {
    const 现在 = 京("2026-11-20 10:10");
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    await prisma.entLeadVerify.create({ data: { projectId: id, pending: "市场复核" } });
    const r = await 以(甲, () => 放弃资格(甲, id, 现在));
    expect(r).toMatchObject({ 可: false });
    expect(r?.为什么).toContain("验证中");
    expect(await 放弃(甲, id, 现在)).toMatchObject({ ok: false, error: expect.stringContaining("验证中") });
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect(await prisma.entLeadGiveUp.count()).toBe(0);
  });
});

describe("点了以后", () => {
  it("转本线下一位、接手人照记一次本月已分、放弃人原来那条照算、记 1 条待补、留痕、两边通知；夜里也立即转", async () => {
    const 现在 = 京("2026-11-20 23:10"); // 夜里
    const { id, customerId } = await 分来的(甲, 京("2026-11-20 23:00"));
    const r = await 放弃(甲, id, 现在, "忙不过来");
    expect(r).toMatchObject({ ok: true });
    const p = await 项目(id);
    // 照超时转挑人（本线、排除自己）：乙、丙里挑一位
    expect([乙.id, 丙.id]).toContain(p.ownerId);
    const 接 = p.ownerId === 乙.id ? 乙 : 丙;
    expect(r).toEqual({ ok: true, 接手人: 接.name });
    // 客户随线索（甲手上没这位客户别的项目）
    expect(p.customer.salesOwnerId).toBe(接.id);
    expect(await prisma.customerOwnerLog.findFirst({ where: { customerId }, select: { kind: true } })).toEqual({ kind: "overdue-assign" });
    // 分配记录：甲那条照算（counted 不改），接手人新记一条算数的（系统）
    const 分 = await prisma.entLeadAssign.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" }, select: { toUserId: true, byUserId: true, counted: true } });
    expect(分).toEqual([{ toUserId: 甲.id, byUserId: 市场.id, counted: true }, { toUserId: 接.id, byUserId: "system", counted: true }]);
    // 次数、待补
    const 行 = await prisma.entLeadGiveUp.findFirstOrThrow({ where: { userId: 甲.id } });
    expect(行).toMatchObject({ month: "2026-11", projectId: id, reason: "忙不过来", toUserId: 接.id });
    expect(await 待补(甲)).toBe(1);
    expect(await prisma.entLeadMakeup.findFirstOrThrow({ where: { userId: 甲.id } })).toMatchObject({ kind: "giveup", line: "内贸", projectId: id, id: 行.makeupId });
    // 留痕：项目节点记录一行转让（系统、原因写明主动放弃和原因）；操作日志在甲名下
    const 痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: id, kind: "transfer" } });
    expect(痕).toMatchObject({ userId: "system", fromOwnerId: 甲.id, toOwnerId: 接.id });
    expect(痕.reason).toContain(放弃转理由);
    expect(痕.reason).toContain("忙不过来");
    expect(await prisma.auditLog.findFirst({ where: { action: "giveup", entityId: id }, select: { userId: true, summary: true } }))
      .toMatchObject({ userId: 甲.id, summary: expect.stringContaining("主动放弃（豁免）") });
    // 通知：接手人收「分给你」，写明同事主动放弃；甲收确认
    const 接的 = await 通知(接.id);
    expect(接的.map((n) => n.kind)).toEqual(["自动分配"]);
    expect(接的[0].body).toContain("同事 jia 主动放弃（豁免）转给你");
    expect(接的[0].body).toContain("忙不过来");
    const 甲的 = await 通知(甲.id);
    expect(甲的.map((n) => n.kind)).toEqual([放弃通知种类]);
    expect(甲的[0].body).toContain(`已转给 ${接.name}`);
    expect(甲的[0].body).toContain("待补");
  });

  it("每人每月 1 次：第二条不成、不动；下个月（北京自然月）又能用", async () => {
    const a = await 分来的(甲, 京("2026-11-20 10:00"));
    const b = await 分来的(甲, 京("2026-11-20 10:01"));
    expect(await 放弃(甲, a.id, 京("2026-11-20 10:10"))).toMatchObject({ ok: true });
    expect(await 以(甲, () => 放弃资格(甲, b.id, 京("2026-11-20 10:11")))).toMatchObject({ 可: false, 为什么: 本月用过话, 本月已用: true });
    expect(await 放弃(甲, b.id, 京("2026-11-20 10:11"))).toEqual({ ok: false, error: 本月用过话 });
    expect((await 项目(b.id)).ownerId).toBe(甲.id);
    expect(await 待补(甲)).toBe(1);
    // 北京 12-01 00:05（伦敦 11-30 16:05）是下个月
    const c = await 分来的(甲, 京("2026-12-01 00:00"));
    expect(await 放弃(甲, c.id, 京("2026-12-01 00:05"))).toMatchObject({ ok: true });
    expect(await prisma.entLeadGiveUp.count({ where: { userId: 甲.id } })).toBe(2);
  });

  it("原因选「线索无效」这类不收，不动、不扣次数", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 放弃(甲, id, 京("2026-11-20 10:10"), "线索无效")).toEqual({ ok: false, error: 走判无效话 });
    expect(await 放弃(甲, id, 京("2026-11-20 10:10"), "其他", "质量不达标")).toEqual({ ok: false, error: 走判无效话 });
    expect((await 项目(id)).ownerId).toBe(甲.id);
    expect(await prisma.entLeadGiveUp.count()).toBe(0);
  });

  it("挑不到人：明确说转不出去，不扣次数、不记待补、负责人和客户不动", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止", [乙.id]: "禁止", [丙.id]: "禁止" });
    invalidateSettingsCache();
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    const r = await 放弃(甲, id, 京("2026-11-20 10:10"));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("这条转不出去") });
    expect(r.ok ? "" : r.error).toContain("没扣本月放弃次数");
    const p = await 项目(id);
    expect(p.ownerId).toBe(甲.id);
    expect(p.customer.salesOwnerId).toBe(甲.id);
    expect(await prisma.entLeadGiveUp.count()).toBe(0);
    expect(await 待补(甲)).toBe(0);
    expect(await prisma.entLeadAssign.count({ where: { projectId: id } })).toBe(1);
    // 次数还在：有人能接了照样能放弃
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止" });
    invalidateSettingsCache();
    expect(await 放弃(甲, id, 京("2026-11-20 10:11"))).toMatchObject({ ok: true });
  });

  it("待补：下一条自动分配先补给放弃人（补发不计本月已分），只补 1 条", async () => {
    // 乙、丙本月各 0 条，甲 1 条（放弃这条）→ 正常轮转不该先给甲
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 放弃(甲, id, new Date())).toMatchObject({ ok: true });
    const 新 = async () => {
      const cid = (await prisma.customer.create({ data: { name: `新客户${++序}`, phone: `137${String(序).padStart(8, "0")}`, salesOwnerId: 市场.id } })).id;
      return (await prisma.project.create({ data: { name: `新线索${序}`, customerId: cid, ownerId: 市场.id, creatorId: 市场.id, phase: "线索", node: "潜客培育", bizLine: "内贸" } })).id;
    };
    const N1 = await 新();
    expect(await 以(市场, () => 自动分配线索(N1, { 项目: true }))).toMatchObject({ ok: true, toUserId: 甲.id });
    expect(await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: N1 }, select: { counted: true } })).toEqual({ counted: false });
    expect(await 待补(甲)).toBe(0);
    // 只补 1 条：下一条按轮转，不再给甲
    const N2 = await 新();
    const r2 = await 以(市场, () => 自动分配线索(N2, { 项目: true }));
    expect(r2.ok && r2.toUserId).not.toBe(甲.id);
  });

  it("接手人从放弃那一刻起按超时转计时（同超时转来的）；放弃人记进这一轮，轮转不再给回他", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 15:00"));
    // 超时链已经在走（16:00 发了超时提醒），16:10 甲放弃
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    expect(await 放弃(甲, id, 京("2026-11-20 16:10"))).toMatchObject({ ok: true });
    const 接 = (await 项目(id)).ownerId;
    expect([乙.id, 丙.id]).toContain(接);
    const 链 = await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: id } });
    expect(链).toMatchObject({ holderId: 接, since: 京("2026-11-20 16:10"), overdueAt: null, stoppedAt: null });
    expect(JSON.parse(链.tried)).toContain(甲.id);
    // 原来 16:30 该转甲的那一步没了；接手人 17:10 提醒、17:40 转给剩下那位（不回甲）
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 17:09"))).toMatchObject({ 提醒: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 17:10"))).toMatchObject({ 提醒: 1 });
    expect((await prisma.entNotice.findMany({ where: { userId: 接, kind: 超时通知种类 } })).at(-1)?.body).toContain("接手已满 1 小时");
    expect(await 超时转扫一遍(京("2026-11-20 17:40"))).toMatchObject({ 转出: 1 });
    const 下 = (await 项目(id)).ownerId;
    expect(下).not.toBe(甲.id);
    expect(下).not.toBe(接);
  });

  it("没在走的超时链：接手人照样从放弃那一刻起算（不用原分配时刻）", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 15:00"));
    expect(await 放弃(甲, id, 京("2026-11-20 15:20"))).toMatchObject({ ok: true });
    // 留痕时刻改成放弃那一刻（写库用的是真钟）
    await prisma.projectNodeLog.updateMany({ where: { projectId: id, kind: "transfer" }, data: { at: 京("2026-11-20 15:20") } });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 16:20"))).toMatchObject({ 提醒: 1 });
  });

  it("放弃记的待补：判无效线索被恢复时不作废；放弃人以后在同一条上判无效照样能记判无效待补", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 放弃(甲, id, 京("2026-11-20 10:10"))).toMatchObject({ ok: true });
    expect(await 作废补位(prisma, id)).toBe(0);
    expect(await 待补(甲)).toBe(1);
    expect(await 记补位(prisma, 甲.id, id)).toBe(true);
    expect(await 待补(甲)).toBe(2);
  });

  it("动作入口：按登录的人放弃（不是负责人的点不成）", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    mocks.user = { ...乙 };
    expect(await 以谁的身份(乙.id, () => 放弃线索Action(id, "外出"))).toMatchObject({ ok: false });
    mocks.user = { ...甲 };
    // 真钟：分配时刻在 7 天窗口外的不给，这里把分配记录挪到现在
    await prisma.entLeadAssign.updateMany({ where: { projectId: id }, data: { createdAt: new Date() } });
    expect(await 以谁的身份(甲.id, () => 放弃线索Action(id, "外出"))).toMatchObject({ ok: true });
  });
});
