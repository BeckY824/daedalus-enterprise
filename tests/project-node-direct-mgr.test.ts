/**
 * 企业版推节点（11-01 起权限只认业务角色）：
 *   - 改节点和别的项目内容一个口径（C2）：只有负责人本人（销售 / 销售管理）能改；直属上级、隔级经理、虚线上级、
 *     条线总管理、管理员都只能看、转让，不再代推（原 D-37「直属上级代推」被 C2 盖掉）；系统管理员能推（V3.5.1）
 *   - 默认「负责人可推」：负责人本人能往前推、记的是本人
 *   - 「仅上级推」：负责人有直属上级时本人往前推被拦，直属上级只给往前推这一步（11-01 闭环：不然开着时谁都推不动）；
 *     往后退、点结局、改别的照旧只给负责人
 *   - 往后退、点结局照旧（负责人本人能）
 *   - 负责人没设直属上级：本人能推
 *   - 账号 ADMIN 没设业务角色：什么都改不了
 *   - 不是企业版：组织表配着也不拦
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { 缺有效沟通 } from "@/lib/project/stage-gates";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改节点, 往前推不给, 能改节点, 直属才推, 只有负责人改进程 } from "@/lib/project/db";
import { 读组织 } from "@/lib/enterprise/org";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 记有效沟通 } from "./helpers/ent-valid-followup";

type 人 = { id: string; role: string };

describe("企业版推节点只给负责人本人", () => {
  let 老板: 人, 经理: 人, 组长: 人, 虚: 人, 销售: 人, 散: 人;
  let 客户: string;

  async function 建(email: string, role: string): Promise<人> {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    return { id: u.id, role };
  }
  const 项目 = (ownerId: string, 补: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: "项目", customerId: 客户, ownerId, creatorId: ownerId, ...补 } });
  const 往前 = { phase: "线索", node: "线索验证" };
  const 仅上级 = { ...默认组织规则, 阶段: { 推进权限: "仅上级推" as const, 出口叫法: {}, 前两节点要沟通: false } };

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    老板 = await 建("boss", "ADMIN");
    经理 = await 建("mgr", "MANAGER");
    组长 = await 建("lead", "MANAGER");
    虚 = await 建("dotted", "MANAGER");
    销售 = await 建("sales", "SALES");
    散 = await 建("loose", "SALES");
    await prisma.entMember.createMany({
      data: [
        { userId: 经理.id, bizRole: "sales_mgr" },
        { userId: 组长.id, bizRole: "sales_mgr", managerId: 经理.id },
        { userId: 虚.id, bizRole: "sales_mgr" },
        { userId: 销售.id, managerId: 组长.id, dottedManagerId: 虚.id },
        { userId: 散.id },
      ],
    });
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 销售.id } })).id;
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("enterprise.rule.org_scope", true);
    await setSetting("orgRules", 仅上级);
    invalidateSettingsCache();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("仅上级推：本人往前推被拦；隔级经理、虚线上级、账号 ADMIN 没业务角色的改不了；直属上级能往前推、记的是他", async () => {
    const p = await 项目(销售.id);
    await 记有效沟通(p.id);
    expect(await 改节点(销售, p.id, 往前)).toEqual({ ok: false, error: "往前推进程要由你的直属上级来推" });
    for (const 谁 of [经理, 虚, 老板]) {
      expect(await 改节点(谁, p.id, 往前)).toEqual({ ok: false, error: 只有负责人改进程 });
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).node).toBe("潜客培育");
    expect(await prisma.projectNodeLog.count({ where: { projectId: p.id } })).toBe(0);
    // 11-01 闭环：直属上级只给往前推这一步
    expect(await 改节点(组长, p.id, 往前)).toMatchObject({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).node).toBe("线索验证");
    expect((await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id } })).userId).toBe(组长.id);
  });

  it("往后退、点结局照旧：本人也能", async () => {
    const p = await 项目(销售.id, { node: "线索推进" });
    expect(await 改节点(销售, p.id, 往前)).toMatchObject({ ok: true });
    expect(await 改节点(销售, p.id, { ...往前, result: "线索流失" }, { 备注: "联系不上" })).toMatchObject({ ok: true });
  });

  it("上级退回、定结果也不行（C2，仅上级推开着也只放往前推）；能改节点只给负责人本人", async () => {
    const 线 = await 项目(销售.id, { node: "线索推进" });
    expect(await 改节点(组长, 线.id, 往前)).toEqual({ ok: false, error: 只有负责人改进程 });
    expect(await 改节点(组长, 线.id, { ...往前, result: "线索流失" }, { 备注: "预算砍了" })).toEqual({ ok: false, error: 只有负责人改进程 });
    const org = await 读组织();
    expect(能改节点(销售, { ownerId: 销售.id }, org)).toBe(true);
    expect(能改节点(销售, { ownerId: 销售.id, pooledAt: new Date() }, org)).toBe(false);
    expect(能改节点(组长, { ownerId: 销售.id }, org)).toBe(false);
    expect(能改节点(老板, { ownerId: 销售.id }, org)).toBe(false);
  });

  it("条线总管理、管理员：谁的项目都改不了节点（只能看、转让）；系统管理员（总管理、没设线）能推（V3.5.1）", async () => {
    for (const [bizRole, line] of [["director", "外贸"], ["admin", null]] as const) {
      const 总 = await 建(`top-${bizRole}`, "MANAGER");
      await prisma.entMember.create({ data: { userId: 总.id, bizRole, line } });
      const p = await 项目(销售.id);
      await 记有效沟通(p.id);
      const r = await 改节点(总, p.id, 往前);
      expect(r).toMatchObject({ ok: false });
      expect(await prisma.projectNodeLog.count({ where: { projectId: p.id } })).toBe(0);
    }
    const 系管 = await 建("top-sys", "MANAGER");
    await prisma.entMember.create({ data: { userId: 系管.id, bizRole: "director" } });
    const p = await 项目(销售.id);
    await 记有效沟通(p.id);
    expect(往前推不给(系管, 销售.id, await 读组织())).toBeNull();
    expect(await 改节点(系管, p.id, 往前)).toMatchObject({ ok: true });
  });

  it("负责人没设直属上级：照旧，本人能推", async () => {
    const p = await 项目(散.id);
    expect(await 改节点(散, p.id, 往前)).toMatchObject({ ok: true });
  });

  it("「按组织架构看客户」关着：本人能推（仅上级推不拦）；直属上级照样改不了内容", async () => {
    await setSetting("enterprise.rule.org_scope", false);
    invalidateSettingsCache();
    const p = await 项目(销售.id);
    await 记有效沟通(p.id);
    expect(await 直属才推(await 读组织())).toBeNull();
    expect(await 改节点(销售, p.id, 往前)).toMatchObject({ ok: true });
    expect(await 改节点(组长, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 只有负责人改进程 });
  });

  it("默认「负责人可推」（10-26）：负责人本人能往前推、记的是本人；隔级经理、虚线上级改不了", async () => {
    await setSetting("orgRules", 默认组织规则);
    invalidateSettingsCache();
    const p = await 项目(销售.id);
    expect(往前推不给(销售, 销售.id, await 读组织(), true)).toBeNull();
    expect(await 改节点(销售, p.id, 往前)).toMatchObject({ ok: true });
    expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id, toNode: "线索验证" } })).toMatchObject({ userId: 销售.id });
    for (const 谁 of [经理, 虚]) {
      expect(await 改节点(谁, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 只有负责人改进程 });
    }
    // 本人越过线索验证：还要先有有效沟通（11-05 起 = 线索验证的必填齐；没配看需求状态）
    expect(await 改节点(销售, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: false, error: expect.stringContaining(缺有效沟通) });
    await 记有效沟通(p.id);
    expect(await 改节点(销售, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: true });
  });

  it("不是企业版：组织配着也不拦", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const p = await 项目(销售.id);
    expect(await 改节点(销售, p.id, 往前)).toMatchObject({ ok: true });
    expect(往前推不给(销售, 销售.id, null)).toBeNull();
  });
});
