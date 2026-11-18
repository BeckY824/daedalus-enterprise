/**
 * 企业版「指定分配时间」定时分配（11-17，两字段方案 PR3，lib/enterprise/scheduled-assign.ts）：
 * 建的时候选「指定时间」= 留在录入人名下待分配（定时），不发催分提醒；到点按当时规则分（指定 / 自动），照常通知、操作人记系统；
 * 到点前改 / 取消 / 改成现在分配；清了待分配标记、进回收站 = 作废；停机补跑；30 天上限；分不出去留待分配并提醒。
 * 走首页 AI 新线索卡（applyProposal → 建档向导，和建档向导、客户页新增项目同一个 建好再分）。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { 定时分配扫一遍 } from "@/lib/enterprise/scheduled-assign";
import { 改定时分配, 取消定时分配, 定时分配现在分 } from "@/app/(app)/leads/schedule-actions";
import { 分配线索 } from "@/app/(app)/leads/assign-actions";
import { 认定时分配, 时刻转北京墙钟, 指定分配最远天数 } from "@/lib/project/time-fields";

type 人 = { id: string; name: string };
let 老板: 人, 市场: 人, 乙: 人, 丙: 人;
async function 造人(email: string, name: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };
let 序 = 0;
const 卡 = (补: Record<string, unknown> = {}) => ({
  id: `p${++序}`, kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
  name: `星河电子${序}`, contact: "周经理", phone: `1380000${String(序).padStart(4, "0")}`, source: "展会", status: "待跟进", remark: "",
  业务线: "内贸", 节点: "潜客培育", ...补,
});
const 唯一项目 = () => prisma.project.findFirstOrThrow({ include: { customer: true } });
/** 从现在往后 n 小时（到分钟）的北京墙钟，和它的时刻 */
const 后 = (小时: number) => {
  const 墙 = 时刻转北京墙钟(new Date(Date.now() + 小时 * 3_600_000))!;
  return { 墙, at: new Date(`${墙.replace(" ", "T")}:00+08:00`) };
};
const 加分钟 = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
const 通知 = (userId: string) => prisma.entNotice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板");
  市场 = await 造人("mkt", "市场");
  乙 = await 造人("yi", "乙");
  丙 = await 造人("bing", "丙");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 市场.id, bizRole: "marketing_mgr" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "外贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
  await prisma.channel.create({ data: { name: "展会", channelOwnerId: 老板.id } });
  invalidateSettingsCache();
  当(市场);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); invalidateSettingsCache(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("指定时间认一遍（30 天上限）", () => {
  it("要晚于现在、最远 30 天；空、认不出拦下", () => {
    const 今 = new Date("2026-11-17T01:00:00Z");
    expect(认定时分配("2026-11-17 09:00", 今).ok).toBe(false); // = 现在
    expect(认定时分配("2026-11-17 09:01", 今).ok).toBe(true);
    expect(认定时分配("2026-12-17 09:00", 今).ok).toBe(true); // 正好 30 天
    expect(认定时分配("2026-12-17 09:01", 今)).toEqual({ ok: false, error: `指定分配时间最远 ${指定分配最远天数} 天内` });
    expect(认定时分配("", 今).ok).toBe(false);
    expect(认定时分配("下周一", 今).ok).toBe(false);
  });
  it("建的时候超过 30 天整笔不建", async () => {
    const r = await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 后(24 * 31).墙 }) as never);
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.project.count()).toBe(0);
  });
});

describe("建的时候：留在录入人名下待分配（定时），不发催分提醒", () => {
  it("指定分配 + 指定时间：负责人 = 录入人、客户也留在录入人名下、标待分配和定时；乙、能分配的人都没收到通知", async () => {
    const { 墙, at } = 后(2);
    expect(await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.ownerId, p.customer.salesOwnerId, p.creatorId, p.assignMode]).toEqual([市场.id, 市场.id, 市场.id, "指定分配"]);
    expect(p.awaitAssignAt).not.toBeNull();
    expect(p.scheduledAssignAt).toEqual(at);
    expect(p.scheduledAssignTo).toBe(乙.id);
    expect(await 通知(乙.id)).toHaveLength(0);
    expect(await 通知(老板.id)).toHaveLength(0);
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("自动分配 + 指定时间：建在我名下待分配，不当场分", async () => {
    expect(await applyProposal(卡({ 分配方式: 1, 定时分配: 后(2).墙 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.ownerId, p.scheduledAssignTo]).toEqual([市场.id, null]);
    expect(p.scheduledAssignAt).not.toBeNull();
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("现在分配（不带指定时间）照旧：指定分配当场给乙", async () => {
    expect(await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.ownerId, p.scheduledAssignAt]).toEqual([乙.id, null]);
  });
});

describe("到点执行（钟上每分钟一遍）", () => {
  it("没到点不动；到点指定分配给乙：清待分配和定时、客户随行（市场首次分给销售）、留痕记系统、乙收到「分给你」带原定时间", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never);
    expect(await 定时分配扫一遍(加分钟(at, -1))).toMatchObject({ 执行: 0 });
    expect((await 唯一项目()).ownerId).toBe(市场.id);
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 1, 没分出去: 0 });
    const p = await 唯一项目();
    expect([p.ownerId, p.awaitAssignAt, p.scheduledAssignAt, p.scheduledAssignTo, p.customer.salesOwnerId]).toEqual([乙.id, null, null, null, 乙.id]);
    const 记 = await prisma.entLeadAssign.findFirstOrThrow();
    expect([记.toUserId, 记.fromUserId, 记.byUserId]).toEqual([乙.id, 市场.id, "system"]);
    const 痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id, kind: "transfer" } });
    expect(痕.reason).toContain("按定时分配，原定");
    const [n] = await 通知(乙.id);
    expect(n.body).toContain("按定时分配，原定");
    expect(n.body).not.toContain("服务停过");
    // 再扫不重复
    expect(await 定时分配扫一遍(加分钟(at, 1))).toMatchObject({ 执行: 0 });
  });

  it("自动分配到点那时再挑人（内贸只剩乙）", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 1, 定时分配: 墙 }) as never);
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 1 });
    expect((await 唯一项目()).ownerId).toBe(乙.id);
    expect((await 通知(乙.id))[0].title).toContain("自动分配给你");
  });

  it("市场成员建的自动分配、客户没填区域：到点照样按区域分（两条线都算），不退回只看内贸（P-转-26）", async () => {
    const { 墙, at } = 后(2);
    // 没手机（分配方向不按电话判，11-18）：区域、电话、本人事业部都判不出 = 不记线
    await applyProposal(卡({ 分配方式: 1, 定时分配: 墙, phone: "", 联系方式: [{ kind: "email", value: "t@x.test" }] }) as never);
    expect((await 唯一项目()).bizLine).toBeNull();
    await setSetting(自动分配不参与key, { [老板.id]: "禁止", [乙.id]: "禁止" });
    invalidateSettingsCache();
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 1, 没分出去: 0 });
    expect((await 唯一项目()).ownerId).toBe(丙.id);
  });

  it("停机补跑：开机那遍把过了点的执行，通知写晚了多久", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never);
    expect(await 定时分配扫一遍(加分钟(at, 95))).toMatchObject({ 执行: 1 });
    expect((await 通知(乙.id))[0].body).toContain("服务停过，晚了 95 分钟");
  });

  it("分不出去（接手人到点已停用）：不分、留在待分配，提醒能分配的人和录入人，写明原定时间和原因；不改分给别人", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never);
    await prisma.user.update({ where: { id: 乙.id }, data: { active: false } });
    忘掉企业版范围();
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 0, 没分出去: 1 });
    const p = await 唯一项目();
    expect(p.ownerId).toBe(市场.id);
    expect(p.awaitAssignAt).not.toBeNull();
    expect(p.scheduledAssignAt).toBeNull();
    const 给老板 = await 通知(老板.id);
    expect(给老板.map((n) => n.body).join("")).toContain("定时分配没分出去");
    const 给录入人 = await 通知(市场.id);
    expect(给录入人.some((n) => n.title.includes("定时分配没分出去") && n.body.includes("原定"))).toBe(true);
    // 下一遍不再试
    expect(await 定时分配扫一遍(加分钟(at, 1))).toMatchObject({ 执行: 0, 没分出去: 0 });
  });

  it("「线索分配」开关到点关着：不分、留待分配", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 1, 定时分配: 墙 }) as never);
    await setSetting(规则.线索分配.key, false);
    invalidateSettingsCache();
    expect(await 定时分配扫一遍(at)).toMatchObject({ 没分出去: 1 });
    expect((await 唯一项目()).ownerId).toBe(市场.id);
  });
});

describe("到点前改 / 取消 / 作废", () => {
  it("录入人改时间、改接手人：到点按新的执行；超过 30 天拦下", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never);
    const p = await 唯一项目();
    const 新 = 后(3);
    expect(await 改定时分配(p.id, { 时间: 新.墙 })).toMatchObject({ ok: true });
    expect(await 改定时分配(p.id, { 时间: 后(24 * 31).墙 })).toMatchObject({ ok: false });
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 0 });
    expect(await 定时分配扫一遍(新.at)).toMatchObject({ 执行: 1 });
    expect((await 唯一项目()).ownerId).toBe(乙.id);
  });

  it("改接手人要是能接线索的人；别的销售（不是录入人、不能分配）改不了", async () => {
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 后(2).墙 }) as never);
    const p = await 唯一项目();
    expect(await 改定时分配(p.id, { 接手人: 市场.id })).toMatchObject({ ok: false });
    当(丙);
    expect(await 改定时分配(p.id, { 时间: 后(3).墙 })).toMatchObject({ ok: false });
    当(老板);
    expect(await 改定时分配(p.id, { 接手人: 丙.id })).toMatchObject({ ok: true });
    expect((await 唯一项目()).scheduledAssignTo).toBe(丙.id);
  });

  it("取消定时：留在待分配、提醒能分配的人，到点不执行", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never);
    const p = await 唯一项目();
    expect(await 取消定时分配(p.id)).toMatchObject({ ok: true });
    const 后来 = await 唯一项目();
    expect([后来.ownerId, 后来.scheduledAssignAt]).toEqual([市场.id, null]);
    expect(后来.awaitAssignAt).not.toBeNull();
    expect((await 通知(老板.id)).length).toBeGreaterThan(0);
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 0 });
    // 取消了就不能再改
    expect(await 改定时分配(p.id, { 时间: 后(3).墙 })).toMatchObject({ ok: false });
  });

  it("改成现在分配：立刻执行，操作人记点的人", async () => {
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 后(2).墙 }) as never);
    const p = await 唯一项目();
    expect(await 定时分配现在分(p.id)).toMatchObject({ ok: true });
    const 后来 = await 唯一项目();
    expect([后来.ownerId, 后来.scheduledAssignAt]).toEqual([乙.id, null]);
    expect((await prisma.entLeadAssign.findFirstOrThrow()).byUserId).toBe(市场.id);
  });

  it("能分配的人到点前手动分了（清了待分配标记）：定时作废，到点不再动", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never);
    const p = await 唯一项目();
    当(老板);
    expect(await 分配线索({ projectId: p.id, toUserId: 乙.id })).toMatchObject({ ok: true });
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 0, 作废: 1 });
    expect((await 唯一项目()).scheduledAssignAt).toBeNull();
    expect(await prisma.entLeadAssign.count()).toBe(1);
  });

  it("进回收站：定时作废，恢复后也不会到点再分", async () => {
    const { 墙, at } = 后(2);
    await applyProposal(卡({ 分配方式: 0, ownerId: 乙.id, 定时分配: 墙 }) as never);
    const p = await 唯一项目();
    await prisma.project.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    expect(await 定时分配扫一遍(加分钟(at, -30))).toMatchObject({ 作废: 1 });
    const { 看已删 } = await import("@/lib/enterprise/soft-delete-core");
    await 看已删(() => prisma.project.update({ where: { id: p.id }, data: { deletedAt: null } }));
    expect(await 定时分配扫一遍(at)).toMatchObject({ 执行: 0 });
    expect((await 唯一项目()).ownerId).toBe(市场.id);
  });
});

describe("挂在夜扫钟上", () => {
  it("nightly 每分钟那一遍调 钟上定时分配", () => {
    const 钟 = fs.readFileSync(path.resolve(__dirname, "../src/lib/project/nightly.ts"), "utf8");
    expect(钟).toContain("钟上定时分配(现在)");
  });
});
