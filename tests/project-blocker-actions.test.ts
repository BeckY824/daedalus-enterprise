/**
 * 卡点接口（projects/blocker-actions.ts，11-01 改版）：项目模式关着、不是企业版一律拦、一行不写；做成了留一条操作记录。
 * 11-01 起没有指认 / 接受 / 转让 / 退回 / 改进度 / 可选的人：只剩发布、认领、我已完成，加设置和原因字典
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
  开: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 记项目沟通 } from "@/lib/project/db";
import * as 接口 from "@/app/(app)/projects/blocker-actions";
import {
  发布卡点Action, 认领卡点Action, 完成卡点Action, 存卡点默认Action, 存卡点角色开关Action,
  新增原因Action, 改原因名Action, 改原因状态Action, 删原因Action, 合并原因Action, 我的卡点Action,
} from "@/app/(app)/projects/blocker-actions";
import { invalidateSettingsCache } from "@/lib/settings";
import { 北京日期 } from "./helpers/beijing-date";

let 甲: string;
let 项目id: string;
let 沟通id: string;
const 卡 = { description: "报价高" };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.开 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  mocks.user = { ...mocks.user, id: 甲, role: "ADMIN" };
  // 11-01 权限只认业务角色：甲 既是项目负责人（销售管理，记沟通、发卡点要能编辑项目）又是总管理（改卡点默认）；bizRole 逗号多角色
  await prisma.entMember.create({ data: { userId: 甲, bizRole: "sales_mgr,director" } });
  const c = await prisma.customer.create({ data: { name: "客户", phone: "13800000001", salesOwnerId: 甲 } });
  项目id = (await prisma.project.create({ data: { name: "一期", customerId: c.id, ownerId: 甲, creatorId: 甲 } })).id;
  const r = await 记项目沟通({ id: 甲, role: "ADMIN" }, 项目id, { type: "PHONE", content: "聊了", occurredAt: 北京日期(), 阶段: "线索", 明确回复: true });
  沟通id = r.followUpId!;
});
afterEach(() => { vi.unstubAllEnvs(); });

async function 全拦(期望: string) {
  const b = await prisma.entBlocker.create({
    data: { code: "BLK-20261026-999", title: "老的", projectId: 项目id, followUpId: 沟通id, customerId: (await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).customerId, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格", description: "x", dueDays: 3, dueAt: new Date(), creatorId: 甲 },
  });
  for (const x of [
    await 发布卡点Action(沟通id, 卡), await 认领卡点Action(b.id),
    await 完成卡点Action(b.id, { solution: "x", result: "y" }), await 存卡点默认Action({ 默认类型: "轻度卡点" }),
    await 存卡点角色开关Action({ 启用: { sales: false } }),
    await 新增原因Action("新原因"), await 改原因名Action("x", "y"), await 改原因状态Action("x", "停用"),
    await 删原因Action("x"), await 合并原因Action("x", "y"),
  ]) expect(x).toMatchObject({ ok: false, error: expect.stringContaining(期望) });
  expect(await 我的卡点Action()).toEqual([]);
  expect(await prisma.entBlocker.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "待接受", assigneeId: null });
  expect(await prisma.entBlocker.count()).toBe(1);
  expect(await prisma.entBlockerClaim.count()).toBe(0);
  expect(await prisma.entBlockerLog.count()).toBe(0);
  expect(await prisma.entBlockerReason.count({ where: { name: "新原因" } })).toBe(0);
  expect(await prisma.auditLog.count({ where: { entity: { in: ["EntBlocker", "EntBlockerReason"] } } })).toBe(0);
}

describe("卡点接口", () => {
  it("指认 / 接受 / 转让 / 退回 / 改进度 / 可选的人 都没了；看板只走页面、没有单独的动作", () => {
    for (const k of ["指认卡点Action", "接受卡点Action", "转让卡点Action", "返回卡点Action", "改卡点进度Action", "解决卡点Action", "卡点可选的人Action", "卡点看板Action"]) {
      expect(k in 接口).toBe(false);
    }
  });

  it("项目模式关着：全拦", async () => {
    mocks.开 = false;
    await 全拦("项目模式没开");
  });

  it("不是企业版：全拦", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    await 全拦("企业版");
  });

  it("做成了：发布、认领、我已完成各留一条操作记录", async () => {
    const r = await 发布卡点Action(沟通id, 卡);
    expect(r).toMatchObject({ ok: true, code: expect.stringMatching(/^BLK-\d{8}-001$/) });
    const b = await prisma.entBlocker.findFirstOrThrow();
    expect(await 认领卡点Action(b.id)).toEqual({ ok: true, 解决了: false });
    expect((await 我的卡点Action()).map((x) => x.id)).toEqual([b.id]);
    expect(await 完成卡点Action(b.id, {})).toMatchObject({ ok: false });
    expect(await 完成卡点Action(b.id, { solution: "降价", result: "签了" })).toEqual({ ok: true, 解决了: true });
    const 记录 = await prisma.auditLog.findMany({ where: { entity: "EntBlocker" }, orderBy: { at: "asc" }, select: { summary: true } });
    expect(记录.map((x) => x.summary)).toEqual([`发布卡点 ${b.code}`, `认领卡点 ${b.code}`, `卡点 ${b.code} 已解决`]);
    expect(await prisma.entBlocker.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "已解决", solution: "降价", result: "签了" });
  });

  it("暂无卡点：ok 不带 code、不写记录", async () => {
    expect(await 发布卡点Action(沟通id, { type: "暂无卡点", description: "" })).toEqual({ ok: true, code: undefined });
    expect(await prisma.entBlocker.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entity: "EntBlocker" } })).toBe(0);
  });

  it("原因字典：总管理员新增留一条记录、返回字典", async () => {
    const r = await 新增原因Action("交期太紧");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok || !("字典" in r)) throw new Error("应返回字典");
    expect(r.字典.some((x) => x.name === "交期太紧" && x.status === "启用")).toBe(true);
    expect(await prisma.auditLog.count({ where: { entity: "EntBlockerReason" } })).toBe(1);
  });
});
