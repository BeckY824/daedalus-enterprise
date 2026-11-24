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

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null }, revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则, 规则开着 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配线索, 分配线索 } from "@/app/(app)/leads/assign-actions";
import { 分配通知 } from "@/lib/enterprise/notice-sources";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 自动分配不参与key, 不设配额key, 月份 } from "@/lib/enterprise/lead-assign";
import { 待补数们, 作废补位, 记补位 } from "@/lib/enterprise/invalid-makeup";
import { 超时转扫一遍, 超时转生效key, 超时通知种类, 改链若持有人是 } from "@/lib/enterprise/reply-overdue";
import { 是超时自动转痕, 放弃转理由 } from "@/lib/project/timeout";
import {
  放弃线索, 放弃资格, 认放弃原因, 新分配时刻, 放弃原因们, 走判无效话, 本月用过话, 放弃通知种类, 在放弃窗口, 放弃资格明细, 不给放弃话,
  我能放弃的, 首页放弃最多,
} from "@/lib/enterprise/lead-giveup";
import { 读我的通知 } from "@/app/(app)/notice-actions";
import { 指定回复提醒扫一遍 } from "@/lib/enterprise/reply-notice";
import { 放弃线索Action, 放弃说明Action } from "@/app/(app)/projects/[id]/giveup-actions";
import { 刷新页面 } from "@/lib/revalidate-safe";
import { 估算轮到, 轮到话 } from "@/lib/enterprise/assign-eta";
import { 读组织 } from "@/lib/enterprise/org";
import { 关掉后果 } from "@/lib/enterprise/rules-table";

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
async function 分来的(谁: 人, 分于: Date, 补: Record<string, unknown> = {}, o: { counted?: boolean } = {}) {
  序++;
  const cid = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `139${String(序).padStart(8, "0")}`, salesOwnerId: 谁.id } })).id;
  const p = await prisma.project.create({
    data: { name: `线索${序}`, customerId: cid, ownerId: 谁.id, creatorId: 市场.id, phase: "线索", node: "潜客培育", bizLine: "内贸", flowLine: "内贸", createdAt: 分于, ...补 },
  });
  await prisma.entLeadAssign.create({ data: { projectId: p.id, toUserId: 谁.id, fromUserId: 市场.id, byUserId: 市场.id, line: "内贸", month: 月份(分于), way: "自动分配", createdAt: 分于, counted: o.counted ?? true } });
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
    expect(r).toMatchObject({ ok: true, 接手人: 接.name });
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

  it("[审查 1] 没占名额的分配（counted=false：管理从公海分、企划不计数）不给放弃、不补；补发来的（counted=false 但用掉过待补）照给", async () => {
    const 现在 = 京("2026-11-20 10:10");
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"), {}, { counted: false });
    expect(await 以(甲, () => 放弃资格(甲, id, 现在))).toBeNull();
    expect(await 放弃(甲, id, 现在)).toMatchObject({ ok: false });
    expect(await 待补(甲)).toBe(0);
    expect((await 项目(id)).ownerId).toBe(甲.id);
    // 补发来的：分配记录 counted=false，但用掉过甲的一个待补在这条分配上
    const 补 = await 分来的(甲, 京("2026-11-20 10:01"), {}, { counted: false });
    const 记 = await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: 补.id } });
    await prisma.entLeadMakeup.create({ data: { userId: 甲.id, projectId: "坏线索", usedAt: 京("2026-11-20 10:01"), usedAssignId: 记.id, usedProjectId: 补.id } });
    expect(await 以(甲, () => 放弃资格(甲, 补.id, 现在))).toMatchObject({ 可: true });
  });

  it("[审查 2] 没起超时链就放弃：接手人再超时也不转回放弃人（同线只剩放弃人时留在接手人手上）", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止", [丙.id]: "禁止" });
    invalidateSettingsCache();
    const { id } = await 分来的(甲, 京("2026-11-20 15:00"));
    expect(await 放弃(甲, id, 京("2026-11-20 15:20"))).toMatchObject({ ok: true });
    expect(await prisma.entReplyOverdue.count({ where: { projectId: id } })).toBe(0);
    await prisma.projectNodeLog.updateMany({ where: { projectId: id, kind: "transfer" }, data: { at: 京("2026-11-20 15:20") } });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    expect(await 超时转扫一遍(京("2026-11-20 16:20"))).toMatchObject({ 提醒: 1 });
    await 超时转扫一遍(京("2026-11-20 16:50"));
    expect((await 项目(id)).ownerId).not.toBe(甲.id);
    expect((await 项目(id)).ownerId).toBe(乙.id);
  });

  it("[审查 2] 乙接手后也放弃：不转回甲（同线只剩甲时说转不出去、不扣乙的次数）；有丙就给丙", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止", [丙.id]: "禁止" });
    invalidateSettingsCache();
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 放弃(甲, id, 京("2026-11-20 10:10"))).toMatchObject({ ok: true });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    // 超时转出 按墙上时间记留痕和分配记录：挪回用例里的 10:10
    await prisma.projectNodeLog.updateMany({ where: { projectId: id, kind: "transfer" }, data: { at: 京("2026-11-20 10:10") } });
    await prisma.entLeadAssign.updateMany({ where: { projectId: id, toUserId: 乙.id }, data: { createdAt: 京("2026-11-20 10:10") } });
    const 转不出 = await 放弃(乙, id, 京("2026-11-20 10:20"));
    expect(转不出).toMatchObject({ ok: false, error: expect.stringContaining("这条转不出去") });
    // [实操 5] 只剩放弃过的人能接：不说「都暂停或禁止了」
    expect(转不出).toMatchObject({ error: expect.stringContaining("本线其他人都不能接（放弃过的人不会再分回）") });
    expect(转不出).not.toMatchObject({ error: expect.stringContaining("暂停或禁止") });
    expect((await 项目(id)).ownerId).toBe(乙.id);
    expect(await prisma.entLeadGiveUp.count({ where: { userId: 乙.id } })).toBe(0);
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止" });
    invalidateSettingsCache();
    expect(await 放弃(乙, id, 京("2026-11-20 10:21"))).toMatchObject({ ok: true, 接手人: "bing" });
  });

  it("[审查 a] 接手人的分配基准早于超时转生效时刻（这条不计时）：通知里不写「1 小时内记有效沟通」；计时的才写", async () => {
    const 老 = await 分来的(甲, 京("2026-11-20 10:00"));
    await setSetting(超时转生效key, 京("2026-11-20 10:05").toISOString());
    invalidateSettingsCache();
    expect(await 放弃(甲, 老.id, 京("2026-11-20 10:10"))).toMatchObject({ ok: true });
    const 接 = (await 项目(老.id)).ownerId;
    expect((await 通知(接)).at(-1)!.body).not.toContain("小时内记一条有效沟通");
    const 新 = await 分来的(乙, 京("2026-11-20 10:30"));
    expect(await 放弃(乙, 新.id, 京("2026-11-20 10:40"))).toMatchObject({ ok: true });
    const 接2 = (await 项目(新.id)).ownerId;
    expect((await 通知(接2)).at(-1)!.body).toContain("小时内记一条有效沟通");
  });

  it("[审查 c] 占次数时不是唯一键冲突的错：回「没放弃成」，不说本月用过", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    const 桩 = vi.spyOn(prisma.entLeadGiveUp, "create").mockRejectedValueOnce(new Error("disk I/O error"));
    try {
      const r = await 放弃(甲, id, 京("2026-11-20 10:10"));
      expect(r).toMatchObject({ ok: false });
      expect(r.ok ? "" : r.error).not.toBe(本月用过话);
      expect(r.ok ? "" : r.error).toContain("没放弃成");
    } finally { 桩.mockRestore(); }
    expect((await 项目(id)).ownerId).toBe(甲.id);
  });

  it("[审查 d] 超时链按「持有人还是原来那位」才写：放弃已经把链改给接手人，扫描拿着旧持有人写不进去", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 15:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    expect(await 放弃(甲, id, 京("2026-11-20 16:10"))).toMatchObject({ ok: true });
    const 接 = (await 项目(id)).ownerId;
    // 同一分钟里拿着放弃前读到的（持有人甲）去写：不覆盖
    expect(await 改链若持有人是(id, 甲.id, { anchorAt: 京("2026-11-20 15:00"), holderId: 甲.id, since: 京("2026-11-20 15:00"), overdueAt: 京("2026-11-20 16:10") })).toBe(false);
    expect(await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: id } })).toMatchObject({ holderId: 接, overdueAt: null });
    // 持有人对得上照写；没有链的照建
    expect(await 改链若持有人是(id, 接, { anchorAt: 京("2026-11-20 15:00"), holderId: 接, since: 京("2026-11-20 16:10"), overdueAt: 京("2026-11-20 17:10") })).toBe(true);
    const 别的 = await 分来的(乙, 京("2026-11-20 15:00"));
    expect(await 改链若持有人是(别的.id, 乙.id, { anchorAt: 京("2026-11-20 15:00"), holderId: 乙.id, since: 京("2026-11-20 15:00"), overdueAt: null })).toBe(true);
  });
});

describe("3703 实操 r22", () => {
  it("[实操 1] 放弃这条路不调 revalidatePath（动作里 revalidate 会连带重画当前页，转走后落到「找不到」）；别处照常刷新", async () => {
    const { id } = await 分来的(甲, new Date());
    mocks.revalidatePath.mockClear();
    mocks.user = { ...甲 };
    expect(await 以谁的身份(甲.id, () => 放弃线索Action(id, "外出"))).toMatchObject({ ok: true });
    expect((await 项目(id)).ownerId).not.toBe(甲.id);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    刷新页面("/leads");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads");
  });

  it("[实操 4] 放弃资格看「是不是本线自动分配候选」：内贸纯销售管理（不兼销售）给；外贸销售管理在外贸线上也给（11-23）、在内贸线上不给；外贸销售照给", async () => {
    const 内管 = await 造人("neiguan", "SALES", "sales_mgr", "内贸");
    const 外管 = await 造人("waiguan", "SALES", "sales_mgr", "外贸");
    const 外销 = await 造人("waixiao", "SALES", "sales", "外贸");
    const 现在 = 京("2026-11-20 10:10");
    const 内 = await 分来的(内管 as 人, 京("2026-11-20 10:00"));
    expect(await 以(内管, () => 放弃资格(内管, 内.id, 现在))).toMatchObject({ 可: true });
    const 外 = await 分来的(外管, 京("2026-11-20 10:00"), { bizLine: "外贸", flowLine: "外贸" });
    expect(await 以(外管, () => 放弃资格(外管, 外.id, 现在))).toMatchObject({ 可: true });
    // 不混线：外贸销售管理拿着一条内贸流转线的线索，不是内贸线的候选，不给
    const 外在内 = await 分来的(外管, 京("2026-11-20 10:00"), { bizLine: "内贸", flowLine: "内贸" });
    expect(await 以(外管, () => 放弃资格(外管, 外在内.id, 现在))).toBeNull();
    const 外2 = await 分来的(外销, 京("2026-11-20 10:00"), { bizLine: "外贸", flowLine: "外贸" });
    expect(await 以(外销, () => 放弃资格(外销, 外2.id, 现在))).toMatchObject({ 可: true });
    // 内贸销售管理点了照常转给本线下一位
    expect(await 放弃(内管, 内.id, 现在)).toMatchObject({ ok: true });
    expect((await 项目(内.id)).ownerId).not.toBe(内管.id);
  });

  it("[实操 5] 进程变更那一行写第三人称「X 主动放弃（豁免），原因：…，转给 Y」；接手人通知照写「同事 X … 转给你」", async () => {
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    const r = await 放弃(甲, id, 京("2026-11-20 10:10"), "其他", "下午去医院");
    expect(r).toMatchObject({ ok: true });
    const 接 = r.ok ? r.接手人 : "";
    const 行 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: id, kind: "transfer" } });
    expect(行.reason).toContain(`jia 主动放弃（豁免），原因：其他：下午去医院，转给 ${接}`);
    expect(行.reason).not.toContain("转给你");
    expect(行.reason?.startsWith("分配方式：")).toBe(true);
    const 收 = await 通知((await 项目(id)).ownerId);
    expect(收.map((n) => n.body).join("\n")).toContain("同事 jia 主动放弃（豁免）转给你");
  });

  it("[实操 5] 快轮到：放弃记的待补写「放弃记的待补 N 条」，判无效的写「判无效待补」，两种都有分开写", async () => {
    expect(轮到话({ 数: 0, 待补: 1, 放弃待补: 1 })).toBe("下一条就轮到你（放弃记的待补 1 条，优先补）");
    expect(轮到话({ 数: 0, 待补: 1 })).toBe("下一条就轮到你（判无效待补 1 条，优先补）");
    expect(轮到话({ 数: 0, 待补: 3, 放弃待补: 1 })).toBe("下一条就轮到你（判无效待补 2 条、放弃记的待补 1 条，优先补）");
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 放弃(甲, id, 京("2026-11-20 10:10"))).toMatchObject({ ok: true });
    const 估 = (await 估算轮到(await 读组织())).get(甲.id);
    expect(估).toMatchObject({ 待补: 1, 放弃待补: 1 });
    expect(轮到话(估!)).toContain("放弃记的待补 1 条");
    expect(轮到话(估!)).not.toContain("判无效");
  });

  it("[实操 5] 开关文案：说明里按钮叫「放弃（豁免）」；关掉后果写明按钮不出、已转出的不收回、待补照补", () => {
    expect(规则.主动放弃.说明).toContain("「放弃（豁免）」");
    expect(规则.主动放弃.说明).not.toContain("点「放弃」");
    expect(关掉后果.主动放弃).toMatch(/不再出.*放弃（豁免）/);
    expect(关掉后果.主动放弃).toContain("不收回");
    expect(关掉后果.主动放弃).toContain("待补");
  });
});

describe("[11-21] 通知直达放弃：分到我的线索、超时提醒的链接带不带 ?giveup=1", () => {
  /** 市场名下一条新线索（还没分） */
  const 新线索 = async () => {
    const cid = (await prisma.customer.create({ data: { name: `待分客户${++序}`, phone: `136${String(序).padStart(8, "0")}`, salesOwnerId: 市场.id } })).id;
    return (await prisma.project.create({ data: { name: `待分线索${序}`, customerId: cid, ownerId: 市场.id, creatorId: 市场.id, phase: "线索", node: "潜客培育", bizLine: "内贸", flowLine: "内贸" } })).id;
  };
  const 那条通知 = async (userId: string, kind: string) => {
    await 等通知推完();
    return prisma.entNotice.findFirstOrThrow({ where: { userId, kind }, orderBy: { createdAt: "desc" } });
  };
  const 用过本月 = (u: 人) => prisma.entLeadGiveUp.create({ data: { userId: u.id, month: 月份(new Date()), projectId: "x", reason: "外出" } });

  it("自动分配：开关开、能放弃 → 带；开关关 → 不带", async () => {
    const N = await 新线索();
    const r = await 以(市场, () => 自动分配线索(N, { 项目: true }));
    expect(r).toMatchObject({ ok: true });
    const 收 = (r as { toUserId: string }).toUserId;
    expect((await 那条通知(收, "自动分配")).link).toBe(`/projects/${N}?giveup=1`);
    await setSetting(规则.主动放弃.key, false);
    invalidateSettingsCache();
    const N2 = await 新线索();
    const r2 = await 以(市场, () => 自动分配线索(N2, { 项目: true }));
    expect(r2).toMatchObject({ ok: true });
    const 收2 = (r2 as { toUserId: string }).toUserId;
    expect((await 那条通知(收2, "自动分配")).link).toBe(`/projects/${N2}`);
  });

  it("指定分配：能放弃 → 带；本月用过（点不了）→ 不带", async () => {
    const N = await 新线索();
    expect(await 以(市场, () => 分配线索({ projectId: N, toUserId: 甲.id }))).toMatchObject({ ok: true });
    expect((await 那条通知(甲.id, "分配")).link).toBe(`/projects/${N}?giveup=1`);
    await 用过本月(乙);
    const N2 = await 新线索();
    expect(await 以(市场, () => 分配线索({ projectId: N2, toUserId: 乙.id }))).toMatchObject({ ok: true });
    expect((await 那条通知(乙.id, "分配")).link).toBe(`/projects/${N2}`);
  });

  it("同事放弃转来（超时转来同一条路：超时转出 + 分配通知）：接手人那条带；一条通知里几条线索的（去 /leads）不带", async () => {
    const { id } = await 分来的(甲, new Date(Date.now() - 5 * 60_000));
    expect(await 放弃(甲, id, new Date())).toMatchObject({ ok: true });
    const 接 = (await 项目(id)).ownerId;
    expect((await 那条通知(接, "自动分配")).link).toBe(`/projects/${id}?giveup=1`);
    const a = await 分来的(丙, new Date());
    const b = await 分来的(丙, new Date());
    await 分配通知(市场, [{ projectId: a.id, toUserId: 丙.id }, { projectId: b.id, toUserId: 丙.id }], false);
    expect((await 那条通知(丙.id, "分配")).link).toBe("/leads");
  });

  it("超时提醒（给负责人「快超时了」那条）：能放弃 → 带；本月用过 → 不带；开关关 → 不带", async () => {
    const a = await 分来的(甲, 京("2026-11-20 15:00"));
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    expect((await 那条通知(甲.id, 超时通知种类)).link).toBe(`/projects/${encodeURIComponent(a.id)}?giveup=1`);
    await prisma.entLeadGiveUp.create({ data: { userId: 乙.id, month: "2026-11", projectId: "x", reason: "外出" } });
    const b = await 分来的(乙, 京("2026-11-20 15:30"));
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 提醒: 1 });
    expect((await 那条通知(乙.id, 超时通知种类)).link).toBe(`/projects/${encodeURIComponent(b.id)}`);
    await setSetting(规则.主动放弃.key, false);
    invalidateSettingsCache();
    const c = await 分来的(丙, 京("2026-11-20 15:40"));
    expect(await 超时转扫一遍(京("2026-11-20 16:40"))).toMatchObject({ 提醒: 1 });
    expect((await 那条通知(丙.id, 超时通知种类)).link).toBe(`/projects/${encodeURIComponent(c.id)}`);
  });

  it("放弃资格明细：不给时说为什么（没开 / 不在手上 / 不是新分配 / 过了 7 天 / 记过有效沟通）；放弃说明Action 照回", async () => {
    const 现在 = 京("2026-11-20 10:10");
    const { id } = await 分来的(甲, 京("2026-11-20 10:00"));
    expect(await 放弃资格明细(甲, id, 现在)).toMatchObject({ 资格: { 可: true } });
    expect(await 放弃资格明细(乙, id, 现在)).toEqual({ 不给: 不给放弃话.不在手上 });
    expect(await 放弃资格明细(甲, "没有这条", 现在)).toEqual({ 不给: 不给放弃话.不在手上 });
    const 老 = await 分来的(甲, 京("2026-11-12 10:00"));
    expect(await 放弃资格明细(甲, 老.id, 现在)).toEqual({ 不给: 不给放弃话.过了窗口 });
    const cid = (await prisma.customer.create({ data: { name: "自建客户2", phone: "13900000998", salesOwnerId: 甲.id } })).id;
    const 自建 = await prisma.project.create({ data: { name: "自建2", customerId: cid, ownerId: 甲.id, creatorId: 甲.id, phase: "线索", node: "潜客培育", bizLine: "内贸", createdAt: 京("2026-11-20 10:00") } });
    expect(await 放弃资格明细(甲, 自建.id, 现在)).toEqual({ 不给: 不给放弃话.不是新分配 });
    await 记沟通(id, 甲.id, "打通了，客户要报价", 京("2026-11-20 10:06"));
    expect(await 放弃资格明细(甲, id, 现在)).toEqual({ 不给: 不给放弃话.记过沟通 });
    // 动作按登录的人、真钟：分来的那条（真钟里刚分）
    const 新 = await 分来的(乙, new Date(Date.now() - 60_000));
    mocks.user = { ...乙 };
    expect(await 以谁的身份(乙.id, () => 放弃说明Action(新.id))).toEqual({ 可: true });
    mocks.user = { ...甲 };
    expect(await 以谁的身份(甲.id, () => 放弃说明Action(新.id))).toEqual({ 可: false, 话: 不给放弃话.不在手上 });
    await setSetting(规则.主动放弃.key, false);
    invalidateSettingsCache();
    expect(await 放弃资格明细(甲, id, 现在)).toEqual({ 不给: 不给放弃话.没开 });
  });
});

describe("[11-21] 首页置顶条、铃铛按钮：此刻能放弃的才出（我能放弃的，只查本人、一批判）", () => {
  it("有资格的出、带离超时还剩多久；记过沟通 / 自己建的 / 过了 7 天 / 别人的不出；按接手先后新的在前", async () => {
    const 现在 = 京("2026-11-20 15:10");
    const a = await 分来的(甲, 京("2026-11-20 15:00"));
    const b = await 分来的(甲, 京("2026-11-20 14:50"));
    const 记过 = await 分来的(甲, 京("2026-11-20 14:00"));
    await 记沟通(记过.id, 甲.id, "打通了，客户要报价", 京("2026-11-20 14:05"));
    await 分来的(甲, 京("2026-11-12 10:00")); // 过了 7 天
    await 分来的(乙, 京("2026-11-20 15:00")); // 别人的
    const cid = (await prisma.customer.create({ data: { name: "自建客户9", phone: "13900000997", salesOwnerId: 甲.id } })).id;
    await prisma.project.create({ data: { name: "自建9", customerId: cid, ownerId: 甲.id, creatorId: 甲.id, phase: "线索", node: "潜客培育", bizLine: "内贸", createdAt: 京("2026-11-20 15:00") } });
    const 们 = await 我能放弃的(甲, 现在);
    expect(们.map((x) => x.projectId)).toEqual([a.id, b.id]);
    expect(们[0]).toMatchObject({ name: expect.stringMatching(/^线索/), 接手于: 京("2026-11-20 15:00").toISOString() });
    // 超时链还没起（钟没扫到，到点才写链）：按分配基准算，15:00 分的 16:00 超时
    expect(们[0].时限话).toBe("还剩 50 分钟 超时");
    expect(们[1].时限话).toBe("还剩 40 分钟 超时");
    // 超时转关着（不计时）：按放弃窗口还剩多久说
    await setSetting(规则.超时自动转.key, false);
    invalidateSettingsCache();
    expect((await 我能放弃的(甲, 现在))[0].时限话).toBe("还剩 6 天 23 小时 可放弃");
  });

  it("超时链在走：还剩多久超时；发过超时提醒：已超时、还剩多久自动转走", async () => {
    const a = await 分来的(甲, 京("2026-11-20 15:00"));
    await 超时转扫一遍(京("2026-11-20 15:05"));
    expect((await 我能放弃的(甲, 京("2026-11-20 15:10")))[0]).toMatchObject({ projectId: a.id, 时限话: "还剩 50 分钟 超时" });
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 1 });
    expect((await 我能放弃的(甲, 京("2026-11-20 16:05")))[0]).toMatchObject({ projectId: a.id, 时限话: "已超时，还剩 25 分钟 自动转走" });
  });

  it("开关关 / 本月用过 / 切换视图 / 只读身份：一条都没有；最多摆 首页放弃最多 条", async () => {
    const 现在 = 京("2026-11-20 15:10");
    for (let i = 0; i < 首页放弃最多 + 2; i++) await 分来的(甲, 京("2026-11-20 15:00"));
    expect(await 我能放弃的(甲, 现在)).toHaveLength(首页放弃最多);
    expect(await 我能放弃的(甲, 现在, 50)).toHaveLength(首页放弃最多 + 2);
    expect(await 我能放弃的({ id: 甲.id, 视图由: { id: 总管.id, name: 总管.name } }, 现在)).toEqual([]);
    await prisma.entLeadGiveUp.create({ data: { userId: 甲.id, month: "2026-11", projectId: "x", reason: "外出" } });
    expect(await 我能放弃的(甲, 现在)).toEqual([]);
    await 分来的(乙, 京("2026-11-20 15:00"));
    expect(await 我能放弃的(乙, 现在)).toHaveLength(1);
    await setSetting(规则.主动放弃.key, false);
    invalidateSettingsCache();
    expect(await 我能放弃的(乙, 现在)).toEqual([]);
    await setSetting(规则.主动放弃.key, true);
    invalidateSettingsCache();
    await prisma.entMember.update({ where: { userId: 乙.id }, data: { bizRole: "admin" } });
    忘掉企业版范围();
    expect(await 我能放弃的(乙, 现在)).toEqual([]);
  });

  it("验证中的那条不出（点不了的不摆）；同一批里别的照出", async () => {
    const 现在 = 京("2026-11-20 15:10");
    const a = await 分来的(甲, 京("2026-11-20 15:00"));
    const b = await 分来的(甲, 京("2026-11-20 15:01"));
    await prisma.entLeadVerify.create({ data: { projectId: b.id, pending: "市场复核" } });
    expect((await 我能放弃的(甲, 现在)).map((x) => x.projectId)).toEqual([a.id]);
    expect(await 放弃资格(甲, b.id, 现在)).toMatchObject({ 可: false, 为什么: expect.stringContaining("验证中") });
  });

  it("铃铛：带放弃链接、此刻还能放弃的那条给 放弃项目；能放弃变不能（记了沟通）的、不带链接的不给", async () => {
    const a = await 分来的(甲, new Date(Date.now() - 5 * 60_000));
    const b = await 分来的(甲, new Date(Date.now() - 5 * 60_000));
    await 记沟通(b.id, 甲.id, "打通了，客户要报价", new Date(Date.now() - 60_000));
    const 发 = (key: string, link: string) => prisma.entNotice.create({ data: { userId: 甲.id, kind: "自动分配", title: key, link, dedupeKey: key, feishuStatus: "没推" } });
    await 发("n1", `/projects/${a.id}?giveup=1`);
    await 发("n2", `/projects/${b.id}?giveup=1`);
    await 发("n3", `/projects/${a.id}`);
    await 发("n4", "/leads");
    mocks.user = { ...甲 };
    const { 行们 } = await 以谁的身份(甲.id, () => 读我的通知());
    const 按 = Object.fromEntries(行们.map((r) => [r.title, r.放弃项目 ?? null]));
    expect(按).toEqual({ n1: a.id, n2: null, n3: null, n4: null });
    // 开关关了：都不给
    await setSetting(规则.主动放弃.key, false);
    invalidateSettingsCache();
    const 关后 = await 以谁的身份(甲.id, () => 读我的通知());
    expect(关后.行们.every((r) => !r.放弃项目)).toBe(true);
  });
});

describe("[11-21 审查] 指定回复提醒也带放弃链接；首页候选按分配时间；放弃结果带客户", () => {
  it("指定回复提醒（线索的再次提醒）：发给负责人、能放弃 → 带；本月用过 → 不带；开关关 → 不带", async () => {
    const 提醒链接 = async (u: 人) => (await prisma.entNotice.findFirstOrThrow({ where: { userId: u.id, kind: "指定回复" }, orderBy: { createdAt: "desc" } })).link;
    const a = await 分来的(甲, 京("2026-11-20 14:00"), { replyStartAt: 京("2026-11-20 15:00") });
    expect(await 指定回复提醒扫一遍(京("2026-11-20 14:30"))).toBe(1);
    expect(await 提醒链接(甲)).toBe(`/projects/${encodeURIComponent(a.id)}?giveup=1`);
    await prisma.entLeadGiveUp.create({ data: { userId: 乙.id, month: "2026-11", projectId: "x", reason: "外出" } });
    const b = await 分来的(乙, 京("2026-11-20 14:00"), { replyStartAt: 京("2026-11-20 15:10") });
    expect(await 指定回复提醒扫一遍(京("2026-11-20 14:40"))).toBe(1);
    expect(await 提醒链接(乙)).toBe(`/projects/${encodeURIComponent(b.id)}`);
    await setSetting(规则.主动放弃.key, false);
    invalidateSettingsCache();
    const c = await 分来的(丙, 京("2026-11-20 14:00"), { replyStartAt: 京("2026-11-20 15:20") });
    expect(await 指定回复提醒扫一遍(京("2026-11-20 14:50"))).toBe(1);
    expect(await 提醒链接(丙)).toBe(`/projects/${encodeURIComponent(c.id)}`);
  });

  it("首页候选按分配时间倒序：新建早、最近才分来的排得进（不按项目建档先后截）", async () => {
    const 现在 = 京("2026-11-20 15:10");
    for (let i = 0; i < 4; i++) await 分来的(甲, 京("2026-11-20 14:00"));
    const 老 = await 分来的(甲, 京("2026-11-20 15:00"), { createdAt: 京("2026-11-10 10:00") });
    expect((await 我能放弃的(甲, 现在, 1)).map((x) => x.projectId)).toEqual([老.id]);
  });

  it("[审查 4] 首页候选同一时刻分来的：顺序固定（按项目 id 倒序），和建档先后无关", async () => {
    const 现在 = 京("2026-11-20 15:10");
    const 同时 = 京("2026-11-20 15:00");
    for (const id of ["giveup-tie-a", "giveup-tie-c", "giveup-tie-b"]) await 分来的(甲, 同时, { id });
    expect((await 我能放弃的(甲, 现在)).map((x) => x.projectId)).toEqual(["giveup-tie-c", "giveup-tie-b", "giveup-tie-a"]);
    expect((await 我能放弃的(甲, 现在, 2)).map((x) => x.projectId)).toEqual(["giveup-tie-c", "giveup-tie-b"]);
  });

  it("放弃成了回客户 id、客户去向（铃铛判当前页要不要离开）", async () => {
    const { id, customerId } = await 分来的(甲, new Date(Date.now() - 5 * 60_000));
    expect(await 放弃(甲, id, new Date())).toMatchObject({ ok: true, customerId, 客户去向: "跟着走" });
  });
});
