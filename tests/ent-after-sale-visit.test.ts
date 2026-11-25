/**
 * 企业版售后回访（11-25，客户 E-282 / E-283 / E-286；P-沟通-03 的例外，lib/project/follow-needs-project.ts 能记售后回访）：
 *   - 交付结清的项目只能记标了售后回访的沟通（不标被拦）；丢单 / 线索流失 / 异常状态照旧不能记；在推项目上标了被拦
 *   - 记了项目仍是交付结清、不重开：不写项目任何一格（updatedAt、下一步都不变）、不跑自动推进，客户状态不变
 *   - 谁能记：客户不在公海时项目负责人、已进组的组员、客户负责人；客户整体进公海（交付结清项目的 pooledAt 仍空）三种人都不能记
 *   - 挂哪个：一个在推 + 一个交付结清时自动挂在推的；只有交付结清的要人选（回 售后 一组）
 *   - 顺手排的计划 = 下次回访：主题带「售后回访 · 项目名」、记下 afterSaleProjectId；完成计划小框（沟通可选项目）认得它
 *   - 有效回访拨三态的钟，只写「回访」的不拨；本人限时改能改标了售后回访的那条
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "小王", email: "s1", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { saveFollowUp, 沟通可选项目, type FollowUpInput } from "@/app/(app)/customers/[id]/actions";
import { 记项目沟通, 项目回收日, 算超时要的, 补回收起点留痕, 回收认的最近跟进 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 将回收提醒 } from "@/lib/project/timeout";
import { 规则 } from "@/lib/enterprise/rules";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { 三态夜扫 } from "@/lib/enterprise/tri-state-db";
import { 加天 } from "@/lib/enterprise/tri-state";
import { beijingDay } from "@/lib/business-clock";
import { 客户页沟通两样, 客户沟通汇总, 客户沟通汇总一条, 客户跟进可见条件, 汇总的项目, 汇总每页 } from "@/lib/enterprise/customer-follow-feed";
import { readCustomerFeedRow } from "@/app/(app)/customers/[id]/follow-history-actions";
import { 同号标题 } from "@/lib/enterprise/same-number-mark";
import { 认父记录 } from "@/app/api/attachments/access";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 看全部 } from "@/lib/team-scope";
import {
  交付结清要售后回访话, 请选在推或售后话, 售后只在交付结清话, 售后不能记话, 售后回访主题, 沟通客户在公海话, 沟通项目已结束话, 能记售后回访, 售后客户,
} from "@/lib/project/follow-needs-project";

const 今天 = beijingDay(new Date());
const 那天 = (n: number) => new Date(`${加天(今天, -n)}T00:00:00+08:00`);
let 我: string, 同事: string, 组员: string, 客户: string;
let 序 = 0;
const 项目 = (补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: `项目${++序}`, customerId: 客户, ownerId: 我, creatorId: 我, phase: "商机", node: "明确需求", ...补 } });
/** 交付结清的项目：订单阶段、结局交付结清，400 天前建、之后没动过 */
const 交付项目 = (补: Record<string, unknown> = {}) =>
  项目({ phase: "订单", node: "交付", result: "交付结清", nextStepText: "原来的下一步", createdAt: 那天(400), updatedAt: 那天(400), ...补 });
const 记 = (补: Partial<FollowUpInput> = {}) => saveFollowUp({
  customerId: 客户, type: "PHONE", content: "回访了使用情况，客户说设备运行稳定", status: "已完成", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), ...补,
});
const 项目上记 = (who: string, projectId: string, 补: Record<string, unknown> = {}) =>
  记项目沟通({ id: who, role: "SALES" }, projectId, { type: "PHONE", content: "回访了使用情况，客户说设备运行稳定", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), 售后回访: true, ...补 });
const 挂在 = async (followUpId: string) => (await prisma.followUpProject.findUnique({ where: { followUpId } }))?.projectId ?? null;
const 身份 = (id: string) => { mocks.user = { ...mocks.user, id }; };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  我 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
  同事 = (await prisma.user.create({ data: { email: "s2", name: "小李", title: "", role: "SALES", password: "x" } })).id;
  组员 = (await prisma.user.create({ data: { email: "s3", name: "小张", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 我, bizRole: "sales" }, { userId: 同事, bizRole: "sales" }, { userId: 组员, bizRole: "sales" }] });
  身份(我);
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 我, custStatus: "交付", createdAt: 那天(400) } })).id;
});

describe("交付结清的项目记售后回访", () => {
  it("客户页带标记能记：打上售后回访，项目仍是交付结清、一格不动，客户状态不变", async () => {
    const p = await 交付项目();
    const r = await 记({ projectId: p.id, 售后回访: true });
    expect(r).toMatchObject({ ok: true });
    const id = (r as { id: string }).id;
    expect(await 挂在(id)).toBe(p.id);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id } })).afterSale).toBe(true);
    const 后 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(后).toMatchObject({ result: "交付结清", phase: "订单", node: "交付", nextStepText: "原来的下一步", nextStepAt: null });
    expect(后.updatedAt.getTime()).toBe(那天(400).getTime());
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).custStatus).toBe("交付");
    expect(r).not.toHaveProperty("自动推进");
  });

  it("项目页（记项目沟通）带标记能记：不要下一步、带了也不写进项目，updatedAt 不变", async () => {
    const p = await 交付项目();
    const r = await 项目上记(我, p.id, { 下一步: "下个月再回访", 下一步时间: dayjs().add(30, "day").format("YYYY-MM-DD") });
    expect(r).toMatchObject({ ok: true, 售后回访: true, 写了下一步: false });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: r.followUpId! } })).afterSale).toBe(true);
    const 后 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(后).toMatchObject({ result: "交付结清", nextStepText: "原来的下一步", nextStepAt: null });
    expect(后.updatedAt.getTime()).toBe(那天(400).getTime());
  });

  it("交付结清项目上不带标记的沟通被拦（两条路都拦），一条不存", async () => {
    const p = await 交付项目();
    expect(await 记({ projectId: p.id })).toEqual({ ok: false, error: 交付结清要售后回访话 });
    expect(await 项目上记(我, p.id, { 售后回访: false })).toEqual({ ok: false, error: 交付结清要售后回访话 });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("旧名「成功交付」也算交付结清", async () => {
    const p = await 交付项目({ result: "成功交付" });
    expect(await 记({ projectId: p.id, 售后回访: true })).toMatchObject({ ok: true });
  });

  it("丢单 / 线索流失 / 异常状态：带了标记照旧不能记", async () => {
    for (const result of ["丢单", "线索流失", "异常状态"]) {
      const p = await 项目({ result });
      expect(await 记({ projectId: p.id, 售后回访: true })).toEqual({ ok: false, error: 沟通项目已结束话 });
      expect(await 项目上记(我, p.id)).toEqual({ ok: false, error: 沟通项目已结束话 });
    }
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("在推项目上标了售后回访：被拦（售后回访只在交付结清的项目上）", async () => {
    const p = await 项目();
    expect(await 记({ projectId: p.id, 售后回访: true })).toEqual({ ok: false, error: 售后只在交付结清话 });
    expect(await 项目上记(我, p.id, { 阶段: "商机" })).toEqual({ ok: false, error: 售后只在交付结清话 });
    expect(await prisma.followUp.count()).toBe(0);
  });
});

describe("谁能记", () => {
  it("客户负责人（不是项目负责人、不在组）能记，记录人是他、项目负责人不变", async () => {
    const p = await 交付项目({ ownerId: 同事, creatorId: 同事 });
    const r = await 记({ projectId: p.id, 售后回访: true });
    expect(r).toMatchObject({ ok: true });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: (r as { id: string }).id } })).ownerId).toBe(我);
    expect(await 项目上记(我, p.id)).toMatchObject({ ok: true, 售后回访: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(同事);
  });

  it("已进组的组员能记；不是负责人、不是组员、不是客户负责人的不能记", async () => {
    const p = await 交付项目({ ownerId: 同事, creatorId: 同事 });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事 } });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 组员, inviteStatus: "JOINED" } });
    expect(await 项目上记(组员, p.id)).toMatchObject({ ok: true });
    expect(await 项目上记(我, p.id)).toEqual({ ok: false, error: 售后不能记话 });
  });

  it("客户整体进公海后（交付结清项目 pooledAt 仍空）：项目负责人、组员、客户负责人都不能记", async () => {
    const 我负责的 = await 交付项目();
    const 同事负责的 = await 交付项目({ ownerId: 同事, creatorId: 同事 });
    await prisma.projectMember.create({ data: { projectId: 同事负责的.id, userId: 组员, inviteStatus: "JOINED" } });
    await prisma.customerPool.create({ data: { customerId: 客户, reason: "手动" } });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 我负责的.id } })).pooledAt).toBeNull();
    // 项目负责人（我也是原客户负责人）
    expect(await 项目上记(我, 我负责的.id)).toEqual({ ok: false, error: 沟通客户在公海话 });
    // 组员
    expect(await 项目上记(组员, 同事负责的.id)).toEqual({ ok: false, error: 沟通客户在公海话 });
    // 客户负责人（客户页那条路）
    expect(await 记({ projectId: 同事负责的.id, 售后回访: true })).toMatchObject({ ok: false, error: 沟通客户在公海话 });
    expect(await prisma.followUp.count()).toBe(0);
    // 纯判断：客户在公海一律不行
    expect(能记售后回访({ id: 我 }, { ownerId: 我, result: "交付结清", 客户负责人: 我, 客户在公海: true }, null, "JOINED")).toBe(false);
  });
});

describe("挂哪个项目", () => {
  it("一个在推 + 一个交付结清：没选自动挂在推的，不挑交付结清", async () => {
    await 交付项目();
    const 在推 = await 项目();
    const r = await 记();
    expect(r).toMatchObject({ ok: true });
    const id = (r as { id: string }).id;
    expect(await 挂在(id)).toBe(在推.id);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id } })).afterSale).toBe(false);
  });

  it("只有交付结清的项目：不自动挂，要人选（回售后一组、摆新建项目）；标了售后回访没给项目也要人选", async () => {
    const p = await 交付项目();
    expect(await 记()).toEqual({ ok: false, error: 请选在推或售后话, 没项目: true, 售后: [{ id: p.id, name: p.name }] });
    expect(await 记({ 售后回访: true })).toEqual({ ok: false, error: 请选在推或售后话, 售后: [{ id: p.id, name: p.name }] });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("沟通可选项目：在推一组、交付结清一组；客户在公海时交付结清那组为空", async () => {
    const 在推 = await 项目();
    const 交付 = await 交付项目();
    expect(await 沟通可选项目(客户)).toMatchObject({ ok: true, 项目们: [{ id: 在推.id }], 售后: [{ id: 交付.id, name: 交付.name }] });
    await prisma.customerPool.create({ data: { customerId: 客户 } });
    expect(await 沟通可选项目(客户)).toMatchObject({ ok: true, 售后: [] });
  });
});

describe("下次回访计划", () => {
  it("售后回访顺手排的计划：主题带「售后回访 · 项目名」、记下 afterSaleProjectId；完成计划小框认得它", async () => {
    const p = await 交付项目();
    const r = await 记({ projectId: p.id, 售后回访: true, 附带: { tasks: [], plan: { subject: "问问二期", plannedAt: dayjs().add(30, "day").format("YYYY-MM-DD"), method: "电话沟通" } } });
    expect(r).toMatchObject({ ok: true });
    const 计划 = await prisma.followPlan.findUniqueOrThrow({ where: { id: (r as { 下次计划id: string }).下次计划id } });
    expect(计划).toMatchObject({ subject: `${售后回访主题(p.name)} · 问问二期`, afterSaleProjectId: p.id });
    expect(await 沟通可选项目(客户, 计划.id)).toMatchObject({ ok: true, 计划售后项目: p.id });
    // 项目撤回了交付结清：计划带的项目核不过，退回普通选法
    await prisma.project.update({ where: { id: p.id }, data: { result: null, phase: "订单", node: "交付" } });
    const 撤回后 = await 沟通可选项目(客户, 计划.id);
    expect(撤回后).toMatchObject({ ok: true, 售后计划失效: true });
    expect(撤回后).not.toHaveProperty("计划售后项目");
  });

  it("普通沟通顺手排的计划不带 afterSaleProjectId、主题原样", async () => {
    await 项目();
    const r = await 记({ 附带: { tasks: [], plan: { subject: "问问报价", plannedAt: dayjs().add(3, "day").format("YYYY-MM-DD"), method: "电话沟通" } } });
    const 计划 = await prisma.followPlan.findUniqueOrThrow({ where: { id: (r as { 下次计划id: string }).下次计划id } });
    expect(计划).toMatchObject({ subject: "问问报价", afterSaleProjectId: null });
  });
});

describe("三态和本人限时改", () => {
  it("有效回访拨客户的钟（沉睡 → 活跃）；只写「回访」的不拨", async () => {
    await setSetting(规则.无意义沟通拦.key, false);
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 起算日: 加天(今天, -95) }, 三态: { ...默认三态规则, 开: true, 成交: { 活跃段: 90 } } });
    // 成交过的客户活跃段默认 365 天：调成 90，让交付结清 400 天前的客户这时是沉睡
    invalidateSettingsCache();
    const p = await 交付项目();
    await 三态夜扫();
    const 钟 = async () => (await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } })).state;
    expect(await 钟()).toBe("沉睡");
    expect(await 记({ projectId: p.id, 售后回访: true, content: "回访" })).toMatchObject({ ok: true });
    expect(await 钟()).toBe("沉睡");
    expect(await 记({ projectId: p.id, 售后回访: true })).toMatchObject({ ok: true });
    expect(await 钟()).toBe("活跃");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updatedAt.getTime()).toBe(那天(400).getTime());
  });

  it("本人限时改：组员能改自己 30 分钟内记的售后回访；项目改成丢单后照旧不能改", async () => {
    const p = await 交付项目({ ownerId: 同事, creatorId: 同事 });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事 } });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 组员, inviteStatus: "JOINED" } });
    const r = await 项目上记(组员, p.id);
    expect(r).toMatchObject({ ok: true });
    身份(组员);
    const f = await prisma.followUp.findUniqueOrThrow({ where: { id: r.followUpId! } });
    const 改 = (content: string) => saveFollowUp({ id: f.id, customerId: 客户, type: f.type, method: f.method, initiator: f.initiator, content, status: f.status, occurredAt: dayjs(f.occurredAt).format("YYYY-MM-DD HH:mm"), title: f.title });
    expect(await 改("回访了使用情况，客户说设备运行稳定，下季度要加一台")).toMatchObject({ ok: true });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } })).afterSale).toBe(true);
    await prisma.project.update({ where: { id: p.id }, data: { result: "丢单" } });
    expect(await 改("再改一次")).toMatchObject({ ok: false });
  });
});

describe("客户负责人在看不到的交付结清项目上记的售后回访（11-25 审查）", () => {
  it("客户页沟通记录、翻页、可见条件（AI 查询 / 重读一条）里看得到自己这条，同项目别人记的看不到；带本人售后、本人可改到，能看能传附件、能改", async () => {
    // 企业版项目不跟客户走：同事负责、我没进组，我只是客户负责人
    const p = await 交付项目({ ownerId: 同事, creatorId: 同事 });
    const 他的 = (await 项目上记(同事, p.id)).followUpId!;
    expect(他的).toBeTruthy();
    const 我们 = { id: 我, role: "SALES" };
    // 按组织看客户开着：企业版项目不跟客户走（同事负责、我没进组的项目我看不到）
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting(规则.按组织看客户.key, true);
    await setSetting("business", { ...DEFAULT_BUSINESS, projectMode: true });
    invalidateSettingsCache();
    忘掉企业版范围();
    try {
    // 下面都按我的范围查（限定层认 以谁的身份）
    await 以谁的身份(我, async () => {
    expect([...(await 汇总的项目(我们, 客户)).keys()]).not.toContain(p.id);
    const r = await 记({ projectId: p.id, 售后回访: true });
    expect(r).toMatchObject({ ok: true });
    const 我的 = (r as { id: string }).id;
    // 自己这条传过一张截图：汇总里带上（同 带附件：记在这位客户名下、挂在项目上）
    await 看全部(() => prisma.attachment.create({ data: { followUpId: 我的, name: "回访.png", mime: "image/png", size: 10, sha256: "0".repeat(64), userId: 我 } }));

    const [首页, 菜单] = await 客户页沟通两样(我们, 客户, undefined, { 客户负责人: 我, 客户在公海: false });
    expect(首页.rows.map((f) => f.id)).toEqual([我的]);
    expect(首页.rows[0]).toMatchObject({ 本人售后: true, afterSale: true, 项目: { id: p.id, 名: p.name } });
    expect(首页.rows[0].本人可改到).toBeTruthy();
    expect(首页.rows[0].附件?.map((a) => a.name)).toEqual(["回访.png"]);
    expect(菜单.find((x) => x.id === p.id)).toMatchObject({ 能记售后: true });
    // 翻页那条（loadCustomerFeed）同一批
    expect((await 客户沟通汇总(我们, 客户)).rows.map((f) => f.id)).toEqual([我的]);
    // 按客户直接读跟进的老接口（AI 查询、重读一条、挑客户近况）同一把尺
    const 条件 = await 客户跟进可见条件(我们, 客户);
    expect(条件).not.toBeNull();
    expect((await prisma.followUp.findMany({ where: { customerId: 客户, AND: [条件!] }, select: { id: true } })).map((f) => f.id)).toEqual([我的]);

    // 附件：自己这条能看能传，同事那条看不到
    expect(await 认父记录({ followUpId: 我的 }, false)).toEqual({ 叫法: "这条售后回访" });
    expect(await 认父记录({ followUpId: 我的 }, true)).toEqual({ 叫法: "这条售后回访" });
    expect(await 认父记录({ followUpId: 他的 }, false)).toHaveProperty("错");

    // 本人限时改：客户页这条点「修改」走 saveFollowUp
    const f = await prisma.followUp.findUniqueOrThrow({ where: { id: 我的 } });
    expect(await saveFollowUp({ id: f.id, customerId: 客户, type: f.type, method: f.method, initiator: f.initiator, content: "回访了使用情况，客户说设备运行稳定，下季度要加一台", status: f.status, occurredAt: dayjs(f.occurredAt).format("YYYY-MM-DD HH:mm"), title: f.title })).toMatchObject({ ok: true });

    // 不再是客户负责人：这段不收（不扩大可见范围）
    await 看全部(() => prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事 } }));
    忘掉企业版范围();
    expect((await 客户沟通汇总(我们, 客户)).rows.map((f) => f.id)).not.toContain(我的);
    });
    } finally {
      vi.unstubAllEnvs();
      忘掉企业版范围();
    }
  });
});

describe("客户负责人那条售后回访：重读一条、收回、限时改、附件（11-25 复审）", () => {
  /**
   * 同上一组：同事负责、我没进组的交付结清项目（按组织看客户开着，我看不到项目，只是客户负责人）；同事先记一条，我再在上面记一条售后回访。
   * 下面按我的范围跑（以谁的身份）
   */
  async function 场景(做: (x: { p: { id: string; name: string }; 我的: string; 他的: string; 我们: { id: string; role: string } }) => Promise<void>) {
    const p = await 交付项目({ ownerId: 同事, creatorId: 同事 });
    const 他的 = (await 项目上记(同事, p.id)).followUpId!;
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting(规则.按组织看客户.key, true);
    await setSetting("business", { ...DEFAULT_BUSINESS, projectMode: true });
    invalidateSettingsCache();
    忘掉企业版范围();
    try {
      await 以谁的身份(我, async () => {
        const r = await 记({ projectId: p.id, 售后回访: true });
        expect(r).toMatchObject({ ok: true });
        await 做({ p, 我的: (r as { id: string }).id, 他的, 我们: { id: 我, role: "SALES" } });
      });
    } finally {
      vi.unstubAllEnvs();
      忘掉企业版范围();
    }
  }
  /** 客户页沟通两样 带上客户此刻的两格（页面就是这么传的） */
  const 客户页 = async (me: { id: string; role: string }) => 客户页沟通两样(me, 客户, undefined, await 售后客户(客户));
  /** 收回了：客户页沟通两样、翻页、重读一条、客户跟进可见条件都不给，附件看 / 传都报错 */
  async function 都收回(me: { id: string; role: string }, 我的: string) {
    忘掉企业版范围();
    const [首页, 菜单] = await 客户页(me);
    expect(首页.rows.map((f) => f.id)).not.toContain(我的);
    expect(菜单.some((x) => x.能记售后)).toBe(false);
    expect((await 客户沟通汇总(me, 客户)).rows.map((f) => f.id)).not.toContain(我的);
    expect(await 客户沟通汇总一条(me, 客户, 我的)).toBeNull();
    const 条件 = await 客户跟进可见条件(me, 客户);
    expect((await prisma.followUp.findMany({ where: { customerId: 客户, ...(条件 ? { AND: [条件] } : {}) }, select: { id: true } })).map((f) => f.id)).not.toContain(我的);
    expect(await 认父记录({ followUpId: 我的 }, false)).toHaveProperty("错");
    expect(await 认父记录({ followUpId: 我的 }, true)).toHaveProperty("错");
  }

  it("翻页翻出来的（第 2 页）那条改完重读：走汇总那条，项目 / 附件 / 本人售后 / 本人可改到 / 已修改 都还在", async () => {
    await 场景(async ({ p, 我的, 我们 }) => {
      // 这位客户名下再有 汇总每页 + 1 条更新的老跟进（不挂项目）：我的那条挤到第 2 页
      await 看全部(() => prisma.followUp.createMany({ data: Array.from({ length: 汇总每页 + 1 }, (_, i) => ({
        customerId: 客户, ownerId: 我, type: "PHONE", title: "", content: `老跟进${i}`, status: "已完成", occurredAt: new Date(Date.now() + (i + 1) * 60_000),
      })) }));
      await 看全部(() => prisma.attachment.create({ data: { followUpId: 我的, name: "回访.png", mime: "image/png", size: 10, sha256: "0".repeat(64), userId: 我 } }));
      const 一页 = await 客户沟通汇总(我们, 客户);
      expect(一页.hasMore).toBe(true);
      expect(一页.rows.map((f) => f.id)).not.toContain(我的);
      const 末 = 一页.rows.at(-1)!;
      const 二页 = await 客户沟通汇总(我们, 客户, { occurredAt: 末.occurredAt, id: 末.id });
      expect(二页.rows.find((f) => f.id === 我的)).toMatchObject({ 本人售后: true, 项目: { id: p.id, 名: p.name } });

      const f = await prisma.followUp.findUniqueOrThrow({ where: { id: 我的 } });
      expect(await saveFollowUp({ id: f.id, customerId: 客户, type: f.type, method: f.method, initiator: f.initiator, content: "回访了使用情况，下季度要加一台", status: f.status, occurredAt: dayjs(f.occurredAt).format("YYYY-MM-DD HH:mm"), title: f.title })).toMatchObject({ ok: true });
      const 重读 = await readCustomerFeedRow(客户, 我的);
      expect(重读.ok).toBe(true);
      const 行 = (重读 as { row: Record<string, unknown> | null }).row!;
      expect(行).toMatchObject({ id: 我的, content: "回访了使用情况，下季度要加一台", 本人售后: true, 已修改: true, 项目: { id: p.id, 名: p.name } });
      expect(行.本人可改到).toBeTruthy();
      expect((行.附件 as { name: string }[]).map((a) => a.name)).toEqual(["回访.png"]);
      // 别人那条、不存在的：重读不给（客户页收起这条）
      expect(await 客户沟通汇总一条(我们, 客户, "不存在的id")).toBeNull();
    });
  });

  it("附件：本人那条能看能传、删报错；同事那条看、传、删都报错", async () => {
    await 场景(async ({ 我的, 他的 }) => {
      expect(await 认父记录({ followUpId: 我的 }, true)).toEqual({ 叫法: "这条售后回访" });
      expect(await 认父记录({ followUpId: 我的 }, "删")).toHaveProperty("错");
      for (const 要改 of [false, true, "删"] as const) expect(await 认父记录({ followUpId: 他的 }, 要改)).toHaveProperty("错");
    });
  });

  it("换了客户负责人：客户页沟通两样、翻页、重读一条、客户跟进可见条件、附件看 / 传都收回", async () => {
    await 场景(async ({ 我的, 我们 }) => {
      expect((await 客户页(我们))[0].rows.map((f) => f.id)).toContain(我的);
      await 看全部(() => prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事 } }));
      await 都收回(我们, 我的);
    });
  });

  it("客户进了公海：都收回", async () => {
    await 场景(async ({ 我的, 我们 }) => {
      await 看全部(() => prisma.customerPool.create({ data: { customerId: 客户, reason: "手动" } }));
      await 都收回(我们, 我的);
    });
  });

  it("项目改成不是交付结清（丢单 / 撤回结局）：都收回", async () => {
    for (const result of ["丢单", null]) {
      await resetDb();
      invalidateSettingsCache();
      我 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
      同事 = (await prisma.user.create({ data: { email: "s2", name: "小李", title: "", role: "SALES", password: "x" } })).id;
      await prisma.entMember.createMany({ data: [{ userId: 我, bizRole: "sales" }, { userId: 同事, bizRole: "sales" }] });
      身份(我);
      客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 我, custStatus: "交付", createdAt: 那天(400) } })).id;
      await 场景(async ({ p, 我的, 我们 }) => {
        await 看全部(() => prisma.project.update({ where: { id: p.id }, data: { result } }));
        await 都收回(我们, 我的);
      });
    }
  });

  it("本人可改到：30 分钟内的才带；超过 30 分钟、导入建的、系统留痕的不带（本人售后照标）", async () => {
    await 场景(async ({ 我的, 我们 }) => {
      const 带 = async () => (await 客户沟通汇总一条(我们, 客户, 我的))!;
      expect((await 带()).本人可改到).toBeTruthy();
      // 超过 30 分钟
      await 看全部(() => prisma.followUp.update({ where: { id: 我的 }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } }));
      expect(await 带()).toMatchObject({ 本人售后: true });
      expect((await 带()).本人可改到).toBeUndefined();
      expect((await 客户页(我们))[0].rows.find((f) => f.id === 我的)?.本人可改到).toBeUndefined();
      // 时间拨回 30 分钟内，但这条是导入建的
      await 看全部(() => prisma.followUp.update({ where: { id: 我的 }, data: { createdAt: new Date() } }));
      expect((await 带()).本人可改到).toBeTruthy();
      const 批 = await 看全部(() => prisma.entImportBatch.create({ data: { source: "QA" } }));
      const 导 = await 看全部(() => prisma.entImportRow.create({ data: { batchId: 批.id, entity: "followup", externalId: "x1", targetId: 我的, kind: "create", written: "{}" } }));
      expect((await 带()).本人可改到).toBeUndefined();
      // 不是导入的，但标题是同号协作的系统留痕
      await 看全部(() => prisma.entImportRow.delete({ where: { id: 导.id } }));
      expect((await 带()).本人可改到).toBeTruthy();
      await 看全部(() => prisma.followUp.update({ where: { id: 我的 }, data: { title: `${同号标题}：QA` } }));
      expect(await 带()).toMatchObject({ 本人售后: true });
      expect((await 带()).本人可改到).toBeUndefined();
    });
  });
});

describe("[E-318] 售后回访不进项目超时回收（客户 11-25：「售后回访当前不进入超时回收范畴」）", () => {
  /** 同客户：A 交付结清（记售后回访）、B 在推（潜客培育 30 天回收，29 天前建 = 明天回收），我名下一条 B 的「再不跟进」提醒；三态开着（成交活跃段 90 天 → 客户先是沉睡） */
  async function 底子() {
    await setSetting(规则.无意义沟通拦.key, false);
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 开: true, 起算日: 加天(今天, -95), 节点天数: { 潜客培育: 30 } }, 三态: { ...默认三态规则, 开: true, 成交: { 活跃段: 90 } } });
    invalidateSettingsCache();
    const A = await 交付项目();
    const B = await 项目({ phase: "线索", node: "潜客培育", createdAt: 那天(29) });
    const 回收日 = async () => {
      const [p] = await 补回收起点留痕([await prisma.project.findUniqueOrThrow({ where: { id: B.id }, select: 算超时要的 })]);
      return 项目回收日(await 生效组织规则(), p);
    };
    const 原日 = await 回收日();
    expect(原日).toBe(加天(今天, 1));
    const 提醒 = await prisma.task.create({ data: { title: 将回收提醒(B.name, "潜客培育", 原日!), customerId: 客户, ownerId: 我, dueOn: 原日 } });
    const 提醒勾了 = async () => (await prisma.task.findUniqueOrThrow({ where: { id: 提醒.id } })).done;
    return { A, B, 回收日, 原日, 提醒勾了 };
  }
  const 最近跟进 = async () => (await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).lastFollowAt;

  it("客户页、项目页记售后回访：B 的回收起点和提醒都不变；客户最近跟进照写（列表显示不变）、三态额度照常回满", async () => {
    const { A, B, 回收日, 原日, 提醒勾了 } = await 底子();
    await 三态夜扫();
    // 客户名下有在推的 B，钟本来就是活跃：看继续持有额度回不回满（有效沟通回满额度，M-公海-38）
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { holdCount: 2, holdDays: 10, quotaResetDay: null } });
    const 钟 = () => prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } });
    expect(await 记({ projectId: A.id, 售后回访: true })).toMatchObject({ ok: true });
    expect(await 最近跟进()).not.toBeNull();
    expect(await 回收日()).toBe(原日);
    expect(await 提醒勾了()).toBe(false);
    expect(await 项目上记(我, A.id)).toMatchObject({ ok: true });
    expect(await 回收日()).toBe(原日);
    expect(await 提醒勾了()).toBe(false);
    // 项目详情 / 记沟通预演那条（一位客户）同一个口径：只有售后回访 = 不认
    expect(await 回收认的最近跟进(客户, await 最近跟进())).toBeNull();
    // 三态照常：有效的售后回访拨客户的钟（E-283 第 3 条、E-286 不动）
    expect(await 钟()).toMatchObject({ state: "活跃", quotaResetDay: 今天 });
    expect((await prisma.followUp.count({ where: { customerId: 客户, afterSale: true } }))).toBe(2);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: B.id } })).pooledAt).toBeNull();
  });

  it("普通沟通照旧续钟：客户页记在 B 上 → B 回收日后移、提醒勾掉；先有普通沟通再记售后回访，起点停在普通那条", async () => {
    const { A, B, 回收日, 原日, 提醒勾了 } = await 底子();
    const 早 = dayjs().subtract(2, "hour");
    expect(await 记({ projectId: B.id, occurredAt: 早.format("YYYY-MM-DD HH:mm") })).toMatchObject({ ok: true });
    const 续后 = await 回收日();
    expect(续后).not.toBe(原日);
    expect(续后! > 原日!).toBe(true);
    expect(await 提醒勾了()).toBe(true);
    // 再记一条售后回访（比普通那条晚）：最近跟进跟着写，回收起点停在普通那条
    expect(await 记({ projectId: A.id, 售后回访: true })).toMatchObject({ ok: true });
    expect((await 最近跟进())!.getTime()).toBeGreaterThan(早.toDate().getTime());
    expect(await 回收日()).toBe(续后);
    expect((await 回收认的最近跟进(客户, await 最近跟进()))?.getTime()).toBe(早.startOf("minute").toDate().getTime());
  });
});
