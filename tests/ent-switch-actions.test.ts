/**
 * 设置开关 N4 / N5（11-23）：开关总览的两个读动作服务端各自判「能进设置」。
 *   - 条线总管理、销售管理（账号 ADMIN 也一样）、只读管理员、市场管理、销售、勾了「不管设置」的总管理：都 403，什么都不给
 *   - 系统管理员：开关现状 给齐 17 项的值（子开关在父开关关着时照实给）、持有上限先数、字段权限表改没改过
 *   - 读开关改动：每个开关最近一次真变了的那行（orgRules 相邻两行比），比不出写「改了项目规则」
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 开关现状, 读开关改动 } from "@/app/(app)/settings/switch-actions";
import { 改组织规则 } from "@/app/(app)/projects/actions";
import { 设规则 } from "@/app/(app)/settings/org-actions";
import { 默认组织规则 } from "@/lib/project/org-rules";

let 系统: string, 不管设置: string;
const 别人们: string[] = [];
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: id === 系统 ? "系统管理员甲" : "别人" }; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  别人们.length = 0;
  const 建人 = async (email: string, bizRole: string, extra: { line?: string; role?: string; noSettings?: boolean } = {}) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: extra.role ?? "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line: extra.line ?? null, noSettings: extra.noSettings ?? false } });
    return id;
  };
  系统 = await 建人("sys", "director", { role: "ADMIN" });
  不管设置 = await 建人("nos", "director", { noSettings: true });
  别人们.push(await 建人("linedir", "director", { line: "外贸" }), await 建人("smgr", "sales_mgr", { role: "ADMIN" }),
    await 建人("adm", "admin", { role: "ADMIN" }), await 建人("mkt", "marketing_mgr"), await 建人("s", "sales"));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("只有系统管理员拿得到", () => {
  it("别的身份、勾了不管设置的总管理：两个读动作都 403", async () => {
    for (const id of [...别人们, 不管设置]) {
      当(id);
      expect(await 开关现状()).toMatchObject({ ok: false, status: 403 });
      expect(await 读开关改动()).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("不是企业版：404", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    当(系统, "ADMIN");
    expect(await 开关现状()).toMatchObject({ ok: false, status: 404 });
  });
});

describe("系统管理员", () => {
  beforeEach(() => 当(系统, "ADMIN"));

  it("开关现状：17 项的值、默认值；父开关关着子开关照实给；字段权限表没改过", async () => {
    await setSetting("enterprise.lead_assign.no_quota", true);
    const r = await 开关现状();
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.值).sort()).toHaveLength(17);
    expect(r.值).toMatchObject({ org_scope: false, lead_assign: false, no_quota: true, reply_overdue: true, market_review: true, lead_giveup: false, push_perm: "负责人可推", hold_cap: false, tri_state: false });
    expect(r.字段权限表改过).toBe(false);
    expect(r.全员).toBe(7);
    expect(r.持有上限).toEqual({ 默认上限: 30, 单设人数: 0, 到上限: 0 });
  });

  it("读开关改动：单键开关认打开 / 关掉；组织规则相邻两行比出是哪个开关变了；最早那行比不出写「改了项目规则」", async () => {
    expect(await 设规则(true, "主动放弃")).toEqual({ ok: true });
    expect(await 改组织规则({ 公海: { 默认上限: 8 } })).toMatchObject({ ok: true });
    expect(await 改组织规则({ 阶段: { 前两节点要沟通: true } })).toMatchObject({ ok: true });
    expect(await 改组织规则({ 节点推进: { 开: true } })).toMatchObject({ ok: true });
    const r = await 读开关改动();
    if (!r.ok) throw new Error(r.error);
    expect(r.上次.lead_giveup).toMatchObject({ 谁: "系统管理员甲", 动作: "打开" });
    expect(r.上次.first_two).toMatchObject({ 动作: "打开" });
    expect(r.上次.node_advance).toMatchObject({ 动作: "打开" });
    // 第一行（改默认上限）没有上一行可比：持有上限和没找到的开关都算「改了项目规则」
    expect(r.上次.hold_cap).toMatchObject({ 动作: "改了项目规则" });
    expect(r.上次.org_scope).toBeUndefined();
    // 操作日志摘要写的是哪项从什么变成什么（N9）
    const 摘要 = (await prisma.auditLog.findMany({ where: { entityId: "orgRules" }, orderBy: [{ at: "asc" }, { id: "asc" }] })).map((x) => x.summary);
    expect(摘要).toEqual(["组织规则：项目持有上限默认：30 个 → 8 个", "组织规则：前两个进程要沟通：关 → 开", "组织规则：节点推进：关 → 开"]);
    expect(默认组织规则.阶段.前两节点要沟通).toBe(false);
  });
});
