/**
 * 跨负责人项目直接合并 · 阶段 1（服务端核心，E-380；lib/enterprise/project-merge-request.ts，迁移 195）：
 *   发起（留下项目的负责人发申请；确认人 / 系统管理员自己发起 = 直接并；被并走的负责人不能发起；同客户、都线索阶段、未结束、负责人不同、客户负责人是销售）、
 *   确认人（实线上级 / 同线条线总管理 / 都没有给系统管理员）、确认 / 拒绝 / 5 个工作日失效、确认后同事务并 + 原负责人记待补、
 *   和客户合并申请互斥、待确认期间验证时限和超时自动转暂停（结束后从头计时）。人名、客户名都是编造的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 读组织 } from "@/lib/enterprise/org";
import { 月份 } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { 超时转生效key, 超时转扫一遍, 超时通知种类 } from "@/lib/enterprise/reply-overdue";
import { 验证时限生效key, 验证时限扫一遍, 验证时限通知种类 } from "@/lib/project/lead-verify-timeout";
import { 到期时刻 } from "@/lib/enterprise/merge-request";
import { 发起合并申请 } from "@/lib/enterprise/merge-request";
import { 待补数们 } from "@/lib/enterprise/invalid-makeup";
import { 撤回项目合并, 执行项目合并, 读快照, 项目合并通知种类 } from "@/lib/enterprise/project-merge";
import {
  算确认人, 发起跨负责人并, 处理跨并申请, 撤回跨并申请, 扫过期跨并申请, 跨并预览, 跨并暂停中的项目, 跨并重新起算时刻们, 拒绝必填话, 客户合并申请挡话, 作废跨并申请, 是确认人of,
} from "@/lib/enterprise/project-merge-request";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 销管: 人, 线总: 人, 乙: 人, 丙: 人, 丁: 人, 渠运: 人;
let 序 = 0;
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const 周五下午 = 京("2026-11-27 15:00");

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
const 客户 = async (ownerId: string) => (await raw.customer.create({ data: { name: `测试客户${++序}`, phone: "", salesOwnerId: ownerId } })).id;
const 项目 = async (ownerId: string, customerId: string, 补: Record<string, unknown> = {}) =>
  (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, bizLine: "内贸", ...补 } })).id;
const 项 = (id: string) => raw.project.findUniqueOrThrow({ where: { id } });
const 申请 = (id: string) => raw.entProjectMergeRequest.findUniqueOrThrow({ where: { id } });
/** 乙的项目 a（留下）、丙的项目 b（被并走），同一位客户（销售乙负责） */
async function 一对() {
  const c = await 客户(乙.id);
  return { c, a: await 项目(乙.id, c), b: await 项目(丙.id, c) };
}
const 发 = async (a: string, b: string, me: 人, 现在 = 周五下午) => {
  const r = await 发起跨负责人并(prisma, a, b, me, { 现在 });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const 请 = async (a: string, b: string, me: 人 = 乙, 现在 = 周五下午) => {
  const r = await 发(a, b, me, 现在);
  if (r.方式 !== "申请") throw new Error("应该是申请");
  return r.requestId;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  销管 = await 造人("xg", "销管甲", "SALES");
  线总 = await 造人("xz", "线总甲", "SALES");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  丁 = await 造人("ding", "丁", "SALES");
  渠运 = await 造人("qy", "渠运甲", "SALES");
  await raw.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 销管.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 线总.id, bizRole: "director", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸", managerId: 销管.id },
      { userId: 丁.id, bizRole: "sales", line: "内贸" },
      { userId: 渠运.id, bizRole: "channel_ops" },
    ],
  });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("确认人：实线上级 / 同线条线总管理 / 都没有给系统管理员", () => {
  it("原负责人有上级：上级 + 同线条线总管理都是确认人（上级优先、一人一行）；不含原负责人本人和别的线", async () => {
    const org = await 读组织();
    expect(算确认人(org, { ownerId: 丙.id, bizLine: "内贸" })).toEqual([
      { userId: 销管.id, 层级: "实线上级" }, { userId: 线总.id, 层级: "条线总管理" },
    ]);
    // 项目线是外贸：没有外贸条线总管理，上级仍在
    expect(算确认人(org, { ownerId: 丙.id, bizLine: "外贸" })).toEqual([{ userId: 销管.id, 层级: "实线上级" }]);
  });
  it("没上级也没同线条线总管理：给系统管理员；有上级没线总：只上级", async () => {
    const org = await 读组织();
    // 乙没有上级；删掉线总的线 → 内贸没有条线总管理
    await raw.entMember.update({ where: { userId: 线总.id }, data: { line: null } });
    const org2 = await 读组织();
    // 老板和摘了线的线总（没设业务线的总管理 = 系统管理员）都是系统管理员
    expect(算确认人(org2, { ownerId: 乙.id, bizLine: "内贸" }).map((x) => [x.userId, x.层级]).sort()).toEqual([[老板.id, "系统管理员"], [线总.id, "系统管理员"]].sort());
    // 有上级、内贸没有条线总管理：只有上级，不再兜系统管理员
    expect(算确认人(org2, { ownerId: 丙.id, bizLine: "内贸" })).toEqual([{ userId: 销管.id, 层级: "实线上级" }]);
    expect(org.成员.size).toBeGreaterThan(0);
  });
});

describe("发起：谁能发、哪些拦", () => {
  it("留下项目的负责人发申请：建一行待确认、存确认人、5 个工作日到期；两个项目都没动", async () => {
    const { a, b } = await 一对();
    const r = await 发(a, b, 乙);
    expect(r).toMatchObject({ 方式: "申请", 确认人: [{ userId: 销管.id }, { userId: 线总.id }] });
    if (r.方式 !== "申请") return;
    const 行 = await 申请(r.requestId);
    expect(行).toMatchObject({ status: "待确认", fromProjectId: b, intoProjectId: a, fromOwnerId: 丙.id, intoOwnerId: 乙.id, byUserId: 乙.id, confirmerRole: "实线上级、条线总管理" });
    expect(行.expiresAt.toISOString()).toBe("2026-12-04T07:00:00.000Z"); // 周五 15:00 → 下周五 15:00（北京）
    expect((await 项(b)).result).toBeNull();
    expect(await raw.entCustomerMerge.count()).toBe(0);
  });

  it("被并走的负责人不能发起；无关同事不能发；留下项目的负责人之外的人不能代发", async () => {
    const { a, b } = await 一对();
    expect(await 发起跨负责人并(prisma, a, b, 丙)).toMatchObject({ ok: false, error: expect.stringContaining("被并走的项目的负责人不能发起") });
    expect(await 发起跨负责人并(prisma, a, b, 丁)).toMatchObject({ ok: false, error: expect.stringContaining("只有留下项目的负责人") });
    expect(await raw.entProjectMergeRequest.count()).toBe(0);
    expect(await 项(b).then((p) => p.result)).toBeNull();
  });

  it("确认人自己发起 = 直接并：不建申请、同事务并完、留痕「本人发起」；系统管理员发起也是直接并", async () => {
    const { a, b, c } = await 一对();
    const r = await 发(a, b, 销管);
    expect(r.方式).toBe("直接并");
    expect(await raw.entProjectMergeRequest.count()).toBe(0);
    expect(await 项(b)).toMatchObject({ result: "线索流失" });
    const 单 = await raw.entCustomerMerge.findFirstOrThrow({ where: { kind: "项目", fromId: b } });
    expect(JSON.parse(单.detail).跨负责人).toMatchObject({ 发起方式: "本人发起", 确认人: 销管.id, 确认人层级: "实线上级", 原负责人: 丙.id, 留下负责人: 乙.id });
    const b2 = await 项目(丁.id, c);
    const r2 = await 发(a, b2, 老板);
    expect(r2.方式).toBe("直接并");
    expect(JSON.parse((await raw.entCustomerMerge.findFirstOrThrow({ where: { fromId: b2 } })).detail).跨负责人).toMatchObject({ 发起方式: "本人发起", 确认人: 老板.id });
  });

  it("前提拦：同负责人、不同客户、已结束、商机阶段、客户负责人是渠运、客户有客户合并申请在等", async () => {
    const { a, b, c } = await 一对();
    const 同 = await 项目(乙.id, c);
    expect(await 发起跨负责人并(prisma, a, 同, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("同一位负责人") });
    const 别客户 = await 项目(丙.id, await 客户(乙.id));
    expect(await 发起跨负责人并(prisma, a, 别客户, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("不在同一位客户名下") });
    const 完 = await 项目(丙.id, c, { result: "丢单" });
    expect(await 发起跨负责人并(prisma, a, 完, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("已经结束") });
    const 商机 = await 项目(丙.id, c, { phase: "商机", node: "方案" });
    expect((await 发起跨负责人并(prisma, a, 商机, 乙)).ok).toBe(false);
    // 渠运负责的客户
    const c2 = await 客户(渠运.id);
    const a2 = await 项目(乙.id, c2), b2 = await 项目(丙.id, c2);
    expect(await 发起跨负责人并(prisma, a2, b2, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("不是销售") });
    // 客户合并申请在等同意 → 互斥
    const 另 = await 客户(丁.id);
    await raw.entMergeRequest.create({ data: { fromId: 另, intoId: c, byUserId: 丁.id, status: "待同意", snapshot: "{}", expiresAt: new Date(Date.now() + 86_400_000) } });
    expect(await 发起跨负责人并(prisma, a, b, 乙)).toMatchObject({ ok: false, error: expect.stringContaining(客户合并申请挡话) });
    expect(await raw.entProjectMergeRequest.count()).toBe(0);
    expect(await 跨并预览(prisma, a, b, 乙)).toMatchObject({ ok: false });
  });

  it("互斥反方向：这位客户名下有跨负责人项目合并申请在等确认，客户合并申请发不出去；申请结束后能发", async () => {
    const { a, b, c } = await 一对();
    const 申请id = await 请(a, b);
    const 另 = await 客户(丁.id);
    const 试 = await 发起合并申请(prisma, c, 另, 乙, { 现在: 周五下午 });
    expect(试).toMatchObject({ ok: false, error: expect.stringContaining("跨负责人项目合并申请在等确认") });
    expect((await 撤回跨并申请(prisma, 申请id, 乙, 周五下午)).ok).toBe(true);
    const 再 = await 发起合并申请(prisma, c, 另, 乙, { 现在: 周五下午 });
    expect(再.ok || !/跨负责人项目合并/.test((再 as { error: string }).error)).toBe(true);
  });

  it("同一项目已有待确认申请：再发（或同负责人直接并）被拦", async () => {
    const { a, b, c } = await 一对();
    await 请(a, b);
    expect(await 发起跨负责人并(prisma, a, b, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("在等确认") });
    const a2 = await 项目(乙.id, c);
    expect(await 发起跨负责人并(prisma, a2, b, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("在等确认") });
  });
});

describe("5 个工作日到期（沿用客户合并申请的工作日工具）", () => {
  it("周五 15:00 → 下周五同一时刻；周六发起也到下周五；周三 → 下周三", () => {
    expect(到期时刻(京("2026-11-27 15:00")).toISOString()).toBe("2026-12-04T07:00:00.000Z");
    expect(到期时刻(京("2026-11-28 10:00")).toISOString()).toBe("2026-12-04T02:00:00.000Z");
    expect(到期时刻(京("2026-12-02 10:00")).toISOString()).toBe("2026-12-09T02:00:00.000Z");
  });
  it("到期前一毫秒确认还行；到期那一刻扫描置已失效、确认被拒；失效后原项目没动", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    const 到 = (await 申请(id)).expiresAt;
    expect(await 扫过期跨并申请(prisma, new Date(到.getTime() - 1))).toBe(0);
    expect((await 申请(id)).status).toBe("待确认");
    expect(await 扫过期跨并申请(prisma, 到)).toBe(1);
    expect(await 申请(id)).toMatchObject({ status: "已失效", endedById: null });
    expect(await 处理跨并申请(prisma, id, 销管, "确认", { 现在: 到 })).toMatchObject({ ok: false, error: expect.stringContaining("已失效") });
    expect((await 项(b)).result).toBeNull();
    expect(await raw.auditLog.count({ where: { action: "project-merge-request-void", entityId: { in: [a, b] } } })).toBe(2);
  });
  it("到期了还没被钟扫到，确认那一刻当场判失效（不并）", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    const 到 = (await 申请(id)).expiresAt;
    expect(await 处理跨并申请(prisma, id, 销管, "确认", { 现在: new Date(到.getTime() + 1000) })).toMatchObject({ ok: false });
    expect(await 申请(id)).toMatchObject({ status: "已失效" });
    expect((await 项(b)).result).toBeNull();
  });
});

describe("确认 / 拒绝", () => {
  it("上级确认：同事务并完（被并走结束为重复线索），申请置已合并带合并单；占过名额的原负责人记 1 个并走待补", async () => {
    const { a, b } = await 一对();
    await raw.entLeadAssign.create({ data: { projectId: b, toUserId: 丙.id, byUserId: 老板.id, month: 月份() } });
    const id = await 请(a, b);
    const r = await 处理跨并申请(prisma, id, 销管, "确认", { 现在: 京("2026-11-27 16:00") });
    expect(r).toMatchObject({ ok: true, 状态: "已合并" });
    const 行 = await 申请(id);
    expect(行).toMatchObject({ status: "已合并", endedById: 销管.id });
    expect(行.mergeId).toBeTruthy();
    expect(await 项(b)).toMatchObject({ result: "线索流失", ownerId: 丙.id });
    expect(await 项(a)).toMatchObject({ ownerId: 乙.id, result: null });
    const 单 = await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: 行.mergeId! } });
    expect(单).toMatchObject({ kind: "项目", fromId: b, intoId: a, status: "已合并" });
    expect(JSON.parse(单.detail).跨负责人).toMatchObject({ 申请id: id, 发起人: 乙.id, 确认人: 销管.id, 发起方式: "申请确认", 确认人层级: "实线上级" });
    expect((await 待补数们([丙.id])).get(丙.id)).toBe(1);
    expect(await raw.entLeadMakeup.findFirstOrThrow({ where: { userId: 丙.id } })).toMatchObject({ kind: "merge-out", projectId: b });
    // 不退还已占线索名额：分配记录照旧、不加配额
    expect(await raw.entLeadAssign.count({ where: { projectId: b } })).toBe(1);
  });

  it("条线总管理也能确认；自己新建的（没占过名额）不记待补", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    expect(await 处理跨并申请(prisma, id, 线总, "确认")).toMatchObject({ ok: true, 状态: "已合并" });
    expect(await raw.entLeadMakeup.count()).toBe(0);
    expect(JSON.parse((await raw.entCustomerMerge.findFirstOrThrow({ where: { fromId: b } })).detail).跨负责人.确认人层级).toBe("条线总管理");
  });

  it("不是确认人（发起人自己、原负责人、同事）不能确认也不能拒绝；申请不动", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    for (const 谁 of [乙, 丙, 丁]) {
      expect(await 处理跨并申请(prisma, id, 谁, "确认")).toMatchObject({ ok: false, error: expect.stringContaining("不是这张申请的确认人") });
      expect(await 处理跨并申请(prisma, id, 谁, "拒绝", { 原因: "不行" })).toMatchObject({ ok: false });
    }
    expect((await 申请(id)).status).toBe("待确认");
    expect((await 项(b)).result).toBeNull();
  });

  it("拒绝：原因必填、有上限；拒绝后记已拒绝、不并；已处理的不能再处理", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    expect(await 处理跨并申请(prisma, id, 销管, "拒绝")).toMatchObject({ ok: false, error: 拒绝必填话 });
    expect(await 处理跨并申请(prisma, id, 销管, "拒绝", { 原因: "字".repeat(101) })).toMatchObject({ ok: false });
    expect(await 处理跨并申请(prisma, id, 销管, "拒绝", { 原因: "这条不是重复的" })).toMatchObject({ ok: true, 状态: "已拒绝" });
    expect(await 申请(id)).toMatchObject({ status: "已拒绝", reason: "这条不是重复的", endedById: 销管.id });
    expect((await 项(b)).result).toBeNull();
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: false, error: expect.stringContaining("已拒绝") });
  });

  it("发起人撤回：只有发起人、只在待确认；撤回后可重新发", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    expect(await 撤回跨并申请(prisma, id, 丁)).toMatchObject({ ok: false, error: expect.stringContaining("只有发起人") });
    expect((await 撤回跨并申请(prisma, id, 乙)).ok).toBe(true);
    expect((await 申请(id)).status).toBe("已撤回");
    expect(await 撤回跨并申请(prisma, id, 乙)).toMatchObject({ ok: false });
    expect((await 发起跨负责人并(prisma, a, b, 乙)).ok).toBe(true);
  });

  it("确认时再判：两个项目任一方的负责人 / 阶段 / 回款 / 被判无效有变 = 已失效、不并、写变动项", async () => {
    // 回款有变
    let { a, b } = await 一对();
    let id = await 请(a, b);
    await raw.entProjectPayment.create({ data: { projectId: a, amount: 100, paidAt: new Date(), type: "回款", createdById: 乙.id } as never }).catch(async () => {
      await raw.entCommission.create({ data: { projectId: a } as never });
    });
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: false });
    expect(await 申请(id)).toMatchObject({ status: "已失效" });
    expect((await 项(b)).result).toBeNull();
    // 负责人有变
    ({ a, b } = await 一对());
    id = await 请(a, b);
    await raw.project.update({ where: { id: b }, data: { ownerId: 丁.id } });
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: false, error: expect.stringContaining("负责人") });
    expect((await 申请(id)).status).toBe("已失效");
    // 阶段 / 结局有变
    ({ a, b } = await 一对());
    id = await 请(a, b);
    await raw.project.update({ where: { id: a }, data: { result: "丢单" } });
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: false, error: expect.stringContaining("阶段") });
    // 被判无效有变
    ({ a, b } = await 一对());
    id = await 请(a, b);
    await raw.entLeadVerify.create({ data: { projectId: b, verdict: "初验无效" } });
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: false, error: expect.stringContaining("被判无效") });
    expect((await 项(b)).result).toBeNull();
  });

  it("确认时被「在等人判」拦下：申请失效并写原因；留下方在等判同样拦", async () => {
    let { a, b } = await 一对();
    const id = await 请(a, b);
    await raw.entLeadVerify.create({ data: { projectId: b, pending: "市场复核" } });
    const r = await 处理跨并申请(prisma, id, 销管, "确认");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("在等") });
    expect(await 申请(id)).toMatchObject({ status: "已失效", reason: expect.stringContaining("申请已失效") });
    expect((await 项(b)).result).toBeNull();
    ({ a, b } = await 一对());
    await raw.entLeadVerify.create({ data: { projectId: a, pending: "总管理终判" } });
    expect(await 发起跨负责人并(prisma, a, b, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("在等") });
  });

  it("并完之后撤回合并：原负责人没用掉的并走待补作废", async () => {
    const { a, b } = await 一对();
    await raw.entLeadAssign.create({ data: { projectId: b, toUserId: 丙.id, byUserId: 老板.id, month: 月份() } });
    const id = await 请(a, b);
    await 处理跨并申请(prisma, id, 销管, "确认");
    expect((await 待补数们([丙.id])).get(丙.id)).toBe(1);
    const mergeId = (await 申请(id)).mergeId!;
    expect(await 撤回项目合并(prisma, mergeId, 老板)).toMatchObject({ ok: true });
    expect((await 待补数们([丙.id])).get(丙.id) ?? 0).toBe(0);
    expect((await 项(b)).result).toBeNull();
  });
});

describe("暂停：待确认期间被并走那条新线索的验证时限和超时自动转暂停，结束后从头计时", () => {
  it("辅助：待确认 / 执行中算暂停；过了到期时刻还没扫到的不算；结束的给重新起算时刻（取最近一次）", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    const 到 = (await 申请(id)).expiresAt;
    expect([...(await 跨并暂停中的项目(prisma, [a, b], 周五下午))].sort()).toEqual([a, b].sort()); // 两条都暂停（方向无关，s1 审查建议 1）
    expect((await 跨并暂停中的项目(prisma, [b], 到)).size).toBe(0);
    await 撤回跨并申请(prisma, id, 乙, 京("2026-11-27 17:00"));
    expect((await 跨并暂停中的项目(prisma, [b])).size).toBe(0);
    expect((await 跨并重新起算时刻们(prisma, [b])).get(b)?.toISOString()).toBe(京("2026-11-27 17:00").toISOString());
    expect((await 跨并重新起算时刻们(prisma, [a])).get(a)?.toISOString()).toBe(京("2026-11-27 17:00").toISOString());
    const id2 = await 请(a, b, 乙, 京("2026-11-30 10:00"));
    await 处理跨并申请(prisma, id2, 销管, "拒绝", { 原因: "再看看", 现在: 京("2026-11-30 11:00") });
    expect((await 跨并重新起算时刻们(prisma, [b])).get(b)?.toISOString()).toBe(京("2026-11-30 11:00").toISOString());
  });

  describe("验证时限（重复咨询线索）", () => {
    // 北京 2026-12-02（周三）10:00 起；b 是丙名下重复咨询线索，初判无效交市场复核
    async function 备(): Promise<{ a: string; b: string; 市场: 人 }> {
      const 市场 = await 造人("mkt", "市场甲", "SALES");
      await raw.entMember.create({ data: { userId: 市场.id, bizRole: "marketing_mgr" } });
      await setSetting(超时转生效key, "2026-01-01T00:00:00.000Z");
      await setSetting(验证时限生效key, "2026-01-01T00:00:00.000Z");
      await setSetting(规则.超时自动转.key, true).catch(() => {});
      invalidateSettingsCache();
      const c = await 客户(乙.id);
      const a = await 项目(乙.id, c);
      const b = await 项目(丙.id, c, { node: "线索验证", source: "repeat-inquiry", creatorId: 市场.id });
      return { a, b, 市场 };
    }
    /** 待确认期间销售初判无效、交市场复核（人工判仍可进行；发起时在等人判会被拦，所以是发起之后才进） */
    const 初判无效于 = (b: string, 时: Date) =>
      raw.entLeadVerify.create({ data: { projectId: b, verdict: "初验无效", pending: "市场复核", verifiedAt: 时, verifiedById: 丙.id } });
    const 提醒数 = (userId: string) => raw.entNotice.count({ where: { userId, kind: 验证时限通知种类 } });

    it("待确认期间到点也不提醒、不落定；申请失效后从失效那刻重新计时：+1 小时提醒、再 +30 分钟落定", async () => {
      const { a, b, 市场 } = await 备();
      const id = await 请(a, b, 乙, 京("2026-12-02 10:05"));
      await 初判无效于(b, 京("2026-12-02 10:10"));
      expect(await 验证时限扫一遍(京("2026-12-02 11:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
      expect(await 验证时限扫一遍(京("2026-12-02 12:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
      expect(await 提醒数(市场.id)).toBe(0);
      expect((await 项(b)).result).toBeNull();
      // 12:10 申请失效（拒绝）→ 从 12:10 重新计
      await 处理跨并申请(prisma, id, 销管, "拒绝", { 原因: "不并", 现在: 京("2026-12-02 12:10") });
      expect((await 验证时限扫一遍(京("2026-12-02 13:09"))).提醒).toBe(0);
      expect((await 验证时限扫一遍(京("2026-12-02 13:10"))).提醒).toBe(1);
      expect(await 提醒数(市场.id)).toBe(1);
      expect((await 项(b)).result).toBeNull();
    });

    it("没有申请的线索照常：1 小时提醒（对照，证明上面是暂停造成的）", async () => {
      const { b, 市场 } = await 备();
      await 初判无效于(b, 京("2026-12-02 10:00"));
      expect((await 验证时限扫一遍(京("2026-12-02 11:00"))).提醒).toBe(1);
      expect(await 提醒数(市场.id)).toBe(1);
      expect(b).toBeTruthy();
    });

    it("5 个工作日到期失效（钟扫）也算结束：从到期那刻重新计时，而不是接着原来的", async () => {
      const { a, b } = await 备();
      const id = await 请(a, b, 乙, 京("2026-12-02 10:05"));
      await 初判无效于(b, 京("2026-12-02 10:10"));
      const 到 = (await 申请(id)).expiresAt; // 12-09 10:05
      expect((await 验证时限扫一遍(京("2026-12-08 10:00"))).提醒).toBe(0);
      await 扫过期跨并申请(prisma, 到);
      expect((await 申请(id)).status).toBe("已失效");
      expect((await 验证时限扫一遍(new Date(到.getTime() + 59 * 60_000))).提醒).toBe(0);
      expect((await 验证时限扫一遍(new Date(到.getTime() + 60 * 60_000))).提醒).toBe(1);
    });
  });

  describe("超时自动转", () => {
    it("对照：没有申请时同一条线索 11:00 就提醒负责人", async () => {
      await setSetting(规则.线索分配.key, true);
      await setSetting("enterprise.rule.org_scope", true);
      await setSetting(超时转生效key, 京("2026-01-01 00:00").toISOString());
      invalidateSettingsCache();
      const b = await 项目(丙.id, await 客户(乙.id), { phase: "线索", node: "潜客培育", replyEndAt: 京("2026-12-02 10:00") });
      await raw.entLeadAssign.create({ data: { projectId: b, toUserId: 丙.id, fromUserId: 老板.id, byUserId: 老板.id, month: "2026-12", counted: false, createdAt: (await 项(b)).createdAt } });
      await 超时转扫一遍(京("2026-12-02 11:00"));
      expect(await raw.entNotice.count({ where: { userId: 丙.id, kind: 超时通知种类 } })).toBe(1);
    });

    it("待确认期间到点不提醒、不转，起点每遍重置到现在；结束后从最后一遍起重新计 1 小时", async () => {
      await setSetting(规则.线索分配.key, true);
      await setSetting("enterprise.rule.org_scope", true);
      await setSetting(超时转生效key, 京("2026-01-01 00:00").toISOString());
      invalidateSettingsCache();
      const c = await 客户(乙.id);
      const a = await 项目(乙.id, c);
      const b = await 项目(丙.id, c, { phase: "线索", node: "潜客培育", replyEndAt: 京("2026-12-02 10:00") });
      await raw.entLeadAssign.create({ data: { projectId: b, toUserId: 丙.id, fromUserId: 老板.id, byUserId: 老板.id, month: "2026-12", counted: false, createdAt: (await 项(b)).createdAt } });
      const id = await 请(a, b, 乙, 京("2026-12-02 10:30"));
      const 通知 = () => raw.entNotice.count({ where: { userId: 丙.id, kind: 超时通知种类 } });
      await 超时转扫一遍(京("2026-12-02 11:00"));
      await 超时转扫一遍(京("2026-12-02 12:00"));
      expect(await 通知()).toBe(0); // 留下那条 a 是乙的，不在暂停里，照常；只看被并走那条的负责人
      expect((await 项(b)).ownerId).toBe(丙.id);
      await 撤回跨并申请(prisma, id, 乙, 京("2026-12-02 12:05"));
      // 最后一遍暂停扫描在 12:00：从那起 1 小时才提醒
      await 超时转扫一遍(京("2026-12-02 12:59"));
      expect(await 通知()).toBe(0);
      await 超时转扫一遍(京("2026-12-02 13:00"));
      expect(await 通知()).toBe(1);
    });
  });
});

describe("s1 审查修（必改 1–3 + 建议）", () => {
  it("必改 1：客户负责人是兼市场管理（销售管理 + 市场管理）的，这条路径不开", async () => {
    const 戊 = await 造人("wu", "戊兼市场", "SALES");
    await raw.entMember.create({ data: { userId: 戊.id, bizRole: "sales_mgr,marketing_mgr", line: "内贸" } });
    const c = await 客户(戊.id);
    const a = await 项目(乙.id, c), b = await 项目(丙.id, c);
    expect(await 发起跨负责人并(prisma, a, b, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("兼市场管理") });
    expect(await 跨并预览(prisma, a, b, 乙)).toMatchObject({ ok: false });
    expect(await raw.entProjectMergeRequest.count()).toBe(0);
  });

  it("必改 2：事务里再核——执行项目合并带「期望」，负责人 / 四项 / 另判有变整笔不并", async () => {
    const { a, b } = await 一对();
    const 基 = { 已核未开票: true, 现在: 周五下午 };
    const 信 = { 申请id: null, 发起人id: 销管.id, 确认人id: 销管.id, 发起方式: "本人发起" as const, 确认人层级: "实线上级" };
    // 空档里 b 被转给别人
    await raw.project.update({ where: { id: b }, data: { ownerId: 丁.id } });
    expect(await 执行项目合并(prisma, a, b, 销管, { ...基, 跨负责人: { ...信, 期望: { 留下负责人: 乙.id, 并掉负责人: 丙.id } } })).toMatchObject({ ok: false, error: expect.stringContaining("负责人") });
    expect((await 项(b)).result).toBeNull();
    await raw.project.update({ where: { id: b }, data: { ownerId: 丙.id } });
    // 四项：快照之后 b 被判无效
    const 快 = await 读快照(prisma, await 项(a) as never, await 项(b) as never);
    await raw.entLeadVerify.create({ data: { projectId: b, verdict: "初验无效" } });
    expect(await 执行项目合并(prisma, a, b, 销管, { ...基, 跨负责人: { ...信, 期望: { 留下负责人: 乙.id, 并掉负责人: 丙.id, 快照: 快 } } })).toMatchObject({ ok: false, error: expect.stringContaining("被判无效") });
    expect((await 项(b)).result).toBeNull();
    await raw.entLeadVerify.delete({ where: { projectId: b } });
    // 另判（确认人身份 / 客户负责人）不过
    expect(await 执行项目合并(prisma, a, b, 销管, { ...基, 跨负责人: { ...信, 期望: { 留下负责人: 乙.id, 并掉负责人: 丙.id, 另判: async () => "不行" } } })).toMatchObject({ ok: false, error: "不行" });
    expect((await 项(b)).result).toBeNull();
  });

  it("必改 2：确认时项目被转走 / 客户被转给渠运或兼市场管理（四项外）= 已失效、不并", async () => {
    let { a, b, c } = await 一对();
    let id = await 请(a, b);
    await raw.customer.update({ where: { id: c }, data: { salesOwnerId: 渠运.id } });
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: false, error: expect.stringContaining("不是销售") });
    expect(await 申请(id)).toMatchObject({ status: "已失效" });
    expect((await 项(b)).result).toBeNull();
    const 戊 = await 造人("wu", "戊兼市场", "SALES");
    await raw.entMember.create({ data: { userId: 戊.id, bizRole: "sales_mgr,marketing_mgr", line: "内贸" } });
    ({ a, b, c } = await 一对());
    id = await 请(a, b);
    await raw.customer.update({ where: { id: c }, data: { salesOwnerId: 戊.id } });
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: false, error: expect.stringContaining("兼市场管理") });
    expect((await 项(b)).result).toBeNull();
  });

  it("必改 3：卡在「执行中」的申请到期被扫成已失效，暂停解除；没到期的执行中仍算暂停", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    await raw.entProjectMergeRequest.update({ where: { id }, data: { status: "执行中" } });
    const 到 = (await 申请(id)).expiresAt;
    expect((await 跨并暂停中的项目(prisma, [b], 周五下午)).has(b)).toBe(true);
    expect((await 跨并暂停中的项目(prisma, [b], 到)).has(b)).toBe(false);
    expect(await 扫过期跨并申请(prisma, new Date(到.getTime() - 1))).toBe(0);
    expect(await 扫过期跨并申请(prisma, 到)).toBe(1);
    expect(await 申请(id)).toMatchObject({ status: "已失效" });
    expect((await 跨并暂停中的项目(prisma, [b], 到)).size).toBe(0);
    expect((await 发起跨负责人并(prisma, a, b, 乙, { 现在: 到 })).ok).toBe(true); // 不再被「在等确认」挡
  });

  it("建议 2：系统管理员作废待确认申请（原因必填）；非系统管理员不行", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    expect(await 作废跨并申请(prisma, id, 销管, "不该并")).toMatchObject({ ok: false, error: expect.stringContaining("系统管理员") });
    expect(await 作废跨并申请(prisma, id, 老板, " ")).toMatchObject({ ok: false });
    expect(await 作废跨并申请(prisma, id, 老板, "不该并")).toMatchObject({ ok: true });
    expect(await 申请(id)).toMatchObject({ status: "已失效", reason: "不该并", endedById: 老板.id });
    expect(await 作废跨并申请(prisma, id, 老板, "再来")).toMatchObject({ ok: false });
    expect(await raw.auditLog.count({ where: { action: "project-merge-request-void", entityId: { in: [a, b] } } })).toBe(2);
    expect((await 发起跨负责人并(prisma, a, b, 乙)).ok).toBe(true);
  });
});

describe("s2 审查修 M1：申请确认并成后，确认人和发起人都能撤回（方案 E）", () => {
  const 并好 = async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: true });
    return { a, b, mergeId: (await 申请(id)).mergeId! };
  };
  it("确认人能撤", async () => {
    const { b, mergeId } = await 并好();
    expect(await 撤回项目合并(prisma, mergeId, 销管)).toMatchObject({ ok: true });
    expect((await 项(b)).result).toBeNull();
  });
  it("发起人（留下项目的负责人）能撤", async () => {
    const { b, mergeId } = await 并好();
    expect(await 撤回项目合并(prisma, mergeId, 乙)).toMatchObject({ ok: true });
    expect((await 项(b)).result).toBeNull();
  });
  it("留下的项目换了负责人后，确认人和发起人都不能撤，系统管理员能", async () => {
    const { a, mergeId } = await 并好();
    await raw.project.update({ where: { id: a }, data: { ownerId: 丁.id } });
    expect(await 撤回项目合并(prisma, mergeId, 销管)).toMatchObject({ ok: false, error: expect.stringContaining("系统管理员") });
    expect(await 撤回项目合并(prisma, mergeId, 乙)).toMatchObject({ ok: false, error: expect.stringContaining("系统管理员") });
    expect(await 撤回项目合并(prisma, mergeId, 老板)).toMatchObject({ ok: true });
  });
  it("无关人不能撤", async () => {
    const { mergeId } = await 并好();
    expect(await 撤回项目合并(prisma, mergeId, 丁)).toMatchObject({ ok: false, error: expect.stringContaining("只有合并的人") });
    expect(await 撤回项目合并(prisma, mergeId, 丙)).toMatchObject({ ok: false, error: expect.stringContaining("只有合并的人") });
  });
  it("项目的合并单：撤回按钮对确认人、发起人出现，无关人不出", async () => {
    const { a, mergeId } = await 并好();
    const { 项目的合并单 } = await import("@/lib/enterprise/project-merge");
    for (const [我, 要] of [[销管, true], [乙, true], [丁, false]] as const) {
      expect((await 项目的合并单(prisma, a, 我)).find((m) => m.id === mergeId)?.能撤).toBe(要);
    }
  });
});

describe("s2 审查修 S4 / S5：并后通知", () => {
  const 通 = (userId: string) => raw.entNotice.findMany({ where: { userId, kind: 项目合并通知种类 } });
  it("系统管理员代并：被并走的原负责人收的链接去被并掉的项目；留下项目的负责人也收一条，链接去留下的项目", async () => {
    const { a, b } = await 一对();
    expect((await 发起跨负责人并(prisma, a, b, 老板)).ok).toBe(true);
    await 等通知推完();
    expect((await 通(丙.id)).map((n) => n.link)).toEqual([`/projects/${b}`]);
    expect((await 通(乙.id)).map((n) => n.link)).toEqual([`/projects/${a}`]);
  });
  it("留下项目的负责人自己发起并（本人发起）不给自己发；申请确认的发起人也不重复收", async () => {
    const { a, b } = await 一对();
    await 处理跨并申请(prisma, await 请(a, b), 销管, "确认");
    await 等通知推完();
    expect(await 通(乙.id)).toEqual([]);
    expect((await 通(丙.id)).map((n) => n.link)).toEqual([`/projects/${b}`]);
  });
});

describe("s2 审查修 S1：等我确认的 = 存的名单 ∪ 现算的", () => {
  it("存的确认人（销管）调走后，新上级也算确认人；无关人不算", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b);
    const r = await 申请(id);
    const 线 = (await 项(b)).bizLine;
    expect(是确认人of(await 读组织(), r, 线, 销管.id)).toBe(true);
    // 丙换了一位上级（原上级销管不再是实线上级）：存的名单里还有销管（还在职），新上级现算进来
    const 新 = await 造人("xg2", "销管乙", "SALES");
    await raw.entMember.create({ data: { userId: 新.id, bizRole: "sales_mgr", line: "内贸" } });
    await raw.entMember.update({ where: { userId: 丙.id }, data: { managerId: 新.id } });
    expect(是确认人of(await 读组织(), r, 线, 新.id)).toBe(true);
    expect(是确认人of(await 读组织(), r, 线, 丁.id)).toBe(false);
  });
});
