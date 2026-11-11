/**
 * 企业版「交付结清」结局认验收报告附件（M-必填-11，客户 11-08「验收报告用附件，有上传就算过」）：
 * 验收那一条 = 勾了「验收通过」或项目附件「验收报告」里有一份，任一成立就过；尾款结清照旧要勾。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改节点 } from "@/lib/project/db";
import { 改节点问题, 交付还差话 } from "@/lib/project/nodes";
import { 企业版字典 } from "@/lib/project/stage-dict";
import { invalidateSettingsCache } from "@/lib/settings";

let 乙: { id: string; name: string; role: string };
let 客户: string;

const 项目 = (补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "订单", node: "尾款结算", balanceSettled: true, ...补 } });
const 传验收报告 = (projectId: string, tag = "验收报告") =>
  prisma.attachment.create({ data: { projectId, tag, name: "验收单.pdf", mime: "application/pdf", size: 10, sha256: "x" } });
const 点交付 = (id: string) => 改节点(乙, id, { phase: "订单", node: "尾款结算", result: "交付结清" });
const 结局 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).result;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  const u = await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } });
  乙 = { id: u.id, name: u.name, role: "SALES" };
  await prisma.entMember.create({ data: { userId: 乙.id, bizRole: "sales" } });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙.id } })).id;
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("交付结清：验收通过 或 验收报告附件", () => {
  it("只勾了验收通过：能点", async () => {
    const p = await 项目({ acceptancePassed: true });
    expect(await 点交付(p.id)).toMatchObject({ ok: true });
    expect(await 结局(p.id)).toBe("交付结清");
  });

  it("只有验收报告附件（没勾验收通过）：能点", async () => {
    const p = await 项目();
    await 传验收报告(p.id);
    expect(await 点交付(p.id)).toMatchObject({ ok: true });
    expect(await 结局(p.id)).toBe("交付结清");
  });

  it("两个都没有：拦，提示说两种都行；别格的附件（合同）不算", async () => {
    const p = await 项目();
    await 传验收报告(p.id, "合同");
    const r = await 点交付(p.id);
    expect(r).toEqual({ ok: false, error: "还差验收才能点交付结清：验收勾上「验收通过」或在项目附件「验收报告」里传一份，任一就行" });
    expect(await 结局(p.id)).toBeNull();
  });

  it("两个都有：能点", async () => {
    const p = await 项目({ acceptancePassed: true });
    await 传验收报告(p.id);
    expect(await 点交付(p.id)).toMatchObject({ ok: true });
  });

  it("有验收报告但尾款没结清：照旧拦尾款结清", async () => {
    const p = await 项目({ balanceSettled: false });
    await 传验收报告(p.id);
    expect(await 点交付(p.id)).toEqual({ ok: false, error: "还差尾款结清，勾上才能点交付结清" });
  });

  it("尾款、验收都没过：一句话说两样", () => {
    const 到 = { phase: "订单", node: "尾款结算", result: "交付结清" };
    const 现 = { phase: "订单", node: "尾款结算", balanceSettled: false, acceptancePassed: false };
    expect(改节点问题(到, 现, undefined, true, 企业版字典)).toBe(
      "还差尾款结清、验收才能点交付结清：尾款结清要勾上；验收勾上「验收通过」或在项目附件「验收报告」里传一份，任一就行",
    );
    expect(改节点问题(到, { ...现, balanceSettled: true, 有验收报告: true }, undefined, true, 企业版字典)).toBeNull();
    // 团队版话术不变
    expect(交付还差话(["验收通过"], "成功交付", false)).toBe("还差验收通过，勾上才能点成功交付");
  });
});
