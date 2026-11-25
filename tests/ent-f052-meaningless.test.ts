/**
 * F-052 无意义沟通不能保存（11-25 客户定「判为无意义就不能提交」，一期落「不足 4 个字不能提交」）：
 *   - 判沟通无意义：一期判据沿用 无效沟通原因of，只有「空」「太短」算无意义；占位词、只有链接照存只提示；任务 / 提醒、同号留痕不判
 *   - 沟通意义提示（填写时那一行）：空不出；开关开着说不能保存、还差几个字；关着说不算有效沟通
 *   - 服务端：saveFollowUp、记项目沟通Action 开关开着（默认）拦下不存；关着照存；改已有的只在内容改了时拦；带速记原文（AI 解析）的同样照最后存进去的内容判
 *   - 开关表：组织规则「无意义沟通拦」默认开，总览有这一项
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则, 规则开着, 默认开的规则 } from "@/lib/enterprise/rules";
import { 占位词键, 判沟通无意义, 沟通意义提示, 无意义不能存话 } from "@/lib/enterprise/tri-state-quota";
import { 有效沟通标准话 } from "@/lib/enterprise/reply-overdue";
import { 开关of } from "@/lib/enterprise/switch-table";
import { 规整判定 } from "@/components/FollowMeaningLine";
import { saveFollowUp, 沟通可选项目 } from "@/app/(app)/customers/[id]/actions";
import { 记项目沟通Action } from "@/app/(app)/projects/actions";
import { 沟通判定须知 } from "@/app/(app)/follow-method-actions";
import { 沟通项目在公海话 } from "@/lib/project/follow-needs-project-text";

describe("判沟通无意义（一期判据：不足 4 个字）", () => {
  it("太短、空 = 无意义，带还差几个字；有效的、占位词、只有链接不算无意义", () => {
    expect(判沟通无意义("开店", "PHONE")).toEqual({ 无意义: true, 种: "太短", 还差: 2 });
    expect(判沟通无意义("开店。！", "PHONE")).toMatchObject({ 无意义: true, 还差: 2 });
    expect(判沟通无意义("  ", "PHONE")).toMatchObject({ 无意义: true, 种: "空" });
    expect(判沟通无意义("开店的事", "PHONE")).toEqual({ 无意义: false, 种: null, 还差: 0 });
    expect(判沟通无意义("Called him back", "PHONE").无意义).toBe(false);
    expect(判沟通无意义("Call", "PHONE")).toMatchObject({ 无意义: true, 还差: 4 });
    expect(判沟通无意义("跟进跟进", "PHONE")).toMatchObject({ 无意义: false, 种: "占位词" });
    expect(判沟通无意义("https://pan.example.com/s/abc", "OTHER")).toMatchObject({ 无意义: false, 种: "只有链接" });
    // 自定义占位词表
    expect(判沟通无意义("开店开店", "PHONE", { 占位词: ["开店"] })).toMatchObject({ 无意义: false, 种: "占位词" });
  });

  it("边界：「ok」「👍👍」「123」「开店ok」拦，「ok fine」放，「11」是占位词照存", () => {
    expect(判沟通无意义("ok", "PHONE")).toMatchObject({ 无意义: true, 种: "太短" });
    expect(判沟通无意义("ok fine", "PHONE")).toEqual({ 无意义: false, 种: null, 还差: 0 });
    expect(判沟通无意义("👍👍", "PHONE")).toMatchObject({ 无意义: true, 种: "太短", 还差: 4 });
    expect(判沟通无意义("123", "PHONE")).toMatchObject({ 无意义: true, 种: "太短" });
    expect(判沟通无意义("开店ok", "PHONE")).toMatchObject({ 无意义: true, 种: "太短", 还差: 2 });
    expect(沟通意义提示("开店ok", "PHONE", { 拦: true })).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 2 个字（或写满 2 个英文单词）");
    expect(判沟通无意义("11", "PHONE")).toMatchObject({ 无意义: false, 种: "占位词" });
  });

  it("跟进任务 / 提醒、同号再次录入留痕不判", () => {
    expect(判沟通无意义("开店", "TASK")).toEqual({ 无意义: false, 种: null, 还差: 0 });
    expect(判沟通无意义("开店", "REMIND").无意义).toBe(false);
    expect(判沟通无意义("开店", "PHONE", { 标题: "同号再次录入（来源不同）" }).无意义).toBe(false);
  });
});

describe("沟通意义提示（填写时那一行）", () => {
  it("空内容不出；开关开着说不能保存、还差几个字；关着说不算有效沟通", () => {
    expect(沟通意义提示("", "PHONE", { 拦: true })).toBeNull();
    expect(沟通意义提示("   ", "PHONE", { 拦: true })).toBeNull();
    expect(沟通意义提示("开店", "PHONE", { 拦: true })).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 2 个字");
    expect(沟通意义提示("开店", "PHONE", { 拦: false })).toBe("不足 4 个字，还差 2 个字，不算有效沟通");
    expect(沟通意义提示("Call", "PHONE", { 拦: true })).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 4 个字（或写满 2 个英文单词）");
    expect(沟通意义提示("客户要报价单", "PHONE", { 拦: true })).toBeNull();
  });

  it("占位词、只有链接不拦：开着关着都只说不算有效沟通；任务 / 提醒不出", () => {
    expect(沟通意义提示("跟进跟进", "PHONE", { 拦: true })).toBe("只有「跟进」「已联系」这类占位词，不算有效沟通");
    expect(沟通意义提示("https://pan.example.com/s/abc", "OTHER", { 拦: true })).toBe("只有链接、没有文字，不算有效沟通");
    expect(沟通意义提示("开店", "TASK", { 拦: true })).toBeNull();
    expect(沟通意义提示("开店", "REMIND", { 拦: false })).toBeNull();
  });

  it("服务端拦下那句同一个说法；规整判定接得住 UI 桩回的 {ok:true}", () => {
    expect(无意义不能存话("开店", 判沟通无意义("开店", "PHONE"))).toBe("这样写会被判为无意义，不能保存：不足 4 个字，还差 2 个字。请写清沟通内容");
    expect(规整判定({ ok: true })).toBeNull();
    expect(规整判定({ 拦: false, 占位词: ["跟进", 3] })).toEqual({ 拦: false, 占位词: ["跟进"] });
  });

  it("超时提醒那半句：开着说太短的存不进去、占位词能存但不算，关着说字数和占位词", () => {
    expect(有效沟通标准话(true)).toBe("（写清沟通内容：太短的存不进去；只写「跟进」「已联系」这类的能存但不算）");
    expect(有效沟通标准话(false)).toBe("（写清沟通内容，中文至少 4 个字；「跟进」「已联系」这类不算）");
  });
});

type 人 = { id: string; name: string };
let 老板: 人, 甲: 人;
let 序 = 0;
const 造人 = async (email: string, name: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
};
/** 甲名下一条线索项目（客户也归甲） */
async function 线索() {
  序++;
  const c = await prisma.customer.create({ data: { name: `虚构客户${序}`, phone: `1380000${String(序).padStart(4, "0")}`, salesOwnerId: 甲.id } });
  const p = await prisma.project.create({ data: { name: `线索${序}`, customerId: c.id, ownerId: 甲.id, creatorId: 甲.id, phase: "线索", node: "潜客培育", bizLine: "内贸" } });
  return { id: p.id, customerId: c.id };
}
const 现在 = () => new Date().toISOString();
const 记客户 = (a: { id: string; customerId: string }, content: string, 另: Record<string, unknown> = {}) =>
  saveFollowUp({ customerId: a.customerId, projectId: a.id, type: "PHONE", title: "", content, status: "已完成", occurredAt: 现在(), ...另 });
const 记项目 = (a: { id: string }, content: string, type = "PHONE") =>
  记项目沟通Action(a.id, { type, content, occurredAt: 现在(), 阶段: "线索", 下一步: "明天再打一次", 下一步时间: null });
const 条数 = (customerId: string) => prisma.followUp.count({ where: { customerId } });

describe("服务端拦（企业版）", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    老板 = await 造人("boss", "老板");
    甲 = await 造人("jia", "销售甲");
    await prisma.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 甲.id, bizRole: "sales", line: "内贸" }] });
    await setSetting("business", { projectMode: true });
    invalidateSettingsCache();
    mocks.user = { ...mocks.user, id: 甲.id, name: 甲.name };
  });
  afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); invalidateSettingsCache(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("开关没拨过 = 开着（默认开的规则）；总览表里默认值也是开", async () => {
    expect(默认开的规则).toContain("无意义沟通拦");
    expect(await 规则开着("无意义沟通拦")).toBe(true);
    expect(开关of.block_meaningless.默认).toBe(true);
    expect(开关of.block_meaningless.名).toBe(规则.无意义沟通拦.名);
  });

  it("客户页记跟进（saveFollowUp）：「开店」拦下不存、回原因；写够 4 个字照存；占位词、任务照存", async () => {
    const a = await 线索();
    const r = await 记客户(a, "开店");
    expect(r).toMatchObject({ ok: false, error: "这样写会被判为无意义，不能保存：不足 4 个字，还差 2 个字。请写清沟通内容", 无意义: true });
    expect(await 条数(a.customerId)).toBe(0);
    expect((await 记客户(a, "开店的事聊了")).ok).toBe(true);
    expect((await 记客户(a, "已联系")).ok).toBe(true);
    expect((await saveFollowUp({ customerId: a.customerId, type: "TASK", title: "回电", content: "回电", status: "已完成", occurredAt: 现在() })).ok).toBe(true);
    expect(await 条数(a.customerId)).toBe(3);
  });

  it("项目页记沟通（记项目沟通Action，回收预警 / 首页 AI 项目卡同走）：拦下不存", async () => {
    const a = await 线索();
    const r = await 记项目(a, "开店");
    expect(r).toMatchObject({ ok: false, 无意义: true });
    expect(await 条数(a.customerId)).toBe(0);
    expect((await 记项目(a, "电话聊了开店的预算")).ok).toBe(true);
    expect(await 条数(a.customerId)).toBe(1);
  });

  it("开关关着：照存（回到照存 + 轻提示）", async () => {
    await setSetting(规则.无意义沟通拦.key, false);
    invalidateSettingsCache();
    const a = await 线索();
    expect((await 记客户(a, "开店")).ok).toBe(true);
    expect((await 记项目(a, "开店")).ok).toBe(true);
    expect(await 条数(a.customerId)).toBe(2);
  });

  it("改已有的：内容没动的老短记录照存；改成太短的拦下、库里原样", async () => {
    await setSetting(规则.无意义沟通拦.key, false);
    invalidateSettingsCache();
    const a = await 线索();
    const 存 = await 记客户(a, "开店");
    if (!存.ok) throw new Error(存.error);
    await setSetting(规则.无意义沟通拦.key, true);
    invalidateSettingsCache();
    const 原 = await prisma.followUp.findUniqueOrThrow({ where: { id: 存.id } });
    const 改 = (content: string, 版本: Date) => saveFollowUp({ id: 存.id, 版本: 版本.toISOString(), customerId: a.customerId, type: "PHONE", title: "", content, status: "已完成", occurredAt: 原.occurredAt.toISOString() });
    expect((await 改("开店", 原.updatedAt)).ok).toBe(true);
    const 好 = await prisma.followUp.findUniqueOrThrow({ where: { id: 存.id } });
    expect((await 改("开店，客户说下月开业", 好.updatedAt)).ok).toBe(true);
    const 新 = await prisma.followUp.findUniqueOrThrow({ where: { id: 存.id } });
    expect(await 改("好", 新.updatedAt)).toMatchObject({ ok: false, 无意义: true });
    const 拦后 = await prisma.followUp.findUniqueOrThrow({ where: { id: 存.id } });
    expect(拦后.content).toBe("开店，客户说下月开业");
    expect(拦后.updatedAt.getTime()).toBe(新.updatedAt.getTime());
  });

  it("拦下无副作用：公海客户拦下后仍在公海、负责人不变（写够了才领走）", async () => {
    const a = await 线索();
    // 退回公海时客户上留着原负责人（老板），甲名下的项目留在原处
    await prisma.customer.update({ where: { id: a.customerId }, data: { salesOwnerId: 老板.id } });
    await prisma.customerPool.create({ data: { customerId: a.customerId } });
    expect(await 记客户(a, "开店")).toMatchObject({ ok: false, 无意义: true });
    expect(await prisma.customerPool.count({ where: { customerId: a.customerId } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.customerId } })).salesOwnerId).toBe(老板.id);
    expect(await 条数(a.customerId)).toBe(0);
    // 对照：写够了照存、顺手领走（上面那条确实走到了领取前那一道）
    const 好 = await 记客户(a, "开店的事聊了");
    expect(好.ok, JSON.stringify(好)).toBe(true);
    expect(await prisma.customerPool.count({ where: { customerId: a.customerId } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.customerId } })).salesOwnerId).toBe(甲.id);
  });

  it("拦下无副作用：完成计划拦下后计划还没完成", async () => {
    const a = await 线索();
    const plan = await prisma.followPlan.create({ data: { subject: "回访", plannedAt: new Date(), customerId: a.customerId, ownerId: 甲.id } });
    expect(await 记客户(a, "开店", { 附带: { tasks: [], plan: null, 完成计划: plan.id } })).toMatchObject({ ok: false, 无意义: true });
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: plan.id } })).done).toBe(false);
    expect(await 条数(a.customerId)).toBe(0);
    const 好 = await 记客户(a, "回访了，客户下月开业", { 附带: { tasks: [], plan: null, 完成计划: plan.id } });
    expect(好.ok, JSON.stringify(好)).toBe(true);
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: plan.id } })).done).toBe(true);
  });

  it("项目页带卡点记沟通：拦下不存、也没发卡点", async () => {
    const a = await 线索();
    const r = await 记项目沟通Action(a.id, { type: "PHONE", content: "开店", occurredAt: 现在(), 阶段: "线索", 下一步: "明天再打一次", 下一步时间: null }, { type: "中度卡点", reasons: ["价格预算分歧"] });
    expect(r).toMatchObject({ ok: false, 无意义: true });
    expect(await 条数(a.customerId)).toBe(0);
    expect(await prisma.entBlocker.count({ where: { projectId: a.id } })).toBe(0);
  });

  it("项目页记沟通：项目在公海的先说在公海（那句更准），不说太短", async () => {
    const a = await 线索();
    await prisma.project.update({ where: { id: a.id }, data: { pooledAt: new Date() } });
    const r = await 记项目(a, "开店");
    expect(r).toMatchObject({ ok: false, error: 沟通项目在公海话 });
    expect(r).not.toHaveProperty("无意义");
  });

  it("改已有的：老记录末尾带空白、只改日期照存（内容按去掉首尾空白比）", async () => {
    await setSetting(规则.无意义沟通拦.key, false);
    invalidateSettingsCache();
    const a = await 线索();
    const 存 = await 记客户(a, "开店");
    if (!存.ok) throw new Error(存.error);
    await setSetting(规则.无意义沟通拦.key, true);
    invalidateSettingsCache();
    // 老数据：库里内容末尾带空白（以前的入口没去空白）
    const 原 = await prisma.followUp.update({ where: { id: 存.id }, data: { content: "开店 \n" } });
    const 前一天 = new Date(原.occurredAt.getTime() - 86_400_000).toISOString();
    const r = await saveFollowUp({ id: 存.id, 版本: 原.updatedAt.toISOString(), customerId: a.customerId, type: "PHONE", title: "", content: "开店 \n", status: "已完成", occurredAt: 前一天 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("改已有的：跟进任务改成电话、内容太短（没动）照样拦下，库里还是任务（负责人是销售管理）", async () => {
    const a = await 线索();
    const 存 = await saveFollowUp({ customerId: a.customerId, projectId: a.id, type: "TASK", title: "回电", content: "回电", status: "已完成", occurredAt: 现在() });
    if (!存.ok) throw new Error(存.error);
    const 原 = await prisma.followUp.findUniqueOrThrow({ where: { id: 存.id } });
    // 本人限时改不能改类型：甲换成销售管理（负责人且是管理才能改沟通）
    await prisma.entMember.update({ where: { userId: 甲.id }, data: { bizRole: "sales_mgr" } });
    忘掉企业版范围();
    const r = await saveFollowUp({ id: 存.id, 版本: 原.updatedAt.toISOString(), customerId: a.customerId, type: "PHONE", title: "回电", content: "回电", status: "已完成", occurredAt: 原.occurredAt.toISOString() });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, 无意义: true });
    const 后 = await prisma.followUp.findUniqueOrThrow({ where: { id: 存.id } });
    expect(后.type).toBe("TASK");
    expect(后.updatedAt.getTime()).toBe(原.updatedAt.getTime());
  });

  it("带速记原文（AI 解析）的照最后存进去的内容判：「好的」拦下不存；占位词表读后台改过的", async () => {
    const a = await 线索();
    expect(await 记客户(a, "好的", { sourceText: "客户说好的，下周来店里看样品" })).toMatchObject({ ok: false, 无意义: true });
    expect(await 条数(a.customerId)).toBe(0);
    expect((await 记客户(a, "客户说下周来店里看样品", { sourceText: "客户说好的，下周来店里看样品" })).ok).toBe(true);
    await setSetting(占位词键, ["开店"]);
    invalidateSettingsCache();
    expect(await 沟通判定须知()).toEqual({ 拦: true, 占位词: ["开店"] });
    const 可 = await 沟通可选项目(a.customerId);
    expect(可).toMatchObject({ ok: true, 判定: { 拦: true, 占位词: ["开店"] } });
  });
});
