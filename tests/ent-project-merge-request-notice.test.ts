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
import { 到期时刻 } from "@/lib/enterprise/merge-request";
import {
  发起跨负责人并, 处理跨并申请, 撤回跨并申请, 扫过期跨并申请,
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


import { 跨并通知, 跨并通知种类, 跨并申请页 } from "@/lib/enterprise/project-merge-request-notice";

const 通知们 = (userId: string) => raw.entNotice.findMany({ where: { userId, kind: 跨并通知种类 }, orderBy: { createdAt: "asc" } });

describe("跨负责人合并通知：发起 / 确认 / 拒绝 / 到期失效 / 撤回各一条，收件人照方案，链接落到申请页", () => {
  it("发起 → 每位确认人一条（发起人不收），链接 = 申请页；同一张重复调用不重发", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b, 乙);
    await 跨并通知(prisma, id, "发起", 乙);
    await 跨并通知(prisma, id, "发起", 乙);
    await 等通知推完();
    for (const u of [销管, 线总]) {
      const 们 = await 通知们(u.id);
      expect(们).toHaveLength(1);
      expect(们[0].link).toBe(跨并申请页);
      expect(们[0].title).toContain("乙发来跨负责人合并申请");
    }
    expect(await 通知们(乙.id)).toHaveLength(0);
  });

  it("确认 → 发起人 + 其余确认人（点确认的自己不收）；拒绝 → 带原因", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b, 乙);
    const r = await 处理跨并申请(prisma, id, 销管, "确认", { 现在: 周五下午 });
    expect(r.ok).toBe(true);
    await 跨并通知(prisma, id, "确认", 销管);
    await 等通知推完();
    expect((await 通知们(乙.id)).map((n) => n.title)).toEqual([expect.stringContaining("销管甲确认了跨负责人合并")]);
    expect(await 通知们(销管.id)).toHaveLength(0);
    expect(await 通知们(线总.id)).toHaveLength(1);

    const x = await 一对();
    const id2 = await 请(x.a, x.b, 乙);
    await 处理跨并申请(prisma, id2, 线总, "拒绝", { 原因: "还在跟进", 现在: 周五下午 });
    await 跨并通知(prisma, id2, "拒绝", 线总, "还在跟进");
    await 等通知推完();
    expect((await 通知们(乙.id)).at(-1)!.body).toContain("原因：还在跟进");
  });

  it("到期失效（钟扫）→ 发起人 + 确认人各一条；撤回 → 确认人", async () => {
    const { a, b } = await 一对();
    await 请(a, b, 乙);
    const 到 = 到期时刻(周五下午);
    expect(await 扫过期跨并申请(prisma, new Date(到.getTime() + 1000))).toBe(1);
    await 等通知推完();
    expect((await 通知们(乙.id)).map((n) => n.title)).toEqual([expect.stringContaining("已失效")]);
    expect(await 通知们(销管.id)).toHaveLength(1);
    const y = await 一对();
    const id2 = await 请(y.a, y.b, 乙);
    expect((await 撤回跨并申请(prisma, id2, 乙, 周五下午)).ok).toBe(true);
    await 跨并通知(prisma, id2, "撤回", 乙);
    await 等通知推完();
    expect((await 通知们(销管.id)).at(-1)!.title).toContain("乙撤回了");
  });
});
